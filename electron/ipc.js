/**
 * electron/ipc.js
 *
 * Registers ALL IPC handlers. Called once from main.js after app ready.
 *
 * Response convention:
 *   { ok: true, data }     on success
 *   { ok: false, error }   on failure
 *
 * This shields the renderer from having to wrap every call in try/catch.
 */

const { ipcMain, dialog, app, shell } = require('electron');
const fs = require('fs');
const db = require('./db/database');
const indexer = require('./indexer/indexer');
const searcher = require('./search/searcher');
const watcher = require('./watcher/folderWatcher');
const { ensureThumbnail } = require('./utils/thumbnails');
const log = require('./utils/logger');

function ok(data)  { return { ok: true,  data }; }
function fail(err) { return { ok: false, error: err.message || String(err) }; }

function register(getMainWindow) {

  // ---------- App ----------
  ipcMain.handle('app:get-version', () => ok(app.getVersion()));
  ipcMain.handle('app:ping', () => ok('pong'));

  // ---------- Folders ----------
  ipcMain.handle('folder:select', async () => {
    try {
      const win = getMainWindow();
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select Image Folder'
      });
      if (result.canceled || result.filePaths.length === 0) return ok(null);
      return ok({ path: result.filePaths[0] });
    } catch (e) { return fail(e); }
  });

  ipcMain.handle('folder:add', async (_evt, folderPath) => {
    try {
      if (!folderPath || !fs.existsSync(folderPath)) {
        throw new Error('Folder does not exist: ' + folderPath);
      }
      const folder = db.addFolder(folderPath);
      watcher.start(folder);
      return ok(folder);
    } catch (e) { return fail(e); }
  });

  ipcMain.handle('folder:list', () => {
    try { return ok(db.listFolders()); }
    catch (e) { return fail(e); }
  });

  ipcMain.handle('folder:remove', (_evt, folderId) => {
    try {
      watcher.stop(folderId);
      db.deleteFolder(folderId);
      searcher.invalidateCache();
      return ok({ removed: folderId });
    } catch (e) { return fail(e); }
  });

  // ---------- Indexing ----------
  ipcMain.handle('index:start', async (_evt, folderId) => {
    try {
      const folders = db.listFolders();
      const folder = folders.find(f => f.id === folderId);
      if (!folder) throw new Error('Folder not found: ' + folderId);

      // Hook indexer events -> forward to renderer
      const win = getMainWindow();
      const onProgress  = (d) => win && win.webContents.send('indexing:progress', d);
      const onScanned   = (d) => win && win.webContents.send('indexing:scanned', d);
      const onComplete  = (d) => win && win.webContents.send('indexing:complete', d);
      const onError     = (d) => win && win.webContents.send('indexing:error', d);

      indexer.on('progress', onProgress);
      indexer.on('scanned',  onScanned);
      indexer.on('complete', onComplete);
      indexer.on('error',    onError);

      try {
        const result = await indexer.indexFolder(folder);
        searcher.invalidateCache();
        return ok(result);
      } finally {
        indexer.off('progress', onProgress);
        indexer.off('scanned',  onScanned);
        indexer.off('complete', onComplete);
        indexer.off('error',    onError);
      }
    } catch (e) { return fail(e); }
  });

  ipcMain.handle('index:cancel', () => {
    try { indexer.cancel(); return ok(true); }
    catch (e) { return fail(e); }
  });

  // ---------- Search ----------
  ipcMain.handle('search:text', async (_evt, query, limit) => {
    try {
      const results = await searcher.searchByText(query, limit || 60);
      return ok(results);
    } catch (e) { return fail(e); }
  });

  ipcMain.handle('search:similar', async (_evt, imageId, limit) => {
    try {
      const results = await searcher.searchBySimilarImage(imageId, limit || 30);
      return ok(results);
    } catch (e) { return fail(e); }
  });

  // ---------- Image metadata & thumbnails ----------
  ipcMain.handle('image:get', (_evt, imageId) => {
    try {
      const row = db.getImageById(imageId);
      if (!row) return ok(null);
      // Don't send embedding blob over IPC — it's large and useless to renderer
      delete row.embedding; delete row.caption_embedding;
      return ok(row);
    } catch (e) { return fail(e); }
  });

  ipcMain.handle('image:thumbnail', async (_evt, imageId) => {
    try {
      const row = db.getImageById(imageId);
      if (!row) throw new Error('Image not found: ' + imageId);
      const thumbPath = await ensureThumbnail(row.path);
      return ok({ thumbnailPath: thumbPath });
    } catch (e) { return fail(e); }
  });

  ipcMain.handle('image:reveal', (_evt, imageId) => {
    try {
      const row = db.getImageById(imageId);
      if (!row) throw new Error('Image not found: ' + imageId);
      shell.showItemInFolder(row.path);
      return ok(true);
    } catch (e) { return fail(e); }
  });

  // ---------- Stats ----------
  ipcMain.handle('stats:get', () => {
    try {
      return ok({
        totalImages: db.countImages(),
        cache: searcher.getCacheStats()
      });
    } catch (e) { return fail(e); }
  });

  log.info('[ipc] All handlers registered');
}

module.exports = { register };
