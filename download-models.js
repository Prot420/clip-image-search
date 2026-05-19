const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const MODELS_DIR = path.join(__dirname, 'resources', 'models');

const SIGLIP2_BASE = 'https://huggingface.co/onnx-community/siglip2-base-patch16-256-ONNX/resolve/main';
const FLORENCE2_BASE = 'https://huggingface.co/onnx-community/Florence-2-base/resolve/main';

const FILES = [
  // SigLIP 2 (existing - already downloaded, will skip)
  { name: 'vision_model.onnx',         url: SIGLIP2_BASE + '/onnx/vision_model_quantized.onnx', expectedMinSize: 30 * 1024 * 1024 },
  { name: 'text_model.onnx',           url: SIGLIP2_BASE + '/onnx/text_model_quantized.onnx',   expectedMinSize: 30 * 1024 * 1024 },
  { name: 'tokenizer.json',            url: SIGLIP2_BASE + '/tokenizer.json',                   expectedMinSize: 100 * 1024 },
  { name: 'tokenizer_config.json',     url: SIGLIP2_BASE + '/tokenizer_config.json',            expectedMinSize: 50 },
  { name: 'special_tokens_map.json',   url: SIGLIP2_BASE + '/special_tokens_map.json',          expectedMinSize: 30 },
  { name: 'preprocessor_config.json',  url: SIGLIP2_BASE + '/preprocessor_config.json',         expectedMinSize: 50 },
  { name: 'config.json',               url: SIGLIP2_BASE + '/config.json',                      expectedMinSize: 100 },

  // Florence-2 base (NEW)
  { name: 'florence_vision_encoder.onnx',   url: FLORENCE2_BASE + '/onnx/vision_encoder_fp16.onnx',     expectedMinSize: 100 * 1024 * 1024 },
  { name: 'florence_embed_tokens.onnx',     url: FLORENCE2_BASE + '/onnx/embed_tokens_fp16.onnx',       expectedMinSize: 50 * 1024 * 1024 },
  { name: 'florence_encoder.onnx',          url: FLORENCE2_BASE + '/onnx/encoder_model_q4.onnx',        expectedMinSize: 20 * 1024 * 1024 },
  { name: 'florence_decoder.onnx',          url: FLORENCE2_BASE + '/onnx/decoder_model_merged_q4.onnx', expectedMinSize: 50 * 1024 * 1024 },
  { name: 'florence_tokenizer.json',        url: FLORENCE2_BASE + '/tokenizer.json',                    expectedMinSize: 500 * 1024 },
  { name: 'florence_tokenizer_config.json', url: FLORENCE2_BASE + '/tokenizer_config.json',             expectedMinSize: 100 },
  { name: 'florence_config.json',           url: FLORENCE2_BASE + '/config.json',                       expectedMinSize: 500 },
  { name: 'florence_generation_config.json',url: FLORENCE2_BASE + '/generation_config.json',            expectedMinSize: 50 },
  { name: 'florence_preprocessor_config.json',url: FLORENCE2_BASE + '/preprocessor_config.json',        expectedMinSize: 50 },
  { name: 'florence_vocab.json',            url: FLORENCE2_BASE + '/vocab.json',                        expectedMinSize: 100 * 1024 },
  { name: 'florence_merges.txt',            url: FLORENCE2_BASE + '/merges.txt',                        expectedMinSize: 100 * 1024 }
];

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  return (b/1024/1024).toFixed(1) + ' MB';
}

function resolveRedirect(currentUrl, location) {
  try { return new URL(location).href; }
  catch { return new URL(location, currentUrl).href; }
}

function downloadFile(startUrl, destPath, fileName) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    let downloaded = 0, total = 0, lastLogged = -10, redirects = 0;

    const request = (url) => {
      if (redirects > 5) { file.close(); fs.unlink(destPath, () => {}); return reject(new Error('Too many redirects')); }
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirects++;
          const next = resolveRedirect(url, res.headers.location);
          res.destroy();
          return request(next);
        }
        if (res.statusCode !== 200) { file.close(); fs.unlink(destPath, () => {}); return reject(new Error('HTTP ' + res.statusCode)); }
        total = parseInt(res.headers['content-length'] || '0', 10);
        process.stdout.write('  Downloading ' + fileName + ' (' + formatBytes(total) + ')... ');
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = Math.floor((downloaded / total) * 100);
            if (pct >= lastLogged + 10) { process.stdout.write(pct + '% '); lastLogged = pct; }
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => { process.stdout.write('done\n'); resolve(); }));
        file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
      }).on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
    };
    request(startUrl);
  });
}

async function main() {
  console.log('SigLIP 2 + Florence-2 Model Downloader\n');
  if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

  for (const f of FILES) {
    const dest = path.join(MODELS_DIR, f.name);
    if (fs.existsSync(dest)) {
      const sz = fs.statSync(dest).size;
      if (sz >= f.expectedMinSize) { console.log('  ' + f.name + ' exists (' + formatBytes(sz) + ') — skip'); continue; }
      fs.unlinkSync(dest);
    }
    try {
      await downloadFile(f.url, dest, f.name);
      const sz = fs.statSync(dest).size;
      if (sz < f.expectedMinSize) throw new Error('File too small: ' + formatBytes(sz));
    } catch (err) {
      console.error('FAILED ' + f.name + ': ' + err.message);
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      process.exit(1);
    }
  }

  console.log('\nFiles ready:');
  let total = 0;
  for (const f of FILES) {
    const sz = fs.statSync(path.join(MODELS_DIR, f.name)).size;
    total += sz;
    console.log('  ' + f.name.padEnd(40) + formatBytes(sz));
  }
  console.log('  ' + '-'.repeat(55));
  console.log('  ' + 'Total'.padEnd(40) + formatBytes(total));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
