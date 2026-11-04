import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, MONTHS_ID, chartSRSummary, dailyFreshness, fmt, fmtCompact } from '../lib/format';
import {
  addDays, addMonths, dayCount, endOfMonth, fmtDate, fmtRange, isISO, parseISO, startOfMonth, startOfQuarter, startOfYear, type DateRange,
} from '../lib/dates';
import type { Row } from '../lib/types';
import { DateRangePicker, type RangePreset } from '../components/DateRangePicker';
import { Card, ChartBox, Chip, ErrorBox, ExportButton, FilterBar, Kpi, PageHeader, PageSkeleton, Select, TableWrap, cx } from '../components/ui';

interface Rec { tanggal: string; region: string; produk: string; tipe: string; ton: number; kirim: number }

const UNMAPPED = 'Belum dipetakan';
const shortProduk = (p: string) => p.replace(/^NEW\s*-\s*/i, '');
const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 ? 1 : 0);
const pctChange = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev * 100 : null);
const fmtPct = (p: number | null, d = 1) => (p == null ? '–' : (p > 0 ? '+' : '') + p.toFixed(d) + '%');

function presetsFor(last: string): RangePreset[] {
  const prevMonth = addMonths(startOfMonth(last), -1);
  return [
    { label: 'Bulan berjalan (MTD)', range: { from: startOfMonth(last), to: last } },
    { label: 'Bulan lalu', range: { from: prevMonth, to: endOfMonth(prevMonth) } },
    { label: '7 hari terakhir', range: { from: addDays(last, -6), to: last } },
    { label: '30 hari terakhir', range: { from: addDays(last, -29), to: last } },
    { label: 'Kuartal berjalan (QTD)', range: { from: startOfQuarter(last), to: last } },
    { label: 'Tahun berjalan (YTD)', range: { from: startOfYear(last), to: last } },
  ];
}

