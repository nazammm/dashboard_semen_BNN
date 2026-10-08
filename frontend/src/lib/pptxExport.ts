/* ==========================================================================
   EXPORT LAPORAN PPTX (Beranda) -- "Unduh Laporan PPT" untuk stakeholder.

   Dibuat 100% di browser pakai pptxgenjs (di-import dinamis supaya bundle utama
   tidak membengkak). Semua data diambil lewat DataSource + periodSummary yang sama
   dengan dashboard, jadi angkanya konsisten.

   CATATAN cakupan per distributor: cement_targets & delivery (Performa Daerah &
   Delivery) granularitasnya BUKAN per dist_code, jadi slide Performa Regional &
   Delivery Regional HANYA masuk laporan "Semua Distributor". Kalau satu distributor
   dipilih, laporan fokus ke angka yang bisa dipertanggungjawabkan di level itu.
========================================================================== */
import { DataSource, periodSummary } from './data';
import { MONTHS_ID, formatSyncWhen, lastClosedMonth, uniqueTokoStats } from './format';
import { logActivity } from './api';
import type { Row } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Pptx = any;
type Slide = any;

const C = {
  bg: 'DEDACF', surface: 'F8F6F0', surface2: 'F1EEE5',
  ink: '211E19', inkSoft: '645E52', inkFaint: '8A8375',
  line: 'C6BFAF', lineStrong: 'AFA790',
  accent: 'FF5A1F', accentInk: 'B33F16',
  blue: '204A63',
  green: '3F7A52', greenSoft: 'DEEAE1',
  red: 'B23B2E', amber: 'B8791A',
  white: 'FFFFFF',
};
const FONT = 'Segoe UI';
const MONO = 'Consolas';

const capaianColor = (p: number | null | undefined) => (p == null ? C.inkFaint : p >= 100 ? C.green : p >= 80 ? C.amber : C.red);

