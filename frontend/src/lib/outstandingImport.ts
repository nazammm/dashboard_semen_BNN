/* ============================================================================
   Outstanding DO: membaca export raw sell in menurut TANGGAL ORDER (semua status).
   Kolomnya sama dengan raw sell in; bedanya ada order Verified / Not Verified / Reject
   yang belum punya Tanggal Pengiriman.
   Aturan baris sama dengan Sell In BNN (passesRule). Order = Distributor + Order No + Tipe Produk;
   baris pengiriman satu order digabung di database (sementrack.sellin_po_commit).
   Murni (tanpa DOM) supaya bisa jalan di Web Worker dan diuji di Node.
============================================================================ */
import {
  DateOrderDetector, isAmbiguousDate, isMortar, kgPerZak, normHeader, passesRule, toISODate, toNumber,
  type DateOrder, type DateOrderInfo, type RowCollector,
} from './sellin';

/** Urutan = urutan kolom paket sementrack.sellin_po_stage. */
const COLS = [
  { key: 'tanggal_order', header: 'Tanggal Order', required: true, kind: 'date' },
  { key: 'distributor', header: 'Distributor', required: true },
  { key: 'order_no', header: 'Order No', required: true },
  { key: 'tipe_produk', header: 'Tipe Produk', required: true },
  { key: 'status_order', header: 'Status Order', required: true },
  { key: 'estimasi', header: 'Estimasi Tanggal Pengiriman', kind: 'date' },
  { key: 'tanggal_kirim', header: 'Tanggal Pengiriman', kind: 'date' },
  { key: 'alasan_reject', header: 'Alasan Reject' },
  { key: 'kode_customer', header: 'Kode Customer', required: true },
  { key: 'nama_customer', header: 'Nama Customer' },
  { key: 'tipe_pesanan', header: 'Tipe Pesanan', required: true },
  { key: 'asal_pengiriman', header: 'Asal Pengiriman', required: true },
  { key: 'kode_tujuan', header: 'Kode Toko/Proyek Pengiriman' },
  { key: 'nama_tujuan', header: 'Nama Toko/Proyek Pengiriman' },
  { key: 'kota_tujuan', header: 'Kota Pengiriman' },
  { key: 'loco_franco', header: 'Loco / Franco' },
  { key: 'order_qty', header: 'Order Quantity', required: true, kind: 'number' },
  { key: 'delivery_qty', header: 'Delivery Quantity', kind: 'number' },
] as const;
type Key = (typeof COLS)[number]['key'];
const F = Object.fromEntries(COLS.map((c, i) => [c.key, i])) as Record<Key, number>;

export type PoRow = (string | number | null)[];
/** Status sesuai istilah di halaman. */
export type PoStatus = 'Terkirim' | 'Terkirim sebagian' | 'Belum dikirim' | 'Belum diverifikasi' | 'Reject' | 'Lainnya';
export const statusOf = (s: unknown): PoStatus => {
  const v = String(s ?? '').trim().toLowerCase();
  return v === 'delivered' ? 'Terkirim' : v === 'partially delivered' ? 'Terkirim sebagian' : v === 'verified' ? 'Belum dikirim'
    : v === 'not verified' ? 'Belum diverifikasi' : v === 'reject' ? 'Reject' : 'Lainnya';
};
export const PO_STATUS_ORDER: PoStatus[] = ['Belum dikirim', 'Terkirim sebagian', 'Belum diverifikasi', 'Terkirim', 'Reject', 'Lainnya'];

