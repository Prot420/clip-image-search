import { useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { electron } from '../hooks/useElectronAPI';
import { useDebounce } from '../hooks/useDebounce';

export default function SearchBar() {
  const query      = useStore(s => s.query);
  const setQuery   = useStore(s => s.setQuery);
  const setResults = useStore(s => s.setResults);
  const setSearching = useStore(s => s.setSearching);
  const searching  = useStore(s => s.searching);
  const setSearchMode = useStore(s => s.setSearchMode);
  const results        = useStore(s => s.results);
  const activeCategory = useStore(s => s.activeCategory);
  const setActiveCategory = useStore(s => s.setActiveCategory);

  // Categories actually present in the current results — chips only
  // appear for what's on screen, never a fixed hard-coded list.
  const availableCategories = useMemo(() => {
    const counts = new Map();
    for (const r of results) {
      if (r.category) counts.set(r.category, (counts.get(r.category) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [results]);

  const debouncedQuery = useDebounce(query, 250);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!debouncedQuery || !debouncedQuery.trim()) {
        setResults([]);
        return;
      }
      setSearching(true);
      setSearchMode('text');
      try {
        const r = await electron.searchByText(debouncedQuery);
        if (!cancelled) setResults(r);
      } catch (e) {
        console.error('Search failed:', e);
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [debouncedQuery, setResults, setSearching, setSearchMode]);

  return (
    <div className="px-6 py-4 border-b border-border-subtle bg-bg-panel">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder='Describe an item — “wood handle caddy”, “round lazy susan”, “gold metal bowl”…'
          className="w-full bg-bg-card border border-border-subtle focus:border-accent text-text-primary placeholder-text-muted pl-4 pr-24 py-3 rounded-md outline-none transition"
          autoFocus
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-xs text-text-muted">
            <span className="spinner-sm" />
            Searching
          </span>
        )}
        {!searching && query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary text-sm transition"
            title="Clear"
          >
            ✕
          </button>
        )}
      </div>

      {availableCategories.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          <span className="text-[10px] uppercase tracking-wide text-text-muted mr-0.5">
            Filter
          </span>
          {availableCategories.map(([cat, count]) => {
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(active ? null : cat)}
                className={
                  'px-2.5 py-1 rounded-full text-[11px] font-medium border transition ' +
                  (active
                    ? 'bg-accent border-accent text-white'
                    : 'bg-bg-card border-border-subtle text-text-secondary hover:border-border hover:text-text-primary')
                }
              >
                {cat} <span className="opacity-60 tabular-nums">{count}</span>
              </button>
            );
          })}
          {activeCategory && (
            <button
              onClick={() => setActiveCategory(null)}
              className="px-2 py-1 text-[11px] text-text-muted hover:text-text-primary transition"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
