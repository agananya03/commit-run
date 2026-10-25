const fs = require("fs");
const path = require("path");

const sharedMocksDir = path.resolve(__dirname, "../../shared/mocks");
const publicMocksDir = path.resolve(__dirname, "../public/mocks");
const publicMocksLocalDir = path.resolve(__dirname, "../public/mocks-local");

const sharedTypesFile = path.resolve(__dirname, "../../shared/schemas/types.ts");
const targetTypesDir = path.resolve(__dirname, "../src/types");
const targetTypesFile = path.resolve(targetTypesDir, "shared.ts");

console.log("=== Starting sync-mocks ===");

// 1. Sync shared mocks to public/mocks
if (fs.existsSync(sharedMocksDir)) {
  if (!fs.existsSync(publicMocksDir)) {
    fs.mkdirSync(publicMocksDir, { recursive: true });
  }

  const files = fs.readdirSync(sharedMocksDir);
  let count = 0;
  for (const file of files) {
    const srcPath = path.join(sharedMocksDir, file);
    const dstPath = path.join(publicMocksDir, file);
    const stat = fs.statSync(srcPath);
    if (stat.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
      count++;
    }
  }
  console.log(`[sync-mocks] Synced ${count} mock file(s) to public/mocks.`);
} else {
  console.warn(`[sync-mocks] Shared mocks directory not found: ${sharedMocksDir}`);
}

// 2. Ensure public/mocks-local directory exists for local mock extensions
if (!fs.existsSync(publicMocksLocalDir)) {
  fs.mkdirSync(publicMocksLocalDir, { recursive: true });
  console.log(`[sync-mocks] Created directory public/mocks-local.`);
}

// 3. Copy ../../shared/schemas/types.ts to ../src/types/shared.ts
if (fs.existsSync(sharedTypesFile)) {
  if (!fs.existsSync(targetTypesDir)) {
    fs.mkdirSync(targetTypesDir, { recursive: true });
  }
  fs.copyFileSync(sharedTypesFile, targetTypesFile);
  console.log(`[sync-mocks] Copied ${sharedTypesFile} -> ${targetTypesFile}`);
}

// 4. Ensure chunks.json is generated
const generateChunksScript = path.resolve(__dirname, "generate-chunks.js");
if (fs.existsSync(generateChunksScript)) {
  require(generateChunksScript);
}

console.log("=== sync-mocks completed successfully ===");