export interface PoStats {
  rowsRead: number;
  rowsUsed: number;
  skippedTokoProject: number;
  skippedOther: number;
  skippedMortar: number;
  invalid: number;
  issues: { row: number; reason: string }[];
  dateFrom: string | null;      // tanggal order
  dateTo: string | null;
  posisi: string | null;        // tanggal pengiriman terakhir (atau tanggal order terakhir)
  orders: number;
  byStatus: Record<string, { orders: number; ton: number }>;   // ton = sisa untuk status terbuka, order untuk lainnya
  outstandingTon: number;       // Belum dikirim + Terkirim sebagian (sisa)
  byMonth: Record<string, { orders: number; outstanding: number }>;
  /** Tidak ada order yang belum dikirim/direject: kemungkinan file raw sell in menurut tanggal pengiriman. */
  looksDelivered: boolean;
  dateOrder?: DateOrderInfo;
}
export interface PoParseResult { ok: boolean; error?: string; missing?: string[]; rows: PoRow[]; stats: PoStats }

const low = (v: unknown) => String(v ?? '').trim().toLowerCase();
const code = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? String(v) : String(v ?? '').trim());
const OPEN = new Set<PoStatus>(['Belum dikirim', 'Terkirim sebagian']);

export class PoCollector implements RowCollector<PoParseResult> {
  rows: PoRow[] = [];
  stats: PoStats = {
    rowsRead: 0, rowsUsed: 0, skippedTokoProject: 0, skippedOther: 0, skippedMortar: 0, invalid: 0, issues: [],
    dateFrom: null, dateTo: null, posisi: null, orders: 0, byStatus: {}, outstandingTon: 0, byMonth: {}, looksDelivered: false,
  };
  private cols: number[] = [];
  private missing: string[] = [];
  private dates = new DateOrderDetector();
  private recheck: [number, number, string][] = [];
  constructor(private order?: DateOrder | null) {}

  header(cells: unknown[]) {
    const idx = new Map<string, number>();
    cells.forEach((h, i) => { const k = normHeader(h); if (k && !idx.has(k)) idx.set(k, i); });
    this.cols = COLS.map(c => idx.get(normHeader(c.header)) ?? -1);
    this.missing = COLS.filter((c, i) => 'required' in c && c.required && this.cols[i] < 0).map(c => c.header);
    return this.missing.length === 0;
  }

  push(cells: unknown[], rowNumber: number) {
    if (this.missing.length || !this.cols.length) return;
    const get = (k: Key) => { const i = this.cols[F[k]]; return i >= 0 ? cells[i] : null; };
    if (get('distributor') == null && get('order_no') == null && get('tanggal_order') == null) return;
    const st = this.stats;
    st.rowsRead++;
    this.dates.note(get('tanggal_order'));

    const tipe = get('tipe_pesanan');
    if (!passesRule(tipe, get('distributor'), get('asal_pengiriman'))) {
      const t = low(tipe);
      if (t === 'toko' || t === 'project') st.skippedTokoProject++; else st.skippedOther++;
      return;
    }
    if (isMortar(get('tipe_produk'))) { st.skippedMortar++; return; }

    const tgl = toISODate(get('tanggal_order'));
    // baris pengiriman ke-2 dst. sebuah order sering mengosongkan Order Quantity: boleh kosong, diambil dari baris lain
    const qty = get('order_qty') == null ? null : toNumber(get('order_qty'));
    const dq = get('delivery_qty') == null ? 0 : toNumber(get('delivery_qty'));
    let reason = '';
    if (!tgl) reason = `Tanggal Order tidak terbaca ("${String(get('tanggal_order') ?? '')}")`;
    else if ((qty == null && get('order_qty') != null) || (qty != null && qty < 0)) reason = `Order Quantity tidak valid ("${String(get('order_qty') ?? '')}")`;
    else if (dq == null || dq < 0) reason = `Delivery Quantity tidak valid ("${String(get('delivery_qty') ?? '')}")`;
    else if (!code(get('order_no'))) reason = 'Order No kosong';
    else if (!code(get('kode_customer'))) reason = 'Kode Customer kosong';
    else if (!String(get('status_order') ?? '').trim()) reason = 'Status Order kosong';
    if (reason) {
      st.invalid++;
      if (st.issues.length < 20) st.issues.push({ row: rowNumber, reason });
      return;
    }

    const out: PoRow = COLS.map((c, i) => {
      const src = this.cols[i];
      const v = src >= 0 ? cells[src] : null;
      if (v == null) return null;
      if ('kind' in c && c.kind === 'date') {
        if (isAmbiguousDate(v)) this.recheck.push([this.rows.length, i, String(v)]);
        return toISODate(v);
      }
      if ('kind' in c && c.kind === 'number') return toNumber(v);
      const s = code(v);
      return s === '' ? null : s;
    });
    out[F.tanggal_order] = tgl; out[F.order_qty] = qty; out[F.delivery_qty] = dq;
    this.rows.push(out);
    st.rowsUsed++;
  }

