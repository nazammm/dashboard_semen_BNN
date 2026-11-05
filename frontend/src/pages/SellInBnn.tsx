import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, MONTHS_ID, chartSRSummary, dailyFreshness, fmt, fmtCompact, pct } from '../lib/format';
import {
  addDays, addMonths, addYears, daysInMonth, endOfMonth, fmtDate, fmtRange, isISO, parseISO, startOfMonth, startOfQuarter, startOfYear,
  toISO, type DateRange,
} from '../lib/dates';
import type { Row } from '../lib/types';
import { DateRangePicker, type RangePreset } from '../components/DateRangePicker';
import { GrowthTable } from '../components/GrowthTable';
import { Capaian, Card, ChartBox, Chip, ErrorBox, ExportButton, FilterBar, Kpi, PageHeader, PageSkeleton, Select, TableWrap, cx } from '../components/ui';

/* ============================================================================
   Sell In BNN: detail harian dari upload raw sell in, dibandingkan dengan target
   dan realisasi tahun lalu dari data Sell In bulanan (v_delivery_ext).

   Kecocokan dua sumber (dicek Nov 2026): realisasi bulanan v_delivery_ext = Sell In BNN
   untuk STR + RJW (tanpa semen putih/mortar), selisih 0,2-0,8% per bulan. Karena itu
   pembanding target/2025 dihitung pada cakupan yang sama, dan default Tipe Semen = STR + RJW.
   Target & 2025 hanya ada per bulan: untuk bulan yang tidak penuh di periode, dibagi rata per hari.
============================================================================ */

type Semen = 'STR' | 'RJW' | 'PUTIH';
interface Rec { tanggal: string; sub: string; produk: string; semen: Semen; tipe: string; ton: number; kirim: number }

const UNMAPPED = 'Belum dipetakan';
const OTHER_REGION = 'Lainnya';
const key = (s: unknown) => String(s ?? '').trim().toUpperCase();
const shortProduk = (p: string) => p.replace(/^NEW\s*-\s*/i, '');
const semenOf = (produk: string): Semen => (/RAJAWALI/i.test(produk) ? 'RJW' : /WHITE|MORTAR|THINBED/i.test(produk) ? 'PUTIH' : 'STR');
const SEMEN_OPTS = [
  { value: 'abu', label: 'STR + RJW' },
  { value: 'STR', label: 'STR' },
  { value: 'RJW', label: 'RJW' },
  { value: 'PUTIH', label: 'Putih & Mortar' },
  { value: 'all', label: 'Semua jenis' },
];
const semenMatch = (f: string, s: Semen) => f === 'all' || (f === 'abu' ? s !== 'PUTIH' : s === f);
const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 ? 1 : 0);
const growthPct = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev * 100 : null);
const fmtPct = (p: number | null, d = 1) => (p == null ? '–' : (p > 0 ? '+' : '') + p.toFixed(d) + '%');

function presetsFor(last: string): RangePreset[] {
  const prevMonth = addMonths(startOfMonth(last), -1);
  return [
    { label: 'Tahun berjalan (YTD)', range: { from: startOfYear(last), to: last } },
    { label: 'Kuartal berjalan (QTD)', range: { from: startOfQuarter(last), to: last } },
    { label: 'Bulan berjalan (MTD)', range: { from: startOfMonth(last), to: last } },
    { label: 'Bulan lalu', range: { from: prevMonth, to: endOfMonth(prevMonth) } },
    { label: '30 hari terakhir', range: { from: addDays(last, -29), to: last } },
    { label: '7 hari terakhir', range: { from: addDays(last, -6), to: last } },
  ];
}

/** Nilai bulanan (indeks 1..12) dijumlah untuk sebagian/seluruh hari dalam rentang, dibagi rata per hari. */
function prorate(arr: number[], r: DateRange, year: number) {
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    if (!arr[m]) continue;
    const from = toISO(year, m, 1), to = toISO(year, m, daysInMonth(year, m));
    const a = r.from > from ? r.from : from, b = r.to < to ? r.to : to;
    if (a > b) continue;
    total += arr[m] * (Number(b.slice(8)) - Number(a.slice(8)) + 1) / daysInMonth(year, m);
  }
  return total;
}

