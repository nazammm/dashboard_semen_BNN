import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, MONTHS_ID, chartSRSummary, fmt, fmtCompact } from '../lib/format';
import {
  addDays, addMonths, addYears, daysInMonth, endOfMonth, isISO, parseISO, startOfMonth, startOfQuarter, startOfYear,
  toISO, type DateRange,
} from '../lib/dates';
import type { Row } from '../lib/types';
import { DataBadge } from '../components/DataStatus';
import { DateRangePicker, type RangePreset } from '../components/DateRangePicker';
import { GrowthTable } from '../components/GrowthTable';
import { Capaian, Card, ChartBox, ErrorBox, FileIcon, FilterBar, Kpi, PageHeader, PageSkeleton, Select, cx } from '../components/ui';
import { exportRowsToExcel } from '../lib/xlsx';

/* ============================================================================
   Sell In BNN: detail harian dari upload raw sell in, dibandingkan dengan target
   dan realisasi tahun lalu dari data Sell In bulanan (v_delivery_ext).

   - Tipe semen: STR, RJW, CWC (semen putih). Mortar/thinbed tidak dihitung (disaring di database).
   - Target & realisasi tahun lalu hanya ada per bulan (STR & RJW). Karena itu:
     * KPI Target = target bulan penuh untuk bulan yang tersentuh periode; prorata hanya sebagai catatan.
     * Grafik harian/mingguan hanya menampilkan realisasi (membagi angka bulanan per hari
       menghasilkan batang yang sama rata dan menyesatkan). Pembanding tampil di tampilan bulanan.
     * Pertumbuhan dibanding tanggal yang sama tahun lalu; bulan yang tidak penuh diperkirakan
       dari total bulan itu dibagi jumlah hari.
============================================================================ */

type Semen = 'STR' | 'RJW' | 'CWC';
type Unit = 'hari' | 'minggu' | 'bulan';
interface Rec { tanggal: string; sub: string; produk: string; semen: Semen; ton: number; kirim: number }

