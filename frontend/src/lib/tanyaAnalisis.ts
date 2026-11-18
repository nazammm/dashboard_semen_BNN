/* ============================================================================
   Tanya Data · pertanyaan analisis (tetap tanpa model AI: pola kata -> rumus analisis yang tetap).
   1. Potensi daerah   : "daerah mana yang bisa dikembangkan PKB untuk menambah toko aktif"
   2. Toko berhenti    : "toko mana yang berhenti order di NSA"
   3. Kenapa naik/turun: "kenapa tonase PKB turun"
   4. Perlu perhatian  : "distributor mana yang perlu perhatian" / "paling turun"
   5. Ringkasan kinerja: "bagaimana kinerja BMM bulan lalu"
   Setiap jawaban menjelaskan cara hitungnya di catatan, supaya bisa diperiksa.
============================================================================ */
import type { Row } from './types';
import { BLN, BULAN, JENIS_LABEL, METRIK_LABEL, jenisProduk, nf, persen, rupiah, tulis, tulisPersen, type Jawaban, type Jenis, type Metrik, type Paham, type TanyaCtx } from './tanya';

type YM = { y: number; m: number };
const mundur = (b: YM, n = 1): YM => { const t = b.y * 12 + (b.m - 1) - n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; };
const lab = (b: YM) => `${BLN[b.m]} ${b.y}`;
const labPanjang = (b: YM) => `${BULAN[b.m]} ${b.y}`;
const zonaNama = (z: unknown) => { const s = String(z ?? '').trim(); return !s || /^[\s\-0]*$/.test(s) ? 'Tanpa zona' : s.replace(/^\d+\s*-\s*/, ''); };
const arah = (pr: number | null) => (pr == null ? 'tidak bisa dibandingkan' : `${pr >= 0 ? 'naik' : 'turun'} ${nf(Math.abs(pr), 1)}%`);

/** Bulan dasar analisis: bulan yang disebut; kalau tidak ada, bulan data terakhir, atau bulan sebelumnya bila bulan itu masih berjalan. */
function bulanDasar(p: Paham, akhir: YM, catatan: string[]): YM {
  if (p.bulanDisebut && p.bulan.length === 1) return { y: p.tahun, m: p.bulan[0] };
  const kini = new Date(Date.now() + 7 * 3600e3);
  if (kini.getUTCFullYear() === akhir.y && kini.getUTCMonth() + 1 === akhir.m) {
    catatan.push(`${labPanjang(akhir)} masih berjalan, jadi dipakai bulan penuh terakhir (${labPanjang(mundur(akhir))}). Sebutkan bulannya kalau ingin bulan lain.`);
    return mundur(akhir);
  }
  return akhir;
}

/** Angka satu bulan untuk cakupan distributor / jenis: omzet, tonase, DO, toko aktif. */
function angka(ctx: TanyaCtx, b: YM, dists: string[], jenis: Jenis | null) {
  const dset = dists.length ? new Set(dists) : null;
  let omzet = 0, tonase = 0, doJenis = 0;
  const perJenis: Record<string, { omzet: number; tonase: number }> = {};
  const perDist: Record<string, { omzet: number; tonase: number }> = {};
  ctx.trx.forEach(r => {
    if (Number(r.year) !== b.y || Number(r.month) !== b.m) return;
    if (dset && !dset.has(String(r.dist_code))) return;
    const j = jenisProduk(r.product_code);
    if (jenis && j !== jenis) return;
    const o = Number(r.net_amount || 0), t = Number(r.total_qty || 0);
    omzet += o; tonase += t; doJenis += Number(r.num_do || 0);
    (perJenis[j] ||= { omzet: 0, tonase: 0 }).omzet += o; perJenis[j].tonase += t;
    const d = String(r.dist_code);
    (perDist[d] ||= { omzet: 0, tonase: 0 }).omzet += o; perDist[d].tonase += t;
  });
  const dm = ctx.distM.filter(r => Number(r.year) === b.y && Number(r.month) === b.m && (!dset || dset.has(String(r.dist_code))));
  const doo = jenis ? doJenis : dm.reduce((a, r) => a + Number(r.num_do || 0), 0);
  const taRows = ctx.ta.filter(r => Number(r.year) === b.y && Number(r.month) === b.m);
  const ta = dset ? taRows.filter(r => dset.has(String(r.dist_code))).reduce((a, r) => a + Number(r.num_active_stores || 0), 0)
    : Number(taRows.find(r => r.dist_code === '*')?.num_active_stores || 0);
  return { omzet, tonase, do: doo, ta, perJenis, perDist };
}
const ambil = (x: ReturnType<typeof angka>, m: Metrik) => (m === 'tonase' ? x.tonase : m === 'do' ? x.do : m === 'ta' ? x.ta : x.omzet);

