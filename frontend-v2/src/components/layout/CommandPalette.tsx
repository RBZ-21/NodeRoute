import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { fetchWithAuth } from '../../lib/api';

type SearchResult = { id: string; title: string; subtitle: string; path: string };
type SearchGroup = { type: string; label: string; results: SearchResult[] };

/**
 * Global Cmd/Ctrl+K command palette. Debounced, company-scoped search across
 * orders, customers, invoices, SKUs, and lot numbers. Keyboard navigable;
 * Enter opens the highlighted record.
 */
export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Flat list of results for keyboard navigation.
  const flat = useMemo(() => groups.flatMap((g) => g.results), [groups]);

  // Global hotkey: Cmd/Ctrl+K toggles the palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery(''); setGroups([]); setActiveIndex(0);
      // Focus after the dialog renders.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) { setGroups([]); setLoading(false); return; }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const data = await fetchWithAuth<{ groups: SearchGroup[] }>(`/api/search?q=${encodeURIComponent(q)}`);
        setGroups(data.groups || []);
        setActiveIndex(0);
      } catch {
        setGroups([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open]);

  function go(result: SearchResult) {
    setOpen(false);
    navigate(result.path);
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && flat[activeIndex]) { e.preventDefault(); go(flat[activeIndex]); }
  }

  if (!open) return null;

  let runningIndex = -1;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Global search">
      <div className="absolute inset-0 bg-black/45" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border bg-background shadow-xl">
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search orders, customers, invoices, SKUs, lots…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">ESC</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {loading ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Searching…</div>
          ) : query.trim().length < 2 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Type at least 2 characters to search.</div>
          ) : flat.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">No results for “{query}”.</div>
          ) : (
            groups.map((group) => (
              <div key={group.type} className="mb-1">
                <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</div>
                {group.results.map((result) => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  return (
                    <button
                      key={`${group.type}:${result.id}`}
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => go(result)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${idx === activeIndex ? 'bg-primary/10' : 'hover:bg-muted/60'}`}
                    >
                      <span className="truncate font-medium">{result.title}</span>
                      {result.subtitle ? <span className="truncate text-xs text-muted-foreground">{result.subtitle}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
