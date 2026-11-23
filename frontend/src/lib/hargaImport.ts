/* ============================================================================
   Import harga ERP (Nazam Auto Task, bagian Harga ERP).
   File CSV: satu baris = satu baris tabel Basic and Additional Price di ERP Price & Promo Simulation untuk
   distributor x produk x tipe kirim x zona x gudang x masa berlaku (Effective Date s.d. Expired Date; kosong = masih berlaku).
   LOCO GUDANG = harga ambil sendiri (perkiraan nilai Outstanding DO); tipe lain (FRANCO ..., LOCO KAPAL ...) = tarif kirim
   per zona: ongkir = Net Price - (Price - Discount), dipakai halaman Ongkos Kirim. File lama tanpa kolom tipe = LOCO GUDANG.
   Produk dicocokkan ke Outstanding DO lewat tipe semen (CMT = STR, RJW, CWC), berat per zak, dan OPC.
   Murni (tanpa DOM) supaya bisa jalan di Web Worker dan diuji di Node.
   Urutan kolom yang dikirim = urutan argumen sementrack.harga_loco_simpan.
============================================================================ */
import { normHeader, parseDelimited, toISODate, toNumber } from './sellin';

export type HargaRow = (string | number | null)[];
export interface HargaKombinasi {
  dist: string; produk: string; gudang: string; nama: string; semen: string; kg: number | null;
  masa: number; dari: string; sampai: string | null; hargaTerakhir: number; hargaMin: number; hargaMax: number;
}
export interface HargaTarif { dist: string; tipe: string; zona: number; baris: number; ongkirMin: number; ongkirMax: number }
export interface HargaStats {
  rowsRead: number; rowsUsed: number; skipped: number; invalid: number; loco: number; tarif: HargaTarif[];
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
  { key: 'zone', header: 'zone', alias: ['zona'], required: false },
  { key: 'disc', header: 'discount', alias: [], required: false },
  { key: 'tr', header: 'transport', alias: [], required: false },
  { key: 'sub', header: 'subsidi', alias: [], required: false },
  { key: 'hand', header: 'handling', alias: [], required: false },
  { key: 'sub2', header: 'subsidi2', alias: [], required: false },
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
  const st: HargaStats = { rowsRead: 0, rowsUsed: 0, skipped: 0, invalid: 0, loco: 0, tarif: [], issues: [], kombinasi: [], dists: [], dari: '', sampai: '' };
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
    const tipe = get('tipe').replace(/\s+/g, ' ').toUpperCase() || 'LOCO GUDANG';
    const dist = get('dist').toUpperCase(), code = get('code').toUpperCase(), name = get('name');
    const net = toNumber(get('net')), price = toNumber(get('price'));
    const eff = toISODate(get('eff')), expRaw = get('exp'), exp = expRaw ? toISODate(expRaw) : null;
    const ambil = get('ambil') ? toISODate(get('ambil')) : null;
    const salah = !dist ? 'kode distributor kosong' : !code ? 'kode produk kosong' : net == null || net <= 0 ? 'Net Price kosong'
      : !eff ? 'Effective Date tidak terbaca' : expRaw && !exp ? 'Expired Date tidak terbaca' : exp && exp < eff ? 'Expired sebelum Effective' : '';
    if (salah) { st.invalid++; if (st.issues.length < 50) st.issues.push({ row: line, reason: salah }); return; }
    const semen = semenProduk(code, name), kg = kgProduk(name || code);
    const n = (k: Key) => (get(k) === '' ? null : toNumber(get(k)));
    rows.push([dist, code, name || null, semen, kg, /OPC/i.test(name) ? 1 : 0, get('wh').toUpperCase(), eff, exp, price, net, ambil,
      tipe, get('zone').replace(/\s+/g, ' ').toUpperCase(), n('disc'), n('tr'), n('sub'), n('hand'), n('sub2')]);
    st.rowsUsed++;
  });
  if (!idx) return { ok: false, error: `${fileName}: baris judul kolom harga (dist_code, product_code, net_price, effective_date) tidak ditemukan.`, missing: COLS.filter(c => c.required).map(c => c.header), rows: [], stats: st };
  if (missing.length) return { ok: false, error: `${fileName}: ada kolom wajib yang tidak ditemukan.`, missing, rows: [], stats: st };
  return { ok: true, rows, stats: ringkas(rows, st) };
}

