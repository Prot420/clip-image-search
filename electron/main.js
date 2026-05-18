/**
 * electron/main.js
 *
 * Electron entry point.
 * - Creates BrowserWindow
 * - Initializes DB, indexer, watcher
 * - Registers IPC handlers
 * - Registers `thumb://` custom protocol for thumbnail loading
 * - Starts watchers for existing folders
 */

const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');

const {
  isDev,
  getRendererUrl,
  getPreloadPath,
  getUserDataDir
} = require('./utils/paths');

const db = require('./db/database');
const watcher = require('./watcher/folderWatcher');
const searcher = require('./search/searcher');
const ipc = require('./ipc');
const log = require('./utils/logger');
const { ensureThumbnail } = require('./utils/thumbnails');

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0a0a0b',
    show: false,
    autoHideMenuBar: true,
    title: 'CLIP Image Search',
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  const u = getRendererUrl();
  log.info(`[main] Loading renderer: ${u}`);
  mainWindow.loadURL(u).catch((err) => log.error('Failed to load renderer:', err));
}

/**
 * Register custom protocol `thumb://<image-path-encoded>` that serves
 * cached thumbnails. The renderer uses <img src="thumb://..."> for grid items.
 */
function registerThumbProtocol() {
  // We use protocol.handle (modern API, Electron 25+)
  protocol.handle('thumb', async (request) => {
    try {
      // URL format: thumb://image/<imageId>
      const parsed = new URL(request.url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const imageId = parseInt(segments[0], 10);
      if (!imageId) return new Response('Bad image id', { status: 400 });

      const row = db.getImageById(imageId);
      if (!row) return new Response('Not found', { status: 404 });

      const thumbPath = await ensureThumbnail(row.path);
      const data = await fs.promises.readFile(thumbPath);
      return new Response(data, {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' }
      });
    } catch (err) {
      log.error('[thumb protocol]', err.message);
      return new Response('Error: ' + err.message, { status: 500 });
    }
  });

  // Same for original full image: img://image/<imageId>
  protocol.handle('img', async (request) => {
    try {
      const parsed = new URL(request.url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const imageId = parseInt(segments[0], 10);
      if (!imageId) return new Response('Bad image id', { status: 400 });

      const row = db.getImageById(imageId);
      if (!row) return new Response('Not found', { status: 404 });

      const data = await fs.promises.readFile(row.path);
      const ext = path.extname(row.path).slice(1).toLowerCase();
      const mime = ext === 'png' ? 'image/png'
                 : ext === 'webp' ? 'image/webp'
                 : ext === 'gif' ? 'image/gif'
                 : 'image/jpeg';
      return new Response(data, { headers: { 'Content-Type': mime } });
    } catch (err) {
      return new Response('Error: ' + err.message, { status: 500 });
    }
  });
}

// Protocols must be registered as privileged BEFORE app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'thumb', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } },
  { scheme: 'img',   privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } }
]);

app.whenReady().then(() => {
  log.info(`[main] App ready. Mode: ${isDev ? 'dev' : 'prod'}`);
  log.info(`[main] User data: ${getUserDataDir()}`);

  // 1. Init DB
  db.init();

  // 2. Register custom protocols
  registerThumbProtocol();

  // 3. Register all IPC handlers
  ipc.register(() => mainWindow);

  // 4. Pre-load search cache (async, non-blocking)
  setImmediate(() => {
    try { searcher.loadCache(); }
    catch (e) { log.warn('Initial cache load failed:', e.message); }
  });

  // 5. Start watchers for any existing folders
  for (const f of db.listFolders()) {
    watcher.start(f);
  }

  // 6. Create window
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  watcher.stopAll();
  db.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_evt, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    log.warn('Blocked window open:', url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, u) => {
    if (!u.startsWith('http://localhost:5173') && !u.startsWith('file://')) {
      log.warn('Blocked navigation:', u);
      event.preventDefault();
    }
  });
});
