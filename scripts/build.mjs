import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const pbrDir = join(dist, "assets", "pbr");
const audioDir = join(dist, "assets", "audio");
const spbDir = join(dist, "assets", "spb-ff");
const LOCK_PATH = join(root, "data", "pbr-assets-lock.json");
const AUDIO_LOCK_PATH = join(root, "data", "audio-assets-lock.json");
const MAX_ASSET_BYTES = 6 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_SPB_BYTES = 30 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const SPB_SOURCE_COMMIT = "0c46c8301fc512c318ac93e23b669355b7d4b180";
const SPB_LEVEL0_SOURCE_COMMIT = "0c46c8301fc512c318ac93e23b669355b7d4b180";
const SPB_SOURCE_REPO = "https://github.com/SpacePotatoee/MinecraftFoundFootage";
const SPB_FILES = [
  {name:"pbr/concrete/concrete_color.png",path:"src/main/resources/assets/spb-revamped/textures/block/pbr/concrete/concrete_color.png"},
  {name:"pbr/concrete/concrete_normal.png",path:"src/main/resources/assets/spb-revamped/textures/block/pbr/concrete/concrete_normal.png"},
  {name:"pbr/bricks/bricks_color.png",path:"src/main/resources/assets/spb-revamped/textures/block/pbr/bricks/bricks_color.png"},
  {name:"pbr/crate/crate_color.png",path:"src/main/resources/assets/spb-revamped/textures/block/pbr/crate/crate_color.png"},
  {name:"fluorescent_light.png",path:"src/main/resources/assets/spb-revamped/textures/block/fluorescent_light.png"},
  {name:"wall_trim_texture.png",path:"src/main/resources/assets/spb-revamped/textures/block/wall_trim_texture.png"},
  {name:"newstairs_texture.png",path:"src/main/resources/assets/spb-revamped/textures/block/newstairs_texture.png"},
  {name:"level0/wall_block_2_texture.png",path:"src/main/resources/assets/spb-revamped/textures/block/wall_block_2_texture.png"},
  {name:"level0/wall_block_2.png",path:"src/main/resources/assets/spb-revamped/textures/block/wall_block_2.png"},
  {name:"level0/wallpaper_bottom_block_texture.png",path:"src/main/resources/assets/spb-revamped/textures/block/wallpaper_bottom_block_texture.png"},
  {name:"level0/pbr/carpet/carpet_color.png",path:"src/main/resources/assets/spb-revamped/textures/block/pbr/carpet/carpet_color.png"},
  {name:"level0/pbr/carpet/carpet_normal.png",path:"src/main/resources/assets/spb-revamped/textures/block/pbr/carpet/carpet_normal.png"},
  {name:"level0/pbr/ceiling_tile/ceiling_tile_color.png",path:"src/main/resources/assets/spb-revamped/textures/block/pbr/ceiling_tile/ceiling_tile_color.png"},
  {name:"level0/pbr/ceiling_tile/ceiling_tile_normal.png",path:"src/main/resources/assets/spb-revamped/textures/block/pbr/ceiling_tile/ceiling_tile_normal.png"}
];

const lock = JSON.parse(await readFile(LOCK_PATH, "utf8"));
const audioLock = JSON.parse(await readFile(AUDIO_LOCK_PATH, "utf8"));
if (lock.license !== "CC0") throw new Error("PBR asset lock must be CC0.");
if (audioLock.license !== "CC0") throw new Error("Audio asset lock must be CC0.");
if (lock.author !== "methodical pixel") throw new Error("PBR asset lock author does not match the OpenGameArt pack.");
if (lock.source !== "https://opengameart.org/content/backrooms-pbr-texture-pack") throw new Error("PBR asset lock source is unexpected.");

const PBR_FILES = Object.keys(lock.files);
if (PBR_FILES.length !== 12) throw new Error("Expected exactly 12 locked PBR map files.");

async function downloadAudioAsset(filename){
  const expected=audioLock.files[filename];
  if(!expected?.url?.startsWith("https://opengameart.org/sites/default/files/"))throw new Error("Audio asset source URL is invalid: "+filename);
  const response=await fetch(expected.url,{headers:{"Accept":"audio/ogg,audio/*;q=0.9","User-Agent":"THEMPGUY-Backrooms-build/1.0"}});
  if(!response.ok)throw new Error("OpenGameArt audio download failed for "+filename+": HTTP "+response.status);
  const contentType=String(response.headers.get("content-type")||"").toLowerCase();
  if(contentType&&!contentType.startsWith("audio/")&&!contentType.includes("ogg")&&!contentType.includes("octet-stream"))throw new Error("Unexpected audio content type for "+filename+": "+contentType);
  const data=Buffer.from(await response.arrayBuffer());
  if(!data.length||data.length>MAX_AUDIO_BYTES)throw new Error("Invalid audio size for "+filename);
  const sha256=createHash("sha256").update(data).digest("hex");
  await writeFile(join(audioDir,filename),data);
  return {url:expected.url,source:expected.source,author:expected.author,license:expected.license,bytes:data.length,sha256};
}
async function downloadSpacePotatoAsset(entry){
  const sourceCommit=entry.sourceCommit||(entry.name.startsWith("level0/")?SPB_LEVEL0_SOURCE_COMMIT:SPB_SOURCE_COMMIT);
  const url="https://raw.githubusercontent.com/SpacePotatoee/MinecraftFoundFootage/"+sourceCommit+"/"+entry.path;
  const response=await fetch(url,{headers:{"Accept":"image/png","User-Agent":"THEMPGUY-Backrooms-build/1.0"}});
  if(!response.ok)throw new Error("SpacePotato Found Footage asset download failed for "+entry.name+": HTTP "+response.status);
  const data=Buffer.from(await response.arrayBuffer());
  if(!data.length||data.length>MAX_SPB_BYTES)throw new Error("Invalid SpacePotato asset size for "+entry.name);
  if(data.length<8||!data.subarray(0,8).equals(PNG_SIGNATURE))throw new Error("SpacePotato asset is not a PNG: "+entry.name);
  const sha256=createHash("sha256").update(data).digest("hex");
  await mkdir(join(spbDir, entry.name, ".."), { recursive: true });
  await writeFile(join(spbDir,entry.name),data);
  return {url,source:SPB_SOURCE_REPO,commit:sourceCommit,bytes:data.length,sha256};
}

