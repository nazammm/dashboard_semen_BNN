/* ============================================================================
   Tanya Data · memahami pertanyaan sederhana berbahasa Indonesia TANPA model AI.
   Pertanyaan dipecah jadi: metrik, distributor / region, jenis semen, periode, dan bentuk jawaban
   (total, per bulan, per distributor, tertinggi / terendah, banding tahun lalu, top toko).
   Angka dihitung dari view yang sama dengan halaman lain, jadi selalu cocok dengan dashboard.
   Murni fungsi (tanpa React / fetch) supaya bisa diuji; pengambilan top toko disuntikkan lewat ctx.
============================================================================ */
import type { Row } from './types';
import { analisis } from './tanyaAnalisis';
import { jawabSales } from './tanyaSales';

export type Metrik = 'omzet' | 'tonase' | 'do' | 'ta' | 'sellin' | 'stok';
export type Dimensi = 'bulan' | 'dist' | 'jenis' | 'region' | null;
export type Jenis = 'STR' | 'RJW' | 'CWC';

export interface TanyaCtx {
  trx: Row[];            // v_penjualan_toko_bulanan (tanpa subdist): year, month, dist_code, product_code, total_qty, net_amount, num_do
  distM: Row[];          // v_penjualan_toko_dist_bulanan (tanpa subdist): dist_code, year, month, num_do
  allM: Row[];           // v_monthly_totals: year, month, num_do
  ta: Row[];             // v_toko_aktif_bulanan: dist_code ('*' = semua, toko unik), year, month, num_active_stores (tanpa subdist)
  dists: { code: string; name: string; wilayah: string }[];
  sellin: Row[] | null;  // v_sellin_bnn_daily (null = tidak punya akses)
  stok: Row[] | null;    // v_stock_harian (null = tidak punya akses / belum ada)
  sales: Row[] | null;   // v_salesman_performance (null = tidak punya akses Tim Sales)
  /** Semua toko terdaftar satu bulan (dashboard_toko_monthly_v2): zona, is_active, is_subdist, total_qty, last_transaction. */
  tokoBulan: (year: number, month: number, dist: string | null) => Promise<Row[]>;
  topToko: (dist: string | null, from: string, to: string, productCodes: string[] | null, limit: number) => Promise<Row[]>;
}

export interface Jawaban {
  ok: boolean;
  paham: string[];                 // "Saya memahami: ..." (ditampilkan supaya salah tangkap kelihatan)
  teks: string;                    // kalimat jawaban; **tebal** untuk angka kunci
  tabel?: { header: string[]; rows: (string | number)[][] };
  chart?: { labels: string[]; values: number[]; garis?: boolean; satuan: string };
  catatan: string[];
  link?: { to: string; label: string };
  saran?: string[];                // pertanyaan contoh yang mirip (kalau tidak dikenali)
}

export const BULAN = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const BLN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const POLA_BULAN: [RegExp, number][] = [
  [/\b(januari|jan)\b/, 1], [/\b(februari|pebruari|feb|peb)\b/, 2], [/\b(maret|mar)\b/, 3], [/\b(april|apr)\b/, 4],
  [/\b(mei|may)\b/, 5], [/\b(juni|jun)\b/, 6], [/\b(juli|jul)\b/, 7], [/\b(agustus|agu|ags|agt|aug)\b/, 8],
  [/\b(september|sept|sep)\b/, 9], [/\b(oktober|okt|oct)\b/, 10], [/\b(november|nopember|nov|nop)\b/, 11], [/\b(desember|des|dec)\b/, 12],
];
export const JENIS_LABEL: Record<Jenis, string> = { STR: 'Tiga Roda', RJW: 'Rajawali', CWC: 'Semen putih' };
export const METRIK_LABEL: Record<Metrik, string> = { omzet: 'Omzet', tonase: 'Tonase', do: 'Jumlah DO', ta: 'Toko aktif', sellin: 'Sell in', stok: 'Stok' };
export const jenisProduk = (code: unknown): Jenis => { const c = String(code ?? '').toUpperCase(); return c.startsWith('RJW') ? 'RJW' : c.startsWith('CWC') ? 'CWC' : 'STR'; };
const jenisNama = (nama: unknown): Jenis => { const c = String(nama ?? '').toUpperCase(); return /RAJAWALI|RJW/.test(c) ? 'RJW' : /\bWC\b|WHITE|PUTIH|CWC/.test(c) ? 'CWC' : 'STR'; };

export const nf = (n: number, d = 0) => n.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
export function rupiah(n: number) {
  const a = Math.abs(n);
  if (a >= 1e12) return `Rp${nf(n / 1e12, 2)} triliun`;
  if (a >= 1e9) return `Rp${nf(n / 1e9, 2)} miliar`;
  if (a >= 1e6) return `Rp${nf(n / 1e6, 1)} juta`;
  return `Rp${nf(n)}`;
}
export const tulis = (m: Metrik, v: number) =>
  m === 'omzet' ? rupiah(v) : m === 'tonase' || m === 'sellin' || m === 'stok' ? `${nf(v, v < 100 ? 1 : 0)} ton` : m === 'do' ? `${nf(v)} DO` : `${nf(v)} toko`;