const isLoco = (r: HargaRow) => (r[12] ?? 'LOCO GUDANG') === 'LOCO GUDANG';
/** Ongkir per zak baris tarif: Net Price - (Price - Discount); tanpa Price: jumlah komponen. */
export const ongkirBaris = (r: HargaRow) => (r[9] != null ? Number(r[10]) - (Number(r[9]) - Number(r[14] ?? 0))
  : [15, 16, 17, 18].reduce((a, i) => a + Number(r[i] ?? 0), 0));

function ringkas(rows: HargaRow[], st: HargaStats): HargaStats {
  const by = new Map<string, HargaRow[]>();
  rows.filter(isLoco).forEach(r => { const k = `${r[0]}|${r[1]}|${r[6]}`; (by.get(k) || by.set(k, []).get(k)!).push(r); });
  st.loco = rows.filter(isLoco).length;
  const tb = new Map<string, { zona: Set<string>; baris: number; o: number[] }>();
  rows.filter(r => !isLoco(r)).forEach(r => {
    const k = `${r[0]}|${r[12]}`, x = tb.get(k) || tb.set(k, { zona: new Set(), baris: 0, o: [] }).get(k)!;
    x.zona.add(String(r[13] ?? '')); x.baris++; x.o.push(ongkirBaris(r));
  });
  st.tarif = [...tb.entries()].map(([k, x]) => ({ dist: k.split('|')[0], tipe: k.split('|')[1], zona: x.zona.size, baris: x.baris, ongkirMin: Math.min(...x.o), ongkirMax: Math.max(...x.o) }))
    .sort((a, b) => a.dist.localeCompare(b.dist) || a.tipe.localeCompare(b.tipe));
  st.kombinasi = [...by.values()].map(rs => {
    rs.sort((a, b) => String(a[7]).localeCompare(String(b[7])));
    const last = rs[rs.length - 1], hs = rs.map(r => Number(r[10]));
    return {
      dist: String(last[0]), produk: String(last[1]), gudang: String(last[6] ?? ''), nama: String(last[2] ?? ''), semen: String(last[3]), kg: last[4] as number | null,
      masa: new Set(rs.map(r => r[7])).size, dari: String(rs[0][7]), sampai: (last[8] as string | null) ?? null,
      hargaTerakhir: Number(last[10]), hargaMin: Math.min(...hs), hargaMax: Math.max(...hs),
    };
  }).sort((a, b) => a.dist.localeCompare(b.dist) || a.produk.localeCompare(b.produk) || a.gudang.localeCompare(b.gudang));
  st.dists = [...new Set(rows.map(r => String(r[0])))].sort();
  const dari = rows.map(r => String(r[7])).sort(), sampai = rows.map(r => String(r[8] ?? r[11] ?? r[7])).sort();
  st.dari = dari[0] || ''; st.sampai = sampai[sampai.length - 1] || '';
  return st;
}

/** Beberapa file sekaligus digabung jadi satu pratinjau. */
export function gabungHarga(list: HargaParseResult[]): HargaParseResult {
  const rows = list.flatMap(r => r.rows);
  const st: HargaStats = {
    rowsRead: list.reduce((a, r) => a + r.stats.rowsRead, 0), rowsUsed: rows.length, skipped: list.reduce((a, r) => a + r.stats.skipped, 0), loco: 0, tarif: [],
    invalid: list.reduce((a, r) => a + r.stats.invalid, 0), issues: list.flatMap(r => r.stats.issues).slice(0, 50), kombinasi: [], dists: [], dari: '', sampai: '',
  };
  return { ok: true, rows, stats: ringkas(rows, st) };
}
