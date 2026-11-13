/* ============================================================================
   Sell In BNN: membaca export raw sell in (.xlsx / .csv / teks tempelan dari Excel).
   Murni (tanpa DOM/React) supaya bisa dijalankan di Web Worker dan diuji di Node.

   Aturan baris yang dipakai (SAMA dengan sementrack.sellin_rule di database):
     - Tipe Pesanan = Gudang, ATAU
     - Distributor PT Permata Multi Niaga, Tipe Pesanan Toko/Project, Asal Pengiriman ITP-Palembang Terminal.
   1 baris = 1 pengiriman. Tonase = Delivery Quantity (zak) x berat zak dari nama produk.
============================================================================ */

/** Kolom yang dikirim ke server, urutannya = urutan argumen sementrack.sellin_bnn_stage. */
export const SELLIN_FIELDS = [
  { key: 'tanggal', header: 'Tanggal Pengiriman', required: true, kind: 'date' },
  { key: 'tanggal_order', header: 'Tanggal Order', kind: 'date' },
  { key: 'distributor', header: 'Distributor', required: true },
  { key: 'kode_customer', header: 'Kode Customer', required: true },
  { key: 'nama_customer', header: 'Nama Customer' },
  { key: 'tipe_pesanan', header: 'Tipe Pesanan', required: true },
  { key: 'tipe_produk', header: 'Tipe Produk', required: true },
  { key: 'asal_pengiriman', header: 'Asal Pengiriman', required: true },
  { key: 'kode_tujuan', header: 'Kode Toko/Proyek Pengiriman' },
  { key: 'nama_tujuan', header: 'Nama Toko/Proyek Pengiriman' },
  { key: 'kota_tujuan', header: 'Kota Pengiriman' },
  { key: 'loco_franco', header: 'Loco / Franco' },
  { key: 'order_no', header: 'Order No' },
  { key: 'sdo', header: 'SDO' },
  { key: 'nomor_truk', header: 'Nomor Truk' },
  { key: 'zona_group', header: 'Zona Group' },
  { key: 'status_order', header: 'Status Order' },
  { key: 'delivery_qty', header: 'Delivery Quantity', required: true, kind: 'number' },
] as const;

export type SellinRow = (string | number | null)[];   // panjang = SELLIN_FIELDS.length
const F = Object.fromEntries(SELLIN_FIELDS.map((f, i) => [f.key, i])) as Record<(typeof SELLIN_FIELDS)[number]['key'], number>;
export const SELLIN_IDX = F;

export const normHeader = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Cocokkan baris judul ke kolom yang dibutuhkan. Mengembalikan indeks kolom sumber per field (-1 = tidak ada). */
export function mapHeaders(header: unknown[]) {
  const idx = new Map<string, number>();
  header.forEach((h, i) => { const k = normHeader(h); if (k && !idx.has(k)) idx.set(k, i); });
  const cols = SELLIN_FIELDS.map(f => idx.get(normHeader(f.header)) ?? -1);
  const missing = SELLIN_FIELDS.filter((f, i) => 'required' in f && f.required && cols[i] < 0).map(f => f.header);
  return { cols, missing };
}

/* ---------------- nilai sel -> tanggal ISO / angka ---------------- */
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
function validYMD(y: number, m: number, d: number) {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= last ? `${y}-${pad(m)}-${pad(d)}` : null;
}
/** Nomor seri tanggal Excel (sistem 1900) -> ISO. */
export function excelSerialToISO(n: number) {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
/** Urutan tanggal bergaris miring: hari/bulan (Indonesia) atau bulan/hari (Excel berbahasa Inggris/US). */
export type DateOrder = 'dmy' | 'mdy';
const SLASH_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?!\d)/;

/**
 * Tanggal dari sel: angka seri Excel, "2026-11-03", "03/11/2026", "3 Nov 2026".
 * Bentuk garis miring dibaca sesuai `order`; kalau salah satu angka > 12, urutannya sudah pasti dari angka itu.
 */