const pFmt = (n: unknown, d = 0) => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
function pFmtIDRCompact(n0: unknown) {
  const n = Number(n0 || 0), abs = Math.abs(n);
  if (abs >= 1e12) return 'Rp ' + (n / 1e12).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' T';
  if (abs >= 1e9) return 'Rp ' + (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' M';
  if (abs >= 1e6) return 'Rp ' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
  return 'Rp ' + pFmt(n);
}

/* -------------------------------------------------------------------------
   1) KUMPULKAN DATA
------------------------------------------------------------------------- */
interface DeckData {
  isAll: boolean; scopeLabel: string; wilayah: string | null; dataMonth: number; year: number; prevYear: number; periodLabel: string;
  kpi: { tonaseYTD: number; targetYTD: number; capaianYTD: number | null; growthPct: number | null; tokoAktifBulan: number; totalDO: number; netAmountYTD: number };
  trend: { labels: string[]; realisasi: number[]; realisasiPrev: number[]; target: number[] };
  timSales: { name: string; dist_code: string; tonase: number; targetTonase: number; ta: number; targetTA: number; capaian: number | null }[];
  distributorRanking: { dist_code: string; dist_name: string; wilayah: string; tonase: number; target: number; capaian: number | null }[] | null;
  regional: { cementMonth: number | null; deliveryMonth: number | null; performa: RegionRow[]; delivery: RegionRow[] } | null;
  toko: { aktif: number; nonaktif: number; top: Row[] };
  sync: Row | null; generatedAt: Date;
}
interface RegionRow { region: string; realisasi: number; target: number; capaian: number | null }

async function buildDeckData(distCode: string): Promise<DeckData> {
  const isAll = !distCode || distCode === 'all';

  const [dists, distMonthly, monthlyAll, targetDist, salesman, sync] = await Promise.all([
    DataSource.distributors(), DataSource.distMonthlyTotals(), DataSource.monthlyTotals(),
    DataSource.targetDist(), DataSource.salesman(), DataSource.statusSync(),
  ]);

  const distMeta = isAll ? null : dists.find(d => d.dist_code === distCode);
  const scopeLabel = isAll ? 'Seluruh Distributor' : (distMeta ? String(distMeta.dist_name) : distCode);
  const wilayah: string | null = isAll ? null : (distMeta ? distMeta.wilayah : null);

  // Tahun aktif = tahun terbesar di data (bukan hardcode), sama seperti halaman Beranda.
  const sourceAll: Row[] = isAll ? monthlyAll : distMonthly.filter(r => r.dist_code === distCode);
  const years = [...new Set(distMonthly.map(r => Number(r.year)))];
  const year = years.length ? Math.max(...years) : new Date().getFullYear();
  const prevYear = year - 1;

  const monthsWithData = sourceAll.filter(r => Number(r.year) === year).map(r => Number(r.month));
  const dataMonth = monthsWithData.length ? Math.max(...monthsWithData) : 1;

  const scopeArg = isAll ? null : distCode;
  const [ytd, ytdPrev, curMonth] = await Promise.all([
    periodSummary(scopeArg, year, 1, dataMonth, null),
    periodSummary(scopeArg, prevYear, 1, dataMonth, null),
    periodSummary(scopeArg, year, dataMonth, dataMonth, null),
  ]);

  const targetRows: Row[] = isAll ? targetDist : targetDist.filter(t => t.dist_code === distCode);
  const targetYTD = targetRows.filter(t => Number(t.month_num) <= dataMonth).reduce((a, t) => a + Number(t.target || 0), 0);

  const tonaseYTD = Number(ytd.total_qty || 0);
  const tonasePrevYTD = Number(ytdPrev.total_qty || 0);
  const growthPct = tonasePrevYTD > 0 ? ((tonaseYTD - tonasePrevYTD) / tonasePrevYTD) * 100 : null;
  const capaianYTD = targetYTD > 0 ? (tonaseYTD / targetYTD) * 100 : null;

  const kpi = {
    tonaseYTD, targetYTD, capaianYTD, growthPct,
    tokoAktifBulan: Number(curMonth.num_active_stores || 0),
    totalDO: Number(ytd.num_do || 0),
    netAmountYTD: Number(ytd.net_amount || 0),
  };

  const byMonth = (y: number) => Object.fromEntries(sourceAll.filter(r => Number(r.year) === y).map(r => [Number(r.month), Number(r.total_qty || 0)])) as Record<number, number>;
  const byMonthCur = byMonth(year), byMonthPrev = byMonth(prevYear);
  const targetByMonth: Record<number, number> = {};
  targetRows.forEach(t => { targetByMonth[Number(t.month_num)] = (targetByMonth[Number(t.month_num)] || 0) + Number(t.target || 0); });

  const months = Array.from({ length: dataMonth }, (_, i) => i + 1);
  const trend = {
    labels: months.map(m => MONTHS_ID[m]),
    realisasi: months.map(m => byMonthCur[m] || 0),
    realisasiPrev: months.map(m => byMonthPrev[m] || 0),
    target: months.map(m => targetByMonth[m] || 0),
  };

  const salesmanScope = (isAll ? salesman : salesman.filter(r => r.dist_code === distCode))
    .filter(r => Number(r.month) === dataMonth && Number(r.actual_num_do || 0) > 0);
  const timSales = salesmanScope
    .map(r => ({
      name: String(r.salesman_name), dist_code: String(r.dist_code),
      tonase: Number(r.actual_tonase || 0), targetTonase: Number(r.target_tonase || 0),
      ta: Number(r.actual_ta || 0), targetTA: Number(r.target_ta || 0),
      capaian: Number(r.target_tonase) > 0 ? (Number(r.actual_tonase || 0) / Number(r.target_tonase)) * 100 : null,
    }))
    .sort((a, b) => (b.capaian ?? -1) - (a.capaian ?? -1))
    .slice(0, 8);

  const tokoRows = await DataSource.tokoMonthly(year, dataMonth);
  const tokoScope = isAll ? tokoRows : tokoRows.filter(t => t.dist_code === distCode);
  const tokoUnik = uniqueTokoStats(tokoScope, () => true); // toko >1 distributor dihitung sekali
  const tokoTop = tokoScope.slice().sort((a, b) => Number(b.total_qty || 0) - Number(a.total_qty || 0)).slice(0, 8);

  let distributorRanking: DeckData['distributorRanking'] = null;
  let regional: DeckData['regional'] = null;
  if (isAll) {
    distributorRanking = dists.filter(d => d.tag === 'Distributor')
      .map(d => {
        const tgt = targetDist.filter(t => t.dist_code === d.dist_code && Number(t.month_num) <= dataMonth).reduce((a, t) => a + Number(t.target || 0), 0);
        const realisasi = distMonthly.filter(r => r.dist_code === d.dist_code && Number(r.year) === year && Number(r.month) <= dataMonth).reduce((a, r) => a + Number(r.total_qty || 0), 0);
        return { dist_code: String(d.dist_code), dist_name: String(d.dist_name), wilayah: String(d.wilayah ?? ''), tonase: realisasi, target: tgt, capaian: tgt > 0 ? (realisasi / tgt) * 100 : null };
      })
      .sort((a, b) => b.tonase - a.tonase);

    const cementTargets = await DataSource.cementTargets();
    const deliveryRows = await DataSource.delivery();
    // Kolom do_2026/realisasi_2026 dst. adalah nama kolom view di database (per tahun), jadi tahun ikut dinamis.
    const cementMonth = lastClosedMonth(cementTargets, `do_${year}`);
    const deliveryMonth = lastClosedMonth(deliveryRows, `realisasi_${year}`);
    const groupRegion = (rows: Row[], valKey: string, tgtKey: string, upToMonth: number): RegionRow[] => {
      const m: Record<string, { region: string; realisasi: number; target: number }> = {};
      rows.filter(r => Number(r.month_num) <= upToMonth).forEach(r => {
        if (!m[r.region]) m[r.region] = { region: r.region, realisasi: 0, target: 0 };
        m[r.region].realisasi += Number(r[valKey] || 0);
        m[r.region].target += Number(r[tgtKey] || 0);
      });
      return Object.values(m).map(r => ({ ...r, capaian: r.target > 0 ? (r.realisasi / r.target) * 100 : null })).sort((a, b) => b.realisasi - a.realisasi);
    };
    regional = {
      cementMonth, deliveryMonth,
      performa: cementMonth ? groupRegion(cementTargets, `do_${year}`, `target_do_${year}`, cementMonth) : [],
      delivery: deliveryMonth ? groupRegion(deliveryRows, `realisasi_${year}`, `target_${year}`, deliveryMonth) : [],
    };
  }

  return {
    isAll, scopeLabel, wilayah, dataMonth, year, prevYear,
    periodLabel: `Jan–${MONTHS_ID[dataMonth]} ${year}`,
    kpi, trend, timSales, distributorRanking, regional,
    toko: { aktif: tokoUnik.active, nonaktif: tokoUnik.total - tokoUnik.active, top: tokoTop },
    sync, generatedAt: new Date(),
  };
}

/* -------------------------------------------------------------------------
   2) BANGUN DECK
------------------------------------------------------------------------- */
function newDeck(PptxGenJS: new () => Pptx): Pptx {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'SEM169', width: 13.333, height: 7.5 });
  pptx.layout = 'SEM169';
  pptx.author = 'SEMENTRACK Dashboard';
  pptx.company = 'SEMENTRACK';
  pptx.subject = 'Laporan Performa Distribusi Semen';

  pptx.defineSlideMaster({
    title: 'SEM_COVER',
    background: { color: C.ink },
    objects: [
      { rect: { x: 10.6, y: 0, w: 2.733, h: 7.5, fill: { color: C.accent } } },
      { rect: { x: 10.35, y: 0, w: 0.06, h: 7.5, fill: { color: C.bg } } },
      { text: { text: 'SEMENTRACK', options: { x: 0.6, y: 0.5, w: 6, h: 0.5, fontFace: FONT, fontSize: 14, bold: true, color: C.bg, charSpacing: 2 } } },
    ],
  });
  pptx.defineSlideMaster({
    title: 'SEM_CONTENT',
    background: { color: C.bg },
    objects: [
      { rect: { x: 0, y: 0, w: 13.333, h: 0.09, fill: { color: C.accent } } },
      { line: { x: 0.6, y: 7.02, w: 12.133, h: 0, line: { color: C.lineStrong, width: 0.75 } } },
      { text: { text: 'SEMENTRACK · Laporan Performa Distribusi', options: { x: 0.6, y: 7.08, w: 8, h: 0.32, fontFace: FONT, fontSize: 8, color: C.inkFaint, charSpacing: 1 } } },
    ],
    slideNumber: { x: 12.4, y: 7.08, w: 0.4, h: 0.32, fontFace: FONT, fontSize: 8, color: C.inkFaint, align: 'right' },
  });
  return pptx;
}

