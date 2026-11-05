import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { DataSource, rangeSummary, topCustomersRange, deliveryTypeRange, channelRange, paymentRange, productMixRange } from '../lib/data';
import { MONTHS_FULL, addDays, addMonths, endOfMonth, fmtRange, isISO, sameRangeLastYear, startOfMonth, startOfQuarter, startOfYear, toISO, type DateRange } from '../lib/dates';
import { DateRangePicker, type RangePreset } from '../components/DateRangePicker';
import {
  MONTHS_ID, COLORS, PALETTE, fmt, fmtIDR, fmtIDRCompact, fmtCompact, chartSRSummary,
} from '../lib/format';
import { useAsync, useDocTitle } from '../lib/hooks';
import { DataBadge } from '../components/DataStatus';
import { useChart, donutPercentPlugins } from '../lib/chart';
import {
  Card, Chip, CellLink, ChartBox, ErrorBox, PageSkeleton, Select, TableWrap, Th, cx,
} from '../components/ui';
import type { Row } from '../lib/types';

/* ============================================================================
   Hero: jaringan distributor (SVG statis milik sendiri) + parallax + leaderboard
============================================================================ */
const HUB = { x: 610, y: 330 };
const NET_NODES = [
  { c: 'NSA', x: 900, y: 70 }, { c: 'PKB', x: 770, y: 145 }, { c: 'CBS', x: 430, y: 110 },
  { c: 'INSA', x: 250, y: 90 }, { c: 'JMB', x: 470, y: 290 }, { c: 'BMM', x: 300, y: 560 },
  { c: 'PM', x: 400, y: 440 }, { c: 'BKP', x: 195, y: 465 }, { c: 'GMD', x: 770, y: 415 },
  { c: 'PTK', x: 905, y: 520 },
];
// Jaringan hanya tampak di sisi kanan (di belakang panel peringkat), tidak menimpa judul dan angka KPI di kiri.
const NET_MASK = 'linear-gradient(to right, transparent 38%, #000 72%)';

function HeroNetwork({ svgRef }: { svgRef: React.Ref<SVGSVGElement> }) {
  return (
    <svg ref={svgRef} className="absolute inset-0 z-0 w-full h-full opacity-90 will-change-transform"
      style={{ WebkitMaskImage: NET_MASK, maskImage: NET_MASK }}
      viewBox="0 0 1000 640" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {NET_NODES.map(n => (
        <line key={n.c} x1={HUB.x} y1={HUB.y} x2={n.x} y2={n.y} stroke="#FF5A1F" strokeWidth="1" strokeDasharray="1 6" opacity=".55" />
      ))}
      <circle cx={HUB.x} cy={HUB.y} r="9" fill="#FF5A1F" />
      <circle cx={HUB.x} cy={HUB.y} r="17" fill="none" stroke="#FF5A1F" strokeWidth="1" opacity=".5" />
      {NET_NODES.map(n => (
        <g key={n.c}>
          <circle cx={n.x} cy={n.y} r="4.5" fill="#0E0D0B" stroke="#FF5A1F" strokeWidth="1.4" />
          <text x={n.x} y={n.y - 11} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="12" letterSpacing="1" fill="#C9C3B4" opacity=".85">{n.c}</text>
        </g>
      ))}
    </svg>
  );
}

/** Parallax grid + jaringan saat scroll; dimatikan kalau prefers-reduced-motion. */
function useParallax(gridRef: React.RefObject<HTMLElement>, netRef: React.RefObject<SVGSVGElement>) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let ticking = false;
    let raf = 0;
    const apply = () => {
      const y = window.scrollY;
      if (gridRef.current) gridRef.current.style.transform = `translateY(${y * 0.18}px)`;
      if (netRef.current) netRef.current.style.transform = `translateY(${y * 0.36}px)`;
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      raf = requestAnimationFrame(apply);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    apply();
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [gridRef, netRef]);
}

interface RankItem { dist_code: string; dist_name: string; tonase: number }

