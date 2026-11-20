/* ============================================================================
   Import harga Loco Net (Nazam Auto Task, bagian Harga Loco) untuk perkiraan nilai Outstanding DO.
   File CSV: satu baris = harga baris "LOCO GUDANG" di ERP Price & Promo Simulation untuk satu
   distributor x produk x masa berlaku (Effective Date s.d. Expired Date; Expired kosong = masih berlaku).
   Produk dicocokkan ke Outstanding DO lewat tipe semen (CMT = STR, RJW, CWC), berat per zak, dan OPC.
   Murni (tanpa DOM) supaya bisa jalan di Web Worker dan diuji di Node.
   Urutan kolom yang dikirim = urutan argumen sementrack.harga_loco_simpan.
============================================================================ */
import { normHeader, parseDelimited, toISODate, toNumber } from './sellin';

export type HargaRow = (string | number | null)[];
export interface HargaKombinasi {
  dist: string; produk: string; nama: string; semen: string; kg: number | null;
  masa: number; dari: string; sampai: string | null; hargaTerakhir: number; hargaMin: number; hargaMax: number;
}
export interface HargaStats {
  rowsRead: number; rowsUsed: number; skipped: number; invalid: number;
  issues: { row: number; reason: string }[];
  kombinasi: HargaKombinasi[];
  dists: string[];
  dari: string; sampai: string;
}
export interface HargaParseResult { ok: boolean; error?: string; missing?: string[]; rows: HargaRow[]; stats: HargaStats }

const COLS = [
  { key: 'dist', header: 'dist_code', alias: ['distributor', 'dist'], required: true },
  { key: 'code', header: 'product_code', alias: ['kodeproduk'], required: true },
  { key: 'name', header: 'product_name', alias: ['produk', 'namaproduk'], required: false },
  { key: 'wh', header: 'warehouse', alias: ['gudang'], required: false },
  { key: 'tipe', header: 'delivery_type', alias: ['deliverytype'], required: false },
  { key: 'price', header: 'price', alias: [], required: false },
  { key: 'net', header: 'net_price', alias: ['netprice', 'loconet'], required: true },
  { key: 'eff', header: 'effective_date', alias: ['effectivedate', 'berlakudari'], required: true },
  { key: 'exp', header: 'expired_date', alias: ['expireddate', 'berlakusampai'], required: false },
  { key: 'ambil', header: 'diambil', alias: ['tanggalsimulasi'], required: false },
] as const;
type Key = typeof COLS[number]['key'];

/** STR = CMT (Tiga Roda), RJW = Rajawali, CWC = white cement. */
export function semenProduk(code: string, name: string) {
  const c = code.toUpperCase(), n = name.toUpperCase();
  if (c.startsWith('RJW') || /RAJAWALI/.test(n)) return 'RJW';
  if (c.startsWith('CWC') || /WHITE|CWC/.test(n)) return 'CWC';
  return 'STR';
}
export const kgProduk = (name: string) => { const m = /(\d+(?:[.,]\d+)?)\s*KG/i.exec(name); return m ? Number(m[1].replace(',', '.')) : null; };

