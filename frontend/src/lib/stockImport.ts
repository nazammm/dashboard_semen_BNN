/* ============================================================================
   File "Stock Semen <BULAN> <TAHUN>.xlsx": satu sheet per tanggal (1, 2, ..., 31).
   Tiap sheet: judul "REKAP STOCK SEMEN s.d 16 NOV 2026", baris judul kolom
   DAERAH | PCC 50 | TON | PCC 40 | TON | WC-40 | TON | TR-30 | TON | RAJAWALI 50 kg | TON | ...
   lalu satu baris per daerah, diselingi baris "Total Lampung", "Total Medan", ... dan "Total" di akhir.
   Murni (tanpa DOM / pustaka) supaya bisa diuji di Node; pembacaan workbook ada di importer.worker.

   Aturan:
   - tanggal dari judul ("s.d 16 NOV 2026"); kalau tidak ada, nomor sheet + bulan/tahun dari nama file
   - kolom produk = judul kolom selain "TON"; kg per zak dari angka di judul (PCC 50 = 50, RAJAWALI 40 = 40).
     TON di file tidak dipakai: dihitung ulang zak x kg / 1000 di database. (Catatan: kolom TON file memakai
     50 kg untuk RAJAWALI 40 kg; web memakai 40 kg, sama dengan aturan tonase RJW004 = qty / 25.)
   - TR-30 tidak dimasukkan (permintaan pengguna)
   - baris "Total ..." dilewati; baris "Total" terakhir dipakai untuk memeriksa jumlah. Kalau jumlah semua
     daerah tidak sama dengan Total tetapi jumlah baris yang TAMPIL sama, baris tersembunyi tidak dipakai.
   - sheet setelah hari ini (template bulan berjalan) dan sheet tanpa angka dilewati
============================================================================ */

export type Jenis = 'STR' | 'RJW' | 'CWC';
export type Cell = string | number | boolean | null | undefined;
export interface StockSheetIn { name: string; aoa: Cell[][]; hidden?: Set<number> }

export interface StockSheetInfo {
  sheet: string;
  tanggal: string | null;
  status: 'dipakai' | 'kosong' | 'masa depan' | 'tidak terbaca' | 'tanggal ganda' | 'bulan lain';
  daerah: number;
  zak: number;
  ton: number;
  catatan?: string;
}
export interface StockProduk { produk: string; jenis: Jenis; kg: number }
export interface StockStats {
  rowsRead: number; rowsUsed: number; invalid: number; issues: { row: number; reason: string }[];
  dateFrom: string | null; dateTo: string | null;
  sheets: StockSheetInfo[];
  produk: StockProduk[];
  daerah: string[];                       // daerah di tanggal terakhir (urutan file)
  latest: { daerah: string; produk: string; zak: number; ton: number }[];   // isi tanggal terakhir, untuk pratinjau
  peringatan: string[];                   // selisih dengan baris Total, judul tidak cocok, dll.
  dilewati: string[];                     // kolom produk yang sengaja tidak dimasukkan (TR-30)
}
/** Baris ke server: [tanggal, daerah, produk, jenis, kg, zak] */
export type StockRow = [string, string, string, Jenis, number, number];
export type StockParseResult =
  | { ok: true; rows: StockRow[]; stats: StockStats }
  | { ok: false; error: string; missing?: string[]; rows: StockRow[]; stats: StockStats };

/** Produk yang tidak dimasukkan ke stok web. */
const PRODUK_DILEWATI = /^TR\b/;

const BULAN: Record<string, number> = {
  JAN: 1, FEB: 2, PEB: 2, MAR: 3, APR: 4, MEI: 5, MAY: 5, JUN: 6, JUL: 7, AGU: 8, AGS: 8, AUG: 8,
  SEP: 9, OKT: 10, OCT: 10, NOV: 11, NOP: 11, DES: 12, DEC: 12,
};
const bulanDari = (t: string) => BULAN[t.slice(0, 3).toUpperCase()] ?? null;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;   // 31 Nov -> tidak valid
};
const teks = (v: Cell) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const angka = (v: Cell): number | null => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (s === '' || /^-+$/.test(s)) return 0;
  const n = Number(s.replace(/,/g, ''));          // "1,086" = 1086 (format file stok)
  return Number.isFinite(n) ? n : null;
};

/** Bulan dan tahun dari nama file, mis. "Stock Semen NOV 2026.xlsx". */
export function bulanTahunDariNama(nama: string): { y: number; m: number } | null {
  const r = /\b([A-Za-z]{3,9})\s*[-_ ]?\s*(20\d{2})\b/.exec(nama);
  if (!r) return null;
  const m = bulanDari(r[1]);
  return m ? { y: Number(r[2]), m } : null;
}

