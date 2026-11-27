/* ============================================================================
   Import job ERP J078 (DO PROMO DETAIL, .TXT dipisah |) untuk halaman Efektivitas Ongkos & Promo.
   Urutan baris J078: baris produk DO (Product terisi), lalu baris-baris promonya (Product kosong):
     Promo Type 01 / 01B / kosong : potongan langsung per zak (Diskon per zak, Total Diskon = Rp)
     CBV + nama voucher           : cash back voucher diberikan (kolom Diskon = Rp)
     CBV + nomor VOxxxx           : voucher lama dipakai di DO ini (bukan biaya baru)
   Angka memakai titik desimal (520.000 = 520). Urutan kolom yang dikirim = urutan argumen sementrack.promo_simpan.
============================================================================ */
import { normHeader } from './sellin';
import { ordbTanggal } from './ordbImport';
import { angkaTitik } from './logistikImport';

export type PromoRow = (string | number | null)[];
export const JENIS_PROMO: Record<string, string> = { produk: 'Baris produk', potongan: 'Potongan langsung', voucher: 'Cash back voucher', pakai_voucher: 'Pemakaian voucher' };
export interface PromoStats {
  rowsRead: number; rowsUsed: number; invalid: number; issues: { row: number; reason: string }[];
  dist: string[]; dari: string | null; sampai: string | null; jumlahDo: number; nilaiProduk: number;
  jenis: { jenis: string; baris: number; nilai: number }[];
  promo: { promo: string; jenis: string; doN: number; nilai: number }[];
}
export interface PromoParseResult { ok: boolean; error?: string; missing?: string[]; rows: PromoRow[]; stats: PromoStats }

const WAJIB = ['Distributor', 'DO No.', 'DO Date', 'Product', 'Promo Type', 'Keterangan Promo', 'Diskon', 'Total Diskon'];
const txt = (v: unknown) => String(v ?? '').trim();
const statsKosong = (): PromoStats => ({ rowsRead: 0, rowsUsed: 0, invalid: 0, issues: [], dist: [], dari: null, sampai: null, jumlahDo: 0, nilaiProduk: 0, jenis: [], promo: [] });