export function toISODate(v: unknown, order: DateOrder = 'dmy'): string | null {
  if (v == null) return null;
  if (typeof v === 'number') return excelSerialToISO(v);
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToISO(Number(s));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return validYMD(+m[1], +m[2], +m[3]);
  m = SLASH_DATE.exec(s);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    const mdy = b > 12 && a <= 12 ? true : a > 12 && b <= 12 ? false : order === 'mdy';
    return mdy ? validYMD(y, a, b) : validYMD(y, b, a);
  }
  m = /^(\d{1,2})[\s-]+([A-Za-z]{3,})[\s-]+(\d{2,4})/.exec(s);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    let y = +m[3]; if (y < 100) y += 2000;
    return mo ? validYMD(y, mo, +m[1]) : null;
  }
  return null;
}

/** Hasil penentuan urutan tanggal untuk satu impor. */
export interface DateOrderInfo {
  used: DateOrder;        // urutan yang dipakai
  auto: DateOrder;        // hasil deteksi otomatis
  forced: boolean;        // dipilih manual oleh pengguna
  sure: boolean;          // ada bukti pasti (angka > 12)
  mixed: boolean;         // ada bukti untuk kedua urutan (data bercampur)
  slash: number;          // jumlah sel tanggal bergaris miring
  ambiguous: number;      // sel yang bisa dibaca dua arah (kedua angka ≤ 12 dan berbeda)
  example: string | null; // contoh sel yang bisa dibaca dua arah
  exampleDmy: { raw: string; iso: string } | null;   // contoh bukti hari/bulan
  exampleMdy: { raw: string; iso: string } | null;   // contoh bukti bulan/hari
}

const dayNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
export function localTodayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/**
 * Menentukan urutan tanggal dari SELURUH kolom, bukan per sel:
 *   1. Ada angka pertama > 12 (25/10) → hari/bulan; ada angka kedua > 12 (10/25) → bulan/hari.
 *   2. Kalau semua sel ≤ 12 (mis. 11/05/2026), pilih urutan yang tidak menghasilkan tanggal masa depan,
 *      lalu yang rentangnya paling rapat, lalu yang paling dekat dengan hari ini. Seri: hari/bulan.
 */
export class DateOrderDetector {
  private dmyOnly = 0;
  private mdyOnly = 0;
  private slash = 0;
  private ambiguous = 0;
  private distinct = new Map<string, [number, number, number]>();   // a/b/y unik (dibatasi)
  private example: string | null = null;
  private exDmy: { raw: string; iso: string } | null = null;
  private exMdy: { raw: string; iso: string } | null = null;

  note(v: unknown) {
    if (typeof v !== 'string') return;
    const s = v.trim();
    const m = SLASH_DATE.exec(s);
    if (!m) return;
    const a = +m[1], b = +m[2];
    let y = +m[3]; if (y < 100) y += 2000;
    this.slash++;
    if (a > 12 && b <= 12) { this.dmyOnly++; if (!this.exDmy) this.exDmy = { raw: s, iso: validYMD(y, b, a) || '' }; return; }
    if (b > 12 && a <= 12) { this.mdyOnly++; if (!this.exMdy) this.exMdy = { raw: s, iso: validYMD(y, a, b) || '' }; return; }
    if (a !== b) { this.ambiguous++; if (!this.example) this.example = s; }
    const k = `${a}/${b}/${y}`;
    if (this.distinct.size < 5000 && !this.distinct.has(k)) this.distinct.set(k, [a, b, y]);
  }

