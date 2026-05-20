/**
 * electron/search/searcher.js
 *
 * Pure AI semantic search — no manual synonym map.
 *   final_score = ALPHA * image_cosine + BETA * caption_cosine
 *
 * Ranking:
 *   - Results sorted by score (best first).
 *   - No fixed result cap — all genuinely relevant items show
 *     (important for large catalogs with many similar products).
 *   - Relative threshold drops clear junk: keeps results within
 *     RELATIVE_FLOOR of the top score. Adapts per-query since scores
 *     are relative, not absolute.
 */

const db = require('../db/database');
const clip = require('../clip/clipWorker');
const log = require('../utils/logger');

const ALPHA = 0.5;
const BETA  = 0.5;

// Keep results scoring at least this fraction of the top result.
const RELATIVE_FLOOR = 0.55;
// If even the best match is weaker than this, show nothing.
const ABSOLUTE_MIN   = 0.20;

let cache = null;
let cacheCount = 0;

function loadCache() {
  const rows = db.loadAllEmbeddings();
  const n = rows.length;
  if (n === 0) {
    cache = null; cacheCount = 0;
    log.info('Search cache: 0 embeddings');
    return null;
  }
  const dim = rows[0].embedding.length;
  const ids = new Int32Array(n);
  const paths = new Array(n);
  const filenames = new Array(n);
  const captions = new Array(n);
  const imgFlat = new Float32Array(n * dim);
  const capFlat = new Float32Array(n * dim);
  const hasCap = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const r = rows[i];
    ids[i] = r.id;
    paths[i] = r.path;
    filenames[i] = r.filename;
    captions[i] = r.caption;
    imgFlat.set(r.embedding, i * dim);
    if (r.captionEmbedding) {
      capFlat.set(r.captionEmbedding, i * dim);
      hasCap[i] = 1;
    }
  }

  cache = { ids, paths, filenames, captions, imgFlat, capFlat, hasCap, dim };
  cacheCount = n;
  log.info('Search cache: ' + n + ' embeddings, dim=' + dim);
  return cache;
}

function invalidateCache() { cache = null; cacheCount = 0; }

function scoreImages(queryVec) {
  if (!cache || cacheCount === 0) return new Float32Array(0);
  const { imgFlat, capFlat, hasCap, dim } = cache;
  const n = cacheCount;
  const scores = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const off = i * dim;
    let imgSim = 0, capSim = 0;
    for (let j = 0; j < dim; j++) {
      imgSim += queryVec[j] * imgFlat[off + j];
      if (hasCap[i]) capSim += queryVec[j] * capFlat[off + j];
    }
    scores[i] = hasCap[i] ? (ALPHA * imgSim + BETA * capSim) : imgSim;
  }
  return scores;
}

function rankResults(scores) {
  const { ids, paths, filenames, captions } = cache;
  const n = cacheCount;
  if (n === 0) return [];

  const indices = Array.from({ length: n }, (_, i) => i);
  indices.sort((a, b) => scores[b] - scores[a]);

  const best = scores[indices[0]];
  if (best < ABSOLUTE_MIN) return [];

  const cutoff = best * RELATIVE_FLOOR;
  const kept = indices.filter(idx => scores[idx] >= cutoff);

  return kept.map(idx => ({
    id: ids[idx],
    path: paths[idx],
    filename: filenames[idx],
    score: scores[idx],
    caption: captions[idx]
  }));
}

async function searchByText(query) {
  if (!query || !query.trim()) return [];
  if (!cache) loadCache();
  if (cacheCount === 0) return [];

  await clip.init();

  const t0 = Date.now();
  const queryVec = await clip.embedText(query);
  const embedMs = Date.now() - t0;

  const t1 = Date.now();
  const scores = scoreImages(queryVec);
  const results = rankResults(scores);
  const searchMs = Date.now() - t1;

  log.debug('Search "' + query + '": ' + results.length + ' results, embed=' + embedMs + 'ms, scan=' + searchMs + 'ms');
  return results;
}

async function searchBySimilarImage(imageId) {
  if (!cache) loadCache();
  if (cacheCount === 0) return [];
  let idx = -1;
  for (let i = 0; i < cache.ids.length; i++) {
    if (cache.ids[i] === imageId) { idx = i; break; }
  }
  if (idx === -1) return [];
  const dim = cache.dim;
  const queryVec = cache.imgFlat.subarray(idx * dim, (idx + 1) * dim);
  const scores = scoreImages(queryVec);
  const results = rankResults(scores);
  return results.filter(r => r.id !== imageId);
}

function getCacheStats() {
  return {
    loaded: cache !== null,
    count: cacheCount,
    memoryMB: cache ? (cacheCount * cache.dim * 4 * 2 / 1024 / 1024) : 0
  };
}

module.exports = { loadCache, invalidateCache, searchByText, searchBySimilarImage, getCacheStats };
