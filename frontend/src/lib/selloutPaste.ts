/* ============================================================================
   Tempelan Sell Out BNN dari Excel: DO FAS (rekap DO Korin) dan Sub ERP.
   Murni (tanpa DOM) supaya mudah diuji di Node.
   - DO FAS : [Tipe] | Area | Distributor | Keterangan | 1 .. 12      (ton)
   - Sub ERP: Distributor ("S006 - PT. …") | [Tipe] | Jan .. Dec | Total (ton)
   Angka "-" atau kosong = 0. Format 7,572 / 5,289.20 / 7.572 / 5.289,20 dikenali.
============================================================================ */
import { toNumber } from './sellin';

export type Tipe = 'STR' | 'RJW' | 'CWC';
export const TIPE: Tipe[] = ['STR', 'RJW', 'CWC'];
export interface Issue { row: number; reason: string }
export interface DofasRow { tipe: Tipe; area: string; distributor: string; keterangan: string; ton: number[] }
export interface ErpRow { kode: string; nama: string; tipe: Tipe | null; ton: number[]; total: number | null }
export interface PasteResult<R> { ok: boolean; error?: string; rows: R[]; issues: Issue[]; warnings: string[] }

const MONTH_NAMES = [
  ['jan', 'januari', 'january'], ['feb', 'februari', 'february', 'peb'], ['mar', 'maret', 'march'], ['apr', 'april'],
  ['may', 'mei'], ['jun', 'juni', 'june'], ['jul', 'juli', 'july'], ['aug', 'agu', 'agt', 'agustus', 'august'],
  ['sep', 'sept', 'september'], ['oct', 'okt', 'oktober', 'october'], ['nov', 'november', 'nop'], ['dec', 'des', 'desember', 'december'],
];
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const monthOf = (h: string): number | null => {
  const s = norm(h);
  if (/^\d{1,2}$/.test(s) && +s >= 1 && +s <= 12) return +s;
  const i = MONTH_NAMES.findIndex(names => names.includes(s));
  return i >= 0 ? i + 1 : null;
};

const splitLines = (text: string) =>
  text.replace(/\r\n?/g, '\n').split('\n').map(l => l.split('\t'));

/** Angka sel: "-" / kosong = 0; selain angka = null (tidak terbaca). */
export function cellTon(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (s === '' || /^-+$/.test(s)) return 0;
  const neg = /^\(.*\)$/.test(s);                         // (1,234) = negatif
  const n = toNumber(neg ? s.slice(1, -1) : s.startsWith('.') ? '0' + s : s);
  return n == null ? null : neg ? -n : n;
}

/** Cari baris judul: baris pertama yang punya ≥ 12 kolom bulan. */
function findHeader(lines: string[][]) {
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const months = new Map<number, number>();
    lines[i].forEach((c, j) => { const m = monthOf(c); if (m && !months.has(m)) months.set(m, j); });
    if (months.size === 12) return { index: i, months: Array.from({ length: 12 }, (_, k) => months.get(k + 1)!) };
  }
  return null;
}

const tipeOf = (v: unknown): Tipe | null => {
  const s = norm(v).toUpperCase();
  return s === 'STR' || s === 'RJW' || s === 'CWC' ? s : s === 'WC' ? 'CWC' : null;
};

/* ---------------- DO FAS ---------------- */
export function parseDofas(text: string): PasteResult<DofasRow> {
  const lines = splitLines(text);
  const head = findHeader(lines);
  const res: PasteResult<DofasRow> = { ok: false, rows: [], issues: [], warnings: [] };
  if (!head) { res.error = 'Baris judul tidak ditemukan. Ikutkan baris judul (Area, Distributor, Keterangan, 1 s.d. 12) saat menyalin.'; return res; }
  const h = lines[head.index].map(norm);
  const iArea = h.indexOf('area'), iDist = h.indexOf('distributor'), iKet = h.indexOf('keterangan');
  if (iDist < 0) { res.error = 'Kolom "Distributor" tidak ditemukan di baris judul.'; return res; }
  const named = h.findIndex(c => c === 'tipe' || c === 'type' || c === 'produk');
  const iTipe = named >= 0 ? named : 0;   // kolom tanpa judul paling kiri = STR / RJW

  for (let i = head.index + 1; i < lines.length; i++) {
    const c = lines[i], rowNo = i + 1;
    if (c.every(x => !String(x).trim())) continue;
    const dist = String(c[iDist] ?? '').trim();
    const raw = head.months.map(j => c[j]);
    if (!dist) {
      if (raw.every(x => !String(x ?? '').trim())) continue;          // baris pemisah, mis. "RJW  FIX"
      res.issues.push({ row: rowNo, reason: 'Distributor kosong tetapi ada angka' }); continue;
    }
    const tipe = tipeOf(c[iTipe]);
    if (!tipe) { res.issues.push({ row: rowNo, reason: `Tipe "${String(c[iTipe] ?? '').trim()}" bukan STR/RJW/CWC (${dist})` }); continue; }
    const ton = raw.map(cellTon);
    const bad = ton.findIndex(x => x == null);
    if (bad >= 0) { res.issues.push({ row: rowNo, reason: `${dist}: bulan ${bad + 1} bukan angka ("${String(raw[bad]).trim()}")` }); continue; }
    res.rows.push({ tipe, area: iArea >= 0 ? String(c[iArea] ?? '').trim() : '', distributor: dist, keterangan: iKet >= 0 ? String(c[iKet] ?? '').trim() : '', ton: ton as number[] });
  }
  res.ok = res.rows.length > 0;
  if (!res.ok && !res.error) res.error = 'Tidak ada baris data yang terbaca.';
  return res;
}

