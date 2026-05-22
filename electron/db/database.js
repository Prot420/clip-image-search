const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { getDatabasePath } = require('../utils/paths');
const { SCHEMA_VERSION, SCHEMA_SQL } = require('./schema');
const log = require('../utils/logger');

let db = null;
let stmts = null;

function init() {
  if (db) return db;
  const dbPath = getDatabasePath();
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');
  db.exec(SCHEMA_SQL);

  const currentVersion = getSetting('schema_version');
  if (currentVersion === null) {
    setSetting('schema_version', String(SCHEMA_VERSION));
  } else if (parseInt(currentVersion, 10) !== SCHEMA_VERSION) {
    // Schema changed between versions. Rather than crashing, drop the
    // image/folder data and let the user re-index on the new schema.
    // Backups remain restorable because restore re-runs this same path.
    const oldV = currentVersion;
    log.warn('[db] Schema upgrade: v' + oldV + ' -> v' + SCHEMA_VERSION + '. Clearing old indexed data; a re-index is required.');
    db.exec('DROP TABLE IF EXISTS images; DROP TABLE IF EXISTS folders;');
    db.exec(SCHEMA_SQL);
    setSetting('schema_version', String(SCHEMA_VERSION));
  }

  prepareStatements();
  return db;
}

function prepareStatements() {
  stmts = {
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),

    insertFolder: db.prepare('INSERT INTO folders (path, added_at, is_watching) VALUES (?, ?, 1) ON CONFLICT(path) DO NOTHING'),
    getFolderByPath: db.prepare('SELECT * FROM folders WHERE path = ?'),
    listFolders: db.prepare(`
      SELECT f.*, COUNT(i.id) AS image_count
      FROM folders f LEFT JOIN images i ON i.folder_id = f.id
      GROUP BY f.id ORDER BY f.added_at DESC
    `),
    deleteFolder: db.prepare('DELETE FROM folders WHERE id = ?'),
    updateFolderLastScan: db.prepare('UPDATE folders SET last_scan = ? WHERE id = ?'),

    insertImage: db.prepare(`
      INSERT INTO images (path, filename, folder_id, file_size, file_mtime, width, height, embedding, caption, caption_embedding, category, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        file_size         = excluded.file_size,
        file_mtime        = excluded.file_mtime,
        width             = excluded.width,
        height            = excluded.height,
        embedding         = excluded.embedding,
        caption           = excluded.caption,
        caption_embedding = excluded.caption_embedding,
        category          = excluded.category,
        indexed_at        = excluded.indexed_at
    `),
    getImageByPath: db.prepare('SELECT id, file_mtime, file_size FROM images WHERE path = ?'),
    getImageById: db.prepare('SELECT * FROM images WHERE id = ?'),
    deleteImageByPath: db.prepare('DELETE FROM images WHERE path = ?'),
    countImages: db.prepare('SELECT COUNT(*) AS c FROM images'),
    listAllEmbeddings: db.prepare('SELECT id, path, filename, embedding, caption, caption_embedding, category, width, height, file_size FROM images')
  };
}

function getSetting(key) {
  const row = stmts ? stmts.getSetting.get(key) : db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  if (stmts) stmts.setSetting.run(key, value);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
function addFolder(folderPath) {
  stmts.insertFolder.run(folderPath, Date.now());
  return stmts.getFolderByPath.get(folderPath);
}
function listFolders() { return stmts.listFolders.all(); }
function deleteFolder(id) { return stmts.deleteFolder.run(id); }
function updateFolderLastScan(id) { stmts.updateFolderLastScan.run(Date.now(), id); }

function upsertImage({ path: imgPath, filename, folderId, fileSize, fileMtime, width, height, embedding, caption, captionEmbedding, category }) {
  if (!(embedding instanceof Float32Array)) throw new Error('embedding must be Float32Array');
  const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

  let capBuf = null;
  if (captionEmbedding) {
    if (!(captionEmbedding instanceof Float32Array)) throw new Error('captionEmbedding must be Float32Array');
    capBuf = Buffer.from(captionEmbedding.buffer, captionEmbedding.byteOffset, captionEmbedding.byteLength);
  }

  stmts.insertImage.run(imgPath, filename, folderId, fileSize, fileMtime, width, height, buf, caption || null, capBuf, category || null, Date.now());
}

const upsertImagesBatch = (records) => {
  const tx = db.transaction((items) => { for (const r of items) upsertImage(r); });
  tx(records);
};

function getImageMetaByPath(imgPath) { return stmts.getImageByPath.get(imgPath); }
function getImageById(id) { return stmts.getImageById.get(id); }
function deleteImageByPath(imgPath) { return stmts.deleteImageByPath.run(imgPath); }
function countImages() { return stmts.countImages.get().c; }

function loadAllEmbeddings() {
  const rows = stmts.listAllEmbeddings.all();
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    filename: r.filename,
    embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4),
    caption: r.caption || '',
    category: r.category || null,
    width: r.width || null,
    height: r.height || null,
    fileSize: r.file_size || null,
    captionEmbedding: r.caption_embedding
      ? new Float32Array(r.caption_embedding.buffer, r.caption_embedding.byteOffset, r.caption_embedding.byteLength / 4)
      : null
  }));
}

/**
 * Backup: copies the live SQLite database to destPath.
 * Uses better-sqlite3's online backup so it is safe even while the DB is open.
 */
async function backupDatabase(destPath) {
  if (!db) throw new Error('Database not initialised');
  // better-sqlite3 backup() returns a promise-like; await completes the copy.
  await db.backup(destPath);
  return { path: destPath };
}

/**
 * Restore: replaces the live database file with the one at srcPath.
 * Closes the DB, swaps the file, re-opens. Caller must re-init afterwards.
 */
function restoreDatabase(srcPath) {
  if (!fs.existsSync(srcPath)) throw new Error('Backup file not found: ' + srcPath);

  // Validate it is actually a SQLite database before overwriting.
  const test = new Database(srcPath, { readonly: true });
  try {
    const hasImages = test.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='images'"
    ).get();
    if (!hasImages) throw new Error('Selected file is not a valid CLIP Search database');
  } finally {
    test.close();
  }

  const dbPath = getDatabasePath();
  close();  // closes current db, clears stmts

  // Remove WAL/SHM side files so the restored DB is consistent.
  for (const ext of ['', '-wal', '-shm']) {
    const p = dbPath + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  fs.copyFileSync(srcPath, dbPath);
  return { restored: true };
}

function close() {
  if (db) { db.close(); db = null; stmts = null; }
}
function getRawDb() { return db; }

module.exports = {
  init, close, getRawDb,
  getSetting, setSetting,
  addFolder, listFolders, deleteFolder, updateFolderLastScan,
  upsertImage, upsertImagesBatch,
  getImageMetaByPath, getImageById, deleteImageByPath, countImages,
  loadAllEmbeddings,
  backupDatabase, restoreDatabase
};
