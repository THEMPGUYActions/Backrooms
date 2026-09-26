import { createHash } from "node:crypto";
import { readFile, readdir, stat, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const assetsDir = join(root, "assets", "entities");
const manifestPath = join(root, "data", "entity-assets.json");
const MAX_ENTITY_BYTES = 95 * 1024 * 1024;
const GLB_MAGIC = Buffer.from("glTF");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const assets = Object.entries(manifest.assets || {});

function envName(type){
  return "ENTITY_" + type.replace(/[^a-z0-9]/gi, "_").toUpperCase() + "_URL";
}

async function isValidGlb(path){
  try{
    const info = await stat(path);
    if(!info.isFile() || info.size < 20 || info.size > MAX_ENTITY_BYTES)return false;
    const data = await readFile(path);
    if(!data.subarray(0,4).equals(GLB_MAGIC))return false;
    if(data.readUInt32LE(4)!==2)return false;
    if(data.readUInt32LE(8)!==data.length)return false;
    return true;
  }catch{return false}
}

const missing=[];
for(const [type,entry] of assets){
  const path=join(assetsDir,entry.file);
  if(!(await isValidGlb(path)))missing.push([type,entry,path]);
}

if(missing.length===0){
  console.log("[entities] All real entity GLBs are already committed. No external downloads performed.");
  process.exit(0);
}

console.log("[entities] Missing " + missing.length + " entity model(s): " + missing.map(([type])=>type).join(", "));

async function downloadBytes(url,headers={}){
  const response=await fetch(url,{
    redirect:"follow",
    headers:{
      "User-Agent":"THEMPGUY-Backrooms-entity-bootstrap/1.0",
      ...headers
    }
  });
  if(!response.ok)throw new Error("HTTP "+response.status+" for "+url);
  const data=Buffer.from(await response.arrayBuffer());
  if(!data.length||data.length>MAX_ENTITY_BYTES*2)throw new Error("Downloaded file is too large for "+url);
  return data;
}

async function findGlb(dir){
  const entries=await readdir(dir,{withFileTypes:true});
  for(const entry of entries){
    const path=join(dir,entry.name);
    if(entry.isDirectory()){
      const nested=await findGlb(path);
      if(nested)return nested;
    }else if(extname(entry.name).toLowerCase()===".glb" && await isValidGlb(path)){
      return path;
    }
  }
  return null;
}

async function materializeDownload(type,entry,url,temp){
  const data=await downloadBytes(url);
  const header=data.subarray(0,4);
  if(header.equals(GLB_MAGIC)){
    const path=join(temp,entry.file);
    await writeFile(path,data);
    return path;
  }
  if(header[0]===0x50&&header[1]===0x4b&&header[2]===0x03&&header[3]===0x04){
    const zip=join(temp,"model.zip");
    await writeFile(zip,data);
    await exec("unzip",["-q","-o",zip,"-d",temp]);
    const glb=await findGlb(temp);
    if(glb)return glb;
    throw new Error(type+" archive did not contain a valid GLB. Use a direct .glb download URL for this asset.");
  }
  throw new Error(type+" download is neither a GLB nor a ZIP archive.");
}

async function copyGlb(source,target){
  const data=await readFile(source);
  if(!data.subarray(0,4).equals(GLB_MAGIC)||data.readUInt32LE(4)!==2)throw new Error("Invalid GLB: "+source);
  if(data.readUInt32LE(8)!==data.length)throw new Error("GLB length header mismatch: "+basename(source));
  if(data.length>MAX_ENTITY_BYTES)throw new Error("GLB exceeds 95 MiB: "+basename(source));
  const sha256=createHash("sha256").update(data).digest("hex");
  await writeFile(target,data);
  return {bytes:data.length,sha256};
}

async function resolveSketchfabUrl(entry){
  const token=process.env.SKETCHFAB_ACCESS_TOKEN?.trim();
  if(!token||!entry.uid)return null;

  const response=await fetch("https://api.sketchfab.com/v3/models/"+entry.uid+"/download",{
    headers:{
      "Authorization":"Bearer "+token,
      "Accept":"application/json",
      "User-Agent":"THEMPGUY-Backrooms-entity-bootstrap/1.0"
    }
  });
  if(!response.ok)throw new Error("Sketchfab download request failed for "+entry.file+": HTTP "+response.status);
  const json=await response.json();
  return json?.glb?.url||json?.gltf?.url||null;
}

await mkdir(assetsDir,{recursive:true});
await exec("git",["lfs","install","--local"]);

let downloaded=[];
for(const [type,entry,target] of missing){
  const configuredUrl=String(process.env[envName(type)]||entry.directUrl||"").trim();
  const url=configuredUrl||await resolveSketchfabUrl(entry);

  if(!url){
    console.warn("[entities] No bootstrap URL/token for "+type+". Skipping it. Normal builds remain fully self-contained and make no external model request.");
    continue;
  }

  console.log("[entities] Bootstrapping "+type+"...");
  const temp=await mkdtemp(join(tmpdir(),"backrooms-entity-"));
  try{
    const selected=await materializeDownload(type,entry,url,temp);
    const meta=await copyGlb(selected,target);
    downloaded.push({type,entry,target,...meta});
    console.log("[entities] Added "+entry.file+" ("+meta.bytes+" bytes, sha256 "+meta.sha256+").");
  }finally{
    await rm(temp,{recursive:true,force:true});
  }
}

if(!downloaded.length){
  console.log("[entities] Nothing was downloaded. Existing local assets remain untouched.");
  process.exit(0);
}

await exec("git",["config","user.name","github-actions[bot]"]);
await exec("git",["config","user.email","41898282+github-actions[bot]@users.noreply.github.com"]);

const trackedPaths=downloaded.map(item=>item.target.replace(root+"/",""));
await exec("git",["add",...trackedPaths,".gitattributes"]);
const status=await exec("git",["status","--porcelain"]);
if(!status.stdout.trim()){
  console.log("[entities] Downloads produced no Git changes.");
  process.exit(0);
}

await exec("git",["commit","-m","assets: bootstrap real entity models"]);
const branch=process.env.GITHUB_REF_NAME||"dev";
await exec("git",["push","origin","HEAD:"+branch]);

console.log("[entities] Committed "+downloaded.length+" real entity model(s) to "+branch+".");
console.log("[entities] Future deployments use the committed binaries. External sources are only contacted again if a model file is missing.");
