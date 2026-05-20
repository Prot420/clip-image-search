const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const ort = require('onnxruntime-node');

if (!parentPort) throw new Error('Must run as worker thread');

const { modelsDir } = workerData;
const EMBED_DIM = 768;

let visionSession = null;
let textSession = null;
let closing = false;

const { preprocessImage } = require('./preprocessor');
const { tokenize, MAX_LENGTH } = require('./tokenizer');
const captioner = require('./captioner');
captioner.setModelsDir(modelsDir);

function l2Normalize(vec) {
  let s = 0; for (let i = 0; i < vec.length; i++) s += vec[i] * vec[i];
  const n = Math.sqrt(s);
  if (n > 0) for (let i = 0; i < vec.length; i++) vec[i] /= n;
  return vec;
}

async function init() {
  if (visionSession && textSession) return { alreadyLoaded: true };

  const visionPath = path.join(modelsDir, 'vision_model.onnx');
  const textPath = path.join(modelsDir, 'text_model.onnx');
  for (const p of [visionPath, textPath]) {
    if (!fs.existsSync(p)) throw new Error('Missing model: ' + p);
  }

  const sessionOptions = {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3
  };

  visionSession = await ort.InferenceSession.create(visionPath, sessionOptions);
  textSession   = await ort.InferenceSession.create(textPath,   sessionOptions);

  return {
    alreadyLoaded: false,
    visionInputs: visionSession.inputNames,
    visionOutputs: visionSession.outputNames,
    textInputs: textSession.inputNames,
    textOutputs: textSession.outputNames
  };
}

async function embedImage(imagePath) {
  if (closing) throw new Error('Worker is closing');
  if (!visionSession) await init();
  const { tensor, width, height } = await preprocessImage(imagePath);
  const inputTensor = new ort.Tensor('float32', tensor, [1, 3, 256, 256]);
  const feeds = { [visionSession.inputNames[0]]: inputTensor };
  const results = await visionSession.run(feeds);
  const raw = results['image_embeds'] || results['pooler_output'] || results[visionSession.outputNames[0]];
  if (!raw) throw new Error('No vision output');
  if (raw.data.length !== EMBED_DIM) throw new Error('Wrong dim: ' + raw.data.length);
  const embedding = new Float32Array(raw.data);
  l2Normalize(embedding);
  return { embedding, width, height };
}

async function embedText(text) {
  if (closing) throw new Error('Worker is closing');
  if (!textSession) await init();
  const { inputIds } = await tokenize(text);
  const inputIdsTensor = new ort.Tensor('int64', inputIds, [1, MAX_LENGTH]);
  const feeds = {};
  for (const name of textSession.inputNames) {
    if (name === 'input_ids') feeds[name] = inputIdsTensor;
  }
  const results = await textSession.run(feeds);
  const raw = results['text_embeds'] || results['pooler_output'] || results[textSession.outputNames[0]];
  if (!raw) throw new Error('No text output');
  const embedding = new Float32Array(raw.data);
  l2Normalize(embedding);
  return embedding;
}

/**
 * Caption an image with Florence-2, then embed the caption with SigLIP 2 text encoder.
 * Returns: { embedding (vision), caption (text), captionEmbedding (text), width, height }
 */
async function captionAndEmbed(imagePath) {
  if (closing) throw new Error('Worker is closing');

  let visionEmb, width, height, caption, captionEmbedding;

  // STAGE 1: SigLIP 2 image embedding
  try {
    const r = await embedImage(imagePath);
    visionEmb = r.embedding; width = r.width; height = r.height;
  } catch (e) {
    throw new Error('STAGE1_EMBED_IMAGE failed: ' + e.message + ' | stack: ' + (e.stack || 'none'));
  }

  // STAGE 2: Florence-2 caption
  try {
    caption = await captioner.captionImage(imagePath);
  } catch (e) {
    throw new Error('STAGE2_CAPTION failed: ' + e.message + ' | stack: ' + (e.stack || 'none'));
  }

  // STAGE 3: caption -> SigLIP 2 text embedding
  try {
    captionEmbedding = await embedText(caption);
  } catch (e) {
    throw new Error('STAGE3_EMBED_TEXT failed: ' + e.message + ' | stack: ' + (e.stack || 'none'));
  }

  return { embedding: visionEmb, caption, captionEmbedding, width, height };
}

async function close() {
  closing = true;
  const errors = [];
  if (visionSession) { try { await visionSession.release(); } catch (e) { errors.push(e.message); } visionSession = null; }
  if (textSession)   { try { await textSession.release();   } catch (e) { errors.push(e.message); } textSession   = null; }
  await captioner.close();
  return { closed: true, errors };
}

parentPort.on('message', async (msg) => {
  const { id, type, payload } = msg;
  try {
    let result;
    switch (type) {
      case 'init':            result = await init(); break;
      case 'embedImage':      result = await embedImage(payload.path); break;
      case 'embedText':       result = await embedText(payload.text); break;
      case 'captionAndEmbed': result = await captionAndEmbed(payload.path); break;
      case 'close':           result = await close(); break;
      default: throw new Error('Unknown type: ' + type);
    }
    parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message, stack: err.stack });
  }
});

parentPort.postMessage({ id: '__ready__', ok: true, result: { ready: true } });
