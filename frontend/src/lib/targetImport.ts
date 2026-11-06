/* ============================================================================
   Import target per tahun (Kelola Data → Target).
   Jenis dikenali dari baris judul, format sama dengan sheet yang sudah dipakai:
     Sell Out    : Region, Distributor, Month, Type Cement, target_do_YYYY, do_YYYY, target_ta_YYYY, ta_distinct_YYYY
     Sell In     : Region, Sub Region, Month, Type Cement, target_YYYY, YYYY
     Distributor : dist_code, Month, Target, Target TA                       (tahun dipilih di layar)
     Salesman    : dist_code, salesman_code, salesman_name, Month, Target TA, Target Tonase, status  (tahun dipilih di layar)
   Tahun di nama kolom ikut dibaca, jadi sheet 2027 (target_do_2027, do_2026, ...) langsung bisa ditempel.
   Murni (tanpa DOM): jalan di Web Worker dan bisa diuji di Node.
   Baris yang dikirim = argumen sementrack.target_simpan:
     [metrik, tahun, bulan, region, area, tipe, kode, nama, status, nilai]  (tahun null = pakai tahun pilihan)
============================================================================ */
import { normHeader, toNumber, type RowCollector } from './sellin';

export type TargetJenis = 'sell_in' | 'sell_out' | 'distributor' | 'salesman';
export type TargetMetrik = 'target_ton' | 'realisasi_ton' | 'target_ta' | 'realisasi_ta';
export type TargetRow = [TargetMetrik, number | null, number, string, string, string, string, string | null, string | null, number];

export const JENIS_LABEL: Record<TargetJenis, string> = {
  sell_in: 'Sell In BNN', sell_out: 'Sell Out BNN', distributor: 'Distributor (Overview, Rekap Harian)', salesman: 'Salesman (Tim Sales)',
};
export const METRIK_LABEL: Record<TargetMetrik, string> = {
  target_ton: 'Target tonase', realisasi_ton: 'Realisasi tonase (pembanding)', target_ta: 'Target toko aktif', realisasi_ta: 'Realisasi toko aktif (pembanding)',
};

export interface TargetGroup { metrik: TargetMetrik; tahun: number | null; baris: number; total: number; bulan: number[] }
export interface TargetStats {
  jenis: TargetJenis | null;
  rowsRead: number;
  kunci: number;                       // jumlah baris sheet (distributor / sub region / salesman) yang terbaca
  groups: TargetGroup[];
  needsYear: boolean;                  // sheet tanpa tahun di nama kolom
  ignored: string[];                   // judul kolom yang tidak dipakai
  invalid: number;
  issues: { row: number; reason: string }[];
}
export interface TargetParseResult { ok: boolean; error?: string; missing?: string[]; rows: TargetRow[]; stats: TargetStats }

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, ags: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};
export function monthOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 12 ? v : null;
  const s = String(v ?? '').trim().toLowerCase();
  if (/^\d{1,2}$/.test(s)) { const n = Number(s); return n >= 1 && n <= 12 ? n : null; }
  return MONTHS[s.slice(0, 3)] ?? null;
}
const text = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? String(v) : String(v ?? '').trim());

/** Kolom pengenal per jenis (judul dinormalisasi: huruf kecil, tanpa spasi / tanda baca). */
const KEY_COLS: Record<TargetJenis, Record<string, string[]>> = {
  sell_out: { region: ['region'], area: ['distributor'], bulan: ['month', 'bulan'], tipe: ['typecement', 'tipe', 'tipesemen', 'type'] },
  sell_in: { region: ['region'], area: ['subregion'], bulan: ['month', 'bulan'], tipe: ['typecement', 'tipe', 'tipesemen', 'type'] },
  distributor: { kode: ['distcode', 'kodedistributor', 'distributor'], bulan: ['month', 'bulan'] },
  salesman: { area: ['distcode', 'kodedistributor'], kode: ['salesmancode', 'kodesalesman'], nama: ['salesmanname', 'namasalesman', 'nama'],
              bulan: ['month', 'bulan'], status: ['status'] },
};
/** Kolom angka: pola judul -> metrik (+ tahun dari judul kalau ada). */
const VALUE_COLS: Record<TargetJenis, { re: RegExp; metrik: TargetMetrik }[]> = {
  sell_out: [
    { re: /^targetdo(\d{4})$/, metrik: 'target_ton' }, { re: /^do(\d{4})$/, metrik: 'realisasi_ton' },
    { re: /^targetta(\d{4})$/, metrik: 'target_ta' }, { re: /^tadistinct(\d{4})$/, metrik: 'realisasi_ta' },
  ],
  sell_in: [{ re: /^target(\d{4})$/, metrik: 'target_ton' }, { re: /^(\d{4})$/, metrik: 'realisasi_ton' }],
  distributor: [{ re: /^(?:target|targettonase|targetton)$/, metrik: 'target_ton' }, { re: /^targetta$/, metrik: 'target_ta' }],
  salesman: [{ re: /^targetta$/, metrik: 'target_ta' }, { re: /^(?:targettonase|targetton)$/, metrik: 'target_ton' }],
};

