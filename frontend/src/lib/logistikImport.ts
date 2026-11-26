/* ============================================================================
   Import rekap logistik distributor (format sama di semua distributor) untuk halaman Ongkos Kirim.
   Satu baris = satu produk di satu FOAD (perjalanan). Kolom: Daerah (kode distributor, mis. CBS), FOAD No., SOMType
   (GUDANG - TOKO (04), PELABUHAN - TOKO (06), GUDANG - GUDANG (02), PABRIK - GUDANG (01), PABRIK - TOKO (03)), DO No.,
   DO Date, Est. Delv. Date, SJ Date, Kirim, Product Code, Jumlah, Transporter Name, Zone Trans., Gudang Asal / Tujuan,
   Harga Perzak, Jml Harga, Tgl Terima SJ Toko / DoPlanner, KET DALAM/LUAR KOTA.
   Daerah dipetakan ke kode ERP di server (dbo.distributor). Ton di pratinjau = perkiraan (kode semen yang dikenal);
   server memakai kategori ORDB019.
   Murni (tanpa DOM) supaya bisa jalan di Web Worker dan diuji di Node.
   Urutan kolom yang dikirim = urutan argumen sementrack.logistik_simpan.
============================================================================ */
import { kgPerZak, normHeader, toNumber } from './sellin';
import { ordbTanggal } from './ordbImport';

export type LogistikRow = (string | number | null)[];
export const JALUR_LABEL: Record<string, string> = {
  gudang_toko: 'Gudang → toko', pelabuhan_toko: 'Pelabuhan → toko', gudang_gudang: 'Gudang → gudang', pabrik_gudang: 'Pabrik → gudang',
  pabrik_toko: 'Pabrik → toko', lain: 'Lainnya',
};
export interface LogistikStats {
  rowsRead: number;
  rowsUsed: number;
  invalid: number;
  issues: { row: number; reason: string }[];
  daerah: string[];
  dari: string | null;
  sampai: string | null;
  foad: number;
  ton: number;
  biaya: number;
  foadBiaya: number;
  jalur: { jalur: string; foad: number; ton: number; biaya: number; biayaSemen: number }[];
  bulan: { bulan: string; foad: number; ton: number; biaya: number }[];
  telat: { ton: number; tonEst: number };
}
export interface LogistikParseResult { ok: boolean; error?: string; missing?: string[]; rows: LogistikRow[]; stats: LogistikStats }

const COLS = [
  { key: 'daerah', header: 'Daerah', required: true },
  { key: 'tgl_order', header: 'TANGGAL ORDER' },
  { key: 'foad', header: 'FOAD No.', required: true },
  { key: 'som_type', header: 'SOMType', required: true },
  { key: 'som_date', header: 'SOM Date' },
  { key: 'do_no', header: 'DO No.' },
  { key: 'do_date', header: 'DO Date' },
  { key: 'est', header: 'Est. Delv. Date' },
  { key: 'sj_no', header: 'SJ No.' },
  { key: 'sj_date', header: 'SJ Date', required: true },
  { key: 'salesman', header: 'Salesman Name' },
  { key: 'status', header: 'Status SOM - SJ' },
  { key: 'cust_code', header: 'Cust. Code' },
  { key: 'cust_name', header: 'Cust. Name' },
  { key: 'product_code', header: 'Product Code', required: true },
  { key: 'product_name', header: 'Product Name' },
  { key: 'qty', header: 'Jumlah', required: true },
  { key: 'transporter', header: 'Transporter Name' },
  { key: 'zona_kode', header: 'Zone Trans. Code' },
  { key: 'zona', header: 'Zone Trans. Name' },
  { key: 'plat', header: 'PLAT NO.' },
  { key: 'gudang_asal', header: 'Gudang Asal' },
  { key: 'gudang_tujuan', header: 'Gudang Tujuan' },
  { key: 'harga', header: 'Harga Perzak' },
  { key: 'jml_harga', header: 'Jml Harga', required: true },
  { key: 'kirim', header: 'Kirim' },
  { key: 'terima_toko', header: 'Tgl Terima SJ Toko' },
  { key: 'terima_planner', header: 'Tgl Terima SJ DoPlanner' },
  { key: 'sj_terminal', header: 'Tgl. SJ Terminal' },
  { key: 'dalam_luar', header: 'KET DALAM/LUAR KOTA' },
] as const;
type Key = (typeof COLS)[number]['key'];

const txt = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? String(v) : String(v ?? '').trim());
const isi = (v: unknown) => { const s = txt(v); return s && s !== '-' ? s : null; };
/** Perkiraan untuk pratinjau saja (server memakai kategori ORDB019): semen Tiga Roda / Rajawali / white cement. */
const semenKira = (code: string) => /^(CMT|RJW|CWC)\d/i.test(code);