export default function SellInBnn() {
  useDocTitle('Sell In BNN');
  const load = useAsync(async () => {
    const [rows, info, delivery] = await Promise.all([
      DataSource.sellinDaily(), DataSource.sellinInfo(),
      DataSource.delivery().catch(() => null),        // tanpa akses / gagal -> pembanding target & 2025 disembunyikan
    ]);
    return { rows, info, delivery };
  }, []);
  if (load.error) return <ErrorBox error={load.error} />;
  if (!load.data) return <PageSkeleton />;
  const { rows, info, delivery } = load.data;
  const last = String(info?.data_sampai ?? '').slice(0, 10);
  if (!rows.length || !isISO(last)) return <EmptyState />;
  return <Body rows={rows} info={info!} last={last} delivery={delivery} />;
}

function EmptyState() {
  const { pageAllowed } = useAuth();
  return (
    <>
      <PageHeader title="Sell In BNN" />
      <div className="card max-w-[620px]">
        <h2 className="!text-[20px]">Belum ada data</h2>
        <p className="text-soft text-[13.5px] mt-2 leading-relaxed">
          Data Sell In BNN berasal dari file export raw sell in yang diunggah admin.
        </p>
        {pageAllowed('upload-sell-in') && <Link to="/upload-sell-in" className="btn btn-primary no-underline mt-4">Upload data sekarang</Link>}
      </div>
    </>
  );
}

/** Tahun target dari nama kolom target_YYYY di v_delivery_ext. */
function detectYear(rows: Row[] | null, fallback: number) {
  let y = 0;
  if (rows?.[0]) for (const k of Object.keys(rows[0])) { const m = /^target_(\d{4})$/.exec(k); if (m) y = Math.max(y, Number(m[1])); }
  return y || fallback;
}

