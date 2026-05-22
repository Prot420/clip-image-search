/**
 * electron/clip/categorize.js
 *
 * Assigns a single product category to an image, derived from its
 * Florence-2 caption text. Used by the indexer; the search code does
 * not depend on this — category is an optional filter layer.
 *
 * English-only: the business and its captions are all in English.
 * To add a new category later: add one entry to CATEGORY_KEYWORDS
 * and CATEGORY_ORDER. No schema change, no other code change required.
 */

// Each category maps to the words that identify it in a caption.
// Keywords are matched as whole words (not substrings) to avoid
// false hits like "panel" matching "pan".
const CATEGORY_KEYWORDS = {
  'mortar':        ['mortar', 'pestle'],
  'knife-block':   ['knife block', 'knife holder'],
  'cheese-server': ['cheese knife', 'cheese server', 'cheese set'],
  'wine-opener':   ['wine opener', 'corkscrew', 'bottle opener'],
  'wine-rack':     ['wine rack', 'bottle rack'],
  'cloche':        ['cloche', 'glass dome', 'cake dome'],
  'grinder':       ['grinder', 'pepper mill', 'salt mill',
                    'salt and pepper', 'pepper shaker', 'salt shaker'],
  'caddy':         ['caddy', 'cutlery holder'],
  'coaster':       ['coaster', 'coasters'],
  'board':         ['cutting board', 'chopping board', 'cheese board',
                    'serving board', 'bread board', 'board'],
  'tray':          ['tray', 'trays', 'platter', 'lazy susan'],
  'bowl':          ['bowl', 'bowls'],
  'plate':         ['plate', 'plates'],
  'pan':           ['frying pan', 'skillet', 'saucepan'],
  'spoon':         ['spoon', 'spoons', 'spatula', 'ladle', 'scoop'],
  'jar':           ['jar', 'jars', 'canister'],
  'grater':        ['grater', 'zester']
};

// Categories are tested in this order; first match wins.
// More specific categories must come before broad ones.
const CATEGORY_ORDER = [
  'mortar', 'knife-block', 'cheese-server', 'wine-opener', 'wine-rack',
  'cloche', 'grinder', 'grater', 'caddy', 'coaster', 'board', 'tray',
  'bowl', 'plate', 'pan', 'spoon', 'jar'
];

/**
 * Whole-word (or whole-phrase) test. Avoids "pan" matching "panel"
 * or "board" matching "boards" incorrectly — plurals are listed
 * explicitly in the keyword lists above.
 */
function containsWord(text, keyword) {
  // Build a boundary-aware regex; escape nothing special here since
  // keywords are plain letters/spaces.
  const re = new RegExp('(^|[^a-z])' + keyword + '([^a-z]|$)');
  return re.test(text);
}

/**
 * Returns a category string for the given caption, or null if none matched.
 */
function categorize(caption) {
  if (!caption || typeof caption !== 'string') return null;
  const text = caption.toLowerCase();

  for (const cat of CATEGORY_ORDER) {
    for (const kw of CATEGORY_KEYWORDS[cat]) {
      if (containsWord(text, kw)) return cat;
    }
  }
  return null;  // uncategorised — still fully searchable, just no tag
}

/**
 * Given a free-text query, return a category if the query names one,
 * else null. Search uses this as an optional filter — never forced.
 */
function categoryFromQuery(query) {
  if (!query || typeof query !== 'string') return null;
  const words = query.toLowerCase().split(/\s+/);
  for (const w of words) {
    if (CATEGORY_ORDER.includes(w)) return w;
    // also match plural / singular against the category's own keywords
    for (const cat of CATEGORY_ORDER) {
      if (CATEGORY_KEYWORDS[cat].includes(w)) return cat;
    }
  }
  return null;
}

module.exports = { categorize, categoryFromQuery, CATEGORY_ORDER, CATEGORY_KEYWORDS };
