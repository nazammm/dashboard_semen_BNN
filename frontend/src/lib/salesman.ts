/* ============================================================================
   Kelompok capaian salesman (dipakai Tim Sales dan Overview).
   Tidak ada skor atau nomor peringkat: target antar salesman tidak setara (30 sampai ribuan ton),
   jadi persen capaian tidak adil untuk diurutkan. Yang dinilai hanya "tercapai atau belum".
   - Capai target   : semua target yang dimiliki (tonase, toko aktif) minimal 100%
   - Capai sebagian : punya dua target, hanya satu yang minimal 100%
   - Mendekati      : belum ada yang 100%, rata-rata capaian minimal 80%
   - Tertinggal     : rata-rata capaian di bawah 80%
============================================================================ */
import type { Row } from './types';

export type KelompokId = 'capai' | 'sebagian' | 'dekat' | 'tertinggal' | 'tanpa';
export const KELOMPOK: { id: KelompokId; label: string; variant: 'good' | 'online' | 'warn' | 'bad' | 'neutral'; ket: string }[] = [
  { id: 'capai', label: 'Capai target', variant: 'good', ket: 'Semua targetnya minimal 100%' },
  { id: 'sebagian', label: 'Capai sebagian', variant: 'online', ket: 'Satu dari dua target minimal 100%' },
  { id: 'dekat', label: 'Mendekati', variant: 'warn', ket: 'Belum ada yang 100%, rata-rata minimal 80%' },
  { id: 'tertinggal', label: 'Tertinggal', variant: 'bad', ket: 'Rata-rata capaian di bawah 80%' },
  { id: 'tanpa', label: 'Tanpa target', variant: 'neutral', ket: 'Belum punya target bulan ini' },
];
export const BATAS_DEKAT = 80;
export const kelompokInfo = (id: KelompokId) => KELOMPOK.find(k => k.id === id)!;

export interface Nilai { kelompok: KelompokId; urut: number; capaian_ta: number | null; capaian_tonase: number | null; satuTarget: boolean }
export function nilaiSalesman(r: Row): Nilai {
  const cta = Number(r.target_ta) > 0 ? Number(r.actual_ta || 0) / Number(r.target_ta) * 100 : null;
  const cton = Number(r.target_tonase) > 0 ? Number(r.actual_tonase || 0) / Number(r.target_tonase) * 100 : null;
  const parts = [cta, cton].filter((x): x is number => x != null);
  let kelompok: KelompokId;
  if (!parts.length) kelompok = 'tanpa';
  else if (parts.every(p => p >= 100)) kelompok = 'capai';
  else if (parts.some(p => p >= 100)) kelompok = 'sebagian';
  else kelompok = parts.reduce((a, b) => a + b, 0) / parts.length >= BATAS_DEKAT ? 'dekat' : 'tertinggal';
  return { kelompok, urut: KELOMPOK.findIndex(k => k.id === kelompok), capaian_ta: cta, capaian_tonase: cton, satuTarget: parts.length === 1 };
}