function slideHeader(slide: Slide, { kicker, title, scopeLabel }: { kicker: string; title: string; scopeLabel: string }) {
  slide.addShape('rect', { x: 0.6, y: 0.5, w: 0.28, h: 0.045, fill: { color: C.accent }, line: { type: 'none' } });
  slide.addText(kicker.toUpperCase(), { x: 0.98, y: 0.42, w: 8, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: C.accentInk, charSpacing: 1.5 });
  slide.addText(title, { x: 0.6, y: 0.72, w: 9.5, h: 0.62, fontFace: FONT, fontSize: 28, bold: true, color: C.ink });
  slide.addShape('roundRect', { x: 9.9, y: 0.55, w: 2.83, h: 0.42, rectRadius: 0.06, fill: { color: C.surface2 }, line: { color: C.line, width: 0.75 } });
  slide.addText(scopeLabel, { x: 9.9, y: 0.55, w: 2.83, h: 0.42, align: 'center', valign: 'middle', fontFace: FONT, fontSize: 10.5, bold: true, color: C.ink });
}

interface KpiTile { x: number; y: number; w: number; h: number; label: string; value: string; unit?: string; sub?: string; capaian?: number | null }
function kpiTile(slide: Slide, { x, y, w, h, label, value, unit, sub, capaian }: KpiTile) {
  slide.addShape('rect', { x, y, w, h, fill: { color: C.surface }, line: { color: C.line, width: 0.75 } });
  if (capaian !== undefined) slide.addShape('rect', { x, y, w: 0.07, h, fill: { color: capaianColor(capaian) }, line: { type: 'none' } });
  const padX = x + 0.22;
  slide.addText(label.toUpperCase(), { x: padX, y: y + 0.16, w: w - 0.4, h: 0.3, fontFace: FONT, fontSize: 9.5, bold: true, color: C.inkFaint, charSpacing: 0.8 });
  slide.addText([
    { text: value, options: { fontFace: MONO, fontSize: 26, bold: true, color: C.ink } },
    { text: unit ? '  ' + unit : '', options: { fontFace: FONT, fontSize: 12, color: C.inkFaint } },
  ], { x: padX, y: y + 0.46, w: w - 0.4, h: 0.55, valign: 'middle' });
  if (sub) slide.addText(sub, { x: padX, y: y + h - 0.5, w: w - 0.4, h: 0.36, fontFace: FONT, fontSize: 10, color: C.inkSoft });
}

