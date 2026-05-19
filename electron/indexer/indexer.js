const { EventEmitter } = require('events');
const path = require('path');
const db = require('../db/database');
const clip = require('../clip/clipWorker');
const { scanFolder } = require('./scanner');
const log = require('../utils/logger');

const BATCH_SIZE = 10; // smaller batch — caption gen is slow

class Indexer extends EventEmitter {
  constructor() {
    super();
    this.cancelled = false;
    this.running = false;
  }

  cancel() { this.cancelled = true; }

  async indexFolder(folder) {
    if (this.running) throw new Error('Indexer already running');
    this.running = true;
    this.cancelled = false;

    const t0 = Date.now();
    let indexed = 0, skipped = 0, failed = 0;

    try {
      await clip.init();
      log.info('Indexing folder: ' + folder.path);
      this.emit('start', { folderId: folder.id, folderPath: folder.path });

      const files = await scanFolder(folder.path);
      const total = files.length;
      log.info('Found ' + total + ' images');
      this.emit('scanned', { total });

      const batch = [];

      for (let i = 0; i < files.length; i++) {
        if (this.cancelled) { log.warn('Indexing cancelled'); break; }
        const f = files[i];
        const existing = db.getImageMetaByPath(f.path);
        if (existing && existing.file_mtime === f.mtime && existing.file_size === f.size) {
          skipped++;
          this.emit('progress', { current: i + 1, total, file: f.filename, status: 'skipped' });
          continue;
        }
        try {
          const { embedding, caption, captionEmbedding, width, height } = await clip.captionAndEmbed(f.path);
          batch.push({
            path: f.path,
            filename: f.filename,
            folderId: folder.id,
            fileSize: f.size,
            fileMtime: f.mtime,
            width, height,
            embedding,
            caption,
            captionEmbedding
          });
          indexed++;
          if (batch.length >= BATCH_SIZE) {
            db.upsertImagesBatch(batch);
            batch.length = 0;
          }
          this.emit('progress', { current: i + 1, total, file: f.filename, status: 'indexed', caption });
        } catch (err) {
          failed++;
          log.error('Failed to index ' + f.path + ': ' + err.message + '\nStack: ' + (err.stack || 'no stack'));
          this.emit('progress', { current: i + 1, total, file: f.filename, status: 'failed', error: err.message });
        }
      }

      if (batch.length > 0) db.upsertImagesBatch(batch);
      db.updateFolderLastScan(folder.id);

      const durationMs = Date.now() - t0;
      const result = { indexed, skipped, failed, durationMs };
      log.info('Indexing complete: ' + JSON.stringify(result));
      this.emit('complete', result);
      return result;
    } catch (err) {
      log.error('Indexer fatal: ' + err.message);
      this.emit('error', { error: err.message });
      throw err;
    } finally {
      this.running = false;
    }
  }

  async indexSingleFile(filePath, folderId) {
    try {
      await clip.init();
      const stat = await require('fs').promises.stat(filePath);
      const existing = db.getImageMetaByPath(filePath);
      if (existing && existing.file_mtime === stat.mtimeMs && existing.file_size === stat.size) {
        return { status: 'skipped' };
      }
      const { embedding, caption, captionEmbedding, width, height } = await clip.captionAndEmbed(filePath);
      db.upsertImage({
        path: filePath,
        filename: path.basename(filePath),
        folderId,
        fileSize: stat.size,
        fileMtime: stat.mtimeMs,
        width, height,
        embedding, caption, captionEmbedding
      });
      log.info('Indexed (single): ' + filePath);
      return { status: 'indexed', caption };
    } catch (err) {
      log.error('Failed single ' + filePath + ': ' + err.message);
      return { status: 'failed', error: err.message };
    }
  }
}

module.exports = new Indexer();
