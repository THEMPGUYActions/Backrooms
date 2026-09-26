import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const root = process.cwd();
const dist = join(root, "dist");
const pbrDir = join(dist, "assets", "pbr");
const audioDir = join(dist, "assets", "audio");
const ffDir = join(dist, "assets", "found-footage");
const entityDir = join(dist, "assets", "entities");
const LOCK_PATH = join(root, "data", "pbr-assets-lock.json");
const AUDIO_LOCK_PATH = join(root, "data", "audio-assets-lock.json");
const MAX_ASSET_BYTES = 6 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_SPB_BYTES = 30 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const SPB_SOURCE_COMMIT = "0c46c8301fc512c318ac93e23b669355b7d4b180";
const SPB_SOURCE_REPO = "https://github.com/SpacePotatoee/MinecraftFoundFootage";
const MAX_SPB_STRUCTURE_BYTES = 6 * 1024 * 1024;
const SPB_FILES = [
  {name:"pbr/concrete/concrete_color.png",path:"src/main/resources/assets/spb-revamped/textures/block/pbr/concrete/concrete_color.png"},
  {name:"pbr/concrete/concrete_normal.png",path:"src/main/resources/assets/spb-revamped/textures/block/pbr/concrete/concrete_normal.png"},
  {name:"pbr/bricks/bricks_color.png",path:"src/main/resources/assets/spb-revamped/textures/block/pbr/bricks/bricks_color.png"},
  {name:"pbr/crate/crate_color.png",path:"src/main/resources/assets/spb-revamped/textures/block/pbr/crate/crate_color.png"},
  {name:"fluorescent_light.png",path:"src/main/resources/assets/spb-revamped/textures/block/fluorescent_light.png"},
  {name:"wall_trim_texture.png",path:"src/main/resources/assets/spb-revamped/textures/block/wall_trim_texture.png"},
  {name:"newstairs_texture.png",path:"src/main/resources/assets/spb-revamped/textures/block/newstairs_texture.png"},
  {name:"level0/wall_block.png",path:"src/main/resources/assets/spb-revamped/textures/block/wall_block.png"},
  {name:"level0/wall_block_2_texture.png",path:"src/main/resources/assets/spb-revamped/textures/block/wall_block_2_texture.png"},
  {name:"level0/wall_block_2.png",path:"src/main/resources/assets/spb-revamped/textures/block/wall_block_2.png"},
  {name:"level0/wallpaper_bottom_block_texture.png",path:"src/main/resources/assets/spb-revamped/textures/block/wallpaper_bottom_block_texture.png"},
  {name:"level0/pole.png",path:"src/main/resources/assets/spb-revamped/textures/block/pole.png"},
  {name:"level0/plastic.png",path:"src/main/resources/assets/spb-revamped/textures/block/plastic.png"},
  {name:"level0/power_pole_texture.png",path:"src/main/resources/assets/spb-revamped/textures/block/power_pole_texture.png"},
  {name:"level0/power_pole_top_texture.png",path:"src/main/resources/assets/spb-revamped/textures/block/power_pole_top_texture.png"}
];

const lock = JSON.parse(await readFile(LOCK_PATH, "utf8"));
const audioLock = JSON.parse(await readFile(AUDIO_LOCK_PATH, "utf8"));
if (lock.license !== "CC0") throw new Error("PBR asset lock must be CC0.");
if (audioLock.license !== "CC0") throw new Error("Audio asset lock must be CC0.");
if (lock.author !== "methodical pixel") throw new Error("PBR asset lock author does not match the OpenGameArt pack.");
if (lock.source !== "https://opengameart.org/content/backrooms-pbr-texture-pack") throw new Error("PBR asset lock source is unexpected.");

const PBR_FILES = Object.keys(lock.files);
if (PBR_FILES.length !== 12) throw new Error("Expected exactly 12 locked PBR map files.");

