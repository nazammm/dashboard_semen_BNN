import { useMemo, useState } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { DataSource, rangeSummary, topCustomersRange, deliveryTypeRange, channelRange, paymentRange, productMixRange } from '../lib/data';
import { addDays, addMonths, endOfMonth, fmtRange, isISO, sameRangeLastYear, startOfMonth, startOfQuarter, startOfYear, toISO, type DateRange } from '../lib/dates';
import { DateRangePicker, type RangePreset } from '../components/DateRangePicker';
import {
  MONTHS_ID, COLORS, fmt, fmtIDR, fmtIDRCompact, fmtCompact, chartSRSummary,
} from '../lib/format';
import { useAsync, useDocTitle } from '../lib/hooks';
import { DataBadge } from '../components/DataStatus';
import { useChart } from '../lib/chart';
import {
  Badge, Card, Chip, CellLink, ChartBox, ErrorBox, FilterBar, Kpi, PageHeader, PageSkeleton, Select, TableWrap, Th, cx,
} from '../components/ui';
import type { Row } from '../lib/types';

/* ============================================================================
   Distributor teratas bulan terakhir (tonase), bar sederhana
============================================================================ */
interface RankItem { dist_code: string; dist_name: string; tonase: number }

function TopDistributors({ ranking, monthLabel }: { ranking: RankItem[]; monthLabel: string }) {
  const max = ranking.reduce((a, d) => Math.max(a, d.tonase), 0) || 1;
  return (
    <Card title={`Distributor teratas · ${monthLabel}`} className="flex flex-col">
      <ol className="list-none m-0 p-0 flex flex-col gap-2.5 mt-1" aria-label={`Peringkat distributor berdasarkan tonase ${monthLabel}`}>
        {ranking.map((d, i) => (
          <li key={d.dist_code} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2.5">
            <span className="text-[12.5px] text-faint text-right">{i + 1}</span>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium truncate" title={d.dist_name}>{d.dist_code} <span className="text-faint font-normal">{d.dist_name}</span></span>
              </div>
              <div className="h-1.5 mt-1 rounded-full bg-surface3 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(d.tonase / max) * 100}%`, background: i === 0 ? COLORS.accent : COLORS.sub }} /></div>
            </div>
            <span className="text-[13px] font-medium text-right whitespace-nowrap">{fmt(d.tonase)} <span className="text-faint font-normal">ton</span></span>
          </li>
        ))}
        {ranking.length === 0 && <li className="text-[13px] text-faint">Belum ada data bulan ini.</li>}
      </ol>
    </Card>
  );
}

/* ============================================================================
   Bar horizontal generik (Bauran Pembayaran / Delivery Type)
============================================================================ */
function RankedBar({ title, labels, values, axisFmt, tooltipFmt }: {
  title: string; labels: string[]; values: number[]; axisFmt: (v: number) => string; tooltipFmt: (v: number) => string;
}) {
  const total = values.reduce((a, v) => a + v, 0);
  // min-height (bukan height tetap): box ini flex:1 di dalam card-nya; min-height hanya menjaga bar
  // tidak kegepengan kalau kategorinya banyak.
  const minH = Math.max(150, Math.min(420, labels.length * 30 + 40));
  const ref = useChart(() => ({
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: labels.map(l => (l === 'Lainnya' ? COLORS.prev : COLORS.accent)), maxBarThickness: 18 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: {
        x: { grid: { color: COLORS.line }, border: { display: false }, ticks: { callback: (v: any) => axisFmt(Number(v)) } },
        y: { grid: { display: false }, ticks: { callback: (_: any, i: number) => (labels[i].length > 20 ? labels[i].slice(0, 19) + '…' : labels[i]) } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c: any) => {
              const p = total > 0 ? (c.parsed.x / total) * 100 : 0;
              return ` ${tooltipFmt(c.parsed.x)} (${p.toFixed(1)}% dari total)`;
            },
          },
        },
      },
    },
  } as ChartConfiguration), [labels.join('|'), values.join('|')]);
  const sr = labels.map((l, i) => `${l}: ${tooltipFmt(values[i])}`).join(', ');
  return (
    <Card title={title} className="flex flex-col">
      <div className="relative flex-1" style={{ minHeight: minH }}><canvas ref={ref} role="img" aria-label={sr} /></div>
      <p className="sr-only">{sr}</p>
    </Card>
  );
}

