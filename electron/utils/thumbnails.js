/**
 * electron/utils/thumbnails.js
 *
 * Generates and caches 200x200 JPEG thumbnails for indexed images.
 *
 * Strategy:
 *   - Cache lives at <userData>/thumbnails/<sha1(path)>.jpg
 *   - getThumbnailPath() returns the cached path, generating if missing
 *   - getThumbnailBuffer() returns the raw buffer (for protocol handler)
 *
 * Sharp handles resize + JPEG encoding in one pass — very fast.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { getUserDataDir } = require('./paths');

const THUMB_SIZE = 200;
const THUMB_QUALITY = 78; // JPEG quality

let thumbsDir = null;

function getThumbsDir() {
  if (!thumbsDir) {
    thumbsDir = path.join(getUserDataDir(), 'thumbnails');
    if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
  }
  return thumbsDir;
}

function thumbPathFor(imagePath) {
  const hash = crypto.createHash('sha256').update(imagePath).digest('hex');
  return path.join(getThumbsDir(), hash + '.jpg');
}

/**
 * Ensure a thumbnail exists for `imagePath`. Returns the thumbnail's path.
 * If the original file has been modified since the thumbnail was created,
 * the thumbnail is regenerated.
 */
async function ensureThumbnail(imagePath) {
  const tPath = thumbPathFor(imagePath);

  try {
    const [origStat, thumbStat] = await Promise.all([
      fs.promises.stat(imagePath),
      fs.promises.stat(tPath).catch(() => null)
    ]);

    if (thumbStat && thumbStat.mtimeMs >= origStat.mtimeMs) {
      return tPath; // up to date
    }

    await sharp(imagePath)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'center' })
      .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
      .toFile(tPath);

    return tPath;
  } catch (err) {
    // If original is missing or unreadable, propagate
    throw new Error(`Thumbnail generation failed for ${imagePath}: ${err.message}`);
  }
}

/**
 * Get raw thumbnail buffer. Used by the custom protocol handler.
 */
async function getThumbnailBuffer(imagePath) {
  const tPath = await ensureThumbnail(imagePath);
  return fs.promises.readFile(tPath);
}

/**
 * Delete thumbnail for an image (e.g. when image is removed from DB).
 */
function deleteThumbnail(imagePath) {
  const tPath = thumbPathFor(imagePath);
  fs.promises.unlink(tPath).catch(() => {});
}

module.exports = {
  ensureThumbnail,
  getThumbnailBuffer,
  deleteThumbnail,
  thumbPathFor,
  THUMB_SIZE
};
