/**
 * electron/search/searcher.js
 *
 * Semantic search engine.
 *
 * Strategy: load ALL embeddings into memory once, then for each query
 * compute cosine similarity (= dot product, since vectors are L2-normalized)
 * against every image. Sort, return top-K.
 *
 * For 100k images x 512 dims:
 *   - RAM: ~200 MB
 *   - Search time: 100-400 ms per query (single-threaded JS dot product)
 *
 * Cache invalidated whenever indexer adds/removes images.
 */

const db = require('../db/database');
const clip = require('../clip/clipWorker');
const log = require('../utils/logger');

let cache = null;        // { ids: Int32Array, paths: string[], filenames: string[], embeddings: Float32Array (flat) }
let cacheCount = 0;

/**
 * Load all embeddings from DB into a flat Float32Array for fast scanning.
 * Single contiguous buffer = best cache locality, ~3-5x faster than array of arrays.
 */
function loadCache() {
  const rows = db.loadAllEmbeddings();
  const n = rows.length;
  const dim = 512;

  const ids       = new Int32Array(n);
  const paths     = new Array(n);
  const filenames = new Array(n);
  const flat      = new Float32Array(n * dim);

  for (let i = 0; i < n; i++) {
    const r = rows[i];
    ids[i]       = r.id;
    paths[i]     = r.path;
    filenames[i] = r.filename;
    flat.set(r.embedding, i * dim);
  }

  cache = { ids, paths, filenames, embeddings: flat, dim };
  cacheCount = n;
  log.info(`Search cache loaded: ${n} embeddings (${(n * dim * 4 / 1024 / 1024).toFixed(1)} MB)`);
  return cache;
}

function invalidateCache() {
  cache = null;
  cacheCount = 0;
}

/**
 * Brute-force top-K cosine similarity.
 * Vectors are pre-normalized so cosine = dot product.
 */
function topK(queryVec, k) {
  if (!cache || cacheCount === 0) return [];

  const { ids, paths, filenames, embeddings, dim } = cache;
  const n = cacheCount;

  // Maintain a min-heap of size K via a simple sorted insert
  // (For K ~20-100 and N ~100k, simple sorted array is faster than full heap.)
  const topScores = new Float32Array(k);
  const topIdx    = new Int32Array(k);
  for (let i = 0; i < k; i++) { topScores[i] = -Infinity; topIdx[i] = -1; }
  let minScore = -Infinity;
  let minPos = 0;

  for (let i = 0; i < n; i++) {
    let dot = 0;
    const off = i * dim;
    for (let j = 0; j < dim; j++) dot += queryVec[j] * embeddings[off + j];

    if (dot > minScore) {
      topScores[minPos] = dot;
      topIdx[minPos]    = i;
      // Find new min in topScores
      minScore = topScores[0];
      minPos = 0;
      for (let p = 1; p < k; p++) {
        if (topScores[p] < minScore) { minScore = topScores[p]; minPos = p; }
      }
    }
  }

  // Build sorted results (descending score)
  const pairs = [];
  for (let i = 0; i < k; i++) {
    if (topIdx[i] !== -1) pairs.push({ idx: topIdx[i], score: topScores[i] });
  }
  pairs.sort((a, b) => b.score - a.score);

  return pairs.map(p => ({
    id:       ids[p.idx],
    path:     paths[p.idx],
    filename: filenames[p.idx],
    score:    p.score
  }));
}

/**
 * Search by natural language text.
 *
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<{id, path, filename, score}>>}
 */
async function searchByText(query, limit = 24) {
  if (!query || !query.trim()) return [];
  if (!cache) loadCache();
  if (cacheCount === 0) return [];

  await clip.init();
  const t0 = Date.now();
  const queryVec = await clip.embedText(query);
  const embedMs = Date.now() - t0;

  const t1 = Date.now();
  const results = topK(queryVec, Math.min(limit, cacheCount));
  const searchMs = Date.now() - t1;

  log.debug(`Search "${query}": embed=${embedMs}ms, scan=${searchMs}ms, results=${results.length}`);
  return results;
}

/**
 * Search by similar image (using existing image's embedding).
 *
 * @param {number} imageId
 * @param {number} limit
 */
async function searchBySimilarImage(imageId, limit = 24) {
  if (!cache) loadCache();
  if (cacheCount === 0) return [];

  // Find the embedding in cache
  const idx = cache.ids.indexOf(imageId);
  if (idx === -1) {
    log.warn(`searchBySimilarImage: image ${imageId} not in cache`);
    return [];
  }

  const dim = cache.dim;
  const queryVec = cache.embeddings.subarray(idx * dim, (idx + 1) * dim);
  const results = topK(queryVec, Math.min(limit + 1, cacheCount));
  // Exclude the query image itself
  return results.filter(r => r.id !== imageId).slice(0, limit);
}

function getCacheStats() {
  return {
    loaded: cache !== null,
    count: cacheCount,
    memoryMB: cache ? (cacheCount * cache.dim * 4 / 1024 / 1024) : 0
  };
}

module.exports = {
  loadCache,
  invalidateCache,
  searchByText,
  searchBySimilarImage,
  getCacheStats
};