const th = (text: string, right = false) => ({ text, options: { bold: true, color: C.white, fill: { color: C.ink }, fontFace: FONT, fontSize: 10.5, ...(right ? { align: 'right' } : {}) } });
const zebra = (i: number) => ({ color: i % 2 ? C.surface : C.surface2 });

function addCoverSlide(pptx: Pptx, data: DeckData) {
  const slide = pptx.addSlide({ masterName: 'SEM_COVER' });
  slide.addText('LAPORAN PERFORMA', { x: 0.6, y: 2.55, w: 9.4, h: 0.5, fontFace: FONT, fontSize: 15, bold: true, color: C.accent, charSpacing: 2 });

  // Nama distributor panjangnya bervariasi -> ukuran font diturunkan bertahap supaya tetap 1 baris,
  // baris berikutnya digeser berdasar ruang yang benar-benar dipakai judul.
  const label = data.scopeLabel || '';
  const titleSize = label.length <= 20 ? 44 : label.length <= 26 ? 34 : label.length <= 32 ? 28 : 24;
  const titleY = 3.0;
  const lineH = (titleSize * 1.22) / 72;
  const titleBoxH = lineH + 0.22;
  slide.addText(label, { x: 0.6, y: titleY, w: 9.5, h: titleBoxH, valign: 'top', fontFace: FONT, fontSize: titleSize, bold: true, color: C.bg });
  let nextY = titleY + titleBoxH + 0.1;
  if (data.wilayah) {
    slide.addText(`Wilayah ${data.wilayah}`, { x: 0.6, y: nextY, w: 9, h: 0.4, fontFace: FONT, fontSize: 14, color: C.line });
    nextY += 0.5;
  } else nextY += 0.1;
  slide.addText(data.periodLabel, { x: 0.6, y: nextY, w: 9, h: 0.4, fontFace: MONO, fontSize: 14, color: C.accent });
  const genLabel = data.generatedAt.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  slide.addText(`Disusun otomatis dari data dashboard · ${genLabel}`, { x: 0.6, y: 6.6, w: 9.4, h: 0.4, fontFace: FONT, fontSize: 10.5, color: C.inkFaint });
}

