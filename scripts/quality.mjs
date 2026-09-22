import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const failures = [];

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

const files = await walk(root);
const jsFiles = files.filter(f => extname(f)===".js");
for (const file of jsFiles) {
  try { await exec(process.execPath, ["--check", file]); }
  catch (e) { failures.push("JS syntax: "+file+"\n"+(e.stderr||e.message)); }
}

try {
  const html = await readFile(join(root,"index.html"),"utf8");
  for (const required of ['id="game"', 'src="./src/main.js"', 'href="./styles.css"']) {
    if (!html.includes(required)) failures.push("index.html missing "+required);
  }
} catch (e) { failures.push("index.html could not be read: "+e.message); }

try {
  const levels = JSON.parse(await readFile(join(root,"data/levels.json"),"utf8"));
  if (!Array.isArray(levels) || levels.length < 3) failures.push("levels.json must describe at least three levels");
  for (const level of levels) {
    for (const key of ["id","number","name","source","license"]) {
      if (!level[key]) failures.push("levels.json entry missing "+key);
    }
  }
} catch (e) { failures.push("levels.json invalid: "+e.message); }

for (const file of files) {
  const s = await stat(file);
  if (s.size > 2_000_000) failures.push("File exceeds 2 MB source budget: "+file);
}

if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log("QA PASS");
console.log("Checked "+jsFiles.length+" JavaScript files and repository source limits.");