export function parsePromoSheet(aoa: unknown[][]): PromoParseResult {
  const stats = statsKosong();
  const fail = (error: string, missing?: string[]): PromoParseResult => ({ ok: false, error, missing, rows: [], stats });
  const headerAt = aoa.slice(0, 10).findIndex(r => (r || []).some(c => normHeader(c) === normHeader('Keterangan Promo')));
  if (headerAt < 0) return fail('Baris judul J078 (Distributor, DO No., Product, Promo Type, Keterangan Promo, …) tidak ditemukan.');
  const idx = new Map<string, number>();
  (aoa[headerAt] || []).forEach((h, i) => { const k = normHeader(h); if (k && !idx.has(k)) idx.set(k, i); });
  const missing = WAJIB.filter(h => !idx.has(normHeader(h)));
  if (missing.length) return fail('Kolom wajib tidak ditemukan di baris judul.', missing);
  const rows: PromoRow[] = [];
  const dists = new Set<string>(), dos = new Set<string>();
  const jm = new Map<string, PromoStats['jenis'][number]>(), pm = new Map<string, { promo: string; jenis: string; dos: Set<string>; nilai: number }>();
  let induk: { doNo: string; code: string | null; name: string | null; qty: number } | null = null;
  for (let r = headerAt + 1; r < aoa.length; r++) {
    const c = aoa[r] || [];
    const g = (h: string) => { const i = idx.get(normHeader(h)); return i == null ? null : c[i]; };
    const doNo = txt(g('DO No.'));
    if (!doNo) continue;
    stats.rowsRead++;
    const bad = (reason: string) => { stats.invalid++; if (stats.issues.length < 20) stats.issues.push({ row: r + 1, reason }); };
    const dist = /^([0-9A-Z]{3,8})\s*-/i.exec(txt(g('Distributor')))?.[1]?.toUpperCase();
    const tgl = ordbTanggal(g('DO Date'));
    if (!dist || !tgl) { bad('Distributor / DO Date tidak terbaca'); continue; }
    if (tgl < '2026-01-01') { bad('Sebelum 2026'); continue; }
    const prod = txt(g('Product')), tipe = txt(g('Promo Type')).toUpperCase(), ket = txt(g('Keterangan Promo'));
    const n = (h: string) => angkaTitik(g(h));
    const custRaw = txt(g('Customer')), custCode = txt(g('Parent Code')) || /\(([^()]+)\)\s*$/.exec(custRaw)?.[1] || null;
    let jenis: string, code: string | null, name: string | null, qty: number | null, nilai: number | null;
    if (prod) {
      const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(prod);
      code = m ? m[2].toUpperCase() : null; name = m ? m[1] : prod;
      qty = n('Product Qty') ?? n('Order Qty') ?? 0;
      induk = { doNo, code, name, qty };
      jenis = 'produk';
      nilai = qty * (n('Product Price') ?? 0);
      stats.nilaiProduk += nilai;
    } else {
      const ik = induk && induk.doNo === doNo ? induk : null;      // promo ikut produk di atasnya pada DO yang sama
      code = ik?.code ?? null; name = ik?.name ?? null;
      if (tipe === 'CBV') {
        jenis = /^VO\d+/i.test(ket) ? 'pakai_voucher' : 'voucher';
        qty = ik?.qty ?? null;
        nilai = n('Diskon');
      } else {
        jenis = 'potongan';
        qty = n('Qty Diskon') || ik?.qty || null;
        nilai = n('Total Diskon') || ((n('Diskon') ?? 0) * (qty ?? 0)) || 0;
      }
    }
    rows.push([dist, doNo, tgl, txt(g('Retail/Proyek')) || null, custCode, custRaw.replace(/\s*\([^()]+\)\s*$/, '') || null, txt(g('Cust TIRO Code')) || null,
      code, name, n('Row Number'), jenis, tipe || null, ket || null, qty, prod ? n('Product Price') : null, n('Diskon'), nilai,
      prod ? n('Promo Amount') : null, prod ? n('Net Amount') : null]);
    stats.rowsUsed++;
    dists.add(dist); dos.add(`${dist}|${doNo}`);
    if (!stats.dari || tgl < stats.dari) stats.dari = tgl;
    if (!stats.sampai || tgl > stats.sampai) stats.sampai = tgl;
    const j = jm.get(jenis) || { jenis, baris: 0, nilai: 0 }; j.baris++; if (jenis !== 'produk') j.nilai += nilai ?? 0; jm.set(jenis, j);
    if (jenis === 'potongan' || jenis === 'voucher') {
      const k = `${jenis}|${ket}`;
      const p = pm.get(k) || { promo: ket || '(tanpa nama)', jenis, dos: new Set<string>(), nilai: 0 }; p.dos.add(doNo); p.nilai += nilai ?? 0; pm.set(k, p);
    }
  }
  stats.dist = [...dists].sort();
  stats.jumlahDo = dos.size;
  stats.jenis = [...jm.values()];
  stats.promo = [...pm.values()].map(p => ({ promo: p.promo, jenis: p.jenis, doN: p.dos.size, nilai: p.nilai })).sort((a, b) => b.nilai - a.nilai);
  return { ok: true, rows, stats };
}

export function gabungPromo(list: PromoParseResult[]): PromoParseResult {
  const bad = list.find(r => !r.ok);
  if (bad) return bad;
  if (list.length === 1) return list[0];
  const st = statsKosong(), rows: PromoRow[] = [];
  const jm = new Map<string, PromoStats['jenis'][number]>(), pm = new Map<string, PromoStats['promo'][number]>(), ds = new Set<string>();
  for (const r of list) {
    rows.push(...r.rows);
    const s = r.stats;
    st.rowsRead += s.rowsRead; st.rowsUsed += s.rowsUsed; st.invalid += s.invalid; st.issues.push(...s.issues.slice(0, Math.max(0, 20 - st.issues.length)));
    st.jumlahDo += s.jumlahDo; st.nilaiProduk += s.nilaiProduk; s.dist.forEach(d => ds.add(d));
    if (s.dari && (!st.dari || s.dari < st.dari)) st.dari = s.dari;
    if (s.sampai && (!st.sampai || s.sampai > st.sampai)) st.sampai = s.sampai;
    s.jenis.forEach(j => { const x = jm.get(j.jenis) || { jenis: j.jenis, baris: 0, nilai: 0 }; x.baris += j.baris; x.nilai += j.nilai; jm.set(j.jenis, x); });
    s.promo.forEach(p => { const k = `${p.jenis}|${p.promo}`; const x = pm.get(k) || { ...p, doN: 0, nilai: 0 }; x.doN += p.doN; x.nilai += p.nilai; pm.set(k, x); });
  }
  st.dist = [...ds].sort(); st.jenis = [...jm.values()]; st.promo = [...pm.values()].sort((a, b) => b.nilai - a.nilai);
  return { ok: true, rows, stats: st };
}