export function jalurDari(som: string): string {
  const s = som.toUpperCase();
  if (/GUDANG\s*-\s*TOKO/.test(s)) return 'gudang_toko';
  if (/PELABUHAN\s*-\s*TOKO/.test(s)) return 'pelabuhan_toko';
  if (/GUDANG\s*-\s*GUDANG/.test(s)) return 'gudang_gudang';
  if (/PABRIK\s*-\s*GUDANG/.test(s)) return 'pabrik_gudang';
  if (/PABRIK\s*-\s*TOKO/.test(s)) return 'pabrik_toko';
  return 'lain';
}

/** Satu sheet rekap (array of arrays, nilai mentah) → baris untuk logistik_simpan. */
export function parseLogistikSheet(aoa: unknown[][]): LogistikParseResult {
  const stats: LogistikStats = { rowsRead: 0, rowsUsed: 0, invalid: 0, issues: [], daerah: [], dari: null, sampai: null, foad: 0, ton: 0, biaya: 0, foadBiaya: 0, jalur: [], bulan: [], telat: { ton: 0, tonEst: 0 } };
  const fail = (error: string, missing?: string[]): LogistikParseResult => ({ ok: false, error, missing, rows: [], stats });
  let headerAt = -1;
  for (let r = 0; r < Math.min(aoa.length, 20); r++) {
    const h = new Set((aoa[r] || []).map(normHeader));
    if (h.has('foadno') && h.has('somtype')) { headerAt = r; break; }
  }
  if (headerAt < 0) return fail('Baris judul rekap logistik (Daerah, FOAD No., SOMType, …) tidak ditemukan.');
  const idx = new Map<string, number>();
  (aoa[headerAt] || []).forEach((h, i) => { const k = normHeader(h); if (k && !idx.has(k)) idx.set(k, i); });   // Daerah pertama = kode distributor
  const cols = COLS.map(c => idx.get(normHeader(c.header)) ?? -1);
  const missing = COLS.filter((c, i) => 'required' in c && c.required && cols[i] < 0).map(c => c.header);
  if (missing.length) return fail('Kolom wajib tidak ditemukan di baris judul.', missing);

  const rows: LogistikRow[] = [];
  const daerah = new Set<string>();
  const foad = new Map<string, { jalur: string; bulan: string; ton: number; biayaSemen: number; biaya: number }>();
  for (let r = headerAt + 1; r < aoa.length; r++) {
    const cells = aoa[r] || [];
    const get = (k: Key) => { const i = cols[COLS.findIndex(c => c.key === k)]; return i >= 0 ? cells[i] : null; };
    const foadNo = txt(get('foad')), dae = txt(get('daerah')).toUpperCase();
    if (!foadNo && !dae) continue;                                  // baris kosong / total
    stats.rowsRead++;
    const bad = (reason: string) => { stats.invalid++; if (stats.issues.length < 20) stats.issues.push({ row: r + 1, reason }); };
    if (!foadNo || !dae) { bad('Daerah / FOAD No. kosong'); continue; }
    const qty = toNumber(get('qty'));
    if (qty == null) { bad(`Jumlah bukan angka ("${txt(get('qty'))}")`); continue; }
    const sj = ordbTanggal(get('sj_date')), kirim = ordbTanggal(get('kirim')) || sj;
    // tanggal muat: SJ Date; angkutan antar gudang tanpa SJ memakai Tgl. SJ Terminal / SOM Date / Tanggal Order
    const tgl = sj || ordbTanggal(get('sj_terminal')) || ordbTanggal(get('som_date')) || ordbTanggal(get('tgl_order'));
    if (!tgl) { bad('Tanggal (SJ Date / SOM Date) tidak terbaca'); continue; }
    if (tgl < '2026-01-01') { bad('Sebelum 2026 (ongkos kirim dilacak mulai Januari 2026)'); continue; }
    const som = txt(get('som_type')), code = txt(get('product_code')).toUpperCase(), name = txt(get('product_name'));
    const jml = toNumber(get('jml_harga')), est = ordbTanggal(get('est')), doDate = ordbTanggal(get('do_date'));
    rows.push([dae, foadNo, som || null, tgl, isi(get('do_no')), doDate, est, isi(get('sj_no')), kirim, isi(get('salesman')), isi(get('status')),
      isi(get('cust_code')), isi(get('cust_name')), code || null, name || null, qty, isi(get('transporter')), isi(get('zona_kode')), isi(get('zona')),
      isi(get('plat')), isi(get('gudang_asal')), isi(get('gudang_tujuan')), toNumber(get('harga')), jml,
      ordbTanggal(get('terima_toko')), ordbTanggal(get('terima_planner')), isi(get('dalam_luar'))]);
    stats.rowsUsed++;
    daerah.add(dae);
    if (!stats.dari || tgl < stats.dari) stats.dari = tgl;
    if (!stats.sampai || tgl > stats.sampai) stats.sampai = tgl;
    const ton = semenKira(code) ? qty * kgPerZak(name) / 1000 : 0;
    if (ton > 0 && est && kirim) { stats.telat.tonEst += ton; if (kirim > est) stats.telat.ton += ton; }
    const k = `${dae}|${foadNo}`;
    const f = foad.get(k) || { jalur: jalurDari(som), bulan: tgl.slice(0, 7), ton: 0, biayaSemen: 0, biaya: 0 };
    f.ton += ton; f.biaya += jml ?? 0; if (ton > 0) f.biayaSemen += jml ?? 0; if (tgl.slice(0, 7) < f.bulan) f.bulan = tgl.slice(0, 7);
    foad.set(k, f);
  }
  if (!rows.length) return { ok: true, rows, stats };
  const jm = new Map<string, LogistikStats['jalur'][number]>(), bm = new Map<string, LogistikStats['bulan'][number]>();
  for (const f of foad.values()) {
    const biaya = f.biayaSemen > 0 ? f.biayaSemen : f.biaya;     // sama dengan v_logistik_foad
    stats.foad++; stats.ton += f.ton; stats.biaya += biaya; if (biaya > 0) stats.foadBiaya++;
    const j = jm.get(f.jalur) || { jalur: f.jalur, foad: 0, ton: 0, biaya: 0, biayaSemen: 0 }; j.foad++; j.ton += f.ton; j.biaya += biaya; if (f.ton > 0) j.biayaSemen += biaya; jm.set(f.jalur, j);
    const b = bm.get(f.bulan) || { bulan: f.bulan, foad: 0, ton: 0, biaya: 0 }; b.foad++; b.ton += f.ton; b.biaya += biaya; bm.set(f.bulan, b);
  }
  stats.daerah = [...daerah].sort();
  stats.jalur = [...jm.values()].sort((a, b) => b.foad - a.foad);
  stats.bulan = [...bm.values()].sort((a, b) => a.bulan.localeCompare(b.bulan));
  return { ok: true, rows, stats };
}

