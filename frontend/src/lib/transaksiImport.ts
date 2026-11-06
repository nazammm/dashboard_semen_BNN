/* ============================================================================
   Import Transaksi distributor (format template ada.csv, 22 kolom).
   Murni (tanpa DOM) supaya bisa jalan di Web Worker dan diuji di Node.
   Urutan kolom yang dikirim = urutan argumen sementrack.transaksi_stage.
============================================================================ */
import { DateOrderDetector, isAmbiguousDate, normHeader, toISODate, toNumber, type DateOrder, type DateOrderInfo, type RowCollector } from './sellin';

export const TRX_FIELDS = [
  { key: 'dist_code', required: true },
  { key: 'distributor_name' },
  { key: 'do_date', required: true, kind: 'date' },
  { key: 'do_no', required: true },
  { key: 'mss_no_order' },
  { key: 'payment' },
  { key: 'customer_code', required: true },
  { key: 'customer_name' },
  { key: 'parent_customer_code' },
  { key: 'parent_customer_name' },
  { key: 'cust_group' },
  { key: 'delivery_type' },
  { key: 'product_code', required: true },
  { key: 'product_name' },
  { key: 'destination' },
  { key: 'order_qty', required: true, kind: 'number' },
  { key: 'bonus_qty', kind: 'number' },
  { key: 'total_qty', kind: 'number' },
  { key: 'net_amount', kind: 'number' },
  { key: 'salesman_code' },
  { key: 'sales_tim' },
  { key: 'pelunasan_hari', kind: 'number' },
] as const;

export type TrxRow = (string | number | null)[];
export interface TrxDistStat { rows: number; dos: number; qty: number }
export interface TrxStats {
  rowsRead: number;
  rowsUsed: number;
  invalid: number;
  issues: { row: number; reason: string }[];
  dateFrom: string | null;
  dateTo: string | null;
  perDist: Record<string, TrxDistStat>;
  distNames: Record<string, string>;
  dateOrder?: DateOrderInfo;   // urutan tanggal yang dipakai (hari/bulan atau bulan/hari)
}
export interface TrxParseResult { ok: boolean; error?: string; missing?: string[]; rows: TrxRow[]; stats: TrxStats }

const I = Object.fromEntries(TRX_FIELDS.map((f, i) => [f.key, i])) as Record<(typeof TRX_FIELDS)[number]['key'], number>;
const EMPTY_NUM = /^\s*-?\s*$/;   // "" atau "-" = kosong (template memakai "-" untuk pelunasan_hari)

export class TransaksiCollector implements RowCollector<TrxParseResult> {
  rows: TrxRow[] = [];
  stats: TrxStats = { rowsRead: 0, rowsUsed: 0, invalid: 0, issues: [], dateFrom: null, dateTo: null, perDist: {}, distNames: {} };
  private cols: number[] = [];
  private missing: string[] = [];
  private ready = false;
  private dos = new Map<string, Set<string>>();
  private dates = new DateOrderDetector();
  private recheck: [number, string][] = [];   // [baris, teks] do_date yang bisa dibaca dua arah
  constructor(private order?: DateOrder | null) {}

  header(cells: unknown[]) {
    const idx = new Map<string, number>();
    cells.forEach((h, i) => { const k = normHeader(h); if (k && !idx.has(k)) idx.set(k, i); });
    this.cols = TRX_FIELDS.map(f => idx.get(normHeader(f.key)) ?? -1);
    this.missing = TRX_FIELDS.filter((f, i) => 'required' in f && f.required && this.cols[i] < 0).map(f => f.key);
    this.ready = this.missing.length === 0;
    return this.ready;
  }

  private bad(row: number, reason: string) {
    this.stats.invalid++;
    if (this.stats.issues.length < 20) this.stats.issues.push({ row, reason });
  }

  push(cells: unknown[], rowNumber: number) {
    if (!this.ready) return;
    const raw = this.cols.map(i => (i >= 0 ? cells[i] : null));
    if (raw.every(v => v == null || String(v).trim() === '')) return;   // baris kosong
    this.stats.rowsRead++;

    const out: TrxRow = [];
    for (let i = 0; i < TRX_FIELDS.length; i++) {
      const f = TRX_FIELDS[i], v = raw[i];
      if ('kind' in f && f.kind === 'date') {
        const d = toISODate(v);
        if (!d) { this.bad(rowNumber, `${f.key} tidak terbaca ("${String(v ?? '')}")`); return; }
        this.dates.note(v);
        if (isAmbiguousDate(v)) this.recheck.push([this.rows.length, String(v)]);
        out.push(d);
      } else if ('kind' in f && f.kind === 'number') {
        if (v == null || (typeof v === 'string' && EMPTY_NUM.test(v))) {
          if ('required' in f && f.required) { this.bad(rowNumber, `${f.key} kosong`); return; }
          out.push(null);
        } else {
          const n = toNumber(v);
          if (n == null) { this.bad(rowNumber, `${f.key} bukan angka ("${String(v)}"), mungkin kolom bergeser`); return; }
          out.push(n);
        }
      } else {
        const s = v == null ? '' : String(v).trim();
        if (!s && 'required' in f && f.required) { this.bad(rowNumber, `${f.key} kosong`); return; }
        out.push(s === '' ? null : s);
      }
    }
    this.rows.push(out);

    const st = this.stats, dist = String(out[I.dist_code]);
    st.rowsUsed++;
    const pd = st.perDist[dist] || (st.perDist[dist] = { rows: 0, dos: 0, qty: 0 });
    pd.rows++; pd.qty += Number(out[I.order_qty] || 0);
    const set = this.dos.get(dist) || new Set<string>(); this.dos.set(dist, set);
    set.add(String(out[I.do_no])); pd.dos = set.size;
    if (!(dist in st.distNames) && out[I.distributor_name]) st.distNames[dist] = String(out[I.distributor_name]);
  }

  result(): TrxParseResult {
    if (this.missing.length) return { ok: false, error: 'Kolom wajib tidak ditemukan di baris judul.', missing: this.missing, rows: [], stats: this.stats };
    if (!this.cols.length) return { ok: false, error: 'Baris judul tidak ditemukan.', rows: [], stats: this.stats };
    // urutan tanggal diputuskan dari seluruh kolom, lalu tanggal yang bisa dibaca dua arah dihitung ulang
    const st = this.stats, info = st.dateOrder = this.dates.decide(this.order);
    if (info.used === 'mdy') for (const [r, raw] of this.recheck) this.rows[r][I.do_date] = toISODate(raw, 'mdy');
    st.dateFrom = null; st.dateTo = null;
    for (const row of this.rows) {
      const d = String(row[I.do_date]);
      if (!st.dateFrom || d < st.dateFrom) st.dateFrom = d;
      if (!st.dateTo || d > st.dateTo) st.dateTo = d;
    }
    return { ok: true, rows: this.rows, stats: st };
  }
}