function Body({ rows, info, last, delivery }: { rows: Row[]; info: Row; last: string; delivery: Row[] | null }) {
  const first = String(info.data_mulai ?? last).slice(0, 10);
  const Y = detectYear(delivery, Number(last.slice(0, 4))), P = Y - 1;
  const kTgt = `target_${Y}`, kPrev = `realisasi_${P}`;

  /* ---------- peta sub region -> region & nama tampilan ---------- */
  const geo = useMemo(() => {
    const vol = new Map<string, Map<string, number>>();   // sub -> (region -> volume)
    const name = new Map<string, string>();
    (delivery || []).forEach(r => {
      const s = key(r.sub_region); if (!s) return;
      if (!name.has(s)) name.set(s, String(r.sub_region));
      const m = vol.get(s) || new Map<string, number>(); vol.set(s, m);
      m.set(String(r.region), (m.get(String(r.region)) || 0) + Number(r[kTgt] || 0) + Number(r[kPrev] || 0) + 1);
    });
    rows.forEach(r => { const s = key(r.region || UNMAPPED); name.set(s, String(r.region || UNMAPPED)); });   // nama dari Sell In BNN lebih diutamakan
    const parent = new Map<string, string>();
    vol.forEach((m, s) => parent.set(s, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]));   // sub di 2 region (mis. DUMAI) -> region terbesar
    return { parentOf: (s: string) => parent.get(s) || OTHER_REGION, nameOf: (s: string) => name.get(s) || s };
  }, [delivery, rows, kTgt, kPrev]);

  const recs = useMemo<Rec[]>(() => rows.map(r => {
    const produk = String(r.produk || '–');
    return { tanggal: String(r.tanggal).slice(0, 10), sub: key(r.region || UNMAPPED), produk, semen: semenOf(produk),
      tipe: String(r.tipe_pesanan || '–'), ton: Number(r.ton || 0), kirim: Number(r.pengiriman || 0) };
  }), [rows]);

  /* ---------- filter ---------- */
  const presets = useMemo(() => presetsFor(last), [last]);
  const [range, setRange] = useState<DateRange>(() => presets[0].range);   // default: tahun berjalan
  const [region, setRegion] = useState('all');
  const [sub, setSub] = useState('all');
  const [semen, setSemen] = useState('abu');
  const [produk, setProduk] = useState('all');
  const [tipe, setTipe] = useState('all');
  const tableRef = useRef<HTMLTableElement>(null);

  const opts = useMemo(() => {
    const regions = new Map<string, number>(), subs = new Map<string, number>(), produks = new Map<string, number>();
    recs.forEach(r => {
      const reg = geo.parentOf(r.sub);
      regions.set(reg, (regions.get(reg) || 0) + r.ton);
      if (region === 'all' || reg === region) subs.set(r.sub, (subs.get(r.sub) || 0) + r.ton);
      if (semenMatch(semen, r.semen)) produks.set(r.produk, (produks.get(r.produk) || 0) + r.ton);
    });
    const byTon = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return { regions: byTon(regions), subs: byTon(subs), produks: byTon(produks), tipes: ['Gudang', 'Toko', 'Project'].filter(t => recs.some(r => r.tipe === t)) };
  }, [recs, geo, region, semen]);

  const changeRegion = (v: string) => { setRegion(v); if (v !== 'all' && sub !== 'all' && geo.parentOf(sub) !== v) setSub('all'); };
  const changeSemen = (v: string) => { setSemen(v); if (produk !== 'all' && !semenMatch(v, semenOf(produk))) setProduk('all'); };
  const filterActive = region !== 'all' || sub !== 'all' || semen !== 'abu' || produk !== 'all' || tipe !== 'all';
  const resetFilter = () => { setRegion('all'); setSub('all'); setSemen('abu'); setProduk('all'); setTipe('all'); };

  // Pembanding target & 2025 hanya sah pada cakupan yang sama dengan data Sell In bulanan
  const why = !delivery ? 'Data target tidak tersedia.'
    : semen === 'PUTIH' ? 'Semen putih & mortar tidak punya target.'
      : produk !== 'all' ? 'Target hanya per tipe semen, bukan per produk.'
        : tipe !== 'all' ? 'Target mencakup semua tipe pesanan.'
          : range.from.slice(0, 4) !== String(Y) || range.to.slice(0, 4) !== String(Y) ? `Target hanya untuk tahun ${Y}.` : null;
  const comparable = why == null;
  const groupBy: 'region' | 'sub' = region === 'all' ? 'region' : 'sub';
  const groupOf = (s: string) => (groupBy === 'region' ? geo.parentOf(s) : s);
  const groupName = (g: string) => (groupBy === 'region' ? g : geo.nameOf(g));

  const v = useMemo(() => {
    const inRange = (d: string) => d >= range.from && d <= range.to;
    const geoMatch = (s: string) => (region === 'all' || geo.parentOf(s) === region) && (sub === 'all' || s === sub);
    const match = (r: Rec, skipProduk = false) => geoMatch(r.sub) && semenMatch(semen, r.semen) && (skipProduk || produk === 'all' || r.produk === produk) && (tipe === 'all' || r.tipe === tipe);
    const cur = recs.filter(r => match(r) && inRange(r.tanggal));
    const ton = cur.reduce((a, r) => a + r.ton, 0), kirim = cur.reduce((a, r) => a + r.kirim, 0);

    // target & 2025 per bulan, total dan per kelompok (region / sub region)
    const tArr = new Array(13).fill(0), pArr = new Array(13).fill(0);
    const gArr = new Map<string, { t: number[]; p: number[] }>();
    (delivery || []).forEach(r => {
      const s = key(r.sub_region), m = Number(r.month_num);
      if (!(m >= 1 && m <= 12) || !geoMatch(s)) return;
      const ty = String(r.type_cement).toUpperCase() as Semen;
      if (!(semen === 'abu' || semen === 'all' || semen === ty)) return;
      const t = Number(r[kTgt] || 0), p = Number(r[kPrev] || 0);
      tArr[m] += t; pArr[m] += p;
      const g = groupOf(s);
      const e = gArr.get(g) || { t: new Array(13).fill(0), p: new Array(13).fill(0) }; gArr.set(g, e);
      e.t[m] += t; e.p[m] += p;
    });
    const prevRange = { from: addYears(range.from, -1), to: addYears(range.to, -1) };
    const target = comparable ? prorate(tArr, range, Y) : 0;
    const prev = comparable ? prorate(pArr, prevRange, P) : 0;

    // daftar kelompok wilayah & produk
    const gCur = new Map<string, number>();
    cur.forEach(r => { const g = groupOf(r.sub); gCur.set(g, (gCur.get(g) || 0) + r.ton); });
    const groups = [...gCur.entries()].sort((a, b) => b[1] - a[1]).map(([g, t]) => {
      const e = gArr.get(g);
      const gt = comparable && e ? prorate(e.t, range, Y) : 0, gp = comparable && e ? prorate(e.p, prevRange, P) : 0;
      return { key: g, ton: t, share: ton ? t / ton * 100 : 0, target: gt, capaian: comparable && gt > 0 ? pct(t, gt) : null, growth: comparable ? growthPct(t, gp) : null };
    });
    const pCur = new Map<string, number>();
    recs.forEach(r => { if (match(r, true) && inRange(r.tanggal)) pCur.set(r.produk, (pCur.get(r.produk) || 0) + r.ton); });
    const pTot = [...pCur.values()].reduce((a, x) => a + x, 0);
    const produks = [...pCur.entries()].sort((a, b) => b[1] - a[1]).map(([k, t]) => ({ key: k, ton: t, share: pTot ? t / pTot * 100 : 0, target: 0, capaian: null, growth: null }));

    // matriks kelompok x produk
    const prodTotals = new Map<string, number>(), matrix = new Map<string, Map<string, number>>();
    cur.forEach(r => {
      prodTotals.set(r.produk, (prodTotals.get(r.produk) || 0) + r.ton);
      const g = groupOf(r.sub);
      const m = matrix.get(g) || new Map<string, number>(); matrix.set(g, m);
      m.set(r.produk, (m.get(r.produk) || 0) + r.ton);
    });
    const prodCols = [...prodTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

    // tren: harian / mingguan / bulanan sesuai panjang periode
    const span = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1;
    const unit: 'hari' | 'minggu' | 'bulan' = span <= 62 ? 'hari' : span <= 200 ? 'minggu' : 'bulan';
    const bucketOf = (iso: string) => {
      if (unit === 'hari') return iso;
      if (unit === 'bulan') return iso.slice(0, 7);
      const { y, m, d } = parseISO(iso);
      const start = addDays(iso, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));   // Senin
      return start < range.from ? range.from : start;
    };
    const buckets: { k: string; from: string; to: string }[] = [];
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
      const k = bucketOf(d), lastB = buckets[buckets.length - 1];
      if (lastB && lastB.k === k) lastB.to = d; else buckets.push({ k, from: d, to: d });
    }
    const bCur = new Map<string, number>(buckets.map(b => [b.k, 0]));
    cur.forEach(r => { const k = bucketOf(r.tanggal); bCur.set(k, (bCur.get(k) || 0) + r.ton); });
    const trend = {
      // bulan yang tidak penuh di periode diberi keterangan tanggal, mis. "Nov (1–3)", supaya angka kecilnya tidak disangka anjlok
      labels: buckets.map(b => {
        if (unit !== 'bulan') return `${+b.k.slice(8)} ${MONTHS_ID[+b.k.slice(5, 7)]}`;
        const full = b.from.slice(8) === '01' && b.to === endOfMonth(b.from);
        return MONTHS_ID[+b.k.slice(5, 7)] + (full ? '' : ` (${+b.from.slice(8)}–${+b.to.slice(8)})`);
      }),
      cur: buckets.map(b => bCur.get(b.k) || 0),
      target: buckets.map(b => (comparable ? prorate(tArr, b, Y) : null)),
      prev: buckets.map(b => (comparable ? prorate(pArr, { from: addYears(b.from, -1), to: addYears(b.to, -1) }, P) : null)),
    };

    // rincian per bulan (gaya halaman Sell In): bulan di dalam periode
    const monthRows: { month_num: number; target: number; prev: number; cur: number }[] = [];
    if (comparable) {
      const mCur = new Array(13).fill(0);
      cur.forEach(r => { mCur[+r.tanggal.slice(5, 7)] += r.ton; });
      for (let m = +range.from.slice(5, 7); m <= +range.to.slice(5, 7); m++) {
        const mr = { from: toISO(Y, m, 1) < range.from ? range.from : toISO(Y, m, 1), to: toISO(Y, m, daysInMonth(Y, m)) > range.to ? range.to : toISO(Y, m, daysInMonth(Y, m)) };
        monthRows.push({ month_num: m, cur: mCur[m], target: prorate(tArr, mr, Y), prev: prorate(pArr, { from: addYears(mr.from, -1), to: addYears(mr.to, -1) }, P) });
      }
    }
    const drillGroups = (month: number) => {
      const s = new Map<string, number>();
      cur.forEach(r => { if (+r.tanggal.slice(5, 7) === month) { const g = groupOf(r.sub); s.set(g, (s.get(g) || 0) + r.ton); } });
      return [...s.entries()].map(([g, val]) => ({ label: groupName(g), value: val })).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
    };

    return { ton, kirim, target, prev, prevRange, groups, produks, prodCols, prodTotals, matrix, unit, trend, monthRows, drillGroups };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, delivery, range.from, range.to, region, sub, semen, produk, tipe, comparable, groupBy, Y, P, kTgt, kPrev]);

  const growth = comparable ? growthPct(v.ton, v.prev) : null;
  const rangeLabel = fmtRange(range);
  const prevLabel = fmtRange(v.prevRange);
  const freshness = dailyFreshness({ max_do_date: last });
  const semenLabel = SEMEN_OPTS.find(o => o.value === semen)!.label;
  const scope = [sub !== 'all' ? geo.nameOf(sub) : region !== 'all' && region, semenLabel, produk !== 'all' && shortProduk(produk), tipe !== 'all' && tipe].filter(Boolean).join(' · ');
  const naNote = <span className="text-faint">{why}</span>;

  return (
    <>
      <PageHeader title="Sell In BNN" status={freshness.status} statusVariant={freshness.statusVariant}
        desc="Pengiriman ke gudang distributor, ditambah toko dan project PT Permata Multi Niaga dari ITP-Palembang Terminal. Target dan realisasi tahun lalu dari data Sell In bulanan." />

      <FilterBar label="Filter Sell In BNN" stickyMobile={false} className="max-[880px]:grid max-[880px]:grid-cols-2 max-[880px]:gap-2 max-[880px]:[&_select]:w-full max-[880px]:[&_select]:min-w-0 max-[880px]:[&_select]:text-[12px]">
        <div className="max-[880px]:col-span-2 [&_.drp-trigger]:max-[880px]:w-full">
          <DateRangePicker label="Periode" value={range} onChange={setRange} min={first} max={last} presets={presets} />
        </div>
        <Select label="Region" value={region} onChange={e => changeRegion(e.target.value)} style={{ minWidth: 130 }}
          options={[{ value: 'all', label: 'Semua Region' }, ...opts.regions.map(r => ({ value: r, label: r }))]} />
        <Select label="Sub Region" value={sub} onChange={e => setSub(e.target.value)} style={{ minWidth: 140 }}
          options={[{ value: 'all', label: 'Semua Sub Region' }, ...opts.subs.map(s => ({ value: s, label: geo.nameOf(s) }))]} />
        <Select label="Tipe Semen" value={semen} onChange={e => changeSemen(e.target.value)} style={{ minWidth: 130 }} options={SEMEN_OPTS} />
        <Select label="Produk" value={produk} onChange={e => setProduk(e.target.value)} style={{ minWidth: 170 }}
          options={[{ value: 'all', label: 'Semua Produk' }, ...opts.produks.map(p => ({ value: p, label: shortProduk(p) }))]} />
        <div className="control max-[880px]:col-span-2">
          <span id="sibTipe" className="control-group-label">Tipe Pesanan</span>
          <div className="pill-row h-9 items-center" role="group" aria-labelledby="sibTipe">
            <Chip active={tipe === 'all'} onClick={() => setTipe('all')}>Semua</Chip>
            {opts.tipes.map(t => <Chip key={t} active={tipe === t} onClick={() => setTipe(t)}>{t}</Chip>)}
          </div>
        </div>
        {filterActive && (
          <button type="button" className="btn btn-sm self-end max-[880px]:col-span-2 max-[880px]:justify-center" onClick={resetFilter}>Reset filter</button>
        )}
      </FilterBar>

      <div className="grid-kpi">
        <Kpi title={`Target · ${rangeLabel}`} value={comparable ? fmtTon(v.target) : '–'} unit={comparable ? 'ton' : undefined}
          delta={comparable ? <span className="text-faint">Target {Y} untuk tanggal yang sama</span> : naNote} />
        <Kpi title={`Realisasi · ${rangeLabel}`} value={fmtTon(v.ton)} unit="ton"
          delta={<span className="inline-flex items-center gap-2 flex-wrap">{comparable && <Capaian actual={v.ton} target={v.target} />}<span className="text-faint">{fmt(v.kirim)} pengiriman</span></span>} />
        <Kpi title={`Pertumbuhan vs ${P}`}
          value={<span className={growth == null ? '' : growth >= 0 ? 'text-green' : 'text-red'}>{fmtPct(growth)}</span>}
          delta={comparable ? <span className="text-faint">{rangeLabel} vs {prevLabel}</span> : naNote} />
        <Kpi title={`Realisasi ${P} · Periode Sama`} value={comparable ? fmtTon(v.prev) : '–'} unit={comparable ? 'ton' : undefined}
          delta={comparable ? <span className="text-faint">{prevLabel}</span> : naNote} />
      </div>

      <Card title={`Sell In per ${v.unit === 'hari' ? 'Hari' : v.unit === 'minggu' ? 'Minggu' : 'Bulan'} (Ton) · ${scope}`} className="mt-3.5">
        <div className="legend">
          {comparable && <span><i style={{ background: COLORS.blueMid }} aria-hidden="true" />Target {Y}</span>}
          <span><i style={{ background: COLORS.accent }} aria-hidden="true" />Realisasi {Y}</span>
          {comparable && <span><i style={{ background: COLORS.ink, opacity: .35 }} aria-hidden="true" />Realisasi {P}</span>}
        </div>
        <ChartBox className="tall" label={chartSRSummary(v.trend.labels, v.trend.cur, `ton realisasi ${Y}`)}
          deps={[v.trend.labels.join('|'), v.trend.cur.join('|'), v.trend.target.join('|'), v.trend.prev.join('|')]}
          build={() => ({
            type: 'bar',
            data: { labels: v.trend.labels, datasets: [
              { label: `Target ${Y}`, data: v.trend.target, type: 'line', borderColor: COLORS.blueMid, backgroundColor: COLORS.blueMid, borderDash: [4, 3], borderWidth: 2, pointRadius: v.trend.labels.length > 40 ? 0 : 2, fill: false, tension: .3, order: 1, hidden: !comparable },
              { label: `Realisasi ${Y}`, data: v.trend.cur, backgroundColor: COLORS.accent, maxBarThickness: 26, order: 2 },
              { label: `Realisasi ${P}`, data: v.trend.prev, backgroundColor: 'rgba(33,30,25,.22)', borderRadius: 3, maxBarThickness: 26, order: 3, hidden: !comparable },
            ] } as any,
            options: { responsive: true, maintainAspectRatio: false,
              scales: { y: { beginAtZero: true, grid: { color: COLORS.line }, ticks: { callback: (x: any) => fmtCompact(x) } }, x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0 } } },
              plugins: { tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${c.parsed.y == null ? '–' : fmt(c.parsed.y)} ton` } } } },
          })} />
        <p className="sr-only">{chartSRSummary(v.trend.labels, v.trend.cur, `ton realisasi ${Y}`)}</p>
      </Card>

      {comparable && v.monthRows.length > 0 && (
        <>
          <h2 className="section-title">Rincian per Bulan · Sell In (Ton)</h2>
          <GrowthTable caption={`Rincian sell in per bulan: target, realisasi ${P} dan ${Y}, pertumbuhan, capaian`}
            rows={v.monthRows} Y={Y} P={P} labels={{ target: 'Target', value: 'Sell In', capaian: 'Capaian' }}
            drill={{ enabled: true, groupsFor: v.drillGroups,
              heading: m => `Komposisi Sell In ${MONTHS_ID[m]} ${Y} · per ${groupBy === 'region' ? 'Region' : 'Sub Region'}`,
              title: m => `Lihat komposisi sell in ${MONTHS_ID[m]}` }} />
        </>
      )}

      <div className="grid grid-cols-2 gap-4 mt-[38px] max-[1000px]:grid-cols-1">
        <RankCard title={groupBy === 'region' ? 'Per Region' : `Per Sub Region · ${region}`} items={v.groups} withTarget={comparable} P={P}
          label={groupName} selected={groupBy === 'region' ? region : sub}
          onPick={k => (groupBy === 'region' ? changeRegion(region === k ? 'all' : k) : setSub(sub === k ? 'all' : k))} />
        <RankCard title="Per Produk" items={v.produks} withTarget={false} P={P} label={shortProduk} selected={produk}
          onPick={k => setProduk(produk === k ? 'all' : k)} />
      </div>

      <div className="flex items-baseline justify-between gap-3 flex-wrap mt-[38px] mb-3.5">
        <h2 className="section-title !m-0">Rekap {groupBy === 'region' ? 'Region' : 'Sub Region'} × Produk <span className="n">ton · {rangeLabel}{tipe !== 'all' ? ' · ' + tipe : ''}</span></h2>
        <ExportButton pageId="sell-in-bnn" filename={() => `Sell_In_BNN_${range.from}_${range.to}.xlsx`} getTables={() => [{ name: 'Rekap', el: tableRef.current }]} />
      </div>
      <TableWrap>
        <table ref={tableRef} className="tbl-num">
          <caption className="sr-only">Tonase sell in per {groupBy === 'region' ? 'region' : 'sub region'} dan produk, {rangeLabel}</caption>
          <thead><tr>
            <th>{groupBy === 'region' ? 'Region' : 'Sub Region'}</th>
            {v.prodCols.map(p => <th key={p} className="num" title={p}>{shortProduk(p)}</th>)}
            <th className="num bg-accent-soft">Total</th>
            {comparable && <><th className="num">Target</th><th className="num">Capaian</th><th className="num">vs {P}</th></>}
          </tr></thead>
          <tbody>
            {v.groups.length === 0 && <tr><td colSpan={v.prodCols.length + 5} className="!text-center !text-faint !p-6 !font-sans">Tidak ada pengiriman pada periode dan filter ini.</td></tr>}
            {v.groups.map(g => {
              const m = v.matrix.get(g.key);
              return (
                <tr key={g.key}>
                  <td className={cx('!font-sans !text-[13px] font-semibold', (g.key === UNMAPPED.toUpperCase() || g.key === OTHER_REGION) && 'text-faint italic')}>{groupName(g.key)}</td>
                  {v.prodCols.map(p => { const c = m?.get(p) || 0; return <td key={p} className="num">{c ? fmtTon(c) : <span className="text-faint">–</span>}</td>; })}
                  <td className="num bg-surface2 font-bold">{fmtTon(g.ton)}</td>
                  {comparable && <>
                    <td className="num text-soft">{g.target ? fmtTon(g.target) : '–'}</td>
                    <td className="num">{g.target ? <Capaian actual={g.ton} target={g.target} /> : <span className="text-faint">–</span>}</td>
                    <td className={cx('num', g.growth == null ? 'text-faint' : g.growth >= 0 ? 'text-green' : 'text-red')}>{fmtPct(g.growth)}</td>
                  </>}
                </tr>
              );
            })}
          </tbody>
          {v.groups.length > 0 && (
            <tfoot><tr>
              <td className="!font-sans !text-[13px] font-bold">Total</td>
              {v.prodCols.map(p => <td key={p} className="num font-bold">{fmtTon(v.prodTotals.get(p) || 0)}</td>)}
              <td className="num bg-accent-soft font-extrabold">{fmtTon(v.ton)}</td>
              {comparable && <>
                <td className="num font-bold">{fmtTon(v.target)}</td>
                <td className="num"><Capaian actual={v.ton} target={v.target} /></td>
                <td className={cx('num font-bold', growth == null ? 'text-faint' : growth >= 0 ? 'text-green' : 'text-red')}>{fmtPct(growth)}</td>
              </>}
            </tr></tfoot>
          )}
        </table>
      </TableWrap>
      <p className="text-faint text-[12px] mt-2.5 leading-relaxed max-w-[900px]">
        Tonase = Delivery Quantity × berat per zak. Target {Y} dan realisasi {P} dari data Sell In bulanan (STR + RJW); untuk bulan yang tidak penuh di periode, dibagi rata per hari.
        {' '}Data {fmtDate(first)} s.d. {fmtDate(last)}{info.upload_terakhir ? `, upload terakhir ${new Date(info.upload_terakhir).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} oleh ${info.upload_oleh}` : ''}.
      </p>
    </>
  );
}

/* Daftar peringkat dengan batang (HTML): label jelas, bisa diklik untuk memfilter. */
function RankCard({ title, items, selected, label, onPick, withTarget, P }: {
  title: string; items: { key: string; ton: number; share: number; target: number; capaian: number | null; growth: number | null }[];
  selected: string; label: (k: string) => string; onPick: (k: string) => void; withTarget: boolean; P: number;
}) {
  const max = items[0]?.ton || 1;
  return (
    <Card className="!pb-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="card-title !mb-0">{title}</div>
        <span className="text-[11px] text-faint">Klik untuk memfilter</span>
      </div>
      {items.length > 0 && (
        <div className="rank-legend" aria-hidden="true"><span /><span /><span>ton</span>
          {withTarget ? <><span>capaian</span><span>vs {P}</span></> : <><span>porsi</span><span /></>}
        </div>
      )}
      {items.length === 0 && <div className="text-faint text-[13px] py-6 text-center">Tidak ada pengiriman pada periode ini.</div>}
      <ul className="rank-list" role="list">
        {items.map(it => {
          const on = selected === it.key, dim = selected !== 'all' && !on;
          const cap = it.capaian;
          return (
            <li key={it.key}>
              <button type="button" aria-pressed={on} onClick={() => onPick(it.key)} className={cx('rank-row', on && 'is-on', dim && 'is-dim')}
                title={`${label(it.key)}: ${fmt(it.ton, 1)} ton${withTarget && it.target ? `, target ${fmt(it.target)} ton` : ''}`}>
                <span className={cx('rank-name', (it.key === UNMAPPED.toUpperCase() || it.key === OTHER_REGION) && 'italic text-faint')}>{label(it.key)}</span>
                <span className="rank-track" aria-hidden="true"><i style={{ width: `${Math.max(2, it.ton / max * 100)}%` }} /></span>
                <span className="rank-val">{fmtTon(it.ton)}</span>
                {withTarget ? <>
                  <span className={cx('rank-share font-semibold', cap == null ? 'text-faint' : cap >= 100 ? 'text-green' : cap >= 80 ? 'text-amber' : 'text-red')}>{cap == null ? '–' : cap.toFixed(0) + '%'}</span>
                  <span className={cx('rank-delta', it.growth == null ? 'text-faint' : it.growth >= 0 ? 'text-green' : 'text-red')}>{fmtPct(it.growth, 0)}</span>
                </> : <>
                  <span className="rank-share">{it.share.toFixed(1)}%</span>
                  <span className="rank-delta" />
                </>}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
