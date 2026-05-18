/**
 * electron/clip/preprocessor.js
 *
 * Converts an image file on disk into a CLIP-ready Float32Array tensor.
 *
 * Pipeline (CLIP ViT-B/32 standard):
 *   1. Open image with sharp
 *   2. Resize shortest side to 224 (preserve aspect ratio)
 *   3. Center crop to exactly 224 x 224
 *   4. Convert to RGB (drop alpha)
 *   5. Extract raw uint8 pixels (HWC)
 *   6. Normalize: (pixel/255 - mean) / std  per channel
 *   7. Reorder HWC -> CHW
 *
 * Output: Float32Array of length 1 * 3 * 224 * 224 = 150528
 * Shape (logical): [batch=1, channels=3, height=224, width=224]
 */

const sharp = require('sharp');

const IMG_SIZE = 224;

// CLIP ViT-B/32 standard normalization values (from OpenAI's official preprocessing)
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD  = [0.26862954, 0.26130258, 0.27577711];

/**
 * Preprocess an image file at `imagePath` to a CLIP-ready tensor.
 *
 * @param {string} imagePath - Absolute path to .jpg/.png/.webp/.gif
 * @returns {Promise<{tensor: Float32Array, width: number, height: number}>}
 *   tensor: shape [1, 3, 224, 224], CHW order, normalized
 *   width/height: ORIGINAL image dimensions (for storing in DB)
 */
async function preprocessImage(imagePath) {
  // 1. Read original metadata for DB
  const meta = await sharp(imagePath).metadata();
  const origWidth = meta.width || 0;
  const origHeight = meta.height || 0;

  // 2. Resize shortest side to 224, then center crop to 224x224
  //    sharp's `cover` fit with `position: center` handles both in one step.
  // 3+4. Force RGB output (3 channels, no alpha)
  // 5. .raw() gives uint8 pixel array in HWC order (row-major)
  const { data, info } = await sharp(imagePath)
    .resize(IMG_SIZE, IMG_SIZE, { fit: 'cover', position: 'center' })
    .removeAlpha()
    .toColorspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Sanity check
  if (info.channels !== 3) {
    throw new Error(`Expected 3 channels after preprocessing, got ${info.channels} for ${imagePath}`);
  }
  if (info.width !== IMG_SIZE || info.height !== IMG_SIZE) {
    throw new Error(`Expected ${IMG_SIZE}x${IMG_SIZE}, got ${info.width}x${info.height}`);
  }
  if (data.length !== IMG_SIZE * IMG_SIZE * 3) {
    throw new Error(`Expected ${IMG_SIZE * IMG_SIZE * 3} bytes, got ${data.length}`);
  }

  // 6+7. Normalize and reorder HWC -> CHW into a single Float32Array.
  // Input  layout (HWC): [r0, g0, b0, r1, g1, b1, ...] (each pixel's RGB together)
  // Output layout (CHW): [all R values, all G values, all B values]
  const planeSize = IMG_SIZE * IMG_SIZE;
  const tensor = new Float32Array(3 * planeSize);

  for (let i = 0; i < planeSize; i++) {
    const r = data[i * 3]     / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;

    tensor[i]                = (r - MEAN[0]) / STD[0];  // R plane
    tensor[i + planeSize]    = (g - MEAN[1]) / STD[1];  // G plane
    tensor[i + planeSize*2]  = (b - MEAN[2]) / STD[2];  // B plane
  }

  return { tensor, width: origWidth, height: origHeight };
}

module.exports = {
  preprocessImage,
  IMG_SIZE
};
