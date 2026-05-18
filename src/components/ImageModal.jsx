import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { electron } from '../hooks/useElectronAPI';

export default function ImageModal() {
  const selected = useStore(s => s.selectedImage);
  const similar = useStore(s => s.similarImages);
  const setSimilar = useStore(s => s.setSimilarImages);
  const close = useStore(s => s.clearSelectedImage);
  const setSelected = useStore(s => s.setSelectedImage);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      try {
        const sims = await electron.searchBySimilar(selected.id, 12);
        if (!cancelled) setSimilar(sims);
      } catch (e) { console.error(e); }
    })();
    return () => { cancelled = true; };
  }, [selected, setSimilar]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!selected) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex" onClick={close}>
      <div
        className="m-auto w-[90vw] max-w-6xl h-[88vh] bg-bg-panel border border-border-subtle rounded-lg flex overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-1 bg-black flex items-center justify-center p-6 relative">
          <img
            src={`img://image/${selected.id}`}
            alt={selected.filename}
            className="max-w-full max-h-full object-contain"
          />
          <button
            onClick={close}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-bg-card hover:bg-bg-hover text-text-primary text-sm"
          >
            ✕
          </button>
        </div>

        <div className="w-80 shrink-0 border-l border-border-subtle flex flex-col">
          <div className="p-5 border-b border-border-subtle">
            <div className="text-sm font-semibold truncate">{selected.filename}</div>
            <div className="text-[11px] text-text-muted truncate mt-1" title={selected.path}>{selected.path}</div>
            <div className="text-[11px] text-text-muted mt-2">
              {selected.score !== undefined && <span>score {selected.score.toFixed(3)} · </span>}
              {selected.width}×{selected.height}
            </div>
            <button
              onClick={() => electron.revealImage(selected.id)}
              className="mt-3 w-full px-3 py-1.5 bg-bg-card hover:bg-bg-hover border border-border-subtle rounded text-xs"
            >
              Show in folder
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="text-[11px] text-text-muted px-1 mb-2">Similar images</div>
            <div className="grid grid-cols-3 gap-2">
              {similar.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s)}
                  className="aspect-square bg-bg-card rounded overflow-hidden border border-border-subtle hover:border-accent transition"
                  title={`${s.filename} (${s.score.toFixed(3)})`}
                >
                  <img src={`thumb://image/${s.id}`} className="w-full h-full object-cover" alt={s.filename} />
                </button>
              ))}
              {similar.length === 0 && (
                <div className="col-span-3 text-[11px] text-text-muted text-center py-4">Loading...</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
