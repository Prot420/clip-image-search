const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif',
  '.avif', '.heic', '.heif', '.svg', '.jp2', '.jpx'
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '$RECYCLE.BIN', 'System Volume Information'
]);

function isImageFile(name) {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

async function scanFolder(rootPath) {
  const results = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch { continue; }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isImageFile(entry.name)) continue;

      try {
        const stat = await fs.promises.stat(fullPath);
        results.push({
          path: fullPath,
          filename: entry.name,
          size: stat.size,
          mtime: stat.mtimeMs
        });
      } catch {}
    }
  }
  return results;
}

module.exports = { scanFolder, isImageFile, IMAGE_EXTENSIONS };
