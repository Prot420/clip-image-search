/**
 * electron/utils/logger.js
 *
 * Centralized logger using electron-log. Writes to:
 *   - Console (always)
 *   - Log file at <userData>/logs/main.log  (rotates at 10 MB)
 *
 * Usage:
 *   const log = require('./utils/logger');
 *   log.info('Indexing started', { folder: '/foo' });
 *   log.error('Embed failed', err);
 */

const log = require('electron-log/main');
const path = require('path');
const { getLogsDir } = require('./paths');

let configured = false;

function configure() {
  if (configured) return;

  log.transports.file.resolvePathFn = () => path.join(getLogsDir(), 'main.log');
  log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB
  log.transports.file.format  = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
  log.transports.console.format = '[{level}] {text}';

  // In production, default to 'info'. In dev, 'debug'.
  const level = process.env.NODE_ENV === 'development' ? 'debug' : 'info';
  log.transports.file.level    = level;
  log.transports.console.level = level;

  configured = true;
}

configure();

module.exports = log;
