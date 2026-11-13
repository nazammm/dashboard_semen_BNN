/* ============================================================================
   File mentah ERP J028 dan J028B (teks berpemisah "|"), langsung dari unduhan, tanpa diedit di Excel.
   Murni (tanpa DOM) supaya bisa jalan di Web Worker dan diuji di Node.

   - J028  : semua transaksi, distributor memakai kode ERP (1001K, 4094, ...). INSA dan INSA-E masih jadi satu.
   - J028B : hanya distributor yang punya "clone" (INSA), dengan kolom Distributor Code Clone dan
             Salesman Code Clone. Baris yang clone-nya terisi = INSA-E.
   Hasil gabungan: baris J028 untuk distributor yang TIDAK ada di J028B, ditambah semua baris J028B.

   Yang dikerjakan otomatis (dulu dikerjakan manual di Excel):
   - hanya Cust Group RETAIL yang dipakai (proyek, sub distributor, industri, relasi dilewati)
   - kode ERP distributor dicocokkan ke dist_code lewat nama distributor di master
   - baris clone memakai distributor "-E" dan kode salesman clone
   - kode customer tanpa nol di depan (007441 menjadi 7441), sama dengan data yang sudah tersimpan
   - angka dibaca dengan titik sebagai desimal ("100.000" = 100), tanda "-" = kosong
============================================================================ */
import { TRX_FIELDS, TransaksiCollector, type TrxParseResult } from './transaksiImport';
import type { DateOrder } from './sellin';

export interface DistMaster { dist_code: string; dist_name: string }
export interface RawInfo {
  files: { name: string; jenis: 'J028' | 'J028B'; baris: number }[];
  dilewati: Record<string, number>;          // Cust Group selain RETAIL -> jumlah baris
  pecah: Record<string, number>;             // dist_code hasil pemecahan J028B -> jumlah baris retail
}

const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Baris judul file mentah ERP: berpemisah "|" dan berisi "Distributor Code". */
export function isRawJ028(text: string) {
  const first = text.slice(0, 2000).split(/\r?\n/).find(l => l.trim() !== '') || '';
  return first.includes('|') && /distributor code/i.test(first) && /do no/i.test(first);
}

// nama kolom ERP (huruf kecil) -> kunci
const KOLOM: Record<string, string> = {
  'distributor code': 'kode', 'distributor code clone': 'kode_clone', 'distributor name': 'nama',
  'do date': 'do_date', 'do no.': 'do_no', 'mss no. order': 'mss_no_order', payment: 'payment',
  'customer code': 'customer_code', 'customer name': 'customer_name',
  'parent customer code': 'parent_customer_code', 'parent customer name': 'parent_customer_name',
  'cust group': 'cust_group', 'delivery type': 'delivery_type', 'product code': 'product_code', 'product name': 'product_name',
  'destinasi toko': 'destination', 'order qty': 'order_qty', 'bonus qty': 'bonus_qty', 'total qty': 'total_qty',
  tdnetamount: 'net_amount', tdsalesmancode: 'salesman_code', 'salesman code': 'salesman_code', 'salesman code clone': 'salesman_clone',
  salestim: 'sales_tim', 'pelunasan (hari)': 'pelunasan_hari',
};
const WAJIB = ['kode', 'nama', 'do_date', 'do_no', 'customer_code', 'cust_group', 'product_code', 'order_qty'];

type Baris = Record<string, string> & { __baris: string };
interface Berkas { name: string; jenis: 'J028' | 'J028B'; rows: Baris[] }

function baca(name: string, text: string): Berkas | { error: string } {
  const lines = text.split(/\r?\n/);
  let h = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].trim() !== '') { h = i; break; }
  if (h < 0) return { error: `${name}: file kosong.` };
  const judul = lines[h].split('|').map(lower);
  const idx: Record<string, number> = {};
  judul.forEach((j, i) => { const k = KOLOM[j]; if (k && !(k in idx)) idx[k] = i; });
  const kurang = WAJIB.filter(k => !(k in idx));
  if (kurang.length) return { error: `${name}: kolom tidak lengkap (${kurang.join(', ')}). Pastikan ini unduhan J028 atau J028B yang belum diubah.` };
  const rows: Baris[] = [];
  for (let i = h + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const c = lines[i].split('|');
    const r = { __baris: String(i + 1) } as Baris;
    for (const k in idx) r[k] = (c[idx[k]] ?? '').trim();
    rows.push(r);
  }
  return { name, jenis: 'kode_clone' in idx ? 'J028B' : 'J028', rows };
}

const tanpaNolDepan = (v: string) => (/^\d+$/.test(v) ? v.replace(/^0+(?=\d)/, '') : v);
const angka = (v: string): string | number | null => (v === '' || v === '-' ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);