function addKpiSlide(pptx: Pptx, data: DeckData) {
  const slide = pptx.addSlide({ masterName: 'SEM_CONTENT' });
  slideHeader(slide, { kicker: 'Ringkasan Eksekutif', title: 'Performa vs Target', scopeLabel: data.scopeLabel });
  const k = data.kpi;
  const y0 = 1.65, h = 1.85, gap = 0.22, w = (12.133 - gap * 3) / 4;
  kpiTile(slide, { x: 0.6, y: y0, w, h, label: 'Realisasi Tonase (YTD)', value: pFmt(k.tonaseYTD, 1), unit: 'ton',
    sub: k.targetYTD > 0 ? `Target ${pFmt(k.targetYTD, 1)} ton` : 'Belum ada target', capaian: k.capaianYTD });
  kpiTile(slide, { x: 0.6 + (w + gap), y: y0, w, h, label: 'Capaian vs Target', value: k.capaianYTD != null ? pFmt(k.capaianYTD, 0) + '%' : '–', unit: '',
    sub: data.periodLabel, capaian: k.capaianYTD });
  kpiTile(slide, { x: 0.6 + (w + gap) * 2, y: y0, w, h, label: `Pertumbuhan vs ${data.prevYear}`, value: k.growthPct == null ? '–' : (k.growthPct >= 0 ? '+' : '') + pFmt(k.growthPct, 1) + '%', unit: '',
    sub: 'Periode sama tahun lalu', capaian: k.growthPct == null ? null : (k.growthPct >= 0 ? 100 : 60) });
  kpiTile(slide, { x: 0.6 + (w + gap) * 3, y: y0, w, h, label: 'Toko Aktif', value: pFmt(k.tokoAktifBulan), unit: 'toko',
    sub: `Bulan ${MONTHS_ID[data.dataMonth]} ${data.year}` });

  const y1 = y0 + h + 0.3, h2 = 1.85;
  kpiTile(slide, { x: 0.6, y: y1, w, h: h2, label: 'Total Transaksi (DO)', value: pFmt(k.totalDO), unit: 'DO', sub: data.periodLabel });
  kpiTile(slide, { x: 0.6 + (w + gap), y: y1, w, h: h2, label: 'Nilai Transaksi (YTD)', value: '', unit: '', sub: '' });
  // Nilai Rupiah ditulis manual (font lebih kecil supaya muat)
  slide.addText(pFmtIDRCompact(k.netAmountYTD), { x: 0.6 + (w + gap) + 0.22, y: y1 + 0.46, w: w - 0.4, h: 0.55, fontFace: MONO, fontSize: 22, bold: true, color: C.ink });
  kpiTile(slide, { x: 0.6 + (w + gap) * 2, y: y1, w, h: h2, label: 'Toko Nonaktif', value: pFmt(data.toko.nonaktif), unit: 'toko', sub: `Bulan ${MONTHS_ID[data.dataMonth]} ${data.year}` });
  kpiTile(slide, { x: 0.6 + (w + gap) * 3, y: y1, w, h: h2, label: 'Rata-rata / Bulan', value: pFmt(k.tonaseYTD / data.dataMonth, 1), unit: 'ton', sub: 'Tonase YTD dibagi jumlah bulan' });
}

function addTrendSlide(pptx: Pptx, data: DeckData) {
  const slide = pptx.addSlide({ masterName: 'SEM_CONTENT' });
  slideHeader(slide, { kicker: 'Tren Bulanan', title: 'Realisasi vs Target Tonase', scopeLabel: data.scopeLabel });
  const t = data.trend;
  slide.addChart(pptx.ChartType.line, [
    { name: `Realisasi ${data.year}`, labels: t.labels, values: t.realisasi },
    { name: `Target ${data.year}`, labels: t.labels, values: t.target },
    { name: `Realisasi ${data.prevYear}`, labels: t.labels, values: t.realisasiPrev },
  ], {
    x: 0.6, y: 1.65, w: 12.13, h: 5.05,
    chartColors: [C.accent, C.blue, C.inkFaint],
    lineSize: 2.5, lineDataSymbol: 'circle', lineDataSymbolSize: 6,
    lineDashType: ['solid', 'dash', 'solid'],
    showLegend: true, legendPos: 'b', legendFontFace: FONT, legendFontSize: 11, legendColor: C.inkSoft,
    catAxisLabelFontFace: FONT, catAxisLabelFontSize: 11, catAxisLabelColor: C.inkSoft, catAxisLineColor: C.line,
    valAxisLabelFontFace: MONO, valAxisLabelFontSize: 10, valAxisLabelColor: C.inkFaint,
    valAxisLabelFormatCode: '#,##0', valGridLine: { color: C.line, style: 'solid', size: 0.5 },
    catGridLine: { style: 'none' }, valAxisTitle: 'Ton', showValAxisTitle: true, valAxisTitleFontFace: FONT, valAxisTitleFontSize: 10, valAxisTitleColor: C.inkFaint,
    chartArea: { fill: { color: C.bg } }, plotArea: { fill: { color: C.surface } },
  });
}