export default function SellInBnn() {
  useDocTitle('Sell In BNN');
  const load = useAsync(async () => {
    const [rows, info] = await Promise.all([DataSource.sellinDaily(), DataSource.sellinInfo()]);
    return { rows, info };
  }, []);
  if (load.error) return <ErrorBox error={load.error} />;
  if (!load.data) return <PageSkeleton />;
  const { rows, info } = load.data;
  const last = String(info?.data_sampai ?? '').slice(0, 10);
  if (!rows.length || !isISO(last)) return <EmptyState />;
  return <Body rows={rows} info={info!} last={last} />;
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

function Body({ rows, info, last }: { rows: Row[]; info: Row; last: string }) {
  const first = String(info.data_mulai ?? last).slice(0, 10);
  const recs = useMemo<Rec[]>(() => rows.map(r => ({
    tanggal: String(r.tanggal).slice(0, 10), region: String(r.region || UNMAPPED), produk: String(r.produk || '–'),
    tipe: String(r.tipe_pesanan || '–'), ton: Number(r.ton || 0), kirim: Number(r.pengiriman || 0),
  })), [rows]);

  const presets = useMemo(() => presetsFor(last), [last]);
  const [range, setRange] = useState<DateRange>(() => presets[0].range);
  const [region, setRegion] = useState('all');
  const [produk, setProduk] = useState('all');
  const [tipe, setTipe] = useState('all');
  // Pembanding: <= 31 hari -> tanggal yang sama bulan sebelumnya (1-3 Nov vs 1-3 Okt);
  // lebih panjang -> periode sepanjang itu tepat sebelumnya (tidak tumpang tindih).
  const spanDays = dayCount(range);
  const prevRange: DateRange = spanDays <= 31
    ? { from: addMonths(range.from, -1), to: addMonths(range.to, -1) }
    : { from: addDays(range.from, -spanDays), to: addDays(range.from, -1) };
  const prevComparable = prevRange.from >= first;
  const filterActive = region !== 'all' || produk !== 'all' || tipe !== 'all';
  const tableRef = useRef<HTMLTableElement>(null);

  // opsi filter (dari seluruh data)
  const opts = useMemo(() => {
    const sum = (key: 'region' | 'produk' | 'tipe') => {
      const m = new Map<string, number>();
      recs.forEach(r => m.set(r[key], (m.get(r[key]) || 0) + r.ton));
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    };
    return { regions: sum('region'), produks: sum('produk'), tipes: ['Gudang', 'Toko', 'Project'].filter(t => recs.some(r => r.tipe === t)) };
  }, [recs]);

  const inRange = (r: Rec, rg: DateRange) => r.tanggal >= rg.from && r.tanggal <= rg.to;
  const match = (r: Rec, skip?: 'region' | 'produk') =>
    (skip === 'region' || region === 'all' || r.region === region) &&
    (skip === 'produk' || produk === 'all' || r.produk === produk) &&
    (tipe === 'all' || r.tipe === tipe);

  const v = useMemo(() => {
    const cur = recs.filter(r => match(r) && inRange(r, range));
    const prev = recs.filter(r => match(r) && inRange(r, prevRange));
    const ton = cur.reduce((a, r) => a + r.ton, 0), kirim = cur.reduce((a, r) => a + r.kirim, 0);
    const tonPrev = prev.reduce((a, r) => a + r.ton, 0);
    const kirimPrev = prev.reduce((a, r) => a + r.kirim, 0);
    const activeDays = new Set(cur.map(r => r.tanggal)).size;

    // daftar region & produk: tidak difilter oleh dirinya sendiri, supaya pilihan lain tetap terlihat untuk dibandingkan
    const group = (key: 'region' | 'produk') => {
      const c = new Map<string, number>(), p = new Map<string, number>();
      recs.forEach(r => {
        if (!match(r, key)) return;
        if (inRange(r, range)) c.set(r[key], (c.get(r[key]) || 0) + r.ton);
        if (inRange(r, prevRange)) p.set(r[key], (p.get(r[key]) || 0) + r.ton);
      });
      const total = [...c.values()].reduce((a, x) => a + x, 0);
      return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k, t]) => ({ key: k, ton: t, share: total ? t / total * 100 : 0, delta: prevComparable ? pctChange(t, p.get(k) || 0) : null }));
    };

    // matriks region x produk
    const prodTotals = new Map<string, number>();
    const matrix = new Map<string, Map<string, number>>();
    const regPrev = new Map<string, number>();
    cur.forEach(r => {
      prodTotals.set(r.produk, (prodTotals.get(r.produk) || 0) + r.ton);
      const m = matrix.get(r.region) || new Map<string, number>(); matrix.set(r.region, m);
      m.set(r.produk, (m.get(r.produk) || 0) + r.ton);
    });
    prev.forEach(r => regPrev.set(r.region, (regPrev.get(r.region) || 0) + r.ton));
    const prodCols = [...prodTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const matrixRows = [...matrix.entries()].map(([reg, m]) => {
      const total = [...m.values()].reduce((a, x) => a + x, 0);
      return { region: reg, cells: prodCols.map(p => m.get(p) || 0), total, share: ton ? total / ton * 100 : 0, delta: prevComparable ? pctChange(total, regPrev.get(reg) || 0) : null };
    }).sort((a, b) => b.total - a.total);

    // tren: harian / mingguan / bulanan tergantung panjang periode
    const days = dayCount(range);
    const unit: 'hari' | 'minggu' | 'bulan' = days <= 62 ? 'hari' : days <= 200 ? 'minggu' : 'bulan';
    const bucketOf = (iso: string) => {
      if (unit === 'hari') return iso;
      if (unit === 'bulan') return iso.slice(0, 7);
      const { y, m, d } = parseISO(iso);
      const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;   // Senin = awal minggu
      const start = addDays(iso, -wd);
      return start < range.from ? range.from : start;
    };
    const buckets: string[] = [];
    for (let d = range.from; d <= range.to && d <= last; d = addDays(d, 1)) { const b = bucketOf(d); if (buckets[buckets.length - 1] !== b) buckets.push(b); }
    const bt = new Map<string, number>(buckets.map(b => [b, 0]));
    cur.forEach(r => { const b = bucketOf(r.tanggal); bt.set(b, (bt.get(b) || 0) + r.ton); });
    const trendLabels = buckets.map(b => unit === 'bulan' ? `${MONTHS_ID[+b.slice(5, 7)]} ${b.slice(2, 4)}` : `${+b.slice(8)} ${MONTHS_ID[+b.slice(5, 7)]}`);
    const trendValues = buckets.map(b => bt.get(b) || 0);
    const elapsedDays = dayCount({ from: range.from, to: range.to < last ? range.to : last });

    return { ton, kirim, tonPrev, kirimPrev, activeDays, regions: group('region'), produks: group('produk'), prodCols, matrixRows, prodTotals,
      unit, trendLabels, trendValues, elapsedDays };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recs, range.from, range.to, region, produk, tipe, last, prevComparable, prevRange.from, prevRange.to]);

  const growth = prevComparable ? pctChange(v.ton, v.tonPrev) : null;
  const perDay = v.elapsedDays > 0 ? v.ton / v.elapsedDays : 0;
  const top = region === 'all' ? v.regions[0] : v.produks[0];
  const rangeLabel = fmtRange(range);
  const prevLabel = fmtRange(prevRange);
  const avgBucket = v.trendValues.length ? v.trendValues.reduce((a, x) => a + x, 0) / v.trendValues.length : 0;
  const freshness = dailyFreshness({ max_do_date: last });
  const scope = [region !== 'all' && region, produk !== 'all' && shortProduk(produk), tipe !== 'all' && tipe].filter(Boolean).join(' · ');

  return (
    <>
      <PageHeader title="Sell In BNN" status={freshness.status} statusVariant={freshness.statusVariant}
        desc="Pengiriman ke gudang distributor, ditambah toko dan project PT Permata Multi Niaga dari ITP-Palembang Terminal." />

      <FilterBar label="Filter Sell In BNN" stickyMobile={false} className="max-[880px]:grid max-[880px]:grid-cols-2 max-[880px]:gap-2 max-[880px]:[&_select]:w-full max-[880px]:[&_select]:min-w-0 max-[880px]:[&_select]:text-[12px]">
        <div className="max-[880px]:col-span-2 [&_.drp-trigger]:max-[880px]:w-full">
          <DateRangePicker label="Periode" value={range} onChange={setRange} min={first} max={last} presets={presets} />
        </div>
        <Select label="Region" value={region} onChange={e => setRegion(e.target.value)}
          options={[{ value: 'all', label: 'Semua Region' }, ...opts.regions.map(r => ({ value: r, label: r }))]} />
        <Select label="Produk" value={produk} onChange={e => setProduk(e.target.value)}
          options={[{ value: 'all', label: 'Semua Produk' }, ...opts.produks.map(p => ({ value: p, label: shortProduk(p) }))]} />
        <div className="control max-[880px]:col-span-2">
          <span id="sibTipe" className="control-group-label">Tipe Pesanan</span>
          <div className="pill-row h-9 items-center" role="group" aria-labelledby="sibTipe">
            <Chip active={tipe === 'all'} onClick={() => setTipe('all')}>Semua</Chip>
            {opts.tipes.map(t => <Chip key={t} active={tipe === t} onClick={() => setTipe(t)}>{t}</Chip>)}
          </div>
        </div>
        {filterActive && (
          <button type="button" className="btn btn-sm self-end max-[880px]:col-span-2 max-[880px]:justify-center" onClick={() => { setRegion('all'); setProduk('all'); setTipe('all'); }}>
            Reset filter
          </button>
        )}
      </FilterBar>

      <div className="grid-kpi">
        <Kpi title={`Sell In · ${rangeLabel}`} value={fmtTon(v.ton)} unit="ton"
          delta={growth == null
            ? <span className="text-faint">{prevComparable ? `Tidak ada data ${prevLabel}` : 'Belum ada data pembanding'}</span>
            : <span className={growth >= 0 ? 'text-green' : 'text-red'}>{growth >= 0 ? '▲' : '▼'} {fmtPct(growth)} <span className="text-faint">vs {prevLabel}</span></span>} />
        <Kpi title="Rata-rata per Hari" value={fmtTon(perDay)} unit="ton"
          delta={<span className="text-faint">{fmt(v.elapsedDays)} hari, {fmt(v.activeDays)} hari ada pengiriman</span>} />
        <Kpi title="Pengiriman" value={fmt(v.kirim)}
          delta={<span className="text-faint">{v.kirim ? `${fmt(v.ton / v.kirim, 1)} ton per pengiriman` : 'Tidak ada pengiriman'}</span>} />
        <Kpi title={region === 'all' ? 'Region Terbesar' : `Produk Terbesar · ${region}`}
          value={<span className="truncate block max-w-full" title={top?.key}>{top ? (region === 'all' ? top.key : shortProduk(top.key)) : '–'}</span>}
          delta={<span className="text-faint">{top ? `${fmtTon(top.ton)} ton · ${top.share.toFixed(0)}% dari total` : 'Tidak ada data'}</span>} />
      </div>

      <Card title={`Sell In per ${v.unit === 'hari' ? 'Hari' : v.unit === 'minggu' ? 'Minggu' : 'Bulan'} (Ton)${scope ? ' · ' + scope : ''}`} className="mt-4">
        <div className="legend">
          <span><i style={{ background: COLORS.accent }} aria-hidden="true" />Sell In</span>
          <span><i style={{ background: COLORS.blueMid }} aria-hidden="true" />Rata-rata per {v.unit}: {fmtTon(avgBucket)} ton</span>
        </div>
        <ChartBox className="tall" label={chartSRSummary(v.trendLabels, v.trendValues, 'ton')} deps={[v.trendLabels.join('|'), v.trendValues.join('|')]} build={() => ({
          type: 'bar',
          data: { labels: v.trendLabels, datasets: [
            { label: 'Rata-rata', data: v.trendLabels.map(() => avgBucket), type: 'line', borderColor: COLORS.blueMid, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false, order: 1 },
            { label: 'Sell In', data: v.trendValues, backgroundColor: COLORS.accent, maxBarThickness: 28, order: 2 },
          ] } as any,
          options: { responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, grid: { color: COLORS.line }, ticks: { callback: (x: any) => fmtCompact(x) } }, x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0 } } },
            plugins: { tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${fmt(c.parsed.y, 1)} ton` } } } },
        })} />
        <p className="sr-only">{chartSRSummary(v.trendLabels, v.trendValues, 'ton')}</p>
      </Card>

      <div className="grid grid-cols-2 gap-4 mt-4 max-[1000px]:grid-cols-1">
        <RankCard title="Per Region" hint="Klik untuk memfilter" items={v.regions} selected={region} label={k => k}
          onPick={k => setRegion(region === k ? 'all' : k)} prevLabel={prevComparable ? prevLabel : null} />
        <RankCard title="Per Produk" hint="Klik untuk memfilter" items={v.produks} selected={produk} label={shortProduk}
          onPick={k => setProduk(produk === k ? 'all' : k)} prevLabel={prevComparable ? prevLabel : null} />
      </div>

      <div className="flex items-baseline justify-between gap-3 flex-wrap mt-[38px] mb-3.5">
        <h2 className="section-title !m-0">Rekap Region × Produk <span className="n">ton · {rangeLabel}{tipe !== 'all' ? ' · ' + tipe : ''}</span></h2>
        <ExportButton pageId="sell-in-bnn" filename={() => `Sell_In_BNN_${range.from}_${range.to}.xlsx`} getTables={() => [{ name: 'Rekap Region x Produk', el: tableRef.current }]} />
      </div>
      <TableWrap>
        <table ref={tableRef} className="tbl-num">
          <caption className="sr-only">Tonase sell in per region dan produk, {rangeLabel}</caption>
          <thead><tr>
            <th>Region</th>
            {v.prodCols.map(p => <th key={p} className="num" title={p}>{shortProduk(p)}</th>)}
            <th className="num bg-accent-soft">Total</th>
            <th className="num">Porsi</th>
            <th className="num" title={`Dibanding ${prevLabel}`}>vs periode lalu</th>
          </tr></thead>
          <tbody>
            {v.matrixRows.length === 0 && <tr><td colSpan={v.prodCols.length + 4} className="!text-center !text-faint !p-6 !font-sans">Tidak ada pengiriman pada periode dan filter ini.</td></tr>}
            {v.matrixRows.map(r => (
              <tr key={r.region}>
                <td className={cx('!font-sans !text-[13px] font-semibold', r.region === UNMAPPED && 'text-faint italic')}>{r.region}</td>
                {r.cells.map((c, i) => <td key={v.prodCols[i]} className="num">{c ? fmtTon(c) : <span className="text-faint">–</span>}</td>)}
                <td className="num bg-surface2 font-bold">{fmtTon(r.total)}</td>
                <td className="num text-soft">{r.share.toFixed(1)}%</td>
                <td className={cx('num', r.delta == null ? 'text-faint' : r.delta >= 0 ? 'text-green' : 'text-red')}>{fmtPct(r.delta)}</td>
              </tr>
            ))}
          </tbody>
          {v.matrixRows.length > 0 && (
            <tfoot><tr>
              <td className="!font-sans !text-[13px] font-bold">Total</td>
              {v.prodCols.map(p => <td key={p} className="num font-bold">{fmtTon(v.prodTotals.get(p) || 0)}</td>)}
              <td className="num bg-accent-soft font-extrabold">{fmtTon(v.ton)}</td>
              <td className="num text-soft">100%</td>
              <td className={cx('num font-bold', growth == null ? 'text-faint' : growth >= 0 ? 'text-green' : 'text-red')}>{fmtPct(growth)}</td>
            </tr></tfoot>
          )}
        </table>
      </TableWrap>
      <p className="text-faint text-[12px] mt-2.5">
        Tonase = Delivery Quantity × berat per zak. Pembanding: {prevComparable ? prevLabel : 'belum ada data (periode sebelum data pertama)'}.
        {' '}Data {fmtDate(first)} s.d. {fmtDate(last)}{info.upload_terakhir ? `, upload terakhir ${new Date(info.upload_terakhir).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} oleh ${info.upload_oleh}` : ''}.
      </p>
    </>
  );
}

/* Daftar peringkat dengan batang (HTML, bukan chart): label jelas, bisa diklik untuk memfilter. */
function RankCard({ title, hint, items, selected, label, onPick, prevLabel }: {
  title: string; hint: string; items: { key: string; ton: number; share: number; delta: number | null }[];
  selected: string; label: (k: string) => string; onPick: (k: string) => void; prevLabel: string | null;
}) {
  const max = items[0]?.ton || 1;
  return (
    <Card className="!pb-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="card-title !mb-0">{title}</div>
        <span className="text-[11px] text-faint">{hint}</span>
      </div>
      {items.length > 0 && <div className="rank-legend" aria-hidden="true"><span /><span /><span>ton</span><span>porsi</span><span>vs lalu</span></div>}
      {items.length === 0 && <div className="text-faint text-[13px] py-6 text-center">Tidak ada pengiriman pada periode ini.</div>}
      <ul className="rank-list" role="list">
        {items.map(it => {
          const on = selected === it.key, dim = selected !== 'all' && !on;
          return (
            <li key={it.key}>
              <button type="button" aria-pressed={on} onClick={() => onPick(it.key)} className={cx('rank-row', on && 'is-on', dim && 'is-dim')}
                title={`${it.key}: ${fmt(it.ton, 1)} ton${prevLabel && it.delta != null ? `, ${fmtPct(it.delta)} vs ${prevLabel}` : ''}`}>
                <span className={cx('rank-name', it.key === UNMAPPED && 'italic text-faint')}>{label(it.key)}</span>
                <span className="rank-track" aria-hidden="true"><i style={{ width: `${Math.max(2, it.ton / max * 100)}%` }} /></span>
                <span className="rank-val">{fmtTon(it.ton)}</span>
                <span className="rank-share">{it.share.toFixed(1)}%</span>
                <span className={cx('rank-delta', it.delta == null ? 'text-faint' : it.delta >= 0 ? 'text-green' : 'text-red')}>{fmtPct(it.delta, 0)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
