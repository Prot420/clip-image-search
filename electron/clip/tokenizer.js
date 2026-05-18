/**
 * electron/clip/tokenizer.js
 *
 * Loads the CLIP tokenizer (BPE) from tokenizer.json and converts
 * natural language text queries into token IDs that the CLIP text
 * encoder expects.
 *
 * CLIP text encoder input:
 *   - input_ids:      int64 tensor, shape [1, 77]   (padded/truncated to 77)
 *   - attention_mask: int64 tensor, shape [1, 77]   (1 for real tokens, 0 for padding)
 *
 * Uses @huggingface/transformers for tokenizer only (no model inference).
 */

const path = require('path');
const fs = require('fs');
const { getModelsDir } = require('../utils/paths');

const MAX_LENGTH = 77; // CLIP fixed sequence length

let tokenizer = null;

/**
 * Lazy-load the tokenizer on first use. Heavy import; only do it once.
 */
async function loadTokenizer() {
  if (tokenizer) return tokenizer;

  const { AutoTokenizer, env } = await import('@huggingface/transformers');

  // Tell transformers.js to load from local files only — no network access.
  env.allowRemoteModels = false;
  env.allowLocalModels  = true;
  env.localModelPath    = path.dirname(getModelsDir()); // -> resources/

  // The library expects a folder containing tokenizer.json.
  // Our tokenizer.json is in resources/models/, but AutoTokenizer wants
  // a "model id" relative to localModelPath. So we pass 'models'.
  const modelId = path.basename(getModelsDir()); // 'models'

  // Sanity check: file must exist
  const tokenizerPath = path.join(getModelsDir(), 'tokenizer.json');
  if (!fs.existsSync(tokenizerPath)) {
    throw new Error(`tokenizer.json not found at ${tokenizerPath}. Run: npm run download-models`);
  }

  tokenizer = await AutoTokenizer.from_pretrained(modelId);
  return tokenizer;
}

/**
 * Tokenize a text query into CLIP-ready tensors.
 *
 * @param {string} text - natural language query, e.g. "a wooden bowl"
 * @returns {Promise<{inputIds: BigInt64Array, attentionMask: BigInt64Array}>}
 *   Both arrays are length MAX_LENGTH (77), suitable for ONNX int64 tensors.
 */
async function tokenize(text) {
  const tok = await loadTokenizer();

  const encoded = await tok(text, {
    padding: 'max_length',
    truncation: true,
    max_length: MAX_LENGTH,
    return_tensors: 'np' // returns objects with .data (TypedArray) and .dims
  });

  // encoded.input_ids and encoded.attention_mask are Tensor objects.
  // Their .data is typically BigInt64Array; if not, convert.
  const inputIdsData       = encoded.input_ids.data;
  const attentionMaskData  = encoded.attention_mask.data;

  const toBigInt64 = (arr) => {
    if (arr instanceof BigInt64Array) return arr;
    const out = new BigInt64Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = BigInt(arr[i]);
    return out;
  };

  return {
    inputIds:      toBigInt64(inputIdsData),
    attentionMask: toBigInt64(attentionMaskData)
  };
}

module.exports = {
  loadTokenizer,
  tokenize,
  MAX_LENGTH
};
