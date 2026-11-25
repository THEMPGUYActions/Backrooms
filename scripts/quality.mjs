import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, posix, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LEVELS } from "../src/levels.js";

const exec = promisify(execFile);
const root = process.cwd();
const failures = [];
const fail = message => failures.push(message);
const THREE_CORE = "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js";
const THREE_ADDONS = "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/";
const OPEN_GAME_ART_PACK = "https://opengameart.org/sites/default/files/oga-textures/175228/";
const OPEN_GAME_ART_SOURCE = "https://opengameart.org/content/backrooms-pbr-texture-pack";
const SPB_SOURCE_REPO = "https://github.com/SpacePotatoee/MinecraftFoundFootage";
const SPB_SOURCE_COMMIT = "0c46c8301fc512c318ac93e23b669355b7d4b180";
const SPB_ASSET_FILES = [
  "pbr/concrete/concrete_color.png","pbr/concrete/concrete_normal.png","pbr/bricks/bricks_color.png","pbr/crate/crate_color.png",
  "fluorescent_light.png","wall_trim_texture.png","newstairs_texture.png",
  "level0/wall_block.png","level0/wall_block_2_texture.png","level0/wall_block_2.png","level0/wallpaper_bottom_block_texture.png",
  "level0/pole.png","level0/plastic.png","level0/power_pole_texture.png","level0/power_pole_top_texture.png"
];
const PBR_ASSET_FILES = [
  "wallpaper_color.png",
  "wallpaper_rough.png",
  "wallpaper_normal.png",
  "painted_wall_color.png",
  "painted_wall_rough.png",
  "painted_wall_normal.png",
  "carpet_color.png",
  "carpet_rough.png",
  "carpet_normal.png",
  "ceiling_tiles_color.png",
  "ceiling_tiles_rough.png",
  "ceiling_tiles_normal.png"
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else out.push(path);
  }
  return out;
}

function stripQueryHash(value) {
  return value.split("#", 1)[0].split("?", 1)[0];
}

function isScheme(value) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

function localPathFromSpecifier(file, specifier) {
  if (specifier.startsWith("/")) return resolve(root, "." + stripQueryHash(specifier));
  return resolve(dirname(file), stripQueryHash(specifier));
}

function resolveImportMap(specifier, imports) {
  let match = null;
  for (const key of Object.keys(imports)) {
    if (specifier === key || (key.endsWith("/") && specifier.startsWith(key))) {
      if (!match || key.length > match.length) match = key;
    }
  }
  if (!match) return null;
  return String(imports[match]) + specifier.slice(match.length);
}

function validateRemote(url, context) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(context + ": invalid URL " + url);
    return;
  }
  if (parsed.protocol !== "https:") fail(context + ": remote module must use HTTPS: " + url);
  if (parsed.hostname !== "cdn.jsdelivr.net") fail(context + ": unexpected module host: " + parsed.hostname);
  if (!parsed.pathname.startsWith("/npm/three@0.186.0/")) {
    fail(context + ": Three.js dependency is not pinned to r186: " + url);
  }
}

function extractModuleSpecifiers(source) {
  const specs = [];
  const staticRe = /\b(?:import\s+(?:(?:[\s\S]*?)\s+from\s+)?|export\s+(?:\{[\s\S]*?\}|\*)\s+from\s+)["']([^"']+)["']/g;
  for (const match of source.matchAll(staticRe)) specs.push({ specifier: match[1], kind: "static" });
  const dynamicRe = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(dynamicRe)) specs.push({ specifier: match[1], kind: "dynamic" });
  return specs;
}

async function assertFile(path, label) {
  try {
    await stat(path);
  } catch {
    fail(label + ": missing " + path);
  }
}

async function checkJavaScript(files) {
  for (const file of files.filter(file => extname(file) === ".js" || extname(file) === ".mjs")) {
    try {
      await exec(process.execPath, ["--check", file]);
    } catch (e) {
      fail("JS syntax: " + file + "\n" + (e.stderr || e.message));
    }
  }
}

async function checkThreeApiCompatibility(files){
  const deprecated=[
    ["applyToVector3(","Matrix4.applyToVector3() is not available in pinned Three.js r186; use Vector3.applyMatrix4()"],
    ["multiplyVector3(","multiplyVector3() is obsolete; use Vector3.applyMatrix3()/applyMatrix4() as appropriate"],
    ["applyProjection(","Vector3.applyProjection() is obsolete; use Vector3.applyMatrix4()"]
  ];
  for(const file of files.filter(file=>((extname(file)===".js"||extname(file)===".mjs")&&!file.endsWith("/scripts/quality.mjs")))){
    const source=await readFile(file,"utf8");
    for(const [token,message] of deprecated)if(source.includes(token))fail("Three.js API compatibility: "+file+": "+message);
  }
}

