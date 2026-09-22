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
  return /^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(value);
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
  const staticRe = /\\b(?:import\\s+(?:(?:[\\s\\S]*?)\\s+from\\s+)?|export\\s+(?:\\{[\\s\\S]*?\\}|\\*)\\s+from\\s+)["']([^"']+)["']/g;
  for (const match of source.matchAll(staticRe)) specs.push({ specifier: match[1], kind: "static" });
  const dynamicRe = /\\bimport\\(\\s*["']([^"']+)["']\\s*\\)/g;
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
      fail("JS syntax: " + file + "\\n" + (e.stderr || e.message));
    }
  }
}

async function checkHtml() {
  const htmlPath = join(root, "index.html");
  const html = await readFile(htmlPath, "utf8");

  for (const required of ['id="game"', 'src="./src/main.js"', 'href="./styles.css"']) {
    if (!html.includes(required)) fail("index.html missing " + required);
  }

  const idCounts = new Map();
  for (const match of html.matchAll(/\\bid=["']([^"']+)["']/g)) {
    idCounts.set(match[1], (idCounts.get(match[1]) || 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) fail("index.html has duplicate id: " + id);
  }

  const mapMatches = [...html.matchAll(/<script\\b[^>]*type=["']importmap["'][^>]*>([\\s\\S]*?)<\\/script>/gi)];
  const firstModuleScript = html.search(/<script\\b[^>]*type=["']module["']/i);
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
  for (const match of css.matchAll(/url\\(\\s*["']?([^)"']+)["']?\\s*\\)/gi)) {
    const value = stripQueryHash(match[1].trim());
    if (!value || value.startsWith("data:") || value.startsWith("#") || /^https?:\\/\\//i.test(value)) continue;
    await assertFile(resolve(root, value.replace(/^\\.\\//, "")), "CSS local URL");
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
    const sourceUrls = [...levelJs.matchAll(/sourceUrl:\\s*["']([^"']+)["']/g)].map(match => match[1]);
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

  for (const required of ["index.html", "styles.css", "src/main.js", "src/game.js", "src/assets.js", "data/levels.json", ".nojekyll"]) {
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
      "branches:\\n      - main\\n      - dev",
      "npm run check",
      "npm run build",
      "publish_branch: gh-pages",
      "github_token: \${{ secrets.GITHUB_TOKEN }}",
      "github.ref == 'refs/heads/main'",
      "github.ref == 'refs/heads/dev'",
      "destination_dir: dev"
    ];
    for (const rule of required) {
      if (!workflow.includes(rule)) fail("workflow missing required QA/deployment rule: " + rule.replace(/\\n/g, " / "));
    }
  } catch (e) {
    fail("workflow could not be read: " + e.message);
  }
}

const files = await walk(root);
const jsFiles = files.filter(file => extname(file) === ".js" || extname(file) === ".mjs");

await checkJavaScript(files);
const { imports } = await checkHtml();
await checkCss();
await checkModuleGraph(jsFiles, imports);
await checkData();
await checkBuildIfPresent();
await checkWorkflow();

for (const file of files) {
  const size = (await stat(file)).size;
  if (size > 2_000_000) fail("File exceeds 2 MB source budget: " + file);
}

if (failures.length) {
  console.error(failures.join("\\n\\n"));
  process.exit(1);
}

console.log("QA PASS");
console.log("Checked " + jsFiles.length + " JavaScript/ESM files, HTML, CSS URLs, import-map resolution, data, deployment workflow and source limits.");
