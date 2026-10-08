import { useMemo, useState } from 'react';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle, useSort } from '../lib/hooks';
import { COLORS, MONTHS_ID, chartSRSummary, dailyFreshness, fmt, pct } from '../lib/format';
import type { Row } from '../lib/types';
import { Capaian, CapaianAvg, CellLink, Chip, ChartBox, ErrorBox, Kpi, PageHeader, PageSkeleton, Select, TableWrap, Th } from '../components/ui';

type Sales = Row & { capaian_ta: number; capaian_tonase: number; capaian_avg: number };

export default function TimSales() {
  useDocTitle('Tim Sales');
  const { data, error } = useAsync(async () => {
    const [rows, freshnessData] = await Promise.all([DataSource.salesman(), DataSource.dataFreshness()]);
    return { rows, freshnessData };
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <PageSkeleton />;
  return <TimSalesBody rows={data.rows} freshnessData={data.freshnessData} />;
}

function TimSalesBody({ rows, freshnessData }: { rows: Row[]; freshnessData: Row }) {
  const freshness = dailyFreshness(freshnessData);
  const dists = useMemo(() => [...new Set(rows.map(r => String(r.dist_code)))].sort(), [rows]);
  const defaultMonth = useMemo(() => {
    const m = [...new Set(rows.filter(r => r.actual_num_do > 0).map(r => Number(r.month)))];
    return m.length ? Math.max(...m) : 1;
  }, [rows]);

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

  const top = useMemo(() => list.filter(r => r.capaian_avg >= 0).sort((a, b) => b.capaian_avg - a.capaian_avg).slice(0, topN), [list, topN]);

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

  return (
    <div>
      <PageHeader title="Tim Sales" status={freshness.status} statusVariant={freshness.statusVariant}>
        <div className="controls !mb-0">
          <Select label="Distributor" value={dist} onChange={e => setDist(e.target.value)}
            options={[{ value: 'all', label: 'Semua Distributor' }, ...dists.map(d => ({ value: d, label: d }))]} />
          <Select label="Bulan" value={month} onChange={e => setMonth(+e.target.value)}
            options={MONTHS_ID.slice(1).map((m, i) => ({ value: i + 1, label: `${m} 2026` }))} />
        </div>
      </PageHeader>

      <div className="grid-kpi">
        <Kpi title="Salesman Ditampilkan" value={fmt(list.length)} delta={`${MONTHS_ID[month]} 2026 · status aktif`} />
        <Kpi title="Rata-rata Capaian TA" value={avgTA == null ? '–' : avgTA.toFixed(0) + '%'} delta="Toko aktif vs target" />
        <Kpi title="Rata-rata Capaian Tonase" value={avgTonase == null ? '–' : avgTonase.toFixed(0) + '%'} delta={`vs target ${MONTHS_ID[month]} 2026`} />
        <Kpi title="Capai/Lampaui Target" value={fmt(aboveTarget)} unit={`/ ${fmt(withTargetTonase.length)}`} delta="Berdasarkan target tonase bulan ini" />
      </div>

      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-4 mt-3.5">
        <div className="card">
          <h2 className="card-title">{topN} Salesman Teratas · Point</h2>
          <ChartBox className="tall" label={chartSRSummary(top.map(r => r.salesman_name), top.map(r => r.capaian_avg), '% sales rank')}
            deps={[top]}
            build={() => ({
              type: 'bar',
              data: {
                labels: top.map(r => String(r.salesman_name).length > 16 ? String(r.salesman_name).slice(0, 15) + '…' : String(r.salesman_name)),
                datasets: [{ data: top.map(r => r.capaian_avg), backgroundColor: top.map(r => r.capaian_avg >= 100 ? COLORS.accent : COLORS.blueMid), maxBarThickness: 22 }],
              },
              options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                scales: { x: { grid: { color: COLORS.line }, ticks: { callback: (v: any) => v + '%' } }, y: { grid: { display: false } } },
                plugins: { tooltip: { callbacks: {
                  title: (c: any) => String(top[c[0].dataIndex].salesman_name),
                  label: (c: any) => ` Point: ${c.parsed.x.toFixed(1)}%  (TA ${top[c.dataIndex].capaian_ta.toFixed(0)}% + Tonase ${top[c.dataIndex].capaian_tonase.toFixed(0)}%) / 2`,
                } } },
              },
            } as any)} />
        </div>
        <div className="card">
          <h2 className="card-title">Sebaran Capaian TA (%)</h2>
          <ChartBox className="tall" label={chartSRSummary(bucketLabels, bucketCounts, 'salesman')}
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
      </div>

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
            {hdr('actual_ta', 'TA Aktual', true)}
            {hdr('target_ta', 'Target TA', true)}
            {hdr('capaian_ta', 'Capaian TA')}
            {hdr('actual_tonase', 'Tonase Aktual', true)}
            {hdr('target_tonase', 'Target Tonase', true)}
            {hdr('capaian_tonase', 'Capaian Tonase')}
          </tr></thead>
          <tbody>
            {shown.length === 0
              ? <tr><td colSpan={10} className="!text-center text-faint !p-6">Tidak ada data untuk filter ini.</td></tr>
              : shown.map((r, i) => (
                <tr key={`${r.salesman_code}-${r.dist_code}-${i}`}>
                  <td className="num font-mono">{i + 1}</td>
                  <td><CellLink to={`/transaksi-detail?salesman=${encodeURIComponent(r.salesman_code)}&year=2026&month=${month}&name=${encodeURIComponent(r.salesman_name)}`}>{r.salesman_name}</CellLink></td>
                  <td><span className="tag-code">{r.dist_code}</span></td>
                  <td><CapaianAvg p={r.capaian_avg} /></td>
                  <td className="num font-mono">{fmt(r.actual_ta)}</td>
                  <td className="num font-mono">{r.target_ta ? fmt(r.target_ta) : '–'}</td>
                  <td><Capaian actual={r.actual_ta} target={r.target_ta} /></td>
                  <td className="num font-mono">{fmt(r.actual_tonase)}</td>
                  <td className="num font-mono">{r.target_tonase ? fmt(r.target_tonase) : '–'}</td>
                  <td><Capaian actual={r.actual_tonase} target={r.target_tonase} /></td>
                </tr>
              ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}