  private guess(today: string): DateOrder {
    const t = dayNum(today);
    const score = (mdy: boolean) => {
      let future = 0, lo = Infinity, hi = -Infinity;
      for (const [a, b, y] of this.distinct.values()) {
        const iso = mdy ? validYMD(y, a, b) : validYMD(y, b, a);
        if (!iso) continue;
        const n = dayNum(iso);
        if (n > t + 1) future++;          // toleransi 1 hari (zona waktu)
        lo = Math.min(lo, n); hi = Math.max(hi, n);
      }
      return { future, span: hi - lo, dist: Math.abs(t - hi) };
    };
    const d = score(false), m = score(true);
    if (m.future !== d.future) return m.future < d.future ? 'mdy' : 'dmy';
    if (m.span !== d.span) return m.span < d.span ? 'mdy' : 'dmy';
    if (m.dist !== d.dist) return m.dist < d.dist ? 'mdy' : 'dmy';
    return 'dmy';
  }

  decide(forced?: DateOrder | null, today = localTodayISO()): DateOrderInfo {
    const mixed = this.dmyOnly > 0 && this.mdyOnly > 0;
    const sure = !mixed && (this.dmyOnly > 0 || this.mdyOnly > 0);
    const auto: DateOrder = mixed ? (this.mdyOnly > this.dmyOnly ? 'mdy' : 'dmy')
      : this.mdyOnly > 0 ? 'mdy' : this.dmyOnly > 0 ? 'dmy'
      : this.ambiguous ? this.guess(today) : 'dmy';
    return {
      used: forced || auto, auto, forced: !!forced && forced !== auto, sure, mixed, slash: this.slash, ambiguous: this.ambiguous,
      example: this.example, exampleDmy: this.exDmy, exampleMdy: this.exMdy,
    };
  }
}

/** True kalau sel tanggal bergaris miring bisa dibaca dua arah (perlu dihitung ulang setelah urutan diputuskan). */
export function isAmbiguousDate(v: unknown) {
  if (typeof v !== 'string') return false;
  const m = SLASH_DATE.exec(v.trim());
  return !!m && +m[1] <= 12 && +m[2] <= 12 && +m[1] !== +m[2];
}
/** Angka dari sel: 14000, "14000", "14.000" (ribuan Indonesia), "14,000", "12,5". */
export function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, '');
  if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ---------------- aturan & tonase ---------------- */
const low = (v: unknown) => String(v ?? '').trim().toLowerCase();
/** WHITE MORTAR & TR-15 THINBED tidak dipakai (Sell In BNN cukup STR, RJW, CWC). */
export const isMortar = (produk: unknown) => /MORTAR|THINBED/i.test(String(produk ?? ''));
export function passesRule(tipe: unknown, distributor: unknown, asal: unknown, produk?: unknown) {
  if (produk !== undefined && isMortar(produk)) return false;
  const t = low(tipe);
  if (t === 'gudang') return true;
  return /permata multi niaga/i.test(String(distributor ?? '')) && (t === 'toko' || t === 'project') && low(asal) === 'itp-palembang terminal';
}
export function kgPerZak(produk: unknown) {
  const m = /(\d+(?:[.,]\d+)?)\s*KG/i.exec(String(produk ?? ''));
  return m ? Number(m[1].replace(',', '.')) : 40;
}

/* ---------------- pengumpul hasil ---------------- */
export interface SellinIssue { row: number; reason: string }
export interface SellinStats {
  rowsRead: number;
  rowsUsed: number;
  usedGudang: number;
  usedPmTokoProject: number;
  skippedTokoProject: number;      // toko/project selain PM (atau PM bukan dari ITP-Palembang)
  skippedOther: number;            // tipe pesanan lain / kosong
  skippedMortar: number;           // white mortar / thinbed
  invalid: number;
  issues: SellinIssue[];           // contoh baris bermasalah (maks 20)
  dateFrom: string | null;
  dateTo: string | null;
  ton: number;
  byMonth: Record<string, { ton: number; rows: number }>;
  byTipe: Record<string, number>;  // ton per tipe pesanan (baris terpakai)
  customers: Record<string, string>;   // kode customer Gudang -> nama (untuk cek peta region; toko/project PM otomatis Sumsel)
  dateOrder?: DateOrderInfo;           // urutan tanggal yang dipakai (hari/bulan atau bulan/hari)
}
export interface SellinParseResult { ok: boolean; error?: string; missing?: string[]; rows: SellinRow[]; stats: SellinStats }

