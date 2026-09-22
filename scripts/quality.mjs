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
const PBR_ASSET_FILES = [
  "wallpaper_color.png", "wallpaper_rough.png", "wallpaper_normal.png",
  "painted_wall_color.png", "painted_wall_rough.png", "painted_wall_normal.png",
  "carpet_color.png", "carpet_rough.png", "carpet_normal.png",
  "ceiling_tiles_color.png", "ceiling_tiles_rough.png", "ceiling_tiles_normal.png"
];
const REQUIRED_PBR_ASSETS = PBR_ASSET_FILES.map(name => OPEN_GAME_ART_PACK + name);

async function checkAssetSources() {
  const assetsPath = join(root, "src/assets.js");
  const buildPath = join(root, "scripts/build.mjs");
  const assetsSource = await readFile(assetsPath, "utf8");
  const buildSource = await readFile(buildPath, "utf8");

  if (!assetsSource.includes('new URL("../assets/pbr/", import.meta.url).href')) {
    fail("src/assets.js must use the locally bundled /assets/pbr runtime path");
  }
  if (!buildSource.includes('const OPEN_GAME_ART_PACK = "' + OPEN_GAME_ART_PACK + '";')) {
    fail("scripts/build.mjs must pin the OpenGameArt PBR pack base URL");
  }

  for (const filename of PBR_ASSET_FILES) {
    if (!assetsSource.includes('"' + filename + '"')) {
      fail("src/assets.js missing required local PBR map filename: " + filename);
    }
    if (!buildSource.includes('"' + filename + '"')) {
      fail("scripts/build.mjs missing required OpenGameArt download filename: " + filename);
    }
  }

  const dist = join(root, "dist");
  const manifestPath = join(dist, "assets", "pbr", "manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.source !== "https://opengameart.org/content/backrooms-pbr-texture-pack") {
      fail("dist PBR manifest has an unexpected source");
    }
    if (manifest.license !== "CC0") fail("dist PBR manifest must record CC0");
    if (manifest.author !== "methodical pixel") fail("dist PBR manifest must record methodical pixel");
    for (const filename of PBR_ASSET_FILES) {
      const entry = manifest.files?.[filename];
      if (!entry?.url?.startsWith(OPEN_GAME_ART_PACK)) fail("dist PBR manifest missing source URL: " + filename);
      if (!Number.isInteger(entry.bytes) || entry.bytes <= 0) fail("dist PBR manifest missing byte count: " + filename);
      if (!/^[a-f0-9]{64}$/.test(entry.sha256 || "")) fail("dist PBR manifest missing SHA-256: " + filename);
      const assetPath = join(dist, "assets", "pbr", filename);
      try {
        const data = await readFile(assetPath);
        if (data.length !== entry.bytes) fail("dist PBR asset byte count does not match manifest: " + filename);
        if (data.length < 8 || !data.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) {
          fail("dist PBR asset is not a PNG: " + filename);
        }
      } catch {
        fail("dist PBR asset missing: " + filename);
      }
    }
  } catch (e) {
    fail("dist PBR manifest invalid or missing: " + e.message);
  }
}
