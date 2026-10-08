import { useEffect, useMemo, useRef, useState } from 'react';

export interface AsyncState<T> { data: T | null; error: Error | null; loading: boolean }

/** Jalankan loader async; hasil lama diabaikan kalau deps berubah / komponen dilepas. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState(s => ({ data: s.data, error: null, loading: true }));
    loader().then(
      data => { if (alive) setState({ data, error: null, loading: false }); },
      error => { if (alive) setState({ data: null, error: error instanceof Error ? error : new Error(String(error)), loading: false }); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export type SortDir = 'asc' | 'desc';
/** Sorting tabel klik-header. */
export function useSort<T>(rows: T[], initialKey: string, initialDir: SortDir, getValue: (row: T, key: string) => string | number | null | undefined) {
  const [key, setKey] = useState(initialKey);
  const [dir, setDir] = useState<SortDir>(initialDir);
  const sorted = useMemo(() => {
    const out = rows.slice();
    out.sort((a, b) => {
      const va = getValue(a, key), vb = getValue(b, key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'id');
      return dir === 'asc' ? c : -c;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, key, dir]);
  const toggle = (k: string) => {
    if (k === key) setDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setKey(k); setDir('desc'); }
  };
  const ariaSort = (k: string) => (k === key ? (dir === 'asc' ? 'ascending' : 'descending') as 'ascending' | 'descending' : undefined);
  return { sorted, sortKey: key, sortDir: dir, toggle, ariaSort };
}

/** Judul tab. */
export function useDocTitle(title: string) {
  useEffect(() => { document.title = `${title} — Dashboard Distribusi`; }, [title]);
}

/** Nilai terakhir yang stabil (debounce). */
export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  const t = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { clearTimeout(t.current); t.current = setTimeout(() => setV(value), ms); return () => clearTimeout(t.current); }, [value, ms]);
  return v;
}
