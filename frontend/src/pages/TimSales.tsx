import { useMemo, useState, type ReactNode } from 'react';
import { DataSource } from '../lib/data';
import { useAuth } from '../lib/auth';
import { useAsync, useDocTitle, useSort } from '../lib/hooks';
import { COLORS, MONTHS_ID, capaianClass, chartSRSummary, dailyFreshness, fmt, pct } from '../lib/format';
import type { Row } from '../lib/types';
import { Capaian, CapaianAvg, CellLink, ChartBox, Chip, ErrorBox, FilterBar, Kpi, PageHeader, PageSkeleton, Select, TableWrap, Th } from '../components/ui';

type Sales = Row & { capaian_ta: number; capaian_tonase: number; capaian_avg: number };

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

function TimSalesBody({ rows, freshnessData, targets }: { rows: Row[]; freshnessData: Row; targets: Row[] | null }) {
  const freshness = dailyFreshness(freshnessData);
  // Tahun data = tahun transaksi terakhir (view salesman memakai tahun transaksi terbaru), bukan angka tetap.
  const year = Number(String(freshnessData?.max_do_date ?? '').slice(0, 4)) || new Date().getFullYear();
  const dists = useMemo(() => [...new Set(rows.map(r => String(r.dist_code)))].sort(), [rows]);
  const monthsWithData = useMemo(() => [...new Set(rows.filter(r => r.actual_num_do > 0).map(r => Number(r.month)))].sort((a, b) => a - b), [rows]);
  const defaultMonth = monthsWithData.length ? monthsWithData[monthsWithData.length - 1] : 1;

  const [dist, setDist] = useState('all');
  const [month, setMonth] = useState(defaultMonth);
  const [topN, setTopN] = useState(10);

  const list = useMemo<Sales[]>(() => rows.filter(r =>
    Number(r.month) === month && (dist === 'all' || r.dist_code === dist) && r.status === 'Sales Real'
  ).map(r => {
    const capaian_ta = pct(r.actual_ta, r.target_ta) ?? -1;
    const capaian_tonase = pct(r.actual_tonase, r.target_tonase) ?? -1;
    const parts: number[] = [];
    if (r.target_ta > 0) parts.push(capaian_ta);
    if (r.target_tonase > 0) parts.push(capaian_tonase);
    const capaian_avg = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : -1;
    return { ...r, capaian_ta, capaian_tonase, capaian_avg };
  }), [rows, month, dist]);

  const withTargetTonase = list.filter(r => r.target_tonase > 0);
  const withTargetTA = list.filter(r => r.target_ta > 0);
  const avgTA = withTargetTA.length ? withTargetTA.reduce((a, r) => a + r.capaian_ta, 0) / withTargetTA.length : null;
  const avgTonase = withTargetTonase.length ? withTargetTonase.reduce((a, r) => a + r.capaian_tonase, 0) / withTargetTonase.length : null;
  const aboveTarget = withTargetTonase.filter(r => r.capaian_tonase >= 100).length;

  const bucketLabels = ['0-49%', '50-79%', '80-99%', '100-119%', '120%+'];
  const bucketCounts = useMemo(() => {
    const c = [0, 0, 0, 0, 0];
    withTargetTA.forEach(r => {
      const p = r.capaian_ta;
      if (p < 50) c[0]++; else if (p < 80) c[1]++; else if (p < 100) c[2]++; else if (p < 120) c[3]++; else c[4]++;
    });
    return c;
  }, [withTargetTA]);

  const { sorted, toggle, ariaSort } = useSort<Sales>(list, 'capaian_avg', 'desc', (r, k) => {
    const v = r[k];
    return typeof v === 'string' ? v : (v ?? -1);
  });
  const shown = sorted.slice(0, topN);
  const hdr = (k: string, text: string, num?: boolean) => <Th sortable num={num} ariaSort={ariaSort(k)} onSort={() => toggle(k)}>{text}</Th>;

  const sebaranCard = (
          <div className="card">
            <h2 className="card-title">Sebaran Capaian TA (%)</h2>
            <ChartBox className="!h-[480px]" label={chartSRSummary(bucketLabels, bucketCounts, 'salesman')}
              deps={[bucketCounts]}
              build={() => ({
                type: 'bar',
                data: { labels: bucketLabels, datasets: [{ data: bucketCounts, backgroundColor: [COLORS.red, COLORS.amber, '#A8ADB7', COLORS.accent, '#5B6472'], maxBarThickness: 44 }] },
                options: {
                  responsive: true, maintainAspectRatio: false,
                  scales: { y: { grid: { color: COLORS.line }, ticks: { precision: 0 } }, x: { grid: { display: false } } },
                  plugins: { tooltip: { callbacks: { label: (c: any) => ` ${fmt(c.parsed.y)} salesman` } } },
                },
              } as any)} />
          </div>
  );

  return (
    <div>
      <PageHeader title="Tim Sales" status={freshness.status} statusVariant={freshness.statusVariant} />

      <FilterBar label="Filter Tim Sales">
        <Select label="Distributor" value={dist} onChange={e => setDist(e.target.value)}
          options={[{ value: 'all', label: 'Semua Distributor' }, ...dists.map(d => ({ value: d, label: d }))]} />
        <Select label="Bulan" value={month} onChange={e => setMonth(+e.target.value)}
          options={(monthsWithData.length ? monthsWithData : [month]).map(m => ({ value: m, label: `${MONTHS_ID[m]} ${year}` }))} />
      </FilterBar>

      <div className="grid-kpi">
        <Kpi title="Salesman Ditampilkan" value={fmt(list.length)} delta={`${MONTHS_ID[month]} ${year} · status aktif`} />
        <Kpi title="Rata-rata Capaian TA" value={avgTA == null ? '–' : avgTA.toFixed(0) + '%'} delta="Toko aktif vs target" />
        <Kpi title="Rata-rata Capaian Tonase" value={avgTonase == null ? '–' : avgTonase.toFixed(0) + '%'} delta={`vs target ${MONTHS_ID[month]} ${year}`} />
        <Kpi title="Capai/Lampaui Target" value={fmt(aboveTarget)} unit={`/ ${fmt(withTargetTonase.length)}`} delta="Berdasarkan target tonase bulan ini" />
      </div>

      {targets && targets.length > 0
        ? <SalesmanVsTarget rows={rows} targets={targets} month={month} year={year} dist={dist} lead={sebaranCard} />
        : <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-4 mt-3.5">{sebaranCard}</div>}

      <div className="flex items-baseline justify-between flex-wrap gap-2.5">
        <h2 className="section-title !mb-3.5">Papan Peringkat</h2>
        <div className="pill-row" role="group" aria-label="Jumlah baris yang ditampilkan">
          {[10, 25, 50].map(n => <Chip key={n} active={topN === n} onClick={() => setTopN(n)}>Top {n}</Chip>)}
        </div>
      </div>
      <TableWrap>
        <table>
          <caption className="sr-only">Papan peringkat performa salesman berdasarkan Point</caption>
          <thead><tr>
            <th className="num" style={{ width: 44 }}>#</th>
            {hdr('salesman_name', 'Salesman')}
            {hdr('dist_code', 'Distributor')}
            {hdr('capaian_avg', 'Point')}
            {hdr('target_ta', 'Target TA', true)}
            {hdr('actual_ta', 'TA Aktual', true)}
            {hdr('capaian_ta', 'Capaian TA')}
            {hdr('target_tonase', 'Target Tonase', true)}
            {hdr('actual_tonase', 'Tonase Aktual', true)}
            {hdr('capaian_tonase', 'Capaian Tonase')}
          </tr></thead>
          <tbody>
            {shown.length === 0
              ? <tr><td colSpan={10} className="!text-center text-faint !p-6">Tidak ada data untuk filter ini.</td></tr>
              : shown.map((r, i) => (
                <tr key={`${r.salesman_code}-${r.dist_code}-${i}`}>
                  <td className="num font-mono">{i + 1}</td>
                  <td><CellLink to={`/transaksi-detail?salesman=${encodeURIComponent(r.salesman_code)}&year=${year}&month=${month}&name=${encodeURIComponent(r.salesman_name)}`}>{r.salesman_name}</CellLink></td>
                  <td><span className="tag-code">{r.dist_code}</span></td>
                  <td><CapaianAvg p={r.capaian_avg} /></td>
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
    </div>
  );
}


/* ============================================================================
   Salesman vs Target (jumlah salesman aktif per distributor; target datar per bulan)
   "Real" = salesman berstatus 'Sales Real' pada bulan itu (distinct salesman_code).
   Bulan tanpa data sama sekali ditampilkan kosong (bukan nol).
============================================================================ */
type DistRow = { dist: string; name: string; real: number | null; target: number; selisih: number | null; p: number | null };

function SalesmanVsTarget({ rows, targets, month, year, dist, lead }: { rows: Row[]; targets: Row[]; month: number; year: number; dist: string; lead: ReactNode }) {
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

  const monthly = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    let has = false, real = 0;
    scoped.forEach(d => { const e = agg.get(`${d}|${i + 1}`); if (e) { has = true; real += e.size; } });
    return has ? real : null;
  }), [scoped, agg]);

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
    <section aria-label="Salesman vs Target" className="grid grid-cols-[0.9fr_1fr_1.25fr] max-[1360px]:grid-cols-2 max-lg:grid-cols-1 gap-4 mt-3.5">
      {lead}
      <div className="card">
        <h2 className="card-title">Target vs Salesman per Bulan</h2>
        <ChartBox className="!h-[480px]" label={chartSRSummary(labels, monthly.map(v => v ?? 0), 'salesman per bulan; target ' + targetTotal)}
          deps={[monthly, targetTotal, month]}
          build={() => ({
            type: 'bar',
            data: {
              labels,
              datasets: [
                { type: 'line', label: 'Target', data: labels.map(() => (targetTotal > 0 ? targetTotal : null)), borderColor: COLORS.red, borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false, order: 1 },
                { type: 'bar', label: 'Salesman', data: monthly, backgroundColor: monthly.map((_, i) => (i + 1 === month ? COLORS.accent : COLORS.blueMid)), maxBarThickness: 30, order: 2 },
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
      <div className="card max-[1360px]:col-span-2 max-lg:col-span-1">
        <h2 className="card-title">Per Distributor · {MONTHS_ID[month]} {year} · Salesman Target / Aktual</h2>
        <TableWrap>
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
                <tr key={r.dist} style={dist === r.dist ? { background: 'rgba(255,90,31,.08)' } : undefined}>
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
