const api = typeof window !== 'undefined' ? window.electronAPI : null;

function unwrap(promise) {
  return promise.then((res) => {
    if (!res) throw new Error('No response from main process');
    if (!res.ok) throw new Error(res.error || 'Unknown error');
    return res.data;
  });
}

export const electron = {
  available: !!api,

  getVersion: ()      => unwrap(api.getVersion()),

  selectFolder: ()    => unwrap(api.selectFolder()),
  addFolder:    (p)   => unwrap(api.addFolder(p)),
  listFolders:  ()    => unwrap(api.listFolders()),
  removeFolder: (id)  => unwrap(api.removeFolder(id)),

  startIndexing:  (id) => unwrap(api.startIndexing(id)),
  cancelIndexing: ()   => unwrap(api.cancelIndexing()),

  searchByText:    (q, n) => unwrap(api.searchByText(q, n)),
  searchBySimilar: (id, n) => unwrap(api.searchBySimilar(id, n)),

  getImage:     (id)   => unwrap(api.getImage(id)),
  getThumbnail: (id)   => unwrap(api.getThumbnail(id)),
  revealImage:  (id)   => unwrap(api.revealImage(id)),

  getStats: () => unwrap(api.getStats()),

  backupDatabase:  () => unwrap(api.backupDatabase()),
  restoreDatabase: () => unwrap(api.restoreDatabase()),

  exportLogs:     () => unwrap(api.exportLogs()),
  openLogsFolder: () => unwrap(api.openLogsFolder()),

  on: (channel, cb) => api ? api.on(channel, cb) : () => {}
};
