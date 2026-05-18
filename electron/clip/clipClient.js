/**
 * electron/clip/clipClient.js
 *
 * Main-thread proxy for the CLIP worker.
 *
 * Spawns clipWorkerThread.js in a Node worker thread, sends inference
 * requests via postMessage, and returns Promises that resolve when the
 * worker posts back the result.
 */

const path = require('path');
const { Worker } = require('worker_threads');
const { getModelsDir } = require('../utils/paths');

let worker = null;
let ready = false;
let readyPromise = null;
let intentionalShutdown = false;
const pending = new Map();
let nextId = 1;

function startWorker() {
  if (worker) return readyPromise;

  const workerScript = path.join(__dirname, 'clipWorkerThread.js');

  worker = new Worker(workerScript, {
    workerData: { modelsDir: getModelsDir() }
  });

  readyPromise = new Promise((resolve, reject) => {
    const onMessage = (msg) => {
      if (msg.id === '__ready__') {
        ready = true;
        worker.off('message', onMessage);
        resolve();
        return;
      }
    };
    worker.on('message', onMessage);
    worker.once('error', reject);
  });

  worker.on('message', (msg) => {
    if (msg.id === '__ready__') return;
    const handler = pending.get(msg.id);
    if (!handler) return;
    pending.delete(msg.id);
    if (msg.ok) handler.resolve(msg.result);
    else        handler.reject(new Error(msg.error));
  });

  worker.on('error', (err) => {
    if (intentionalShutdown) return; // ignore errors during shutdown
    console.error('[clipClient] Worker error:', err);
    for (const [, h] of pending) h.reject(err);
    pending.clear();
    worker = null;
    ready = false;
    readyPromise = null;
  });

  worker.on('exit', (code) => {
    // Suppress logging for intentional shutdown (close() was called)
    if (!intentionalShutdown && code !== 0) {
      console.error(`[clipClient] Worker exited unexpectedly with code ${code}`);
    }
    worker = null;
    ready = false;
    readyPromise = null;
    intentionalShutdown = false;
  });

  return readyPromise;
}

function send(type, payload) {
  return new Promise((resolve, reject) => {
    if (!worker) return reject(new Error('Worker not started — call init() first'));
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}

async function init() {
  await startWorker();
  return send('init', {});
}

async function embedImage(imagePath) {
  if (!ready) await init();
  return send('embedImage', { path: imagePath });
}

async function embedText(text) {
  if (!ready) await init();
  return send('embedText', { text });
}

/**
 * Graceful shutdown. Sends 'close' to worker, then terminates.
 * Safe to call multiple times.
 */
async function close() {
  if (!worker) return;
  intentionalShutdown = true;
  try {
    await send('close', {});
  } catch {
    // ignore — worker may have died mid-shutdown
  }
  try {
    await worker.terminate();
  } catch {
    // ignore
  }
  worker = null;
  ready = false;
  readyPromise = null;
}

module.exports = {
  init,
  embedImage,
  embedText,
  close,
  EMBED_DIM: 512
};