export function newStats(): SellinStats {
  return { rowsRead: 0, rowsUsed: 0, usedGudang: 0, usedPmTokoProject: 0, skippedTokoProject: 0, skippedOther: 0, skippedMortar: 0, invalid: 0, issues: [],
    dateFrom: null, dateTo: null, ton: 0, byMonth: {}, byTipe: {}, customers: {} };
}

/**
 * Pengolah baris bertahap: panggil header() sekali dengan baris judul, lalu push() per baris data.
 * Hanya baris yang lolos aturan disimpan (dalam urutan SELLIN_FIELDS).
 */
export class SellinCollector implements RowCollector<SellinParseResult> {
  rows: SellinRow[] = [];
  stats = newStats();
  cols: number[] = [];
  missing: string[] = [];
  private ready = false;
  private tons: number[] = [];                                  // ton per baris tersimpan (untuk ringkasan per bulan)
  private dates = new DateOrderDetector();
  private recheck: [number, number, string][] = [];             // [baris, kolom, teks] tanggal yang bisa dibaca dua arah
  constructor(private order?: DateOrder | null) {}

  header(cells: unknown[]) {
    const { cols, missing } = mapHeaders(cells);
    this.cols = cols; this.missing = missing; this.ready = missing.length === 0;
    return this.ready;
  }

  /** rowNumber = nomor baris di file (1 = judul), untuk pesan kesalahan. */
  push(cells: unknown[], rowNumber: number) {
    if (!this.ready) return;
    const c = this.cols, st = this.stats;
    const get = (k: keyof typeof F) => { const i = c[F[k]]; return i >= 0 ? cells[i] : null; };
    // baris kosong total (mis. sisa format di bawah tabel) diabaikan tanpa dihitung
    if (get('distributor') == null && get('kode_customer') == null && get('tipe_pesanan') == null && get('tanggal') == null) return;
    st.rowsRead++;
    this.dates.note(get('tanggal'));   // semua baris ikut menentukan urutan tanggal, termasuk yang tidak dipakai

    const tipe = get('tipe_pesanan'), dist = get('distributor'), asal = get('asal_pengiriman');
    if (!passesRule(tipe, dist, asal)) {
      const t = low(tipe);
      if (t === 'toko' || t === 'project') st.skippedTokoProject++; else st.skippedOther++;
      return;
    }
    if (isMortar(get('tipe_produk'))) { st.skippedMortar++; return; }

    const tanggal = toISODate(get('tanggal'));
    const qty = toNumber(get('delivery_qty'));
    const produk = String(get('tipe_produk') ?? '').trim();
    const kode = String(get('kode_customer') ?? '').trim();
    let reason = '';
    if (!tanggal) reason = `Tanggal Pengiriman tidak terbaca ("${String(get('tanggal') ?? '')}")`;
    else if (qty == null || qty < 0) reason = `Delivery Quantity tidak valid ("${String(get('delivery_qty') ?? '')}")`;
    else if (!kode) reason = 'Kode Customer kosong';
    else if (!produk) reason = 'Tipe Produk kosong';
    if (reason) {
      st.invalid++;
      if (st.issues.length < 20) st.issues.push({ row: rowNumber, reason });
      return;
    }

    const out: SellinRow = SELLIN_FIELDS.map((f, i) => {
      const src = c[i];
      const v = src >= 0 ? cells[src] : null;
      if (v == null) return null;
      if ('kind' in f && f.kind === 'date') {
        if (isAmbiguousDate(v)) this.recheck.push([this.rows.length, i, String(v)]);
        return toISODate(v);
      }
      if ('kind' in f && f.kind === 'number') return toNumber(v);
      const s = String(v).trim();
      return s === '' ? null : s;
    });
    out[F.tanggal] = tanggal; out[F.delivery_qty] = qty; out[F.kode_customer] = kode;
    this.rows.push(out);

    const ton = (qty as number) * kgPerZak(produk) / 1000;
    this.tons.push(ton);
    st.rowsUsed++;
    if (low(tipe) === 'gudang') st.usedGudang++; else st.usedPmTokoProject++;
    st.ton += ton;
    const tk = String(tipe).trim().replace(/^\w/, ch => ch.toUpperCase());
    st.byTipe[tk] = (st.byTipe[tk] || 0) + ton;
    if (low(tipe) === 'gudang' && !(kode in st.customers)) st.customers[kode] = String(get('nama_customer') ?? '').trim();
  }

