import { useMemo, useState } from 'react';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { COLORS, MONTHS_ID, chartSRSummary, fmt, fmtCompact, groupSum, monthlyFreshness } from '../lib/format';
import type { Row } from '../lib/types';
import { Capaian, Card, ChartBox, ErrorBox, FilterBar, Kpi, PageHeader, PageSkeleton, Select } from '../components/ui';
import { GrowthTable } from '../components/GrowthTable';

type Filters = { region: string; subRegion: string; type: string };

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
  useDocTitle('Sell In');
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

  // Tabel rincian: hanya bulan yang sudah ada realisasi tahun berjalan.
  const monthRows = useMemo(() => {
    const b: Record<number, { target: number; prev: number; cur: number }> = {};
    filtered.forEach(r => {
      const m = Number(r.month_num);
      const x = b[m] || (b[m] = { target: 0, prev: 0, cur: 0 });
      x.cur += Number(r[kReal] || 0); x.target += Number(r[kTgt] || 0); x.prev += Number(r[kRealP] || 0);
    });
    return Object.keys(b).map(Number).filter(m => m >= 1 && m <= 12 && b[m].cur > 0).map(m => ({ month_num: m, ...b[m] }));
  }, [filtered, kReal, kTgt, kRealP]);

  // Region "Semua" -> pecah per wilayah; region tertentu -> per sub region
  const grouping = filters.region === 'all' ? { field: 'region', label: 'Wilayah' } : { field: 'sub_region', label: 'Sub Region' };
  const groupsFor = (month: number) => {
    const ents = filtered.filter(r => Number(r.month_num) === month);
    const sums = groupSum(ents, r => r[grouping.field] || '(tidak diketahui)', r => Number(r[kReal] || 0));
    return [...sums.entries()].map(([label, value]) => ({ label: String(label), value })).filter(g => g.value > 0).sort((a, b) => b.value - a.value);
  };
  const filterActive = filters.region !== 'all' || filters.subRegion !== 'all' || filters.type !== 'all';

  return (
    <>
      <PageHeader title="Sell In" status={freshness.status} statusVariant={freshness.statusVariant} />

      <FilterBar label="Filter Sell In" className="max-[880px]:grid max-[880px]:grid-cols-3 max-[880px]:gap-2 max-[880px]:[&_select]:w-full max-[880px]:[&_select]:min-w-0 max-[880px]:[&_select]:text-[12px]">
        <Select label="Region" value={filters.region} onChange={e => change({ region: e.target.value })}
          options={[{ value: 'all', label: 'Semua Region' }, ...regionOpts.map(r => ({ value: r, label: r }))]} />
        <Select label="Sub Region" value={filters.subRegion} onChange={e => change({ subRegion: e.target.value })}
          options={[{ value: 'all', label: 'Semua Sub Region' }, ...subOpts.map(r => ({ value: r, label: r }))]} />
        <Select label="Tipe Semen" value={filters.type} onChange={e => change({ type: e.target.value })}
          options={[{ value: 'all', label: 'Semua Tipe' }, ...typeOpts.map(r => ({ value: r, label: r }))]} />
        {filterActive && (
          <button type="button" className="btn max-[880px]:col-span-3 max-[880px]:justify-center max-[880px]:!py-1.5 max-[880px]:!text-xs"
            onClick={() => setFilters({ region: 'all', subRegion: 'all', type: 'all' })}>
            Reset filter
          </button>
        )}
      </FilterBar>

      <div className="grid-kpi">
        <Kpi title={`Target ${Y}`} value={fmt(agg.target)} unit="ton" delta="Akumulasi target tahunan" />
        <Kpi title={`Realisasi ${Y}`} value={fmt(agg.cur)} unit="ton" delta={<Capaian actual={agg.cur} target={agg.target} />} />
        <Kpi title={`Pertumbuhan vs ${P}`} value={<span className={growth == null ? '' : growth >= 0 ? 'text-green' : 'text-red'}>{growth == null ? '–' : (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%'}</span>}
          delta={`Jan–${MONTHS_ID[maxDataMonth]} ${Y} vs periode sama ${P}`} />
        <Kpi title={`Realisasi ${P}`} value={fmt(agg.prev)} unit="ton" delta="Pembanding" />
      </div>

      <div className="mt-3.5">
        <Card title="Sell In per Bulan (Ton)">
          <div className="legend">
            <span><i style={{ background: COLORS.blueMid }} aria-hidden="true" />Target {Y}</span>
            <span><i style={{ background: COLORS.accent }} aria-hidden="true" />Realisasi {Y}</span>
            <span><i style={{ background: COLORS.ink, opacity: .35 }} aria-hidden="true" />Realisasi {P}</span>
          </div>
          <ChartBox className="tall" label={chartSRSummary(labels, r26Series, `ton realisasi ${Y}`)} deps={[byMonth, Y]} build={() => ({
            type: 'bar',
            data: { labels, datasets: [
              { label: `Target ${Y}`, data: labels.map((_, i) => byMonth[i + 1].t26), type: 'line', borderColor: COLORS.blueMid, backgroundColor: COLORS.blueMid, borderDash: [4, 3], borderWidth: 2, pointRadius: 2, fill: false, tension: .3, order: 1 },
              { label: `Realisasi ${Y}`, data: r26Series, backgroundColor: COLORS.accent, maxBarThickness: 26, order: 2 },
              { label: `Realisasi ${P}`, data: labels.map((_, i) => byMonth[i + 1].r25), backgroundColor: 'rgba(33,30,25,.22)', borderRadius: 3, maxBarThickness: 26, order: 3 },
            ] } as any,
            options: { responsive: true, maintainAspectRatio: false,
              scales: { y: { grid: { color: COLORS.line }, ticks: { callback: (v: any) => fmtCompact(v) } }, x: { grid: { display: false } } },
              plugins: { tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } } } },
          })} />
          <p className="sr-only">{chartSRSummary(labels, r26Series, `ton realisasi ${Y}`)}</p>
        </Card>
      </div>

      <h2 className="section-title">Rincian per Bulan · Sell In (Ton)</h2>
      <GrowthTable caption={`Rincian sell in per bulan: target, realisasi ${P} dan ${Y}, pertumbuhan, capaian`}
        rows={monthRows} Y={Y} P={P} labels={{ target: 'Target', value: 'Sell In', capaian: 'Capaian' }}
        drill={{ enabled: canDrillDown, groupsFor,
          heading: m => `Komposisi Sell In ${MONTHS_ID[m]} ${Y} · per ${grouping.label}`,
          title: m => `Lihat komposisi sell in ${MONTHS_ID[m]}` }} />
    </>
  );
}
