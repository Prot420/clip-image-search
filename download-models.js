/**
 * download-models.js
 *
 * One-time script to download CLIP ONNX model files + tokenizer files
 * from Hugging Face. Files are saved to resources/models/ and bundled
 * into the .exe at build time.
 *
 * Run: npm run download-models
 *
 * Source: Xenova/clip-vit-base-patch32
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const MODELS_DIR = path.join(__dirname, 'resources', 'models');

const FILES = [
  {
    name: 'clip-vision-q.onnx',
    url: 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx',
    expectedMinSize: 30 * 1024 * 1024
  },
  {
    name: 'clip-text-q.onnx',
    url: 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model_quantized.onnx',
    expectedMinSize: 30 * 1024 * 1024
  },
  {
    name: 'tokenizer.json',
    url: 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/tokenizer.json',
    expectedMinSize: 500 * 1024
  },
  {
    name: 'tokenizer_config.json',
    url: 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/tokenizer_config.json',
    expectedMinSize: 100   // tiny file
  },
  {
    name: 'special_tokens_map.json',
    url: 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/special_tokens_map.json',
    expectedMinSize: 50
  },
  {
    name: 'vocab.json',
    url: 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/vocab.json',
    expectedMinSize: 100 * 1024
  },
  {
    name: 'merges.txt',
    url: 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/merges.txt',
    expectedMinSize: 100 * 1024
  }
];

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function resolveRedirect(currentUrl, location) {
  try { return new URL(location).href; }
  catch { return new URL(location, currentUrl).href; }
}

function downloadFile(startUrl, destPath, fileName) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    let downloaded = 0;
    let total = 0;
    let lastLoggedPct = -10;
    let redirectCount = 0;
    const MAX_REDIRECTS = 5;

    const request = (currentUrl) => {
      if (redirectCount > MAX_REDIRECTS) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`Too many redirects (>${MAX_REDIRECTS})`));
      }

      https.get(currentUrl, (response) => {
        const status = response.statusCode;

        if (status >= 300 && status < 400 && response.headers.location) {
          redirectCount++;
          const nextUrl = resolveRedirect(currentUrl, response.headers.location);
          response.destroy();
          return request(nextUrl);
        }

        if (status !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          return reject(new Error(`HTTP ${status} for ${currentUrl}`));
        }

        total = parseInt(response.headers['content-length'] || '0', 10);
        process.stdout.write(`  Downloading ${fileName} (${formatBytes(total)})... `);

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = Math.floor((downloaded / total) * 100);
            if (pct >= lastLoggedPct + 10) {
              process.stdout.write(`${pct}% `);
              lastLoggedPct = pct;
            }
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close(() => {
            process.stdout.write('done\n');
            resolve();
          });
        });

        file.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }).on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    };

    request(startUrl);
  });
}

async function main() {
  console.log('CLIP Model Downloader');
  console.log('=====================');
  console.log(`Target directory: ${MODELS_DIR}\n`);

  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }

  for (const f of FILES) {
    const destPath = path.join(MODELS_DIR, f.name);

    if (fs.existsSync(destPath)) {
      const size = fs.statSync(destPath).size;
      if (size >= f.expectedMinSize) {
        console.log(`  ${f.name} already exists (${formatBytes(size)}) — skipping`);
        continue;
      } else {
        console.log(`  ${f.name} exists but too small (${formatBytes(size)}) — re-downloading`);
        fs.unlinkSync(destPath);
      }
    }

    try {
      await downloadFile(f.url, destPath, f.name);
      const size = fs.statSync(destPath).size;
      if (size < f.expectedMinSize) {
        throw new Error(`Downloaded file too small: ${formatBytes(size)} (expected >= ${formatBytes(f.expectedMinSize)})`);
      }
    } catch (err) {
      console.error(`\n  FAILED to download ${f.name}: ${err.message}`);
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      process.exit(1);
    }
  }

  console.log('\nAll files ready:');
  let total = 0;
  for (const f of FILES) {
    const p = path.join(MODELS_DIR, f.name);
    const size = fs.statSync(p).size;
    total += size;
    console.log(`  ${f.name.padEnd(28)} ${formatBytes(size)}`);
  }
  console.log(`  ${'-'.repeat(45)}`);
  console.log(`  ${'Total'.padEnd(28)} ${formatBytes(total)}`);
  console.log('\nDone. Models ready for indexing.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