  result(): SellinParseResult {
    if (this.missing.length) return { ok: false, error: 'Kolom wajib tidak ditemukan di baris judul.', missing: this.missing, rows: [], stats: this.stats };
    if (!this.cols.length) return { ok: false, error: 'Baris judul tidak ditemukan.', rows: [], stats: this.stats };
    // urutan tanggal diputuskan dari seluruh kolom, lalu tanggal yang bisa dibaca dua arah dihitung ulang
    const st = this.stats, info = st.dateOrder = this.dates.decide(this.order);
    if (info.used === 'mdy') for (const [r, c, raw] of this.recheck) this.rows[r][c] = toISODate(raw, 'mdy');
    st.dateFrom = null; st.dateTo = null; st.byMonth = {};
    this.rows.forEach((row, i) => {
      const tgl = String(row[F.tanggal]);
      if (!st.dateFrom || tgl < st.dateFrom) st.dateFrom = tgl;
      if (!st.dateTo || tgl > st.dateTo) st.dateTo = tgl;
      const bm = st.byMonth[tgl.slice(0, 7)] || (st.byMonth[tgl.slice(0, 7)] = { ton: 0, rows: 0 });
      bm.ton += this.tons[i]; bm.rows++;
    });
    return { ok: true, rows: this.rows, stats: st };
  }
}

/* ---------------- teks: CSV / TSV (tempel dari Excel) ---------------- */
/** Deteksi pemisah dari baris pertama: tab (salinan Excel), titik koma, atau koma. */
export function detectDelimiter(firstLine: string) {
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const tabs = count('\t'), semi = count(';'), comma = count(','), pipes = count('|');
  if (pipes >= 3 && pipes > tabs) return '|';     // file TXT mentah ERP (J028, J073)
  if (tabs >= 3) return '\t';
  return semi > comma ? ';' : comma > 0 ? ',' : '\t';
}

/** Parser CSV/TSV sederhana sesuai RFC 4180 (tanda kutip ganda, baris baru di dalam kutip). Memanggil onRow per baris. */
export function parseDelimited(text: string, onRow: (cells: string[], lineNo: number) => void) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const nl = text.indexOf('\n');
  const delim = detectDelimiter(nl >= 0 ? text.slice(0, nl) : text);
  let row: string[] = [], field = '', inQ = false, line = 1;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
      continue;
    }
    if (ch === '"' && field === '') { inQ = true; continue; }
    if (ch === delim) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); onRow(row, line); row = []; field = ''; line++; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); onRow(row, line); }
  return delim;
}

/** Pengolah baris bertahap yang dipakai pembaca xlsx/teks (Sell In, Transaksi, ...). */
export interface RowCollector<R> {
  header(cells: unknown[]): boolean; push(cells: unknown[], rowNumber: number): void; result(): R;
  /** File TXT mentah ERP (berpemisah "|"): angka memakai titik desimal, "100.000" = 100 (bukan seratus ribu). */
  angkaErp?: boolean;
}

export function parseSellinText(text: string): SellinParseResult { return parseTextWith(text, new SellinCollector()); }
export function parseTextWith<R>(text: string, col: RowCollector<R>): R {
  let headerDone = false;
  const awal = text.replace(/^\ufeff/, '');
  if (detectDelimiter(awal.slice(0, Math.max(0, awal.indexOf('\n')) || awal.length)) === '|') col.angkaErp = true;
  parseDelimited(text, (cells, lineNo) => {
    if (!headerDone) {
      if (cells.every(x => x.trim() === '')) return;        // baris kosong di atas judul
      headerDone = true; col.header(cells); return;
    }
    col.push(cells.map(x => (x.trim() === '' ? null : x)), lineNo);
  });
  return col.result();
}

