const path = require('path');
const fs = require('fs');
const { getModelsDir } = require('../utils/paths');

const MAX_LENGTH = 64;

let tokenizer = null;

async function loadTokenizer() {
  if (tokenizer) return tokenizer;

  const { AutoTokenizer, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels  = true;
  env.localModelPath    = path.dirname(getModelsDir());

  const modelId = path.basename(getModelsDir()); // 'models'

  const tokenizerPath = path.join(getModelsDir(), 'tokenizer.json');
  if (!fs.existsSync(tokenizerPath)) {
    throw new Error('tokenizer.json not found. Run: npm run download-models');
  }

  tokenizer = await AutoTokenizer.from_pretrained(modelId);
  return tokenizer;
}

async function tokenize(text) {
  const tok = await loadTokenizer();

  // SigLIP 2 standard: prefix with "This is a photo of"
  const formatted = 'This is a photo of ' + text + '.';

  const encoded = await tok(formatted, {
    padding: 'max_length',
    truncation: true,
    max_length: MAX_LENGTH,
    return_tensors: 'np'
  });

  const inputIdsData = encoded.input_ids.data;

  const toBigInt64 = (arr) => {
    if (arr instanceof BigInt64Array) return arr;
    const out = new BigInt64Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = BigInt(arr[i]);
    return out;
  };

  return { inputIds: toBigInt64(inputIdsData) };
}

module.exports = { loadTokenizer, tokenize, MAX_LENGTH };
