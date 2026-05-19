const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// SigLIP 2 base patch16-256 settings
const IMG_SIZE = 256;
const MEAN = [0.5, 0.5, 0.5];
const STD  = [0.5, 0.5, 0.5];

async function loadImageBuffer(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === '.heic' || ext === '.heif') {
    const heicConvert = require('heic-convert');
    const inputBuffer = await fs.promises.readFile(imagePath);
    return heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.92 });
  }
  return imagePath;
}

async function preprocessImage(imagePath) {
  const input = await loadImageBuffer(imagePath);

  const meta = await sharp(input).metadata();
  const origWidth = meta.width || 0;
  const origHeight = meta.height || 0;

  const { data, info } = await sharp(input)
    .resize(IMG_SIZE, IMG_SIZE, { fit: 'cover', position: 'center' })
    .removeAlpha()
    .toColorspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) throw new Error('Expected 3 channels, got ' + info.channels);
  if (info.width !== IMG_SIZE || info.height !== IMG_SIZE) throw new Error('Wrong size: ' + info.width + 'x' + info.height);
  if (data.length !== IMG_SIZE * IMG_SIZE * 3) throw new Error('Wrong byte count');

  const planeSize = IMG_SIZE * IMG_SIZE;
  const tensor = new Float32Array(3 * planeSize);

  for (let i = 0; i < planeSize; i++) {
    const r = data[i * 3]     / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    tensor[i]               = (r - MEAN[0]) / STD[0];
    tensor[i + planeSize]   = (g - MEAN[1]) / STD[1];
    tensor[i + planeSize*2] = (b - MEAN[2]) / STD[2];
  }

  return { tensor, width: origWidth, height: origHeight };
}

module.exports = { preprocessImage, IMG_SIZE };
