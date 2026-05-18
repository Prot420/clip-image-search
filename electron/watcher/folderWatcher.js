/**
 * electron/watcher/folderWatcher.js
 *
 * Watches indexed folders for new / changed / deleted image files
 * using chokidar. Auto-indexes new files in the background.
 *
 * Emits events that the IPC layer (Phase 7) forwards to the renderer.
 */

const chokidar = require('chokidar');
const { EventEmitter } = require('events');
const path = require('path');
const db = require('../db/database');
const indexer = require('../indexer/indexer');
const searcher = require('../search/searcher');
const { isImageFile } = require('../indexer/scanner');
const log = require('../utils/logger');

class FolderWatcher extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<number, chokidar.FSWatcher>} folderId -> watcher */
    this.watchers = new Map();
  }

  /**
   * Start watching a folder. Idempotent.
   */
  start(folder) {
    if (this.watchers.has(folder.id)) return;

    const w = chokidar.watch(folder.path, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,       // don't fire 'add' for existing files
      awaitWriteFinish: {
        stabilityThreshold: 500, // wait 500ms after last write
        pollInterval: 100
      },
      depth: 99
    });

    w.on('add', async (filePath) => {
      if (!isImageFile(filePath)) return;
      log.info(`[watcher] new file: ${filePath}`);
      const result = await indexer.indexSingleFile(filePath, folder.id);
      if (result.status === 'indexed') {
        searcher.invalidateCache();
        this.emit('new-image', { path: filePath, folderId: folder.id });
      }
    });

    w.on('change', async (filePath) => {
      if (!isImageFile(filePath)) return;
      log.info(`[watcher] changed: ${filePath}`);
      const result = await indexer.indexSingleFile(filePath, folder.id);
      if (result.status === 'indexed') {
        searcher.invalidateCache();
        this.emit('changed-image', { path: filePath, folderId: folder.id });
      }
    });

    w.on('unlink', (filePath) => {
      if (!isImageFile(filePath)) return;
      log.info(`[watcher] removed: ${filePath}`);
      db.deleteImageByPath(filePath);
      searcher.invalidateCache();
      this.emit('removed-image', { path: filePath, folderId: folder.id });
    });

    w.on('error', (err) => {
      log.error(`[watcher] error for ${folder.path}:`, err);
    });

    this.watchers.set(folder.id, w);
    log.info(`[watcher] started for: ${folder.path}`);
  }

  stop(folderId) {
    const w = this.watchers.get(folderId);
    if (w) {
      w.close();
      this.watchers.delete(folderId);
      log.info(`[watcher] stopped for folder id ${folderId}`);
    }
  }

  stopAll() {
    for (const [, w] of this.watchers) w.close();
    this.watchers.clear();
  }
}

module.exports = new FolderWatcher();
