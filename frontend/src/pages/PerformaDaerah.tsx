import { Fragment, useEffect, useMemo, useState } from 'react';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { COLORS, MONTHS_ID, chartSRSummary, fmt, fmtCompact, groupSum, monthlyFreshness, pct } from '../lib/format';
import type { Row } from '../lib/types';
import { Capaian, Card, ChartBox, ErrorBox, Kpi, PageHeader, PageSkeleton, Select, TableWrap, Th, cx } from '../components/ui';
import { MonthDetailRow, MonthToggle, NO_GROWTH, fmtGrowth } from '../components/RegionalDetail';

type Filters = { region: string; distributor: string; type: string };
interface MonthAgg { month_num: number; do_cur: number; target_do: number; do_prev: number; ta_cur: number; target_ta: number; capaian_do: number; capaian_ta: number; growth_do: number }

/** Tahun data terbaru dari nama kolom do_YYYY (kolom view memuat tahun di namanya). */
function detectYear(rows: Row[]): number {
  let y = 0;
  if (rows[0]) for (const k of Object.keys(rows[0])) { const m = /^do_(\d{4})$/.exec(k); if (m) y = Math.max(y, Number(m[1])); }
  return y || 2026;
}

const optionsFor = (rows: Row[], f: Filters, field: 'region' | 'distributor' | 'type') => {
  const key = field === 'type' ? 'type_cement' : field;
  const scoped = rows.filter(r =>
    (field === 'region' || f.region === 'all' || r.region === f.region) &&
    (field === 'distributor' || f.distributor === 'all' || r.distributor === f.distributor) &&
    (field === 'type' || f.type === 'all' || r.type_cement === f.type));
  return [...new Set(scoped.map(r => r[key]))].filter(Boolean).sort() as string[];
};

export default function PerformaDaerah() {
  useDocTitle('Penjualan Daerah');
  const { data: rows, error, loading } = useAsync(() => DataSource.cementTargets(), []);
  if (error) return <ErrorBox error={error} />;
  if (loading || !rows) return <PageSkeleton />;
  return <Content rows={rows} />;
}