/** Judul kolom produk -> nama, jenis, kg. "RAJAWALI 50 kg" -> RAJAWALI 50 / RJW / 50; "WC-40" -> WC 40 / CWC / 40. */
export function produkDari(judul: string): StockProduk | null {
  const t = judul.toUpperCase().replace(/[-_]/g, ' ').replace(/\bKG\b/g, '').replace(/\s+/g, ' ').trim();
  const kg = /(\d{2})\s*$/.exec(t) || /(\d{2})/.exec(t);
  if (!t || !kg) return null;
  const jenis: Jenis = /RAJAWALI|RJW/.test(t) ? 'RJW' : /^WC\b|WHITE|CWC|PUTIH/.test(t) ? 'CWC' : 'STR';
  return { produk: t.replace(/(\D)(\d)/, '$1 $2').replace(/\s+/g, ' '), jenis, kg: Number(kg[1]) };
}

function tanggalJudul(aoa: Cell[][]): string | null {
  for (const row of aoa.slice(0, 6)) {
    for (const c of row || []) {
      const r = /s\.?\s*d\.?\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})/i.exec(teks(c));
      if (r) { const m = bulanDari(r[2]); if (m) return iso(Number(r[3]), m, Number(r[1])); }
    }
  }
  return null;
}

function bacaSheet(sh: StockSheetIn, fileYm: { y: number; m: number } | null, hariIni: string, stats: StockStats) {
  const info: StockSheetInfo = { sheet: sh.name, tanggal: null, status: 'tidak terbaca', daerah: 0, zak: 0, ton: 0 };
  const out: StockRow[] = [];
  const aoa = sh.aoa;

  // tanggal
  const tJudul = tanggalJudul(aoa);
  const hariSheet = /^\s*(\d{1,2})\s*$/.exec(sh.name)?.[1];
  const tSheet = hariSheet && fileYm ? iso(fileYm.y, fileYm.m, Number(hariSheet)) : null;
  info.tanggal = tJudul ?? tSheet;
  if (tJudul && tSheet && tJudul !== tSheet) info.catatan = `judul sheet ${sh.name} menyebut ${tJudul}`;
  // nama sheet berupa hari yang tidak ada di bulan file (mis. sheet 31 di file November)
  if (!info.tanggal && hariSheet && fileYm) { info.status = 'bulan lain'; info.catatan = `tidak ada tanggal ${hariSheet} di bulan file`; return { info, out }; }
  // sheet sisa bulan lain (mis. "3 Jul" dari 2021) di file bulanan: dilewati
  if (info.tanggal && fileYm && info.tanggal.slice(0, 7) !== `${fileYm.y}-${pad(fileYm.m)}`) {
    info.status = 'bulan lain'; info.catatan = undefined; return { info, out };
  }

  // baris judul kolom
  const h = aoa.findIndex((r, i) => i < 20 && (r || []).some(c => teks(c).toUpperCase() === 'DAERAH'));
  if (h < 0) { if (!aoa.some(r => (r || []).some(c => teks(c) !== ''))) info.status = 'kosong'; return { info, out }; }
  if (!info.tanggal) { info.catatan = 'tanggal tidak ditemukan di judul sheet maupun nama file'; return { info, out }; }

  const kepala = aoa[h] || [];
  const dc = kepala.findIndex(c => teks(c).toUpperCase() === 'DAERAH');
  const kolom: { j: number; p: StockProduk }[] = [];
  kepala.forEach((c, j) => {
    const t = teks(c);
    if (j <= dc || !t || /^TON$/i.test(t)) return;
    const p = produkDari(t);
    if (p && PRODUK_DILEWATI.test(p.produk)) { if (!stats.dilewati.includes(t)) stats.dilewati.push(t); return; }
    if (p) kolom.push({ j, p });
  });
  if (!kolom.length) { info.catatan = 'kolom produk tidak ditemukan'; return { info, out }; }
  for (const k of kolom) if (!stats.produk.some(p => p.produk === k.p.produk)) stats.produk.push(k.p);

  // baris daerah
  type Baris = { r: number; daerah: string; zak: number[]; hidden: boolean };
  const isi: Baris[] = [];
  let total: number[] | null = null;
  for (let r = h + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const daerah = teks(row[dc]);
    // tabel lain di bawah tabel utama (mis. REKAP STOCK SEMEN (SKP)) tidak dibaca
    if ((row || []).some(c => /^REKAP\b/i.test(teks(c)) || teks(c).toUpperCase() === 'DAERAH')) break;
    if (!daerah) continue;
    const zak = kolom.map(k => angka(row[k.j]));
    if (/^(grand\s+)?total$/i.test(daerah)) { total = zak.map(z => z ?? 0); break; }   // baris Total akhir: akhir tabel utama
    if (/^total\b/i.test(daerah)) continue;                                     // Total Lampung, Total Medan, ...
    stats.rowsRead++;
    const salah = zak.findIndex(z => z === null);
    if (salah >= 0) {
      stats.invalid++;
      if (stats.issues.length < 20) stats.issues.push({ row: r + 1, reason: `${sh.name}: ${daerah} kolom ${kolom[salah].p.produk} bukan angka` });
      continue;
    }
    isi.push({ r, daerah, zak: zak as number[], hidden: !!sh.hidden?.has(r) });
  }

  // cocokkan dengan baris Total: semua baris, atau hanya yang tampil
  let pakai = isi;
  let selisih = '';
  if (total) {
    const jumlah = (rows: Baris[]) => kolom.map((_, i) => rows.reduce((a, b) => a + b.zak[i], 0));
    const sama = (a: number[]) => a.every((v, i) => Math.abs(v - total![i]) < 0.5);
    const tampil = isi.filter(b => !b.hidden);
    if (!sama(jumlah(isi)) && tampil.length < isi.length && sama(jumlah(tampil))) {
      pakai = tampil;
      info.catatan = [info.catatan, `${isi.length - tampil.length} baris tersembunyi tidak dihitung (sesuai baris Total)`].filter(Boolean).join('; ');
    } else if (!sama(jumlah(isi))) {
      const beda = kolom.map((k, i) => ({ k, s: jumlah(isi)[i] - total![i] })).filter(x => Math.abs(x.s) >= 0.5);
      selisih = (`Sheet ${sh.name}: jumlah daerah tidak sama dengan baris Total (${beda.map(x => `${x.k.p.produk} selisih ${x.s.toLocaleString('id-ID')} zak`).join(', ')}).`);
    }
  }

  const zakTotal = pakai.reduce((a, b) => a + b.zak.reduce((x, y) => x + y, 0), 0);
  if (zakTotal === 0) { info.status = 'kosong'; return { info, out }; }
  if (info.tanggal > hariIni) { info.status = 'masa depan'; return { info, out }; }

  for (const b of pakai) {
    kolom.forEach((k, i) => {
      out.push([info.tanggal!, b.daerah, k.p.produk, k.p.jenis, k.p.kg, b.zak[i]]);
      info.zak += b.zak[i];
      info.ton += (b.zak[i] * k.p.kg) / 1000;
    });
  }
  info.daerah = pakai.length;
  info.status = 'dipakai';
  if (selisih) stats.peringatan.push(selisih);   // hanya untuk sheet yang dipakai
  return { info, out };
}

