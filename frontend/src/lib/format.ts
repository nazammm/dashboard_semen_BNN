import type { Row } from './types';

export const MONTHS_ID = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const ROLE_LABEL: Record<string, string> = { admin: 'Admin', mo: 'Management', sales: 'Sales', spv: 'SPV' };

export const fmt = (n: unknown, d = 0) =>
  Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtIDR = (n: unknown) =>
  'Rp' + Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
/** Rupiah ringkas: Rp1,2 jt / Rp3,4 M / Rp1,1 T. */
export function fmtIDRCompact(v: unknown) {
  const n = Number(v || 0), abs = Math.abs(n);
  if (abs >= 1e12) return 'Rp' + (n / 1e12).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' T';
  if (abs >= 1e9) return 'Rp' + (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' M';
  if (abs >= 1e6) return 'Rp' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
  return fmtIDR(n);
}
export function fmtCompact(v: unknown) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' rb';
  return fmt(n);
}
/** Persentase capaian; null kalau target <= 0. */
export function pct(actual: unknown, target: unknown): number | null {
  const a = Number(actual || 0), t = Number(target || 0);
  return t <= 0 ? null : (a / t) * 100;
}
export type CapaianTone = 'good' | 'warn' | 'bad' | 'neutral';
export const capaianClass = (p: number | null): CapaianTone => (p == null ? 'neutral' : p >= 100 ? 'good' : p >= 80 ? 'warn' : 'bad');

export function relDate(dstr?: string | null) {
  if (!dstr) return 'Belum ada';
  const days = Math.floor((Date.now() - new Date(dstr).getTime()) / 86400000);
  if (days <= 0) return 'Hari ini';
  if (days === 1) return 'Kemarin';
  if (days < 30) return days + ' hari lalu';
  if (days < 365) return Math.floor(days / 30) + ' bulan lalu';
  return Math.floor(days / 365) + ' tahun lalu';
}

/** MSS no order '0' atau kosong = offline. */
export function isOnlineTransaction(mssNoOrder: unknown) {
  const v = String(mssNoOrder ?? '').trim();
  return v !== '' && v !== '0';
}

export function groupSum<T>(arr: T[], keyFn: (r: T) => string | number, valFn: (r: T) => number) {
  const m = new Map<string | number, number>();
  for (const row of arr) { const k = keyFn(row); m.set(k, (m.get(k) || 0) + (valFn(row) || 0)); }
  return m;
}

/** Format status_sync -> "24 Sep 2026, 10:00". */
export type StatusVariant = 'good' | 'warn' | 'bad' | 'neutral';

export function chartSRSummary(labels: string[], values: number[], unit?: string) {
  if (!labels?.length) return '';
  return `Ringkasan data grafik: ${labels.map((l, i) => `${l}: ${fmt(values[i])}${unit ? ' ' + unit : ''}`).join('; ')}.`;
}

/** Cegah formula injection di Excel (sel diawali = + - @ tab CR). */
export const xlsxSafeCell = (text: string) => (/^[=+\-@\t\r]/.test(text) ? "'" + text : text);

/** Toko UNIK dari baris per (toko, distributor).
 *  Subdist (is_subdist di SEMUA distributornya) bukan toko: tidak masuk total / aktif / nonaktif, dihitung terpisah. */
export function uniqueTokoStats(rows: Row[], hasGeoFn: (r: Row) => boolean) {
  const m = new Map<string, { active: boolean; geo: boolean; toko: boolean; row: Row }>();
  rows.forEach(t => {
    const g = m.get(t.cust_code) || { active: false, geo: false, toko: false, row: t };
    if (t.is_active) g.active = true;
    if (!t.is_subdist) g.toko = true;
    if (hasGeoFn(t)) g.geo = true;
    m.set(t.cust_code, g);
  });
  let active = 0, total = 0;
  const noGeoRows: Row[] = [];
  m.forEach(g => { if (g.toko) total++; if (g.active) active++; if (!g.geo) noGeoRows.push(g.row); });
  return { total, active, subdist: m.size - total, noGeo: noGeoRows.length, noGeoRows };
}

// Hari libur nasional (SKB 3 Menteri), hanya libur nasional, tanpa cuti bersama.
// Tahun baru: tambahkan satu baris setelah SKB terbit (biasanya September tahun sebelumnya).
const HOLIDAYS_ID = new Set([
  // 2026
  '2026-01-01', '2026-01-16', '2026-02-17', '2026-03-19', '2026-03-21', '2026-03-22', '2026-04-03', '2026-04-05',
  '2026-05-01', '2026-05-14', '2026-05-27', '2026-05-31', '2026-06-01', '2026-06-16', '2026-08-17', '2026-08-25', '2026-12-25',
  // 2027 (SKB 3 Menteri, Sep 2026)
  '2027-01-01', '2027-01-05', '2027-02-06', '2027-03-08', '2027-03-10', '2027-03-11', '2027-03-26', '2027-03-28', '2027-05-01',
  '2027-05-06', '2027-05-17', '2027-05-20', '2027-06-01', '2027-06-06', '2027-08-15', '2027-08-17', '2027-12-25', '2027-12-26',
]);
export function isWorkingDay(year: number, month: number, day: number) {
  if (new Date(year, month - 1, day).getDay() === 0) return false;
  return !HOLIDAYS_ID.has(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
}
export interface WeekBucket { week: number; days: number[]; workingDays: number }
export function weekBucketsForMonth(year: number, month: number): WeekBucket[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const buckets: WeekBucket[] = [];
  let week = 1;
  for (let d = 1; d <= daysInMonth; d++) {
    if (!buckets[week - 1]) buckets[week - 1] = { week, days: [], workingDays: 0 };
    buckets[week - 1].days.push(d);
    if (isWorkingDay(year, month, d)) buckets[week - 1].workingDays++;
    if (new Date(year, month - 1, d).getDay() === 0) week++;
  }
  return buckets;
}

export const COLORS = {
  // accent = biru logo (data utama) · prev = tahun lalu (abu) · target = garis putus abu gelap · mark = magenta logo (sorotan)
  accent: '#0181D5', accentSoft: 'rgba(1,129,213,.12)', blue: '#1E3A5C', blueMid: '#5D6B7C', blueSoft: 'rgba(93,107,124,.14)',
  green: '#2E7D4F', red: '#C03A2B', amber: '#A86300', ink: '#151A21', line: '#E2E5EA',
  prev: '#C3C9D2', target: '#4A5361', mark: '#C8035F', sub: '#7CB8E4',
};
export const PALETTE = ['#0181D5', '#1E3A5C', '#7CB8E4', '#C8035F', '#5D6B7C', '#2E7D4F', '#A86300', '#B9C1CC'];