async function downloadPbrAsset(filename) {
  const expected = lock.files[filename];
  if (!expected?.url?.startsWith("https://opengameart.org/sites/default/files/oga-textures/175228/")) {
    throw new Error("PBR asset has an invalid OpenGameArt source URL: " + filename);
  }
  if (!/^[a-f0-9]{64}$/.test(expected.sha256 || "")) {
    throw new Error("PBR asset is missing a valid SHA-256 lock: " + filename);
  }

  const response = await fetch(expected.url, {
    headers: {
      "Accept": "image/png",
      "User-Agent": "THEMPGUY-Backrooms-build/1.0"
    }
  });
  if (!response.ok) {
    throw new Error("OpenGameArt download failed for " + filename + ": HTTP " + response.status);
  }

  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_ASSET_BYTES) {
    throw new Error("Downloaded PBR map exceeds 6 MiB: " + filename);
  }
  if (data.length < 24 || !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Downloaded PBR map is not a PNG: " + filename);
  }

  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== 1024 || height !== 1024) {
    throw new Error("Downloaded PBR map is not 1024x1024: " + filename + " (" + width + "x" + height + ")");
  }

  const sha256 = createHash("sha256").update(data).digest("hex");
  if (sha256 !== expected.sha256) {
    throw new Error("OpenGameArt PBR map changed from its locked checksum: " + filename);
  }
  if (data.length !== expected.bytes) {
    throw new Error("OpenGameArt PBR map size changed from its locked byte count: " + filename);
  }

  await writeFile(join(pbrDir, filename), data);
  return { url: expected.url, bytes: data.length, sha256 };
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await mkdir(pbrDir,{recursive:true});
await mkdir(audioDir,{recursive:true});
await mkdir(spbDir,{recursive:true});

for (const path of ["index.html", "styles.css", "favicon.svg", "sw.js", "src", "data"]) {
  await cp(join(root, path), join(dist, path), { recursive: true });
}

const manifest = {
  pack: lock.pack,
  author: lock.author,
  source: lock.source,
  license: lock.license,
  files: {}
};

for (const filename of PBR_FILES) {
  manifest.files[filename] = await downloadPbrAsset(filename);
}

await writeFile(join(pbrDir,"manifest.json"),JSON.stringify(manifest,null,2)+"\n","utf8");
const spbManifest={source:SPB_SOURCE_REPO,commit:SPB_SOURCE_COMMIT,files:{}};
for(const entry of SPB_FILES)spbManifest.files[entry.name]=await downloadSpacePotatoAsset(entry);
await writeFile(join(spbDir,"manifest.json"),JSON.stringify(spbManifest,null,2)+"\n","utf8");
const audioManifest={pack:audioLock.pack,license:audioLock.license,files:{}};
for(const filename of Object.keys(audioLock.files))audioManifest.files[filename]=await downloadAudioAsset(filename);
await writeFile(join(audioDir,"manifest.json"),JSON.stringify(audioManifest,null,2)+"\n","utf8");
const builtMain=await readFile(join(dist,"src","main.js"),"utf8");
const productionBuild=process.env.BACKROOMS_PRODUCTION_BUILD==="1";
if(productionBuild){
  await writeFile(join(dist,"src","main.js"),builtMain.replace(/\s*\/\* DEV_ADMIN_START \*\/[\s\S]*?\/\* DEV_ADMIN_END \*\//g,""),"utf8");
  await rm(join(dist,"src","admin.js"),{force:true});
}
await writeFile(join(dist,".nojekyll"),"","utf8");

console.log("Downloaded and checksum-verified "+PBR_FILES.length+" CC0 OpenGameArt PBR maps.");
console.log("Downloaded "+Object.keys(audioLock.files).length+" CC0 OpenGameArt audio assets.");
console.log("Downloaded "+SPB_FILES.length+" pinned SpacePotato Found Footage reference assets.");
console.log("PBR manifest size: " + (await stat(join(pbrDir, "manifest.json"))).size + " bytes.");
console.log("Built static site in dist/");
