/* ============================================================================
   Import laporan ORDB019 (Monthly Delivery Cost) untuk halaman Ongkos Kirim.
   Satu file = satu distributor x satu bulan (judul "DISTRIBUTOR : ... - 4094", "Periode : OCT2026").
   Baris judul tabel berisi "No Do" dan "No Foad". Satu No Foad = satu perjalanan truk dari gudang
   distributor ke toko; Total = ongkos yang tercatat untuk baris itu.
   Barang selain semen / white cement tanpa ongkos tidak dikirim (tidak dipakai).
   Murni (tanpa DOM) supaya bisa jalan di Web Worker dan diuji di Node.
   Urutan kolom yang dikirim = urutan argumen sementrack.ongkos_simpan.
============================================================================ */
import { kgPerZak, normHeader, toNumber } from './sellin';

export type OrdbRow = (string | number | null)[];
export interface OrdbFile {
  name: string;
  dist: string;           // kode ERP (4094, 9575, 1001K, ...)
  distName: string;
  periode: string;        // YYYY-MM-01
  rows: number;
  trips: number;
  ton: number;
  tonBerbiaya: number;
  biaya: number;
}
export interface OrdbStats {
  rowsRead: number;
  rowsUsed: number;
  skipped: number;                 // barang lain tanpa ongkos
  invalid: number;
  issues: { row: number; reason: string }[];
  files: OrdbFile[];
  trucks: { truk: string; trips: number; ton: number; biaya: number }[];
  ton: number;
  tonBerbiaya: number;             // ton di perjalanan yang sudah ada ongkosnya
  biaya: number;
  trips: number;
}
export interface OrdbParseResult { ok: boolean; error?: string; missing?: string[]; rows: OrdbRow[]; stats: OrdbStats }

const COLS = [
  { key: 'date', header: 'Date', required: true },
  { key: 'do_no', header: 'No Do', required: true },
  { key: 'foad', header: 'No Foad', required: true },
  { key: 'segmen', header: 'Retail/Project' },
  { key: 'transporter', header: 'Transporter' },
  { key: 'truk', header: 'Tipe Truck' },
  { key: 'asal', header: 'Lokasi Asal' },
  { key: 'tujuan', header: 'Lokasi Tujuan' },
  { key: 'zona', header: 'Zone DO' },
  { key: 'ritase', header: 'Harga Ritase' },
  { key: 'kategori', header: 'Category', required: true },
  { key: 'product', header: 'Product' },
  { key: 'product_code', header: 'Product Code' },
  { key: 'delivery', header: 'Delivery Type' },
  { key: 'qty', header: 'Qty', required: true },
  { key: 'harga_uom', header: 'Harga UOM' },
  { key: 'total', header: 'Total', required: true },
  { key: 'dist', header: 'Dist' },
] as const;
type Key = (typeof COLS)[number]['key'];

export const ORDB_SEMEN = ['SEMEN', 'WHITE CEMENT'];
const BULAN: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, MEI: 5, JUN: 6, JUL: 7, AUG: 8, AGU: 8, AGS: 8, SEP: 9, OCT: 10, OKT: 10, NOV: 11, DEC: 12, DES: 12 };
const txt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? String(v) : String(v ?? '').trim());
const up = (v: unknown) => txt(v).toUpperCase();
const pad = (n: number) => String(n).padStart(2, '0');

/** "Periode : OCT2026" / "OKT 2026" / "10/2026" → 2026-10-01 */
export function ordbPeriode(s: string): string | null {
  const t = s.toUpperCase();
  let m = /([A-Z]{3})[A-Z]*\s*[-/]?\s*(\d{4})/.exec(t);
  if (m && BULAN[m[1]]) return `${m[2]}-${pad(BULAN[m[1]])}-01`;
  m = /\b(\d{1,2})\s*[-/]\s*(\d{4})\b/.exec(t);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(+m[1])}-01`;
  return null;
}
/** Kode ERP di akhir nama distributor: "PT. INTINIAGA SUKSES ABADI - 4094" → 4094 */
export function ordbDist(s: string): { code: string; name: string } | null {
  const m = /^(.*?)\s+-\s*([0-9A-Z]{3,8})\s*$/i.exec(s.trim());
  return m ? { code: m[2].toUpperCase(), name: m[1].trim() } : null;
}
/** "02 Oct 2026" / angka seri Excel / Date → YYYY-MM-DD */
export function ordbTanggal(v: unknown): string | null {
  if (v instanceof Date && !isNaN(+v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v ?? '').trim().toUpperCase();
  let m = /^(\d{1,2})[\s-]+([A-Z]{3})[A-Z]*[\s-]+(\d{4})/.exec(s);
  if (m && BULAN[m[2]]) return `${m[3]}-${pad(BULAN[m[2]])}-${pad(+m[1])}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return null;
}

