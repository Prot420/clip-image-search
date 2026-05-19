/**
 * electron/search/searcher.js
 *
 * Combined ranking with query expansion:
 *   final_score = max over query variants of
 *     [α * image_cosine + β * caption_cosine]
 *
 * Query expansion adds business-domain synonyms so that "trivet" also
 * matches "wooden mat", "shaker" matches "shakers", etc. — covering
 * vocabulary gaps between user terms and Florence-2 caption wording.
 */

const db = require('../db/database');
const clip = require('../clip/clipWorker');
const log = require('../utils/logger');

const ALPHA = 0.5;
const BETA  = 0.5;

// Business-domain synonym expansion.
// Each key triggers additional sub-queries during search.
// All sub-queries scored, MAX score wins per image.
const SYNONYMS = {
  'trivet':       ['wooden mat', 'flower pattern wood', 'wooden coaster pattern'],
  'caddy':        ['basket', 'holder', 'storage basket'],
  'grinder':      ['pepper mill', 'salt mill', 'mill'],
  'grinders':     ['pepper mills', 'mills'],
  'shaker':       ['shakers', 'dispenser', 'salt shaker'],
  'shakers':      ['shaker', 'dispensers'],
  'mortar':       ['wooden bowl', 'pounding bowl'],
  'pestle':       ['mallet', 'pounder'],
  'cheese board': ['cutting board', 'serving board', 'wooden board'],
  'platter':      ['tray', 'serving tray', 'board'],
  'dome':         ['glass cover', 'cheese cover'],
  'planks':       ['cutting boards', 'wooden boards'],
  'boards':       ['planks', 'wooden boards']
};

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

/**
 * Expand query into variants using synonym map.
 * Returns: [originalQuery, expansion1, expansion2, ...]
 */
function expandQuery(query) {
  const variants = [query];
  const lower = query.toLowerCase();
  for (const [key, synonyms] of Object.entries(SYNONYMS)) {
    if (lower.includes(key)) {
      for (const syn of synonyms) {
        const variant = lower.replace(key, syn);
        if (!variants.includes(variant)) variants.push(variant);
      }
    }
  }
  return variants;
}

function scoreImages(queryVecs) {
  if (!cache || cacheCount === 0) return [];
  const { imgFlat, capFlat, hasCap, dim } = cache;
  const n = cacheCount;

  const scores = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const off = i * dim;
    let bestScore = -Infinity;

    for (const queryVec of queryVecs) {
      let imgSim = 0, capSim = 0;
      for (let j = 0; j < dim; j++) {
        imgSim += queryVec[j] * imgFlat[off + j];
        if (hasCap[i]) capSim += queryVec[j] * capFlat[off + j];
      }
      const score = hasCap[i] ? (ALPHA * imgSim + BETA * capSim) : imgSim;
      if (score > bestScore) bestScore = score;
    }

    scores[i] = bestScore;
  }

  return scores;
}

function topK(scores, k) {
  const { ids, paths, filenames, captions } = cache;
  const n = cacheCount;
  const indices = Array.from({ length: n }, (_, i) => i);
  indices.sort((a, b) => scores[b] - scores[a]);
  const top = indices.slice(0, k);
  return top.map(idx => ({
    id: ids[idx],
    path: paths[idx],
    filename: filenames[idx],
    score: scores[idx],
    caption: captions[idx]
  }));
}

async function searchByText(query, limit = 24) {
  if (!query || !query.trim()) return [];
  if (!cache) loadCache();
  if (cacheCount === 0) return [];

  await clip.init();

  const variants = expandQuery(query);

  const t0 = Date.now();
  const queryVecs = [];
  for (const v of variants) {
    const vec = await clip.embedText(v);
    queryVecs.push(vec);
  }
  const embedMs = Date.now() - t0;

  const t1 = Date.now();
  const scores = scoreImages(queryVecs);
  const results = topK(scores, Math.min(limit, cacheCount));
  const searchMs = Date.now() - t1;

  log.debug('Search "' + query + '" (' + variants.length + ' variants): embed=' + embedMs + 'ms, scan=' + searchMs + 'ms');
  return results;
}

async function searchBySimilarImage(imageId, limit = 24) {
  if (!cache) loadCache();
  if (cacheCount === 0) return [];
  let idx = -1;
  for (let i = 0; i < cache.ids.length; i++) if (cache.ids[i] === imageId) { idx = i; break; }
  if (idx === -1) return [];
  const dim = cache.dim;
  const queryVec = cache.imgFlat.subarray(idx * dim, (idx + 1) * dim);
  const scores = scoreImages([queryVec]);
  const results = topK(scores, Math.min(limit + 1, cacheCount));
  return results.filter(r => r.id !== imageId).slice(0, limit);
}

function getCacheStats() {
  return { loaded: cache !== null, count: cacheCount, memoryMB: cache ? (cacheCount * cache.dim * 4 * 2 / 1024 / 1024) : 0 };
}

module.exports = { loadCache, invalidateCache, searchByText, searchBySimilarImage, getCacheStats };
