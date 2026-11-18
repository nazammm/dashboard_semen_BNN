/* ============================================================================
   Tanya Data · pertanyaan tentang salesman (dari v_salesman_performance, tanpa subdist, tanpa sales counter).
   - paling konsisten / tidak konsisten : koefisien variasi tonase bulanan (makin kecil makin stabil)
   - tertinggi / terendah (omzet, tonase, toko aktif, DO) pada satu bulan atau rentang
   - capai / tidak capai target
   - berapa salesman (aktif)
   Hanya dipakai kalau akun punya akses halaman Tim Sales (ctx.sales tidak null).
============================================================================ */
import type { Row } from './types';
import { isSalesCounter } from './salesman';
import { BLN, BULAN, nf, rupiah, type Jawaban, type Paham } from './tanya';

type Ukuran = 'omzet' | 'tonase' | 'ta' | 'do';
const KOLOM: Record<Ukuran, string> = { omzet: 'actual_omzet', tonase: 'actual_tonase', ta: 'actual_ta', do: 'actual_num_do' };
const LABEL: Record<Ukuran, string> = { omzet: 'omzet', tonase: 'tonase', ta: 'toko aktif', do: 'jumlah DO' };
const tulisU = (u: Ukuran, v: number) => (u === 'omzet' ? rupiah(v) : u === 'tonase' ? `${nf(v, v < 100 ? 1 : 0)} ton` : u === 'ta' ? `${nf(v)} toko` : `${nf(v)} DO`);
const bulat = (u: Ukuran, v: number) => (u === 'tonase' ? Math.round(v * 10) / 10 : Math.round(v));

export const tanyaSalesman = (q: string) => /\bsales(man|men)?\b|\bsls\b|\bpenjual\b/.test(q) && !/sell\s*-?\s*(in|out)/.test(q);

