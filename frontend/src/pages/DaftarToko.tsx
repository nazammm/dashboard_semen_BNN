import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { MONTHS_ID, dailyFreshness, fmt, fmtIDR, relDate, uniqueTokoStats } from '../lib/format';
import type { Row } from '../lib/types';
import { Badge, Chip, ErrorBox, ExportButton, Kpi, PageHeader, PageSkeleton, Th } from '../components/ui';

const PAGE_SIZE = 50;

const hasGeo = (t: Row) => {
  const lat = Number(t.latitude), lng = Number(t.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
};

interface Filters { q: string; dist: string; zona: string; status: 'all' | 'active' | 'inactive'; dateFrom: string; dateTo: string }
const EMPTY: Filters = { q: '', dist: 'all', zona: 'all', status: 'all', dateFrom: '', dateTo: '' };

/** Opsi Wilayah hanya dari toko milik distributor terpilih; sebaliknya untuk Distributor (saling menyempitkan). */
const zonaOptionsFor = (rows: Row[], dist: string): string[] =>
  [...new Set((dist === 'all' ? rows : rows.filter(t => t.dist_code === dist)).map(t => t.zona as string).filter(Boolean))].sort();
const distOptionsFor = (rows: Row[], zona: string): [string, string][] =>
  [...new Map((zona === 'all' ? rows : rows.filter(t => t.zona === zona)).map(t => [t.dist_code as string, t.dist_name as string] as [string, string])).entries()]
    .filter(([code]) => code).sort((a, b) => (a[1] || '').localeCompare(b[1] || ''));

function compare(a: Row, b: Row, key: string, dir: 1 | -1): number {
  const av = a[key], bv = b[key];
  if (key === 'last_transaction') { // yang kosong selalu di belakang, apa pun arahnya
    if (!av && !bv) return 0;
    if (!av) return 1; if (!bv) return -1;
    return dir * String(av).localeCompare(String(bv));
  }
  if (typeof av === 'boolean' || typeof bv === 'boolean') return dir * ((bv ? 1 : 0) - (av ? 1 : 0));
  if (typeof av === 'string' || typeof bv === 'string') return dir * String(av || '').localeCompare(String(bv || ''), 'id', { numeric: true, sensitivity: 'base' });
  return dir * ((av || 0) - (bv || 0));
}

const I = (d: string) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

export default function DaftarToko() {
  useDocTitle('Daftar Toko');
  const load = useAsync(async () => {
    const monthly = await DataSource.monthlyTotals();
    const months2026 = monthly.filter(r => r.year === 2026).map(r => Number(r.month));
    const year = 2026, month = months2026.length ? Math.max(...months2026) : 8;
    const [tokoMaster, tokoStats, freshnessData] = await Promise.all([DataSource.tokoMaster(), DataSource.tokoMonthly(year, month), DataSource.dataFreshness()]);
    // Toko bisa muncul >1 kali (1 baris per distributor) -> kunci gabungan toko+distributor
    const statsByCode = new Map(tokoStats.map(t => [t.cust_code + '|' + t.dist_code, t]));
    const merged: Row[] = tokoMaster.map(t => {
      const s = statsByCode.get(t.cust_code + '|' + t.dist_code);
      return { ...t, total_qty: Number(s?.total_qty || 0), net_amount: Number(s?.net_amount || 0), is_active: !!s?.is_active, last_transaction: s?.last_transaction || null };
    });
    return { year, month, merged, freshness: dailyFreshness(freshnessData) };
  }, []);

  if (load.error) return <ErrorBox error={load.error} />;
  if (!load.data) return <PageSkeleton />;
  return <DaftarTokoView {...load.data} />;
}

function DaftarTokoView({ year, month, merged, freshness }: { year: number; month: number; merged: Row[]; freshness: ReturnType<typeof dailyFreshness> }) {
  const [f, setF] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState('cust_code');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const tableRef = useRef<HTMLTableElement>(null);

  const set = (patch: Partial<Filters>) => { setF(p => ({ ...p, ...patch })); setPage(1); };
  const zonaOpts = useMemo(() => zonaOptionsFor(merged, f.dist), [merged, f.dist]);
  const distOpts = useMemo(() => distOptionsFor(merged, f.zona), [merged, f.zona]);

  const onDist = (dist: string) => {
    // pilihan wilayah lama yang bukan milik distributor baru -> balik ke "Semua"
    const zona = f.zona !== 'all' && !zonaOptionsFor(merged, dist).includes(f.zona) ? 'all' : f.zona;
    set({ dist, zona });
  };
  const onZona = (zona: string) => {
    const dist = f.dist !== 'all' && !distOptionsFor(merged, zona).some(([c]) => c === f.dist) ? 'all' : f.dist;
    set({ zona, dist });
  };
  // "Dari" tidak boleh lebih besar dari "Sampai": tolak perubahan + beri tahu
  const onDate = (key: 'dateFrom' | 'dateTo', v: string) => {
    const from = key === 'dateFrom' ? v : f.dateFrom, to = key === 'dateTo' ? v : f.dateTo;
    if (from && to && from > to) { alert('Tanggal "Dari" tidak boleh lebih besar dari tanggal "Sampai". Periksa kembali rentang tanggalnya.'); return; }
    set({ [key]: v } as Partial<Filters>);
  };

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return merged.filter(t => {
      if (f.dist !== 'all' && t.dist_code !== f.dist) return false;
      if (f.zona !== 'all' && t.zona !== f.zona) return false;
      if (f.status === 'active' && !t.is_active) return false;
      if (f.status === 'inactive' && t.is_active) return false;
      // last_transaction string mentah "YYYY-MM-DD": bisa dibandingkan langsung dengan <input type=date>
      if (f.dateFrom && (!t.last_transaction || t.last_transaction < f.dateFrom)) return false;
      if (f.dateTo && (!t.last_transaction || t.last_transaction > f.dateTo)) return false;
      if (q && !`${t.cust_code} ${t.cust_name}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [merged, f]);
  const sorted = useMemo(() => filtered.slice().sort((a, b) => compare(a, b, sortKey, sortDir)), [filtered, sortKey, sortDir]);

  const anyFilter = f.q.trim() !== '' || f.dist !== 'all' || f.zona !== 'all' || f.status !== 'all' || !!f.dateFrom || !!f.dateTo;
  // KPI = toko UNIK (toko >1 distributor dihitung sekali); tabel tetap satu baris per (toko, distributor)
  const us = useMemo(() => uniqueTokoStats(filtered, hasGeo), [filtered]);
  const totalUnik = useMemo(() => uniqueTokoStats(merged, hasGeo).total, [merged]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const cur = Math.min(Math.max(1, page), totalPages);
  const pageRows = sorted.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);
  const go = (p: number) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const onSort = (k: string) => { setSortDir(sortKey === k ? (d => (d === 1 ? -1 : 1))(sortDir) : 1); setSortKey(k); setPage(1); };
  const ariaSort = (k: string) => (sortKey === k ? (sortDir === 1 ? 'ascending' : 'descending') as 'ascending' | 'descending' : undefined);

  /** Export dari SEMUA baris hasil filter (bukan hanya halaman yang tampil): tabel dibangun terlepas dari DOM. */
  const buildExportTable = (): HTMLTableElement => {
    const tbl = document.createElement('table');
    const addRow = (cells: string[], parent: HTMLElement) => {
      const tr = document.createElement('tr');
      cells.forEach(c => { const td = document.createElement('td'); td.textContent = c; tr.append(td); });
      parent.append(tr);
    };
    const head = document.createElement('thead'), body = document.createElement('tbody');
    addRow(['Kode', 'Nama Toko', 'Kode Distributor', 'Distributor', 'Wilayah', `Status ${MONTHS_ID[month]}`, 'Tonase', 'Amount', 'Transaksi Terakhir'], head);
    sorted.forEach(t => addRow([
      String(t.cust_code ?? ''), String(t.cust_name ?? ''), String(t.dist_code ?? ''), String(t.dist_name ?? ''), String(t.zona ?? ''),
      t.is_active ? 'Aktif' : 'Nonaktif', String(Math.round(t.total_qty * 100) / 100), String(Math.round(t.net_amount)), t.last_transaction || '',
    ], body));
    tbl.append(head, body);
    return tbl;
  };

  return (
    <div>
      <PageHeader title="Daftar Toko" desc={`Operasional · ${MONTHS_ID[month]} ${year}`} status={freshness.status} statusVariant={freshness.statusVariant}>
        <div className="controls !mb-0">
          <div className="control flex-[1_1_220px]">
            <label htmlFor="dtSearch">Cari Toko</label>
            <input type="text" id="dtSearch" placeholder="Nama atau kode toko…" autoComplete="off" value={f.q} onChange={e => set({ q: e.target.value })} />
          </div>
          <div className="control">
            <label htmlFor="dtDist">Distributor</label>
            <select id="dtDist" aria-label="Filter distributor" value={f.dist} onChange={e => onDist(e.target.value)}>
              <option value="all">Semua Distributor</option>
              {distOpts.map(([code, name]) => <option key={code} value={code}>{name || code}</option>)}
            </select>
          </div>
          <div className="control">
            <label htmlFor="dtZona">Wilayah</label>
            <select id="dtZona" aria-label="Filter wilayah/zona" value={f.zona} onChange={e => onZona(e.target.value)}>
              <option value="all">Semua Wilayah</option>
              {zonaOpts.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="control">
            <span id="dtStatusLabel" className="control-group-label">Status</span>
            <div className="pill-row" role="group" aria-labelledby="dtStatusLabel">
              <Chip active={f.status === 'all'} onClick={() => set({ status: 'all' })}>Semua</Chip>
              <Chip active={f.status === 'active'} onClick={() => set({ status: 'active' })}>Aktif</Chip>
              <Chip active={f.status === 'inactive'} onClick={() => set({ status: 'inactive' })}>Nonaktif</Chip>
            </div>
          </div>
          <div className="control">
            <label htmlFor="dtDateFrom">Transaksi Terakhir</label>
            <div className="flex items-center gap-2 px-2 py-[5px] rounded-md border border-line-strong bg-surface2 focus-within:border-accent [&_input]:!border-0 [&_input]:!bg-transparent [&_input]:!px-0.5 [&_input]:!py-0.5 [&_input]:w-[122px] [&_input:focus]:!outline-none">
              <div className="flex flex-col gap-px">
                <span className="font-mono text-[9px] uppercase text-faint px-0.5" style={{ letterSpacing: '.07em' }}>Dari</span>
                <input type="date" id="dtDateFrom" aria-label="Transaksi terakhir dari tanggal" value={f.dateFrom} onChange={e => onDate('dateFrom', e.target.value)} />
              </div>
              <span className="text-faint opacity-70 shrink-0 self-end mb-1.5 [&_svg]:w-[13px] [&_svg]:h-[13px] [&_svg]:block" aria-hidden="true">{I('M5 12h14M13 6l6 6-6 6')}</span>
              <div className="flex flex-col gap-px">
                <span className="font-mono text-[9px] uppercase text-faint px-0.5" style={{ letterSpacing: '.07em' }}>Sampai</span>
                <input type="date" id="dtDateTo" aria-label="Transaksi terakhir sampai tanggal" value={f.dateTo} onChange={e => onDate('dateTo', e.target.value)} />
              </div>
            </div>
          </div>
          <div className="control">
            <span className="control-group-label">&nbsp;</span>
            <div className="flex gap-2">
              <button type="button" className="btn" style={{ padding: '6px 12px', fontSize: '12.5px' }} onClick={() => { setF(EMPTY); setPage(1); }}>Reset Filter</button>
              <ExportButton pageId="daftar-toko" filename={`daftar-toko-${MONTHS_ID[month]}-${year}.xlsx`} getTables={() => [{ name: 'Daftar Toko', el: buildExportTable() }]} />
            </div>
          </div>
        </div>
      </PageHeader>

      <div className="grid-kpi mt-5 mb-[22px]">
        <Kpi title={anyFilter ? 'Toko Cocok Filter' : 'Toko Terdaftar'} value={fmt(us.total)} icon={I('M4 10 12 4l8 6M5 9.5V20h14V9.5M9.5 20v-6h5v6')} iconTone="neutral"
          delta={anyFilter ? `dari ${fmt(totalUnik)} total toko` : undefined} />
        <Kpi title={`Aktif ${MONTHS_ID[month]} ${year}`} value={fmt(us.active)} icon={I('M20 6.5 10 17 4 11.3')} iconTone="good"
          delta={`${us.total ? (us.active / us.total * 100).toFixed(1) : '0.0'}% dari toko ini`} />
        <Kpi title={`Nonaktif ${MONTHS_ID[month]} ${year}`} value={fmt(us.total - us.active)} icon={I('M6 6l12 12M18 6 6 18')} iconTone="bad" />
        <Kpi title="Tanpa Titik Koordinat" value={fmt(us.noGeo)} icon={I('M12 21s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12ZM9 9l6 6M15 9l-6 6')} iconTone="warn" />
      </div>

      <div className="table-wrap">
        <table className="mono" ref={tableRef}>
          <thead>
            <tr>
              <Th sortable ariaSort={ariaSort('cust_code')} onSort={() => onSort('cust_code')}>Kode</Th>
              <Th sortable ariaSort={ariaSort('cust_name')} onSort={() => onSort('cust_name')}>Nama Toko</Th>
              <Th sortable ariaSort={ariaSort('dist_code')} onSort={() => onSort('dist_code')}>Distributor</Th>
              <Th sortable ariaSort={ariaSort('zona')} onSort={() => onSort('zona')}>Wilayah</Th>
              <Th sortable ariaSort={ariaSort('is_active')} onSort={() => onSort('is_active')}>Status {MONTHS_ID[month]}</Th>
              <Th sortable num ariaSort={ariaSort('total_qty')} onSort={() => onSort('total_qty')}>Tonase</Th>
              <Th sortable num ariaSort={ariaSort('net_amount')} onSort={() => onSort('net_amount')}>Amount</Th>
              <Th sortable ariaSort={ariaSort('last_transaction')} onSort={() => onSort('last_transaction')}>Transaksi Terakhir</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={9} className="text-center text-faint p-6">Tidak ada toko yang cocok dengan filter ini.</td></tr>
            ) : pageRows.map(t => (
              <tr key={t.cust_code + '|' + t.dist_code}>
                <td className="mono">{t.cust_code}</td>
                <td>
                  <Link className="cell-link" to={`/toko-detail?code=${encodeURIComponent(t.cust_code)}&from=daftar-toko`} title={`Lihat detail toko ${t.cust_name || t.cust_code}`}>{t.cust_name || '–'}</Link>
                </td>
                <td><span className="tag-code">{t.dist_code || '–'}</span> {t.dist_name || ''}</td>
                <td>{t.zona || '–'}</td>
                <td>{t.is_active ? <Badge variant="good">Aktif</Badge> : <Badge variant="bad">Nonaktif</Badge>}</td>
                <td className="num mono">{fmt(t.total_qty, 1)}</td>
                <td className="num mono">{fmtIDR(t.net_amount)}</td>
                <td>{relDate(t.last_transaction)}</td>
                <td>
                  {hasGeo(t)
                    ? <Link className="cell-link" to={`/peta-toko?focus=${encodeURIComponent(t.cust_code)}`} title={`Lihat ${t.cust_name || t.cust_code} di peta`}>Peta</Link>
                    : <span className="text-faint text-xs">&ndash;</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-2.5 mt-3.5 flex-wrap">
        <span className="font-mono text-[12.5px] text-faint">{fmt(sorted.length)} toko cocok &middot; Halaman {cur} / {totalPages}</span>
        <div className="flex gap-2">
          <button type="button" className="btn" disabled={cur <= 1} onClick={() => go(cur - 1)}>&larr; Sebelumnya</button>
          <button type="button" className="btn" disabled={cur >= totalPages} onClick={() => go(cur + 1)}>Selanjutnya &rarr;</button>
        </div>
      </div>
    </div>
  );
}