/* ============================================================================
   XLSX bertahap: unzip memakai DecompressionStream bawaan browser (tanpa library),
   sheet XML dibaca per potongan sehingga file 40 MB+ tidak perlu dimuat utuh ke memori.
============================================================================ */
interface ZipEntry { name: string; method: number; csize: number; usize: number; offset: number }

function readZipEntries(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Bukan file .xlsx yang valid (struktur ZIP tidak ditemukan).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Struktur ZIP rusak.');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    // lokasi data = setelah header lokal (panjang nama/extra di header lokal bisa berbeda dari direktori pusat)
    const lnlen = dv.getUint16(lho + 26, true), lxlen = dv.getUint16(lho + 28, true);
    out.push({ name, method, csize, usize, offset: lho + 30 + lnlen + lxlen });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

function entryStream(buf: Uint8Array, e: ZipEntry, onBytes?: (n: number) => void): ReadableStream<string> {
  const raw = buf.subarray(e.offset, e.offset + e.csize);
  let src: ReadableStream<Uint8Array> = new Blob([raw]).stream();
  if (onBytes) {
    src = src.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, ctl) { onBytes(chunk.byteLength); ctl.enqueue(chunk); } }));
  }
  if (e.method === 8) src = src.pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
  else if (e.method !== 0) throw new Error(`Kompresi ZIP metode ${e.method} tidak didukung.`);
  return src.pipeThrough(new TextDecoderStream());
}
async function entryText(buf: Uint8Array, e: ZipEntry) {
  const reader = entryStream(buf, e).getReader();
  let s = '';
  for (;;) { const { done, value } = await reader.read(); if (done) break; s += value; }
  return s;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const xmlDecode = (s: string) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g: string) =>
  g[0] === '#' ? String.fromCodePoint(g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)) : ENT[g] ?? m));

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const reSi = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  let m: RegExpExecArray | null;
  while ((m = reSi.exec(xml))) {
    const inner = (m[1] || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');   // abaikan teks fonetik
    let s = '';
    const reT = /<t\b[^>]*>([\s\S]*?)<\/t>/g; let t: RegExpExecArray | null;
    while ((t = reT.exec(inner))) s += t[1];
    out.push(xmlDecode(s));
  }
  return out;
}

const colIndex = (ref: string) => { let n = 0; for (let i = 0; i < ref.length; i++) { const c = ref.charCodeAt(i); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); } return n - 1; };

/** Cari sheet pertama dari workbook.xml + relasinya; cadangan: xl/worksheets/sheet1.xml. */
async function firstSheetName(buf: Uint8Array, entries: ZipEntry[]) {
  const byName = new Map(entries.map(e => [e.name, e]));
  try {
    const wb = byName.get('xl/workbook.xml'), rels = byName.get('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const wbx = await entryText(buf, wb), rx = await entryText(buf, rels);
      const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wbx)?.[1];
      const target = rid ? new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rx)?.[1]
        ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rx)?.[1] : undefined;
      if (target) {
        const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
        if (byName.has(path)) return path;
      }
    }
  } catch { /* pakai cadangan */ }
  const sheets = entries.map(e => e.name).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.slice(19)) - parseInt(b.slice(19)));
  if (!sheets.length) throw new Error('Sheet tidak ditemukan di file .xlsx.');
  return sheets[0];
}

/**
 * Baca .xlsx (sheet pertama) secara bertahap. onProgress(0..1) berdasarkan byte terkompresi yang sudah diproses.
 */