function addDistributorRankingSlide(pptx: Pptx, data: DeckData) {
  const slide = pptx.addSlide({ masterName: 'SEM_CONTENT' });
  slideHeader(slide, { kicker: 'Peringkat Distributor', title: 'Realisasi Tonase per Distributor', scopeLabel: data.periodLabel });
  const rows = data.distributorRanking || [];
  const header = [th('Distributor'), th('Wilayah'), th('Realisasi (ton)', true), th('Target (ton)', true), th('Capaian', true)];
  const body = rows.slice(0, 14).map((r, i) => ([
    { text: `${i + 1}. ${r.dist_name}`, options: { fontFace: FONT, fontSize: 10, color: C.ink, fill: zebra(i) } },
    { text: r.wilayah || '–', options: { fontFace: FONT, fontSize: 10, color: C.inkSoft, fill: zebra(i) } },
    { text: pFmt(r.tonase, 1), options: { fontFace: MONO, fontSize: 10, color: C.ink, align: 'right', fill: zebra(i) } },
    { text: pFmt(r.target, 1), options: { fontFace: MONO, fontSize: 10, color: C.inkSoft, align: 'right', fill: zebra(i) } },
    { text: r.capaian != null ? pFmt(r.capaian, 0) + '%' : '–', options: { fontFace: MONO, fontSize: 10, bold: true, color: capaianColor(r.capaian), align: 'right', fill: zebra(i) } },
  ]));
  slide.addTable([header, ...body], {
    x: 0.6, y: 1.6, w: 12.13, colW: [4.6, 2.6, 1.98, 1.98, 0.97],
    border: { type: 'solid', pt: 0.5, color: C.line }, autoPage: false, valign: 'middle', margin: [4, 8, 4, 8],
  });
}

function addRegionalSlide(pptx: Pptx, { title, kicker, rows, monthLabel, scopeLabel }: { title: string; kicker: string; rows: RegionRow[]; monthLabel: string; scopeLabel: string }) {
  const slide = pptx.addSlide({ masterName: 'SEM_CONTENT' });
  slideHeader(slide, { kicker, title, scopeLabel });
  if (!rows || !rows.length) {
    slide.addText('Belum ada data closing untuk periode ini.', { x: 0.6, y: 2.5, w: 10, h: 0.6, fontFace: FONT, fontSize: 14, color: C.inkFaint });
    return;
  }
  slide.addText(`Closing s.d. ${monthLabel}`, { x: 0.6, y: 1.5, w: 6, h: 0.32, fontFace: FONT, fontSize: 11, italic: true, color: C.inkFaint });
  const top = rows.slice(0, 10);
  slide.addChart(pptx.ChartType.bar, [
    { name: 'Realisasi', labels: top.map(r => r.region), values: top.map(r => Math.round(r.realisasi * 10) / 10) },
    { name: 'Target', labels: top.map(r => r.region), values: top.map(r => Math.round(r.target * 10) / 10) },
  ], {
    x: 0.6, y: 1.9, w: 12.13, h: 4.75, barDir: 'col', barGapWidthPct: 35,
    chartColors: [C.accent, C.blue],
    showLegend: true, legendPos: 'b', legendFontFace: FONT, legendFontSize: 11, legendColor: C.inkSoft,
    catAxisLabelFontFace: FONT, catAxisLabelFontSize: 10.5, catAxisLabelColor: C.inkSoft, catAxisLineColor: C.line,
    valAxisLabelFontFace: MONO, valAxisLabelFontSize: 10, valAxisLabelColor: C.inkFaint, valAxisLabelFormatCode: '#,##0',
    valGridLine: { color: C.line, style: 'solid', size: 0.5 }, catGridLine: { style: 'none' },
    chartArea: { fill: { color: C.bg } }, plotArea: { fill: { color: C.surface } },
  });
}