/** Gabungkan satu atau dua file mentah menjadi hasil impor transaksi. */
export function gabungJ028(files: { name: string; text: string }[], master: DistMaster[], order?: DateOrder | null): TrxParseResult {
  const gagal = (error: string): TrxParseResult =>
    ({ ok: false, error, rows: [], stats: { rowsRead: 0, rowsUsed: 0, invalid: 0, issues: [], dateFrom: null, dateTo: null, perDist: {}, distNames: {} } });

  const berkas: Berkas[] = [];
  for (const f of files) {
    const b = baca(f.name, f.text);
    if ('error' in b) return gagal(b.error);
    berkas.push(b);
  }
  const a = berkas.filter(b => b.jenis === 'J028'), bb = berkas.filter(b => b.jenis === 'J028B');
  if (a.length > 1 || bb.length > 1) return gagal('Pilih paling banyak satu file J028 dan satu file J028B.');
  if (!master.length) return gagal('Daftar distributor belum termuat, jadi kode ERP tidak bisa dicocokkan. Muat ulang halaman lalu coba lagi.');

  const byNama = new Map(master.map(m => [norm(m.dist_name), m]));
  const cari = (nama: string, clone: boolean) => byNama.get(norm(nama) + (clone ? 'E' : ''));
  const retail = (r: Baris) => lower(r.cust_group) === 'retail';

  const j028 = a[0]?.rows ?? [], j028b = bb[0]?.rows ?? [];
  const kodePecah = new Set(j028b.map(r => r.kode));

  // distributor yang punya pasangan "-E" di master wajib dipecah lewat J028B
  if (!bb.length) {
    const perlu = [...new Set(j028.filter(r => retail(r) && cari(r.nama, true)).map(r => r.nama))];
    if (perlu.length) return gagal(`${perlu.join(', ')} harus dipecah dengan file J028B, tetapi file J028B belum dipilih. Pilih J028 dan J028B sekaligus.`);
  }
  // kedua file harus dari rentang tanggal yang sama: baris retail distributor yang dipecah harus sama banyak
  if (a.length && bb.length) {
    const hitung = (rows: Baris[]) => rows.filter(r => kodePecah.has(r.kode) && retail(r)).reduce((s, r) => ({ n: s.n + 1, q: s.q + (Number(r.order_qty) || 0) }), { n: 0, q: 0 });
    const x = hitung(j028), y = hitung(j028b);
    if (x.n !== y.n || Math.abs(x.q - y.q) > 0.001)
      return gagal(`Isi J028 dan J028B tidak sama untuk distributor yang dipecah: J028 ${x.n} baris (${x.q} zak), J028B ${y.n} baris (${y.q} zak). Unduh keduanya dengan rentang tanggal yang sama.`);
  }

  const pakai = [...j028.filter(r => !kodePecah.has(r.kode)), ...j028b];
  const info: RawInfo = { files: berkas.map(b => ({ name: b.name, jenis: b.jenis, baris: b.rows.length })), dilewati: {}, pecah: {} };
  const takDikenal = new Map<string, number>();
  const col = new TransaksiCollector(order);
  col.header(TRX_FIELDS.map(f => f.key));

  for (const r of pakai) {
    if (!retail(r)) { const g = r.cust_group || '(kosong)'; info.dilewati[g] = (info.dilewati[g] || 0) + 1; continue; }
    const clone = !!r.kode_clone;
    const d = cari(r.nama, clone);
    if (!d) { const k = `${clone ? r.kode_clone : r.kode} ${r.nama}${clone ? ' (clone)' : ''}`; takDikenal.set(k, (takDikenal.get(k) || 0) + 1); continue; }
    if (kodePecah.has(r.kode)) info.pecah[d.dist_code] = (info.pecah[d.dist_code] || 0) + 1;
    const v: Record<string, string | number | null> = {
      dist_code: d.dist_code, distributor_name: d.dist_name, do_date: r.do_date, do_no: r.do_no,
      mss_no_order: r.mss_no_order || null, payment: r.payment || null,
      customer_code: tanpaNolDepan(r.customer_code), customer_name: r.customer_name || null,
      parent_customer_code: r.parent_customer_code ? tanpaNolDepan(r.parent_customer_code) : null, parent_customer_name: r.parent_customer_name || null,
      cust_group: r.cust_group, delivery_type: r.delivery_type || null, product_code: r.product_code, product_name: r.product_name || null,
      destination: r.destination || null,
      order_qty: angka(r.order_qty), bonus_qty: angka(r.bonus_qty ?? ''), total_qty: angka(r.total_qty ?? ''), net_amount: angka(r.net_amount ?? ''),
      salesman_code: (clone && r.salesman_clone ? r.salesman_clone : r.salesman_code) || null,
      sales_tim: r.sales_tim || null, pelunasan_hari: angka(r.pelunasan_hari ?? ''),
    };
    col.push(TRX_FIELDS.map(f => v[f.key]), Number(r.__baris));
  }
  if (takDikenal.size)
    return gagal(`Distributor di file belum ada di master distributor (dicocokkan lewat nama): ${[...takDikenal].map(([k, n]) => `${k}, ${n} baris`).join('; ')}. Tambahkan atau samakan namanya di Kelola Data → Tabel → Distributor.`);

  const res = col.result();
  if (res.ok) { res.stats.rowsRead = pakai.length; res.stats.raw = info; }
  return res;
}
