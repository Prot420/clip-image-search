/**
 * electron/db/database.js
 *
 * better-sqlite3 wrapper.
 * - Opens (or creates) the DB at userData/images.sqlite
 * - Applies schema on first run
 * - Pre-compiles frequent queries as prepared statements
 * - Exposes high-level CRUD helpers used by indexer, searcher, IPC
 *
 * IMPORTANT: This module is loaded by the Electron main process.
 * It will NOT work in the renderer — IPC bridges every DB operation.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { getDatabasePath } = require('../utils/paths');
const { SCHEMA_VERSION, SCHEMA_SQL } = require('./schema');

let db = null;
let stmts = null; // cached prepared statements

/**
 * Initialize the database. Idempotent — safe to call multiple times,
 * but typically called once at app startup.
 */
function init() {
  if (db) return db;

  const dbPath = getDatabasePath();
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  db = new Database(dbPath);

  // PRAGMAs for performance + safety
  db.pragma('journal_mode = WAL');     // concurrent reads while writing
  db.pragma('synchronous = NORMAL');   // good safety, ~2x faster than FULL
  db.pragma('foreign_keys = ON');      // enforce FK constraints
  db.pragma('temp_store = MEMORY');    // temp tables in RAM

  // Apply schema (idempotent due to IF NOT EXISTS)
  db.exec(SCHEMA_SQL);

  // Record / verify schema version
  const currentVersion = getSetting('schema_version');
  if (currentVersion === null) {
    setSetting('schema_version', String(SCHEMA_VERSION));
  } else if (parseInt(currentVersion, 10) !== SCHEMA_VERSION) {
    // Future: migration logic goes here
    throw new Error(
      `Schema version mismatch: DB has v${currentVersion}, code expects v${SCHEMA_VERSION}. ` +
      `Migration not yet implemented.`
    );
  }

  prepareStatements();
  return db;
}

/**
 * Pre-compile frequent queries. Called once after schema init.
 * Using prepared statements is ~10x faster than running raw SQL each time.
 */
function prepareStatements() {
  stmts = {
    // settings
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),

    // folders
    insertFolder: db.prepare(`
      INSERT INTO folders (path, added_at, is_watching)
      VALUES (?, ?, 1)
      ON CONFLICT(path) DO NOTHING
    `),
    getFolderByPath: db.prepare('SELECT * FROM folders WHERE path = ?'),
    listFolders: db.prepare(`
      SELECT f.*, COUNT(i.id) AS image_count
      FROM folders f
      LEFT JOIN images i ON i.folder_id = f.id
      GROUP BY f.id
      ORDER BY f.added_at DESC
    `),
    deleteFolder: db.prepare('DELETE FROM folders WHERE id = ?'),
    updateFolderLastScan: db.prepare('UPDATE folders SET last_scan = ? WHERE id = ?'),

    // images
    insertImage: db.prepare(`
      INSERT INTO images (path, filename, folder_id, file_size, file_mtime, width, height, embedding, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        file_size  = excluded.file_size,
        file_mtime = excluded.file_mtime,
        width      = excluded.width,
        height     = excluded.height,
        embedding  = excluded.embedding,
        indexed_at = excluded.indexed_at
    `),
    getImageByPath: db.prepare('SELECT id, file_mtime, file_size FROM images WHERE path = ?'),
    getImageById: db.prepare('SELECT * FROM images WHERE id = ?'),
    deleteImageByPath: db.prepare('DELETE FROM images WHERE path = ?'),
    countImages: db.prepare('SELECT COUNT(*) AS c FROM images'),
    countImagesByFolder: db.prepare('SELECT COUNT(*) AS c FROM images WHERE folder_id = ?'),
    listAllEmbeddings: db.prepare('SELECT id, path, filename, embedding FROM images'),
    listEmbeddingsByFolder: db.prepare(
      'SELECT id, path, filename, embedding FROM images WHERE folder_id = ?'
    )
  };
}

/* ------------------------------------------------------------------ */
/* High-level helpers                                                  */
/* ------------------------------------------------------------------ */

function getSetting(key) {
  const row = stmts ? stmts.getSetting.get(key) : db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  if (stmts) {
    stmts.setSetting.run(key, value);
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }
}

function addFolder(folderPath) {
  stmts.insertFolder.run(folderPath, Date.now());
  return stmts.getFolderByPath.get(folderPath);
}

function listFolders() {
  return stmts.listFolders.all();
}

function deleteFolder(id) {
  return stmts.deleteFolder.run(id);
}

function updateFolderLastScan(id) {
  stmts.updateFolderLastScan.run(Date.now(), id);
}

/**
 * Insert or update an image record. Embedding must be a Float32Array.
 */
function upsertImage({ path: imgPath, filename, folderId, fileSize, fileMtime, width, height, embedding }) {
  if (!(embedding instanceof Float32Array)) {
    throw new Error('embedding must be Float32Array');
  }
  const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  stmts.insertImage.run(imgPath, filename, folderId, fileSize, fileMtime, width, height, buf, Date.now());
}

/**
 * Batch upsert — wraps N inserts in a single transaction.
 * 50-100x faster than calling upsertImage in a loop.
 */
const upsertImagesBatch = (records) => {
  const tx = db.transaction((items) => {
    for (const r of items) upsertImage(r);
  });
  tx(records);
};

function getImageMetaByPath(imgPath) {
  return stmts.getImageByPath.get(imgPath);
}

function getImageById(id) {
  return stmts.getImageById.get(id);
}

function deleteImageByPath(imgPath) {
  return stmts.deleteImageByPath.run(imgPath);
}

function countImages() {
  return stmts.countImages.get().c;
}

/**
 * Read ALL embeddings into memory as { id, path, filename, embedding: Float32Array }.
 * For 100k images: ~200 MB RAM. Loaded once at app start, used for fast search.
 */
function loadAllEmbeddings() {
  const rows = stmts.listAllEmbeddings.all();
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    filename: r.filename,
    embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4)
  }));
}

function close() {
  if (db) {
    db.close();
    db = null;
    stmts = null;
  }
}

function getRawDb() {
  return db; // escape hatch for ad-hoc queries (testing)
}

module.exports = {
  init,
  close,
  getRawDb,

  // settings
  getSetting,
  setSetting,

  // folders
  addFolder,
  listFolders,
  deleteFolder,
  updateFolderLastScan,

  // images
  upsertImage,
  upsertImagesBatch,
  getImageMetaByPath,
  getImageById,
  deleteImageByPath,
  countImages,
  loadAllEmbeddings
};
