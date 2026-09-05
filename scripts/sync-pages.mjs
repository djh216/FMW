import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "client/dist");

if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("Run npm run build first — client/dist/index.html not found.");
  process.exit(1);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function syncTo(targetRoot) {
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.copyFileSync(path.join(dist, "index.html"), path.join(targetRoot, "index.html"));

  const assetsDest = path.join(targetRoot, "assets");
  fs.rmSync(assetsDest, { recursive: true, force: true });
  copyDir(path.join(dist, "assets"), assetsDest);

  fs.writeFileSync(path.join(targetRoot, ".nojekyll"), "\n");
}

syncTo(root);
syncTo(path.join(root, "pages"));

console.log("Synced dashboard to index.html + assets/ (and pages/ for CI deploy)");
