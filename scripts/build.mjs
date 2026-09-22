import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const pbrDir = join(dist, "assets", "pbr");
const audioDir = join(dist, "assets", "audio");
const LOCK_PATH = join(root, "data", "pbr-assets-lock.json");
const AUDIO_LOCK_PATH = join(root, "data", "audio-assets-lock.json");
const MAX_ASSET_BYTES = 6 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

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

for (const path of ["index.html", "styles.css", "src", "data"]) {
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
const audioManifest={pack:audioLock.pack,license:audioLock.license,files:{}};
for(const filename of Object.keys(audioLock.files))audioManifest.files[filename]=await downloadAudioAsset(filename);
await writeFile(join(audioDir,"manifest.json"),JSON.stringify(audioManifest,null,2)+"\n","utf8");
await writeFile(join(dist,".nojekyll"),"","utf8");

console.log("Downloaded and checksum-verified "+PBR_FILES.length+" CC0 OpenGameArt PBR maps.");
console.log("Downloaded "+Object.keys(audioLock.files).length+" CC0 OpenGameArt audio assets.");
console.log("PBR manifest size: " + (await stat(join(pbrDir, "manifest.json"))).size + " bytes.");
console.log("Built static site in dist/");
