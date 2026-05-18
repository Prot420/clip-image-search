/**
 * electron/clip/clipWorker.js
 *
 * Thin re-export of clipClient. Exists so that callers (indexer, searcher)
 * keep working with `require('./clipWorker')` — no caller changes needed.
 *
 * All actual inference happens in clipWorkerThread.js, proxied through
 * clipClient.js.
 */

module.exports = require('./clipClient');
