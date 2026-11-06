/* ============================================================================
   Import J073 (transaksi warehouse INSA & PKB) untuk Sell Out BNN.
   Yang dipakai hanya Product Category SEMEN / WHITE CEMENT dan Cust Group RETAIL.
   Pembagian ke baris Sell Out BNN (INSA, INSA-E, INSA - ACEH, PKB, Dumai-PKB, Dumai-Patent)
   dilakukan di database (sementrack.sellout_j073_aturan), bukan di sini.
   Murni (tanpa DOM) supaya bisa jalan di Web Worker dan diuji di Node.
   Urutan kolom yang dikirim = urutan argumen sementrack.sellout_j073_simpan.
============================================================================ */
import { DateOrderDetector, isAmbiguousDate, kgPerZak, normHeader, toISODate, toNumber, type DateOrder, type DateOrderInfo, type RowCollector } from './sellin';

const COLS = [
  { key: 'dist_code', header: 'Distributor Code', required: true },
  { key: 'do_date', header: 'DO Date', required: true },
  { key: 'do_no', header: 'No. DO', required: true },
  { key: 'customer_code', header: 'Customer Code', required: true },
  { key: 'customer_name', header: 'Customer Name' },
  { key: 'product_code', header: 'Product Code', required: true },
  { key: 'product_name', header: 'Product Name' },
  { key: 'order_qty', header: 'Order Qty', required: true },
  { key: 'net_amount', header: 'Net Amount', required: true },
  { key: 'warehouse', header: 'Warehouse', required: true },
  // hanya untuk saringan, tidak dikirim
  { key: 'category', header: 'Product Category', required: true },
  { key: 'cust_group', header: 'Cust Group', required: true },
  { key: 'dist_name', header: 'Distributor Name' },
] as const;
type Key = (typeof COLS)[number]['key'];
const SENT = 10;   // 10 kolom pertama dikirim ke server

export const J073_CATEGORIES = ['SEMEN', 'WHITE CEMENT'];
export type J073Row = (string | number | null)[];
export interface J073Group { dist: string; gudang: string; rows: number; ton: number }
export interface J073Stats {
  rowsRead: number;
  rowsUsed: number;
  skippedProduk: number;      // bukan semen / white cement
  skippedRetail: number;      // cust group selain RETAIL
  invalid: number;
  issues: { row: number; reason: string }[];
  dateFrom: string | null;
  dateTo: string | null;
  ton: number;
  distNames: Record<string, string>;
  groups: J073Group[];                                   // per distributor x gudang
  byMonth: Record<string, { ton: number; rows: number }>;
  dateOrder?: DateOrderInfo;
}
export interface J073ParseResult { ok: boolean; error?: string; missing?: string[]; rows: J073Row[]; stats: J073Stats }

const up = (v: unknown) => String(v ?? '').trim().toUpperCase();
/** Kode di sel angka (4094, 107, 2517332) → teks tanpa ".0". */
const code = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? String(v) : String(v ?? '').trim());
/** Tonase sama dengan database: zak × berat dari nama produk (PCC@50KG = 50 kg, lainnya 40 kg). */
export const j073Ton = (qty: number, productName: unknown) => qty * kgPerZak(productName) / 1000;

export class J073Collector implements RowCollector<J073ParseResult> {
  rows: J073Row[] = [];
  stats: J073Stats = { rowsRead: 0, rowsUsed: 0, skippedProduk: 0, skippedRetail: 0, invalid: 0, issues: [], dateFrom: null, dateTo: null, ton: 0, distNames: {}, groups: [], byMonth: {} };
  private cols: number[] = [];
  private missing: string[] = [];
  private ready = false;
  private tons: number[] = [];
  private dates = new DateOrderDetector();
  private recheck: [number, string][] = [];
  constructor(private order?: DateOrder | null) {}

  header(cells: unknown[]) {
    const idx = new Map<string, number>();
    cells.forEach((h, i) => { const k = normHeader(h); if (k && !idx.has(k)) idx.set(k, i); });
    this.cols = COLS.map(c => idx.get(normHeader(c.header)) ?? -1);
    this.missing = COLS.filter((c, i) => 'required' in c && c.required && this.cols[i] < 0).map(c => c.header);
    this.ready = this.missing.length === 0;
    return this.ready;
  }

