/**
 * electron/clip/clipWorkerThread.js
 *
 * RUNS INSIDE A NODE WORKER THREAD. Spawned by clipClient.js.
 *
 * Message protocol (parent <-> this worker):
 *   request:  { id, type: 'init' | 'embedImage' | 'embedText' | 'close', payload }
 *   response: { id, ok: boolean, result?: any, error?: string }
 */

const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const ort = require('onnxruntime-node');

if (!parentPort) {
  throw new Error('clipWorkerThread.js must be run as a worker thread');
}

const { modelsDir } = workerData;

const EMBED_DIM = 512;
let visionSession = null;
let textSession   = null;
let closing       = false;

const { preprocessImage } = require('./preprocessor');
const { tokenize, MAX_LENGTH } = require('./tokenizer');

function l2Normalize(vec) {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  return vec;
}

async function init() {
  if (visionSession && textSession) return { alreadyLoaded: true };

  const visionPath = path.join(modelsDir, 'clip-vision-q.onnx');
  const textPath   = path.join(modelsDir, 'clip-text-q.onnx');

  for (const p of [visionPath, textPath]) {
    if (!fs.existsSync(p)) throw new Error(`Missing model: ${p}`);
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
    visionInputs:  visionSession.inputNames,
    visionOutputs: visionSession.outputNames,
    textInputs:    textSession.inputNames,
    textOutputs:   textSession.outputNames
  };
}

async function embedImage(imagePath) {
  if (closing) throw new Error('Worker is closing');
  if (!visionSession) await init();
  const { tensor, width, height } = await preprocessImage(imagePath);

  const inputTensor = new ort.Tensor('float32', tensor, [1, 3, 224, 224]);
  const inputName = visionSession.inputNames[0];
  const feeds = { [inputName]: inputTensor };

  const results = await visionSession.run(feeds);
  const outputName = visionSession.outputNames[0];
  const raw = results[outputName];

  if (raw.data.length !== EMBED_DIM) {
    throw new Error(`Expected ${EMBED_DIM}-dim image embedding, got ${raw.data.length}`);
  }

  const embedding = new Float32Array(raw.data);
  l2Normalize(embedding);
  return { embedding, width, height };
}

async function embedText(text) {
  if (closing) throw new Error('Worker is closing');
  if (!textSession) await init();
  const { inputIds, attentionMask } = await tokenize(text);

  const inputIdsTensor = new ort.Tensor('int64', inputIds, [1, MAX_LENGTH]);
  const attentionMaskTensor = new ort.Tensor('int64', attentionMask, [1, MAX_LENGTH]);

  const feeds = {};
  for (const name of textSession.inputNames) {
    if (name === 'input_ids') feeds[name] = inputIdsTensor;
    else if (name === 'attention_mask') feeds[name] = attentionMaskTensor;
    else throw new Error(`Unexpected text model input: ${name}`);
  }

  const results = await textSession.run(feeds);
  const outputName = textSession.outputNames[0];
  const raw = results[outputName];

  if (raw.data.length !== EMBED_DIM) {
    throw new Error(`Expected ${EMBED_DIM}-dim text embedding, got ${raw.data.length}`);
  }

  const embedding = new Float32Array(raw.data);
  l2Normalize(embedding);
  return embedding;
}

/**
 * Graceful shutdown. Wraps session release in try/catch so that
 * shutdown never throws back to the parent. The parent will terminate
 * the worker after receiving the 'close' ack — at which point the
 * worker exits with code 0.
 */
async function close() {
  closing = true;
  const errors = [];
  if (visionSession) {
    try { await visionSession.release(); } catch (e) { errors.push('vision: ' + e.message); }
    visionSession = null;
  }
  if (textSession) {
    try { await textSession.release(); } catch (e) { errors.push('text: ' + e.message); }
    textSession = null;
  }
  return { closed: true, errors };
}

// ---------- Message handler ----------

parentPort.on('message', async (msg) => {
  const { id, type, payload } = msg;
  try {
    let result;
    switch (type) {
      case 'init':       result = await init(); break;
      case 'embedImage': result = await embedImage(payload.path); break;
      case 'embedText':  result = await embedText(payload.text); break;
      case 'close':      result = await close(); break;
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
    parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message, stack: err.stack });
  }
});

parentPort.postMessage({ id: '__ready__', ok: true, result: { ready: true } });
