/**
 * electron/clip/captioner.js
 *
 * Florence-2 base captioning module — open-vocabulary attribute extraction.
 *
 * Staging strategy: Florence-2 expects a specific directory structure.
 * Our `florence_*` prefixed files live in resources/models/. We create
 * a staging directory at userData/florence_staging/ that maps to the
 * expected structure. Only recreate if missing/corrupt; otherwise reuse.
 */

const path = require('path');
const fs = require('fs');
const { getModelsDir, getUserDataDir } = require('../utils/paths');

// Worker threads can't resolve process.resourcesPath. Allow explicit override.
let explicitModelsDir = null;
function setModelsDir(dir) { explicitModelsDir = dir; }
function resolveModelsDir() { return explicitModelsDir || getModelsDir(); }

const TASK_DETAILED = '<MORE_DETAILED_CAPTION>';
const TASK_SHORT = '<CAPTION>';
const MAX_NEW_TOKENS_DETAILED = 100;
const MAX_NEW_TOKENS_SHORT = 30;

const FILE_MAPPING = {
  'florence_config.json':              'config.json',
  'florence_generation_config.json':   'generation_config.json',
  'florence_tokenizer.json':           'tokenizer.json',
  'florence_tokenizer_config.json':    'tokenizer_config.json',
  'florence_preprocessor_config.json': 'preprocessor_config.json',
  'florence_vocab.json':               'vocab.json',
  'florence_merges.txt':               'merges.txt',
  'florence_vision_encoder.onnx':      'onnx/vision_encoder_fp16.onnx',
  'florence_embed_tokens.onnx':        'onnx/embed_tokens_fp16.onnx',
  'florence_encoder.onnx':             'onnx/encoder_model_q4.onnx',
  'florence_decoder.onnx':             'onnx/decoder_model_merged_q4.onnx'
};

let tf = null;
let model = null;
let processor = null;
let tokenizer = null;
let stagingDir = null;

function isStagingValid(staging) {
  // Quick check: all expected destination files exist with non-zero size
  for (const dst of Object.values(FILE_MAPPING)) {
    const p = path.join(staging, dst);
    try {
      const st = fs.statSync(p);
      if (st.size === 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function prepareStagingDir() {
  if (stagingDir && isStagingValid(stagingDir)) return stagingDir;

  const modelsDir = resolveModelsDir();
  const staging = path.join(getUserDataDir(), 'florence_staging');

  // If exists and valid, reuse (no delete!)
  if (fs.existsSync(staging) && isStagingValid(staging)) {
    stagingDir = staging;
    return staging;
  }

  // Otherwise rebuild
  if (fs.existsSync(staging)) {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(path.join(staging, 'onnx'), { recursive: true });

  for (const [src, dst] of Object.entries(FILE_MAPPING)) {
    const srcPath = path.join(modelsDir, src);
    const dstPath = path.join(staging, dst);
    if (!fs.existsSync(srcPath)) {
      throw new Error('Missing Florence-2 file: ' + srcPath + ' — run: npm run download-models');
    }
    // Symlink on Unix, copy on Windows (admin needed for Windows symlinks)
    if (process.platform === 'win32') {
      fs.copyFileSync(srcPath, dstPath);
    } else {
      try {
        fs.symlinkSync(srcPath, dstPath);
      } catch (err) {
        // Fallback to copy if symlink fails
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }

  stagingDir = staging;
  return staging;
}

async function init() {
  if (model && processor && tokenizer) return;

  if (!tf) {
    tf = await import('@huggingface/transformers');
    tf.env.allowRemoteModels = false;
    tf.env.allowLocalModels = true;
  }

  const staging = prepareStagingDir();
  tf.env.localModelPath = path.dirname(staging) + path.sep;
  const modelId = path.basename(staging);

  model = await tf.Florence2ForConditionalGeneration.from_pretrained(modelId, {
    dtype: {
      embed_tokens: 'fp16',
      vision_encoder: 'fp16',
      encoder_model: 'q4',
      decoder_model_merged: 'q4'
    }
  });
  processor = await tf.AutoProcessor.from_pretrained(modelId);
  tokenizer = await tf.AutoTokenizer.from_pretrained(modelId);
}

async function generateCaption(imagePath, task, maxTokens) {
  if (!model) await init();

  const image = await tf.RawImage.read(imagePath);
  const visionInputs = await processor(image);

  const prompts = processor.construct_prompts(task);
  const textInputs = tokenizer(prompts);

  const generated_ids = await model.generate({
    ...textInputs,
    ...visionInputs,
    max_new_tokens: maxTokens
  });

  const generated_text = tokenizer.batch_decode(generated_ids, {
    skip_special_tokens: false
  })[0];

  const result = processor.post_process_generation(generated_text, task, image.size);
  return (result[task] || '').trim();
}

/**
 * STEP 2 IMPROVEMENT: dual captions for better vocabulary coverage.
 * Detailed caption + short caption use alag wording → wider search match.
 */
async function captionImage(imagePath) {
  const detailed = await generateCaption(imagePath, TASK_DETAILED, MAX_NEW_TOKENS_DETAILED);
  const short = await generateCaption(imagePath, TASK_SHORT, MAX_NEW_TOKENS_SHORT);

  // Combine — short caption often has different vocabulary (e.g. "planks" vs "boards")
  const combined = (short + '. ' + detailed).trim();
  return combined;
}

async function close() {
  model = null;
  processor = null;
  tokenizer = null;
}

module.exports = { init, captionImage, close, setModelsDir };
