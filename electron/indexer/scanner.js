/**
 * electron/indexer/scanner.js
 *
 * Recursively scans a folder for image files. Returns metadata only —
 * does NOT open or embed them (that's the indexer's job).
 *
 * Skips hidden files/folders and node_modules-like junk.
 */

const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '$RECYCLE.BIN', 'System Volume Information'
]);

function isImageFile(name) {
  const ext = path.extname(name).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Recursively scan a folder and return image file metadata.
 *
 * @param {string} rootPath - absolute folder path
 * @returns {Promise<Array<{path: string, filename: string, size: number, mtime: number}>>}
 */
async function scanFolder(rootPath) {
  const results = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      // Permission denied / vanished folder — skip silently
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip hidden / known junk
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
      } catch {
        // File vanished mid-scan — skip
      }
    }
  }

  return results;
}

module.exports = {
  scanFolder,
  isImageFile,
  IMAGE_EXTENSIONS
};
