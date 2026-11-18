import { useMemo, useState, type ReactNode } from 'react';
import { DataBadge } from '../components/DataStatus';
import { DataSource } from '../lib/data';
import { useAuth } from '../lib/auth';
import { useAsync, useDebounced, useDocTitle, useSort } from '../lib/hooks';
import { COLORS, MONTHS_ID, capaianClass, chartSRSummary, fmt, fmtIDRCompact, pct } from '../lib/format';
import { hariBerjalan } from '../lib/salesman';
import type { Row } from '../lib/types';
import { Badge, Capaian, CellLink, ChartBox, Chip, ErrorBox, FilterBar, Kpi, PageHeader, PageSkeleton, Select, TableWrap, Th } from '../components/ui';

type Sales = Row & { capaian_ta: number; capaian_tonase: number };

export default function TimSales() {
  const { session } = useAuth();
  const bolehLihatTarget = session?.role === 'mo' || session?.role === 'admin';   // hanya Management (+ admin)
  useDocTitle('Tim Sales');
  const { data, error } = useAsync(async () => {
    const [rows, freshnessData, targets] = await Promise.all([
      DataSource.salesman(), DataSource.dataFreshness(),
      bolehLihatTarget ? DataSource.targetSalesman().catch(() => null) : Promise.resolve(null),   // belum ada tabel/endpoint -> blok perbandingan disembunyikan
    ]);
    return { rows, freshnessData, targets };
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <PageSkeleton />;
  return <TimSalesBody rows={data.rows} freshnessData={data.freshnessData} targets={data.targets} />;
}

function TimSalesBody({ rows: allRows, freshnessData, targets }: { rows: Row[]; freshnessData: Row; targets: Row[] | null }) {
  // Periode = tahun-bulan yang punya transaksi salesman (target per tahun). Default: periode terakhir.
  const fallbackYear = Number(String(freshnessData?.max_do_date ?? '').slice(0, 4)) || new Date().getFullYear();
  const yearOf = (r: Row) => (r.tahun == null ? fallbackYear : Number(r.tahun));
  const periods = useMemo(() => [...new Set(allRows.filter(r => r.actual_num_do > 0).map(r => yearOf(r) * 100 + Number(r.month)))].sort((a, b) => a - b),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows]);
  const [period, setPeriod] = useState(() => periods[periods.length - 1] || fallbackYear * 100 + 1);
  const year = Math.floor(period / 100), month = period % 100;
  const rows = useMemo(() => allRows.filter(r => yearOf(r) === year),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, year]);
  const lastMonthOfYear = periods.filter(p => Math.floor(p / 100) === year).reduce((a, p) => Math.max(a, p % 100), month);
  const dists = useMemo(() => [...new Set(rows.map(r => String(r.dist_code)))].sort(), [rows]);

  const [dist, setDist] = useState('all');
  const [topN, setTopN] = useState(10);
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim().toLowerCase(), 150);

  // bulan masih berjalan: tetap dibandingkan dengan target sebulan penuh, hanya diberi keterangan
  const hari = hariBerjalan(year, month, freshnessData?.max_do_date);
  const list = useMemo<Sales[]>(() => rows.filter(r =>
    Number(r.month) === month && (dist === 'all' || r.dist_code === dist) && (r.status === 'Sales Real' || r.status === 'Tanpa target')
  ).map(r => {
    const capaian_ta = pct(r.actual_ta, r.target_ta) ?? -1;
    const capaian_tonase = pct(r.actual_tonase, r.target_tonase) ?? -1;
    return { ...r, capaian_ta, capaian_tonase };
  }), [rows, month, dist]);

  /* ---------- KPI tim: capaian tertimbang (total aktual / total target), bukan rata-rata persen ---------- */
  const sum = (arr: Sales[], k: string) => arr.reduce((a, r) => a + Number(r[k] || 0), 0);
  const withTA = list.filter(r => r.target_ta > 0), withTon = list.filter(r => r.target_tonase > 0);
  const tTA = sum(withTA, 'target_ta'), aTA = sum(withTA, 'actual_ta');
  const tTon = sum(withTon, 'target_tonase'), aTon = sum(withTon, 'actual_tonase');
  const salesAktif = new Set(list.filter(r => r.status === 'Sales Real').map(r => `${r.dist_code}|${r.salesman_code}`)).size;
  const tanpaTarget = list.filter(r => r.status === 'Tanpa target').length;
  const omzetTim = sum(list, 'actual_omzet');
  const targetSales = targets ? targets.filter(t => dist === 'all' || t.dist_code === dist).reduce((a, t) => a + Number(t.target_salesman || 0), 0) : 0;

  /* ---------- daftar salesman: urutan bawaan omzet terbesar ---------- */
  const { sorted, toggle, ariaSort } = useSort<Sales>(list, 'actual_omzet', 'desc', (r, k) => {
    const v = r[k];
    return typeof v === 'string' ? v : (v ?? -1);
  });
  const filtered = query ? sorted.filter(r => `${r.salesman_name} ${r.salesman_code} ${r.dist_code}`.toLowerCase().includes(query)) : sorted;
  const shown = query ? filtered : filtered.slice(0, topN);
  const hdr = (k: string, text: ReactNode, num?: boolean, title?: string) => <Th sortable num={num} ariaSort={ariaSort(k)} onSort={() => toggle(k)} title={title}>{text}</Th>;

  return (
    <div>
      <PageHeader title="Tim Sales" status={<DataBadge source="transaksi" />} />

      <FilterBar label="Filter Tim Sales">
        <Select label="Distributor" value={dist} onChange={e => setDist(e.target.value)}
          options={[{ value: 'all', label: 'Semua Distributor' }, ...dists.map(d => ({ value: d, label: d }))]} />
        <Select label="Bulan" value={period} onChange={e => setPeriod(+e.target.value)}
          options={(periods.length ? [...periods].reverse() : [period]).map(p => ({ value: p, label: `${MONTHS_ID[p % 100]} ${Math.floor(p / 100)}` }))} />
      </FilterBar>

      <div className="grid-kpi">
        {targetSales > 0
          ? <Kpi title="Salesman Aktif vs Target" value={fmt(salesAktif)} unit={`/ ${fmt(targetSales)}`}
              delta={<span className="inline-flex items-center gap-2 flex-wrap"><Capaian actual={salesAktif} target={targetSales} /><span className="text-faint">{MONTHS_ID[month]} {year}</span></span>} />
          : <Kpi title="Salesman Aktif" value={fmt(salesAktif)} delta={`${MONTHS_ID[month]} ${year} · status Sales Real`} />}
        <Kpi title="Capaian TA Tim" value={tTA > 0 ? (aTA / tTA * 100).toFixed(0) + '%' : '–'}
          delta={tTA > 0 ? `${fmt(aTA)} dari ${fmt(tTA)} toko aktif · tanpa subdist` : 'Belum ada target TA'} />
        <Kpi title="Capaian Tonase Tim" value={tTon > 0 ? (aTon / tTon * 100).toFixed(0) + '%' : '–'}
          delta={tTon > 0 ? `${fmt(aTon, 1)} dari ${fmt(tTon, 1)} ton · tanpa subdist` : 'Belum ada target tonase'} />
        <Kpi title="Omzet Tim" value={fmtIDRCompact(omzetTim)} delta={`${fmt(list.length)} salesman${tanpaTarget ? ` · ${fmt(tanpaTarget)} tanpa target` : ''} · tanpa subdist`} />
      </div>

      {targets && targets.length > 0 && <SalesmanVsTarget rows={rows} targets={targets} month={month} year={year} lastMonth={lastMonthOfYear} dist={dist} />}

      <div className="flex items-end justify-between flex-wrap gap-x-4 gap-y-2.5 mt-[38px] mb-3.5">
        <div>
          <h2 className="section-title !m-0">Daftar Salesman</h2>
          <p className="text-faint text-[12px] mt-1 max-w-[640px]">Urutan bawaan: omzet terbesar. Klik judul kolom untuk mengurutkan dengan cara lain.
            {' '}Salesman yang ada di transaksi tetapi belum punya target bulan ini tetap tampil dengan tanda <b className="text-ink font-medium">Tanpa target</b>.
            {hari != null && <> <b className="text-ink font-medium">Bulan masih berjalan</b> (data sampai tanggal {hari}): capaian dibandingkan dengan target sebulan penuh.</>}</p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Cari salesman…" aria-label="Cari salesman" className="!w-[200px] !py-[7px]" />
          {!query && (
            <div className="pill-row" role="group" aria-label="Jumlah baris yang ditampilkan">
              {[10, 25, 50].map(n => <Chip key={n} active={topN === n} onClick={() => setTopN(n)}>{n}</Chip>)}
            </div>
          )}
        </div>
      </div>
      <TableWrap>
        <table>
          <caption className="sr-only">Daftar salesman, urutan bawaan omzet terbesar</caption>
          <thead><tr>
            {hdr('salesman_name', 'Salesman')}
            {hdr('dist_code', 'Distributor')}
            {hdr('actual_omzet', 'Omzet', true)}
            {hdr('target_ta', 'Target TA', true)}
            {hdr('actual_ta', 'TA Aktual', true)}
            {hdr('capaian_ta', 'Capaian TA')}
            {hdr('target_tonase', 'Target Tonase', true)}
            {hdr('actual_tonase', 'Tonase Aktual', true)}
            {hdr('capaian_tonase', 'Capaian Tonase')}
          </tr></thead>
          <tbody>
            {shown.length === 0
              ? <tr><td colSpan={9} className="!text-center text-faint !p-6">{query ? `Tidak ada salesman dengan kata "${q.trim()}".` : 'Tidak ada data untuk filter ini.'}</td></tr>
              : shown.map((r, i) => (
                <tr key={`${r.salesman_code}-${r.dist_code}-${i}`}>
                  <td className="min-w-[200px]"><CellLink to={`/transaksi-detail?salesman=${encodeURIComponent(r.salesman_code)}&year=${year}&month=${month}&name=${encodeURIComponent(r.salesman_name)}`}>{r.salesman_name}</CellLink>{r.status === 'Tanpa target' && <Badge variant="neutral" className="ml-1.5" title="Ada di transaksi, belum punya target bulan ini">Tanpa target</Badge>}</td>
                  <td><span className="tag-code">{r.dist_code}</span></td>
                  <td className="num font-mono whitespace-nowrap">{fmtIDRCompact(r.actual_omzet)}</td>
                  <td className="num font-mono">{r.target_ta ? fmt(r.target_ta) : '–'}</td>
                  <td className="num font-mono">{fmt(r.actual_ta)}</td>
                  <td><Capaian actual={r.actual_ta} target={r.target_ta} /></td>
                  <td className="num font-mono">{r.target_tonase ? fmt(r.target_tonase) : '–'}</td>
                  <td className="num font-mono">{fmt(r.actual_tonase)}</td>
                  <td><Capaian actual={r.actual_tonase} target={r.target_tonase} /></td>
                </tr>
              ))}
          </tbody>
        </table>
      </TableWrap>
      {!query && filtered.length > shown.length && <p className="text-faint text-[12px] mt-2">Menampilkan {fmt(shown.length)} dari {fmt(filtered.length)} salesman.</p>}
    </div>
  );
}