/** Satu sheet ORDB019 (array of arrays, nilai mentah) → baris untuk ongkos_simpan. */
export function parseOrdbSheet(aoa: unknown[][], fileName: string): OrdbParseResult {
  const stats: OrdbStats = { rowsRead: 0, rowsUsed: 0, skipped: 0, invalid: 0, issues: [], files: [], trucks: [], ton: 0, tonBerbiaya: 0, biaya: 0, trips: 0 };
  const fail = (error: string, missing?: string[]): OrdbParseResult => ({ ok: false, error, missing, rows: [], stats });
  let headerAt = -1, periode: string | null = null, dist: { code: string; name: string } | null = null;
  for (let r = 0; r < Math.min(aoa.length, 40); r++) {
    const cells = (aoa[r] || []).map(txt);
    const line = cells.filter(Boolean).join(' ');
    if (!periode && /PERIODE/i.test(line)) periode = ordbPeriode(line.replace(/.*PERIODE\s*:?/i, ''));
    if (!dist && /^DISTRIBUTOR\s*:/i.test(line)) dist = ordbDist(line.replace(/^DISTRIBUTOR\s*:\s*/i, ''));
    const h = new Set(cells.map(normHeader));
    if (h.has('nodo') && h.has('nofoad')) { headerAt = r; break; }
  }
  if (headerAt < 0) return fail('Baris judul tabel ORDB019 (No Do, No Foad, …) tidak ditemukan.');
  const idx = new Map<string, number>();
  (aoa[headerAt] || []).forEach((h, i) => { const k = normHeader(h); if (k && !idx.has(k)) idx.set(k, i); });
  const cols = COLS.map(c => idx.get(normHeader(c.header)) ?? -1);
  const missing = COLS.filter((c, i) => 'required' in c && c.required && cols[i] < 0).map(c => c.header);
  if (missing.length) return fail('Kolom wajib tidak ditemukan di baris judul.', missing);

  const rows: OrdbRow[] = [];
  const trips = new Map<string, { ton: number; biaya: number; truk: string }>();
  for (let r = headerAt + 1; r < aoa.length; r++) {
    const cells = aoa[r] || [];
    const get = (k: Key) => { const i = cols[COLS.findIndex(c => c.key === k)]; return i >= 0 ? cells[i] : null; };
    const doNo = txt(get('do_no')), foad = txt(get('foad'));
    if (!doNo && !foad) continue;                                    // baris kosong / total
    stats.rowsRead++;
    const bad = (reason: string) => { stats.invalid++; if (stats.issues.length < 20) stats.issues.push({ row: r + 1, reason }); };
    if (!dist && get('dist')) dist = ordbDist(txt(get('dist')));
    const tgl = ordbTanggal(get('date'));
    const qty = toNumber(get('qty')), total = toNumber(get('total')) ?? 0;
    const kat = up(get('kategori'));
    if (!doNo || !foad) { bad('No Do / No Foad kosong'); continue; }
    if (qty == null) { bad(`Qty bukan angka ("${txt(get('qty'))}")`); continue; }
    const semen = ORDB_SEMEN.includes(kat);
    if (!semen && total === 0) { stats.skipped++; continue; }
    const p = periode || (tgl ? tgl.slice(0, 8) + '01' : null);
    if (!p) { bad('Periode tidak terbaca'); continue; }
    if (!dist) { bad('Kode distributor tidak terbaca'); continue; }
    const name = txt(get('product'));
    rows.push([dist.code, p, tgl, doNo, foad, up(get('segmen')) || null, txt(get('transporter')) || null, up(get('truk')) || null,
      up(get('asal')) || null, up(get('tujuan')) || null, up(get('zona')) || null, toNumber(get('ritase')),
      kat || null, up(get('product_code')) || null, name || null, up(get('delivery')) || null, qty, toNumber(get('harga_uom')), total]);
    stats.rowsUsed++;
    const ton = semen ? qty * kgPerZak(name) / 1000 : 0;
    const k = `${dist.code}|${p}|${foad}`;
    const t = trips.get(k) || { ton: 0, biaya: 0, truk: up(get('truk')) || '–' };
    t.ton += ton; t.biaya += total; trips.set(k, t);
  }
  if (!dist) return fail('Kode distributor tidak ditemukan (judul "DISTRIBUTOR : … - 4094" atau kolom Dist).');
  if (!rows.length) return { ok: true, rows, stats };

  const files = new Map<string, OrdbFile>(), truk = new Map<string, OrdbStats['trucks'][number]>();
  for (const [k, t] of trips) {
    const [d, p] = k.split('|');
    const f = files.get(d + p) || { name: fileName, dist: d, distName: dist.name, periode: p, rows: 0, trips: 0, ton: 0, tonBerbiaya: 0, biaya: 0 };
    f.trips++; f.ton += t.ton; f.biaya += t.biaya; if (t.biaya > 0) f.tonBerbiaya += t.ton;
    files.set(d + p, f);
    if (t.ton > 0) {
      const x = truk.get(t.truk) || { truk: t.truk, trips: 0, ton: 0, biaya: 0 };
      x.trips++; x.ton += t.ton; x.biaya += t.biaya; truk.set(t.truk, x);
    }
  }
  for (const row of rows) { const f = files.get(String(row[0]) + String(row[1])); if (f) f.rows++; }
  stats.files = [...files.values()];
  stats.trucks = [...truk.values()].sort((a, b) => b.ton - a.ton);
  for (const f of stats.files) { stats.ton += f.ton; stats.tonBerbiaya += f.tonBerbiaya; stats.biaya += f.biaya; stats.trips += f.trips; }
  return { ok: true, rows, stats };
}