function HeroLeaderboard({ ranking, monthLabel }: { ranking: RankItem[]; monthLabel: string }) {
  return (
    <aside className="relative z-[3] flex-none w-[300px] max-[880px]:w-full max-[880px]:basis-full mt-1.5 rounded px-5 py-[18px] border border-white/[.14] backdrop-blur-[8px]"
      style={{ background: 'rgba(14,13,11,.82)', boxShadow: '0 12px 28px rgba(0,0,0,.4)' }}
      aria-label={`Peringkat distributor berdasarkan tonase ${monthLabel}`}>
      <div className="font-mono text-[10.5px] uppercase text-[#8F8874] mb-3.5" style={{ letterSpacing: '.07em' }}>Top 5 Tonase · {monthLabel}</div>
      <ol className="list-none m-0 p-0 flex flex-col gap-3">
        {ranking.map((d, i) => (
          <li key={d.dist_code} className="flex items-center gap-2.5">
            <span className={cx('font-disp font-extrabold text-base w-5 shrink-0 text-center', i === 0 ? 'text-accent' : 'text-[#6B6558]')}>{i + 1}</span>
            <span className="flex-1 min-w-0 flex flex-col font-sans text-[13px] font-semibold text-white">
              {d.dist_code}
              <small className="font-mono text-[10.5px] font-medium text-[#9C9585] whitespace-nowrap overflow-hidden text-ellipsis">{d.dist_name}</small>
            </span>
            <span className="font-mono text-[13px] font-bold text-[#EDE9DF] text-right shrink-0">
              {fmt(d.tonase, 1)}
              <small className="block text-[9.5px] font-medium text-[#8F8874] text-right">ton</small>
            </span>
          </li>
        ))}
        {ranking.length === 0 && <li className="font-mono text-xs text-[#8F8874]">Belum ada data bulan ini.</li>}
      </ol>
    </aside>
  );
}

function HeroSelect({ id, label, value, onChange, children, minWidth }: { id: string; label: string; value: string | number; onChange: (v: string) => void; children: ReactNode; minWidth?: number }) {
  return (
    <div className="control">
      <label htmlFor={id} style={{ color: '#8F8874' }}>{label}</label>
      <select id={id} value={value} onChange={e => onChange(e.target.value)} style={minWidth ? { minWidth } : undefined}>{children}</select>
    </div>
  );
}

function HeroKpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase text-[#8F8874]" style={{ letterSpacing: '.08em' }}>{label}</div>
      <div className="font-disp font-extrabold text-4xl text-white mt-1">{children}</div>
    </div>
  );
}
const HeroUnit = ({ children }: { children: ReactNode }) => <small className="font-mono text-[13px] text-accent font-semibold ml-1">{children}</small>;