/* ============================================================================
   Salesman vs Target (jumlah salesman aktif per distributor; target datar per bulan)
   "Real" = salesman berstatus 'Sales Real' pada bulan itu (distinct salesman_code).
   Bulan tanpa data sama sekali ditampilkan kosong (bukan nol).
============================================================================ */
type DistRow = { dist: string; name: string; real: number | null; target: number; selisih: number | null; p: number | null };

function SalesmanVsTarget({ rows, targets, month, year, lastMonth, dist }: { rows: Row[]; targets: Row[]; month: number; year: number; lastMonth: number; dist: string }) {
  const tgt = useMemo(() => new Map(targets.map(t => [String(t.dist_code), { target: Number(t.target_salesman || 0), name: String(t.dist_name || '') }])), [targets]);
  const agg = useMemo(() => {
    const m = new Map<string, Set<string>>();
    rows.forEach(r => {
      const k = `${r.dist_code}|${Number(r.month)}`;
      let e = m.get(k);
      if (!e) { e = new Set<string>(); m.set(k, e); }
      if (r.status === 'Sales Real') e.add(String(r.salesman_code));
    });
    return m;
  }, [rows]);
  const dists = useMemo(() => [...new Set([...tgt.keys(), ...rows.map(r => String(r.dist_code))])].sort(), [tgt, rows]);
  const scoped = useMemo(() => dists.filter(d => dist === 'all' || d === dist), [dists, dist]);
  const targetTotal = scoped.reduce((a, d) => a + (tgt.get(d)?.target || 0), 0);

  // hanya bulan yang sudah punya transaksi (bulan depan belum terjadi)
  const monthly = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    if (i + 1 > lastMonth) return null;
    let has = false, real = 0;
    scoped.forEach(d => { const e = agg.get(`${d}|${i + 1}`); if (e) { has = true; real += e.size; } });
    return has ? real : null;
  }), [scoped, agg, lastMonth]);

  const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));

  const table = useMemo<DistRow[]>(() => dists.map(d => {
    const e = agg.get(`${d}|${month}`);
    const t = tgt.get(d)?.target || 0;
    const r = e ? e.size : null;
    return { dist: d, name: tgt.get(d)?.name || '', real: r, target: t, selisih: r == null ? null : r - t, p: r == null || t <= 0 ? null : (r / t) * 100 };
  }), [dists, agg, tgt, month]);
  const { sorted, toggle, ariaSort } = useSort<DistRow>(table, 'selisih', 'asc', (r, k) => {
    const v = (r as any)[k];
    return typeof v === 'string' ? v : v;
  });
  const hdr = (k: string, text: string, num?: boolean) => <Th sortable num={num} ariaSort={ariaSort(k)} onSort={() => toggle(k)}>{text}</Th>;

  const labels = MONTHS_ID.slice(1);
  return (
    <section aria-label="Salesman vs Target" className="grid grid-cols-[1fr_1.25fr] max-lg:grid-cols-1 gap-4 mt-3.5">
      <div className="card">
        <h2 className="card-title">Target vs Salesman per Bulan</h2>
        <ChartBox className="!h-[300px]" label={chartSRSummary(labels, monthly.map(v => v ?? 0), 'salesman per bulan; target ' + targetTotal)}
          deps={[monthly, targetTotal, month]}
          build={() => ({
            type: 'bar',
            data: {
              labels,
              datasets: [
                { type: 'line', label: 'Target', data: labels.map(() => (targetTotal > 0 ? targetTotal : null)), borderColor: COLORS.target, borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false, order: 1 },
                { type: 'bar', label: 'Salesman', data: monthly, backgroundColor: monthly.map((_, i) => (i + 1 === month ? COLORS.accent : COLORS.sub)), maxBarThickness: 30, order: 2 },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              scales: { y: { beginAtZero: true, grid: { color: COLORS.line }, ticks: { precision: 0 } }, x: { grid: { display: false } } },
              plugins: {
                legend: { display: true, position: 'bottom', labels: { boxWidth: 12, boxHeight: 12 } },
                tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${c.parsed.y == null ? '–' : fmt(c.parsed.y)}` } },
              },
            },
          } as any)} />
      </div>
      <div className="card">
        <h2 className="card-title">Per Distributor · {MONTHS_ID[month]} {year} · Salesman Target / Aktual</h2>
        <TableWrap className="max-h-[330px] overflow-y-auto">
          <table className="tbl-dense" style={{ minWidth: 0 }}>
            <caption className="sr-only">Jumlah salesman dibanding target per distributor</caption>
            <thead><tr>
              {hdr('dist', 'Distributor')}
              {hdr('real', 'Salesman', true)}
              {hdr('selisih', 'Selisih', true)}
              {hdr('p', 'Capaian', true)}
            </tr></thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.dist} style={dist === r.dist ? { background: 'rgba(1,129,213,.07)' } : undefined}>
                  <td><span className="tag-code">{r.dist}</span></td>
                  <td className="num font-mono whitespace-nowrap"><span className="text-faint">{r.target > 0 ? fmt(r.target) : '–'} / </span>{r.real == null ? '–' : fmt(r.real)}</td>
                  <td className="num font-mono" style={{ color: r.selisih == null ? undefined : r.selisih >= 0 ? COLORS.green : COLORS.red }}>{r.selisih == null ? '–' : signed(r.selisih)}</td>
                  <td className="num font-mono font-semibold" style={{ color: r.p == null ? undefined : ({ good: COLORS.green, warn: COLORS.amber, bad: COLORS.red, neutral: undefined } as Record<string, string | undefined>)[capaianClass(r.p)] }}>{r.p == null ? '–' : r.p.toFixed(0) + '%'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>
    </section>
  );
}