export function parseHargaText(text: string, fileName: string): HargaParseResult {
  const rows: HargaRow[] = [];
  const st: HargaStats = { rowsRead: 0, rowsUsed: 0, skipped: 0, invalid: 0, issues: [], kombinasi: [], dists: [], dari: '', sampai: '' };
  let idx: Partial<Record<Key, number>> | null = null;
  let missing: string[] = [];
  parseDelimited(text, (cells, line) => {
    if (!idx) {
      const h = cells.map(normHeader);
      const found: Partial<Record<Key, number>> = {};
      for (const c of COLS) {
        const i = h.findIndex(x => x === normHeader(c.header) || (c.alias as readonly string[]).includes(x));
        if (i >= 0) found[c.key] = i;
      }
      if (found.dist != null && found.net != null) { idx = found; missing = COLS.filter(c => c.required && found[c.key] == null).map(c => c.header); }
      return;
    }
    if (missing.length) return;
    if (cells.every(c => !String(c).trim())) return;
    st.rowsRead++;
    const get = (k: Key) => (idx![k] == null ? '' : String(cells[idx![k]!] ?? '').trim());
    const tipe = get('tipe');
    if (tipe && !/LOCO/i.test(tipe)) { st.skipped++; return; }
    const dist = get('dist').toUpperCase(), code = get('code').toUpperCase(), name = get('name');
    const net = toNumber(get('net')), price = toNumber(get('price'));
    const eff = toISODate(get('eff')), expRaw = get('exp'), exp = expRaw ? toISODate(expRaw) : null;
    const ambil = get('ambil') ? toISODate(get('ambil')) : null;
    const salah = !dist ? 'kode distributor kosong' : !code ? 'kode produk kosong' : net == null || net <= 0 ? 'Net Price kosong'
      : !eff ? 'Effective Date tidak terbaca' : expRaw && !exp ? 'Expired Date tidak terbaca' : exp && exp < eff ? 'Expired sebelum Effective' : '';
    if (salah) { st.invalid++; if (st.issues.length < 50) st.issues.push({ row: line, reason: salah }); return; }
    const semen = semenProduk(code, name), kg = kgProduk(name || code);
    rows.push([dist, code, name || null, semen, kg, /OPC/i.test(name) ? 1 : 0, get('wh').toUpperCase(), eff, exp, price, net, ambil]);
    st.rowsUsed++;
  });
  if (!idx) return { ok: false, error: `${fileName}: baris judul kolom harga (dist_code, product_code, net_price, effective_date) tidak ditemukan.`, missing: COLS.filter(c => c.required).map(c => c.header), rows: [], stats: st };
  if (missing.length) return { ok: false, error: `${fileName}: ada kolom wajib yang tidak ditemukan.`, missing, rows: [], stats: st };
  return { ok: true, rows, stats: ringkas(rows, st) };
}

function ringkas(rows: HargaRow[], st: HargaStats): HargaStats {
  const by = new Map<string, HargaRow[]>();
  rows.forEach(r => { const k = `${r[0]}|${r[1]}`; (by.get(k) || by.set(k, []).get(k)!).push(r); });
  st.kombinasi = [...by.values()].map(rs => {
    rs.sort((a, b) => String(a[7]).localeCompare(String(b[7])));
    const last = rs[rs.length - 1], hs = rs.map(r => Number(r[10]));
    return {
      dist: String(last[0]), produk: String(last[1]), nama: String(last[2] ?? ''), semen: String(last[3]), kg: last[4] as number | null,
      masa: new Set(rs.map(r => r[7])).size, dari: String(rs[0][7]), sampai: (last[8] as string | null) ?? null,
      hargaTerakhir: Number(last[10]), hargaMin: Math.min(...hs), hargaMax: Math.max(...hs),
    };
  }).sort((a, b) => a.dist.localeCompare(b.dist) || a.produk.localeCompare(b.produk));
  st.dists = [...new Set(rows.map(r => String(r[0])))].sort();
  const dari = rows.map(r => String(r[7])).sort(), sampai = rows.map(r => String(r[8] ?? r[11] ?? r[7])).sort();
  st.dari = dari[0] || ''; st.sampai = sampai[sampai.length - 1] || '';
  return st;
}

/** Beberapa file sekaligus digabung jadi satu pratinjau. */
export function gabungHarga(list: HargaParseResult[]): HargaParseResult {
  const rows = list.flatMap(r => r.rows);
  const st: HargaStats = {
    rowsRead: list.reduce((a, r) => a + r.stats.rowsRead, 0), rowsUsed: rows.length, skipped: list.reduce((a, r) => a + r.stats.skipped, 0),
    invalid: list.reduce((a, r) => a + r.stats.invalid, 0), issues: list.flatMap(r => r.stats.issues).slice(0, 50), kombinasi: [], dists: [], dari: '', sampai: '',
  };
  return { ok: true, rows, stats: ringkas(rows, st) };
}
