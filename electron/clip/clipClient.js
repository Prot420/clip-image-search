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
      }
    };
    worker.on('message', onMessage);
    worker.once('error', reject);
  });

  worker.on('message', (msg) => {
    if (msg.id === '__ready__') return;
    const h = pending.get(msg.id);
    if (!h) return;
    pending.delete(msg.id);
    if (msg.ok) h.resolve(msg.result);
    else        h.reject(new Error(msg.error));
  });

  worker.on('error', (err) => {
    if (intentionalShutdown) return;
    console.error('[clipClient] Worker error:', err);
    for (const [, h] of pending) h.reject(err);
    pending.clear();
    worker = null; ready = false; readyPromise = null;
  });

  worker.on('exit', (code) => {
    if (!intentionalShutdown && code !== 0) {
      console.error('[clipClient] Worker exited unexpectedly:', code);
    }
    worker = null; ready = false; readyPromise = null; intentionalShutdown = false;
  });

  return readyPromise;
}

function send(type, payload) {
  return new Promise((resolve, reject) => {
    if (!worker) return reject(new Error('Worker not started'));
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}

async function init() { await startWorker(); return send('init', {}); }
async function embedImage(imagePath) { if (!ready) await init(); return send('embedImage', { path: imagePath }); }
async function embedText(text) { if (!ready) await init(); return send('embedText', { text }); }
async function captionAndEmbed(imagePath) { if (!ready) await init(); return send('captionAndEmbed', { path: imagePath }); }

async function close() {
  if (!worker) return;
  intentionalShutdown = true;
  try { await send('close', {}); } catch {}
  try { await worker.terminate(); } catch {}
  worker = null; ready = false; readyPromise = null;
}

module.exports = {
  init,
  embedImage,
  embedText,
  captionAndEmbed,
  close,
  EMBED_DIM: 768
};