export function jawabSales(p: Paham, sales: Row[] | null, akhir: { y: number; m: number }): Jawaban | null {
  const q = p.q;
  if (!tanyaSalesman(q)) return null;
  if (!sales) return { ok: false, paham: ['Salesman'], teks: 'Akun Anda tidak punya akses ke data salesman (halaman Tim Sales).', catatan: [] };
  const link = { to: '/tim-sales', label: 'Buka Tim Sales' };
  const u: Ukuran = p.metrik === 'tonase' ? 'tonase' : p.metrik === 'ta' ? 'ta' : p.metrik === 'do' ? 'do' : 'omzet';
  const dset = p.dists.length ? new Set(p.dists) : null;
  const bset = new Set(p.bulan);
  const rows = sales.filter(r => Number(r.tahun) === p.tahun && bset.has(Number(r.month)) && (!dset || dset.has(String(r.dist_code)))
    && (r.status === 'Sales Real' || r.status === 'Tanpa target') && !isSalesCounter(r));
  const cakupan = p.dists.length ? p.dists.join(', ') : 'semua distributor';
  const per = p.bulan.length === 1 ? `${BULAN[p.bulan[0]]} ${p.tahun}` : `${BLN[p.bulan[0]]}–${BLN[p.bulan[p.bulan.length - 1]]} ${p.tahun}`;
  const catatan = ['Sales counter tidak ikut. Angka tanpa subdist.'];
  if (!rows.length) return { ok: true, paham: ['Salesman', cakupan, per], teks: `Tidak ada data salesman ${cakupan} untuk ${per}.`, catatan, link };

  // gabung per salesman (kode + distributor)
  type S = { kode: string; nama: string; dist: string; bulan: Map<number, Row> };
  const map = new Map<string, S>();
  rows.forEach(r => {
    const k = `${r.dist_code}|${r.salesman_code}`;
    const s = map.get(k) || { kode: String(r.salesman_code), nama: String(r.salesman_name || r.salesman_code), dist: String(r.dist_code), bulan: new Map() };
    s.bulan.set(Number(r.month), r);
    map.set(k, s);
  });
  const semua = [...map.values()];
  const nilai = (s: S, uu: Ukuran) => [...s.bulan.values()].reduce((a, r) => a + Number(r[KOLOM[uu]] || 0), 0);

  /* ---------- konsisten ---------- */
  if (/konsisten|stabil|ajek|naik turun|fluktua|labil/.test(q)) {
    const tidak = /tidak konsisten|ga(k)? konsisten|nggak konsisten|kurang konsisten|paling tidak stabil|naik turun|fluktua|labil/.test(q);
    // rentang: tahun berjalan kalau bulan tidak disebut (bulan penuh saja)
    const bulanDipakai = [...bset].filter(m => !(p.tahun === akhir.y && m === akhir.m && !p.bulanDisebut)).sort((a, b) => a - b);
    const minBulan = Math.max(3, Math.ceil(bulanDipakai.length * 0.6));
    const hasil = semua.map(s => {
      const v = bulanDipakai.map(m => Number(s.bulan.get(m)?.[KOLOM.tonase] || 0));
      const ada = bulanDipakai.filter(m => s.bulan.has(m)).length;
      const rata = v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1);
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - rata) ** 2, 0) / Math.max(v.length, 1));
      const capai = bulanDipakai.filter(m => { const r = s.bulan.get(m); return r && Number(r.target_tonase) > 0 && Number(r.actual_tonase) >= Number(r.target_tonase); }).length;
      const bertarget = bulanDipakai.filter(m => Number(s.bulan.get(m)?.target_tonase || 0) > 0).length;
      return { s, v, ada, rata, cv: rata > 0 ? sd / rata : Infinity, capai, bertarget };
    }).filter(h => h.ada >= minBulan && h.rata > 0);
    if (!hasil.length) return { ok: true, paham: ['Konsistensi salesman', cakupan, per], teks: `Belum cukup data: perlu salesman yang tercatat minimal ${minBulan} bulan.`, catatan, link };
    // abaikan salesman dengan rata-rata sangat kecil (di bawah kuartil bawah) supaya yang stabil tapi nyaris nol tidak juara
    const rataUrut = hasil.map(h => h.rata).sort((a, b) => a - b), q1 = rataUrut[Math.floor(rataUrut.length * 0.25)];
    const pool = hasil.filter(h => h.rata >= q1).sort((a, b) => (tidak ? b.cv - a.cv : a.cv - b.cv));
    const top = pool.slice(0, 10), j = top[0];
    const label = `${BLN[bulanDipakai[0]]}–${BLN[bulanDipakai[bulanDipakai.length - 1]]} ${p.tahun}`;
    catatan.unshift(`Konsistensi = seberapa jauh tonase bulanan naik-turun dari rata-ratanya (koefisien variasi). Makin kecil makin stabil. Bulan berjalan tidak ikut. Hanya salesman yang tercatat minimal ${minBulan} dari ${bulanDipakai.length} bulan dan rata-ratanya tidak termasuk 25% terkecil.`);
    return {
      ok: true, link, catatan, paham: [tidak ? 'Salesman paling tidak konsisten' : 'Salesman paling konsisten', cakupan, label],
      teks: `Salesman ${tidak ? 'paling naik-turun' : 'paling konsisten'} ${cakupan} ${label}: **${j.s.nama}** (${j.s.dist}), rata-rata **${nf(j.rata)} ton per bulan** dengan simpangan ${nf(j.cv * 100)}% dari rata-ratanya`
        + (j.bertarget ? `, capai target tonase ${nf(j.capai)} dari ${nf(j.bertarget)} bulan.` : '.')
        + (top[1] ? ` Berikutnya ${top[1].s.nama} (${top[1].s.dist}, ${nf(top[1].cv * 100)}%)${top[2] ? ` dan ${top[2].s.nama} (${top[2].s.dist}, ${nf(top[2].cv * 100)}%)` : ''}.` : ''),
      tabel: { header: ['Salesman', 'Distributor', 'Rata-rata ton/bulan', 'Simpangan', 'Bulan terendah', 'Bulan tertinggi', 'Capai target'],
        rows: top.map(h => [h.s.nama, h.s.dist, Math.round(h.rata * 10) / 10, `${nf(h.cv * 100)}%`, Math.round(Math.min(...h.v) * 10) / 10, Math.round(Math.max(...h.v) * 10) / 10, h.bertarget ? `${h.capai}/${h.bertarget}` : '–']) },
      chart: { labels: top.map(h => h.s.nama), values: top.map(h => Math.round(h.cv * 1000) / 10), satuan: '%' },
    };
  }

  /* ---------- capai / tidak capai target ---------- */
  if (/target|capai|tercapai|achieve/.test(q)) {
    const gagal = /tidak (capai|mencapai|tercapai)|belum (capai|mencapai|tercapai)|gagal|di bawah target|kurang dari target|ga(k)? capai/.test(q);
    const m = p.bulan.length === 1 ? p.bulan[0] : (p.tahun === akhir.y ? akhir.m : p.bulan[p.bulan.length - 1]);
    const rs = rows.filter(r => Number(r.month) === m && Number(r.target_tonase) > 0).map(r => ({ r, pct: (Number(r.actual_tonase) / Number(r.target_tonase)) * 100 }));
    const pilih = rs.filter(x => (gagal ? x.pct < 100 : x.pct >= 100)).sort((a, b) => (gagal ? a.pct - b.pct : b.pct - a.pct));
    const lbl = `${BULAN[m]} ${p.tahun}`;
    if (p.bulan.length > 1) catatan.unshift(`Capaian target dihitung per bulan; dipakai ${lbl}.`);
    return {
      ok: true, link, catatan, paham: [gagal ? 'Salesman belum capai target' : 'Salesman capai target', cakupan, lbl, 'Target tonase'],
      teks: `${lbl}, **${nf(pilih.length)} dari ${nf(rs.length)} salesman** ${cakupan} ${gagal ? 'belum mencapai' : 'mencapai'} target tonase.`
        + (pilih[0] ? ` ${gagal ? 'Paling jauh' : 'Tertinggi'}: **${pilih[0].r.salesman_name}** (${pilih[0].r.dist_code}, ${nf(pilih[0].pct)}%).` : ''),
      tabel: { header: ['Salesman', 'Distributor', 'Target ton', 'Aktual ton', 'Capaian', 'Toko aktif / target'],
        rows: pilih.slice(0, 30).map(x => [String(x.r.salesman_name), String(x.r.dist_code), Math.round(Number(x.r.target_tonase)), Math.round(Number(x.r.actual_tonase) * 10) / 10, `${nf(x.pct)}%`,
          `${nf(x.r.actual_ta)} / ${Number(x.r.target_ta) ? nf(x.r.target_ta) : '–'}`]) },
    };
  }

  /* ---------- berapa salesman ---------- */
  if (/berapa (jumlah )?(sales|salesman)|jumlah (sales|salesman)|ada berapa/.test(q) && !/tertinggi|terbanyak|terbaik/.test(q)) {
    const m = p.bulan.length === 1 ? p.bulan[0] : (p.tahun === akhir.y ? akhir.m : p.bulan[p.bulan.length - 1]);
    const rs = rows.filter(r => Number(r.month) === m);
    const perDist = new Map<string, number>();
    rs.forEach(r => perDist.set(String(r.dist_code), (perDist.get(String(r.dist_code)) || 0) + 1));
    const tanpa = rs.filter(r => r.status === 'Tanpa target').length;
    return {
      ok: true, link, catatan, paham: ['Jumlah salesman', cakupan, `${BULAN[m]} ${p.tahun}`],
      teks: `${BULAN[m]} ${p.tahun} ada **${nf(rs.length)} salesman** ${cakupan}${tanpa ? `, ${nf(tanpa)} di antaranya belum punya target` : ''}.`,
      tabel: { header: ['Distributor', 'Salesman'], rows: [...perDist.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => [d, n]) },
    };
  }

  /* ---------- peringkat (bawaan) ---------- */
  const asc = /terendah|terkecil|paling (rendah|kecil|sedikit|jelek)|terburuk|tersedikit/.test(q);
  const hasil = semua.map(s => ({ s, v: nilai(s, u) / (u === 'ta' ? s.bulan.size : 1) })).filter(h => asc || h.v > 0).sort((a, b) => (asc ? a.v - b.v : b.v - a.v));
  const top = hasil.slice(0, 15), j = top[0];
  if (u === 'ta' && p.bulan.length > 1) catatan.unshift('Toko aktif per salesman adalah rata-rata per bulan.');
  return {
    ok: true, link, catatan, paham: [`Salesman ${asc ? 'terendah' : 'tertinggi'}`, LABEL[u], cakupan, per],
    teks: `Salesman dengan ${LABEL[u]} ${asc ? 'terendah' : 'tertinggi'} ${cakupan} ${per}: **${j.s.nama}** (${j.s.dist}) dengan **${tulisU(u, j.v)}**.`
      + (top[1] ? ` Berikutnya ${top[1].s.nama} (${top[1].s.dist}, ${tulisU(u, top[1].v)}).` : ''),
    tabel: { header: ['#', 'Salesman', 'Distributor', LABEL[u][0].toUpperCase() + LABEL[u].slice(1) + (u === 'omzet' ? ' (Rp)' : u === 'tonase' ? ' (ton)' : '')],
      rows: top.map((h, i) => [i + 1, h.s.nama, h.s.dist, bulat(u, h.v)]) },
    chart: { labels: top.map(h => h.s.nama), values: top.map(h => h.v), satuan: u === 'omzet' ? 'Rp' : u === 'tonase' ? 'ton' : u === 'ta' ? 'toko' : 'DO' },
  };
}
