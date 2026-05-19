const { EventEmitter } = require('events');
const path = require('path');
const db = require('../db/database');
const clip = require('../clip/clipWorker');
const { scanFolder } = require('./scanner');
const log = require('../utils/logger');

const BATCH_SIZE = 10;

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
      log.info('===== INDEXING START =====');
      log.info('Folder: ' + folder.path);
      log.info('Folder ID: ' + folder.id);
      log.info('Platform: ' + process.platform + ' ' + process.arch);
      log.info('Node: ' + process.version);
      log.info('CWD: ' + process.cwd());
      log.info('process.resourcesPath: ' + (process.resourcesPath || 'undefined'));

      log.info('Initializing CLIP worker...');
      await clip.init();
      log.info('CLIP worker initialized OK');

      this.emit('start', { folderId: folder.id, folderPath: folder.path });

      log.info('Scanning folder for images...');
      const files = await scanFolder(folder.path);
      const total = files.length;
      log.info('Scan complete: ' + total + ' images found');
      this.emit('scanned', { total });

      const batch = [];

      for (let i = 0; i < files.length; i++) {
        if (this.cancelled) { log.warn('Indexing cancelled by user'); break; }
        const f = files[i];

        log.info('---- Image ' + (i+1) + '/' + total + ' ----');
        log.info('Path: ' + f.path);
        log.info('Filename: ' + f.filename);
        log.info('Size: ' + f.size + ' bytes');
        log.info('Extension: ' + path.extname(f.path).toLowerCase());

        const existing = db.getImageMetaByPath(f.path);
        if (existing && existing.file_mtime === f.mtime && existing.file_size === f.size) {
          skipped++;
          log.info('SKIPPED (already indexed)');
          this.emit('progress', { current: i + 1, total, file: f.filename, status: 'skipped' });
          continue;
        }

        try {
          log.info('Calling clip.captionAndEmbed...');
          const result = await clip.captionAndEmbed(f.path);
          log.info('captionAndEmbed returned OK');
          log.info('  Embedding length: ' + (result.embedding ? result.embedding.length : 'null'));
          log.info('  Caption length: ' + (result.caption ? result.caption.length : 'null'));
          log.info('  Caption preview: ' + (result.caption || '').substring(0, 80));
          log.info('  Width x Height: ' + result.width + 'x' + result.height);

          batch.push({
            path: f.path,
            filename: f.filename,
            folderId: folder.id,
            fileSize: f.size,
            fileMtime: f.mtime,
            width: result.width,
            height: result.height,
            embedding: result.embedding,
            caption: result.caption,
            captionEmbedding: result.captionEmbedding
          });
          indexed++;
          log.info('Added to batch (size now: ' + batch.length + ')');

          if (batch.length >= BATCH_SIZE) {
            log.info('Flushing batch to DB...');
            db.upsertImagesBatch(batch);
            log.info('Batch flushed OK');
            batch.length = 0;
          }

          this.emit('progress', { current: i + 1, total, file: f.filename, status: 'indexed', caption: result.caption });
        } catch (err) {
          failed++;
          log.error('=== INDEX FAILURE ===');
          log.error('File: ' + f.path);
          log.error('Error message: ' + err.message);
          log.error('Error name: ' + err.name);
          log.error('Error code: ' + (err.code || 'no code'));
          log.error('Stack trace:\n' + (err.stack || 'no stack available'));
          log.error('===================');
          this.emit('progress', { current: i + 1, total, file: f.filename, status: 'failed', error: err.message });
        }
      }

      if (batch.length > 0) {
        log.info('Flushing final batch (size: ' + batch.length + ')...');
        db.upsertImagesBatch(batch);
        log.info('Final batch flushed OK');
      }

      db.updateFolderLastScan(folder.id);

      const durationMs = Date.now() - t0;
      const result = { indexed, skipped, failed, durationMs };
      log.info('===== INDEXING COMPLETE =====');
      log.info('Result: ' + JSON.stringify(result));
      this.emit('complete', result);
      return result;
    } catch (err) {
      log.error('===== INDEXER FATAL ERROR =====');
      log.error('Message: ' + err.message);
      log.error('Stack:\n' + (err.stack || 'no stack'));
      log.error('===============================');
      this.emit('error', { error: err.message });
      throw err;
    } finally {
      this.running = false;
    }
  }

  async indexSingleFile(filePath, folderId) {
    try {
      log.info('indexSingleFile: ' + filePath);
      await clip.init();
      const stat = await require('fs').promises.stat(filePath);
      const existing = db.getImageMetaByPath(filePath);
      if (existing && existing.file_mtime === stat.mtimeMs && existing.file_size === stat.size) {
        return { status: 'skipped' };
      }
      const result = await clip.captionAndEmbed(filePath);
      db.upsertImage({
        path: filePath,
        filename: path.basename(filePath),
        folderId,
        fileSize: stat.size,
        fileMtime: stat.mtimeMs,
        width: result.width,
        height: result.height,
        embedding: result.embedding,
        caption: result.caption,
        captionEmbedding: result.captionEmbedding
      });
      log.info('Indexed (single): ' + filePath);
      return { status: 'indexed', caption: result.caption };
    } catch (err) {
      log.error('indexSingleFile FAILED: ' + filePath);
      log.error('Error: ' + err.message);
      log.error('Stack:\n' + (err.stack || 'no stack'));
      return { status: 'failed', error: err.message };
    }
  }
}

module.exports = new Indexer();