export const persen = (a: number, b: number) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
export const tulisPersen = (p: number | null) => (p == null ? '–' : `${p > 0 ? '+' : ''}${nf(p, 1)}%`);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pad = (n: number) => String(n).padStart(2, '0');

export const CONTOH: { grup: string; items: string[] }[] = [
  { grup: 'Omzet & tonase', items: [
    'Bulan apa omzet tertinggi PKB?', 'Berapa tonase NSA bulan ini?', 'Distributor mana omzet tertinggi tahun ini?',
    'Tren tonase Rajawali PTK 2026', 'Omzet BMM Oktober dibanding tahun lalu', 'Bandingkan tonase PKB dan NSA',
  ] },
  { grup: 'Toko & DO', items: [
    'Toko aktif PM per bulan', 'Distributor mana toko aktif terbanyak bulan ini?', '10 toko terbesar PKB bulan ini', 'Jumlah DO INSA September',
  ] },
  { grup: 'Analisis', items: [
    'Daerah mana yang bisa dikembangkan PKB untuk menambah toko aktif?', 'Toko mana yang berhenti order di NSA?', 'Kenapa tonase PKB turun?',
    'Distributor mana yang perlu perhatian?', 'Bagaimana kinerja BMM bulan lalu?',
  ] },
  { grup: 'Salesman', items: ['Siapa salesman paling konsisten tahun ini?', 'Salesman omzet tertinggi PKB bulan ini', 'Salesman mana yang belum capai target?', 'Berapa jumlah salesman INSA?'] },
  { grup: 'Sell in & stok', items: ['Sell in Riau bulan ini', 'Region mana sell in tertinggi tahun ini?', 'Stok semen per region', 'Stok Rajawali Lampung'] },
];

/* ---------------- memahami pertanyaan ---------------- */
export interface Paham {
  q: string;   // pertanyaan yang sudah dinormalkan (huruf kecil, tanpa tanda baca)
  metrik: Metrik; metrikTersirat: boolean;
  dists: string[]; regions: string[]; jenis: Jenis | null;
  tahun: number; bulan: number[]; bulanDisebut: boolean; tahunDisebut: boolean;
  dimensi: Dimensi; urut: 'desc' | 'asc' | null; tren: boolean; yoy: boolean; topToko: number | null;
}

/** Padanan nama wilayah: kata di pertanyaan -> region sell in, region stok, dan wilayah distributor. */
const WILAYAH: { kata: string[]; sellin: string[]; stok: string[]; wil: RegExp }[] = [
  { kata: ['north sum', 'sumut', 'sumatera utara', 'medan'], sellin: ['Sumut'], stok: ['North Sum'], wil: /sumat\w* utara/i },
  { kata: ['west sum', 'sumbar', 'sumatera barat', 'padang'], sellin: ['Padang'], stok: ['West Sum'], wil: /sumat\w* barat/i },
  { kata: ['south sum', 'sumsel', 'sumatera selatan', 'palembang'], sellin: ['Sumsel'], stok: ['South Sum'], wil: /sumat\w* selatan/i },
  { kata: ['west kal', 'kalbar', 'kalimantan barat', 'pontianak', 'ketapang'], sellin: ['Kalbar-KTP', 'Kalbar-PTK'], stok: ['West Kal'], wil: /kalimantan barat/i },
  { kata: ['riau island', 'kepri', 'kepulauan riau', 'batam'], sellin: ['Kepri', 'Batam'], stok: ['Riau Island'], wil: /kepulauan riau|batam/i },
  { kata: ['riau', 'pekanbaru', 'dumai'], sellin: ['Pekanbaru', 'Dumai'], stok: ['Riau'], wil: /^riau$/i },
  { kata: ['babel', 'bangka belitung', 'bangka', 'belitung'], sellin: ['Bangka', 'Belitung'], stok: ['Babel'], wil: /bangka/i },
  { kata: ['bengkulu'], sellin: ['Bengkulu'], stok: ['Bengkulu'], wil: /bengkulu/i },
  { kata: ['jambi'], sellin: ['Jambi'], stok: ['Jambi'], wil: /jambi/i },
  { kata: ['lampung'], sellin: ['Lampung'], stok: ['Lampung'], wil: /lampung/i },
];