export function detectJenis(heads: string[]): TargetJenis | null {
  const has = (h: string) => heads.includes(h);
  if (has('salesmancode') || has('kodesalesman')) return 'salesman';
  if (has('subregion')) return 'sell_in';
  if (has('distributor') && heads.some(h => /^targetdo\d{4}$/.test(h) || /^do\d{4}$/.test(h))) return 'sell_out';
  if (has('distcode') || has('kodedistributor')) return 'distributor';
  return null;
}

export class TargetCollector implements RowCollector<TargetParseResult> {
  rows: TargetRow[] = [];
  stats: TargetStats = { jenis: null, rowsRead: 0, kunci: 0, groups: [], needsYear: false, ignored: [], invalid: 0, issues: [] };
  private keyIdx: Record<string, number> = {};
  private valIdx: { i: number; metrik: TargetMetrik; tahun: number | null }[] = [];
  private missing: string[] = [];
  private ready = false;
  private seen = new Set<string>();

  header(cells: unknown[]) {
    const heads = cells.map(normHeader);
    const jenis = detectJenis(heads);
    this.stats.jenis = jenis;
    if (!jenis) { this.missing = ['Judul kolom sheet target (mis. Region, Distributor, Month, Type Cement, target_do_2027)']; return false; }
    const used = new Set<number>();
    for (const [field, names] of Object.entries(KEY_COLS[jenis])) {
      const i = heads.findIndex(h => names.includes(h));
      if (i < 0) { if (field !== 'nama' && field !== 'status') this.missing.push(names[0]); continue; }
      this.keyIdx[field] = i; used.add(i);
    }
    heads.forEach((h, i) => {
      if (used.has(i)) return;
      for (const { re, metrik } of VALUE_COLS[jenis]) {
        const m = re.exec(h);
        if (m) { this.valIdx.push({ i, metrik, tahun: m[1] ? Number(m[1]) : null }); used.add(i); return; }
      }
    });
    if (!this.valIdx.length) this.missing.push(jenis === 'sell_out' ? 'target_do_YYYY / do_YYYY' : jenis === 'sell_in' ? 'target_YYYY / YYYY' : 'Target / Target TA');
    this.stats.ignored = cells.map(c => String(c ?? '').trim()).filter((c, i) => c && !used.has(i));
    this.stats.needsYear = this.valIdx.some(v => v.tahun == null);
    this.ready = this.missing.length === 0;
    return this.ready;
  }

  private bad(row: number, reason: string) {
    this.stats.invalid++;
    if (this.stats.issues.length < 20) this.stats.issues.push({ row, reason });
  }

  push(cells: unknown[], rowNumber: number) {
    if (!this.ready) return;
    const jenis = this.stats.jenis!;
    const get = (f: string) => (this.keyIdx[f] == null ? null : cells[this.keyIdx[f]]);
    if (cells.every(c => c == null || String(c).trim() === '')) return;
    this.stats.rowsRead++;
    const bulan = monthOf(get('bulan'));
    if (!bulan) { this.bad(rowNumber, `Bulan tidak terbaca ("${text(get('bulan'))}")`); return; }
    const region = text(get('region')), area = text(get('area')), tipe = text(get('tipe')).toUpperCase(), kode = text(get('kode'));
    if ((jenis === 'sell_in' || jenis === 'sell_out') && (!region || !area)) { this.bad(rowNumber, 'Region / distributor kosong'); return; }
    if ((jenis === 'distributor' || jenis === 'salesman') && !kode) { this.bad(rowNumber, 'Kode kosong'); return; }
    if (jenis === 'salesman' && !area) { this.bad(rowNumber, 'Kode distributor kosong'); return; }
    const nama = text(get('nama')) || null, status = text(get('status')) || null;
    const id = [region, area, tipe, kode, bulan].join('|');
    if (this.seen.has(id)) { this.bad(rowNumber, `Baris dobel (${[area, kode, tipe].filter(Boolean).join(' ')} bulan ${bulan})`); return; }
    this.seen.add(id);
    let any = false;
    for (const v of this.valIdx) {
      const raw = cells[v.i];
      if (raw == null || String(raw).trim() === '' || String(raw).trim() === '-') continue;
      const n = toNumber(raw);
      if (n == null) { this.bad(rowNumber, `Angka tidak terbaca ("${text(raw)}")`); continue; }
      this.rows.push([v.metrik, v.tahun, bulan, region, area, tipe, kode, nama, status, n]);
      any = true;
    }
    // salesman tanpa angka tetap dicatat (status bulan itu dipakai untuk jumlah salesman aktif)
    if (!any && jenis === 'salesman') this.rows.push(['target_ta', null, bulan, '', area, '', kode, nama, status, 0]);
  }

