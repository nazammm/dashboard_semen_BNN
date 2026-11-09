/* ============================================================================
   Perhitungan bersama untuk Overview (rangkuman) dan halaman detailnya.
   Aturannya SAMA dengan halaman Sell In BNN dan Sell Out BNN, supaya angkanya cocok:
   - Target = target bulan penuh untuk setiap bulan yang tersentuh periode.
   - Tahun lalu = tanggal yang sama; bulan berjalan diperkirakan dari total bulan itu dibagi jumlah hari.
============================================================================ */
import { daysInMonth } from './dates';
import type { Row } from './types';

export const key = (s: unknown) => String(s ?? '').trim().toUpperCase();
export const UNMAPPED = 'Belum dipetakan';
export const OTHER_REGION = 'Lainnya';
export const growthPct = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev * 100 : null);
export const fmtPct = (p: number | null, d = 1) => (p == null ? '–' : (p > 0 ? '+' : '') + p.toFixed(d).replace('.', ',') + '%');
const zeros = () => new Array(13).fill(0) as number[];

/* ---------------------------------------------------------------------------
   Sell In: sub region (peta kode customer) -> region induk dari tabel target
--------------------------------------------------------------------------- */
/** delivery = hasil sellInTargetsFor (kolom target_Y & realisasi_P); rows = v_sellin_bnn_daily (atau baris lain berkolom region). */
export function sellinGeo(delivery: Row[] | null, rows: Row[], Y: number) {
  const kTgt = `target_${Y}`, kPrev = `realisasi_${Y - 1}`;
  const vol = new Map<string, Map<string, number>>();
  const name = new Map<string, string>();
  (delivery || []).forEach(r => {
    const s = key(r.sub_region); if (!s) return;
    if (!name.has(s)) name.set(s, String(r.sub_region));
    const m = vol.get(s) || new Map<string, number>(); vol.set(s, m);
    m.set(String(r.region), (m.get(String(r.region)) || 0) + Number(r[kTgt] || 0) + Number(r[kPrev] || 0) + 1);
  });
  rows.forEach(r => { const s = key(r.region || UNMAPPED); name.set(s, String(r.region || UNMAPPED)); });
  const parent = new Map<string, string>();
  vol.forEach((m, s) => parent.set(s, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]));   // sub di 2 region (mis. DUMAI) -> region terbesar
  return { parentOf: (s: string) => parent.get(s) || OTHER_REGION, nameOf: (s: string) => name.get(s) || s };
}

/** Angka per bulan (indeks 1..12): realisasi tahun ini, target, dan realisasi tahun lalu sebulan penuh. */
export interface Bulanan { cur: number[]; target: number[]; prev: number[] }
export interface Ringkas { target: number; cur: number; prev: number; hasTarget: boolean }
export type Periode = { kind: 'ytd' } | { kind: 'bulan'; m: number };

/** Ringkas periode: YTD = Jan s.d. bulan terakhir, atau satu bulan. Bulan terakhir yang belum penuh: tahun lalu dipotong di tanggal yang sama. */
export function ringkas(b: Bulanan, per: Periode, lastMonth: number, cutDay: number, P: number): Ringkas {
  const months = per.kind === 'ytd' ? Array.from({ length: lastMonth }, (_, i) => i + 1) : [per.m];
  let target = 0, cur = 0, prev = 0;
  months.forEach(m => {
    target += b.target[m]; cur += b.cur[m];
    prev += m === lastMonth && cutDay < daysInMonth(P, m) ? b.prev[m] * cutDay / daysInMonth(P, m) : b.prev[m];
  });
  return { target, cur, prev, hasTarget: target > 0 };
}

export interface SellInRingkasan {
  Y: number; P: number; last: string; lastMonth: number; cutDay: number;
  total: Bulanan; byRegion: Map<string, Bulanan>; parentOf: (sub: string) => string;
}
/** rows = v_sellin_bnn_daily, delivery = sellInTargetsFor(targets, Y). Semua tipe semen (target hanya STR & RJW, sama dengan halaman Sell In BNN). */
export function sellInRingkasan(rows: Row[], delivery: Row[] | null, last: string): SellInRingkasan {
  const Y = Number(last.slice(0, 4)), P = Y - 1;
  const geo = sellinGeo(delivery, rows, Y);
  const kTgt = `target_${Y}`, kPrev = `realisasi_${P}`;
  const total: Bulanan = { cur: zeros(), target: zeros(), prev: zeros() };
  const byRegion = new Map<string, Bulanan>();
  const reg = (r: string) => { let b = byRegion.get(r); if (!b) { b = { cur: zeros(), target: zeros(), prev: zeros() }; byRegion.set(r, b); } return b; };
  rows.forEach(r => {
    const t = String(r.tanggal).slice(0, 10);
    if (t.slice(0, 4) !== String(Y) || t > last) return;
    const m = +t.slice(5, 7), ton = Number(r.ton || 0);
    total.cur[m] += ton; reg(geo.parentOf(key(r.region || UNMAPPED))).cur[m] += ton;
  });
  (delivery || []).forEach(r => {
    const m = Number(r.month_num); if (!(m >= 1 && m <= 12)) return;
    const g = geo.parentOf(key(r.sub_region)), t = Number(r[kTgt] || 0), p = Number(r[kPrev] || 0);
    total.target[m] += t; total.prev[m] += p;
    if (t || p) { const b = reg(g); b.target[m] += t; b.prev[m] += p; }
  });
  return { Y, P, last, lastMonth: +last.slice(5, 7), cutDay: +last.slice(8, 10), total, byRegion, parentOf: geo.parentOf };
}