const UNMAPPED = 'Belum dipetakan';
const OTHER_REGION = 'Lainnya';
const key = (s: unknown) => String(s ?? '').trim().toUpperCase();
const shortProduk = (p: string) => p.replace(/^NEW\s*-\s*/i, '');
const semenOf = (produk: string): Semen => (/RAJAWALI/i.test(produk) ? 'RJW' : /WHITE/i.test(produk) ? 'CWC' : 'STR');
const SEMEN_OPTS = [
  { value: 'all', label: 'Semua Tipe' },
  { value: 'STR', label: 'STR' },
  { value: 'RJW', label: 'RJW' },
  { value: 'CWC', label: 'CWC (putih)' },
];
const semenMatch = (f: string, s: Semen) => f === 'all' || s === f;
const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 ? 1 : 0);
const growthPct = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev * 100 : null);
const fmtPct = (p: number | null, d = 1) => (p == null ? '–' : (p > 0 ? '+' : '') + p.toFixed(d) + '%');
const UNIT_LABEL: Record<Unit, string> = { hari: 'Harian', minggu: 'Mingguan', bulan: 'Bulanan' };
const MONTH_EN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEMEN_ORDER: Record<string, number> = { STR: 0, RJW: 1, CWC: 2 };

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
        {pageAllowed('kelola-data') && <Link to="/kelola-data?data=sellin" className="btn btn-primary no-underline mt-4">Upload data sekarang</Link>}
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
    return { tanggal: String(r.tanggal).slice(0, 10), sub: key(r.region || UNMAPPED), produk, semen: semenOf(produk), ton: Number(r.ton || 0), kirim: Number(r.pengiriman || 0) };
  }), [rows]);

  /* ---------- filter ---------- */
  const presets = useMemo(() => presetsFor(last), [last]);
  const [range, setRange] = useState<DateRange>(() => presets[0].range);   // default: tahun berjalan
  const [region, setRegion] = useState('all');
  const [sub, setSub] = useState('all');
  const [semen, setSemen] = useState('all');
  const [produk, setProduk] = useState('all');
  const span = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1;
  const autoUnit: Unit = span <= 62 ? 'hari' : 'bulan';
  const [unitPick, setUnitPick] = useState<Unit | null>(null);   // null = ikut panjang periode
  const unit = unitPick ?? autoUnit;
  const changeRange = (r: DateRange) => { setRange(r); setUnitPick(null); };

  const opts = useMemo(() => {
    const regions = new Map<string, number>(), subs = new Map<string, number>(), produks = new Map<string, number>();
    recs.forEach(r => {
      const reg = geo.parentOf(r.sub);
      regions.set(reg, (regions.get(reg) || 0) + r.ton);
      if (region === 'all' || reg === region) subs.set(r.sub, (subs.get(r.sub) || 0) + r.ton);
      if (semenMatch(semen, r.semen)) produks.set(r.produk, (produks.get(r.produk) || 0) + r.ton);
    });
    const byTon = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return { regions: byTon(regions), subs: byTon(subs), produks: byTon(produks) };
  }, [recs, geo, region, semen]);

  const changeRegion = (v: string) => { setRegion(v); if (v !== 'all' && sub !== 'all' && geo.parentOf(sub) !== v) setSub('all'); };
  const changeSemen = (v: string) => { setSemen(v); if (produk !== 'all' && !semenMatch(v, semenOf(produk))) setProduk('all'); };
  const filterActive = region !== 'all' || sub !== 'all' || semen !== 'all' || produk !== 'all';
  const resetFilter = () => { setRegion('all'); setSub('all'); setSemen('all'); setProduk('all'); };

  // Pembanding target & tahun lalu hanya sah pada cakupan yang sama dengan data Sell In bulanan
  const why = !delivery ? 'Data target tidak tersedia.'
    : semen === 'CWC' ? 'CWC (semen putih) tidak punya target.'
      : produk !== 'all' ? 'Target hanya per tipe semen, bukan per produk.'
        : range.from.slice(0, 4) !== String(Y) || range.to.slice(0, 4) !== String(Y) ? `Target hanya untuk tahun ${Y}.` : null;
  const comparable = why == null;
  const groupBy: 'region' | 'sub' = region === 'all' ? 'region' : 'sub';
  const groupOf = (s: string) => (groupBy === 'region' ? geo.parentOf(s) : s);
  const groupName = (g: string) => (groupBy === 'region' ? g : geo.nameOf(g));

  const v = useMemo(() => {
    const inRange = (d: string) => d >= range.from && d <= range.to;
    const geoMatch = (s: string) => (region === 'all' || geo.parentOf(s) === region) && (sub === 'all' || s === sub);
    const cur = recs.filter(r => geoMatch(r.sub) && semenMatch(semen, r.semen) && (produk === 'all' || r.produk === produk) && inRange(r.tanggal));
    const ton = cur.reduce((a, r) => a + r.ton, 0), kirim = cur.reduce((a, r) => a + r.kirim, 0);

    // target & tahun lalu per bulan (indeks 1..12)
    const tArr = new Array(13).fill(0), pArr = new Array(13).fill(0);
    (delivery || []).forEach(r => {
      const m = Number(r.month_num);
      if (!(m >= 1 && m <= 12) || !geoMatch(key(r.sub_region))) return;
      const ty = String(r.type_cement).toUpperCase();
      if (!(semen === 'all' || semen === ty)) return;
      tArr[m] += Number(r[kTgt] || 0); pArr[m] += Number(r[kPrev] || 0);
    });

    // bulan yang tersentuh periode, dan apakah penuh
    const months: { m: number; from: string; to: string; full: boolean }[] = [];
    for (let d = startOfMonth(range.from); d <= range.to; d = addMonths(d, 1)) {
      const mf = d < range.from ? range.from : d, mt = endOfMonth(d) > range.to ? range.to : endOfMonth(d);
      months.push({ m: +d.slice(5, 7), from: mf, to: mt, full: mf === d && mt === endOfMonth(d) });
    }
    const partial = months.filter(x => !x.full);
    const prevRange = { from: addYears(range.from, -1), to: addYears(range.to, -1) };
    const targetFull = comparable ? months.reduce((a, x) => a + tArr[x.m], 0) : 0;
    const prev = comparable ? prorate(pArr, prevRange, P) : 0;
    const monthLabel = (m: number) => {
      const x = months.find(z => z.m === m);
      return MONTHS_ID[m] + (x && !x.full ? ` (${+x.from.slice(8)}–${+x.to.slice(8)})` : '');
    };

    // tren
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
    const showCompare = comparable && unit === 'bulan';
    const trend = {
      labels: buckets.map(b => (unit === 'bulan' ? monthLabel(+b.k.slice(5, 7)) : `${+b.k.slice(8)} ${MONTHS_ID[+b.k.slice(5, 7)]}`)),
      cur: buckets.map(b => bCur.get(b.k) || 0),
      // target & tahun lalu: angka bulan penuh, sama seperti halaman Sell In
      target: buckets.map(b => (showCompare ? tArr[+b.k.slice(5, 7)] : null)),
      prev: buckets.map(b => (showCompare ? pArr[+b.k.slice(5, 7)] : null)),
    };

    // rincian per bulan: target bulan penuh; tahun lalu pada tanggal yang sama (bulan tidak penuh diperkirakan)
    const monthRows: { month_num: number; target: number; prev: number; cur: number }[] = [];
    if (comparable) {
      const mCur = new Array(13).fill(0);
      cur.forEach(r => { mCur[+r.tanggal.slice(5, 7)] += r.ton; });
      months.forEach(x => monthRows.push({
        month_num: x.m, cur: mCur[x.m], target: tArr[x.m],
        prev: x.full ? pArr[x.m] : prorate(pArr, { from: addYears(x.from, -1), to: addYears(x.to, -1) }, P),
      }));
    }
    const drillGroups = (month: number) => {
      const s = new Map<string, number>();
      cur.forEach(r => { if (+r.tanggal.slice(5, 7) === month) { const g = groupOf(r.sub); s.set(g, (s.get(g) || 0) + r.ton); } });
      return [...s.entries()].map(([g, val]) => ({ label: groupName(g), value: val })).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
    };

    return { ton, kirim, targetFull, prev, prevRange, months, partial, monthLabel, trend, showCompare, monthRows, drillGroups };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, delivery, range.from, range.to, region, sub, semen, produk, comparable, groupBy, unit, Y, P, kTgt, kPrev]);

  /* ---------- Download Excel: format sheet Sell In bulanan (Region | Sub Region | Month | Type | Target | P | Y) ---------- */
  const { canDownload } = useAuth();
  const exportWhy = !delivery ? 'Data target tidak tersedia.'
    : produk !== 'all' ? 'Kosongkan filter Produk dulu: unduhan per tipe semen.'
      : range.from.slice(0, 4) !== String(Y) || range.to.slice(0, 4) !== String(Y) ? `Unduhan hanya untuk periode di tahun ${Y}.` : null;
  const downloadExcel = () => {
    const geoMatch = (s: string) => (region === 'all' || geo.parentOf(s) === region) && (sub === 'all' || s === sub);
    const months = new Set(v.months.map(x => x.m));
    // realisasi Sell In BNN per sub region x tipe x bulan, dalam periode & filter yang aktif
    const cur = new Map<string, number>();
    recs.forEach(r => {
      if (r.tanggal < range.from || r.tanggal > range.to || !geoMatch(r.sub) || !semenMatch(semen, r.semen)) return;
      const k = `${r.sub}|${r.semen}|${+r.tanggal.slice(5, 7)}`;
      cur.set(k, (cur.get(k) || 0) + r.ton);
    });
    const rank = new Map<string, number>();
    const out: { m: number; t: string; rk: number; row: (string | number | null)[] }[] = [];
    (delivery || []).forEach(r => {
      const m = Number(r.month_num), s = key(r.sub_region), t = String(r.type_cement).toUpperCase();
      const rk = `${r.region}|${s}`; if (!rank.has(rk)) rank.set(rk, rank.size);
      if (!months.has(m) || !geoMatch(s) || !semenMatch(semen, t as Semen)) return;
      // sub region di 2 region (mis. DUMAI): realisasi masuk ke baris region induknya saja
      const k = `${s}|${t}|${m}`, own = geo.parentOf(s) === String(r.region);
      const val = own ? cur.get(k) || 0 : 0; if (own) cur.delete(k);
      out.push({ m, t, rk: rank.get(rk)!, row: [String(r.region), String(r.sub_region), MONTH_EN[m], t, Number(r[kTgt] || 0), Number(r[kPrev] || 0), val] });
    });
    // realisasi yang tidak punya baris target (CWC, sub region baru / belum dipetakan)
    cur.forEach((val, k) => {
      const [s, t, m] = k.split('|');
      if (val) out.push({ m: +m, t, rk: rank.get(`${geo.parentOf(s)}|${s}`) ?? 1e6, row: [geo.parentOf(s), geo.nameOf(s), MONTH_EN[+m], t, null, null, val] });
    });
    out.sort((a, b) => a.m - b.m || SEMEN_ORDER[a.t] - SEMEN_ORDER[b.t] || a.rk - b.rk || String(a.row[1]).localeCompare(String(b.row[1])));
    const m0x = v.months[0].m, m1x = v.months[v.months.length - 1].m;
    const per = m0x === m1x ? `${MONTH_EN[m0x]}` : `${MONTH_EN[m0x]}-${MONTH_EN[m1x]}`;
    exportRowsToExcel([{
      name: `Sell In ${Y}`, header: ['Region', 'Sub Region', 'Month', 'Type Cement', `Target ${Y}`, String(P), String(Y)],
      rows: out.map(x => x.row), widths: [13, 15, 8, 12, 13, 11, 11],
    }], `Sell_In_BNN_${per}_${Y}_sd_${last}.xlsx`, 'sell-in-bnn');
  };

  const growth = comparable ? growthPct(v.ton, v.prev) : null;
  const m0 = v.months[0].m, m1 = v.months[v.months.length - 1].m;
  const monthsLabel = m0 === m1 ? `${MONTHS_ID[m0]} ${Y}` : `${MONTHS_ID[m0]}–${MONTHS_ID[m1]} ${Y}`;
  const scope = [sub !== 'all' ? geo.nameOf(sub) : region !== 'all' && region, semen !== 'all' && SEMEN_OPTS.find(o => o.value === semen)!.label, produk !== 'all' && shortProduk(produk)].filter(Boolean).join(' · ') || 'Semua';

  return (
    <>
      <PageHeader title="Sell In BNN" status={<DataBadge source="sellin" />} />

      <FilterBar label="Filter Sell In BNN" stickyMobile={false} className="max-[880px]:grid max-[880px]:grid-cols-2 max-[880px]:gap-2 max-[880px]:[&_select]:w-full max-[880px]:[&_select]:min-w-0 max-[880px]:[&_select]:text-[12px]">
        <div className="max-[880px]:col-span-2 [&_.drp-trigger]:max-[880px]:w-full">
          <DateRangePicker label="Periode" value={range} onChange={changeRange} min={first} max={last} presets={presets} />
        </div>
        <Select label="Region" value={region} onChange={e => changeRegion(e.target.value)} style={{ minWidth: 130 }}
          options={[{ value: 'all', label: 'Semua Region' }, ...opts.regions.map(r => ({ value: r, label: r }))]} />
        <Select label="Sub Region" value={sub} onChange={e => setSub(e.target.value)} style={{ minWidth: 140 }}
          options={[{ value: 'all', label: 'Semua Sub Region' }, ...opts.subs.map(s => ({ value: s, label: geo.nameOf(s) }))]} />
        <Select label="Tipe Semen" value={semen} onChange={e => changeSemen(e.target.value)} style={{ minWidth: 120 }} options={SEMEN_OPTS} />
        <Select label="Produk" value={produk} onChange={e => setProduk(e.target.value)} style={{ minWidth: 170 }}
          options={[{ value: 'all', label: 'Semua Produk' }, ...opts.produks.map(p => ({ value: p, label: shortProduk(p) }))]} />
        {filterActive && (
          <button type="button" className="btn btn-sm self-end max-[880px]:col-span-2 max-[880px]:justify-center" onClick={resetFilter}>Reset filter</button>
        )}
        {canDownload('sell-in-bnn') && (
          <div className="ml-auto self-end max-[880px]:col-span-2 max-[880px]:ml-0">
            <button type="button" className="btn max-[880px]:w-full max-[880px]:justify-center" onClick={downloadExcel} disabled={!!exportWhy}
              title={exportWhy || 'Unduh Excel per sub region, bulan, dan tipe semen (mengikuti filter)'}>
              <FileIcon />Download Excel
            </button>
          </div>
        )}
      </FilterBar>

      <div className="grid-kpi">
        <Kpi title={`Target ${monthsLabel}`} value={comparable ? fmtTon(v.targetFull) : '–'} unit={comparable ? 'ton' : undefined} />
        <Kpi title={`Realisasi ${Y}`} value={fmtTon(v.ton)} unit="ton"
          delta={comparable ? <Capaian actual={v.ton} target={v.targetFull} /> : undefined} />
        <Kpi title={`Pertumbuhan vs ${P}`}
          value={<span className={growth == null ? '' : growth >= 0 ? 'text-green' : 'text-red'}>{fmtPct(growth)}</span>} />
        <Kpi title={`Realisasi ${P} Tanggal Sama`} value={comparable ? fmtTon(v.prev) : '–'} unit={comparable ? 'ton' : undefined} />
      </div>

      <Card className="mt-3.5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <div className="card-title !mb-0">Sell In {UNIT_LABEL[unit]} (Ton) · {scope}</div>
          <div className="sib-unit" role="group" aria-label="Tampilan grafik">
            {(['hari', 'minggu', 'bulan'] as Unit[]).map(u => (
              <button key={u} type="button" aria-pressed={unit === u} className={cx(unit === u && 'is-on')} onClick={() => setUnitPick(u)}>{UNIT_LABEL[u]}</button>
            ))}
          </div>
        </div>
        <div className="legend">
          {v.showCompare && <span><i style={{ background: COLORS.blueMid }} aria-hidden="true" />Target {Y} (sebulan)</span>}
          <span><i style={{ background: COLORS.accent }} aria-hidden="true" />Realisasi {Y}</span>
          {v.showCompare && <span><i style={{ background: COLORS.ink, opacity: .35 }} aria-hidden="true" />Realisasi {P} (sebulan)</span>}
        </div>
        <ChartBox className="tall" label={chartSRSummary(v.trend.labels, v.trend.cur, `ton realisasi ${Y}`)}
          deps={[v.trend.labels.join('|'), v.trend.cur.join('|'), v.trend.target.join('|'), v.trend.prev.join('|')]}
          build={() => ({
            type: 'bar',
            data: { labels: v.trend.labels, datasets: [
              { label: `Target ${Y}`, data: v.trend.target, type: 'line', borderColor: COLORS.blueMid, backgroundColor: COLORS.blueMid, borderDash: [4, 3], borderWidth: 2, pointRadius: 2, fill: false, tension: .3, order: 1, hidden: !v.showCompare },
              { label: `Realisasi ${Y}`, data: v.trend.cur, backgroundColor: COLORS.accent, maxBarThickness: 26, order: 2 },
              { label: `Realisasi ${P}`, data: v.trend.prev, backgroundColor: 'rgba(33,30,25,.22)', borderRadius: 3, maxBarThickness: 26, order: 3, hidden: !v.showCompare },
            ] } as any,
            options: { responsive: true, maintainAspectRatio: false,
              scales: { y: { beginAtZero: true, grid: { color: COLORS.line }, ticks: { callback: (x: any) => fmtCompact(x) } }, x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0 } } },
              plugins: { tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${c.parsed.y == null ? '–' : fmt(c.parsed.y)} ton` } } } },
          })} />
        {comparable && unit !== 'bulan' && (
          <p className="text-faint text-[12px] mt-2">Target dan realisasi {P} hanya tersedia per bulan. <button type="button" className="link-btn" onClick={() => setUnitPick('bulan')}>Tampilkan bulanan</button> untuk membandingkan.</p>
        )}
      </Card>

      {comparable && v.monthRows.length > 0 && (
        <>
          <h2 className="section-title">Rincian per Bulan · Sell In (Ton)</h2>
          <GrowthTable caption={`Rincian sell in per bulan: target, realisasi ${P} dan ${Y}, pertumbuhan, capaian`}
            rows={v.monthRows} Y={Y} P={P} labels={{ target: 'Target', value: 'Sell In', capaian: 'Capaian' }} monthLabel={v.monthLabel}
            drill={{ enabled: true, groupsFor: v.drillGroups,
              heading: m => `Komposisi Sell In ${v.monthLabel(m)} ${Y} · per ${groupBy === 'region' ? 'Region' : 'Sub Region'}`,
              title: m => `Lihat komposisi sell in ${MONTHS_ID[m]}` }} />
        </>
      )}

    </>
  );
}
