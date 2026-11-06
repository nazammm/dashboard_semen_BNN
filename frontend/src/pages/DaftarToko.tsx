import { useMemo, useRef, useState } from 'react';
import { DataBadge } from '../components/DataStatus';
import { Link } from 'react-router-dom';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { MONTHS_ID, fmt, fmtIDR, relDate, uniqueTokoStats } from '../lib/format';
import type { Row } from '../lib/types';
import { Chip, ErrorBox, ExportButton, FilterBar, Kpi, PageHeader, PageSkeleton, Th, TokoStatusBadge } from '../components/ui';
import { DateRangePicker, type RangePreset } from '../components/DateRangePicker';
import { addDays, addMonths, endOfMonth, isISO, startOfMonth } from '../lib/dates';

const PAGE_SIZE = 50;

const hasGeo = (t: Row) => {
  const lat = Number(t.latitude), lng = Number(t.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
};

interface Filters { q: string; dist: string; zona: string; status: 'all' | 'active' | 'inactive' | 'subdist'; dateFrom: string; dateTo: string }
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
      return { ...t, total_qty: Number(s?.total_qty || 0), net_amount: Number(s?.net_amount || 0), is_active: !!s?.is_active, is_subdist: !!s?.is_subdist, last_transaction: s?.last_transaction || null };
    });
    const raw = String(freshnessData?.max_do_date ?? '').slice(0, 10);
    return { year, month, merged, lastDay: isISO(raw) ? raw : '' };
  }, []);

  if (load.error) return <ErrorBox error={load.error} />;
  if (!load.data) return <PageSkeleton />;
  return <DaftarTokoView {...load.data} />;
}

/** Preset "Transaksi Terakhir", relatif terhadap tanggal data terakhir. "Lebih dari N bulan lalu" = toko yang lama tidak belanja. */
function lastTxPresets(last: string, earliest: string): RangePreset[] {
  const prevMonth = addMonths(startOfMonth(last), -1);
  return [
    { label: '7 hari terakhir', range: { from: addDays(last, -6), to: last } },
    { label: '30 hari terakhir', range: { from: addDays(last, -29), to: last } },
    { label: 'Bulan berjalan', range: { from: startOfMonth(last), to: last } },
    { label: 'Bulan lalu', range: { from: prevMonth, to: endOfMonth(prevMonth) } },
    { label: 'Lebih dari 1 bulan lalu', range: { from: earliest, to: addMonths(last, -1) } },
    { label: 'Lebih dari 3 bulan lalu', range: { from: earliest, to: addMonths(last, -3) } },
    { label: 'Lebih dari 6 bulan lalu', range: { from: earliest, to: addMonths(last, -6) } },
  ].filter(p => p.range.from <= p.range.to);
}

function DaftarTokoView({ year, month, merged, lastDay }: { year: number; month: number; merged: Row[]; lastDay: string }) {
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
  // Batas kalender: transaksi terakhir paling lama s.d. tanggal data terakhir
  const { earliest, latest } = useMemo(() => {
    let lo = '', hi = '';
    merged.forEach(t => { const d = String(t.last_transaction || '').slice(0, 10); if (!isISO(d)) return; if (!lo || d < lo) lo = d; if (!hi || d > hi) hi = d; });
    const last = lastDay || hi || new Date().toISOString().slice(0, 10);
    return { earliest: lo || addMonths(last, -24), latest: last };
  }, [merged, lastDay]);
  const presets = useMemo(() => lastTxPresets(latest, earliest), [latest, earliest]);

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return merged.filter(t => {
      if (f.dist !== 'all' && t.dist_code !== f.dist) return false;
      if (f.zona !== 'all' && t.zona !== f.zona) return false;
      if (f.status === 'active' && !t.is_active) return false;
      if (f.status === 'inactive' && (t.is_active || t.is_subdist)) return false;
      if (f.status === 'subdist' && !t.is_subdist) return false;
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
  const hasSubdist = useMemo(() => merged.some(t => t.is_subdist), [merged]);

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
      t.is_subdist ? 'Subdist' : t.is_active ? 'Aktif' : 'Nonaktif', String(Math.round(t.total_qty * 100) / 100), String(Math.round(t.net_amount)), t.last_transaction || '',
    ], body));
    tbl.append(head, body);
    return tbl;
  };

  return (
    <div>
      <PageHeader title="Daftar Toko" desc={`Status aktif dan tonase: ${MONTHS_ID[month]} ${year}`} status={<DataBadge source="transaksi" />} />

      <FilterBar label="Filter Daftar Toko" stickyMobile={false}>
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
            {hasSubdist && <Chip active={f.status === 'subdist'} onClick={() => set({ status: 'subdist' })}>Subdist</Chip>}
          </div>
        </div>
        <DateRangePicker label="Transaksi Terakhir" value={{ from: f.dateFrom, to: f.dateTo }} placeholder="Semua tanggal" allowClear
          min={earliest} max={latest} presets={presets} onChange={r => set({ dateFrom: r.from, dateTo: r.to })} />
        <div className="control">
          <span className="control-group-label">&nbsp;</span>
          <div className="flex gap-2">
            <button type="button" className="btn" style={{ padding: '6px 12px', fontSize: '12.5px' }} onClick={() => { setF(EMPTY); setPage(1); }}>Reset Filter</button>
            <ExportButton pageId="daftar-toko" filename={`daftar-toko-${MONTHS_ID[month]}-${year}.xlsx`} getTables={() => [{ name: 'Daftar Toko', el: buildExportTable() }]} />
          </div>
        </div>
      </FilterBar>

      <div className="grid-kpi mt-5 mb-[22px]">
        {f.status === 'subdist'
          ? <Kpi title="Subdist Cocok Filter" value={fmt(us.subdist)} delta="Bukan toko: tidak dihitung toko aktif" />
          : <Kpi title={anyFilter ? 'Toko Cocok Filter' : 'Toko Terdaftar'} value={fmt(us.total)}
              delta={[anyFilter ? `dari ${fmt(totalUnik)} total toko` : '', us.subdist ? `${fmt(us.subdist)} subdist tidak dihitung` : ''].filter(Boolean).join(' · ') || undefined} />}
        <Kpi title={`Aktif ${MONTHS_ID[month]} ${year}`} value={fmt(us.active)}
          delta={`${us.total ? (us.active / us.total * 100).toFixed(1) : '0.0'}% dari toko ini`} />
        <Kpi title={`Nonaktif ${MONTHS_ID[month]} ${year}`} value={fmt(us.total - us.active)} />
        <Kpi title="Tanpa Titik Koordinat" value={fmt(us.noGeo)} />
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
                <td><TokoStatusBadge active={t.is_active} subdist={t.is_subdist} /></td>
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
