import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const path of ["index.html", "styles.css", "src", "data"]) {
  await cp(join(root, path), join(dist, path), { recursive: true });
}
await writeFile(join(dist, ".nojekyll"), "", "utf8");
console.log("Built static site in dist/");