export function parseSellinXlsx(data: ArrayBuffer, onProgress?: (p: number) => void): Promise<SellinParseResult> {
  return parseXlsxWith(data, new SellinCollector(), onProgress);
}
export async function parseXlsxWith<R>(data: ArrayBuffer, col: RowCollector<R>, onProgress?: (p: number) => void): Promise<R> {
  const buf = new Uint8Array(data);
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('File ini bukan .xlsx (mungkin .xls lama). Simpan ulang sebagai .xlsx atau .csv.');
  const entries = readZipEntries(buf);
  const byName = new Map(entries.map(e => [e.name, e]));
  const ssEntry = byName.get('xl/sharedStrings.xml');
  const shared = ssEntry ? parseSharedStrings(await entryText(buf, ssEntry)) : [];
  const sheetEntry = byName.get(await firstSheetName(buf, entries))!;

  let headerDone = false, rowNo = 0;
  let readBytes = 0, lastReport = 0;
  const reader = entryStream(buf, sheetEntry, n => {
    readBytes += n;
    const p = sheetEntry.csize ? readBytes / sheetEntry.csize : 0;
    if (onProgress && p - lastReport >= 0.01) { lastReport = p; onProgress(Math.min(p, 0.999)); }
  }).getReader();

  const reRowStart = /<row\b([^>]*?)(\/?)>/g;
  const reCell = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const reR = /\br="([A-Z]+)(\d*)"/, reT = /\bt="([a-zA-Z]+)"/, reV = /<v>([\s\S]*?)<\/v>/, reIs = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  const rowNumAttr = /\br="(\d+)"/;

  const handleRow = (attrs: string, inner: string) => {
    const rn = rowNumAttr.exec(attrs);
    rowNo = rn ? +rn[1] : rowNo + 1;
    const cells: unknown[] = [];
    let next = 0, m: RegExpExecArray | null;
    reCell.lastIndex = 0;
    while ((m = reCell.exec(inner))) {
      const a = m[1], body = m[2];
      const r = reR.exec(a);
      const ci = r ? colIndex(r[1]) : next;
      next = ci + 1;
      if (body == null) continue;
      const t = reT.exec(a)?.[1] || 'n';
      let v: unknown = null;
      if (t === 'inlineStr') {
        let s = ''; let x: RegExpExecArray | null; reIs.lastIndex = 0;
        while ((x = reIs.exec(body))) s += x[1];
        v = xmlDecode(s);
      } else {
        const vv = reV.exec(body)?.[1];
        if (vv == null) continue;
        if (t === 's') v = shared[+vv] ?? null;
        else if (t === 'str' || t === 'd') v = xmlDecode(vv);
        else if (t === 'b') v = vv === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'e') v = null;
        else { const n = Number(vv); v = Number.isFinite(n) ? n : vv; }
      }
      cells[ci] = v;
    }
    if (!headerDone) {
      if (!cells.some(x => x != null && String(x).trim() !== '')) return;
      headerDone = true; col.header(cells); return;
    }
    col.push(cells, rowNo);
  };

  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += value;
    // proses semua baris yang sudah lengkap di buffer
    let consumed = 0;
    reRowStart.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = reRowStart.exec(buffer))) {
      if (m[2] === '/') { rowNo = (rowNumAttr.exec(m[1]) ? +rowNumAttr.exec(m[1])![1] : rowNo + 1); consumed = reRowStart.lastIndex; continue; }
      const end = buffer.indexOf('</row>', reRowStart.lastIndex);
      if (end < 0) break;                                   // baris belum lengkap: tunggu potongan berikutnya
      handleRow(m[1], buffer.slice(reRowStart.lastIndex, end));
      consumed = end + 6;
      reRowStart.lastIndex = consumed;
    }
    if (consumed) buffer = buffer.slice(consumed);
    else if (buffer.length > 4_000_000 && buffer.indexOf('<row') < 0) buffer = buffer.slice(-1000);   // bagian sebelum <sheetData>
    if (done) break;
    if (!headerDone && rowNo > 50) break;                    // tidak ada judul di 50 baris pertama
  }
  onProgress?.(1);
  return col.result();
}