/** hariIni = "YYYY-MM-DD" (sheet setelah tanggal ini dianggap template dan dilewati). */
export function parseStockSheets(sheets: StockSheetIn[], fileName: string, hariIni: string): StockParseResult {
  const stats: StockStats = {
    rowsRead: 0, rowsUsed: 0, invalid: 0, issues: [], dateFrom: null, dateTo: null,
    sheets: [], produk: [], daerah: [], latest: [], peringatan: [], dilewati: [],
  };
  const fileYm = bulanTahunDariNama(fileName);
  const perTanggal = new Map<string, StockRow[]>();
  for (const sh of sheets) {
    const { info, out } = bacaSheet(sh, fileYm, hariIni, stats);
    if (info.status === 'dipakai' && perTanggal.has(info.tanggal!)) {
      info.status = 'tanggal ganda';
      info.catatan = [info.catatan, `tanggal ${info.tanggal} sudah ada di sheet lain; sheet ini tidak dipakai`].filter(Boolean).join('; ');
    } else if (info.status === 'dipakai') perTanggal.set(info.tanggal!, out);
    stats.sheets.push(info);
    if (info.catatan && info.status === 'dipakai' && /judul sheet/.test(info.catatan)) stats.peringatan.push(`Sheet ${sh.name}: ${info.catatan}.`);
  }

  const tanggal = [...perTanggal.keys()].sort();
  const rows = tanggal.flatMap(t => perTanggal.get(t)!);
  stats.rowsUsed = rows.length;
  stats.dateFrom = tanggal[0] ?? null;
  stats.dateTo = tanggal[tanggal.length - 1] ?? null;
  if (stats.dateTo) {
    const akhir = perTanggal.get(stats.dateTo)!;
    stats.daerah = [...new Set(akhir.map(r => r[1]))];
    stats.latest = akhir.map(r => ({ daerah: r[1], produk: r[2], zak: r[5], ton: (r[5] * r[4]) / 1000 }));
  }

  if (!stats.sheets.some(s => s.status !== 'kosong' && s.status !== 'tidak terbaca')) {
    return { ok: false, error: 'Tidak ada sheet stok yang terbaca. Setiap sheet harus berisi judul "REKAP STOCK SEMEN s.d <tanggal>" dan baris judul kolom DAERAH, PCC 50, TON, ...', missing: ['DAERAH'], rows: [], stats };
  }
  if (!rows.length) return { ok: false, error: 'Tidak ada stok sampai hari ini di file ini (semua sheet kosong atau tanggalnya setelah hari ini).', rows: [], stats };
  return { ok: true, rows, stats };
}

/** Tempelan dari Excel (satu sheet): baris dipisah tab. Tanggal dari judul yang ikut ditempel. */
export function parseStockText(text: string, hariIni: string): StockParseResult {
  const aoa = text.replace(/\r/g, '').split('\n').map(l => l.split('\t'));
  return parseStockSheets([{ name: 'Tempelan', aoa }], '', hariIni);
}
