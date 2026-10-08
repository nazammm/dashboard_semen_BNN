import { Fragment, useEffect, useMemo, useState } from 'react';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { COLORS, MONTHS_ID, chartSRSummary, fmt, fmtCompact, groupSum, monthlyFreshness, pct } from '../lib/format';
import type { Row } from '../lib/types';
import { Capaian, Card, ChartBox, ErrorBox, Kpi, PageHeader, PageSkeleton, Select, TableWrap, Th, cx } from '../components/ui';
import { MonthDetailRow, MonthToggle, NO_GROWTH, fmtGrowth } from '../components/RegionalDetail';

type Filters = { region: string; subRegion: string; type: string };
interface MonthAgg { month_num: number; real_cur: number; target: number; real_prev: number; capaian: number; growth: number }

/** Tahun data terbaru dari nama kolom realisasi_YYYY. */
function detectYear(rows: Row[]): number {
  let y = 0;
  if (rows[0]) for (const k of Object.keys(rows[0])) { const m = /^realisasi_(\d{4})$/.exec(k); if (m) y = Math.max(y, Number(m[1])); }
  return y || 2026;
}

const optionsFor = (rows: Row[], f: Filters, field: 'region' | 'subRegion' | 'type') => {
  const key = field === 'type' ? 'type_cement' : field === 'subRegion' ? 'sub_region' : 'region';
  const scoped = rows.filter(r =>
    (field === 'region' || f.region === 'all' || r.region === f.region) &&
    (field === 'subRegion' || f.subRegion === 'all' || r.sub_region === f.subRegion) &&
    (field === 'type' || f.type === 'all' || r.type_cement === f.type));
  return [...new Set(scoped.map(r => r[key]))].filter(Boolean).sort() as string[];
};

export default function Delivery() {
  useDocTitle('Delivery');
  const { data: rows, error, loading } = useAsync(() => DataSource.delivery(), []);
  if (error) return <ErrorBox error={error} />;
  if (loading || !rows) return <PageSkeleton />;
  return <Content rows={rows} />;
}

