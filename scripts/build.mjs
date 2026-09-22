import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const pbrDir = join(dist, "assets", "pbr");
const OPEN_GAME_ART_PACK = "https://opengameart.org/sites/default/files/oga-textures/175228/";

const PBR_FILES = [
  "wallpaper_color.png", "wallpaper_rough.png", "wallpaper_normal.png",
  "painted_wall_color.png", "painted_wall_rough.png", "painted_wall_normal.png",
  "carpet_color.png", "carpet_rough.png", "carpet_normal.png",
  "ceiling_tiles_color.png", "ceiling_tiles_rough.png", "ceiling_tiles_normal.png"
];

const PNG_SIGNATURE = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const MAX_ASSET_BYTES = 6 * 1024 * 1024;

async function downloadPbrAsset(filename) {
  const url = OPEN_GAME_ART_PACK + filename;
  const response = await fetch(url, {
    headers: {
      "Accept": "image/png",
      "User-Agent": "THEMPGUY-Backrooms-build/1.0"
    }
  });
  if (!response.ok) {
    throw new Error("OpenGameArt download failed for " + filename + ": HTTP " + response.status);
  }

  const data = Buffer.from(await response.arrayBuffer());
  if (data.length < PNG_SIGNATURE.length || !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Downloaded asset is not a valid PNG: " + filename);
  }
  if (data.length > MAX_ASSET_BYTES) {
    throw new Error("Downloaded asset exceeds build size limit: " + filename);
  }

  const sha256 = createHash("sha256").update(data).digest("hex");
  await writeFile(join(pbrDir, filename), data);
  return { url, bytes: data.length, sha256 };
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await mkdir(pbrDir, { recursive: true });

for (const path of ["index.html", "styles.css", "src", "data"]) {
  await cp(join(root, path), join(dist, path), { recursive: true });
}

const manifest = {
  pack: "Backrooms PBR texture pack",
  author: "methodical pixel",
  source: "https://opengameart.org/content/backrooms-pbr-texture-pack",
  license: "CC0",
  files: {}
};

for (const filename of PBR_FILES) {
  manifest.files[filename] = await downloadPbrAsset(filename);
}

await writeFile(join(pbrDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "
", "utf8");
await writeFile(join(dist, ".nojekyll"), "", "utf8");

const manifestSize = (await stat(join(pbrDir, "manifest.json"))).size;
console.log("Downloaded " + PBR_FILES.length + " CC0 OpenGameArt PBR maps into dist/assets/pbr/.");
console.log("PBR manifest size: " + manifestSize + " bytes.");
console.log("Built static site in dist/");