/* ============================================================================
   Preset rentang tanggal, relatif terhadap tanggal data terakhir (bukan tanggal hari ini)
============================================================================ */
function overviewPresets(last: string): RangePreset[] {
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

/* ============================================================================
   Halaman
============================================================================ */
export default function Beranda() {
  useDocTitle('Penjualan Toko');
  const base = useAsync(async () => {
    const [dists, distMonthly, transMonthly, produk, targetDist, freshnessData] = await Promise.all([
      DataSource.distributors(), DataSource.distMonthlyTotals(), DataSource.transaksiMonthly(), DataSource.produk(), DataSource.targetDist(), DataSource.dataFreshness(),
    ]);
    return { dists, distMonthly, transMonthly, produk, targetDist, freshnessData };
  }, []);

  if (base.error) return <ErrorBox error={base.error} />;
  if (!base.data) return <PageSkeleton />;
  return <BerandaBody {...base.data} />;
}

interface BodyProps { dists: Row[]; distMonthly: Row[]; transMonthly: Row[]; produk: Row[]; targetDist: Row[]; freshnessData: Row }

function BerandaBody({ dists, distMonthly, transMonthly, produk, targetDist, freshnessData }: BodyProps) {

  /* ---------- Master / turunan data (dihitung sekali) ---------- */
  const m = useMemo(() => {
    const distOptions = dists.filter(d => d.tag === 'Distributor').sort((a, b) => String(a.dist_code).localeCompare(String(b.dist_code)));
    const jenisList = [...new Set(produk.map(p => p.jenis as string))].sort();
    const productsByJenis: Record<string, string[]> = {};
    jenisList.forEach(j => { productsByJenis[j] = produk.filter(p => p.jenis === j).map(p => p.kode as string); });
    const jenisByProduct: Record<string, string> = {};
    produk.forEach(p => { jenisByProduct[p.kode] = p.jenis; });

    // Tahun aktif & pembanding dihitung dari data (tahun terbesar di distMonthly), bukan hardcode.
    const monthlyYears = [...new Set(distMonthly.map(r => Number(r.year)))];
    const activeYear = monthlyYears.length ? Math.max(...monthlyYears) : new Date().getFullYear();
    const prevYear = activeYear - 1;

    const distNameByCode: Record<string, string> = Object.fromEntries(distOptions.map(d => [d.dist_code, d.dist_name]));
    const monthsAllActive = [...new Set(distMonthly.filter(r => Number(r.year) === activeYear).map(r => Number(r.month)))].sort((a, b) => a - b);
    const heroMonth = monthsAllActive.length ? Math.max(...monthsAllActive) : 8;
    const heroRanking: RankItem[] = distMonthly
      .filter(r => Number(r.year) === activeYear && Number(r.month) === heroMonth && distNameByCode[r.dist_code])
      .map(r => ({ dist_code: String(r.dist_code), dist_name: distNameByCode[r.dist_code], tonase: Number(r.total_qty || 0) }))
      .sort((a, b) => b.tonase - a.tonase)
      .slice(0, 8);

    return { distOptions, jenisList, productsByJenis, jenisByProduct, activeYear, prevYear, monthsAllActive, heroMonth, heroRanking };
  }, [dists, distMonthly, produk]);
  const { activeYear, prevYear, heroMonth, heroRanking } = m;

  /* ---------- Filter (saling menyempit berdasar transaksi NYATA) ---------- */
  const [dist, setDist] = useState('all');
  const [jenis, setJenis] = useState('all');
  // Periode: default bulan berjalan s.d. tanggal data terakhir (MTD). Dibandingkan dengan tanggal yang sama tahun lalu.
  const lastDataDay = useMemo(() => {
    const raw = String(freshnessData?.max_do_date ?? '').slice(0, 10);
    return isISO(raw) ? raw : endOfMonth(toISO(activeYear, heroMonth, 1));
  }, [freshnessData, activeYear, heroMonth]);
  const presets = useMemo(() => overviewPresets(lastDataDay), [lastDataDay]);
  const [range, setRange] = useState<DateRange>(() => presets[0].range);
  const prevRange = sameRangeLastYear(range);
  const minDay = `${prevYear}-01-01`;
  const [topN, setTopN] = useState(10);

  const distOptionsFor = (j: string) => {
    if (j === 'all') return m.distOptions;
    const codes = new Set(m.productsByJenis[j] || []);
    const valid = new Set(transMonthly.filter(r => codes.has(r.product_code)).map(r => r.dist_code));
    return m.distOptions.filter(d => valid.has(d.dist_code));
  };
  const jenisOptionsFor = (d: string) => {
    if (d === 'all') return m.jenisList;
    const valid = new Set(transMonthly.filter(r => r.dist_code === d).map(r => m.jenisByProduct[r.product_code]).filter(Boolean));
    return m.jenisList.filter(j => valid.has(j));
  };
  const distOpts = distOptionsFor(jenis);
  const jenisOpts = jenisOptionsFor(dist);
  const onDist = (v: string) => {
    setDist(v);
    if (jenis !== 'all' && v !== 'all' && !jenisOptionsFor(v).includes(jenis)) setJenis('all');
  };
  const onJenis = (v: string) => {
    setJenis(v);
    if (dist !== 'all' && v !== 'all' && !distOptionsFor(v).some(d => d.dist_code === dist)) setDist('all');
  };

  const productCodes = jenis === 'all' ? null : m.productsByJenis[jenis];
  const distArg = dist === 'all' ? null : dist;
  const periodLabel = fmtRange(range);
  const jenisSuffix = jenis === 'all' ? '' : ' · ' + jenis;
  const distSuffix = dist === 'all' ? '' : ' · ' + dist;

  /* ---------- Data sinkron dari transMonthly ---------- */
  const monthAgg = (year: number, mo: number, codes: string[] | null) => {
    let src = transMonthly.filter(r => Number(r.year) === year && Number(r.month) === mo);
    if (dist !== 'all') src = src.filter(r => r.dist_code === dist);
    if (codes) src = src.filter(r => codes.includes(r.product_code));
    return src.reduce((a, r) => a + Number(r.total_qty || 0), 0);
  };
  const monthsLabels = MONTHS_ID.slice(1);
  const trend = useMemo(() => ({
    active: monthsLabels.map((_, i) => monthAgg(activeYear, i + 1, productCodes) || null),
    prev: monthsLabels.map((_, i) => monthAgg(prevYear, i + 1, productCodes) || null),
    target: (() => {
      const byMonth: Record<number, number> = {};
      targetDist.forEach(r => {
        if (dist !== 'all' && r.dist_code !== dist) return;
        if (r.tahun != null && Number(r.tahun) !== activeYear) return;   // target per tahun
        byMonth[Number(r.month_num)] = (byMonth[Number(r.month_num)] || 0) + Number(r.target || 0);
      });
      return monthsLabels.map((_, i) => byMonth[i + 1] || null);
    })(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [transMonthly, targetDist, dist, jenis, activeYear, prevYear]);

  /* ---------- Data async (RPC) per filter ---------- */
  const f = useAsync(async () => {
    const [cur, prev, totalStores, delivery, channel, payment, product] = await Promise.all([
      rangeSummary(distArg, range, productCodes),
      rangeSummary(distArg, prevRange, productCodes),
      DataSource.tokoCount(),
      deliveryTypeRange(distArg, range, productCodes),
      channelRange(distArg, range, productCodes),
      paymentRange(distArg, range, productCodes),
      productMixRange(distArg, range, productCodes),
    ]);
    return { cur, prev, totalStores: totalStores as number, delivery, channel, payment, product };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dist, jenis, range.from, range.to]);
  // Top customer dimuat terpisah: ganti Top 10/25/50 tidak memuat ulang seluruh halaman.
  const top = useAsync(() => topCustomersRange(distArg, range, productCodes, topN),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dist, jenis, range.from, range.to, topN]);
  const d = f.data;
  const prodEntries = useMemo(() => (d?.product ?? []).map(r => [String(r.product_name), Number(r.total_qty)] as [string, number]), [d]);
  // Saat data filter baru dimuat, tampilan lama tetap ada tapi diredupkan (tidak berkedip jadi kosong).
  const refreshing = f.loading && !!d;

  const kpi = useMemo(() => {
    if (!d) return null;
    const { cur, prev } = d;
    const growth = Number(prev.total_qty) > 0 ? ((Number(cur.total_qty) - Number(prev.total_qty)) / Number(prev.total_qty)) * 100 : null;
    const avgPerDO = Number(cur.num_do) > 0 ? Number(cur.total_qty) / Number(cur.num_do) : null;
    const coverage = d.totalStores > 0 ? (Number(cur.num_active_stores) / d.totalStores) * 100 : null;
    const totalDO = d.channel.reduce((a, r) => a + Number(r.num_do || 0), 0);
    const onlineEntry = d.channel.find(r => /online/i.test(r.channel) && !/offline/i.test(r.channel));
    const onlineDO = onlineEntry ? Number(onlineEntry.num_do || 0) : 0;
    const offlineDO = totalDO - onlineDO;
    const onlinePct = totalDO > 0 ? (onlineDO / totalDO) * 100 : 0;
    const offlinePct = totalDO > 0 ? 100 - onlinePct : 0;

    const deliverySorted = [...d.delivery].sort((a, b) => Number(b.total_qty) - Number(a.total_qty));
    const dTop = deliverySorted.slice(0, 6);
    const dRest = deliverySorted.slice(6).reduce((a, r) => a + Number(r.total_qty), 0);
    const deliveryLabels = dTop.map(r => String(r.delivery_type));
    const deliveryValues = dTop.map(r => Number(r.total_qty));
    if (dRest > 0) { deliveryLabels.push('Lainnya'); deliveryValues.push(dRest); }

    // Hanya 4 metode pembayaran terbesar; sisanya digabung "Lainnya".
    const paySorted = [...d.payment].sort((a, b) => Number(b.net_amount) - Number(a.net_amount));
    const pTop = paySorted.slice(0, 4);
    const pRest = paySorted.slice(4).reduce((a, r) => a + Number(r.net_amount), 0);
    const payLabels = pTop.map(r => String(r.payment));
    const payValues = pTop.map(r => Number(r.net_amount));
    if (pRest > 0) { payLabels.push('Lainnya'); payValues.push(pRest); }

    return { growth, avgPerDO, coverage, totalDO, onlineDO, offlineDO, onlinePct, offlinePct, deliveryLabels, deliveryValues, payLabels, payValues };
  }, [d]);

  const growthTxt = kpi?.growth == null ? '–' : (kpi.growth >= 0 ? '+' : '') + fmt(kpi.growth, 1) + '%';

  const showTarget = jenis === 'all';   // target distributor berlaku untuk semua jenis semen
  const trendLabel = chartSRSummary(monthsLabels, trend.active.map(v => v ?? 0), `ton (${activeYear})`);

  return (
    <>
      <PageHeader title="Penjualan Toko" status={<DataBadge source="transaksi" />} />
      <FilterBar label="Filter Penjualan Toko" className="max-[880px]:grid max-[880px]:grid-cols-2 max-[880px]:gap-2 max-[880px]:[&_select]:w-full max-[880px]:[&_select]:min-w-0">
        <Select label="Distributor" value={dist} onChange={e => onDist(e.target.value)} style={{ minWidth: 200 }}
          options={[{ value: 'all', label: 'Semua Distributor' }, ...distOpts.map(o => ({ value: String(o.dist_code), label: `${o.dist_code} · ${o.dist_name}` }))]} />
        <Select label="Jenis Semen" value={jenis} onChange={e => onJenis(e.target.value)}
          options={[{ value: 'all', label: 'Semua Jenis' }, ...jenisOpts.map(j => ({ value: j, label: j }))]} />
        <div className="max-[880px]:col-span-2 [&_.drp-trigger]:max-[880px]:w-full">
          <DateRangePicker label="Periode" value={range} onChange={setRange} min={minDay} max={lastDataDay} presets={presets} />
        </div>
      </FilterBar>

      {f.error && <div className="mb-4"><ErrorBox error={f.error} /></div>}

      <div className={cx('transition-opacity duration-200', refreshing && 'opacity-60')} aria-busy={f.loading}>
      <div className="grid-kpi">
        {d && kpi ? (
          <>
            <Kpi title={`Tonase · ${periodLabel}`} value={fmt(d.cur.total_qty)} unit="ton"
              delta={<span className={kpi.growth == null ? '' : kpi.growth >= 0 ? 'text-green' : 'text-red'}>{growthTxt} <span className="text-soft">vs {fmtRange(prevRange)}</span></span>} />
            <Kpi title="Delivery order" value={fmt(d.cur.num_do)} delta={kpi.avgPerDO == null ? undefined : `Rata-rata ${fmt(kpi.avgPerDO, 1)} ton per DO`} />
            <Kpi title="Toko aktif (tanpa subdist)" value={fmt(d.cur.num_active_stores)}
              delta={`${kpi.coverage == null ? '–' : fmt(kpi.coverage, 1) + '%'} dari ${fmt(d.totalStores)} toko terdaftar`} />
            <Kpi title="Amount" value={<span className="text-[22px] max-[520px]:text-[15px]">{fmtIDR(d.cur.net_amount)}</span>}
              delta={kpi.totalDO > 0 ? `DO online ${fmt(kpi.onlinePct)}% · offline ${fmt(kpi.offlinePct)}%` : undefined} />
          </>
        ) : [0, 1, 2, 3].map(i => <div key={i} className="skel h-[104px]" />)}
      </div>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] max-[1100px]:grid-cols-1 gap-4 mt-4">
        <Card title={`Tonase per bulan · ${activeYear} vs ${prevYear}${distSuffix}${jenisSuffix}`}>
          <div className="legend">
            {showTarget && <span><i style={{ background: COLORS.target, height: 2 }} aria-hidden="true" />Target {activeYear}</span>}
            <span><i style={{ background: COLORS.accent }} aria-hidden="true" />{activeYear}</span>
            <span><i style={{ background: COLORS.prev }} aria-hidden="true" />{prevYear}</span>
          </div>
          <ChartBox className="tall" label={trendLabel} deps={[trend, showTarget]}
            build={() => ({
              type: 'bar',
              data: {
                labels: monthsLabels, datasets: [
                  { type: 'line', label: `Target ${activeYear}`, data: showTarget ? trend.target : monthsLabels.map(() => null), borderColor: COLORS.target, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false, order: 0 },
                  { label: String(activeYear), data: trend.active, backgroundColor: COLORS.accent, maxBarThickness: 22, order: 1 },
                  { label: String(prevYear), data: trend.prev, backgroundColor: COLORS.prev, maxBarThickness: 22, order: 2 },
                ],
              },
              options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, grid: { color: COLORS.line }, border: { display: false }, ticks: { callback: (v: any) => fmtCompact(v) } }, x: { grid: { display: false } } },
                plugins: { tooltip: { callbacks: { label: (c: any) => (c.parsed.y == null ? null : ` ${c.dataset.label}: ${fmt(c.parsed.y)} ton`) } } },
              },
            } as ChartConfiguration)} />
          <p className="sr-only">{trendLabel}</p>
        </Card>
        <TopDistributors ranking={heroRanking} monthLabel={`${MONTHS_ID[heroMonth]} ${activeYear}`} />
      </div>

      <div className="grid grid-cols-3 max-[1100px]:grid-cols-1 gap-4 mt-4">
        {kpi ? (
          <>
            <RankedBar title={`Produk · ${periodLabel}`} labels={prodEntries.map(e => e[0])} values={prodEntries.map(e => e[1])} axisFmt={fmtCompact} tooltipFmt={v => `${fmt(v)} ton`} />
            <RankedBar title={`Pembayaran · ${periodLabel}`} labels={kpi.payLabels} values={kpi.payValues} axisFmt={fmtIDRCompact} tooltipFmt={fmtIDR} />
            <RankedBar title={`Delivery type · ${periodLabel}`} labels={kpi.deliveryLabels} values={kpi.deliveryValues} axisFmt={fmtCompact} tooltipFmt={v => `${fmt(v)} ton`} />
          </>
        ) : [0, 1, 2].map(i => <div key={i} className="skel h-[200px]" />)}
      </div>

      {/* ---------------- Top Customer ---------------- */}
      <div className="flex items-baseline justify-between flex-wrap gap-2.5 mt-[38px] mb-3.5">
        <h2 className="section-title !m-0">Top customer <span className="n">berdasarkan tonase · {periodLabel}{distSuffix}{jenisSuffix}</span></h2>
        <div className="pill-row" role="group" aria-label="Jumlah baris yang ditampilkan">
          {[10, 25, 50].map(n => <Chip key={n} active={topN === n} onClick={() => setTopN(n)}>Top {n}</Chip>)}
        </div>
      </div>
      <TableWrap>
        <table>
          <caption className="sr-only">Daftar toko dengan tonase tertinggi sesuai filter aktif</caption>
          <thead>
            <tr>
              <Th num style={{ width: 44 }}>#</Th>
              <Th>Toko / Customer</Th>
              <Th>Distributor</Th>
              <Th num>Jumlah DO</Th>
              <Th num>Amount (IDR)</Th>
              <Th num>Tonase</Th>
            </tr>
          </thead>
          <tbody>
            {top.error && <tr><td colSpan={6} className="text-center text-red p-5">{top.error.message}</td></tr>}
            {!top.data && !top.error && <tr><td colSpan={6} className="text-center text-faint p-5">Memuat…</td></tr>}
            {top.data && top.data.length === 0 && <tr><td colSpan={6} className="text-center text-faint p-5">Tidak ada transaksi pada periode ini.</td></tr>}
            {top.data && top.data.map((c, i) => (
              <tr key={c.customer_code + '-' + i}>
                <td className="num font-mono">{i + 1}</td>
                <td><CellLink to={`/toko-detail?code=${encodeURIComponent(c.customer_code)}&from=beranda`}>{c.cust_name || c.customer_code}</CellLink>{c.is_subdist && <> <Badge variant="neutral" className="ml-1" title="Subdist: tidak dihitung toko aktif">Subdist</Badge></>}</td>
                <td>{String(c.dist_code || '').split(', ').filter(Boolean).map(code => <span key={code} className="tag-code mr-1">{code}</span>)} {c.dist_name || ''}</td>
                <td className="num font-mono">{fmt(c.num_do)}</td>
                <td className="num font-mono">{fmtIDR(c.net_amount)}</td>
                <td className="num font-mono">{fmt(c.total_qty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      </div>
    </>
  );
}