export async function analisis(p: Paham, ctx: TanyaCtx, akhir: YM): Promise<Jawaban | null> {
  const q = p.q;
  if (p.metrik === 'sellin' || p.metrik === 'stok') return null;
  const cakupan = p.dists.length ? p.dists.join(', ') : 'semua distributor';
  const link = { to: '/beranda', label: 'Buka Penjualan Toko' };

  /* ---------- 1. potensi daerah untuk menambah toko aktif ---------- */
  if (/(daerah|zona|wilayah|area|kecamatan|kota)\b.*(kembang|potensi|peluang|garap|fokus|priorit|ditingkat|tambah|naik)|(potensi|peluang)\b.*(toko|daerah|zona|wilayah|area)|(meningkatkan|menaikkan|menambah|naikkan|tambah)\s+(jumlah\s+)?toko aktif/.test(q)) {
    const catatan: string[] = [];
    const b = bulanDasar(p, akhir, catatan);
    if (p.dists.length > 1) catatan.push(`Analisis daerah untuk satu distributor; dipakai ${p.dists[0]}.`);
    const dist = p.dists[0] || null;
    const rows = (await ctx.tokoBulan(b.y, b.m, dist)).filter(r => !r.is_subdist);
    const batas = `${mundur(b, 11).y}-${String(mundur(b, 11).m).padStart(2, '0')}-01`;   // 12 bulan terakhir
    const z = new Map<string, { zona: string; terdaftar: number; aktif: number; tidur: number; belum: number; ton: number }>();
    rows.forEach(r => {
      const k = zonaNama(r.zona);
      const o = z.get(k) || { zona: k, terdaftar: 0, aktif: 0, tidur: 0, belum: 0, ton: 0 };
      o.terdaftar++;
      const last = r.last_transaction ? String(r.last_transaction).slice(0, 10) : '';
      if (r.is_active) { o.aktif++; o.ton += Number(r.total_qty || 0); }
      else if (last && last >= batas) o.tidur++;
      else o.belum++;
      z.set(k, o);
    });
    const list = [...z.values()].filter(o => o.zona !== 'Tanpa zona' && o.terdaftar >= 5)
      .map(o => ({ ...o, skor: o.tidur + 0.5 * o.belum, pct: o.terdaftar ? (o.aktif / o.terdaftar) * 100 : 0 }))
      .sort((a, c) => c.skor - a.skor);
    const paham = ['Potensi daerah (toko aktif)', dist || 'Semua distributor', labPanjang(b)];
    if (!list.length) return { ok: true, paham, teks: `Tidak ada data toko per zona untuk ${cakupan}.`, catatan, link: { to: '/daftar-toko', label: 'Buka Daftar Toko' } };
    const top = list.slice(0, 10), a = top[0], totalAktif = list.reduce((s, o) => s + o.aktif, 0), totalTdr = list.reduce((s, o) => s + o.tidur, 0);
    let teks = `Daerah dengan peluang terbesar menambah toko aktif ${dist || 'semua distributor'} adalah **${a.zona}**: dari ${nf(a.terdaftar)} toko terdaftar baru **${nf(a.aktif)} yang aktif** (${nf(a.pct)}%), `
      + `**${nf(a.tidur)} toko pernah order dalam 12 bulan terakhir tetapi tidak aktif** di ${lab(b)}${a.belum ? `, dan ${nf(a.belum)} belum order sama sekali` : ''}.`;
    if (top[1]) teks += ` Berikutnya **${top[1].zona}** (${nf(top[1].tidur)} toko tidur, aktif ${nf(top[1].pct)}%)${top[2] ? ` dan **${top[2].zona}** (${nf(top[2].tidur)} toko tidur, aktif ${nf(top[2].pct)}%)` : ''}.`;
    teks += ` Secara keseluruhan ada ${nf(totalAktif)} toko aktif dan ${nf(totalTdr)} toko tidur yang paling mudah diaktifkan lagi.`;
    catatan.push('Toko tidur = pernah order dalam 12 bulan terakhir tetapi belanja bulan ini di bawah Rp200 ribu. Urutan = toko tidur + setengah dari toko yang belum pernah order (toko tidur lebih mudah digarap). Zona dengan kurang dari 5 toko dan subdist tidak ikut.');
    return {
      ok: true, paham, teks, catatan, link: { to: '/daftar-toko', label: 'Buka Daftar Toko' },
      tabel: { header: ['Zona', 'Terdaftar', 'Aktif', '% aktif', 'Toko tidur', 'Belum pernah order', 'Ton'],
        rows: top.map(o => [o.zona, o.terdaftar, o.aktif, `${nf(o.pct)}%`, o.tidur, o.belum, Math.round(o.ton * 10) / 10]) },
      chart: { labels: top.map(o => o.zona), values: top.map(o => o.tidur), satuan: 'toko tidur' },
    };
  }

  /* ---------- 2. toko yang berhenti order ---------- */
  if (/\btoko\b.*(berhenti|hilang|tidak (order|aktif|beli|belanja|transaksi)|ga(k)? (order|aktif|beli)|nggak (order|aktif|beli)|gak order|lost|churn|tidur|pasif|non ?aktif)|(berhenti|hilang|tidak aktif|tidur)\b.*\btoko\b/.test(q)) {
    const catatan: string[] = [];
    const b = bulanDasar(p, akhir, catatan), lalu = mundur(b);
    if (p.dists.length > 1) catatan.push(`Daftar toko untuk satu distributor; dipakai ${p.dists[0]}.`);
    const dist = p.dists[0] || null;
    const [kini, dulu] = await Promise.all([ctx.tokoBulan(b.y, b.m, dist), ctx.tokoBulan(lalu.y, lalu.m, dist)]);
    const kunci = (r: Row) => `${r.cust_code}|${r.dist_code}`;
    const kiniMap = new Map(kini.map(r => [kunci(r), r]));
    const hilang = dulu.filter(r => r.is_active && !r.is_subdist && !kiniMap.get(kunci(r))?.is_active)
      .map(r => ({ r, kini: kiniMap.get(kunci(r)) }))
      .sort((a, c) => Number(c.r.total_qty) - Number(a.r.total_qty));
    const paham = ['Toko berhenti aktif', dist || 'Semua distributor', `${lab(lalu)} → ${lab(b)}`];
    const aktifDulu = dulu.filter(r => r.is_active && !r.is_subdist).length;
    if (!hilang.length) return { ok: true, paham, teks: `Tidak ada toko ${cakupan} yang aktif di ${lab(lalu)} lalu berhenti di ${lab(b)}.`, catatan, link: { to: '/daftar-toko', label: 'Buka Daftar Toko' } };
    const tonHilang = hilang.reduce((s, x) => s + Number(x.r.total_qty || 0), 0);
    const samaSekali = hilang.filter(x => !Number(x.kini?.num_do || 0)).length;
    catatan.push(`Toko yang aktif (belanja minimal Rp200 ribu) di ${lab(lalu)} tetapi tidak aktif di ${lab(b)}. Subdist tidak ikut. Urutan: tonase ${lab(lalu)} terbesar.`);
    if (hilang.length > 25) catatan.push(`Ditampilkan 25 dari ${nf(hilang.length)} toko.`);
    return {
      ok: true, paham, catatan, link: { to: '/daftar-toko', label: 'Buka Daftar Toko' },
      teks: `Ada **${nf(hilang.length)} toko** ${dist || 'semua distributor'} yang aktif di ${lab(lalu)} tetapi tidak aktif di ${lab(b)} (${nf((hilang.length / Math.max(aktifDulu, 1)) * 100)}% dari ${nf(aktifDulu)} toko aktif ${lab(lalu)}). `
        + `Tonase mereka di ${lab(lalu)} **${nf(tonHilang)} ton**; ${nf(samaSekali)} di antaranya tidak order sama sekali. Yang terbesar: **${hilang[0].r.cust_name}** (${nf(Number(hilang[0].r.total_qty))} ton).`,
      tabel: { header: ['Toko', 'Distributor', 'Zona', `Ton ${lab(lalu)}`, `Ton ${lab(b)}`, 'Order terakhir'],
        rows: hilang.slice(0, 25).map(x => [String(x.r.cust_name || x.r.cust_code), String(x.r.dist_code), zonaNama(x.r.zona), Math.round(Number(x.r.total_qty) * 10) / 10,
          Math.round(Number(x.kini?.total_qty || 0) * 10) / 10, x.r.last_transaction ? String(x.kini?.last_transaction || x.r.last_transaction).slice(0, 10) : '–']) },
    };
  }

  const yoy = /tahun lalu|\byoy\b|tahun sebelumnya/.test(q);
  const metrik: Metrik = p.metrikTersirat ? 'omzet' : p.metrik;

  /* ---------- 3. kenapa naik / turun ---------- */
  if (/kenapa|mengapa|penyebab|apa yang (menyebabkan|membuat|bikin)|faktor|gara gara|sebab/.test(q)) {
    const catatan: string[] = [];
    const b = bulanDasar(p, akhir, catatan), lalu = yoy ? { y: b.y - 1, m: b.m } : mundur(b);
    const m: Metrik = metrik === 'ta' || metrik === 'do' ? metrik : metrik;
    const A = angka(ctx, b, p.dists, p.jenis), B = angka(ctx, lalu, p.dists, p.jenis);
    const va = ambil(A, m), vb = ambil(B, m), pr = persen(va, vb);
    const paham = [`Penyebab perubahan ${METRIK_LABEL[m].toLowerCase()}`, p.dists.length ? p.dists.join(', ') : 'Semua distributor', ...(p.jenis ? [JENIS_LABEL[p.jenis]] : []), `${lab(lalu)} → ${lab(b)}`];
    if (!va && !vb) return { ok: true, paham, teks: `Tidak ada data ${cakupan} untuk ${lab(b)} dan ${lab(lalu)}.`, catatan, link };
    let teks = `${METRIK_LABEL[m]} ${cakupan} ${lab(b)} **${arah(pr)}** dibanding ${lab(lalu)} (${tulis(m, vb)} → **${tulis(m, va)}**).`;
    const rows: (string | number)[][] = [];
    const kol = m === 'tonase' ? 'tonase' as const : 'omzet' as const;
    const satuan = (v: number) => (kol === 'tonase' ? Math.round(v * 10) / 10 : Math.round(v));
    // penyumbang: per distributor (kalau semua / beberapa distributor) atau per jenis semen (kalau satu distributor)
    const pakaiDist = p.dists.length !== 1;
    const kunci = new Set([...Object.keys(pakaiDist ? A.perDist : A.perJenis), ...Object.keys(pakaiDist ? B.perDist : B.perJenis)]);
    const sumbang = [...kunci].map(k => {
      const x = (pakaiDist ? A.perDist : A.perJenis)[k]?.[kol] || 0, y = (pakaiDist ? B.perDist : B.perJenis)[k]?.[kol] || 0;
      return { nama: pakaiDist ? k : JENIS_LABEL[k as Jenis] || k, kini: x, dulu: y, selisih: x - y };
    }).sort((a, c) => Math.abs(c.selisih) - Math.abs(a.selisih));
    if (m === 'omzet' || m === 'tonase') {
      const searah = sumbang.filter(s => (va - vb >= 0 ? s.selisih > 0 : s.selisih < 0)).slice(0, 2);
      if (searah.length) teks += ` Penyumbang terbesar: ${searah.map(s => `**${s.nama}** (${s.selisih >= 0 ? '+' : '−'}${kol === 'tonase' ? `${nf(Math.abs(s.selisih))} ton` : rupiah(Math.abs(s.selisih))})`).join(' dan ')}.`;
      const lawan = sumbang.find(s => (va - vb >= 0 ? s.selisih < 0 : s.selisih > 0));
      if (lawan && Math.abs(lawan.selisih) > Math.abs(va - vb) * 0.15) teks += ` Sebaliknya ${lawan.nama} ${lawan.selisih >= 0 ? 'naik' : 'turun'} ${kol === 'tonase' ? `${nf(Math.abs(lawan.selisih))} ton` : rupiah(Math.abs(lawan.selisih))}.`;
    }
    // faktor pendukung: toko aktif, DO, rata-rata per DO
    const perDoA = A.do ? A.tonase / A.do : 0, perDoB = B.do ? B.tonase / B.do : 0;
    if (m === 'ta') teks += ` Untuk melihat toko mana saja yang berhenti, tanyakan "toko mana yang berhenti order${p.dists[0] ? ` di ${p.dists[0]}` : ''}".`;
    else teks += ` Toko aktif ${nf(B.ta)} → ${nf(A.ta)} (${tulisPersen(persen(A.ta, B.ta))}), jumlah DO ${nf(B.do)} → ${nf(A.do)} (${tulisPersen(persen(A.do, B.do))}), rata-rata ${nf(perDoB, 1)} → ${nf(perDoA, 1)} ton per DO.`;
    // nilai = jumlah DO x nilai per DO; faktor yang searah dengan perubahan dan paling besar (skala log) disebut penggerak utama
    if ((m === 'omzet' || m === 'tonase') && A.do && B.do && va && vb) {
      const fDo = Math.log(A.do / B.do), fPer = Math.log((va / A.do) / (vb / B.do)), total = Math.log(va / vb);
      const searah = [{ n: 'jumlah DO', f: fDo }, { n: `besar order per DO (${m === 'tonase' ? 'ton' : 'rupiah'} per DO)`, f: fPer }].filter(x => Math.sign(x.f) === Math.sign(total) && Math.abs(x.f) > 0.005);
      if (searah.length) {
        const utama = searah.sort((x, y) => Math.abs(y.f) - Math.abs(x.f))[0];
        teks += ` Penggerak utamanya **${utama.n}**${searah.length === 1 && Math.abs(fDo) > 0.005 && Math.abs(fPer) > 0.005 ? `, sementara faktor lainnya bergerak berlawanan` : ''}.`;
      }
    }
    sumbang.forEach(s => rows.push([s.nama, satuan(s.dulu), satuan(s.kini), satuan(s.selisih), tulisPersen(persen(s.kini, s.dulu))]));
    catatan.push('Ini perbandingan angka, bukan penjelasan sebab di lapangan (stok, harga, cuaca, dan sebagainya tidak ada di data).');
    return {
      ok: true, paham, teks, catatan, link,
      tabel: { header: [pakaiDist ? 'Distributor' : 'Jenis semen', `${kol === 'tonase' ? 'Ton' : 'Omzet (Rp)'} ${lab(lalu)}`, `${kol === 'tonase' ? 'Ton' : 'Omzet (Rp)'} ${lab(b)}`, 'Selisih', 'Perubahan'], rows },
    };
  }

  /* ---------- 4. distributor yang perlu perhatian / paling naik-turun ---------- */
  if (!p.dists.length && /perlu (di)?perhati|paling (turun|anjlok|merosot|jeblok|naik|tumbuh)|menurun|memburuk|penurunan (terbesar|terbanyak)|pertumbuhan (terbesar|tertinggi|terendah|terbaik)|bermasalah|mengkhawatirkan/.test(q)) {
    const catatan: string[] = [];
    const b = bulanDasar(p, akhir, catatan), lalu = yoy ? { y: b.y - 1, m: b.m } : mundur(b);
    const m: Metrik = metrik;
    const baris = ctx.dists.map(d => {
      const A = angka(ctx, b, [d.code], p.jenis), B = angka(ctx, lalu, [d.code], p.jenis);
      return { d: d.code, kini: ambil(A, m), dulu: ambil(B, m), ta: A.ta, taDulu: B.ta };
    }).filter(x => x.kini || x.dulu).map(x => ({ ...x, pr: persen(x.kini, x.dulu) }));
    const naik = /paling (naik|tumbuh)|pertumbuhan (terbesar|tertinggi|terbaik)/.test(q);
    baris.sort((a, c) => (naik ? (c.pr ?? -1e9) - (a.pr ?? -1e9) : (a.pr ?? 1e9) - (c.pr ?? 1e9)));
    const paham = [naik ? 'Distributor paling tumbuh' : 'Distributor yang perlu perhatian', METRIK_LABEL[m], ...(p.jenis ? [JENIS_LABEL[p.jenis]] : []), `${lab(lalu)} → ${lab(b)}`];
    if (!baris.length) return { ok: true, paham, teks: 'Tidak ada data untuk dibandingkan.', catatan, link };
    const pilih = baris.filter(x => x.pr != null && (naik ? x.pr > 0 : x.pr < 0)).slice(0, 3);
    const teks = pilih.length
      ? `${naik ? 'Pertumbuhan' : 'Penurunan'} ${METRIK_LABEL[m].toLowerCase()} terbesar ${lab(b)} dibanding ${lab(lalu)}: ${pilih.map(x => `**${x.d}** (${tulisPersen(x.pr)}, ${tulis(m, x.dulu)} → ${tulis(m, x.kini)})`).join(', ')}.`
        + (naik ? '' : ` Dari ${nf(baris.length)} distributor, ${nf(baris.filter(x => (x.pr ?? 0) < 0).length)} turun dan ${nf(baris.filter(x => (x.pr ?? 0) > 0).length)} naik.`)
      : `Tidak ada distributor yang ${naik ? 'naik' : 'turun'} di ${lab(b)} dibanding ${lab(lalu)}.`;
    catatan.push(`Urutan menurut persen perubahan ${METRIK_LABEL[m].toLowerCase()} ${yoy ? 'dibanding bulan yang sama tahun lalu' : 'dibanding bulan sebelumnya'}. Tanpa subdist.`);
    const sel = (v: number) => (m === 'tonase' ? Math.round(v * 10) / 10 : Math.round(v));
    return {
      ok: true, paham, teks, catatan, link,
      tabel: { header: ['Distributor', `${METRIK_LABEL[m]} ${lab(lalu)}`, `${METRIK_LABEL[m]} ${lab(b)}`, 'Perubahan', `Toko aktif ${lab(lalu)}`, `Toko aktif ${lab(b)}`],
        rows: baris.map(x => [x.d, sel(x.dulu), sel(x.kini), tulisPersen(x.pr), x.taDulu, x.ta]) },
      chart: { labels: baris.map(x => x.d), values: baris.map(x => Math.round((x.pr ?? 0) * 10) / 10), satuan: '%' },
    };
  }

  /* ---------- 5. ringkasan kinerja ---------- */
  if (/ringkas|rangkum|kinerja|performa|bagaimana|gimana|kondisi|\bsummary\b|laporan singkat|kabar/.test(q) && (p.dists.length || /semua|keseluruhan|total|perusahaan|bnn/.test(q) || p.bulanDisebut)) {
    const catatan: string[] = [];
    const b = bulanDasar(p, akhir, catatan), lalu = mundur(b), thn = { y: b.y - 1, m: b.m };
    const A = angka(ctx, b, p.dists, p.jenis), B = angka(ctx, lalu, p.dists, p.jenis), C = angka(ctx, thn, p.dists, p.jenis);
    const paham = ['Ringkasan kinerja', p.dists.length ? p.dists.join(', ') : 'Semua distributor', ...(p.jenis ? [JENIS_LABEL[p.jenis]] : []), labPanjang(b)];
    if (!A.omzet && !A.tonase) return { ok: true, paham, teks: `Tidak ada transaksi ${cakupan} di ${labPanjang(b)}.`, catatan, link };
    const jenisTop = Object.entries(A.perJenis).sort((x, y) => y[1].tonase - x[1].tonase)[0];
    const pm = persen(A.tonase, B.tonase), py = persen(A.tonase, C.tonase);
    let teks = `${labPanjang(b)}, ${cakupan} menjual **${nf(A.tonase)} ton** senilai **${rupiah(A.omzet)}** dari ${nf(A.do)} DO ke **${nf(A.ta)} toko aktif**. `
      + `Tonase ${arah(pm)} dari ${lab(lalu)}${C.tonase ? ` dan ${arah(py)} dari ${lab(thn)}` : ''}.`;
    if (jenisTop && !p.jenis && A.tonase) teks += ` ${JENIS_LABEL[jenisTop[0] as Jenis]} menyumbang ${nf((jenisTop[1].tonase / A.tonase) * 100)}% tonase.`;
    const dTa = persen(A.ta, B.ta);
    if (dTa != null && Math.abs(dTa) >= 5) teks += ` Toko aktif ${dTa >= 0 ? 'bertambah' : 'berkurang'} ${nf(Math.abs(A.ta - B.ta))} toko dari bulan lalu.`;
    if (p.dists.length > 1) catatan.push('Toko yang dilayani lebih dari satu distributor bisa terhitung dua kali pada toko aktif gabungan.');
    catatan.push('Tanpa subdist. Toko aktif = belanja minimal Rp200 ribu dalam sebulan.');
    const baris = (nama: string, a: number, c: number, d: number, bulat = true) => [nama, bulat ? Math.round(a) : Math.round(a * 10) / 10, bulat ? Math.round(c) : Math.round(c * 10) / 10,
      tulisPersen(persen(a, c)), bulat ? Math.round(d) : Math.round(d * 10) / 10, tulisPersen(persen(a, d))];
    return {
      ok: true, paham, teks, catatan, link,
      tabel: { header: ['Ukuran', lab(b), lab(lalu), 'vs bulan lalu', lab(thn), 'vs tahun lalu'],
        rows: [baris('Omzet (Rp)', A.omzet, B.omzet, C.omzet), baris('Tonase', A.tonase, B.tonase, C.tonase, false), baris('Jumlah DO', A.do, B.do, C.do), baris('Toko aktif', A.ta, B.ta, C.ta)] },
    };
  }
  return null;
}