function Content({ rows }: { rows: Row[] }) {
  const Y = detectYear(rows), P = Y - 1;
  const kDo = `do_${Y}`, kTdo = `target_do_${Y}`, kDoP = `do_${P}`, kTaD = `ta_distinct_${Y}`, kTa = `ta_${Y}`, kTta = `target_ta_${Y}`;
  const freshness = useMemo(() => monthlyFreshness(rows, kDo, Y), [rows, kDo, Y]);

  const [filters, setFilters] = useState<Filters>({ region: 'all', distributor: 'all', type: 'all' });
  const [sortKey, setSortKey] = useState<keyof MonthAgg>('month_num');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const canDrillDown = filters.distributor === 'all';

  const regionOpts = optionsFor(rows, filters, 'region');
  const distOpts = optionsFor(rows, filters, 'distributor');
  const typeOpts = optionsFor(rows, filters, 'type');

  /** Pilihan saling menyempit: setelah satu filter berubah, filter lain yang tak lagi valid kembali ke "Semua". */
  const change = (patch: Partial<Filters>) => {
    const f = { ...filters, ...patch };
    if (f.region !== 'all' && !optionsFor(rows, f, 'region').includes(f.region)) f.region = 'all';
    if (f.distributor !== 'all' && !optionsFor(rows, f, 'distributor').includes(f.distributor)) f.distributor = 'all';
    if (f.type !== 'all' && !optionsFor(rows, f, 'type').includes(f.type)) f.type = 'all';
    setFilters(f);
  };

  const filtered = useMemo(() => rows.filter(r =>
    (filters.region === 'all' || r.region === filters.region) &&
    (filters.distributor === 'all' || r.distributor === filters.distributor) &&
    (filters.type === 'all' || r.type_cement === filters.type)), [rows, filters]);

  const sum = (f: string) => filtered.reduce((a, r) => a + Number(r[f] || 0), 0);
  const agg = { do_cur: sum(kDo), target_do: sum(kTdo), ta_cur: sum(kTaD), target_ta: sum(kTta) };

  // Pertumbuhan: Jan s.d. bulan terakhir yang sudah ada datanya (bukan Jan-Des penuh)
  const monthsWithData = filtered.filter(r => Number(r[kDo]) > 0).map(r => Number(r.month_num));
  const maxDataMonth = monthsWithData.length ? Math.max(...monthsWithData) : 12;
  const ytd = filtered.filter(r => Number(r.month_num) <= maxDataMonth);
  const curYTD = ytd.reduce((a, r) => a + Number(r[kDo] || 0), 0);
  const prevYTD = ytd.reduce((a, r) => a + Number(r[kDoP] || 0), 0);
  const growth = prevYTD > 0 ? (curYTD - prevYTD) / prevYTD * 100 : null;

  const isAllTypes = filters.type === 'all';
  const taField = isAllTypes ? kTaD : kTa;
  const labels = MONTHS_ID.slice(1);
  const byMonth = useMemo(() => {
    const b = Array.from({ length: 13 }, () => ({ do26: 0, tdo: 0, do25: 0, ta26: 0, tta: 0 }));
    filtered.forEach(r => {
      const m = b[Number(r.month_num)]; if (!m) return;
      m.do26 += Number(r[kDo] || 0); m.tdo += Number(r[kTdo] || 0); m.do25 += Number(r[kDoP] || 0);
      m.ta26 += Number(r[taField] || 0); m.tta += Number(r[kTta] || 0);
    });
    return b;
  }, [filtered, kDo, kTdo, kDoP, taField, kTta]);
  const do26Series = labels.map((_, i) => byMonth[i + 1].do26);
  const ta26Series = labels.map((_, i) => byMonth[i + 1].ta26);

  const monthRows = useMemo(() => {
    const agg: Record<number, { month_num: number; do_cur: number; target_do: number; do_prev: number; ta_cur: number; target_ta: number }> = {};
    filtered.forEach(r => {
      const m = Number(r.month_num);
      const b = agg[m] || (agg[m] = { month_num: m, do_cur: 0, target_do: 0, do_prev: 0, ta_cur: 0, target_ta: 0 });
      b.do_cur += Number(r[kDo] || 0); b.target_do += Number(r[kTdo] || 0); b.do_prev += Number(r[kDoP] || 0);
      b.ta_cur += Number(r[kTaD] || 0); b.target_ta += Number(r[kTta] || 0);
    });
    const list: MonthAgg[] = Object.values(agg).filter(b => b.do_cur > 0).map(b => ({
      ...b,
      capaian_do: pct(b.do_cur, b.target_do) ?? -1,
      capaian_ta: pct(b.ta_cur, b.target_ta) ?? -1,
      growth_do: b.do_prev > 0 ? (b.do_cur - b.do_prev) / b.do_prev * 100 : NO_GROWTH,
    }));
    list.sort((a, b) => sortDir * ((a[sortKey] - b[sortKey]) || (a.month_num - b.month_num)));
    return list;
  }, [filtered, sortKey, sortDir, kDo, kTdo, kDoP, kTaD, kTta]);

  // Tutup bulan yang dibuka kalau sudah tidak relevan (filter Distributor aktif / bulan hilang dari tabel)
  useEffect(() => {
    if (expandedMonth != null && (!canDrillDown || !monthRows.some(r => r.month_num === expandedMonth))) setExpandedMonth(null);
  }, [canDrillDown, monthRows, expandedMonth]);

  const sortBy = (k: keyof MonthAgg) => {
    if (k === sortKey) setSortDir(d => (d === 1 ? -1 : 1)); else { setSortKey(k); setSortDir(-1); }
  };
  const ariaSort = (k: keyof MonthAgg) => (k === sortKey ? (sortDir === 1 ? 'ascending' : 'descending') as 'ascending' | 'descending' : undefined);

  // Region "Semua" -> pecah per wilayah; region tertentu -> per distributor/sub-dist
  const grouping = filters.region === 'all' ? { field: 'region', label: 'Wilayah' } : { field: 'distributor', label: 'Distributor/Sub-Dist' };
  const groups = useMemo(() => {
    if (expandedMonth == null) return [];
    const ents = filtered.filter(r => Number(r.month_num) === expandedMonth);
    const sums = groupSum(ents, r => r[grouping.field] || '(tidak diketahui)', r => Number(r[kDo] || 0));
    return [...sums.entries()].map(([label, value]) => ({ label: String(label), value })).filter(g => g.value > 0).sort((a, b) => b.value - a.value);
  }, [filtered, expandedMonth, grouping.field, kDo]);

  const tooltipLabel = { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } };
  const th = (k: keyof MonthAgg, label: string, num?: boolean) =>
    <Th sortable num={num} ariaSort={ariaSort(k)} onSort={() => sortBy(k)} role="button">{label}</Th>;

  return (
    <>
      <PageHeader title="Penjualan Daerah" status={freshness.status} statusVariant={freshness.statusVariant}>
        <div className="controls !mb-0">
          <Select label="Region" value={filters.region} onChange={e => change({ region: e.target.value })}
            options={[{ value: 'all', label: 'Semua Region' }, ...regionOpts.map(r => ({ value: r, label: r }))]} />
          <Select label="Distributor" value={filters.distributor} onChange={e => change({ distributor: e.target.value })}
            options={[{ value: 'all', label: 'Semua Distributor' }, ...distOpts.map(r => ({ value: r, label: r }))]} />
          <Select label="Tipe Semen" value={filters.type} onChange={e => change({ type: e.target.value })}
            options={[{ value: 'all', label: 'Semua Tipe' }, ...typeOpts.map(r => ({ value: r, label: r }))]} />
        </div>
      </PageHeader>

      <div className="grid-kpi">
        <Kpi title={`Realisasi DO ${Y}`} value={fmt(agg.do_cur)} unit="ton" delta={<Capaian actual={agg.do_cur} target={agg.target_do} />} />
        <Kpi title={`Target DO ${Y}`} value={fmt(agg.target_do)} unit="ton" delta="Akumulasi target tahunan" />
        <Kpi title={`Pertumbuhan vs ${P}`} value={<span className={growth == null ? '' : growth >= 0 ? 'text-green' : 'text-red'}>{growth == null ? '–' : (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%'}</span>}
          delta={`Jan–${MONTHS_ID[maxDataMonth]} ${Y} vs periode sama ${P}`} />
        <Kpi title={`Toko Aktif ${Y}`} value={fmt(agg.ta_cur)} delta={<Capaian actual={agg.ta_cur} target={agg.target_ta} />} />
      </div>

      <div className="grid grid-cols-2 gap-4 mt-3.5 max-[1000px]:grid-cols-1">
        <Card title="Delivery Order per Bulan (Ton)">
          <div className="legend">
            <span><i style={{ background: COLORS.accent }} aria-hidden="true" />Realisasi {Y}</span>
            <span><i style={{ background: COLORS.blueMid }} aria-hidden="true" />Target {Y}</span>
            <span><i style={{ background: COLORS.ink, opacity: .35 }} aria-hidden="true" />Realisasi {P}</span>
          </div>
          <ChartBox className="tall" label={chartSRSummary(labels, do26Series, `ton realisasi ${Y}`)} deps={[byMonth, Y]} build={() => ({
            type: 'bar',
            data: { labels, datasets: [
              { label: `Realisasi ${Y}`, data: do26Series, backgroundColor: COLORS.accent, maxBarThickness: 26, order: 2 },
              { label: `Realisasi ${P}`, data: labels.map((_, i) => byMonth[i + 1].do25), backgroundColor: 'rgba(33,30,25,.22)', borderRadius: 3, maxBarThickness: 26, order: 3 },
              { label: `Target ${Y}`, data: labels.map((_, i) => byMonth[i + 1].tdo), type: 'line', borderColor: COLORS.blueMid, backgroundColor: COLORS.blueMid, borderDash: [4, 3], borderWidth: 2, pointRadius: 2, fill: false, tension: .3, order: 1 },
            ] } as any,
            options: { responsive: true, maintainAspectRatio: false,
              scales: { y: { grid: { color: COLORS.line }, ticks: { callback: (v: any) => fmtCompact(v) } }, x: { grid: { display: false } } },
              plugins: { tooltip: tooltipLabel } },
          })} />
          <p className="sr-only">{chartSRSummary(labels, do26Series, `ton realisasi ${Y}`)}</p>
        </Card>
        <Card title="Toko Aktif per Bulan">
          <div className="legend">
            {isAllTypes
              ? <><span><i style={{ background: COLORS.accent }} aria-hidden="true" />Realisasi</span><span><i style={{ background: COLORS.blueMid }} aria-hidden="true" />Target</span></>
              : <span><i style={{ background: COLORS.accent }} aria-hidden="true" />Realisasi ({filters.type}, tanpa target)</span>}
          </div>
          <ChartBox className="tall" label={chartSRSummary(labels, ta26Series, 'toko aktif')} deps={[byMonth, isAllTypes]} build={() => {
            const datasets: any[] = [{ label: 'Realisasi', data: ta26Series, backgroundColor: COLORS.accent, maxBarThickness: 26 }];
            if (isAllTypes) datasets.push({ label: 'Target', data: labels.map((_, i) => byMonth[i + 1].tta), type: 'line', borderColor: COLORS.blueMid, borderDash: [4, 3], borderWidth: 2, pointRadius: 2, fill: false, tension: .3 });
            return { type: 'bar', data: { labels, datasets },
              options: { responsive: true, maintainAspectRatio: false, scales: { y: { grid: { color: COLORS.line } }, x: { grid: { display: false } } }, plugins: { tooltip: tooltipLabel } } };
          }} />
          <p className="sr-only">{chartSRSummary(labels, ta26Series, 'toko aktif')}</p>
        </Card>
      </div>

      <h2 className="section-title">Rincian per Bulan</h2>
      <TableWrap>
        <table>
          <caption className="sr-only">Rincian capaian DO dan Toko Aktif per bulan terhadap target</caption>
          <thead><tr>
            {th('month_num', 'Bulan')}
            {th('target_do', 'Target DO', true)}
            {th('capaian_do', 'Capaian DO')}
            {th('do_cur', `DO ${Y} (Ton)`, true)}
            {th('growth_do', `YoY vs ${P}`, true)}
            {th('ta_cur', 'Toko Aktif', true)}
            {th('target_ta', 'Target TA', true)}
            {th('capaian_ta', 'Capaian TA')}
          </tr></thead>
          <tbody>
            {monthRows.map(r => (
              <Fragment key={r.month_num}>
                <tr>
                  <td>{canDrillDown
                    ? <MonthToggle month={r.month_num} expanded={expandedMonth === r.month_num} title={`Lihat komposisi penjualan ${MONTHS_ID[r.month_num]}`}
                        onToggle={() => setExpandedMonth(expandedMonth === r.month_num ? null : r.month_num)} />
                    : <strong>{MONTHS_ID[r.month_num]}</strong>}</td>
                  <td className="num font-mono">{fmt(r.target_do)}</td>
                  <td><Capaian actual={r.do_cur} target={r.target_do} /></td>
                  <td className="num font-mono">{fmt(r.do_cur)}</td>
                  <td className={cx('num font-mono', r.growth_do >= 0 ? 'text-green' : 'text-red')}>{fmtGrowth(r.growth_do)}</td>
                  <td className="num font-mono">{fmt(r.ta_cur)}</td>
                  <td className="num font-mono">{fmt(r.target_ta)}</td>
                  <td><Capaian actual={r.ta_cur} target={r.target_ta} /></td>
                </tr>
                {expandedMonth === r.month_num && (
                  <MonthDetailRow colSpan={8} groups={groups} heading={`Komposisi Penjualan ${MONTHS_ID[r.month_num]} ${Y} · per ${grouping.label}`} />
                )}
              </Fragment>
            ))}
            {monthRows.length === 0 && <tr><td colSpan={8} className="!text-center !text-faint !p-6">Tidak ada data untuk filter ini.</td></tr>}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
