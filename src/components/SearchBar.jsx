import { useEffect } from 'react';
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
    </div>
  );
}