  result(): TargetParseResult {
    if (!this.stats.jenis || this.missing.length) {
      return { ok: false, error: this.stats.jenis ? 'Kolom wajib tidak ditemukan di baris judul.' : 'Jenis sheet target tidak dikenali dari baris judul.', missing: this.missing, rows: [], stats: this.stats };
    }
    const g = new Map<string, TargetGroup>();
    const keys = new Set<string>();
    this.rows.forEach(([metrik, tahun, bulan, region, area, tipe, kode, , , nilai]) => {
      keys.add([region, area, tipe, kode].join('|'));
      const k = `${metrik}|${tahun}`;
      const x = g.get(k) || { metrik, tahun, baris: 0, total: 0, bulan: [] };
      x.baris++; x.total += nilai; if (!x.bulan.includes(bulan)) x.bulan.push(bulan);
      g.set(k, x);
    });
    const order: TargetMetrik[] = ['target_ton', 'target_ta', 'realisasi_ton', 'realisasi_ta'];
    this.stats.groups = [...g.values()].map(x => ({ ...x, bulan: x.bulan.sort((a, b) => a - b) }))
      .sort((a, b) => (b.tahun ?? 0) - (a.tahun ?? 0) || order.indexOf(a.metrik) - order.indexOf(b.metrik));
    this.stats.kunci = keys.size;
    return { ok: true, rows: this.rows, stats: this.stats };
  }
}

/** Isi tahun pilihan ke baris yang belum bertahun. */
export const withYear = (rows: TargetRow[], tahun: number) => rows.map(r => (r[1] == null ? [r[0], tahun, ...r.slice(2)] as TargetRow : r));

/** Baris tersimpan (GET admin/data/target) -> sheet dengan format yang sama seperti sheet sumber, untuk diunduh & diedit. */
export function toSheet(jenis: TargetJenis, tahun: number, rows: { metrik: string; bulan: number; region: string; area: string; tipe: string; kode: string; nama: string | null; status: string | null; nilai: number }[]) {
  const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const cols: { metrik: string; head: string }[] =
    jenis === 'sell_out' ? [{ metrik: 'target_ton', head: `target_do_${tahun}` }, { metrik: 'target_ta', head: `target_ta_${tahun}` }, { metrik: 'realisasi_ton', head: `do_${tahun}` }, { metrik: 'realisasi_ta', head: `ta_distinct_${tahun}` }]
    : jenis === 'sell_in' ? [{ metrik: 'target_ton', head: `target_${tahun}` }, { metrik: 'realisasi_ton', head: String(tahun) }]
    : jenis === 'distributor' ? [{ metrik: 'target_ton', head: 'Target' }, { metrik: 'target_ta', head: 'Target TA' }]
    : [{ metrik: 'target_ta', head: 'Target TA' }, { metrik: 'target_ton', head: 'Target Tonase' }];
  const keyHead = jenis === 'sell_out' ? ['Region', 'Distributor', 'Month', 'Type Cement']
    : jenis === 'sell_in' ? ['Region', 'Sub Region', 'Month', 'Type Cement']
    : jenis === 'distributor' ? ['dist_code', 'Month'] : ['dist_code', 'salesman_code', 'salesman_name', 'Month'];
  const byKey = new Map<string, { key: (string | number)[]; vals: Record<string, number>; status: string | null; sort: string }>();
  rows.forEach(r => {
    const key: (string | number)[] = jenis === 'sell_out' || jenis === 'sell_in' ? [r.region, r.area, MON[r.bulan], r.tipe]
      : jenis === 'distributor' ? [r.kode, MON[r.bulan]] : [r.area, r.kode, r.nama || '', r.bulan];
    const sort = jenis === 'salesman' ? `${r.area}|${r.kode}|${String(r.bulan).padStart(2, '0')}`
      : `${r.region}|${r.area}|${r.kode}|${String(r.bulan).padStart(2, '0')}|${r.tipe}`;
    const k = key.join('|');
    const e = byKey.get(k) || { key, vals: {}, status: r.status, sort };
    e.vals[r.metrik] = Number(r.nilai);
    byKey.set(k, e);
  });
  const used = cols.filter(c => [...byKey.values()].some(e => e.vals[c.metrik] != null));
  const header = [...keyHead, ...used.map(c => c.head), ...(jenis === 'salesman' ? ['status'] : [])];
  const out = [...byKey.values()].sort((a, b) => a.sort.localeCompare(b.sort))
    .map(e => [...e.key, ...used.map(c => e.vals[c.metrik] ?? null), ...(jenis === 'salesman' ? [e.status] : [])]);
  return { header, rows: out };
}
