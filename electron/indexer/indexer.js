/**
 * electron/indexer/indexer.js
 *
 * Orchestrates indexing of a folder:
 *   1. scan folder for images
 *   2. for each image, check if already up-to-date in DB (skip if so)
 *   3. embed image via CLIP worker
 *   4. upsert into DB (batched in transactions for speed)
 *   5. emit progress events
 *
 * Uses an EventEmitter so the IPC layer (Phase 7) can subscribe and
 * forward progress to the React UI.
 */

const { EventEmitter } = require('events');
const path = require('path');
const db = require('../db/database');
const clip = require('../clip/clipWorker');
const { scanFolder } = require('./scanner');
const log = require('../utils/logger');

const BATCH_SIZE = 50; // commit DB writes every N images

class Indexer extends EventEmitter {
  constructor() {
    super();
    this.cancelled = false;
    this.running = false;
  }

  cancel() {
    this.cancelled = true;
  }

  /**
   * Index a folder by its DB row.
   *
   * @param {{id: number, path: string}} folder
   * @returns {Promise<{indexed: number, skipped: number, failed: number, durationMs: number}>}
   */
  async indexFolder(folder) {
    if (this.running) {
      throw new Error('Indexer is already running');
    }
    this.running = true;
    this.cancelled = false;

    const t0 = Date.now();
    let indexed = 0;
    let skipped = 0;
    let failed = 0;

    try {
      await clip.init();

      log.info(`Indexing folder: ${folder.path}`);
      this.emit('start', { folderId: folder.id, folderPath: folder.path });

      const files = await scanFolder(folder.path);
      const total = files.length;
      log.info(`Found ${total} images in ${folder.path}`);
      this.emit('scanned', { total });

      const batch = [];

      for (let i = 0; i < files.length; i++) {
        if (this.cancelled) {
          log.warn('Indexing cancelled by user');
          break;
        }

        const f = files[i];

        // Incremental check: skip if path + mtime + size match what's in DB
        const existing = db.getImageMetaByPath(f.path);
        if (existing && existing.file_mtime === f.mtime && existing.file_size === f.size) {
          skipped++;
          this.emit('progress', { current: i + 1, total, file: f.filename, status: 'skipped' });
          continue;
        }

        try {
          const { embedding, width, height } = await clip.embedImage(f.path);
          batch.push({
            path: f.path,
            filename: f.filename,
            folderId: folder.id,
            fileSize: f.size,
            fileMtime: f.mtime,
            width,
            height,
            embedding
          });
          indexed++;

          if (batch.length >= BATCH_SIZE) {
            db.upsertImagesBatch(batch);
            batch.length = 0;
          }

          this.emit('progress', { current: i + 1, total, file: f.filename, status: 'indexed' });
        } catch (err) {
          failed++;
          log.error(`Failed to embed ${f.path}:`, err.message);
          this.emit('progress', { current: i + 1, total, file: f.filename, status: 'failed', error: err.message });
        }
      }

      // Flush remaining batch
      if (batch.length > 0) {
        db.upsertImagesBatch(batch);
      }

      db.updateFolderLastScan(folder.id);

      const durationMs = Date.now() - t0;
      const result = { indexed, skipped, failed, durationMs };
      log.info(`Indexing complete:`, result);
      this.emit('complete', result);
      return result;
    } catch (err) {
      log.error('Indexer fatal error:', err);
      this.emit('error', { error: err.message });
      throw err;
    } finally {
      this.running = false;
    }
  }

  /**
   * Index a single new image (used by folder watcher).
   * Cheaper than full re-scan when only one file changed.
   */
  async indexSingleFile(filePath, folderId) {
    try {
      await clip.init();
      const stat = await require('fs').promises.stat(filePath);
      const existing = db.getImageMetaByPath(filePath);
      if (existing && existing.file_mtime === stat.mtimeMs && existing.file_size === stat.size) {
        return { status: 'skipped' };
      }
      const { embedding, width, height } = await clip.embedImage(filePath);
      db.upsertImage({
        path: filePath,
        filename: path.basename(filePath),
        folderId,
        fileSize: stat.size,
        fileMtime: stat.mtimeMs,
        width,
        height,
        embedding
      });
      log.info(`Indexed (single): ${filePath}`);
      return { status: 'indexed' };
    } catch (err) {
      log.error(`Failed to index single ${filePath}:`, err.message);
      return { status: 'failed', error: err.message };
    }
  }
}

module.exports = new Indexer();
