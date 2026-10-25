const fs = require("fs");
const path = require("path");

const sourceDir = path.resolve(__dirname, "../../shared/mocks");
const targetDir = path.resolve(__dirname, "../public/mocks");

console.log(`Syncing mocks from ${sourceDir} to ${targetDir}...`);

if (!fs.existsSync(sourceDir)) {
  console.error(`Source directory does not exist: ${sourceDir}`);
  process.exit(1);
}

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const files = fs.readdirSync(sourceDir);
let count = 0;

for (const file of files) {
  const srcPath = path.join(sourceDir, file);
  const dstPath = path.join(targetDir, file);

  const stat = fs.statSync(srcPath);
  if (stat.isFile()) {
    fs.copyFileSync(srcPath, dstPath);
    count++;
  }
}

console.log(`Successfully synced ${count} mock file(s) to public/mocks.`);
