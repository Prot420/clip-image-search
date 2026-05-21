/**
 * electron/updater.js
 *
 * Auto-update via electron-updater + GitHub Releases.
 *
 * Flow: on app start, check GitHub for a newer release. If found,
 * download it in the background, then prompt the user to restart.
 * The update installs in-place — no manual uninstall, so the indexed
 * database is preserved.
 *
 * Disabled automatically in dev (no packaged app to update).
 */

const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');
const log = require('./utils/logger');

let mainWindow = null;
let checking = false;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function init(getWindow) {
  // Only run in a packaged app.
  if (process.env.NODE_ENV === 'development' || !require('electron').app.isPackaged) {
    log.info('[updater] Skipped (not a packaged app)');
    return;
  }

  mainWindow = getWindow();
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;          // download in background once found
  autoUpdater.autoInstallOnAppQuit = true;  // install leftover update on quit

  autoUpdater.on('checking-for-update', () => {
    log.info('[updater] Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    log.info('[updater] Update available: ' + info.version);
    send('update:available', { version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    log.info('[updater] No update available');
  });

  autoUpdater.on('download-progress', (p) => {
    send('update:progress', { percent: Math.round(p.percent) });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    log.info('[updater] Update downloaded: ' + info.version);
    send('update:downloaded', { version: info.version });

    const win = getWindow();
    const result = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Ready',
      message: 'A new version (' + info.version + ') has been downloaded.',
      detail: 'Restart the app to apply the update. Your indexed data is kept.'
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (err) => {
    log.error('[updater] Error: ' + (err == null ? 'unknown' : err.message));
  });

  checkForUpdates();
}

function checkForUpdates() {
  if (checking) return;
  checking = true;
  autoUpdater.checkForUpdates()
    .catch((e) => log.error('[updater] check failed: ' + e.message))
    .finally(() => { checking = false; });
}

module.exports = { init, checkForUpdates };
