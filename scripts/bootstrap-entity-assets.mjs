import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const MAX_ENTITY_BYTES = 95 * 1024 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const GLB_MAGIC = Buffer.from("glTF");

const entityManifest = JSON.parse(await readFile(join(root,"data","entity-assets.json"),"utf8"));
const pbrLock = JSON.parse(await readFile(join(root,"data","pbr-assets-lock.json"),"utf8"));
const audioLock = JSON.parse(await readFile(join(root,"data","audio-assets-lock.json"),"utf8"));

const SPB_SOURCE_COMMIT = "0c46c8301fc512c318ac93e23b669355b7d4b180";
const SPB_SOURCE_REPO = "https://github.com/SpacePotatoee/MinecraftFoundFootage";
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

const entityDir=join(root,"assets","entities");
const pbrDir=join(root,"assets","pbr");
const audioDir=join(root,"assets","audio");
const ffDir=join(root,"assets","found-footage");

async function sha256(path){
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
async function validGlb(path){
  try{
    const info=await stat(path);
    if(!info.isFile()||info.size<20||info.size>MAX_ENTITY_BYTES)return false;
    const data=await readFile(path);
    return data.subarray(0,4).equals(GLB_MAGIC)&&data.readUInt32LE(4)===2&&data.readUInt32LE(8)===data.length;
  }catch{return false}
}
async function validPng(path){
  try{
    const info=await stat(path);
    if(!info.isFile()||info.size<24||info.size>MAX_IMAGE_BYTES)return false;
    const data=await readFile(path);
    return data.subarray(0,8).equals(PNG_SIGNATURE);
  }catch{return false}
}
async function validAudio(path){
  try{
    const info=await stat(path);
    return info.isFile()&&info.size>0&&info.size<=MAX_AUDIO_BYTES;
  }catch{return false}
}
async function download(url){
  const r=await fetch(url,{redirect:"follow",headers:{"User-Agent":"THEMPGUY-Backrooms-asset-bootstrap/1.0"}});
  if(!r.ok)throw new Error("HTTP "+r.status+" for "+url);
  return Buffer.from(await r.arrayBuffer());
}
async function saveChecked(path,data,kind){
  await mkdir(join(path,".."),{recursive:true});
  if(kind==="glb"&&(!data.subarray(0,4).equals(GLB_MAGIC)||data.readUInt32LE(4)!==2||data.readUInt32LE(8)!==data.length))
    throw new Error("Invalid glTF 2.0 GLB: "+path);
  if(kind==="png"&&!data.subarray(0,8).equals(PNG_SIGNATURE))
    throw new Error("Invalid PNG: "+path);
  await writeFile(path,data);
  return {bytes:data.length,sha256:createHash("sha256").update(data).digest("hex")};
}

let changed=false;
const downloaded={entities:[],pbr:[],audio:[],foundFootage:[]};
await mkdir(entityDir,{recursive:true});
await mkdir(pbrDir,{recursive:true});
await mkdir(audioDir,{recursive:true});
await mkdir(ffDir,{recursive:true});

// 1. Real entity models: only fetch when the binary is absent.
for(const [type,entry] of Object.entries(entityManifest.assets||{})){
  const target=join(entityDir,entry.file);
  if(await validGlb(target))continue;
  const configured=String(process.env["ENTITY_"+type.toUpperCase()+"_URL"]||entry.directUrl||"").trim();
  let url=configured;
  if(!url&&process.env.SKETCHFAB_ACCESS_TOKEN?.trim()&&entry.uid){
    const r=await fetch("https://api.sketchfab.com/v3/models/"+entry.uid+"/download",{
      headers:{Authorization:"Bearer "+process.env.SKETCHFAB_ACCESS_TOKEN.trim(),Accept:"application/json","User-Agent":"THEMPGUY-Backrooms-asset-bootstrap/1.0"}
    });
    if(!r.ok)throw new Error("Sketchfab download request failed for "+entry.file+": HTTP "+r.status);
    const json=await r.json();
    url=json?.glb?.url||"";
  }
  if(!url){
    console.warn("[assets] No source configured for missing entity "+type+"; leaving it for later bootstrap.");
    continue;
  }
  console.log("[assets] Downloading entity "+type+" once...");
  const data=await download(url);
  const meta=await saveChecked(target,data,"glb");
  downloaded.entities.push({type,file:entry.file,url,bytes:meta.bytes,sha256:meta.sha256});
  changed=true;
}

// 2. CC0 PBR image maps: download once into /assets/pbr.
for(const [filename,entry] of Object.entries(pbrLock.files||{})){
  const target=join(pbrDir,filename);
  if(await validPng(target))continue;
  console.log("[assets] Downloading PBR image "+filename+" once...");
  const data=await download(entry.url);
  if(data.length!==entry.bytes)throw new Error("PBR byte count changed: "+filename);
  const got=createHash("sha256").update(data).digest("hex");
  if(got!==entry.sha256)throw new Error("PBR checksum changed: "+filename);
  await saveChecked(target,data,"png");
  downloaded.pbr.push({file:filename,url:entry.url,bytes:data.length,sha256:got});
  changed=true;
}

// 3. CC0 sound files: download once into /assets/audio.
for(const [filename,entry] of Object.entries(audioLock.files||{})){
  const target=join(audioDir,filename);
  if(await validAudio(target))continue;
  console.log("[assets] Downloading audio "+filename+" once...");
  const data=await download(entry.url);
  if(data.length>MAX_AUDIO_BYTES)throw new Error("Audio exceeds 8 MiB: "+filename);
  const meta=await saveChecked(target,data,"audio");
  downloaded.audio.push({file:filename,url:entry.url,source:entry.source,author:entry.author,license:entry.license,bytes:meta.bytes,sha256:meta.sha256});
  changed=true;
}

// 4. Found Footage image assets: download once into /assets/found-footage.
for(const entry of SPB_FILES){
  const target=join(ffDir,entry.name);
  if(await validPng(target))continue;
  const url="https://raw.githubusercontent.com/SpacePotatoee/MinecraftFoundFootage/"+SPB_SOURCE_COMMIT+"/"+entry.path;
  console.log("[assets] Downloading Found Footage image "+entry.name+" once...");
  const data=await download(url);
  const meta=await saveChecked(target,data,"png");
  downloaded.foundFootage.push({file:entry.name,url,source:SPB_SOURCE_REPO,commit:SPB_SOURCE_COMMIT,bytes:meta.bytes,sha256:meta.sha256});
  changed=true;
}

// Manifests live beside the committed assets so the build has no network dependency.
async function writeManifestIfChanged(path,value){
  const next=JSON.stringify(value,null,2)+"\\n";
  let previous="";
  try{previous=await readFile(path,"utf8");}catch{}
  if(previous!==next){
    await writeFile(path,next);
    changed=true;
  }
}

const pbrFiles={};
for(const [filename,entry] of Object.entries(pbrLock.files||{})){
  const path=join(pbrDir,filename);
  const data=await readFile(path);
  pbrFiles[filename]={...entry,bytes:data.length,sha256:createHash("sha256").update(data).digest("hex")};
}
await writeManifestIfChanged(join(pbrDir,"manifest.json"),{
  pack:pbrLock.pack,author:pbrLock.author,source:pbrLock.source,license:pbrLock.license,
  files:pbrFiles
});

const audioFiles={};
for(const [filename,entry] of Object.entries(audioLock.files||{})){
  const path=join(audioDir,filename);
  const data=await readFile(path);
  audioFiles[filename]={...entry,bytes:data.length,sha256:createHash("sha256").update(data).digest("hex")};
}
await writeManifestIfChanged(join(audioDir,"manifest.json"),{
  pack:audioLock.pack,license:audioLock.license,files:audioFiles
});

const ffFiles={};
for(const entry of SPB_FILES){
  const path=join(ffDir,entry.name);
  const data=await readFile(path);
  ffFiles[entry.name]={
    ...entry,
    source:SPB_SOURCE_REPO,
    commit:SPB_SOURCE_COMMIT,
    bytes:data.length,
    sha256:createHash("sha256").update(data).digest("hex")
  };
}
await writeManifestIfChanged(join(ffDir,"manifest.json"),{
  source:SPB_SOURCE_REPO,commit:SPB_SOURCE_COMMIT,license:"GPL-3.0-only",
  files:ffFiles
});

if(!changed){
  console.log("[assets] All bootstrap assets are already committed. No external downloads performed.");
  process.exit(0);
}

const {execFile}=await import("node:child_process");
const {promisify}=await import("node:util");
const exec=promisify(execFile);
await exec("git",["lfs","install","--local"]);
await exec("git",["config","user.name","github-actions[bot]"]);
await exec("git",["config","user.email","41898282+github-actions[bot]@users.noreply.github.com"]);

const branch=process.env.GITHUB_REF_NAME||"dev";
let pushed=false;
for(let attempt=1;attempt<=5&&!pushed;attempt++){
  // Another queued workflow may have pushed source changes while this bootstrap
  // was downloading. Rebase the asset work onto the newest remote branch.
  await exec("git",["fetch","origin",branch]);
  await exec("git",["reset","--mixed","origin/"+branch]);
  await exec("git",["add","assets",".gitattributes"]);
  const status=await exec("git",["status","--porcelain"]);
  if(!status.stdout.trim()){
    console.log("[assets] Another run already committed the same assets.");
    process.exit(0);
  }
  await exec("git",["commit","-m","assets: bootstrap bundled media"]);
  try{
    await exec("git",["push","origin","HEAD:"+branch]);
    pushed=true;
  }catch(error){
    if(attempt===5)throw error;
    console.warn("[assets] Remote changed during push; retrying asset commit (attempt "+(attempt+1)+"/5).");
  }
}
console.log("[assets] Committed the newly downloaded media to "+branch+".");
console.log("[assets] Future builds use committed files and do not probe external URLs.");