  result(): PoParseResult {
    const st = this.stats;
    if (this.missing.length) return { ok: false, error: 'Kolom wajib tidak ditemukan di baris judul.', missing: this.missing, rows: [], stats: st };
    if (!this.cols.length) return { ok: false, error: 'Baris judul tidak ditemukan.', rows: [], stats: st };
    const info = st.dateOrder = this.dates.decide(this.order);
    if (info.used === 'mdy') for (const [r, c, raw] of this.recheck) this.rows[r][c] = toISODate(raw, 'mdy');

    // ringkasan per order (sama dengan penggabungan di database)
    const orders = new Map<string, { tgl: string; qty: number; dq: number; status: PoStatus; kg: number }>();
    const rank = (s: PoStatus) => (s === 'Terkirim' ? 0 : s === 'Terkirim sebagian' ? 1 : 2);
    let posisi: string | null = null;
    for (const r of this.rows) {
      const tgl = String(r[F.tanggal_order]);
      if (!st.dateFrom || tgl < st.dateFrom) st.dateFrom = tgl;
      if (!st.dateTo || tgl > st.dateTo) st.dateTo = tgl;
      const kirim = r[F.tanggal_kirim] as string | null;
      if (kirim && (!posisi || kirim > posisi)) posisi = kirim;
      const k = `${r[F.distributor]}|${r[F.order_no]}|${r[F.tipe_produk]}`;
      const s = statusOf(r[F.status_order]);
      const o = orders.get(k);
      if (!o) orders.set(k, { tgl, qty: Number(r[F.order_qty] || 0), dq: Number(r[F.delivery_qty] || 0), status: s, kg: kgPerZak(r[F.tipe_produk]) });
      else {
        o.qty = Math.max(o.qty, Number(r[F.order_qty] || 0)); o.dq += Number(r[F.delivery_qty] || 0);
        if (rank(s) < rank(o.status)) o.status = s;
        if (tgl < o.tgl) o.tgl = tgl;
      }
    }
    st.posisi = posisi && st.dateTo && st.dateTo > posisi ? st.dateTo : posisi || st.dateTo;
    st.orders = orders.size;
    let open = 0, notDelivered = 0;
    orders.forEach(o => {
      const sisa = Math.max(o.qty - o.dq, 0) * o.kg / 1000;
      const isOpen = OPEN.has(o.status) || o.status === 'Belum diverifikasi';
      const ton = isOpen ? sisa : o.qty * o.kg / 1000;
      const b = st.byStatus[o.status] || (st.byStatus[o.status] = { orders: 0, ton: 0 });
      b.orders++; b.ton += ton;
      const m = st.byMonth[o.tgl.slice(0, 7)] || (st.byMonth[o.tgl.slice(0, 7)] = { orders: 0, outstanding: 0 });
      m.orders++;
      if (OPEN.has(o.status) && sisa > 0) { st.outstandingTon += sisa; m.outstanding += sisa; open++; }
      if (o.status === 'Belum dikirim' || o.status === 'Belum diverifikasi' || o.status === 'Reject') notDelivered++;
    });
    st.looksDelivered = orders.size > 0 && notDelivered === 0 && open <= Math.max(2, orders.size * 0.001);
    return { ok: true, rows: this.rows, stats: st };
  }
}