function addTimSalesSlide(pptx: Pptx, data: DeckData) {
  const slide = pptx.addSlide({ masterName: 'SEM_CONTENT' });
  slideHeader(slide, { kicker: 'Tim Sales', title: 'Top Performa Salesman', scopeLabel: `${MONTHS_ID[data.dataMonth]} ${data.year}` });
  if (!data.timSales.length) {
    slide.addText('Belum ada data salesman aktif bulan ini.', { x: 0.6, y: 2.5, w: 10, h: 0.6, fontFace: FONT, fontSize: 14, color: C.inkFaint });
    return;
  }
  const showDist = data.isAll;
  const header = [th('Salesman'), ...(showDist ? [th('Distributor')] : []), th('Tonase', true), th('Target', true), th('Capaian', true), th('Toko Aktif', true)];
  const body = data.timSales.map((r, i) => ([
    { text: `${i + 1}. ${r.name}`, options: { fontFace: FONT, fontSize: 10, color: C.ink, fill: zebra(i) } },
    ...(showDist ? [{ text: r.dist_code, options: { fontFace: MONO, fontSize: 10, color: C.inkSoft, fill: zebra(i) } }] : []),
    { text: pFmt(r.tonase, 1), options: { fontFace: MONO, fontSize: 10, color: C.ink, align: 'right', fill: zebra(i) } },
    { text: pFmt(r.targetTonase, 1), options: { fontFace: MONO, fontSize: 10, color: C.inkSoft, align: 'right', fill: zebra(i) } },
    { text: r.capaian != null ? pFmt(r.capaian, 0) + '%' : '–', options: { fontFace: MONO, fontSize: 10, bold: true, color: capaianColor(r.capaian), align: 'right', fill: zebra(i) } },
    { text: pFmt(r.ta), options: { fontFace: MONO, fontSize: 10, color: C.inkSoft, align: 'right', fill: zebra(i) } },
  ]));
  slide.addTable([header, ...body], {
    x: 0.6, y: 1.65, w: 12.13, colW: showDist ? [3.6, 1.6, 2.13, 2.1, 1.6, 1.1] : [4.5, 2.63, 2.6, 1.5, 0.9],
    border: { type: 'solid', pt: 0.5, color: C.line }, autoPage: false, valign: 'middle', margin: [4, 8, 4, 8],
  });
}

function addTokoSlide(pptx: Pptx, data: DeckData) {
  const slide = pptx.addSlide({ masterName: 'SEM_CONTENT' });
  slideHeader(slide, { kicker: 'Toko', title: 'Toko Aktif & Performa Terbaik', scopeLabel: `${MONTHS_ID[data.dataMonth]} ${data.year}` });
  const total = data.toko.aktif + data.toko.nonaktif;
  const pctAktif = total > 0 ? (data.toko.aktif / total) * 100 : null;
  kpiTile(slide, { x: 0.6, y: 1.65, w: 3.7, h: 1.6, label: 'Toko Aktif', value: pFmt(data.toko.aktif), unit: 'toko', sub: `dari ${pFmt(total)} terdaftar`, capaian: pctAktif });
  kpiTile(slide, { x: 4.5, y: 1.65, w: 3.7, h: 1.6, label: 'Toko Nonaktif', value: pFmt(data.toko.nonaktif), unit: 'toko', sub: 'Tidak ada transaksi bulan ini' });
  kpiTile(slide, { x: 8.4, y: 1.65, w: 4.33, h: 1.6, label: 'Rasio Aktif', value: pctAktif != null ? pFmt(pctAktif, 0) + '%' : '–', unit: '', sub: 'Dari total toko terdaftar', capaian: pctAktif });

  if (data.toko.top.length) {
    slide.addText('Toko dengan Tonase Tertinggi', { x: 0.6, y: 3.55, w: 8, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: C.ink });
    const header = [th('Toko'), th('Distributor'), th('Tonase', true), th('Jumlah DO', true)];
    const body = data.toko.top.map((t, i) => ([
      { text: String(t.cust_name || t.cust_code), options: { fontFace: FONT, fontSize: 10, color: C.ink, fill: zebra(i) } },
      { text: String(t.dist_code), options: { fontFace: MONO, fontSize: 10, color: C.inkSoft, fill: zebra(i) } },
      { text: pFmt(t.total_qty, 1), options: { fontFace: MONO, fontSize: 10, color: C.ink, align: 'right', fill: zebra(i) } },
      { text: pFmt(t.num_do), options: { fontFace: MONO, fontSize: 10, color: C.inkSoft, align: 'right', fill: zebra(i) } },
    ]));
    slide.addTable([header, ...body], {
      x: 0.6, y: 3.95, w: 12.13, colW: [5.6, 2.5, 2.5, 1.53],
      border: { type: 'solid', pt: 0.5, color: C.line }, autoPage: false, valign: 'middle', margin: [3, 8, 3, 8], fontSize: 10,
    });
  }
}

