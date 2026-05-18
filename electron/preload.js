/**
 * electron/preload.js
 *
 * Secure IPC bridge. Renderer accesses everything via window.electronAPI.xxx
 *
 * Response shape from all invoke() calls: { ok, data?, error? }
 * The renderer-side hook unwraps and throws on !ok.
 */

const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_EVENT_CHANNELS = [
  'indexing:progress',
  'indexing:scanned',
  'indexing:complete',
  'indexing:error',
  'watcher:new-image',
  'watcher:removed-image'
];

contextBridge.exposeInMainWorld('electronAPI', {
  // App
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  ping:       () => ipcRenderer.invoke('app:ping'),

  // Folders
  selectFolder: ()                  => ipcRenderer.invoke('folder:select'),
  addFolder:    (folderPath)        => ipcRenderer.invoke('folder:add', folderPath),
  listFolders:  ()                  => ipcRenderer.invoke('folder:list'),
  removeFolder: (folderId)          => ipcRenderer.invoke('folder:remove', folderId),

  // Indexing
  startIndexing: (folderId)         => ipcRenderer.invoke('index:start', folderId),
  cancelIndexing: ()                => ipcRenderer.invoke('index:cancel'),

  // Search
  searchByText:    (query, limit)   => ipcRenderer.invoke('search:text', query, limit),
  searchBySimilar: (imageId, limit) => ipcRenderer.invoke('search:similar', imageId, limit),

  // Image
  getImage:        (imageId)        => ipcRenderer.invoke('image:get', imageId),
  getThumbnail:    (imageId)        => ipcRenderer.invoke('image:thumbnail', imageId),
  revealImage:     (imageId)        => ipcRenderer.invoke('image:reveal', imageId),

  // Stats
  getStats: () => ipcRenderer.invoke('stats:get'),

  // Events (main -> renderer)
  on: (channel, callback) => {
    if (!ALLOWED_EVENT_CHANNELS.includes(channel)) {
      console.warn(`[preload] Channel "${channel}" not allowed`);
      return () => {};
    }
    const sub = (_evt, ...args) => callback(...args);
    ipcRenderer.on(channel, sub);
    return () => ipcRenderer.removeListener(channel, sub);
  }
});