async function checkHtml() {
  const htmlPath = join(root, "index.html");
  const html = await readFile(htmlPath, "utf8");

  for (const required of ['id="game"', 'src="./src/main.js"', 'href="./styles.css"']) {
    if (required === 'src="./src/main.js"') {
      const hasMainScript=html.split("<script").some(chunk=>chunk.includes('src="./src/main.js')||chunk.includes("src='./src/main.js"));
      if (!hasMainScript) fail("index.html missing " + required);
    } else if (!html.includes(required)) {
      fail("index.html missing " + required);
    }
  }

  const idCounts = new Map();
  for (const match of html.matchAll(/\bid=["']([^"']+)["']/g)) {
    idCounts.set(match[1], (idCounts.get(match[1]) || 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) fail("index.html has duplicate id: " + id);
  }

  const mapMatches = [...html.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const firstModuleScript = html.search(/<script\b[^>]*type=["']module["']/i);
  if (mapMatches.length !== 1) {
    fail("index.html must contain exactly one import map, found " + mapMatches.length);
    return { html, imports: {} };
  }
  if (firstModuleScript !== -1 && mapMatches[0].index > firstModuleScript) {
    fail("index.html import map must appear before the first module script");
  }

  let imports = {};
  try {
    const map = JSON.parse(mapMatches[0][1]);
    imports = map.imports || {};
  } catch (e) {
    fail("index.html import map JSON is invalid: " + e.message);
  }

  if (imports.three !== THREE_CORE) fail("import map entry 'three' is missing or not pinned to Three.js r186");
  if (imports["three/addons/"] !== THREE_ADDONS) fail("import map entry 'three/addons/' is missing or not pinned to Three.js r186");

  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const specifier = stripQueryHash(match[1]);
    if (!specifier.startsWith("./") && !specifier.startsWith("../") && !specifier.startsWith("/")) continue;
    const relative = specifier.startsWith("/") ? specifier.slice(1) : posix.normalize(specifier);
    if (relative.startsWith("../") || relative === ".." || relative.includes("/../")) {
      fail("HTML path escapes repository root: " + specifier);
      continue;
    }
    await assertFile(resolve(root, relative), "HTML local reference");
  }

  return { html, imports };
}

async function checkCss() {
  const css = await readFile(join(root, "styles.css"), "utf8");
  for (const match of css.matchAll(/url\(\s*["']?([^)"']+)["']?\s*\)/gi)) {
    const value = stripQueryHash(match[1].trim());
    if (!value || value.startsWith("data:") || value.startsWith("#") || /^https?:\/\//i.test(value)) continue;
    await assertFile(resolve(root, value.replace(/^\.\//, "")), "CSS local URL");
  }
}

async function checkModuleGraph(jsFiles, imports) {
  for (const file of jsFiles) {
    const source = await readFile(file, "utf8");
    for (const { specifier, kind } of extractModuleSpecifiers(source)) {
      const context = file + " " + kind + " import";

      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        const candidate = localPathFromSpecifier(file, specifier);
        try {
          await stat(candidate);
        } catch {
          let found = false;
          for (const suffix of [".js", ".mjs"]) {
            try {
              await stat(candidate + suffix);
              found = true;
              break;
            } catch {}
          }
          if (!found) fail(context + ": local module does not exist: " + specifier);
        }
        continue;
      }

      if (specifier.startsWith("node:")) continue;

      if (isScheme(specifier)) {
        validateRemote(specifier, context);
        continue;
      }

      const mapped = resolveImportMap(specifier, imports);
      if (!mapped) {
        fail(context + ": bare module specifier is not mapped by index.html: " + specifier);
        continue;
      }
      validateRemote(mapped, context + " via import map");
    }
  }
}

async function checkAssetSources() {
  const assetsSource = await readFile(join(root, "src/assets.js"), "utf8");
  const buildSource = await readFile(join(root, "scripts/build.mjs"), "utf8");
  let lock;

  try {
    lock = JSON.parse(await readFile(join(root, "data/pbr-assets-lock.json"), "utf8"));
  } catch (e) {
    fail("data/pbr-assets-lock.json is missing or invalid: " + e.message);
    return;
  }

  if (!assetsSource.includes('new URL("../assets/pbr/", import.meta.url).href')) {
    fail("src/assets.js must use the locally bundled /assets/pbr runtime path");
  }
  if (!buildSource.includes('const LOCK_PATH = join(root, "data", "pbr-assets-lock.json");')) {
    fail("scripts/build.mjs must consume the PBR asset lock");
  }
  if (!buildSource.includes('join(root,"assets","RedZone.ogg")')) {
    fail("scripts/build.mjs must explicitly publish assets/RedZone.ogg");
  }
  if (lock.source !== "https://opengameart.org/content/backrooms-pbr-texture-pack") fail("PBR lock source is unexpected");
  if (lock.license !== "CC0") fail("PBR lock license must be CC0");
  if (lock.author !== "methodical pixel") fail("PBR lock author must be methodical pixel");

  const lockedFiles = Object.keys(lock.files || {});
  if (lockedFiles.length !== 12) fail("PBR asset lock must contain exactly 12 maps");
  for (const filename of PBR_ASSET_FILES) {
    if (!lockedFiles.includes(filename)) fail("PBR lock missing map: " + filename);
    if (!assetsSource.includes('"' + filename + '"')) fail("src/assets.js missing local PBR map filename: " + filename);
  }

  const manifestPath = join(root, "dist", "assets", "pbr", "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.source !== lock.source) fail("dist PBR manifest source does not match lock");
    if (manifest.license !== lock.license) fail("dist PBR manifest license does not match lock");
    if (manifest.author !== lock.author) fail("dist PBR manifest author does not match lock");

    for (const filename of PBR_ASSET_FILES) {
      const expected = lock.files?.[filename];
      const entry = manifest.files?.[filename];
      if (!expected) continue;
      if (!entry) {
        fail("dist PBR manifest missing map: " + filename);
        continue;
      }
      if (entry.url !== expected.url || entry.bytes !== expected.bytes || entry.sha256 !== expected.sha256) {
        fail("dist PBR manifest does not match locked metadata: " + filename);
      }

      const assetPath = join(root, "dist", "assets", "pbr", filename);
      try {
        const data = await readFile(assetPath);
        const sha256 = createHash("sha256").update(data).digest("hex");
        if (data.length !== expected.bytes) fail("dist PBR asset byte count mismatch: " + filename);
        if (sha256 !== expected.sha256) fail("dist PBR asset SHA-256 mismatch: " + filename);
        if (data.length < 24 || !data.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) {
          fail("dist PBR asset is not a PNG: " + filename);
        } else if (data.readUInt32BE(16) !== 1024 || data.readUInt32BE(20) !== 1024) {
          fail("dist PBR asset is not 1024x1024: " + filename);
        }
      } catch {
        fail("dist PBR asset missing: " + filename);
      }
    }
  } catch (e) {
    fail("dist PBR manifest invalid or missing: " + e.message);
  }
}
async function checkSpacePotatoAssets(){
  const manifestPath=join(root,"dist/assets/found-footage/manifest.json");
  try{
    const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
    if(manifest.source!==SPB_SOURCE_REPO)fail("SpacePotato asset manifest source mismatch");
    if(manifest.commit!==SPB_SOURCE_COMMIT)fail("SpacePotato asset manifest commit mismatch");
    for(const filename of SPB_ASSET_FILES){
      const entry=manifest.files?.[filename];
      if(!entry){
        fail("SpacePotato asset manifest missing: "+filename);
        continue;
      }
      if(entry.commit!==SPB_SOURCE_COMMIT||entry.source!==SPB_SOURCE_REPO)fail("SpacePotato asset metadata mismatch: "+filename);
      if(!Number.isInteger(entry.bytes)||entry.bytes<=0||!/^[a-f0-9]{64}$/.test(entry.sha256||""))fail("SpacePotato asset checksum metadata invalid: "+filename);
      const assetPath=join(root,"dist/assets/found-footage",filename);
      try{
        const data=await readFile(assetPath);
        const sha256=createHash("sha256").update(data).digest("hex");
        if(data.length!==entry.bytes||sha256!==entry.sha256)fail("SpacePotato asset checksum mismatch: "+filename);
        if(data.length<8||!data.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))fail("SpacePotato asset is not a PNG: "+filename);
      }catch{fail("SpacePotato asset missing: "+filename)}
    }
  }catch(e){fail("SpacePotato asset manifest invalid or missing: "+e.message)}
}

async function checkIndustrialPbrAssets(){
  let lock;
  try{lock=JSON.parse(await readFile(join(root,"data/industrial-pbr-assets-lock.json"),"utf8"))}
  catch(e){fail("data/industrial-pbr-assets-lock.json is missing or invalid: "+e.message);return}
  if(lock.license!=="CC0-1.0")fail("Industrial PBR lock must be CC0-1.0");
  const entries=Object.entries(lock.files||{});
  if(entries.length!==14)fail("Industrial PBR lock must contain 14 verified maps");
  try{
    const manifest=JSON.parse(await readFile(join(root,"dist/assets/pbr/industrial/manifest.json"),"utf8"));
    if(manifest.license!==lock.license)fail("Industrial PBR manifest license mismatch");
    for(const [filename,expected] of entries){
      const entry=manifest.files?.[filename];
      if(!entry){fail("Industrial PBR manifest missing: "+filename);continue}
      for(const key of ["url","source","asset","author","license","bytes","sha256"]){if(entry[key]!==expected[key])fail("Industrial PBR manifest metadata mismatch: "+filename+" "+key)}
      try{
        const data=await readFile(join(root,"dist/assets/pbr/industrial",filename));
        const sha=createHash("sha256").update(data).digest("hex");
        if(data.length!==expected.bytes||sha!==expected.sha256)fail("Industrial PBR checksum mismatch: "+filename);
        if(data.length<4||data[0]!==0xff||data[1]!==0xd8||data[2]!==0xff)fail("Industrial PBR asset is not JPEG: "+filename);
      }catch{fail("Industrial PBR asset missing: "+filename)}
    }
  }catch(e){fail("Industrial PBR manifest invalid or missing: "+e.message)}
}

async function checkLevelSpecificPbrAssets(){
  const sourceDir=join(root,"assets/pbr/level-specific");
  const builtDir=join(root,"dist/assets/pbr/level-specific");
  try{
    const source=JSON.parse(await readFile(join(sourceDir,"manifest.json"),"utf8"));
    const built=JSON.parse(await readFile(join(builtDir,"manifest.json"),"utf8"));
    if(source.license!=="CC0-1.0"||source.license_url!=="https://ambientcg.com/license")fail("Level-specific PBR license metadata is invalid");
    if(JSON.stringify(source)!==JSON.stringify(built))fail("Level-specific PBR build manifest differs from source lock");
    if(source.resolution!=="1K-JPG")fail("Level-specific PBR maps must remain at the 1K-JPG tier");
    if(source.files?.length!==27)fail("Level-specific PBR lock must contain exactly 27 maps (9 material sets x 3 maps)");
    for(const entry of source.files||[]){
      if(!/^[a-z-]+\/(color|normalgl|roughness)\.jpg$/.test(entry.path))fail("Unexpected level-specific PBR path: "+entry.path);
      if(!Number.isInteger(entry.bytes)||entry.bytes<=0||!/^[a-f0-9]{64}$/.test(entry.sha256||""))fail("Level-specific PBR checksum metadata invalid: "+entry.path);
      for(const dir of [sourceDir,builtDir]){
        try{
          const data=await readFile(join(dir,entry.path));
          const sha=createHash("sha256").update(data).digest("hex");
          if(data.length!==entry.bytes||sha!==entry.sha256)fail("Level-specific PBR checksum mismatch: "+entry.path+" in "+dir);
          if(data.length<4||data[0]!==0xff||data[1]!==0xd8||data[2]!==0xff)fail("Level-specific PBR asset is not JPEG: "+entry.path);
        }catch{fail("Level-specific PBR asset missing: "+entry.path+" in "+dir)}
      }
    }
  }catch(e){fail("Level-specific PBR manifest invalid or missing: "+e.message)}
}

async function checkLevelEnvironment(){
  const game=await readFile(join(root,"src/game.js"),"utf8");
  const assets=await readFile(join(root,"src/assets.js"),"utf8");
  const admin=await readFile(join(root,"src/admin.js"),"utf8");
  const fixes=await readFile(join(root,"src/fixes.js"),"utf8");
  if(fixes.includes("adminClass.prototype.teleportManilaRoom="))fail("The Manila fix plugin must not override the canonical admin teleport implementation");
  if(!fixes.includes('button.addEventListener("click",()=>this.teleportManilaRoom())'))fail("The extra Manila admin button must continue to call the canonical teleport method");
  if(!fixes.includes("game.setLevel=(id,options={})=>{")||!fixes.includes("originalSetLevel(id,options)"))fail("Level transition wrappers must forward setLevel options to preserve forced regional destinations");


  if(!game.includes("pushLevel0Baseboard")||!game.includes("trimToeGeom")||!game.includes("addLevel0Outlet"))fail("Level 0 needs visible cove baseboards and detailed duplex outlets");
  if(!assets.includes('level.id==="0"?0xd7d3c8'))fail("Level 0 cove base must use its aged ivory trim material");
  if(!game.includes("this.sky.visible=openSky")||!game.includes("this.sky.visible=true;this.oceanSky.visible=false")||!game.includes("sunY=this.level.id==="))fail("Daylight levels must use an active Preetham sky with an above-horizon sun");
  if(!game.includes("isForcedManila")||!game.includes("forceLevel0ManilaRoom"))fail("Manila Room must have a deterministic admin-generation path");
  if(!admin.includes("teleportManilaRoom")||!admin.includes("Manila Room chunk did not generate"))fail("Admin Manila Room teleport must validate its generated destination");
  if(LEVELS["7"].fog<0x506070)fail("Level 7 sky/fog palette must not be near-black");
  if(LEVELS["10"].fog<0x808080)fail("Level 10 overcast sky must use a visible daylight palette");
  if(LEVELS["10"].fogDensity>.003)fail("Level 10 must use light atmospheric haze, not permanent dense fog");
  if(LEVELS["4"].fogDensity!==0||LEVELS["4"].ambientIntensity<.8||LEVELS["4"].ambientIntensity>1||LEVELS["4"].theme.fog<0xaaaaaa||LEVELS["4"].theme.ambient<0x909090)fail("Level 4 must have no fog and a restrained office ambient-light budget");
  if(!game.includes('this.level.id==="4"?0x7d898b'))fail("Level 4 hemisphere ground fill must retain a muted cool-gray floor bounce");
  if(!game.includes("for(let row=0;row<12;row++)for(let col=0;col<12;col++)")||!game.includes("baseIntensity:900,intensity:900,distance:30,cullRadius:32,decay:2"))fail("Level 4 must use restrained, physically attenuated ceiling-light coverage");
  if(!game.includes('const xA=this.originX+size*(.33')||!game.includes('let officeWindowIndex=0;')||!game.includes('isLevel4BlackedOut=blackedOut')||!game.includes('level4OfficeSign=true'))fail("Level 4 needs staggered office partitions, mostly blacked-out windows, and restrained room wayfinding");
  if(!assets.includes('[library.officePlastic,BACKROOMS_PBR_SOURCES.paintedWall,2.4,.96')||!assets.includes('[library.officeCeilingTile,BACKROOMS_PBR_SOURCES.ceiling,2.1,.97'))fail("Level 4 painted drywall and suspended ceiling must use their committed PBR maps");
  if(!assets.includes('officePlastic:2.4,officeCeilingTile:2.1')||!game.includes('tileGeometryUV(new THREE.BoxGeometry(tileSize,.055,tileSize),lib.officeCeilingTile)'))fail("Level 4 drywall and suspended-ceiling PBR maps must use world-space UV tiling");
  if(!game.includes('const LEVELS_WITHOUT_GLOBAL_CEILING=new Set(["4","6","7","9","10","37"])')||!game.includes("LEVELS_WITHOUT_GLOBAL_CEILING.has(String(this.game.level.id))")||!game.includes("LEVELS_WITHOUT_GLOBAL_CEILING.has(String(this.level.id))")||!game.includes("if(this.ceilingSurface)this.ceilingSurface.visible=!LEVELS_WITHOUT_GLOBAL_CEILING.has(String(this.game.level.id));"))fail("Level 4 authored ceiling and open-air levels must hide the generic world ceiling after async asset setup and during streaming");
  if(!game.includes('this.level.id==="4"?null:new THREE.FogExp2'))fail("Level 4 must not be affected by scene fog");
  if(game.includes("0x142b36"))fail("Level 7 surface fog must not be reset to the old near-black tint each frame");
  if(!game.includes('["1","2","3","4","6","7","8","9","10"].includes(level.id)'))fail("Generic fluorescent fixtures must be excluded from levels with authored lighting layouts");
  for(const token of ["const kernels=new THREE.InstancedMesh","const awns=new THREE.InstancedMesh","kernels.count=kernelCount;awns.count=awnCount"]){
    if(!game.includes(token))fail("Level 10 wheat geometry missing realistic grain/awn detail: "+token);
  }
  if(!assets.includes('wheat:new THREE.MeshStandardMaterial({color:0xffffff'))fail("Wheat material must allow per-instance natural straw variation");
  if(!game.includes('this.sky.visible=openSky')||!game.includes('const sunY=this.level.id==="9"?-.18:this.level.id==="10"?.48:.68'))fail("Outdoor sky must keep the day levels on the physical sky and leave Level 9 nocturnal");
  if(!game.includes('this.daylight.intensity=this.level.id==="10"?1.55'))fail("Level 10 must have direct daylight illumination");
}

async function checkGameplayPhysicsAndRendering(){
  const game=await readFile(join(root,"src/game.js"),"utf8");
  const input=await readFile(join(root,"src/input.js"),"utf8");
  const reflection=await readFile(join(root,"src/level1-wet.js"),"utf8");
  const html=await readFile(join(root,"index.html"),"utf8");
  const css=await readFile(join(root,"styles.css"),"utf8");
  for(const token of ['import { Sky } from "three/addons/objects/Sky.js"',"this.sky=new Sky()","this.cloudLayer=new THREE.Mesh","skyUniforms.turbidity.value","this.daylight.intensity=this.level.id==="]){
    if(!game.includes(token))fail("Atmospheric sky setup missing: "+token);
  }
  for(const token of ["this.velocity=new THREE.Vector3()","function oceanSurfaceHeight(x,z,time)","const buoyancy=9.81*1.18*submerged","const waterDrag=-this.verticalVelocity*(2.5+submerged*1.8)","const forwardStroke=-mv.y*Math.sin(this.pitch)","input.wantsAscend()?1:0","input.wantsDive()?1:0"]){
    if(!game.includes(token))fail("Player physics contract missing: "+token);
  }
  if(game.includes("Math.sin(this.pitch)*swimInput"))fail("Swimming must not be controlled by camera pitch");
  for(const token of ["this.oceanSky=new THREE.Mesh(new THREE.SphereGeometry(400,48,32),oceanSkyMaterial)",'this.oceanSky.visible=false','this.cloudLayer.visible=openSky','const openSky=["7","9","10"].includes(this.level.id)',"new THREE.PlaneGeometry(size,size,128,128)","backrooms-level7-world-waves-v4","new THREE.PlaneGeometry(7.7,7.7,24,24)","roomWater.onBeforeCompile=water.onBeforeCompile","transformed.z+=sin(waterWorld.x*.19+uBackroomsTime*.72)*.13","oceanSurfaceHeight(this.position.x,this.position.z,this.game.gameTime)"]){
    if(!game.includes(token))fail("Level 7 sky, animated water, or buoyancy surface coupling missing: "+token);
  }
  if(!game.includes('this.scene.background=new THREE.Color(this.level.id==="7"?0x8bc3e8')||!game.includes('this.scene.background.setHex(0x8bc3e8)'))fail("Level 7 needs a blue fallback background beneath the physical sky");
  if(!input.includes("wantsAscend(){")||!input.includes("wantsDive(){"))fail("Explicit surface/dive input actions are missing");
  if(!html.includes('id="mobile-swim-up"')||!html.includes('id="mobile-swim-down"'))fail("Mobile swimming controls are missing");
  if(!css.includes("#mobile-controls.level-seven .touch-button.swim"))fail("Mobile swimming controls must be scoped to Level 7");
  if(!reflection.includes("this.size=mobile?256:512")||!reflection.includes("this.frame++%3!==0"))fail("Puddle reflections must use reduced resolution and a throttled update cadence");
  if(reflection.includes("this.scene.traverse"))fail("Puddle reflection must not traverse and hide the entire scene each update");
  if(!reflection.includes("camera.layers.enable(1)")||!reflection.includes("source.layers.mask&~(1<<1)"))fail("Puddle reflection must exclude puddles using a dedicated render layer");
  if(!game.includes("puddle.layers.set(1)"))fail("Puddles must use their own layer so the main camera can render them while reflections exclude them");
}

async function checkStartupAndLevelPresentation(){
  const game=await readFile(join(root,"src/game.js"),"utf8");
  const html=await readFile(join(root,"index.html"),"utf8");
  const css=await readFile(join(root,"styles.css"),"utf8");
  const main=await readFile(join(root,"src/main.js"),"utf8");
  const sw=await readFile(join(root,"sw.js"),"utf8");
  if(html.includes('id="loading-screen"')||css.includes(".loading-screen")||game.includes("loading-screen")||game.includes("setLoadingProgress"))fail("A separate progress overlay must not replace the intro cinematic");
  for(const token of ["async ensureAroundAsync(","const assetLoad=this.world.configure();","await this.world.ensureAroundAsync(0,0);","await assetLoad;","await this.renderer.compileAsync(this.scene,this.camera)","this.worldReady=true;","this.preloadComplete=true"]){
    if(!game.includes(token))fail("Background world preparation is missing: "+token);
  }
  if(game.indexOf('boot?.classList.add("intro-ready")')>game.indexOf("const assetLoad=this.world.configure();"))fail("The intro must start before asynchronous asset and chunk preloading");
  if(!game.includes("this.armAudioGateFallback?.()")||!game.includes("if(this.pendingStart)this.beginIntroReveal();"))fail("Intro audio activation and queued gameplay handoff must survive asynchronous preloading");
  if(game.indexOf("this.worldReady=true;")>game.indexOf("if(this.pendingStart)this.beginIntroReveal();"))fail("Gameplay may only hand off after the prepared world is ready");
  if(!css.includes(".intro-screen.intro-ready")||!css.includes("transition:opacity 1.2s ease,visibility 0s linear 0s"))fail("Ready intro overlay must become visible immediately instead of inheriting the fade-out visibility delay");
  if(!css.includes(".intro-ready .intro-title-page")||!css.includes("animation:intro-title-sequence 8.2s ease-in-out forwards"))fail("Intro title cinematic animation is missing");
  if(!css.includes(".intro-ready .intro-credits-page")||!css.includes("animation:intro-credits-sequence 6.4s ease-in-out 8.6s forwards"))fail("Intro credits cinematic animation is missing");
  if(!css.includes(".intro-ready .intro-audio-page")||!css.includes("animation:intro-audio-sequence 1s ease 15.25s forwards"))fail("Intro audio gate timeline is missing");
  if(css.includes(".intro-screen,.intro-page,.brand-logo,.movie-title,.movie-present,.audio-gate{\n    animation-duration:.01ms"))fail("Reduced-motion CSS must not collapse the intro into a near-instant flash");
  if(!main.includes("if(event.persisted)window.location.reload()"))fail("Back-forward cache restoration must start a fresh intro timeline");
  if(!sw.includes("backrooms-assets-v69"))fail("Service-worker cache version must change when startup and scene bundles change");
  for(const token of ["this.totalBlackoutActive=false","this.beginTotalBlackout()","this.endTotalBlackout()","this.ambient.intensity=0","this.daylight.intensity=0","this.flash.intensity=0","this.flashFill.intensity=0","this.scene.background?.setHex?.(0x000000","(this.totalBlackoutActive&&this.totalBlackoutPhase===\"blackout\")||insideBlackout"]){
    if(!game.includes(token))fail("Backrooms-wide total blackout is missing a required all-lights-off control: "+token);
  }
  if(!game.includes("material.emissiveIntensity=0")||!game.includes("baseBlackoutEmissive")||!game.includes("baseBlackoutColor"))fail("Total blackout must suppress and restore emissive and unlit meshes, not only point lights");
  if(!game.includes('this.totalBlackoutPhase==="blackout"?"BLACKOUT":"FLICKER"'))fail("Total blackout phase must persist across level transitions");
  for(const token of ["this.totalBlackoutDarkEndsAt=this.totalBlackoutPhaseEndsAt+this.totalBlackoutDuration","this.totalBlackoutEndsAt=this.totalBlackoutDarkEndsAt+this.totalBlackoutRecoveryDuration","this.totalBlackoutPhase=\"flicker-in\"","this.totalBlackoutPhase=\"flicker-out\"","this.totalBlackoutPhase!==\"blackout\"","this.totalBlackoutDuration=Math.max(0,this.totalBlackoutDarkEndsAt-this.gameTime)"]){if(!game.includes(token))fail("Total blackout duration/phase handling is missing: "+token);}
  if(!game.includes("this.solidRects.push({minX:p.x-half,maxX:p.x+half,minZ:p.z-half,maxZ:p.z+half})")||!game.includes("for(const rect of nearby?.solidRects||[])"))fail("Level 1 pillar collision must handle spawn points starting inside a solid pillar");
  if(!game.includes("this.player.position.set(0,this.player.eyeY,0)")||!game.includes("addPanel(left+.14,z,Math.PI/2"))fail("Level 1 central spawn or Level 3 wall-mounted electrical panel layout missing");
  if(!game.includes("addGate(cx,cz-size*.22,true)")||!game.includes("addGate(cx+size*.22,cz,false)"))fail("Level 3 barred gates must be located on visible main service corridors");
  if(game.includes('"sanctum"')||!game.includes('this.zone==="switchgear"')||!game.includes("level3SwitchgearCabinet"))fail("Level 3 special rooms must remain electrical/industrial, not fantasy or temple themed");
  if(!game.includes("const addOfficeBoundary=(axis,fixed,start,end)=>")||!game.includes("addOfficeBoundary(\"x\",z")||!game.includes("blackedOut?lib.officeWindowBlackout:lib.officeWindowGlass")||!game.includes("const xA=this.originX+size*(.33"))fail("Level 4 must use real windows and a connected, non-cross-shaped office layout");
}

async function checkLevel2UtilityHallGeometry(){
  const game=await readFile(join(root,"src/game.js"),"utf8");
  const assets=await readFile(join(root,"src/assets.js"),"utf8");
  for(const token of ["const tiledWallGeometry=(width,height,depth,tileSize=2.8)","uvs.setXY(i,x/tileSize,z/tileSize)","const addPipeRoute=(points,rusted=false)","const junctionGap=3.25,crossGap=1.25","const addRunWithOpening=(axis,fixed,start,end,openingCenter,openingHalf,rusted)=>","if(Math.abs(z-cz)<6)continue;","if(Math.abs(x-cx)<6)continue;","uvs.setXY(i,uvs.getX(i)*circumference/.8,(y+length/2)/.8)","const addFrame=(x,z,alongZ)=>","const addTunnelLight=(x,z,alongZ,index)=>","this.surfaceSize=this.size*(this.radius*2+3)","surface.position.x=centerX;surface.position.z=centerZ;surface.updateMatrix()"]){
    if(!game.includes(token))fail("Level 2 open-junction or utility geometry fix missing: "+token);
  }
  if(game.includes("const baySeed=")||game.includes("const bayX=")||game.includes("const pumpX="))fail("Level 2 must not generate partitions or equipment in the cross-junction");
  if(game.includes("const drain=new THREE.Mesh"))fail("Level 2 cross-junction must not contain floor obstructions");
  if(game.includes("const pipeGeometry=new THREE.CylinderGeometry(.105,.105,1,12)"))fail("Level 2 pipes must use length-scaled UV geometry instead of stretched instanced cylinders");
  if(!assets.includes("texture.wrapS=THREE.RepeatWrapping;")||!assets.includes("texture.wrapT=THREE.RepeatWrapping;"))fail("Loaded PBR maps must repeat for world-scaled UVs");
  if(!assets.includes('wallPrefix+"_color.jpg",true,1,.28'))fail("Industrial wall PBR maps must not add a second global repeat");
}async function checkWorldTextureUVs(){
  const assets=await readFile(join(root,"src/assets.js"),"utf8");
  const game=await readFile(join(root,"src/game.js"),"utf8");
  const levels=await readFile(join(root,"src/levels.js"),"utf8");
  for(const token of [
    "export function tileGeometryUV(geometry,material)",
    "const tiledGeometryCache = new WeakMap()",
    "tiled.userData.backroomsWorldTiled=true",
    "texture.repeat.set(1,1)",
    "material.userData.backroomsUvTileSize",
    "new THREE.Mesh(tileGeometryUV(geometry,material),material)",
    "texture=(await loadRemoteTexture(url,color)).clone()"
  ]){
    if(!assets.includes(token))fail("World-space texture UV mapping or isolated texture transforms missing: "+token);
  }
  if(!levels.includes("wallHeight: 12.0,"))fail("Level 1 must retain six metres of clearance on both storeys");
  for(const token of [
    "tileGeometryUV(geometry,material)",
    "tileGeometryUV(new THREE.BoxGeometry(rampLength,.28,6.5),lib.concrete)",
    "tileGeometryUV(new THREE.CylinderGeometry(.11,.11,3.8,10),lib.metal)",
    "this.game.world.walkSurfaceHeightAt(this.position.x,this.position.z,this.parkingFloor)",
    'const LEVEL1_UPPER_FLOOR_Y=LEVELS["1"].wallHeight/2;',
    "const upperPillarGeom=new THREE.BoxGeometry(1.22,upperStoreyHeight,1.22);",
    "rampLength=40,",
    "level1UpperFloorOpening",
    "upperDeck.userData.level1WalkableDeck=true",
    "this.parkingFloor===0&&this.position.x>=ramp.endX-.05",
    "this.parkingFloor===1&&this.position.x<=ramp.startX+.05",
    "obstacleSegments=this.collisionSegments.slice(this.baseCollisionSegmentCount)",
    "const centerY=rise/2-.14*Math.cos(angle)",
    "x-.7275",
    "x+.7275",
    "z-.7275",
    "z+.7275",
    "this.world.findSafeSpawn(this.player.position.x,this.player.position.z,.46)"
  ]){
    if(!game.includes(token))fail("Level geometry UV, ramp traversal, or safe spawn regression: "+token);
  }
  if(assets.includes("m.map.repeat.set(scale,scale)")||assets.includes("texture.repeat.set(repeat,repeat)"))fail("Texture maps must not be globally repeated on top of world-space geometry UVs");
  if(game.includes('ceiling_tiles_color.png')&&game.includes('library.ceiling.map?.image?.src?.includes("ceiling_tiles_color.png")'))fail("Level 1 ceiling must use the stone/concrete map, not the Level 0 grid texture");
  if(!assets.includes('const floorPrefix=level.id==="2"?"level2_concrete":"level3_concrete";'))fail("Industrial floors must use the matching level-specific concrete texture set");
  if(!assets.includes('texture.repeat.copy(previous.repeat);texture.offset.copy(previous.offset)'))fail("Async PBR map swaps must preserve configured world-space UV tiling");
  if(!game.includes('this.game.level.wallHeight+.008'))fail("Level 0 ceiling plane must clear wall tops to prevent z-fighting");
  if(!game.includes('const assetLibrary=this.library,assetLevel=this.game.level;')||!game.includes('if(this.library!==assetLibrary||this.game.level!==assetLevel)return;'))fail("Async level asset loads must be isolated from later level changes");
  if(!game.includes('for(let ring=1;ring<=12;ring++)')||!game.includes('const verify=this.collision(new THREE.Vector3(hit.x,0,hit.z),radius)'))fail("Safe spawn search must reject positions pushed into a second obstacle");
}

async function checkExitPositionInitialization(){
  const source=await readFile(join(root,"src/game.js"),"utf8");
  if(source.includes("this.exit.position.set("))fail("Special exits must initialize their position vector before assigning coordinates");
}

async function checkAudioAssets(){
  let lock;
  try{lock=JSON.parse(await readFile(join(root,"data/audio-assets-lock.json"),"utf8"))}catch(e){fail("data/audio-assets-lock.json is missing or invalid: "+e.message);return}
  if(lock.license!=="CC0")fail("Audio asset lock must use CC0");
  const entries=Object.entries(lock.files||{});
  if(entries.length<8)fail("Audio asset lock must contain at least eight assets");
  for(const [filename,entry] of entries){
    if(!/^[a-z0-9_-]+\.ogg$/.test(filename))fail("Audio asset filename is unexpected: "+filename);
    if(!entry?.url?.startsWith("https://opengameart.org/sites/default/files/")&&!entry?.url?.startsWith("https://bigsoundbank.com/UPLOAD/bwf-en/"))fail("Audio asset source URL is unexpected: "+filename);
    if(entry.license!=="CC0")fail("Audio asset is not CC0: "+filename);
    await assertFile(join(root,"dist/assets/audio",filename),"dist audio asset");
  }
  try{
    const manifest=JSON.parse(await readFile(join(root,"dist/assets/audio/manifest.json"),"utf8"));
    if(manifest.license!=="CC0")fail("dist audio manifest license mismatch");
    for(const [filename,entry] of entries){
      const built=manifest.files?.[filename];
      if(!built){fail("dist audio manifest missing asset: "+filename);continue}
      if(built.url!==entry.url||built.license!==entry.license||built.author!==entry.author)fail("dist audio manifest metadata mismatch: "+filename);
      if(entry.source&&built.source!==entry.source)fail("dist audio source page mismatch: "+filename);
      if(entry.provider&&built.provider!==entry.provider)fail("dist audio provider mismatch: "+filename);
      if(entry.source_id&&built.source_id!==entry.source_id)fail("dist audio source ID mismatch: "+filename);
      if(!Number.isInteger(built.bytes)||built.bytes<=0||!/^[a-f0-9]{64}$/.test(built.sha256||""))fail("dist audio manifest checksum metadata invalid: "+filename);
    }
  }catch(e){fail("dist audio manifest invalid or missing: "+e.message)}
}

async function checkEntityModels(){
  let manifest;
  try{
    manifest=JSON.parse(await readFile(join(root,"data/entity-assets.json"),"utf8"));
  }catch(e){
    fail("data/entity-assets.json is missing or invalid: "+e.message);
    return;
  }

  const supported=["fbx","glb","gltf","obj","usdz"];
  for(const [type,entry] of Object.entries(manifest.assets||{})){
    const candidates=Array.isArray(entry.files)&&entry.files.length
      ? entry.files
      : [entry.file||type+".glb"];
    for(const filename of candidates){
      const ext=filename.toLowerCase().split(".").pop();
      if(!supported.includes(ext)){
        fail("Unsupported entity model format in manifest: "+filename);
        continue;
      }
      const assetPath=join(root,"assets/entities",filename);
      try{
        const info=await stat(assetPath);
        if(!info.isFile())throw new Error("not a file");
        if(info.size<20||info.size>95*1024*1024)fail("Entity asset size is outside safe bounds: "+type+"/"+filename);
        const data=await readFile(assetPath);
        if(ext==="glb"){
          if(data.subarray(0,4).toString()!=="glTF")fail("Entity GLB magic mismatch: "+type);
          if(data.readUInt32LE(4)!==2)fail("Entity GLB is not glTF 2.0: "+type);
          if(data.readUInt32LE(8)!==data.length)fail("Entity GLB length header mismatch: "+type);
        }else if(ext==="gltf"){
          try{JSON.parse(data.toString("utf8"))}catch{fail("Entity glTF JSON is invalid: "+type+"/"+filename)}
        }else if(ext==="fbx"){
          const ascii=data.subarray(0,256).toString("utf8");
          const binary=data.subarray(0,21).toString("utf8").startsWith("Kaydara FBX Binary");
          if(!binary&&!ascii.includes("FBXHeaderExtension"))fail("Entity FBX signature is invalid: "+type+"/"+filename);
        }else if(ext==="obj"){
          if(!/^\\s*(?:v|vn|vt|f)\\s/m.test(data.subarray(0,1024*1024).toString("utf8")))fail("Entity OBJ does not look like Wavefront OBJ: "+type+"/"+filename);
        }else if(ext==="usdz"){
          if(data[0]!==0x50||data[1]!==0x4b)fail("Entity USDZ is not a ZIP archive: "+type+"/"+filename);
        }
      }catch{
        // Missing models are allowed until the one-time bootstrap source is configured.
      }
    }
  }
}

async function checkData() {
  try {
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    if (packageJson.type !== "module") fail("package.json must use ESM mode");
    if (!packageJson.scripts?.build || !packageJson.scripts?.check || !packageJson.scripts?.["build:check"]) {
      fail("package.json is missing required build/check scripts");
    }
  } catch (e) {
    fail("package.json invalid: " + e.message);
  }

  let levels = [];
  try {
    levels = JSON.parse(await readFile(join(root, "data/levels.json"), "utf8"));
    if (!Array.isArray(levels) || levels.length < 3) fail("levels.json must describe at least three levels");
    for (const level of levels) {
      for (const key of ["id", "number", "name", "source", "license"]) {
        if (!level?.[key]) fail("levels.json entry missing " + key);
      }
      if (level?.source && !String(level.source).startsWith("https://")) {
        fail("levels.json source must use HTTPS: " + level.source);
      }
    }
  } catch (e) {
    fail("levels.json invalid: " + e.message);
  }

  try {
    const levelJs = await readFile(join(root, "src/levels.js"), "utf8");
    const sourceUrls = [...levelJs.matchAll(/sourceUrl:\s*["']([^"']+)["']/g)].map(match => match[1]);
    const dataUrls = levels.map(level => level.source).filter(Boolean);
    if (sourceUrls.length !== dataUrls.length || sourceUrls.some((url, i) => url !== dataUrls[i])) {
      fail("src/levels.js and data/levels.json source URLs do not match");
    }
    const levelIds=Object.keys(LEVELS).filter(id=>Number(id)<=10).sort((a,b)=>Number(a)-Number(b));
    if(levelIds.length!==11||levelIds.some((id,index)=>id!==String(index)))fail("The campaign must contain contiguous levels 0 through 10");
    for(let index=0;index<=10;index++){
      const id=String(index),current=LEVELS[id],metadata=levels.find(entry=>entry.id===id),expectedNext=index<10?String(index+1):null;
      if(!current||current.next!==expectedNext)fail("src/levels.js progression is broken at Level "+id);
      if(!metadata||metadata.next!==expectedNext)fail("data/levels.json progression is broken at Level "+id);
      if(metadata&&current&&metadata.name!==current.name)fail("Level name metadata mismatch at Level "+id);
    }
  } catch (e) {
    fail("src/levels.js could not be checked: " + e.message);
  }
}

async function checkBacteriaModel(){
  const modelPath=join(root,"assets/entities/bacteria-roof-v2.glb");
  const bytes=await readFile(modelPath);
  if(bytes.toString("ascii",0,4)!=="glTF"||bytes.readUInt32LE(4)!==2)fail("Bacteria GLB is missing or invalid");
  const jsonLength=bytes.readUInt32LE(12);
  const gltf=JSON.parse(bytes.toString("utf8",20,20+jsonLength).trim());
  const artifact=gltf.nodes?.find(node=>node.name==="Object_166");
  if(!artifact||!Number.isInteger(artifact.mesh))fail("Bacteria export-artifact node Object_166 is missing; re-audit model bounds before changing its scale");
  const clips=gltf.animations||[];
  for(const name of ["bendingOverScene","chaseSceneEnd","JUMPSCARE"]){
    const clip=clips.find(animation=>animation.name.toLowerCase().endsWith(name.toLowerCase()));
    if(!clip||!clip.samplers?.length||!clip.channels?.length)fail("Bacteria animation is missing or has no tracks: "+name);
  }
  const source=await readFile(join(root,"src/entity-models.js"),"utf8");
  for(const token of ["Object_166","worldBounds","bendingOverScene","clip.duration>.001","skeleton.update()"]){
    if(!source.includes(token))fail("Bacteria model audit regression: missing "+token);
  }
  console.log("Bacteria model audit: detached export artifact and three animated clips verified.");
}

async function checkBuildIfPresent() {
  const dist = join(root, "dist");
  try {
    await stat(dist);
  } catch {
    return;
  }

  for (const required of ["index.html", "styles.css", "favicon.svg", "sw.js", "src/main.js", "src/game.js", "src/assets.js", "data/levels.json", "assets/RedZone.ogg", ".nojekyll"]) {
    await assertFile(join(dist, required), "dist build");
  }

  const distHtml = await readFile(join(dist, "index.html"), "utf8");
  const hasDistMainScript=distHtml.split("<script").some(chunk=>chunk.includes('src="./src/main.js')||chunk.includes("src='./src/main.js"));
  if (!hasDistMainScript) fail("dist/index.html lost the main module reference");
  if (!distHtml.includes('type="importmap"')) fail("dist/index.html lost the Three.js import map");
  if (!distHtml.includes(THREE_CORE) || !distHtml.includes(THREE_ADDONS)) {
    fail("dist/index.html does not contain the pinned Three.js import map");
  }
}

async function checkWorkflow() {
  const path = join(root, ".github/workflows/qa-pages.yml");
  try {
    const workflow = await readFile(path, "utf8");
    const required = [
      "branches:\n      - main\n      - dev",
      "npm run check",
      "npm run build",
      "publish_branch: gh-pages",
      "github_token: \${{ secrets.GITHUB_TOKEN }}",
      "github.ref == 'refs/heads/main'",
      "github.ref == 'refs/heads/dev'",
      "destination_dir: dev"
    ];
    for (const rule of required) {
      if (!workflow.includes(rule)) fail("workflow missing required QA/deployment rule: " + rule.replace(/\n/g, " / "));
    }
  } catch (e) {
    fail("workflow could not be read: " + e.message);
  }
}

const files = await walk(root);
const jsFiles = files.filter(file => extname(file) === ".js" || extname(file) === ".mjs");

await checkJavaScript(files);
await checkThreeApiCompatibility(files);
const { imports } = await checkHtml();
await checkCss();
await checkModuleGraph(jsFiles, imports);
await checkData();
await checkBuildIfPresent();
await checkEntityModels();
await checkBacteriaModel();
await checkAssetSources();
await checkSpacePotatoAssets();
await checkAudioAssets();
await checkIndustrialPbrAssets();
await checkLevelSpecificPbrAssets();
await checkLevelEnvironment();
await checkGameplayPhysicsAndRendering();
await checkStartupAndLevelPresentation();
await checkWorldTextureUVs();
await checkLevel2UtilityHallGeometry();
await checkExitPositionInitialization();
await checkWorkflow();

for (const file of files) {
  const normalized=file.replaceAll("\\","/");
  if (
    normalized.includes("/assets/entities/") ||
    normalized.includes("/assets/pbr/") ||
    normalized.includes("/assets/audio/") ||
    normalized.includes("/assets/found-footage/") ||
    normalized.endsWith("/assets/RedZone.ogg")
  ) continue;
  const size = (await stat(file)).size;
  if (size > 2_000_000) fail("File exceeds 2 MB source budget: " + file);
}

if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log("QA PASS");
console.log("Checked " + jsFiles.length + " JavaScript/ESM files, HTML, CSS URLs, import-map resolution, build output, PBR assets, data consistency, deployment workflow and source limits.");
