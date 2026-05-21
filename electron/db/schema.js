const SCHEMA_VERSION = 4;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS folders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT UNIQUE NOT NULL,
    added_at    INTEGER NOT NULL,
    last_scan   INTEGER,
    is_watching INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS images (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    path              TEXT UNIQUE NOT NULL,
    filename          TEXT NOT NULL,
    folder_id         INTEGER NOT NULL,
    file_size         INTEGER NOT NULL,
    file_mtime        INTEGER NOT NULL,
    width             INTEGER,
    height            INTEGER,
    embedding         BLOB NOT NULL,
    caption           TEXT,
    caption_embedding BLOB,
    category          TEXT,
    indexed_at        INTEGER NOT NULL,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_images_path     ON images(path);
  CREATE INDEX IF NOT EXISTS idx_images_folder   ON images(folder_id);
  CREATE INDEX IF NOT EXISTS idx_images_mtime    ON images(file_mtime);
  CREATE INDEX IF NOT EXISTS idx_images_caption  ON images(caption);
  CREATE INDEX IF NOT EXISTS idx_images_category ON images(category);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`;

module.exports = { SCHEMA_VERSION, SCHEMA_SQL };
