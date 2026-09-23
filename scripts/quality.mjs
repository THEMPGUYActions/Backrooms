import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, posix, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
  "pbr/concrete/concrete_color.png",
  "pbr/concrete/concrete_normal.png",
  "pbr/bricks/bricks_color.png",
  "pbr/crate/crate_color.png",
  "fluorescent_light.png",
  "wall_trim_texture.png",
  "newstairs_texture.png"
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
  for(const file of files.filter(file=>extname(file)===".js"||extname(file)===".mjs")){
    const source=await readFile(file,"utf8");
    for(const [token,message] of deprecated)if(source.includes(token))fail("Three.js API compatibility: "+file+": "+message);
  }
}

async function checkHtml() {
  const htmlPath = join(root, "index.html");
  const html = await readFile(htmlPath, "utf8");

  for (const required of ['id="game"', 'src="./src/main.js"', 'href="./styles.css"']) {
    if (!html.includes(required)) fail("index.html missing " + required);
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
  const manifestPath=join(root,"dist/assets/spb-ff/manifest.json");
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
      const assetPath=join(root,"dist/assets/spb-ff",filename);
      try{
        const data=await readFile(assetPath);
        const sha256=createHash("sha256").update(data).digest("hex");
        if(data.length!==entry.bytes||sha256!==entry.sha256)fail("SpacePotato asset checksum mismatch: "+filename);
        if(data.length<8||!data.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))fail("SpacePotato asset is not a PNG: "+filename);
      }catch{fail("SpacePotato asset missing: "+filename)}
    }
  }catch(e){fail("SpacePotato asset manifest invalid or missing: "+e.message)}
}

async function checkAudioAssets(){
  let lock;
  try{lock=JSON.parse(await readFile(join(root,"data/audio-assets-lock.json"),"utf8"))}catch(e){fail("data/audio-assets-lock.json is missing or invalid: "+e.message);return}
  if(lock.license!=="CC0")fail("Audio asset lock must use CC0");
  const entries=Object.entries(lock.files||{});
  if(entries.length<8)fail("Audio asset lock must contain at least eight assets");
  for(const [filename,entry] of entries){
    if(!/^[a-z0-9_-]+\.ogg$/.test(filename))fail("Audio asset filename is unexpected: "+filename);
    if(!entry?.url?.startsWith("https://opengameart.org/sites/default/files/"))fail("Audio asset source URL is unexpected: "+filename);
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
      if(!Number.isInteger(built.bytes)||built.bytes<=0||!/^[a-f0-9]{64}$/.test(built.sha256||""))fail("dist audio manifest checksum metadata invalid: "+filename);
    }
  }catch(e){fail("dist audio manifest invalid or missing: "+e.message)}
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
  } catch (e) {
    fail("src/levels.js could not be checked: " + e.message);
  }
}

async function checkBuildIfPresent() {
  const dist = join(root, "dist");
  try {
    await stat(dist);
  } catch {
    return;
  }

  for (const required of ["index.html", "styles.css", "favicon.svg", "sw.js", "src/main.js", "src/game.js", "src/assets.js", "data/levels.json", ".nojekyll"]) {
    await assertFile(join(dist, required), "dist build");
  }

  const distHtml = await readFile(join(dist, "index.html"), "utf8");
  if (!distHtml.includes('src="./src/main.js"')) fail("dist/index.html lost the main module reference");
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
await checkAssetSources();
await checkSpacePotatoAssets();
await checkAudioAssets();
await checkWorkflow();

for (const file of files) {
  const size = (await stat(file)).size;
  if (size > 2_000_000) fail("File exceeds 2 MB source budget: " + file);
}

if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log("QA PASS");
console.log("Checked " + jsFiles.length + " JavaScript/ESM files, HTML, CSS URLs, import-map resolution, build output, PBR assets, data consistency, deployment workflow and source limits.");
