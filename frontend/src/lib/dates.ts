/* Utilitas tanggal berbasis string ISO "YYYY-MM-DD" (tanpa jam, tanpa zona waktu).
   Semua hitungan memakai Date.UTC supaya tidak bergeser oleh zona waktu browser. */
import { MONTHS_ID } from './format';

export const MONTHS_FULL = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const WEEKDAYS_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

export interface DateRange { from: string; to: string }

const pad = (n: number) => String(n).padStart(2, '0');
export const toISO = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const parseISO = (s: string) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
export const isISO = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Kolom hari pertama bulan itu, Senin = 0 ... Minggu = 6. */
export const firstWeekday = (y: number, m: number) => (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;

export function addDays(iso: string, n: number) {
  const { y, m, d } = parseISO(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
/** Geser bulan; tanggal dipotong ke akhir bulan kalau tidak ada (31 Mar - 1 bulan = 28/29 Feb). */
export function addMonths(iso: string, n: number) {
  const { y, m, d } = parseISO(iso);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}
export const addYears = (iso: string, n: number) => addMonths(iso, n * 12);
export const startOfMonth = (iso: string) => iso.slice(0, 8) + '01';
export const endOfMonth = (iso: string) => { const { y, m } = parseISO(iso); return toISO(y, m, daysInMonth(y, m)); };
export const startOfYear = (iso: string) => iso.slice(0, 5) + '01-01';
export const startOfQuarter = (iso: string) => { const { y, m } = parseISO(iso); return toISO(y, Math.floor((m - 1) / 3) * 3 + 1, 1); };
export const dayCount = (r: DateRange) =>
  Math.round((Date.UTC(+r.to.slice(0, 4), +r.to.slice(5, 7) - 1, +r.to.slice(8)) - Date.UTC(+r.from.slice(0, 4), +r.from.slice(5, 7) - 1, +r.from.slice(8))) / 86400000) + 1;

/** Periode yang sama, satu tahun sebelumnya (untuk perbandingan MTD vs MTD, YTD vs YTD, dst). */
export const sameRangeLastYear = (r: DateRange): DateRange => ({ from: addYears(r.from, -1), to: addYears(r.to, -1) });

/** "2 Nov 2026" */
export function fmtDate(iso: string) {
  if (!isISO(iso)) return '';
  const { y, m, d } = parseISO(iso);
  return `${d} ${MONTHS_ID[m]} ${y}`;
}
/** "1–2 Nov 2026", "28 Okt – 2 Nov 2026", "15 Des 2025 – 2 Jan 2026", "2 Nov 2026" */
export function fmtRange(r: DateRange) {
  if (!isISO(r.from) || !isISO(r.to)) return '';
  const a = parseISO(r.from), b = parseISO(r.to);
  if (r.from === r.to) return fmtDate(r.from);
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS_ID[b.m]} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${MONTHS_ID[a.m]} – ${b.d} ${MONTHS_ID[b.m]} ${b.y}`;
  return `${fmtDate(r.from)} – ${fmtDate(r.to)}`;
}