async function copyLocalAssets(){
  const localPbr=join(root,"assets","pbr");
  const localAudio=join(root,"assets","audio");
  const localFoundFootage=join(root,"assets","found-footage");

  const requiredPbr=Object.keys(lock.files);
  for(const filename of requiredPbr){
    const source=join(localPbr,filename);
    const info=await stat(source).catch(()=>null);
    if(!info?.isFile())throw new Error("Missing committed PBR asset: "+filename);
    await cp(source,join(pbrDir,filename));
  }

  for(const filename of Object.keys(audioLock.files)){
    const source=join(localAudio,filename);
    const info=await stat(source).catch(()=>null);
    if(!info?.isFile())throw new Error("Missing committed audio asset: "+filename);
    await cp(source,join(audioDir,filename));
  }

  for(const entry of SPB_FILES){
    const source=join(localFoundFootage,entry.name);
    const info=await stat(source).catch(()=>null);
    if(!info?.isFile())throw new Error("Missing committed Found Footage asset: "+entry.name);
    await mkdir(join(ffDir,entry.name,".."),{recursive:true});
    await cp(source,join(ffDir,entry.name));
  }

  await cp(join(localPbr,"manifest.json"),join(pbrDir,"manifest.json"));
  await cp(join(localAudio,"manifest.json"),join(audioDir,"manifest.json"));
  await cp(join(localFoundFootage,"manifest.json"),join(ffDir,"manifest.json"));
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await mkdir(pbrDir,{recursive:true});
await mkdir(audioDir,{recursive:true});
await mkdir(ffDir,{recursive:true});
await mkdir(entityDir,{recursive:true});

for (const path of ["index.html", "styles.css", "favicon.svg", "sw.js", "src", "data"]) {
  await cp(join(root, path), join(dist, path), { recursive: true });
}

const entitySource=join(root,"assets","entities");
try{
  const entityInfo=await stat(entitySource);
  if(entityInfo.isDirectory()){
    // Keep every entity format plus companion files such as OBJ/MTL/textures.
    // This intentionally supports FBX, GLB, GLTF, OBJ, and USDZ packages.
    await cp(entitySource,entityDir,{recursive:true});
  }
}catch(error){
  if(error?.code!=="ENOENT")throw error;
}
const redZoneSource=join(root,"assets","RedZone.ogg");
const redZoneTarget=join(dist,"assets","RedZone.ogg");
const redZoneStat=await stat(redZoneSource);
if(!redZoneStat.isFile()||redZoneStat.size<=0||redZoneStat.size>MAX_AUDIO_BYTES)throw new Error("RedZone.ogg is missing or invalid.");
await mkdir(join(dist,"assets"),{recursive:true});
await cp(redZoneSource,redZoneTarget);

const manifest = {
  pack: lock.pack,
  author: lock.author,
  source: lock.source,
  license: lock.license,
  files: {}
};

await copyLocalAssets();
const builtMain=await readFile(join(dist,"src","main.js"),"utf8");
const productionBuild=process.env.BACKROOMS_PRODUCTION_BUILD==="1";
if(productionBuild){
  await writeFile(join(dist,"src","main.js"),builtMain.replace(/\s*\/\* DEV_ADMIN_START \*\/[\s\S]*?\/\* DEV_ADMIN_END \*\//g,""),"utf8");
  const builtIndex=await readFile(join(dist,"index.html"),"utf8");
  await writeFile(join(dist,"index.html"),builtIndex.replace(/\s*<!-- DEV_DEBUG_START -->[\s\S]*?<!-- DEV_DEBUG_END -->/g,""),"utf8");
  await rm(join(dist,"src","admin.js"),{force:true});
}
await writeFile(join(dist,".nojekyll"),"","utf8");

console.log("Copied "+PBR_FILES.length+" committed CC0 OpenGameArt PBR maps.");
console.log("Copied "+Object.keys(audioLock.files).length+" committed CC0 OpenGameArt audio assets.");
console.log("Copied "+SPB_FILES.length+" committed Found Footage assets.");
console.log("PBR manifest size: " + (await stat(join(pbrDir, "manifest.json"))).size + " bytes.");
console.log("Built static site in dist/");
