/**
 * electron/utils/paths.js
 *
 * Centralized path resolution for the app.
 * - In development: paths point to project folders.
 * - In production: paths point to OS user data dir + bundled resources.
 */

const path = require('path');
const fs = require('fs');

// Electron's `app` may not be available if this module is loaded outside Electron
// (e.g. during standalone testing in Codespace). Load lazily and guard.
let electronApp = null;
try {
  electronApp = require('electron').app || null;
} catch {
  electronApp = null;
}

const isDev = process.env.NODE_ENV === 'development';

/**
 * Project root in dev. __dirname here is electron/utils/, go up 2 levels.
 */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Where bundled resources (ONNX models, tokenizer) live.
 *   Dev:  <project>/resources/models/
 *   Prod: <app>/resources/models/   (electron-builder extraResources)
 */
function getModelsDir() {
  if (isDev) {
    return path.join(PROJECT_ROOT, 'resources', 'models');
  }
  // Production: prefer process.resourcesPath (set by Electron in packaged apps).
  // Fallback to PROJECT_ROOT-relative path so the module never crashes
  // outside Electron (e.g. standalone tests).
  if (process.resourcesPath) {
    return path.join(process.resourcesPath, 'models');
  }
  return path.join(PROJECT_ROOT, 'resources', 'models');
}

/**
 * Where user-specific data lives (DB, logs, settings).
 *   Dev:  <project>/.userdata/
 *   Prod: %APPDATA%/CLIP Image Search/
 */
function getUserDataDir() {
  if (isDev || !electronApp) {
    const devDir = path.join(PROJECT_ROOT, '.userdata');
    if (!fs.existsSync(devDir)) fs.mkdirSync(devDir, { recursive: true });
    return devDir;
  }
  return electronApp.getPath('userData');
}

function getDatabasePath() {
  return path.join(getUserDataDir(), 'images.sqlite');
}

function getLogsDir() {
  const dir = path.join(getUserDataDir(), 'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getRendererUrl() {
  if (isDev) {
    return 'http://localhost:5173';
  }
  return `file://${path.join(PROJECT_ROOT, 'dist', 'index.html')}`;
}

function getPreloadPath() {
  return path.join(PROJECT_ROOT, 'electron', 'preload.js');
}

module.exports = {
  isDev,
  PROJECT_ROOT,
  getModelsDir,
  getUserDataDir,
  getDatabasePath,
  getLogsDir,
  getRendererUrl,
  getPreloadPath
};