  private bad(row: number, reason: string) {
    this.stats.invalid++;
    if (this.stats.issues.length < 20) this.stats.issues.push({ row, reason });
  }

  push(cells: unknown[], rowNumber: number) {
    if (!this.ready) return;
    const get = (k: Key) => { const i = this.cols[COLS.findIndex(c => c.key === k)]; return i >= 0 ? cells[i] : null; };
    if (get('dist_code') == null && get('do_no') == null && get('product_code') == null) return;   // baris kosong
    const st = this.stats;
    st.rowsRead++;
    if (!J073_CATEGORIES.includes(up(get('category')))) { st.skippedProduk++; return; }
    if (up(get('cust_group')) !== 'RETAIL') { st.skippedRetail++; return; }

    const rawDate = get('do_date');
    this.dates.note(rawDate);
    const tgl = toISODate(rawDate);
    const qty = toNumber(get('order_qty'));
    const net = get('net_amount') == null || String(get('net_amount')).trim() === '' ? 0 : toNumber(get('net_amount'));
    const dist = code(get('dist_code')), doNo = code(get('do_no')), cust = code(get('customer_code')), prod = up(get('product_code'));
    let reason = '';
    if (!dist) reason = 'Distributor Code kosong';
    else if (!tgl) reason = `DO Date tidak terbaca ("${String(rawDate ?? '')}")`;
    else if (!doNo) reason = 'No. DO kosong';
    else if (!cust) reason = 'Customer Code kosong';
    else if (!prod) reason = 'Product Code kosong';
    else if (qty == null) reason = `Order Qty bukan angka ("${String(get('order_qty') ?? '')}")`;
    else if (net == null) reason = `Net Amount bukan angka ("${String(get('net_amount') ?? '')}")`;
    if (reason) { this.bad(rowNumber, reason); return; }

    if (isAmbiguousDate(rawDate)) this.recheck.push([this.rows.length, String(rawDate)]);
    const name = String(get('product_name') ?? '').trim();
    const out: J073Row = [dist, tgl, doNo, cust, String(get('customer_name') ?? '').trim() || null, prod, name || null, qty, net, up(get('warehouse')) || null];
    this.rows.push(out.slice(0, SENT));
    this.tons.push(j073Ton(qty!, name));
    st.rowsUsed++;
    if (!(dist in st.distNames) && get('dist_name')) st.distNames[dist] = String(get('dist_name')).trim();
  }

  result(): J073ParseResult {
    if (this.missing.length) return { ok: false, error: 'Kolom wajib tidak ditemukan di baris judul.', missing: this.missing, rows: [], stats: this.stats };
    if (!this.cols.length) return { ok: false, error: 'Baris judul tidak ditemukan.', rows: [], stats: this.stats };
    const st = this.stats, info = st.dateOrder = this.dates.decide(this.order);
    if (info.used === 'mdy') for (const [r, raw] of this.recheck) this.rows[r][1] = toISODate(raw, 'mdy');
    const g = new Map<string, J073Group>();
    st.ton = 0; st.byMonth = {};
    this.rows.forEach((row, i) => {
      const tgl = String(row[1]), ton = this.tons[i];
      if (!st.dateFrom || tgl < st.dateFrom) st.dateFrom = tgl;
      if (!st.dateTo || tgl > st.dateTo) st.dateTo = tgl;
      const bm = st.byMonth[tgl.slice(0, 7)] || (st.byMonth[tgl.slice(0, 7)] = { ton: 0, rows: 0 });
      bm.ton += ton; bm.rows++;
      st.ton += ton;
      const k = `${row[0]}|${row[9] ?? ''}`;
      const x = g.get(k) || { dist: String(row[0]), gudang: String(row[9] ?? '–'), rows: 0, ton: 0 };
      x.rows++; x.ton += ton; g.set(k, x);
    });
    st.groups = [...g.values()].sort((a, b) => a.dist.localeCompare(b.dist) || b.ton - a.ton);
    return { ok: true, rows: this.rows, stats: st };
  }
}