/* ---------------------------------------------------------------------------
   Sell Out BNN: per baris peta (distributor / subdist)
--------------------------------------------------------------------------- */
export interface Peta {
  id: number; urutan: number; region: string; nama: string; target_region: string | null; target_key: string | null;
  sumber: string; j073: boolean; dofas_kode: string[] | null; dofas_tipe: string | null; erp_kode: string | null; jenis?: 'dist' | 'subdist';
}
/** Distributor = transaksi sendiri (J028 penuh / tanpa subdist, J073); subdist = DO FAS, Sub ERP, customer subdist di J028. */
export const isSubdist = (p: Peta) => (p.jenis ? p.jenis === 'subdist' : !p.j073 && !/^J028 \S+( tanpa|$| \+)/.test(p.sumber));

export interface SellOutRingkasan {
  Y: number; P: number; lastMonth: number; cutDay: number;
  total: Bulanan; byRegion: Map<string, Bulanan>; regions: string[];
  /** Toko aktif (baris distributor saja, tanpa subdist): per bulan, target per bulan, tahun lalu tanggal sama */
  ta: { cur: number[]; target: number[]; prevSame: number[] } | null;
  /** Bulan toko aktif terakhir = bulan transaksi terakhir (toko aktif hanya dari transaksi), dan tanggal potongnya. */
  taMonth: number; taDay: number;
}
/** targets = sellOutTargetsFor(v_target_sell_out, Y); trxSampai = data s.d. transaksi (tanggal potong bulan berjalan). */
export function sellOutRingkasan(peta: Peta[], monthly: Row[], targets: Row[], ta: Row[] | null, trxSampai: string, Y: number): SellOutRingkasan {
  const P = Y - 1;
  const kTgt = `target_do_${Y}`, kPrev = `do_${P}`, kTgtTa = `target_ta_${Y}`;
  const lastMonth = monthly.reduce((a, r) => (Number(r.tahun) === Y && Number(r.ton) > 0 ? Math.max(a, Number(r.bulan)) : a), 0) || 1;
  const cutDay = trxSampai.startsWith(`${Y}-${String(lastMonth).padStart(2, '0')}`) ? Number(trxSampai.slice(8, 10)) : daysInMonth(Y, lastMonth);
  const j073Ready = monthly.some(r => Number(r.tahun) === Y && r.sumber === 'J073');
  const byId = new Map(peta.map(p => [p.id, p]));
  const total: Bulanan = { cur: zeros(), target: zeros(), prev: zeros() };
  const byRegion = new Map<string, Bulanan>();
  const regions = [...new Set(peta.map(p => p.region))];
  const reg = (r: string) => { let b = byRegion.get(r); if (!b) { b = { cur: zeros(), target: zeros(), prev: zeros() }; byRegion.set(r, b); } return b; };

  monthly.forEach(r => {
    if (Number(r.tahun) !== Y) return;
    const p = byId.get(Number(r.peta_id)); if (!p) return;
    const m = Number(r.bulan), ton = Number(r.ton || 0);
    total.cur[m] += ton; reg(p.region).cur[m] += ton;
  });
  const tgtTa = new Map<number, number[]>();
  peta.forEach(p => {
    if (!p.target_key) return;
    const live = !p.j073 || j073Ready;   // J073 belum diupload: target & tahun lalunya tidak dibandingkan
    const tt = zeros();
    targets.forEach(r => {
      if (r.region !== p.target_region || r.distributor !== p.target_key) return;
      const m = Number(r.month_num); if (!(m >= 1 && m <= 12)) return;
      tt[m] += Number(r[kTgtTa] || 0);
      if (!live) return;
      const t = Number(r[kTgt] || 0), q = Number(r[kPrev] || 0);
      total.target[m] += t; total.prev[m] += q;
      const b = reg(p.region); b.target[m] += t; b.prev[m] += q;
    });
    tgtTa.set(p.id, tt);
  });

  const trxIn = trxSampai.startsWith(`${Y}-`) && +trxSampai.slice(5, 7) <= lastMonth;
  const taMonth = trxIn ? +trxSampai.slice(5, 7) : lastMonth;
  const taDay = trxIn ? +trxSampai.slice(8, 10) : daysInMonth(Y, lastMonth);
  const taPartial = taDay < daysInMonth(Y, taMonth);
  let taOut: SellOutRingkasan['ta'] = null;
  if (ta) {
    const taIds = new Set(peta.filter(p => !isSubdist(p) && (!p.j073 || j073Ready)).map(p => p.id));
    const cur = zeros(), target = zeros(), prevSame = zeros();
    ta.forEach(r => {
      const id = Number(r.peta_id), y = Number(r.tahun), m = Number(r.bulan);
      if (!taIds.has(id) || r.tipe !== 'ALL' || !(m >= 1 && m <= 12)) return;
      if (y === Y) cur[m] += Number(r.ta || 0);
      else if (y === P) prevSame[m] += Number((taPartial && m === taMonth ? r.ta_sd : r.ta) || 0);
    });
    taIds.forEach(id => { const tt = tgtTa.get(id); if (tt) for (let m = 1; m <= 12; m++) target[m] += tt[m]; });
    taOut = { cur, target, prevSame };
  }
  return { Y, P, lastMonth, cutDay, total, byRegion, regions, ta: taOut, taMonth, taDay };
}