function pahami(tanya: string, ctx: TanyaCtx, akhir: { y: number; m: number }, regionList: { sellin: string[]; stok: string[] }): Paham {
  const q = ` ${tanya.toLowerCase().replace(/[?!.,;:()"']/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const ada = (re: RegExp) => re.test(q);

  // metrik
  let metrik: Metrik = 'omzet', tersirat = false;
  if (ada(/\bsto[ck]k?\b|persediaan/)) metrik = 'stok';
  else if (ada(/sell\s*-?\s*in\b|sellin|\btebus(an)?\b/)) metrik = 'sellin';
  else if (ada(/toko aktif|\bta\b|jumlah toko|toko yang (order|beli|belanja)|berapa toko/)) metrik = 'ta';
  else if (ada(/\bdo\b|jumlah transaksi|berapa transaksi|delivery order/)) metrik = 'do';
  else if (ada(/tonase|\bton\b|volume|kuantitas|\bqty\b|kuantiti/)) metrik = 'tonase';
  else if (ada(/om[sz]et|penjualan|amount|rupiah|pendapatan|revenue|\bsales\b|nilai/)) metrik = 'omzet';
  else tersirat = true;

  // distributor: kode (utuh), nama, wilayah
  const dists: string[] = [];
  let sisa = q;
  [...ctx.dists].sort((a, b) => b.code.length - a.code.length).forEach(d => {
    const re = new RegExp(`(?<![a-z0-9-])${esc(d.code.toLowerCase())}(?![a-z0-9-])`);
    const nama = d.name.toLowerCase().replace(/\b(pt|cv|tk)\b\.?/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (re.test(sisa)) { dists.push(d.code); sisa = sisa.replace(re, ' '); }
    else if (nama.length >= 8 && sisa.includes(nama)) { dists.push(d.code); sisa = sisa.replace(nama, ' '); }
  });
  // region (sell in / stok) dan wilayah distributor: nama persis dulu, lalu padanan (sumut = north sum = medan)
  const daftar = metrik === 'sellin' ? regionList.sellin : metrik === 'stok' ? regionList.stok : [];
  const regions: string[] = [];
  let qr = sisa;
  [...daftar].sort((a, b) => b.length - a.length).forEach(r => {
    const re = new RegExp(`(?<![a-z0-9])${esc(r.toLowerCase())}(?![a-z0-9-])`);
    if (re.test(qr)) { regions.push(r); qr = qr.replace(re, ' '); }
  });
  const kunci = WILAYAH.flatMap((g, gi) => g.kata.map(k => ({ k, gi }))).sort((a, b) => b.k.length - a.k.length);
  const grup = new Set<number>();
  kunci.forEach(({ k, gi }) => { const re = new RegExp(`\\b${esc(k)}\\b`); if (re.test(qr)) { grup.add(gi); qr = qr.replace(re, ' '); } });
  grup.forEach(gi => {
    const g = WILAYAH[gi];
    if (metrik === 'sellin' || metrik === 'stok') (metrik === 'sellin' ? g.sellin : g.stok).filter(r => daftar.includes(r) && !regions.includes(r)).forEach(r => regions.push(r));
    else if (!dists.length) ctx.dists.filter(d => g.wil.test(d.wilayah)).forEach(d => dists.push(d.code));   // wilayah -> distributor di wilayah itu
  });

  // jenis semen
  const jenis: Jenis | null = ada(/rajawali|\brjw\b/) ? 'RJW' : ada(/semen putih|\bputih\b|\bcwc\b|white|\bwc\b/) ? 'CWC' : ada(/tiga roda|\bstr\b|\btr\b|\bpcc\b/) ? 'STR' : null;

  // periode
  const banding = ada(/dibanding|banding|\bvs\b|versus|\byoy\b|naik|turun|tumbuh|growth|pertumbuhan|kenaikan|penurunan/);
  const thn = q.match(/\b(20\d{2})\b/);
  let tahun = akhir.y, tahunDisebut = false;
  if (thn) { tahun = Number(thn[1]); tahunDisebut = true; }
  else if (ada(/tahun lalu|tahun kemarin|tahun sebelumnya/) && !banding) { tahun = akhir.y - 1; tahunDisebut = true; }
  else if (ada(/tahun ini|tahun berjalan|\bytd\b/)) tahunDisebut = true;

  const temu: { m: number; i: number }[] = [];
  POLA_BULAN.forEach(([re, m]) => { const x = sisa.match(re); if (x && x.index != null) temu.push({ m, i: x.index }); });
  temu.sort((a, b) => a.i - b.i);
  let bulan: number[] = [], bulanDisebut = false;
  const maks = tahun === akhir.y ? akhir.m : 12;
  const kw = q.match(/(?:kuartal|kwartal|triwulan|\bq)\s*-?\s*([1-4])\b/), sm = q.match(/semester\s*-?\s*([12])\b/);
  if (ada(/bulan ini|bulan berjalan|bulan sekarang|\bmtd\b/)) { bulan = [akhir.m]; tahun = akhir.y; bulanDisebut = true; }
  else if (ada(/bulan lalu|bulan kemarin|bulan sebelumnya/)) { const d = akhir.m === 1 ? { y: akhir.y - 1, m: 12 } : { y: akhir.y, m: akhir.m - 1 }; bulan = [d.m]; tahun = d.y; bulanDisebut = true; }
  else if (kw) { const k = Number(kw[1]); bulan = [1, 2, 3].map(x => (k - 1) * 3 + x); bulanDisebut = true; }
  else if (sm) { bulan = Number(sm[1]) === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12]; bulanDisebut = true; }
  else if (temu.length >= 2 && /sampai|hingga|s\s?d\b|\bsd\b|-|–/.test(sisa.slice(temu[0].i, temu[1].i)) && temu[1].m > temu[0].m) {
    for (let m = temu[0].m; m <= temu[1].m; m++) bulan.push(m);
    bulanDisebut = true;
  } else if (temu.length) { bulan = [...new Set(temu.map(t => t.m))].sort((a, b) => a - b); bulanDisebut = true; }
  if (!bulan.length) for (let m = 1; m <= maks; m++) bulan.push(m);

  // bentuk jawaban
  const urut = ada(/tertinggi|terbesar|terbanyak|paling (tinggi|besar|banyak|bagus|laku)|terbaik|terlaris|\btop\b|maksimal/) ? 'desc' as const
    : ada(/terendah|terkecil|tersedikit|paling (rendah|kecil|sedikit|jelek)|terburuk|minimal/) ? 'asc' as const : null;
  const tren = ada(/\btren\b|\btrend\b|perkembangan|per bulan|perbulan|tiap bulan|setiap bulan|bulanan|grafik/);
  let dimensi: Dimensi = null;
  if (tren || ada(/bulan (apa|mana|berapa|ke berapa)|\bkapan\b/)) dimensi = 'bulan';
  else if (ada(/(distributor|dist|cabang) (apa|mana|siapa)|per (distributor|dist|cabang)|tiap (distributor|cabang)|\bsiapa\b|semua distributor/)) dimensi = 'dist';
  else if (ada(/(region|daerah|wilayah|area) (apa|mana)|per (region|daerah|wilayah)|tiap (region|daerah)/)) dimensi = metrik === 'sellin' || metrik === 'stok' ? 'region' : 'dist';
  else if (ada(/(produk|jenis|semen|merek|merk|brand) (apa|mana)|per (produk|jenis|merek)|tiap (produk|jenis)/)) dimensi = 'jenis';

  const t = q.match(/\btop\s*(\d{1,3})\b/) || q.match(/\b(\d{1,3})\s*(toko|customer|pelanggan)\b/);
  const topToko = metrik !== 'ta' && metrik !== 'sellin' && metrik !== 'stok' && ada(/\btoko\b|customer|pelanggan/) && (urut === 'desc' || !!t || ada(/toko (apa|mana|siapa)/))
    ? Math.min(Math.max(Number(t?.[1] || 10), 1), 50) : null;

  if (!dimensi && !topToko) {
    if (dists.length >= 2 || regions.length >= 2) dimensi = metrik === 'sellin' || metrik === 'stok' ? 'region' : 'dist';
    else if (bulanDisebut && bulan.length === 2 && temu.length === 2) dimensi = 'bulan';      // "september dan oktober"
    else if (urut) dimensi = metrik === 'stok' ? 'region' : metrik === 'sellin' ? (regions.length ? 'bulan' : 'region') : (dists.length === 1 ? 'bulan' : 'dist');
  }
  return { q, metrik, metrikTersirat: tersirat, dists: [...new Set(dists)], regions, jenis, tahun, bulan, bulanDisebut, tahunDisebut,
    dimensi, urut, tren, yoy: banding && dimensi !== 'dist' && dists.length < 2 || (banding && ada(/tahun lalu|\byoy\b|tahun sebelumnya/)), topToko };
}

/* ---------------- menghitung ---------------- */
const periodeLabel = (p: Paham) => {
  const b = p.bulan;
  const runtut = b.every((m, i) => i === 0 || m === b[i - 1] + 1);
  if (b.length === 1) return `${BULAN[b[0]]} ${p.tahun}`;
  if (runtut && b[0] === 1 && !p.bulanDisebut) return `Jan–${BLN[b[b.length - 1]]} ${p.tahun}`;
  return runtut ? `${BLN[b[0]]}–${BLN[b[b.length - 1]]} ${p.tahun}` : `${b.map(m => BLN[m]).join(', ')} ${p.tahun}`;
};

interface Baris { label: string; nilai: number; lalu?: number; urutan: number }

function susun(p: Paham, baris: Baris[], konteks: string, catatan: string[], paham: string[], link: Jawaban['link'], rata = false): Jawaban {
  const m = p.metrik, nama = METRIK_LABEL[m].toLowerCase();
  if (!baris.length || baris.every(b => !b.nilai && !b.lalu)) {
    return { ok: true, paham, teks: `Tidak ada data ${nama} untuk ${konteks}.`, catatan, link };
  }
  const dimNama = p.dimensi === 'bulan' ? 'Bulan' : p.dimensi === 'dist' ? 'Distributor' : p.dimensi === 'jenis' ? 'Jenis semen' : 'Region';
  const total = baris.reduce((a, b) => a + b.nilai, 0), totalLalu = baris.reduce((a, b) => a + (b.lalu || 0), 0);
  const adaLalu = p.yoy && baris.some(b => b.lalu != null);
  const kol = m === 'omzet' ? 'Omzet (Rp)' : m === 'do' ? 'DO' : m === 'ta' ? 'Toko aktif' : 'Ton';
  const sel = (v: number) => (m === 'omzet' || m === 'do' || m === 'ta' ? Math.round(v) : Math.round(v * 10) / 10);

  // tanpa dimensi: satu angka
  if (!p.dimensi) {
    const v = baris[0].nilai;
    let teks = `${METRIK_LABEL[m]} ${konteks}: **${tulis(m, v)}**${rata ? ' (rata-rata per bulan)' : ''}.`;
    if (adaLalu) {
      const l = baris[0].lalu || 0, pr = persen(v, l);
      teks += ` Periode yang sama tahun ${p.tahun - 1}: ${tulis(m, l)}, ${pr == null ? 'tidak bisa dibandingkan' : `**${pr >= 0 ? 'naik' : 'turun'} ${nf(Math.abs(pr), 1)}%**`}.`;
    }
    return { ok: true, paham, teks, catatan, link };
  }

  const urutan = p.urut && !(p.tren && !p.urut) ? [...baris].sort((a, b) => (p.urut === 'asc' ? a.nilai - b.nilai : b.nilai - a.nilai))
    : p.dimensi === 'bulan' ? [...baris].sort((a, b) => a.urutan - b.urutan) : [...baris].sort((a, b) => b.nilai - a.nilai);
  const tampil = p.dimensi === 'bulan' && !p.urut ? urutan : urutan;
  const isi = p.urut === 'asc' ? urutan.filter(b => b.nilai > 0) : urutan;
  const juara = (isi.length ? isi : urutan)[0];
  let teks: string;
  if (p.urut) {
    const kata = p.urut === 'desc' ? (m === 'ta' || m === 'do' ? 'terbanyak' : 'tertinggi') : (m === 'ta' || m === 'do' ? 'paling sedikit' : 'terendah');
    teks = `${METRIK_LABEL[m]} ${kata} ${konteks}: **${juara.label}** dengan **${tulis(m, juara.nilai)}**.`;
    const kedua = (isi.length ? isi : urutan)[1];
    if (kedua) teks += ` Berikutnya ${kedua.label} (${tulis(m, kedua.nilai)}).`;
  } else if (p.dimensi === 'bulan') {
    const naik = [...baris].sort((a, b) => b.nilai - a.nilai)[0];
    teks = rata || m === 'ta'
      ? `${METRIK_LABEL[m]} ${konteks}: rata-rata **${tulis(m, total / baris.length)}** per bulan, terbanyak di ${naik.label} (${tulis(m, naik.nilai)}).`
      : `${METRIK_LABEL[m]} ${konteks}: total **${tulis(m, total)}**, tertinggi di ${naik.label} (${tulis(m, naik.nilai)}).`;
  } else {
    teks = m === 'ta' ? `${METRIK_LABEL[m]} ${konteks} per ${dimNama.toLowerCase()}: terbanyak **${juara.label}** (${tulis(m, juara.nilai)}).`
      : `${METRIK_LABEL[m]} ${konteks}: total **${tulis(m, total)}**. Terbesar **${juara.label}** (${tulis(m, juara.nilai)}${total ? `, ${nf((juara.nilai / total) * 100)}%` : ''}).`;
  }
  if (adaLalu && m !== 'ta') {
    const pr = persen(total, totalLalu);
    teks += ` Dibanding periode yang sama ${p.tahun - 1} (${tulis(m, totalLalu)}): ${pr == null ? '–' : `**${pr >= 0 ? 'naik' : 'turun'} ${nf(Math.abs(pr), 1)}%**`}.`;
  }
  const header = adaLalu ? [dimNama, `${kol} ${p.tahun}`, `${kol} ${p.tahun - 1}`, 'Perubahan'] : [dimNama, kol];
  const rows: (string | number)[][] = tampil.map(b => (adaLalu ? [b.label, sel(b.nilai), sel(b.lalu || 0), tulisPersen(persen(b.nilai, b.lalu || 0))] : [b.label, sel(b.nilai)]));
  if (m !== 'ta' && tampil.length > 1) rows.push(adaLalu ? ['Total', sel(total), sel(totalLalu), tulisPersen(persen(total, totalLalu))] : ['Total', sel(total)]);
  return {
    ok: true, paham, teks, catatan, link,
    tabel: { header, rows },
    chart: { labels: tampil.map(b => b.label), values: tampil.map(b => b.nilai), garis: p.dimensi === 'bulan' && !p.urut && tampil.length > 2, satuan: m === 'omzet' ? 'Rp' : m === 'do' ? 'DO' : m === 'ta' ? 'toko' : 'ton' },
  };
}

export async function jawab(tanya: string, ctx: TanyaCtx): Promise<Jawaban> {
  const bersih = perbaikiEjaan(tanya.trim());
  if (bersih.length < 3) return { ok: false, paham: [], teks: 'Tulis pertanyaannya dulu, misalnya "bulan apa omzet tertinggi PKB".', catatan: [] };
  const ym = ctx.trx.reduce((a, r) => Math.max(a, Number(r.year) * 100 + Number(r.month)), 0);
  if (!ym) return { ok: false, paham: [], teks: 'Data transaksi belum tersedia.', catatan: [] };
  const akhir = { y: Math.floor(ym / 100), m: ym % 100 };
  const distAda = new Set(ctx.trx.map(r => String(r.dist_code)));
  const c2: TanyaCtx = { ...ctx, dists: ctx.dists.filter(d => distAda.has(d.code)) };
  const regionDari = (rows: Row[] | null) => [...new Set((rows || []).map(r => String(r.region)).filter(r => r && r !== 'Tanpa region'))];
  const regionList = { sellin: regionDari(ctx.sellin), stok: regionDari(ctx.stok) };
  const p = pahami(bersih, c2, akhir, regionList);
  const catatan: string[] = [];
  const namaDist = (c: string) => c;

  // pertanyaan tentang salesman (konsisten, tertinggi, capai target, jumlah)
  const s = jawabSales(p, ctx.sales, akhir);
  if (s) return s;

  // pertanyaan analisis (potensi daerah, toko berhenti order, kenapa naik/turun, perlu perhatian, ringkasan kinerja)
  const a = await analisis(p, c2, akhir);
  if (a) return a;

  // tidak ada satu pun yang dikenali -> jangan mengarang
  const kenal = !p.metrikTersirat || p.dists.length || p.regions.length || p.jenis || p.bulanDisebut || p.tahunDisebut || p.topToko;
  if (!kenal || (p.metrikTersirat && !p.dimensi && !p.urut && !p.topToko && !p.dists.length)) {
    return { ok: false, paham: [], teks: 'Saya belum bisa memahami pertanyaan itu. Sebutkan apa yang ingin dilihat (omzet, tonase, toko aktif, DO, salesman, sell in, atau stok), boleh ditambah distributor, jenis semen, dan bulannya. Mungkin maksudnya salah satu ini:', catatan: [], saran: mirip(bersih) };
  }
  if (p.metrikTersirat) catatan.push('Metrik tidak disebut, jadi dipakai omzet.');

  /* ---------- stok ---------- */
  if (p.metrik === 'stok') {
    if (!ctx.stok || !ctx.stok.length) return { ok: false, paham: ['Stok'], teks: ctx.stok ? 'Data stok belum ada.' : 'Akun Anda tidak punya akses ke data stok.', catatan: [] };
    const tgl = ctx.stok.reduce((a, r) => (String(r.tanggal).slice(0, 10) > a ? String(r.tanggal).slice(0, 10) : a), '');
    const rows = ctx.stok.filter(r => String(r.tanggal).slice(0, 10) === tgl && (!p.regions.length || p.regions.includes(String(r.region))) && (!p.jenis || r.jenis === p.jenis));
    const [y, m, d] = tgl.split('-').map(Number);
    const kapan = `${d} ${BLN[m]} ${y}`;
    if (p.bulanDisebut || p.tahunDisebut) catatan.push(`Stok selalu dijawab dengan posisi terakhir (${kapan}); riwayat harian ada di halaman Stock Semen.`);
    const dim: Dimensi = p.dimensi === 'jenis' ? 'jenis' : p.dimensi === 'region' || (!p.dimensi && !p.regions.length) ? 'region' : p.dimensi === 'bulan' ? null : p.dimensi;
    const p2 = { ...p, dimensi: dim === 'dist' ? 'region' as Dimensi : dim, yoy: false, tren: false };
    const kunci = (r: Row) => (p2.dimensi === 'jenis' ? JENIS_LABEL[r.jenis as Jenis] || String(r.jenis) : p2.dimensi === 'region' ? String(r.region) : 'x');
    const map = new Map<string, number>();
    rows.forEach(r => map.set(kunci(r), (map.get(kunci(r)) || 0) + Number(r.ton || 0)));
    const baris = [...map.entries()].map(([label, nilai], i) => ({ label, nilai, urutan: i }));
    const konteks = `${p.jenis ? JENIS_LABEL[p.jenis] + ' ' : ''}${p.regions.length ? p.regions.join(', ') + ' ' : ''}per ${kapan}`;
    const paham = ['Stok semen', ...(p.regions.length ? [p.regions.join(', ')] : ['Semua region']), ...(p.jenis ? [JENIS_LABEL[p.jenis]] : []), `Posisi ${kapan}`, ...(p2.dimensi ? [`Per ${p2.dimensi === 'jenis' ? 'jenis' : 'region'}`] : [])];
    return susun(p2, baris, konteks, catatan, paham, { to: '/stock', label: 'Buka Stock Semen' });
  }

  /* ---------- sell in ---------- */
  if (p.metrik === 'sellin') {
    if (!ctx.sellin) return { ok: false, paham: ['Sell in'], teks: 'Akun Anda tidak punya akses ke data sell in.', catatan: [] };
    const set = new Set(p.bulan);
    const cocok = (r: Row, y: number) => {
      const t = String(r.tanggal);
      return Number(t.slice(0, 4)) === y && set.has(Number(t.slice(5, 7))) && (!p.regions.length || p.regions.includes(String(r.region))) && (!p.jenis || jenisNama(r.produk) === p.jenis);
    };
    const dim: Dimensi = p.dimensi === 'dist' ? 'region' : p.dimensi;
    const p2 = { ...p, dimensi: dim };
    const kunci = (r: Row): [string, number] => {
      const mo = Number(String(r.tanggal).slice(5, 7));
      return dim === 'bulan' ? [BULAN[mo], mo] : dim === 'region' ? [String(r.region), 0] : dim === 'jenis' ? [JENIS_LABEL[jenisNama(r.produk)], 0] : ['x', 0];
    };
    const map = new Map<string, Baris>();
    ctx.sellin.forEach(r => {
      const kini = cocok(r, p.tahun), lalu = p.yoy && cocok(r, p.tahun - 1);
      if (!kini && !lalu) return;
      const [label, urutan] = kunci(r);
      const b = map.get(label) || { label, nilai: 0, lalu: p.yoy ? 0 : undefined, urutan };
      if (kini) b.nilai += Number(r.ton || 0); else b.lalu = (b.lalu || 0) + Number(r.ton || 0);
      map.set(label, b);
    });
    const konteks = `${p.jenis ? JENIS_LABEL[p.jenis] + ' ' : ''}${p.regions.length ? p.regions.join(', ') + ' ' : ''}${periodeLabel(p)}`;
    const paham = ['Sell in (ton)', ...(p.regions.length ? [p.regions.join(', ')] : ['Semua region']), ...(p.jenis ? [JENIS_LABEL[p.jenis]] : []), periodeLabel(p),
      ...(dim ? [`Per ${dim === 'jenis' ? 'jenis' : dim}`] : []), ...(p.yoy ? [`Dibanding ${p.tahun - 1}`] : [])];
    return susun(p2, [...map.values()], konteks, catatan, paham, { to: '/sell-in-bnn', label: 'Buka Sell In BNN' });
  }

  /* ---------- penjualan toko (transaksi) ---------- */
  const set = new Set(p.bulan), dset = p.dists.length ? new Set(p.dists) : null;
  const konteksDist = p.dists.length ? p.dists.map(namaDist).join(', ') : 'semua distributor';
  const konteks = `${p.jenis ? JENIS_LABEL[p.jenis] + ' ' : ''}${konteksDist} ${periodeLabel(p)}`;
  const paham = [METRIK_LABEL[p.metrik], p.dists.length ? p.dists.join(', ') : 'Semua distributor', ...(p.jenis ? [JENIS_LABEL[p.jenis]] : ['Semua jenis']), periodeLabel(p)];
  const link = { to: '/beranda', label: 'Buka Penjualan Toko' };

  if (p.topToko) {
    const from = `${p.tahun}-${pad(p.bulan[0])}-01`, bl = p.bulan[p.bulan.length - 1];
    const to = `${p.tahun}-${pad(bl)}-${pad(new Date(Date.UTC(p.tahun, bl, 0)).getUTCDate())}`;
    if (p.dists.length > 1) catatan.push(`Top toko hanya bisa untuk satu distributor atau semua; dipakai ${p.dists[0]}.`);
    const kode = p.jenis ? [...new Set(ctx.trx.map(r => String(r.product_code)).filter(c => jenisProduk(c) === p.jenis))] : null;
    const rows = await ctx.topToko(p.dists[0] || null, from, to, kode, p.topToko);
    const pakaiOmzet = p.metrik === 'omzet' && !p.metrikTersirat;
    if (!pakaiOmzet) catatan.splice(0, catatan.length, ...catatan.filter(c => !c.startsWith('Metrik tidak disebut')));
    const urut = [...rows].sort((a, b) => (pakaiOmzet ? Number(b.net_amount) - Number(a.net_amount) : Number(b.total_qty) - Number(a.total_qty)));
    if (pakaiOmzet) catatan.push('Daftar diambil dari toko dengan tonase terbesar, lalu diurutkan menurut omzet.');
    const ph = [`Top ${p.topToko} toko`, p.dists[0] || 'Semua distributor', ...(p.jenis ? [JENIS_LABEL[p.jenis]] : []), periodeLabel(p), pakaiOmzet ? 'Menurut omzet' : 'Menurut tonase'];
    if (!urut.length) return { ok: true, paham: ph, teks: `Tidak ada transaksi toko untuk ${konteks}.`, catatan, link };
    const a = urut[0];
    return {
      ok: true, paham: ph, catatan, link,
      teks: `Toko terbesar ${p.dists[0] || 'semua distributor'} ${periodeLabel(p)}: **${a.cust_name || a.customer_code}** dengan **${nf(Number(a.total_qty))} ton** (${rupiah(Number(a.net_amount))}).`,
      tabel: { header: ['#', 'Toko', 'Distributor', 'DO', 'Ton', 'Omzet (Rp)'],
        rows: urut.map((r, i) => [i + 1, String(r.cust_name || r.customer_code), String(r.dist_code || ''), Number(r.num_do || 0), Math.round(Number(r.total_qty) * 10) / 10, Math.round(Number(r.net_amount))]) },
    };
  }

  const dim = p.dimensi === 'region' ? 'dist' : p.dimensi;
  const p2 = { ...p, dimensi: dim };
  if (dim) paham.push(`Per ${dim === 'dist' ? 'distributor' : dim === 'jenis' ? 'jenis semen' : 'bulan'}`);
  if (p.urut) paham.push(p.urut === 'desc' ? 'Tertinggi' : 'Terendah');
  if (p.yoy) paham.push(`Dibanding ${p.tahun - 1}`);
  const map = new Map<string, Baris>();
  const tambah = (label: string, urutan: number, v: number, kini: boolean) => {
    const b = map.get(label) || { label, nilai: 0, lalu: p.yoy ? 0 : undefined, urutan };
    if (kini) b.nilai += v; else b.lalu = (b.lalu || 0) + v;
    map.set(label, b);
  };
  const tahunCocok = (y: number) => (y === p.tahun ? true : p.yoy && y === p.tahun - 1 ? false : null);

  if (p.metrik === 'ta') {
    if (p.jenis) catatan.push('Toko aktif tidak bisa dipisah per jenis semen di sini, jadi dihitung untuk semua jenis.');
    if (dim === 'jenis') return { ok: false, paham, teks: 'Toko aktif per jenis semen belum bisa dijawab di sini. Coba per bulan atau per distributor.', catatan };
    catatan.push('Toko aktif = toko (tanpa subdist) dengan belanja minimal Rp200 ribu dalam sebulan.');
    const banyak = p.bulan.length > 1;
    // semua distributor tanpa rincian: pakai total unik per bulan
    const sumber = !dset && dim !== 'dist' ? ctx.ta.filter(r => r.dist_code === '*') : ctx.ta.filter(r => r.dist_code !== '*' && (!dset || dset.has(String(r.dist_code))));
    if (dset && dset.size > 1 && dim !== 'dist') catatan.push('Toko yang dilayani lebih dari satu distributor bisa terhitung dua kali pada penjumlahan antar distributor.');
    const d2: Dimensi = dim || (banyak ? 'bulan' : null);
    const p3 = { ...p2, dimensi: d2 };
    sumber.forEach(r => {
      const k = tahunCocok(Number(r.year)), mo = Number(r.month);
      if (k == null || !set.has(mo)) return;
      const v = Number(r.num_active_stores || 0);
      if (d2 === 'dist') tambah(String(r.dist_code), 0, v / p.bulan.length, k);
      else if (d2 === 'bulan') tambah(BULAN[mo], mo, v, k);
      else tambah('x', 0, v, k);
    });
    if (d2 === 'dist' && banyak) catatan.push('Angka per distributor adalah rata-rata toko aktif per bulan pada periode itu.');
    if (!dim && banyak && !paham.includes('Per bulan')) paham.push('Per bulan');
    return susun(p3, [...map.values()], konteks, catatan, paham, link, d2 === 'dist' && banyak);
  }

  if (p.metrik === 'do' && !p.jenis && dim !== 'jenis') {
    ctx.distM.filter(r => !dset || dset.has(String(r.dist_code))).forEach(r => {
      const k = tahunCocok(Number(r.year)), mo = Number(r.month);
      if (k == null || !set.has(mo)) return;
      const v = Number(r.num_do || 0);
      if (dim === 'dist') tambah(String(r.dist_code), 0, v, k); else if (dim === 'bulan') tambah(BULAN[mo], mo, v, k); else tambah('x', 0, v, k);
    });
    return susun(p2, [...map.values()], konteks, catatan, paham, link);
  }
  if (p.metrik === 'do') catatan.push('Jumlah DO per jenis semen adalah perkiraan: DO yang berisi dua produk terhitung di masing-masing produk.');

  const kol = p.metrik === 'omzet' ? 'net_amount' : p.metrik === 'do' ? 'num_do' : 'total_qty';
  ctx.trx.forEach(r => {
    const k = tahunCocok(Number(r.year)), mo = Number(r.month);
    if (k == null || !set.has(mo)) return;
    if (dset && !dset.has(String(r.dist_code))) return;
    const j = jenisProduk(r.product_code);
    if (p.jenis && j !== p.jenis) return;
    const v = Number(r[kol] || 0);
    if (dim === 'dist') tambah(String(r.dist_code), 0, v, k); else if (dim === 'bulan') tambah(BULAN[mo], mo, v, k);
    else if (dim === 'jenis') tambah(JENIS_LABEL[j], 0, v, k); else tambah('x', 0, v, k);
  });
  const kini = new Date(Date.now() + 7 * 3600e3);
  if (p.tahun === akhir.y && set.has(akhir.m) && kini.getUTCFullYear() === akhir.y && kini.getUTCMonth() + 1 === akhir.m)
    catatan.push(`Bulan ${BULAN[akhir.m]} ${akhir.y} masih berjalan, angkanya belum sebulan penuh.`);
  return susun(p2, [...map.values()], konteks, catatan, paham, link);
}

/* ---------------- toleransi salah ketik dan pertanyaan mirip ---------------- */
const KAMUS = ['omzet', 'tonase', 'toko', 'aktif', 'salesman', 'distributor', 'tertinggi', 'terendah', 'terbanyak', 'terbesar', 'terkecil', 'konsisten',
  'kenapa', 'mengapa', 'berhenti', 'dikembangkan', 'potensi', 'perhatian', 'kinerja', 'ringkasan', 'bandingkan', 'dibanding', 'target', 'capai',
  'januari', 'februari', 'maret', 'april', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember', 'bulan', 'tahun', 'semester',
  'kuartal', 'rajawali', 'semen', 'putih', 'stok', 'region', 'daerah', 'zona', 'wilayah', 'transaksi', 'tumbuh', 'turun', 'naik', 'bagaimana',
  'pelanggan', 'customer', 'jumlah', 'berapa', 'paling', 'menambah', 'meningkatkan'];
function jarak(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Kata panjang yang mirip kata kunci (beda 1 huruf, atau 2 huruf untuk kata 8+ huruf) diganti kata kuncinya: "tonasse" -> "tonase". */
export function perbaikiEjaan(t: string) {
  return t.replace(/[A-Za-z]{5,}/g, w => {
    const k = w.toLowerCase();
    if (KAMUS.includes(k)) return w;
    let best = '', bd = 9;
    KAMUS.forEach(c => { const d = jarak(k, c); if (d < bd) { bd = d; best = c; } });
    return bd <= (k.length >= 8 ? 2 : 1) ? best : w;
  });
}
const kata = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2));
/** Tiga contoh pertanyaan dengan kata yang paling banyak sama. */
export function mirip(t: string): string[] {
  const a = kata(t);
  return CONTOH.flatMap(g => g.items).map(c => { const b = kata(c); let n = 0; b.forEach(w => a.has(w) && n++); return { c, n: n / Math.sqrt(b.size || 1) }; })
    .sort((x, y) => y.n - x.n).slice(0, 3).map(x => x.c);
}
