import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { electron } from '../hooks/useElectronAPI';

function formatEta(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return Math.round(seconds) + 's';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return m + 'm ' + s + 's';
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
}

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
  const [indexStartTime, setIndexStartTime] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const unsubsRef = useRef([]);

  async function refresh() {
    try {
      const list = await electron.listFolders();
      setFolders(list);
      const s = await electron.getStats();
      setStats(s);
    } catch (e) { setErr(e.message); }
  }

  useEffect(() => {
    refresh();

    // Subscribe to indexing events from main process
    const unsubProgress = electron.on('indexing:progress', (d) => setIndexProgress(d));
    const unsubScanned  = electron.on('indexing:scanned',  (d) => setIndexProgress({ current: 0, total: d.total, file: '' }));
    const unsubComplete = electron.on('indexing:complete', () => {
      // refresh happens in handleIndex finally
    });
    const unsubError    = electron.on('indexing:error',    (d) => setErr(d.error || 'Indexing failed'));

    unsubsRef.current = [unsubProgress, unsubScanned, unsubComplete, unsubError];
    return () => {
      for (const fn of unsubsRef.current) { try { fn && fn(); } catch {} }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setIndexStartTime(Date.now());
    setCancelling(false);
    try {
      await electron.startIndexing(id);
      await refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setIndexing(false);
      setIndexProgress(null);
      setIndexFolderId(null);
      setIndexStartTime(null);
      setCancelling(false);
    }
  }

  async function handleCancel() {
    if (!indexing || cancelling) return;
    setCancelling(true);
    try {
      await electron.cancelIndexing();
    } catch (e) {
      setErr(e.message);
      setCancelling(false);
    }
  }

  // Compute ETA from elapsed time and progress
  function getEta() {
    if (!indexProgress || !indexStartTime || !indexProgress.current || indexProgress.current < 2) return null;
    const elapsedMs = Date.now() - indexStartTime;
    const avgMs = elapsedMs / indexProgress.current;
    const remaining = indexProgress.total - indexProgress.current;
    return formatEta((avgMs * remaining) / 1000);
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
          const eta = isThisIndexing ? getEta() : null;
          return (
            <div key={f.id} className="group bg-bg-card border border-border-subtle rounded-md p-2.5 hover:border-border transition">
              <div className="text-xs font-medium truncate" title={f.path}>{f.path.split(/[\\/]/).pop()}</div>
              <div className="text-[10px] text-text-muted truncate mt-0.5" title={f.path}>{f.path}</div>
              <div className="flex items-center justify-between mt-2 text-[10px] text-text-secondary">
                <span>{f.image_count} images</span>
                <div className="flex gap-1">
                  {isThisIndexing ? (
                    <button
                      onClick={handleCancel}
                      disabled={cancelling}
                      className="px-2 py-0.5 bg-red-900/50 hover:bg-red-900 disabled:opacity-50 rounded text-red-200"
                      title="Cancel indexing"
                    >
                      {cancelling ? 'Cancelling…' : 'Cancel'}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => handleIndex(f.id)}
                        disabled={indexing}
                        className="px-2 py-0.5 bg-bg-hover hover:bg-border-subtle disabled:opacity-50 rounded text-text-primary"
                        title="Scan and index this folder"
                      >
                        Index
                      </button>
                      <button
                        onClick={() => handleRemove(f.id)}
                        disabled={indexing}
                        className="px-2 py-0.5 bg-bg-hover hover:bg-red-900 disabled:opacity-50 rounded"
                        title="Remove folder"
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
              {isThisIndexing && (
                <div className="mt-2">
                  <div className="h-1 bg-bg-hover rounded overflow-hidden">
                    <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-text-muted mt-1">
                    <span className="truncate">
                      {indexProgress
                        ? `${indexProgress.current}/${indexProgress.total} — ${indexProgress.file}`
                        : 'Scanning…'}
                    </span>
                    {eta && <span className="shrink-0 ml-2">ETA {eta}</span>}
                  </div>
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