/* ---------------------------------------------------------------------------
   Outstanding DO (v_outstanding_do_ringkas)
--------------------------------------------------------------------------- */
export const OPEN_STATUS = ['Belum dikirim', 'Terkirim sebagian'];
/** Jalur pengiriman (sementrack.sellin_jalur): FAS = dari pelabuhan Jakarta, sisanya terminal & pabrik. */
export const JALUR_FAS = ['FAS Kapal', 'FAS Container'];
export const JALUR_DARAT = ['Terminal', 'Pabrik', 'Lainnya'];
/** Urutan daerah seperti laporan outstanding (utara ke selatan, lalu Kalbar). Daerah lain menyusul menurut tonase. */
export const REGION_ORDER = ['Sumut', 'Padang', 'Pekanbaru', 'Kepri', 'Jambi', 'Sumsel', 'Babel', 'Bengkulu', 'Lampung', 'Kalbar'];
export const UMUR_BUCKETS: { label: string; max: number }[] = [
  { label: '0–7 hari', max: 7 }, { label: '8–14 hari', max: 14 }, { label: '15–30 hari', max: 30 },
  { label: '31–60 hari', max: 60 }, { label: 'Lebih dari 60 hari', max: Infinity },
];
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

export interface OutRec {
  region: string; sub?: string; distributor: string; dist_nama: string; semen: string; status: string; jalur: string;
  tanggal_order: string; estimasi: string | null; posisi: string; orders: number; ton: number;
  umur: number; lewat: boolean;
}
export const outRecs = (rows: Row[]): OutRec[] => rows.map(r => {
  const t = String(r.tanggal_order).slice(0, 10), posisi = String(r.posisi).slice(0, 10), est = r.estimasi_kirim ? String(r.estimasi_kirim).slice(0, 10) : null;
  return {
    region: String(r.region || UNMAPPED), distributor: String(r.distributor), dist_nama: String(r.dist_nama || r.distributor), semen: String(r.semen),
    status: String(r.status), jalur: String(r.jalur || 'Lainnya'), tanggal_order: t, estimasi: est, posisi, orders: Number(r.orders || 0), ton: Number(r.ton || 0),
    umur: dayDiff(posisi, t), lewat: !!est && est < posisi,
  };
});

export interface OutSummary { ton: number; orders: number; lewat: number; tua: number; umurRata: number | null; tertua: string | null; buckets: number[] }
/** tua = umur lebih dari 30 hari. umurRata = rata-rata umur ditimbang ton. */
export function outSummary(recs: OutRec[]): OutSummary {
  let ton = 0, orders = 0, lewat = 0, tua = 0, umurTon = 0, tertua: string | null = null;
  const buckets = UMUR_BUCKETS.map(() => 0);
  recs.forEach(r => {
    ton += r.ton; orders += r.orders; umurTon += r.umur * r.ton;
    if (r.lewat) lewat += r.ton;
    if (r.umur > 30) tua += r.ton;
    buckets[UMUR_BUCKETS.findIndex(b => r.umur <= b.max)] += r.ton;
    if (!tertua || r.tanggal_order < tertua) tertua = r.tanggal_order;
  });
  return { ton, orders, lewat, tua, umurRata: ton > 0 ? umurTon / ton : null, tertua, buckets };
}
