/* ============================================================================
   Tempelan Sell Out BNN dari Excel: DO FAS (rekap DO Korin) dan Sub ERP.
   Murni (tanpa DOM) supaya mudah diuji di Node.
   - DO FAS : [Tipe] | Area | Distributor | Keterangan | 1 .. 12      (ton)
              Kolom Area TIDAK dipakai: region mengikuti peta Sell Out BNN.
              Tipe kosong ikut baris/judul bagian di atasnya (mis. baris "RJW FIX").
   - Sub ERP: Distributor ("S006 - PT. …") | [Tipe] | Jan .. Dec | Total (ton), atau
              per tipe dalam blok per bulan:   JANUARI
                                               S006 - PT. …  | PCC        | 3,369.70
                                               S006 - PT. …  | PCC – RJW  | 1,919.50
              (PCC = STR, PCC – RJW = RJW, White/Putih = CWC)
   Angka "-" atau kosong = 0. Format 7,572 / 5,289.20 / 7.572 / 5.289,20 dikenali.
============================================================================ */
import { toNumber } from './sellin';

export type Tipe = 'STR' | 'RJW' | 'CWC';
export const TIPE: Tipe[] = ['STR', 'RJW', 'CWC'];
export interface Issue { row: number; reason: string }
export interface DofasRow { tipe: Tipe; distributor: string; keterangan: string; ton: number[] }
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
  const byName = (x: string) => { const i = MONTH_NAMES.findIndex(names => names.includes(x)); return i >= 0 ? i + 1 : null; };
  // "Sep", "Sep-26", "Sep 2026", "September 2026"
  const named = /^([a-z]+)\.?(?:[\s\-/']*(?:\d{2}|\d{4}))?$/.exec(s);
  if (named) return byName(named[1]);
  // "2026-09", "09/2026", "9-2026"
  const num = /^(?:\d{4}[-/](\d{1,2})|(\d{1,2})[-/]\d{4})$/.exec(s);
  const m = num ? Number(num[1] ?? num[2]) : 0;
  return m >= 1 && m <= 12 ? m : null;
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

const MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Cari baris judul: baris pertama yang punya 12 kolom bulan.
 *  Kalau hanya sebagian bulan yang ada, kembalikan pesan bulan mana yang hilang
 *  (simpan mengganti setahun penuh, jadi bulan yang tidak ikut akan terhapus). */
function findHeader(lines: string[][]): { index: number; months: number[] } | { error: string } | null {
  let partial: number[] | null = null;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const months = new Map<number, number>();
    lines[i].forEach((c, j) => { const m = monthOf(c); if (m && !months.has(m)) months.set(m, j); });
    if (months.size === 12) return { index: i, months: Array.from({ length: 12 }, (_, k) => months.get(k + 1)!) };
    if (months.size >= 3 && !partial) partial = Array.from({ length: 12 }, (_, k) => k + 1).filter(k => !months.has(k));
  }
  if (partial) return { error: `Kolom bulan ${partial.map(k => MONTH_SHORT[k]).join(', ')} tidak ada di baris judul. Salin tabel lengkap Jan s.d. Des (simpan mengganti data setahun penuh).` };
  return null;
}

const tipeOf = (v: unknown): Tipe | null => {
  const s = norm(v).toUpperCase();
  return s === 'STR' || s === 'RJW' || s === 'CWC' ? s : s === 'WC' ? 'CWC' : null;
};
/** Judul bagian seperti "RJW FIX" / "STR": kata pertamanya tipe semen. */
const sectionTipe = (cells: string[]): Tipe | null => {
  for (const c of cells) { const w = norm(c).split(' ')[0]; if (w) return tipeOf(w); }
  return null;
};
const TIPE_HEAD = ['tipe', 'type', 'produk', 'jenis', 'semen', 'merk'];

/* ---------------- DO FAS ---------------- */
export function parseDofas(text: string): PasteResult<DofasRow> {
  const lines = splitLines(text);
  const head = findHeader(lines);
  const res: PasteResult<DofasRow> = { ok: false, rows: [], issues: [], warnings: [] };
  if (!head) { res.error = 'Baris judul tidak ditemukan. Ikutkan baris judul (Distributor, Keterangan, 1 s.d. 12) saat menyalin.'; return res; }
  if ('error' in head) { res.error = head.error; return res; }
  const h = lines[head.index].map(norm);
  const iDist = h.indexOf('distributor'), iKet = h.indexOf('keterangan');
  if (iDist < 0) { res.error = 'Kolom "Distributor" tidak ditemukan di baris judul.'; return res; }
  const iTipe = tipeColumn(lines, head.index, h, iDist);
  let section: Tipe | null = null;   // tipe dari baris/judul bagian di atasnya

  for (let i = head.index + 1; i < lines.length; i++) {
    const c = lines[i], rowNo = i + 1;
    if (c.every(x => !String(x).trim())) continue;
    const dist = String(c[iDist] ?? '').trim();
    const raw = head.months.map(j => c[j]);
    if (!dist) {
      if (raw.every(x => !String(x ?? '').trim())) {                    // baris pemisah, mis. "RJW  FIX"
        section = sectionTipe(c.slice(0, iDist)) ?? section; continue;
      }
      res.issues.push({ row: rowNo, reason: 'Distributor kosong tetapi ada angka' }); continue;
    }
    const cellTipe = String(c[iTipe] ?? '').trim();
    const tipe = cellTipe ? tipeOf(cellTipe) : section;
    if (!tipe) { res.issues.push({ row: rowNo, reason: cellTipe ? `Tipe "${cellTipe}" bukan STR/RJW/CWC (${dist})` : `Tipe kosong (${dist})` }); continue; }
    section = tipe;
    const ton = raw.map(cellTon);
    const bad = ton.findIndex(x => x == null);
    if (bad >= 0) { res.issues.push({ row: rowNo, reason: `${dist}: ${MONTH_SHORT[bad + 1]} bukan angka ("${String(raw[bad]).trim()}")` }); continue; }
    res.rows.push({ tipe, distributor: dist, keterangan: iKet >= 0 ? String(c[iKet] ?? '').trim() : '', ton: ton as number[] });
  }
  res.ok = res.rows.length > 0;
  if (!res.ok && !res.error) res.error = 'Tidak ada baris data yang terbaca.';
  return res;
}

/** Kolom tipe: yang berjudul Tipe/Produk/…; kalau tidak ada, kolom sebelum Distributor
 *  yang paling banyak berisi STR/RJW/CWC (biasanya kolom paling kiri tanpa judul). */
function tipeColumn(lines: string[][], headIndex: number, h: string[], iDist: number) {
  const named = h.findIndex(c => TIPE_HEAD.includes(c));
  if (named >= 0) return named;
  const data = lines.slice(headIndex + 1).filter(c => String(c[iDist] ?? '').trim());
  let best = -1, bestHits = 0;
  for (let j = 0; j < iDist; j++) {
    const filled = data.filter(c => String(c[j] ?? '').trim());
    const hits = filled.filter(c => tipeOf(c[j])).length;
    // kolom tipe: yang terisi hampir semuanya STR/RJW/CWC (boleh banyak yang kosong, mis. sel tergabung)
    if (hits > bestHits && hits >= filled.length * 0.8) { best = j; bestHits = hits; }
  }
  return best;   // -1: tidak ada kolom tipe, tipe hanya dari judul bagian
}

/* ---------------- Sub ERP ---------------- */
const ERP_NAME = /^\s*([A-Za-z]{1,3}\d{2,5})\s*-\s*(.*?)\s*$/;

/** Tipe produk ERP: "PCC" = STR, "PCC – RJW" / Rajawali = RJW, White / Putih = CWC. */
export function erpTipe(v: unknown): Tipe | null {
  const s = norm(v).toUpperCase();
  if (!s) return null;
  const direct = tipeOf(s); if (direct) return direct;
  if (/RJW|RAJAWALI/.test(s)) return 'RJW';
  if (/WHITE|PUTIH|CWC|\bWC\b|PCW/.test(s)) return 'CWC';
  if (/PCC|OPC|PPC|TIGA RODA|\bSTR\b/.test(s)) return 'STR';
  return null;
}

/** Format blok per bulan: baris judul bulan ("JANUARI", "Mei", "AGU"), lalu Distributor | Tipe | Ton. */
function parseErpBlocks(lines: string[][]): PasteResult<ErpRow> | null {
  const isMonthLine = (c: string[]) => { const f = c.filter(x => String(x).trim()); return f.length === 1 && monthOf(f[0]) != null && !ERP_NAME.test(f[0]) ? monthOf(f[0]) : null; };
  if (!lines.some(c => isMonthLine(c) != null)) return null;
  const res: PasteResult<ErpRow> = { ok: false, rows: [], issues: [], warnings: [] };
  const byKey = new Map<string, ErpRow>();
  const seen = new Set<string>();
  let month: number | null = null;
  const monthsSeen = new Set<number>();
  lines.forEach((c, i) => {
    const rowNo = i + 1;
    if (c.every(x => !String(x).trim())) return;
    const m = isMonthLine(c);
    if (m != null) {
      if (monthsSeen.has(m)) res.warnings.push(`Bulan ${MONTH_SHORT[m]} muncul dua kali; angkanya dijumlahkan.`);
      month = m; monthsSeen.add(m); return;
    }
    const cells = c.map(x => String(x ?? '').trim());
    const iName = cells.findIndex(x => ERP_NAME.test(x));
    if (iName < 0) {
      if (/^(grand\s*)?total/i.test(cells.find(Boolean) || '')) return;
      res.issues.push({ row: rowNo, reason: `"${cells.filter(Boolean).join(' ').slice(0, 60)}" tidak berformat "S006 - Nama"` }); return;
    }
    if (month == null) { res.issues.push({ row: rowNo, reason: 'Baris di atas judul bulan pertama (mis. "JANUARI")' }); return; }
    const nm = ERP_NAME.exec(cells[iName])!;
    const rest = cells.slice(iName + 1).filter(Boolean);
    const tipeCell = rest.length >= 2 ? rest[0] : '';
    const tipe = erpTipe(tipeCell);
    if (!tipe) { res.issues.push({ row: rowNo, reason: `${nm[1]}: tipe "${tipeCell}" tidak dikenali (PCC / PCC – RJW)` }); return; }
    const ton = cellTon(rest[rest.length - 1]);
    if (ton == null) { res.issues.push({ row: rowNo, reason: `${nm[1]} ${tipe} ${MONTH_SHORT[month]}: "${rest[rest.length - 1]}" bukan angka` }); return; }
    const kode = nm[1].toUpperCase(), key = `${kode}|${tipe}`, mk = `${key}|${month}`;
    if (seen.has(mk)) res.warnings.push(`${kode} ${tipe} ${MONTH_SHORT[month]} muncul lebih dari sekali; angkanya dijumlahkan.`);
    seen.add(mk);
    const row = byKey.get(key) || { kode, nama: nm[2], tipe, ton: new Array(12).fill(0), total: null };
    row.ton[month - 1] += ton; byKey.set(key, row);
  });
  res.rows = [...byKey.values()].sort((a, b) => a.kode.localeCompare(b.kode) || TIPE.indexOf(a.tipe!) - TIPE.indexOf(b.tipe!));
  res.ok = res.rows.length > 0;
  if (!res.ok) res.error = 'Tidak ada baris data yang terbaca.';
  return res;
}

export function parseErp(text: string): PasteResult<ErpRow> {
  const lines = splitLines(text);
  const head = findHeader(lines);
  const res: PasteResult<ErpRow> = { ok: false, rows: [], issues: [], warnings: [] };
  if (!head) { const blocks = parseErpBlocks(lines); if (blocks) return blocks; }
  if (!head) { res.error = 'Judul bulan tidak ditemukan. Salin tabel dengan baris judul (Distributor, Jan s.d. Dec), atau format per tipe dengan judul blok bulan (JANUARI, FEBRUARI, …).'; return res; }
  if ('error' in head) { res.error = head.error; return res; }
  const h = lines[head.index].map(norm);
  let iDist = h.indexOf('distributor'); if (iDist < 0) iDist = 0;
  const iTipe = h.findIndex(c => TIPE_HEAD.includes(c));
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
      tipe = erpTipe(c[iTipe]);
      if (!tipe) { res.issues.push({ row: rowNo, reason: `Tipe "${String(c[iTipe] ?? '').trim()}" bukan STR/RJW/CWC (${m[1]})` }); continue; }
    }
    const raw = head.months.map(j => c[j]);
    const ton = raw.map(cellTon);
    const bad = ton.findIndex(x => x == null);
    if (bad >= 0) { res.issues.push({ row: rowNo, reason: `${m[1]}: ${MONTH_SHORT[bad + 1]} bukan angka ("${String(raw[bad]).trim()}")` }); continue; }
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
// area selalu null: kolom Area di DO FAS tidak dipakai (region mengikuti peta)
export const dofasPayload = (rows: DofasRow[]) => rows.map(r => [r.tipe, null, r.distributor, r.keterangan, ...r.ton]);
export const erpPayload = (rows: ErpRow[]) => rows.map(r => [r.kode, r.nama, r.tipe, ...r.ton]);
