/**
 * electron/search/searcher.js
 *
 * Hybrid search: SigLIP visual similarity + caption keyword matching.
 *
 * Why hybrid: SigLIP is trained on long sentences, so short queries
 * ("wooden bowl") produce a narrow band of cosine scores that can't
 * separate hits from junk on their own. Florence-2 has already written
 * a descriptive caption for every image; matching the query's words
 * against that caption is a strong, reliable signal that works well
 * for short queries — and gives near-zero score to things not in the
 * catalogue ("car tyre").
 *
 * final_score = visual_cosine  *  keyword_boost
 *   keyword_boost: all query words in caption -> large boost
 *                  some words                 -> medium boost
 *                  no words                   -> small (visual-only fallback)
 */

const db = require('../db/database');
const clip = require('../clip/clipWorker');
const log = require('../utils/logger');
const { categoryFromQuery } = require('../clip/categorize');

// Keyword boost: proportional to how many query words match the caption.
// boost = 1 + KEYWORD_WEIGHT * (matched / total). A smooth curve avoids a
// cliff where one all-words match drops every partial match below cutoff.
// No query word in caption -> image is dropped entirely (boost = 0).

// Keep results scoring at least this fraction of the top result.
const RELATIVE_FLOOR = 0.55;

// How strongly keyword matches influence the score.
const KEYWORD_WEIGHT = 4.0;

// Common words ignored during keyword matching (no discriminative value).
const STOPWORDS = new Set([
  'a','an','the','of','with','and','or','for','in','on','to','is','it',
  'this','that','some','any','my','your','at','by','as'
]);

let cache = null;
let cacheCount = 0;

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

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
  const captionWords = new Array(n);   // pre-tokenized caption for keyword match
  const categories = new Array(n);     // optional product category per image
  const imgFlat = new Float32Array(n * dim);

  for (let i = 0; i < n; i++) {
    const r = rows[i];
    ids[i] = r.id;
    paths[i] = r.path;
    filenames[i] = r.filename;
    captions[i] = r.caption || '';
    captionWords[i] = new Set(tokenize(r.caption));
    categories[i] = r.category || null;
    imgFlat.set(r.embedding, i * dim);
  }

  // Inverse document frequency: words in many captions are weak signals
  // (e.g. "wooden"), rare words are strong (e.g. "spoon", "marble").
  const docFreq = new Map();
  for (let i = 0; i < n; i++) {
    for (const w of captionWords[i]) {
      docFreq.set(w, (docFreq.get(w) || 0) + 1);
    }
  }
  const idf = new Map();
  for (const [w, df] of docFreq) {
    idf.set(w, Math.log(1 + n / df));
  }

  cache = { ids, paths, filenames, captions, captionWords, categories, imgFlat, dim, idf };
  cacheCount = n;
  log.info('Search cache: ' + n + ' embeddings, dim=' + dim);
  return cache;
}

function invalidateCache() { cache = null; cacheCount = 0; }

/**
 * Visual cosine similarity between query vector and every image embedding.
 */
function visualScores(queryVec) {
  const { imgFlat, dim } = cache;
  const n = cacheCount;
  const scores = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * dim;
    let s = 0;
    for (let j = 0; j < dim; j++) s += queryVec[j] * imgFlat[off + j];
    scores[i] = s;
  }
  return scores;
}

/**
 * Keyword boost for one image, given the set of query words.
 */
function keywordBoost(queryWords, captionWordSet) {
  if (queryWords.length === 0) return 1.0; // no keywords -> neutral

  const idf = cache.idf;
  let matchedWeight = 0;
  let totalWeight = 0;
  let anyMatch = false;

  for (const w of queryWords) {
    const weight = idf.get(w) || Math.log(1 + cacheCount); // unknown word = rare
    totalWeight += weight;
    if (captionWordSet.has(w)) {
      matchedWeight += weight;
      anyMatch = true;
    }
  }

  if (!anyMatch) return 0;  // no query word in caption -> drop
  // Boost by the fraction of *important* words matched (IDF-weighted).
  return 1 + KEYWORD_WEIGHT * (matchedWeight / totalWeight);
}

function rankResults(queryVec, queryWords, filterCategory) {
  const n = cacheCount;
  if (n === 0) return [];

  const { ids, paths, filenames, captions, captionWords, categories } = cache;
  const vis = visualScores(queryVec);

  // Combine: visual cosine * keyword boost.
  const combined = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    combined[i] = vis[i] * keywordBoost(queryWords, captionWords[i]);
  }

  let indices = Array.from({ length: n }, (_, i) => i);

  // Drop images with no keyword match at all (combined score 0).
  indices = indices.filter(idx => combined[idx] > 0);
  if (indices.length === 0) return [];

  indices.sort((a, b) => combined[b] - combined[a]);

  const best = combined[indices[0]];

  // Keep results within RELATIVE_FLOOR of the top combined score.
  const cutoff = best * RELATIVE_FLOOR;
  let kept = indices.filter(idx => combined[idx] >= cutoff);

  // Optional category filter — applied ONLY when the query named a
  // category. Narrows an already-ranked list; never changes scoring.
  // If filtering would remove everything, the unfiltered list stands.
  if (filterCategory) {
    const filtered = kept.filter(idx => categories[idx] === filterCategory);
    if (filtered.length > 0) kept = filtered;
  }

  return kept.map(idx => ({
    id: ids[idx],
    path: paths[idx],
    filename: filenames[idx],
    score: combined[idx] / best,   // normalised 0..1 for display
    caption: captions[idx],
    category: categories[idx] || null
  }));
}

async function searchByText(query) {
  if (!query || !query.trim()) return [];
  if (!cache) loadCache();
  if (cacheCount === 0) return [];

  await clip.init();

  const t0 = Date.now();
  const queryVec = await clip.embedText(query);
  const queryWords = tokenize(query);
  const embedMs = Date.now() - t0;

  const t1 = Date.now();
  const filterCategory = categoryFromQuery(query);
  const results = rankResults(queryVec, queryWords, filterCategory);
  const searchMs = Date.now() - t1;

  log.debug('Search "' + query + '" [' + queryWords.join(',') + ']: '
    + results.length + ' results, embed=' + embedMs + 'ms, scan=' + searchMs + 'ms');
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
  // Image-to-image: pure visual, no keywords.
  const results = rankResults(queryVec, []);
  return results.filter(r => r.id !== imageId);
}

function getCacheStats() {
  return {
    loaded: cache !== null,
    count: cacheCount,
    memoryMB: cache ? (cacheCount * cache.dim * 4 / 1024 / 1024) : 0
  };
}

module.exports = { loadCache, invalidateCache, searchByText, searchBySimilarImage, getCacheStats };