function Content({ rows }: { rows: Row[] }) {
  const Y = detectYear(rows), P = Y - 1;
  const kReal = `realisasi_${Y}`, kTgt = `target_${Y}`, kRealP = `realisasi_${P}`;
  const freshness = useMemo(() => monthlyFreshness(rows, kReal, Y), [rows, kReal, Y]);

  const [filters, setFilters] = useState<Filters>({ region: 'all', subRegion: 'all', type: 'all' });
  const [sortKey, setSortKey] = useState<keyof MonthAgg>('month_num');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const canDrillDown = filters.subRegion === 'all';

  const regionOpts = optionsFor(rows, filters, 'region');
  const subOpts = optionsFor(rows, filters, 'subRegion');
  const typeOpts = optionsFor(rows, filters, 'type');

  /** Pilihan saling menyempit: filter lain yang tak lagi valid kembali ke "Semua". */
  const change = (patch: Partial<Filters>) => {
    const f = { ...filters, ...patch };
    if (f.region !== 'all' && !optionsFor(rows, f, 'region').includes(f.region)) f.region = 'all';
    if (f.subRegion !== 'all' && !optionsFor(rows, f, 'subRegion').includes(f.subRegion)) f.subRegion = 'all';
    if (f.type !== 'all' && !optionsFor(rows, f, 'type').includes(f.type)) f.type = 'all';
    setFilters(f);
  };

  const filtered = useMemo(() => rows.filter(r =>
    (filters.region === 'all' || r.region === filters.region) &&
    (filters.subRegion === 'all' || r.sub_region === filters.subRegion) &&
    (filters.type === 'all' || r.type_cement === filters.type)), [rows, filters]);

  const sum = (f: string) => filtered.reduce((a, r) => a + Number(r[f] || 0), 0);
  const agg = { cur: sum(kReal), target: sum(kTgt), prev: sum(kRealP) };

  // Pertumbuhan: Jan s.d. bulan terakhir yang sudah ada datanya (bukan Jan-Des penuh)
  const monthsWithData = filtered.filter(r => Number(r[kReal]) > 0).map(r => Number(r.month_num));
  const maxDataMonth = monthsWithData.length ? Math.max(...monthsWithData) : 12;
  const ytd = filtered.filter(r => Number(r.month_num) <= maxDataMonth);
  const curYTD = ytd.reduce((a, r) => a + Number(r[kReal] || 0), 0);
  const prevYTD = ytd.reduce((a, r) => a + Number(r[kRealP] || 0), 0);
  const growth = prevYTD > 0 ? (curYTD - prevYTD) / prevYTD * 100 : null;

  const labels = MONTHS_ID.slice(1);
  const byMonth = useMemo(() => {
    const b = Array.from({ length: 13 }, () => ({ r26: 0, t26: 0, r25: 0 }));
    filtered.forEach(r => {
      const m = b[Number(r.month_num)]; if (!m) return;
      m.r26 += Number(r[kReal] || 0); m.t26 += Number(r[kTgt] || 0); m.r25 += Number(r[kRealP] || 0);
    });
    return b;
  }, [filtered, kReal, kTgt, kRealP]);
  const r26Series = labels.map((_, i) => byMonth[i + 1].r26);

  const monthRows = useMemo(() => {
    const agg: Record<number, { month_num: number; real_cur: number; target: number; real_prev: number }> = {};
    filtered.forEach(r => {
      const m = Number(r.month_num);
      const b = agg[m] || (agg[m] = { month_num: m, real_cur: 0, target: 0, real_prev: 0 });
      b.real_cur += Number(r[kReal] || 0); b.target += Number(r[kTgt] || 0); b.real_prev += Number(r[kRealP] || 0);
    });
    const list: MonthAgg[] = Object.values(agg).filter(b => b.real_cur > 0).map(b => ({
      ...b,
      capaian: pct(b.real_cur, b.target) ?? -1,
      growth: b.real_prev > 0 ? (b.real_cur - b.real_prev) / b.real_prev * 100 : NO_GROWTH,
    }));
    list.sort((a, b) => sortDir * ((a[sortKey] - b[sortKey]) || (a.month_num - b.month_num)));
    return list;
  }, [filtered, sortKey, sortDir, kReal, kTgt, kRealP]);

  // Tutup bulan yang dibuka kalau sudah tidak relevan (filter Sub Region aktif / bulan hilang dari tabel)
  useEffect(() => {
    if (expandedMonth != null && (!canDrillDown || !monthRows.some(r => r.month_num === expandedMonth))) setExpandedMonth(null);
  }, [canDrillDown, monthRows, expandedMonth]);

  const sortBy = (k: keyof MonthAgg) => {
    if (k === sortKey) setSortDir(d => (d === 1 ? -1 : 1)); else { setSortKey(k); setSortDir(-1); }
  };
  const ariaSort = (k: keyof MonthAgg) => (k === sortKey ? (sortDir === 1 ? 'ascending' : 'descending') as 'ascending' | 'descending' : undefined);

  // Region "Semua" -> pecah per wilayah; region tertentu -> per sub region
  const grouping = filters.region === 'all' ? { field: 'region', label: 'Wilayah' } : { field: 'sub_region', label: 'Sub Region' };
  const groups = useMemo(() => {
    if (expandedMonth == null) return [];
    const ents = filtered.filter(r => Number(r.month_num) === expandedMonth);
    const sums = groupSum(ents, r => r[grouping.field] || '(tidak diketahui)', r => Number(r[kReal] || 0));
    return [...sums.entries()].map(([label, value]) => ({ label: String(label), value })).filter(g => g.value > 0).sort((a, b) => b.value - a.value);
  }, [filtered, expandedMonth, grouping.field, kReal]);

  const th = (k: keyof MonthAgg, label: string, num?: boolean) =>
    <Th sortable num={num} ariaSort={ariaSort(k)} onSort={() => sortBy(k)} role="button">{label}</Th>;

  return (
    <>
      <PageHeader title="Delivery" status={freshness.status} statusVariant={freshness.statusVariant}>
        <div className="controls !mb-0">
          <Select label="Region" value={filters.region} onChange={e => change({ region: e.target.value })}
            options={[{ value: 'all', label: 'Semua Region' }, ...regionOpts.map(r => ({ value: r, label: r }))]} />
          <Select label="Sub Region" value={filters.subRegion} onChange={e => change({ subRegion: e.target.value })}
            options={[{ value: 'all', label: 'Semua Sub Region' }, ...subOpts.map(r => ({ value: r, label: r }))]} />
          <Select label="Tipe Semen" value={filters.type} onChange={e => change({ type: e.target.value })}
            options={[{ value: 'all', label: 'Semua Tipe' }, ...typeOpts.map(r => ({ value: r, label: r }))]} />
        </div>
      </PageHeader>

      <div className="grid-kpi">
        <Kpi title={`Realisasi ${Y}`} value={fmt(agg.cur)} unit="ton" delta={<Capaian actual={agg.cur} target={agg.target} />} />
        <Kpi title={`Target ${Y}`} value={fmt(agg.target)} unit="ton" delta="Akumulasi target tahunan" />
        <Kpi title={`Pertumbuhan vs ${P}`} value={<span className={growth == null ? '' : growth >= 0 ? 'text-green' : 'text-red'}>{growth == null ? '–' : (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%'}</span>}
          delta={`Jan–${MONTHS_ID[maxDataMonth]} ${Y} vs periode sama ${P}`} />
        <Kpi title={`Realisasi ${P}`} value={fmt(agg.prev)} unit="ton" delta="Pembanding" />
      </div>

      <div className="mt-3.5">
        <Card title="Delivery per Bulan (Ton)">
          <div className="legend">
            <span><i style={{ background: COLORS.accent }} aria-hidden="true" />Realisasi {Y}</span>
            <span><i style={{ background: COLORS.blueMid }} aria-hidden="true" />Target {Y}</span>
            <span><i style={{ background: COLORS.ink, opacity: .35 }} aria-hidden="true" />Realisasi {P}</span>
          </div>
          <ChartBox className="tall" label={chartSRSummary(labels, r26Series, `ton realisasi ${Y}`)} deps={[byMonth, Y]} build={() => ({
            type: 'bar',
            data: { labels, datasets: [
              { label: `Realisasi ${Y}`, data: r26Series, backgroundColor: COLORS.accent, maxBarThickness: 26, order: 2 },
              { label: `Realisasi ${P}`, data: labels.map((_, i) => byMonth[i + 1].r25), backgroundColor: 'rgba(33,30,25,.22)', borderRadius: 3, maxBarThickness: 26, order: 3 },
              { label: `Target ${Y}`, data: labels.map((_, i) => byMonth[i + 1].t26), type: 'line', borderColor: COLORS.blueMid, backgroundColor: COLORS.blueMid, borderDash: [4, 3], borderWidth: 2, pointRadius: 2, fill: false, tension: .3, order: 1 },
            ] } as any,
            options: { responsive: true, maintainAspectRatio: false,
              scales: { y: { grid: { color: COLORS.line }, ticks: { callback: (v: any) => fmtCompact(v) } }, x: { grid: { display: false } } },
              plugins: { tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } } } },
          })} />
          <p className="sr-only">{chartSRSummary(labels, r26Series, `ton realisasi ${Y}`)}</p>
        </Card>
      </div>

      <h2 className="section-title">Rincian per Bulan</h2>
      <TableWrap>
        <table>
          <caption className="sr-only">Rincian realisasi delivery per bulan terhadap target</caption>
          <thead><tr>
            {th('month_num', 'Bulan')}
            {th('target', 'Target', true)}
            {th('capaian', 'Capaian')}
            {th('real_cur', `Realisasi ${Y} (Ton)`, true)}
            {th('growth', `YoY vs ${P}`, true)}
            {th('real_prev', `Realisasi ${P} (Ton)`, true)}
          </tr></thead>
          <tbody>
            {monthRows.map(r => (
              <Fragment key={r.month_num}>
                <tr>
                  <td>{canDrillDown
                    ? <MonthToggle month={r.month_num} expanded={expandedMonth === r.month_num} title={`Lihat komposisi delivery ${MONTHS_ID[r.month_num]}`}
                        onToggle={() => setExpandedMonth(expandedMonth === r.month_num ? null : r.month_num)} />
                    : <strong>{MONTHS_ID[r.month_num]}</strong>}</td>
                  <td className="num font-mono">{fmt(r.target)}</td>
                  <td><Capaian actual={r.real_cur} target={r.target} /></td>
                  <td className="num font-mono">{fmt(r.real_cur)}</td>
                  <td className={cx('num font-mono', r.growth >= 0 ? 'text-green' : 'text-red')}>{fmtGrowth(r.growth)}</td>
                  <td className="num font-mono">{fmt(r.real_prev)}</td>
                </tr>
                {expandedMonth === r.month_num && (
                  <MonthDetailRow colSpan={6} groups={groups} heading={`Komposisi Delivery ${MONTHS_ID[r.month_num]} ${Y} · per ${grouping.label}`} />
                )}
              </Fragment>
            ))}
            {monthRows.length === 0 && <tr><td colSpan={6} className="!text-center !text-faint !p-6">Tidak ada data untuk filter ini.</td></tr>}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
