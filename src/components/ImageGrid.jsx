import { useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from '../store/useStore';

const CARD_SIZE = 184;
const GAP = 14;

function scoreColor(score) {
  if (score >= 0.45) return '#3fb950';   // strong match — green
  if (score >= 0.35) return '#d29922';   // medium — amber
  return '#8b949e';                       // weak — grey
}

export default function ImageGrid() {
  const results = useStore(s => s.results);
  const query   = useStore(s => s.query);
  const searching = useStore(s => s.searching);
  const setSelectedImage = useStore(s => s.setSelectedImage);

  const parentRef = useRef(null);

  const [cols, rows] = useMemo(() => {
    const w = parentRef.current?.clientWidth || 1200;
    const c = Math.max(1, Math.floor((w + GAP) / (CARD_SIZE + GAP)));
    const r = Math.ceil(results.length / c);
    return [c, r];
  }, [results.length]);

  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_SIZE + GAP,
    overscan: 3
  });

  // Empty states
  if (results.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted select-none">
        {searching ? (
          <div className="text-center">
            <div className="spinner mx-auto mb-3" />
            <div className="text-sm">Searching…</div>
          </div>
        ) : query.trim() ? (
          <div className="text-center max-w-sm px-6">
            <div className="text-3xl mb-3 opacity-40">⌕</div>
            <div className="text-sm text-text-secondary">No matches for “{query}”</div>
            <div className="text-xs mt-1.5">Try describing the item differently — material, shape, or colour.</div>
          </div>
        ) : (
          <div className="text-center max-w-sm px-6">
            <div className="text-3xl mb-3 opacity-40">⌕</div>
            <div className="text-sm text-text-secondary">Search your catalogue</div>
            <div className="text-xs mt-1.5">Describe what you're looking for — e.g. “round wooden tray”, “iron caddy with handle”.</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto px-6 py-4">
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-sm font-medium text-text-primary">{results.length}</span>
        <span className="text-xs text-text-muted">
          {results.length === 1 ? 'result' : 'results'} for
        </span>
        <span className="text-xs text-text-secondary truncate">“{query}”</span>
      </div>

      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: 'relative',
          width: '100%'
        }}
      >
        {rowVirtualizer.getVirtualItems().map(virtualRow => {
          const rowIdx = virtualRow.index;
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, ${CARD_SIZE}px)`,
                gap: `${GAP}px`
              }}
            >
              {Array.from({ length: cols }).map((_, colIdx) => {
                const idx = rowIdx * cols + colIdx;
                const item = results[idx];
                if (!item) return null;
                const pct = Math.round(item.score * 100);
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedImage(item)}
                    className="card group relative bg-bg-card border border-border-subtle rounded-lg overflow-hidden focus:outline-none"
                    style={{ width: CARD_SIZE, height: CARD_SIZE }}
                  >
                    <div className="w-full h-full overflow-hidden">
                      <img
                        src={`thumb://image/${item.id}`}
                        alt={item.filename}
                        loading="lazy"
                        className="card-img w-full h-full object-cover"
                      />
                    </div>

                    {/* score badge — top right */}
                    <div
                      className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold tabular-nums"
                      style={{
                        background: 'rgba(0,0,0,0.72)',
                        color: scoreColor(item.score)
                      }}
                    >
                      {pct}%
                    </div>

                    {/* filename — bottom */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pt-5 pb-1.5 text-left">
                      <div className="text-[10px] font-medium text-text-primary truncate">
                        {item.filename}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
