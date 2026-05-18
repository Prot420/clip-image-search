import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { electron } from '../hooks/useElectronAPI';

export default function Sidebar() {
  const folders = useStore(s => s.folders);
  const setFolders = useStore(s => s.setFolders);
  const indexing = useStore(s => s.indexing);
  const setIndexing = useStore(s => s.setIndexing);
  const setIndexProgress = useStore(s => s.setIndexProgress);
  const setIndexFolderId = useStore(s => s.setIndexFolderId);
  const indexProgress = useStore(s => s.indexProgress);
  const indexFolderId = useStore(s => s.indexFolderId);
  const stats = useStore(s => s.stats);
  const setStats = useStore(s => s.setStats);
  const [err, setErr] = useState(null);

  async function refresh() {
    try {
      const list = await electron.listFolders();
      setFolders(list);
      const s = await electron.getStats();
      setStats(s);
    } catch (e) { setErr(e.message); }
  }

  useEffect(() => { refresh(); }, []);

  async function handleAddFolder() {
    setErr(null);
    try {
      const sel = await electron.selectFolder();
      if (!sel) return;
      await electron.addFolder(sel.path);
      await refresh();
    } catch (e) { setErr(e.message); }
  }

  async function handleRemove(id) {
    if (!confirm('Remove this folder and all its indexed images?')) return;
    try {
      await electron.removeFolder(id);
      await refresh();
    } catch (e) { setErr(e.message); }
  }

  async function handleIndex(id) {
    if (indexing) return;
    setErr(null);
    setIndexing(true);
    setIndexFolderId(id);
    setIndexProgress(null);
    try {
      await electron.startIndexing(id);
      await refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setIndexing(false);
      setIndexProgress(null);
      setIndexFolderId(null);
    }
  }

  return (
    <aside className="w-72 shrink-0 bg-bg-panel border-r border-border-subtle flex flex-col">
      <div className="px-5 pt-5 pb-3">
        <h1 className="text-base font-semibold tracking-tight">CLIP Search</h1>
        <p className="text-xs text-text-muted mt-1">{stats.totalImages.toLocaleString()} images indexed</p>
      </div>

      <div className="px-5 py-3 border-b border-border-subtle">
        <button
          onClick={handleAddFolder}
          disabled={indexing}
          className="w-full px-3 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition"
        >
          + Add Folder
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {folders.length === 0 && (
          <p className="px-2 text-xs text-text-muted">No folders yet. Add one to begin.</p>
        )}
        {folders.map(f => {
          const isThisIndexing = indexing && indexFolderId === f.id;
          const pct = indexProgress && indexProgress.total
            ? Math.round((indexProgress.current / indexProgress.total) * 100)
            : 0;
          return (
            <div key={f.id} className="group bg-bg-card border border-border-subtle rounded-md p-2.5 hover:border-border transition">
              <div className="text-xs font-medium truncate" title={f.path}>{f.path.split(/[\\/]/).pop()}</div>
              <div className="text-[10px] text-text-muted truncate mt-0.5" title={f.path}>{f.path}</div>
              <div className="flex items-center justify-between mt-2 text-[10px] text-text-secondary">
                <span>{f.image_count} images</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleIndex(f.id)}
                    disabled={indexing}
                    className="px-2 py-0.5 bg-bg-hover hover:bg-border-subtle disabled:opacity-50 rounded text-text-primary"
                    title="Scan and index this folder"
                  >
                    {isThisIndexing ? `${pct}%` : 'Index'}
                  </button>
                  <button
                    onClick={() => handleRemove(f.id)}
                    disabled={indexing}
                    className="px-2 py-0.5 bg-bg-hover hover:bg-red-900 disabled:opacity-50 rounded"
                    title="Remove folder"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {isThisIndexing && (
                <div className="mt-2">
                  <div className="h-1 bg-bg-hover rounded overflow-hidden">
                    <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  {indexProgress && (
                    <div className="text-[10px] text-text-muted mt-1 truncate">
                      {indexProgress.current}/{indexProgress.total} — {indexProgress.file}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {err && (
        <div className="px-5 py-2 text-xs text-red-400 border-t border-border-subtle">
          {err}
        </div>
      )}
    </aside>
  );
}