/** Gabungkan hasil beberapa file (mis. satu file per distributor). Distributor x bulan yang sama dua kali ditolak. */
export function gabungOrdb(list: OrdbParseResult[]): OrdbParseResult {
  const bad = list.find(r => !r.ok);
  if (bad) return bad;
  const seen = new Map<string, string>();
  for (const r of list) for (const f of r.stats.files) {
    const k = f.dist + f.periode;
    if (seen.has(k)) return { ...r, ok: false, error: `${f.dist} ${f.periode.slice(0, 7)} ada di dua file (${seen.get(k)} dan ${f.name}). Pilih salah satu.`, rows: [] };
    seen.set(k, f.name);
  }
  const st: OrdbStats = { rowsRead: 0, rowsUsed: 0, skipped: 0, invalid: 0, issues: [], files: [], trucks: [], ton: 0, tonBerbiaya: 0, biaya: 0, trips: 0 };
  const truk = new Map<string, OrdbStats['trucks'][number]>();
  const rows: OrdbRow[] = [];
  for (const r of list) {
    const s = r.stats;
    rows.push(...r.rows);
    st.rowsRead += s.rowsRead; st.rowsUsed += s.rowsUsed; st.skipped += s.skipped; st.invalid += s.invalid;
    st.issues.push(...s.issues.slice(0, Math.max(0, 20 - st.issues.length)));
    st.files.push(...s.files);
    st.ton += s.ton; st.tonBerbiaya += s.tonBerbiaya; st.biaya += s.biaya; st.trips += s.trips;
    for (const t of s.trucks) { const x = truk.get(t.truk) || { truk: t.truk, trips: 0, ton: 0, biaya: 0 }; x.trips += t.trips; x.ton += t.ton; x.biaya += t.biaya; truk.set(t.truk, x); }
  }
  st.files.sort((a, b) => a.dist.localeCompare(b.dist) || a.periode.localeCompare(b.periode));
  st.trucks = [...truk.values()].sort((a, b) => b.ton - a.ton);
  return { ok: true, rows, stats: st };
}

/** Muatan truk (ton) dari nama tipe: "ENGKEL (5 TON)" → 5, "TRONTON (25-30 TON)" → 30. */
export function kapasitasTruk(truk: unknown): number | null {
  const m = /(\d+(?:[.,]\d+)?)(?:\s*-\s*(\d+(?:[.,]\d+)?))?\s*TON/i.exec(String(truk ?? ''));
  if (!m) return null;
  return Number((m[2] || m[1]).replace(',', '.'));
}
