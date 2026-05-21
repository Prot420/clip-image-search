/**
 * electron/clip/categorize.js
 *
 * Assigns a single product category to an image, derived from its
 * Florence-2 caption text. Used by the indexer; the search code does
 * not depend on this — category is an optional filter layer.
 *
 * To add a new category later: add one entry to CATEGORY_KEYWORDS.
 * No schema change, no other code change required.
 */

// Each category maps to the English words that identify it in a caption.
// Order matters slightly: more specific categories are checked first.
const CATEGORY_KEYWORDS = {
  'mortar':        ['mortar', 'pestle'],
  'knife-block':   ['knife block', 'knife holder', 'knife stand'],
  'cheese-server': ['cheese knife', 'cheese server', 'cheese set', 'cheese tool'],
  'wine-opener':   ['wine opener', 'corkscrew', 'bottle opener'],
  'wine-rack':     ['wine rack', 'bottle rack', 'wine holder'],
  'cloche':        ['cloche', 'dome', 'cake stand', 'glass dome'],
  'grinder':       ['grinder', 'mill', 'salt and pepper', 'pepper mill'],
  'caddy':         ['caddy', 'organizer', 'organiser', 'cutlery holder'],
  'coaster':       ['coaster'],
  'board':         ['cutting board', 'chopping board', 'cheese board',
                    'serving board', 'bread board', 'board'],
  'tray':          ['tray', 'platter', 'lazy susan', 'turntable'],
  'bowl':          ['bowl'],
  'plate':         ['plate', 'dish'],
  'pan':           ['pan', 'skillet', 'frying pan', 'cookware'],
  'spoon':         ['spoon', 'scoop', 'ladle', 'spatula'],
  'jar':           ['jar', 'canister', 'container'],
  'stand':         ['stand', 'riser', 'rack', 'holder']
};

// Categories are tested in this order; first match wins.
const CATEGORY_ORDER = [
  'mortar', 'knife-block', 'cheese-server', 'wine-opener', 'wine-rack',
  'cloche', 'grinder', 'caddy', 'coaster', 'board', 'tray',
  'bowl', 'plate', 'pan', 'spoon', 'jar', 'stand'
];

/**
 * Returns a category string for the given caption, or null if none matched.
 * Matching is plain case-insensitive substring search on the caption.
 */
function categorize(caption) {
  if (!caption || typeof caption !== 'string') return null;
  const text = caption.toLowerCase();

  for (const cat of CATEGORY_ORDER) {
    const keywords = CATEGORY_KEYWORDS[cat];
    for (const kw of keywords) {
      if (text.includes(kw)) return cat;
    }
  }
  return null;  // uncategorised — still fully searchable, just no category tag
}

/**
 * Hindi (and common alternate) names mapped to an English category.
 * Used at SEARCH time: if a user types "katori", the query is mapped
 * to the "bowl" category. Small and fixed — easy to extend later.
 */
const CATEGORY_ALIASES = {
  'katori':  'bowl',
  'katora':  'bowl',
  'thali':   'plate',
  'plate':   'plate',
  'chakla':  'board',
  'patta':   'board',
  'tray':    'tray',
  'thali-tray': 'tray',
  'chamach': 'spoon',
  'chammach':'spoon',
  'karchi':  'spoon',
  'martban': 'jar',
  'jaar':    'jar',
  'okhli':   'mortar',
  'imamdasta':'mortar',
  'kadhai':  'pan',
  'tawa':    'pan'
};

/**
 * Given a free-text query, return a category if the query contains a
 * known alias or category word, else null. Search uses this to offer
 * an optional category filter — it never forces results.
 */
function categoryFromQuery(query) {
  if (!query || typeof query !== 'string') return null;
  const words = query.toLowerCase().split(/\s+/);
  for (const w of words) {
    if (CATEGORY_ALIASES[w]) return CATEGORY_ALIASES[w];
    if (CATEGORY_ORDER.includes(w)) return w;
  }
  return null;
}

module.exports = { categorize, categoryFromQuery, CATEGORY_ORDER, CATEGORY_KEYWORDS, CATEGORY_ALIASES };

