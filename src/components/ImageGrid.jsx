import { useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from '../store/useStore';

const CARD_SIZE = 180;
const GAP = 12;

export default function ImageGrid() {
  const results = useStore(s => s.results);
  const query   = useStore(s => s.query);
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

  if (results.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        {query.trim()
          ? <div className="text-center"><div className="text-sm">No matches for "{query}"</div><div className="text-xs mt-1">Try a different description.</div></div>
          : <div className="text-center"><div className="text-sm">Type a description to search</div><div className="text-xs mt-1">Natural language works best: "wood handle caddy", "round tray"</div></div>
        }
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto px-6 py-4">
      <div className="text-xs text-text-muted mb-3">{results.length} results</div>
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
                return (
                  <button
                    key={item.id}
                    onClick={() => setSelectedImage(item)}
                    className="group relative bg-bg-card border border-border-subtle hover:border-accent rounded-md overflow-hidden transition focus:outline-none focus:border-accent"
                    style={{ width: CARD_SIZE, height: CARD_SIZE }}
                  >
                    <img
                      src={`thumb://image/${item.id}`}
                      alt={item.filename}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 to-transparent p-2 text-left">
                      <div className="text-[10px] font-medium truncate">{item.filename}</div>
                      <div className="text-[9px] text-text-muted">score {item.score.toFixed(3)}</div>
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