/* ---------------- Sub ERP ---------------- */
const ERP_NAME = /^\s*([A-Za-z]{1,3}\d{2,5})\s*-\s*(.*?)\s*$/;

export function parseErp(text: string): PasteResult<ErpRow> {
  const lines = splitLines(text);
  const head = findHeader(lines);
  const res: PasteResult<ErpRow> = { ok: false, rows: [], issues: [], warnings: [] };
  if (!head) { res.error = 'Baris judul tidak ditemukan. Ikutkan baris judul (Distributor, Jan s.d. Dec, Total) saat menyalin.'; return res; }
  const h = lines[head.index].map(norm);
  let iDist = h.indexOf('distributor'); if (iDist < 0) iDist = 0;
  const iTipe = h.findIndex(c => c === 'tipe' || c === 'type' || c === 'produk');
  const iTotal = h.indexOf('total');
  const seen = new Set<string>();

  for (let i = head.index + 1; i < lines.length; i++) {
    const c = lines[i], rowNo = i + 1;
    if (c.every(x => !String(x).trim())) continue;
    const name = String(c[iDist] ?? '').trim();
    if (/^(grand\s*)?total$/i.test(name)) continue;                  // baris total di bawah tabel
    const m = ERP_NAME.exec(name);
    if (!m) { res.issues.push({ row: rowNo, reason: `"${name}" tidak berformat "S006 - Nama"` }); continue; }
    let tipe: Tipe | null = null;
    if (iTipe >= 0) {
      tipe = tipeOf(c[iTipe]);
      if (!tipe) { res.issues.push({ row: rowNo, reason: `Tipe "${String(c[iTipe] ?? '').trim()}" bukan STR/RJW/CWC (${m[1]})` }); continue; }
    }
    const raw = head.months.map(j => c[j]);
    const ton = raw.map(cellTon);
    const bad = ton.findIndex(x => x == null);
    if (bad >= 0) { res.issues.push({ row: rowNo, reason: `${m[1]}: bulan ${bad + 1} bukan angka ("${String(raw[bad]).trim()}")` }); continue; }
    const kode = m[1].toUpperCase(), key = `${kode}|${tipe ?? ''}`;
    if (seen.has(key)) { res.issues.push({ row: rowNo, reason: `${kode}${tipe ? ' ' + tipe : ''} muncul dua kali; baris ini dilewati` }); continue; }
    seen.add(key);
    const total = iTotal >= 0 ? cellTon(c[iTotal]) : null;
    const sum = (ton as number[]).reduce((a, b) => a + b, 0);
    if (total != null && Math.abs(total - sum) > 0.05) res.warnings.push(`${kode}: jumlah Jan–Dec ${sum.toFixed(2)} tidak sama dengan kolom Total ${total.toFixed(2)}`);
    res.rows.push({ kode, nama: m[2], tipe, ton: ton as number[], total });
  }
  res.ok = res.rows.length > 0;
  if (!res.ok && !res.error) res.error = 'Tidak ada baris data yang terbaca.';
  return res;
}

/* ---------------- Pemetaan ke baris Sell Out BNN ---------------- */
export interface PetaRow { id: number; urutan: number; region: string; nama: string; dofas_kode: string[] | null; dofas_tipe: Tipe | null; erp_kode: string | null }
export interface Mapped { peta: PetaRow; ton: number[]; rows: number }
export interface Ignored { key: string; label: string; ton: number; rows: number }

const up = (s: string) => s.trim().toUpperCase();

export function mapDofas(rows: DofasRow[], peta: PetaRow[]) {
  const used = new Set<number>();
  const mapped: Mapped[] = peta.filter(p => p.dofas_kode?.length).map(p => {
    const codes = new Set(p.dofas_kode!.map(up));
    const ton = new Array(12).fill(0); let n = 0;
    rows.forEach((r, i) => {
      if (codes.has(up(r.distributor)) && (!p.dofas_tipe || r.tipe === p.dofas_tipe)) { used.add(i); n++; r.ton.forEach((t, k) => { ton[k] += t; }); }
    });
    return { peta: p, ton, rows: n };
  });
  return { mapped, ignored: groupIgnored(rows.map((r, i) => ({ i, key: up(r.distributor), label: r.distributor, total: sum(r.ton) })), used) };
}

export function mapErp(rows: ErpRow[], peta: PetaRow[]) {
  const used = new Set<number>();
  const mapped: Mapped[] = peta.filter(p => p.erp_kode).map(p => {
    const ton = new Array(12).fill(0); let n = 0;
    rows.forEach((r, i) => { if (r.kode === up(p.erp_kode!)) { used.add(i); n++; r.ton.forEach((t, k) => { ton[k] += t; }); } });
    return { peta: p, ton, rows: n };
  });
  return { mapped, ignored: groupIgnored(rows.map((r, i) => ({ i, key: r.kode, label: `${r.kode} - ${r.nama}`, total: sum(r.ton) })), used) };
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
function groupIgnored(items: { i: number; key: string; label: string; total: number }[], used: Set<number>): Ignored[] {
  const m = new Map<string, Ignored>();
  items.filter(x => !used.has(x.i)).forEach(x => {
    const g = m.get(x.key) || { key: x.key, label: x.label, ton: 0, rows: 0 };
    g.ton += x.total; g.rows++; m.set(x.key, g);
  });
  return [...m.values()].sort((a, b) => b.ton - a.ton);
}

/** Bentuk baris untuk fungsi database (urutan kolom = argumen sementrack.sellout_*_simpan). */
export const dofasPayload = (rows: DofasRow[]) => rows.map(r => [r.tipe, r.area, r.distributor, r.keterangan, ...r.ton]);
export const erpPayload = (rows: ErpRow[]) => rows.map(r => [r.kode, r.nama, r.tipe, ...r.ton]);
