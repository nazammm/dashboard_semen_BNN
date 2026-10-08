import { useMemo, useRef, useState } from 'react';
import { DataSource, dailyMatrix } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, MONTHS_ID, dailyFreshness, fmt, isWorkingDay, weekBucketsForMonth } from '../lib/format';
import type { Row } from '../lib/types';
import { CellLink, ErrorBox, ExportButton, PageHeader, PageSkeleton, Select, TableWrap } from '../components/ui';

const pad2 = (n: number) => String(n).padStart(2, '0');
const Dash = () => <span className="text-faint">–</span>;

interface Base { monthly: Row[]; dists: Row[]; produk: Row[]; targetDist: Row[]; freshnessData: Row }

export default function RekapHarian() {
  useDocTitle('Rekap Harian');
  const { data, error } = useAsync<Base>(async () => {
    const [monthly, dists, produk, targetDist, freshnessData] = await Promise.all([
      DataSource.monthlyTotals(), DataSource.distributors(), DataSource.produk(), DataSource.targetDist(), DataSource.dataFreshness(),
    ]);
    return { monthly, dists, produk, targetDist, freshnessData };
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <PageSkeleton />;
  return <RekapBody base={data} />;
}

function RekapBody({ base }: { base: Base }) {
  const { canViewDetail } = useAuth();
  const { monthly, dists, produk, targetDist, freshnessData } = base;
  const freshness = dailyFreshness(freshnessData);

  const distCodes = useMemo(() => dists.filter(d => d.tag === 'Distributor').map(d => String(d.dist_code)).sort(), [dists]);
  const jenisList = useMemo(() => [...new Set(produk.map(p => String(p.jenis)))].sort(), [produk]);
  const productsByJenis = useMemo(() => {
    const m: Record<string, string[]> = {};
    jenisList.forEach(j => { m[j] = produk.filter(p => p.jenis === j).map(p => String(p.kode)); });
    return m;
  }, [produk, jenisList]);

  // hanya periode mulai Januari 2026
  const periods = useMemo(() => monthly.map(r => ({ year: Number(r.year), month: Number(r.month) }))
    .filter(p => p.year >= 2026)
    .sort((a, b) => a.year - b.year || a.month - b.month), [monthly]);
  const defaultPeriod = periods[periods.length - 1] || { year: 2026, month: 8 };

  const [period, setPeriod] = useState(`${defaultPeriod.year}-${defaultPeriod.month}`);
  const [jenis, setJenis] = useState('all');
  const [year, month] = period.split('-').map(Number);

  const wRef = useRef<HTMLTableElement>(null);
  const pRef = useRef<HTMLTableElement>(null);
  const rRef = useRef<HTMLTableElement>(null);

  const productCodes = jenis === 'all' ? null : productsByJenis[jenis];
  const daily = useAsync(() => dailyMatrix(year, month, productCodes), [year, month, jenis]);
  // Rekap mingguan & vs-target selalu pakai semua jenis semen.
  const weekly = useAsync(() => dailyMatrix(year, month, null), [year, month]);

  const targetMap = useMemo(() => {
    const map: Record<string, number> = {};
    targetDist.filter(r => Number(r.month_num) === month).forEach(r => { map[String(r.dist_code)] = Number(r.target || 0); });
    return map;
  }, [targetDist, month]);

  // ---- Rekap Harian ----
  const dailyView = useMemo(() => {
    if (!daily.data) return null;
    const valMap = new Map<string, number>();
    daily.data.forEach(r => valMap.set(`${r.do_date}|${r.dist_code}`, Number(r.total_qty)));
    const daysInMonth = new Date(year, month, 0).getDate();
    const colTotal: Record<string, number> = {}; distCodes.forEach(c => { colTotal[c] = 0; });
    let grandTotal = 0;
    const days: { d: number; iso: string; red: boolean; vals: number[]; rowTotal: number }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${pad2(month)}-${pad2(d)}`;
      let rowTotal = 0;
      const vals = distCodes.map(c => {
        const v = valMap.get(`${iso}|${c}`) || 0;
        rowTotal += v; colTotal[c] += v;
        return v;
      });
      grandTotal += rowTotal;
      if (rowTotal === 0) continue; // hari tanpa transaksi disembunyikan
      days.push({ d, iso, red: !isWorkingDay(year, month, d), vals, rowTotal });
    }
    return { days, colTotal, grandTotal };
  }, [daily.data, distCodes, year, month]);

  // ---- Rekap Mingguan + vs Target ----
  const weeklyView = useMemo(() => {
    if (!weekly.data) return null;
    const valMapAll = new Map<string, number>();
    weekly.data.forEach(r => valMapAll.set(`${r.do_date}|${r.dist_code}`, Number(r.total_qty)));
    const buckets = weekBucketsForMonth(year, month);
    const nSlots = 6;
    const weeklyByDist: Record<string, number[]> = {};
    distCodes.forEach(c => {
      weeklyByDist[c] = buckets.map(b => b.days.reduce((s, d) => s + (valMapAll.get(`${year}-${pad2(month)}-${pad2(d)}|${c}`) || 0), 0));
    });
    const totalWorkingDays = buckets.reduce((s, b) => s + b.workingDays, 0);
    let cumWorking = 0;
    const benchmarks: number[] = [];
    for (let i = 0; i < nSlots; i++) {
      if (i < buckets.length) { cumWorking += buckets[i].workingDays; benchmarks.push(totalWorkingDays > 0 ? Math.min(100, cumWorking / totalWorkingDays * 100) : 0); }
      else benchmarks.push(benchmarks[i - 1] ?? 100);
    }

    let targetRowTotal = 0;
    distCodes.forEach(c => { const t = targetMap[c]; if (t != null) targetRowTotal += t; });

    const colTotal: Record<string, number> = {}; distCodes.forEach(c => { colTotal[c] = 0; });
    let grand = 0;
    const weekRows: { i: number; vals: number[]; rowTotal: number }[] = [];
    const weekVisible: boolean[] = [];
    for (let i = 0; i < nSlots; i++) {
      const has = i < buckets.length;
      let rowTotal = 0;
      const vals = distCodes.map(c => {
        const v = has ? weeklyByDist[c][i] : 0;
        if (has) { colTotal[c] += v; rowTotal += v; }
        return v;
      });
      const visible = has && rowTotal > 0;
      weekVisible.push(visible);
      if (has) grand += rowTotal;
      if (!visible) continue;
      weekRows.push({ i, vals, rowTotal });
    }

    const cumByDist: Record<string, number> = {}; distCodes.forEach(c => { cumByDist[c] = 0; });
    const pacing: { i: number; bench: number; cells: (number | null)[]; totalP: number }[] = [];
    for (let i = 0; i < nSlots; i++) {
      const has = i < buckets.length;
      let cumTotalTonase = 0, cumTotalTargetKnown = 0;
      const cells = distCodes.map(c => {
        if (has) cumByDist[c] += weeklyByDist[c][i];
        const t = targetMap[c];
        if (t == null) return null;
        cumTotalTargetKnown += t; cumTotalTonase += cumByDist[c];
        return t > 0 ? cumByDist[c] / t * 100 : 0;
      });
      const totalP = cumTotalTargetKnown > 0 ? cumTotalTonase / cumTotalTargetKnown * 100 : 0;
      if (!weekVisible[i]) continue;
      pacing.push({ i, bench: benchmarks[i], cells, totalP });
    }
    return { weekRows, colTotal, grand, targetRowTotal, pacing };
  }, [weekly.data, distCodes, targetMap, year, month]);

  const label = `${MONTHS_ID[month]}_${year}${jenis !== 'all' ? '_' + jenis : ''}`;
  const loadErr = daily.error || weekly.error;

  return (
    <div>
      <PageHeader title="Rekap Harian" status={freshness.status} statusVariant={freshness.statusVariant}>
        <div className="controls !mb-0">
          <Select label="Bulan" value={period} onChange={e => setPeriod(e.target.value)}
            options={periods.map(p => ({ value: `${p.year}-${p.month}`, label: `${MONTHS_ID[p.month]} ${p.year}` }))} />
          <Select label="Jenis Semen" value={jenis} onChange={e => setJenis(e.target.value)}
            options={[{ value: 'all', label: 'Semua Jenis' }, ...jenisList.map(j => ({ value: j, label: j }))]} />
          <div className="ml-auto">
            <ExportButton pageId="rekap-harian" filename={() => `Rekap_Harian_${label}.xlsx`}
              getTables={() => [
                { name: 'Rekap Mingguan', el: wRef.current },
                { name: 'Mingguan vs Target', el: pRef.current },
                { name: 'Rekap Harian', el: rRef.current },
              ]} />
          </div>
        </div>
      </PageHeader>

      {loadErr && <ErrorBox error={loadErr} />}

      <h2 className="section-title">Rekap Mingguan</h2>
      <TableWrap>
        <table ref={wRef} className="font-mono">
          <thead><tr>
            <th style={{ minWidth: 70 }}>Minggu</th>
            {distCodes.map(c => <th key={c} className="num">{c}</th>)}
            <th className="num bg-accent-soft">TOTAL</th>
          </tr></thead>
          <tbody>
            {weeklyView && <>
              <tr className="bg-accent-soft font-bold">
                <td>TARGET</td>
                {distCodes.map(c => <td key={c} className="num">{targetMap[c] != null ? fmt(targetMap[c]) : <Dash />}</td>)}
                <td className="num font-extrabold">{fmt(weeklyView.targetRowTotal)}</td>
              </tr>
              {weeklyView.weekRows.map(w => (
                <tr key={w.i}>
                  <td>M{w.i + 1}</td>
                  {w.vals.map((v, k) => <td key={distCodes[k]} className="num">{v ? fmt(v) : <Dash />}</td>)}
                  <td className="num bg-surface2 font-bold">{fmt(w.rowTotal)}</td>
                </tr>
              ))}
              <tr className="font-bold" style={{ borderTop: '2px solid #AFA790' }}>
                <td>TOTAL</td>
                {distCodes.map(c => <td key={c} className="num bg-surface2">{weeklyView.colTotal[c] ? fmt(weeklyView.colTotal[c]) : '–'}</td>)}
                <td className="num bg-accent-soft font-extrabold">{fmt(weeklyView.grand)}</td>
              </tr>
            </>}
          </tbody>
        </table>
      </TableWrap>

      <h2 className="section-title !mt-[30px]">Rekap Mingguan vs Target</h2>
      <div className="legend">
        <span><i style={{ background: COLORS.green }} aria-hidden="true" />Capaian ≥ ambang pacing minggu itu</span>
        <span><i style={{ background: COLORS.red }} aria-hidden="true" />Di bawah ambang</span>
      </div>
      <TableWrap>
        <table ref={pRef} className="font-mono">
          <thead><tr>
            <th style={{ minWidth: 120 }}>Minggu</th>
            {distCodes.map(c => <th key={c} className="num">{c}</th>)}
            <th className="num bg-accent-soft">TOTAL</th>
          </tr></thead>
          <tbody>
            {weeklyView?.pacing.map(p => (
              <tr key={p.i}>
                <td>%M{p.i + 1} <span className="text-faint">({p.bench.toFixed(1)}%)</span></td>
                {p.cells.map((v, k) => v == null
                  ? <td key={distCodes[k]} className="num"><Dash /></td>
                  : <td key={distCodes[k]} className="num font-semibold" style={{ color: v >= p.bench ? COLORS.green : COLORS.red }}>{v.toFixed(2)}%</td>)}
                <td className="num bg-surface2 font-bold" style={{ color: p.totalP >= p.bench ? COLORS.green : COLORS.red }}>{p.totalP.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <h2 className="section-title !mt-[34px]">Rekap Harian</h2>
      <TableWrap>
        <table ref={rRef} className="font-mono">
          <thead><tr>
            <th style={{ minWidth: 80 }}>Tanggal</th>
            {distCodes.map(c => <th key={c} className="num">{c}</th>)}
            <th className="num bg-accent-soft">TOTAL</th>
          </tr></thead>
          <tbody>
            {dailyView && (dailyView.days.length === 0
              ? <tr><td colSpan={distCodes.length + 2} className="!text-center text-faint !p-5">Belum ada transaksi bulan ini.</td></tr>
              : dailyView.days.map(day => (
                <tr key={day.iso} className={day.red ? 'bg-red-soft' : undefined}>
                  <td className={day.red ? 'text-accent-ink font-semibold' : undefined}>{pad2(day.d)}-{MONTHS_ID[month]}</td>
                  {day.vals.map((v, k) => {
                    const c = distCodes[k];
                    if (!v) return <td key={c} className="num"><Dash /></td>;
                    // Role tanpa hak lihat detail -> angka biasa (server juga menolak kalau dipaksa buka manual).
                    if (!canViewDetail('rekap-harian')) return <td key={c} className="num">{fmt(v)}</td>;
                    return (
                      <td key={c} className="num">
                        <CellLink to={`/transaksi-detail?date=${day.iso}&dist=${encodeURIComponent(c)}&jenis=${encodeURIComponent(jenis)}`}>{fmt(v)}</CellLink>
                      </td>
                    );
                  })}
                  <td className="num bg-surface2 font-bold">{fmt(day.rowTotal)}</td>
                </tr>
              )))}
          </tbody>
          {dailyView && (
            <tfoot><tr>
              <td className="font-bold">TOTAL</td>
              {distCodes.map(c => <td key={c} className="num bg-surface2 font-bold">{dailyView.colTotal[c] ? fmt(dailyView.colTotal[c]) : '–'}</td>)}
              <td className="num bg-accent-soft font-extrabold">{fmt(dailyView.grandTotal)}</td>
            </tr></tfoot>
          )}
        </table>
      </TableWrap>
    </div>
  );
}