/** Beberapa file (mis. satu per distributor) digabung. */
export function gabungLogistik(list: LogistikParseResult[]): LogistikParseResult {
  const bad = list.find(r => !r.ok);
  if (bad) return bad;
  if (list.length === 1) return list[0];
  const st: LogistikStats = { rowsRead: 0, rowsUsed: 0, invalid: 0, issues: [], daerah: [], dari: null, sampai: null, foad: 0, ton: 0, biaya: 0, foadBiaya: 0, jalur: [], bulan: [], telat: { ton: 0, tonEst: 0 } };
  const jm = new Map<string, LogistikStats['jalur'][number]>(), bm = new Map<string, LogistikStats['bulan'][number]>(), dae = new Set<string>();
  const rows: LogistikRow[] = [];
  for (const r of list) {
    const s = r.stats;
    for (const d of s.daerah) {
      if (dae.has(d)) return { ...r, ok: false, error: `Daerah ${d} ada di dua file. Pilih satu file per distributor.`, rows: [] };
    }
    s.daerah.forEach(d => dae.add(d));
    rows.push(...r.rows);
    st.rowsRead += s.rowsRead; st.rowsUsed += s.rowsUsed; st.invalid += s.invalid;
    st.issues.push(...s.issues.slice(0, Math.max(0, 20 - st.issues.length)));
    st.foad += s.foad; st.ton += s.ton; st.biaya += s.biaya; st.foadBiaya += s.foadBiaya;
    st.telat.ton += s.telat.ton; st.telat.tonEst += s.telat.tonEst;
    if (s.dari && (!st.dari || s.dari < st.dari)) st.dari = s.dari;
    if (s.sampai && (!st.sampai || s.sampai > st.sampai)) st.sampai = s.sampai;
    for (const j of s.jalur) { const x = jm.get(j.jalur) || { jalur: j.jalur, foad: 0, ton: 0, biaya: 0, biayaSemen: 0 }; x.foad += j.foad; x.ton += j.ton; x.biaya += j.biaya; x.biayaSemen += j.biayaSemen; jm.set(j.jalur, x); }
    for (const b of s.bulan) { const x = bm.get(b.bulan) || { bulan: b.bulan, foad: 0, ton: 0, biaya: 0 }; x.foad += b.foad; x.ton += b.ton; x.biaya += b.biaya; bm.set(b.bulan, x); }
  }
  st.daerah = [...dae].sort();
  st.jalur = [...jm.values()].sort((a, b) => b.foad - a.foad);
  st.bulan = [...bm.values()].sort((a, b) => a.bulan.localeCompare(b.bulan));
  return { ok: true, rows, stats: st };
}