function addClosingSlide(pptx: Pptx, data: DeckData) {
  const slide = pptx.addSlide({ masterName: 'SEM_CONTENT' });
  slideHeader(slide, { kicker: 'Catatan', title: 'Metodologi & Kesegaran Data', scopeLabel: data.scopeLabel });
  const syncWhen = formatSyncWhen(data.sync);
  const notes = [
    `Data transaksi, tim sales, dan toko aktif mengikuti closing HARIAN — sinkronisasi terakhir ${syncWhen || 'belum tersedia'}.`,
    data.isAll ? 'Data Performa Daerah & Delivery mengikuti closing BULANAN — realisasi ditutup s.d. bulan yang tertera pada tiap slide, bukan bulan berjalan.' : null,
    `Capaian dihitung terhadap target kumulatif Januari–${MONTHS_ID[data.dataMonth]} ${data.year} (bukan target satu tahun penuh), supaya adil dibandingkan dengan realisasi yang baru berjalan sebagian tahun.`,
    `Pertumbuhan vs ${data.prevYear} membandingkan periode yang sama (Januari–${MONTHS_ID[data.dataMonth]}), bukan tahun penuh.`,
    'Laporan ini dibuat otomatis dari SEMENTRACK Dashboard dan mencerminkan data pada saat diunduh.',
  ].filter((n): n is string => !!n);
  let y = 1.8;
  notes.forEach(n => {
    slide.addShape('rect', { x: 0.6, y: y + 0.08, w: 0.14, h: 0.14, fill: { color: C.accent }, line: { type: 'none' } });
    slide.addText(n, { x: 0.95, y, w: 11.2, h: 0.6, fontFace: FONT, fontSize: 13, color: C.inkSoft, valign: 'top' });
    y += 0.85;
  });
}

/* -------------------------------------------------------------------------
   3) ORKESTRASI -- dipanggil dari tombol "Unduh Laporan PPT".
------------------------------------------------------------------------- */
export async function exportBerandaPPTX(distCode: string, onProgress?: (step: string) => void, pageId = 'beranda'): Promise<string> {
  const report = (s: string) => { onProgress?.(s); };
  report('Mengambil data...');
  const [data, mod] = await Promise.all([buildDeckData(distCode), import('pptxgenjs')]);
  const PptxGenJS = (mod as any).default ?? mod;

  report('Menyusun slide...');
  const pptx = newDeck(PptxGenJS);
  addCoverSlide(pptx, data);
  addKpiSlide(pptx, data);
  addTrendSlide(pptx, data);
  if (data.isAll && data.distributorRanking) addDistributorRankingSlide(pptx, data);
  if (data.isAll && data.regional) {
    addRegionalSlide(pptx, { title: 'Performa Regional', kicker: 'Performa Daerah', rows: data.regional.performa, monthLabel: data.regional.cementMonth ? `${MONTHS_ID[data.regional.cementMonth]} ${data.year}` : '–', scopeLabel: 'Update Bulanan' });
    addRegionalSlide(pptx, { title: 'Delivery Regional', kicker: 'Delivery', rows: data.regional.delivery, monthLabel: data.regional.deliveryMonth ? `${MONTHS_ID[data.regional.deliveryMonth]} ${data.year}` : '–', scopeLabel: 'Update Bulanan' });
  }
  addTimSalesSlide(pptx, data);
  addTokoSlide(pptx, data);
  addClosingSlide(pptx, data);

  report('Menyimpan file...');
  const distFileTag = data.isAll ? 'Semua' : distCode;
  const filename = `SEMENTRACK_Laporan_${distFileTag}_${MONTHS_ID[data.dataMonth]}${data.year}.pptx`;
  await pptx.writeFile({ fileName: filename });
  void logActivity('download', pageId, filename);
  return filename;
}