/* ============================================================================
   Bar horizontal generik (Bauran Pembayaran / Delivery Type)
============================================================================ */
function RankedBar({ title, labels, values, axisFmt, tooltipFmt }: {
  title: string; labels: string[]; values: number[]; axisFmt: (v: number) => string; tooltipFmt: (v: number) => string;
}) {
  const total = values.reduce((a, v) => a + v, 0);
  // min-height (bukan height tetap): box ini flex:1 di dalam card-nya; min-height hanya menjaga bar
  // tidak kegepengan kalau kategorinya banyak.
  const minH = Math.max(150, Math.min(420, labels.length * 34 + 44));
  const ref = useChart(() => ({
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: PALETTE, maxBarThickness: 22, borderRadius: 3 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { color: COLORS.line }, ticks: { callback: (v: any) => axisFmt(Number(v)) } }, y: { grid: { display: false } } },
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
    <Card title={title} className="flex flex-col flex-1">
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
  useDocTitle('Overview');
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
      .slice(0, 5);
    const heroTop = heroRanking[0] || { dist_code: '–', dist_name: 'Belum ada data', tonase: 0 };

    return { distOptions, jenisList, productsByJenis, jenisByProduct, activeYear, prevYear, monthsAllActive, heroMonth, heroRanking, heroTop };
  }, [dists, distMonthly, produk]);
  const { activeYear, prevYear, heroMonth, heroRanking, heroTop } = m;

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
    actual: monthsLabels.map((_, i) => monthAgg(activeYear, i + 1, null) || 0),
    target: (() => {
      const byMonth: Record<number, number> = {};
      targetDist.forEach(r => {
        if (dist !== 'all' && r.dist_code !== dist) return;
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

  /* ---------- Hero parallax ---------- */
  const gridRef = useRef<HTMLDivElement>(null);
  const netRef = useRef<SVGSVGElement>(null);
  useParallax(gridRef, netRef);

  /* ---------- Bar filter menempel: muncul setelah filter di hero ter-scroll keluar layar ---------- */
  const heroFilterRef = useRef<HTMLDivElement>(null);
  const [showStickyFilter, setShowStickyFilter] = useState(false);
  useEffect(() => {
    const el = heroFilterRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setShowStickyFilter(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: '-56px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);


  const growthTxt = kpi?.growth == null ? '–' : (kpi.growth >= 0 ? '+' : '') + kpi.growth.toFixed(1) + '%';
  const flexCard = 'flex flex-col flex-1';
  const chartFlex = 'h-auto flex-1 min-h-[220px]';

  return (
    <>
      {/* ---------------- HERO ---------------- */}
      <section className="relative overflow-hidden bg-ink text-white -mx-11 -mt-10 mb-[34px] px-11 pt-[76px] pb-14 border-b border-[#100f0c] max-[880px]:-mx-[18px] max-[880px]:-mt-[26px] max-[880px]:mb-[26px] max-[880px]:px-[18px] max-[880px]:pt-11 max-[880px]:pb-9">
        <div ref={gridRef} className="absolute -inset-[10%] z-0 will-change-transform" aria-hidden="true"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.09) 1px, transparent 1px)', backgroundSize: '26px 26px' }} />
        <HeroNetwork svgRef={netRef} />
        <div className="relative z-[2]">
          <div className="flex gap-12 items-start mt-[22px] flex-wrap">
            <div className="flex-[1_1_480px] min-w-0">
              <div className="mb-4"><DataBadge source="transaksi" dark /></div>
              <h1 className="text-white leading-[.96] max-w-[820px]" style={{ fontSize: 'clamp(36px,5.4vw,64px)' }}>{heroTop.dist_code}<br />teratas {MONTHS_FULL[heroMonth]}.</h1>
              <p className="text-[#C9C3B4] max-w-[560px] mt-4 text-[15px] leading-relaxed">
                {heroTop.dist_name} mencatat tonase tertinggi di {MONTHS_ID[heroMonth]} {activeYear}: {fmt(heroTop.tonase, 1)} ton.
              </p>
              <div ref={heroFilterRef} className="controls !mt-7 !mb-0">
                <HeroSelect id="bDist" label="Distributor" value={dist} onChange={onDist} minWidth={190}>
                  <option value="all">Semua Distributor</option>
                  {distOpts.map(o => <option key={o.dist_code} value={o.dist_code}>{o.dist_code} · {o.dist_name}</option>)}
                </HeroSelect>
                <HeroSelect id="bJenis" label="Jenis Semen" value={jenis} onChange={onJenis}>
                  <option value="all">Semua Jenis</option>
                  {jenisOpts.map(j => <option key={j} value={j}>{j}</option>)}
                </HeroSelect>
                <DateRangePicker label="Periode" labelClassName="!text-[#8F8874]" value={range} onChange={setRange}
                  min={minDay} max={lastDataDay} presets={presets} />
              </div>
              <div className={cx('flex gap-[38px] max-[880px]:gap-6 flex-wrap mt-10 min-h-[78px] transition-opacity duration-200', refreshing && 'opacity-50')} aria-busy={f.loading}>
                {d && kpi && (
                  <>
                    <HeroKpi label={`Tonase · ${periodLabel}`}><span className="font-mono">{fmtCompact(d.cur.total_qty)}</span><HeroUnit>ton</HeroUnit></HeroKpi>
                    <HeroKpi label={`Pertumbuhan vs ${fmtRange(prevRange)}`}><span className="font-mono">{growthTxt}</span> <HeroUnit>{kpi.growth == null ? '' : kpi.growth >= 0 ? '▲' : '▼'}</HeroUnit></HeroKpi>
                    <HeroKpi label="Delivery Order"><span className="font-mono">{fmt(d.cur.num_do)}</span></HeroKpi>
                    <HeroKpi label="Rata-rata / DO"><span className="font-mono">{kpi.avgPerDO == null ? '–' : kpi.avgPerDO.toFixed(1)}</span><HeroUnit>ton</HeroUnit></HeroKpi>
                  </>
                )}
              </div>
            </div>
            <HeroLeaderboard ranking={heroRanking} monthLabel={`${MONTHS_ID[heroMonth]} ${activeYear}`} />
          </div>
        </div>
      </section>

      {/* Tinggi 0: bar menimpa konten saat muncul, tidak menggeser tata letak. Tersembunyi (invisible) selama filter hero masih terlihat. */}
      <div className="sticky top-0 max-[880px]:top-14 z-30 h-0">
        <div role="group" aria-label="Filter Overview" aria-hidden={!showStickyFilter}
          className={cx('-mx-11 px-11 max-[880px]:-mx-[18px] max-[880px]:px-[18px] py-2.5 bg-bg border-b border-line shadow-[0_6px_10px_-8px_rgba(33,30,25,.35)] transition-[opacity,transform] duration-200',
            showStickyFilter ? 'opacity-100 translate-y-0' : 'invisible opacity-0 -translate-y-2 pointer-events-none')}>
          <div className="controls !mb-0 [&_.control]:min-w-0 max-[880px]:grid max-[880px]:grid-cols-2 max-[880px]:gap-2 max-[880px]:[&_select]:w-full max-[880px]:[&_select]:min-w-0 max-[880px]:[&_select]:text-[12px]">
            <Select label="Distributor" aria-label="Distributor" value={dist} onChange={e => onDist(e.target.value)} style={{ minWidth: 190 }}
              options={[{ value: 'all', label: 'Semua Distributor' }, ...distOpts.map(o => ({ value: String(o.dist_code), label: `${o.dist_code} · ${o.dist_name}` }))]} />
            <Select label="Jenis Semen" aria-label="Jenis Semen" value={jenis} onChange={e => onJenis(e.target.value)}
              options={[{ value: 'all', label: 'Semua Jenis' }, ...jenisOpts.map(j => ({ value: j, label: j }))]} />
            <div className="max-[880px]:col-span-2 [&_.drp-trigger]:max-[880px]:w-full">
              <DateRangePicker label="Periode" value={range} onChange={setRange} min={minDay} max={lastDataDay} presets={presets} />
            </div>
          </div>
        </div>
      </div>

      {f.error && <div className="mb-4"><ErrorBox error={f.error} /></div>}


      <div className={cx('transition-opacity duration-200', refreshing && 'opacity-60')} aria-busy={f.loading}>
      {/* ---------------- KPI sekunder ---------------- */}
      <div className="grid-kpi">
        {d && kpi ? (
          <>
            <Card title={`Toko Aktif · ${periodLabel}`}>
              <div className="kpi-value">{fmt(d.cur.num_active_stores)}</div>
              <div className="kpi-delta">Belanja minimal Rp200 rb dalam sebulan</div>
            </Card>
            <Card title="Cakupan Toko Aktif">
              <div className="kpi-value">{kpi.coverage == null ? '–' : kpi.coverage.toFixed(1) + '%'}</div>
              <div className="kpi-delta">Dari {fmt(d.totalStores)} toko terdaftar</div>
            </Card>
            <Card title={`Transaksi · ${periodLabel}`}>
              <div className="flex justify-between text-[12.5px] text-soft my-2">
                <span><b className="font-mono text-base font-semibold mr-1" style={{ color: COLORS.accent }}>{kpi.totalDO > 0 ? kpi.onlinePct.toFixed(0) : '–'}%</b> Online</span>
                <span><b className="font-mono text-base font-semibold mr-1 text-soft">{kpi.totalDO > 0 ? kpi.offlinePct.toFixed(0) : '–'}%</b> Offline</span>
              </div>
              <div className="h-2.5 rounded-[5px] bg-line overflow-hidden" role="img"
                aria-label={`Online ${fmt(kpi.onlineDO)} DO (${kpi.onlinePct.toFixed(1)}%), Offline ${fmt(kpi.offlineDO)} DO (${kpi.offlinePct.toFixed(1)}%).`}>
                <div className="h-full bg-accent rounded-l-[5px] transition-[width] duration-[400ms] ease-out" style={{ width: kpi.onlinePct + '%' }} />
              </div>
              <p className="sr-only">Online {fmt(kpi.onlineDO)} DO ({kpi.onlinePct.toFixed(1)}%), Offline {fmt(kpi.offlineDO)} DO ({kpi.offlinePct.toFixed(1)}%).</p>
            </Card>
            <Card title={`Amount · ${periodLabel}`}>
              <div className="kpi-value !text-[22px]">{fmtIDRCompact(d.cur.net_amount)}</div>
              <div className="kpi-delta">Total nilai transaksi (net amount)</div>
            </Card>
          </>
        ) : [0, 1, 2, 3].map(i => <div key={i} className="skel h-24" />)}
      </div>

      {/* ---------------- Chart: kiri 2 tren, kanan 3 breakdown (sejajar bawah) ---------------- */}
      <div className="flex gap-4 items-stretch mt-4 flex-wrap">
        <div className="flex-[1_1_420px] flex flex-col gap-4">
          <Card title={`Tren Tonase Bulanan · ${prevYear} vs ${activeYear}${distSuffix}${jenisSuffix}`} className={flexCard}>
            <div className="legend">
              <span><i style={{ background: COLORS.accent }} aria-hidden="true" />{activeYear}</span>
              <span><i style={{ background: COLORS.blueMid }} aria-hidden="true" />{prevYear}</span>
            </div>
            <ChartBox className={chartFlex} label={chartSRSummary(monthsLabels, trend.active as number[], `ton (${activeYear})`)}
              deps={[trend]}
              build={() => ({
                type: 'line',
                data: {
                  labels: monthsLabels, datasets: [
                    { label: String(activeYear), data: trend.active, borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft, fill: true, tension: .35, pointRadius: 3, pointBackgroundColor: COLORS.accent, borderWidth: 2.5 },
                    { label: String(prevYear), data: trend.prev, borderColor: COLORS.blueMid, borderDash: [5, 4], fill: false, tension: .35, pointRadius: 2.5, pointBackgroundColor: COLORS.blueMid, borderWidth: 2 },
                  ],
                },
                options: {
                  responsive: true, maintainAspectRatio: false,
                  scales: { y: { beginAtZero: true, grid: { color: COLORS.line }, ticks: { callback: (v: any) => fmtCompact(v) } }, x: { grid: { display: false } } },
                  plugins: { tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${fmt(c.parsed.y)} ton` } } },
                },
              } as ChartConfiguration)} />
            <p className="sr-only">{chartSRSummary(monthsLabels, trend.active as number[], `ton (${activeYear})`)}</p>
          </Card>

          <Card title={`Tren Tonase Target vs Aktual${distSuffix}`} className={flexCard}>
            <div className="legend">
              <span><i style={{ background: COLORS.blueMid }} aria-hidden="true" />Target</span>
              <span><i style={{ background: COLORS.accent }} aria-hidden="true" />Aktual</span>
            </div>
            <ChartBox className={chartFlex} label={chartSRSummary(monthsLabels, trend.actual, 'ton aktual')}
              deps={[trend]}
              build={() => ({
                type: 'bar',
                data: {
                  labels: monthsLabels, datasets: [
                    { label: 'Target', data: trend.target, type: 'line', borderColor: COLORS.blueMid, borderDash: [5, 4], borderWidth: 2.5, pointRadius: 2.5, fill: false, tension: .3, order: 1 },
                    { label: 'Aktual', data: trend.actual, backgroundColor: COLORS.accent, borderRadius: 3, maxBarThickness: 26, order: 2 },
                  ],
                },
                options: {
                  responsive: true, maintainAspectRatio: false,
                  scales: { y: { grid: { color: COLORS.line }, ticks: { callback: (v: any) => fmtCompact(v) } }, x: { grid: { display: false } } },
                  plugins: { tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${fmt(c.parsed.y)} ton` } } },
                },
              } as ChartConfiguration)} />
            <p className="sr-only">{chartSRSummary(monthsLabels, trend.actual, 'ton aktual')}</p>
          </Card>
        </div>

        <div className="flex-[1_1_360px] flex flex-col gap-4">
          <Card title={`Bauran Produk · ${periodLabel}`} className={flexCard}>
            <ChartBox className="h-auto flex-1 min-h-[150px]" label={chartSRSummary(prodEntries.map(e => e[0]), prodEntries.map(e => e[1]), 'ton')}
              deps={[prodEntries]}
              build={() => ({
                type: 'doughnut',
                data: { labels: prodEntries.map(e => e[0]), datasets: [{ data: prodEntries.map(e => e[1]), backgroundColor: PALETTE, borderColor: '#F8F6F0', borderWidth: 2 }] },
                options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: donutPercentPlugins('ton') as any },
              } as ChartConfiguration)} />
            <p className="sr-only">{chartSRSummary(prodEntries.map(e => e[0]), prodEntries.map(e => e[1]), 'ton')}</p>
          </Card>
          {kpi ? (
            <>
              <RankedBar title={`Pembayaran · ${periodLabel}`} labels={kpi.payLabels} values={kpi.payValues} axisFmt={fmtIDRCompact} tooltipFmt={fmtIDR} />
              <RankedBar title={`Delivery Type · ${periodLabel}`} labels={kpi.deliveryLabels} values={kpi.deliveryValues} axisFmt={fmtCompact} tooltipFmt={v => `${fmt(v)} ton`} />
            </>
          ) : (
            <>
              <div className="skel flex-1 min-h-[190px]" />
              <div className="skel flex-1 min-h-[190px]" />
            </>
          )}
        </div>
      </div>

      {/* ---------------- Top Customer ---------------- */}
      <div className="flex items-baseline justify-between flex-wrap gap-2.5 mt-[38px] mb-3.5">
        <h2 className="section-title !m-0">Top Customer <span className="n">· berdasarkan tonase · {periodLabel}{distSuffix}{jenisSuffix}</span></h2>
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
                <td><CellLink to={`/toko-detail?code=${encodeURIComponent(c.customer_code)}&from=beranda`}>{c.cust_name || c.customer_code}</CellLink></td>
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
