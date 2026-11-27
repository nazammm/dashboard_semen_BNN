import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle, useSort } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, fmt, fmtCompact, fmtIDR, fmtIDRCompact, MONTHS_ID } from '../lib/format';
import type { Row } from '../lib/types';
import { JALUR_LABEL } from '../lib/logistikImport';
import { JENIS_PROMO } from '../lib/promoImport';
import { DataBadge } from '../components/DataStatus';
import { Card, ChartBox, ErrorBox, FileIcon, FilterBar, Kpi, PageHeader, PageSkeleton, Select, TableWrap, Th, cx } from '../components/ui';
import { exportRowsToExcel } from '../lib/xlsx';

/* ============================================================================
   Efektivitas Ongkos & Promo (25_efektivitas.sql). Tiga pertanyaan:
   1. Zona mana yang ongkirnya rugi: ongkir dibayar toko − bayar truk per ton (DO yang biaya perjalanannya lengkap), plus subsidi
      ongkir di tarif ERP (Subsidi + Subsidi 2 per zak) yang sudah diberikan.
   2. Truk jalan setengah kosong: berat muatan / kapasitas truk (J082), biaya per ton per kelompok isi.
   3. Promo ke toko (J078): biaya per promo, dan ton per bulan toko saat dapat promo dibanding bulan beli tanpa promo itu
      (toko yang sama, J073). Perbandingan kasar: tidak memperhitungkan musim / harga, jadi dipakai sebagai petunjuk, bukan bukti.
============================================================================ */

const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const nn = (v: unknown) => (v == null || v === '' ? null : Number(v));
const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 && t % 1 ? 1 : 0);
const fmtPct = (v: number | null, d = 0) => (v == null || !isFinite(v) ? '–' : fmt(v * 100, d) + '%');
const bln = (p: string) => `${MONTHS_ID[Number(p.slice(5, 7))]} ${p.slice(0, 4)}`;
const awalBulan = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
const KELOMPOK: Record<string, string> = { a_lt50: 'Di bawah 50%', b_50_80: '50–80%', c_80_95: '80–95%', d_penuh: 'Penuh (95–105%)', e_lebih: 'Lebih dari 105%' };
const EMBER_MARGIN = [
  { label: '< −100rb', min: -Infinity, max: -100000 }, { label: '−100rb … −50rb', min: -100000, max: -50000 }, { label: '−50rb … 0', min: -50000, max: 0 },
  { label: '0 … 50rb', min: 0, max: 50000 }, { label: '50rb … 100rb', min: 50000, max: 100000 }, { label: '> 100rb', min: 100000, max: Infinity },
];

export default function Efektivitas() {
  useDocTitle('Efektivitas Ongkos & Promo');
  const hari = new Date(Date.now() + 7 * 3600e3);
  const kini = awalBulan(hari);
  const [dari, setDari] = useState(() => { const d = new Date(hari); d.setMonth(d.getMonth() - 2); return awalBulan(d) < '2026-01-01' ? '2026-01-01' : awalBulan(d); });
  const [sampai, setSampai] = useState(kini);
  const info = useAsync(() => DataSource.ongkosInfo(), []);
  const zona = useAsync(() => DataSource.ongkosZona(dari, sampai), [dari, sampai]);
  const isi = useAsync(() => DataSource.isiTruk(dari, sampai), [dari, sampai]);
  const promo = useAsync(() => DataSource.promoBulanan(dari, sampai), [dari, sampai]);
  const efek = useAsync(() => DataSource.promoEfek(), []);
  const [dist, setDist] = useState('all');
  const [semenSaja, setSemenSaja] = useState(true);
  const bulanOpts = useMemo(() => {
    const o: { value: string; label: string }[] = [];
    for (let d = new Date(2026, 0, 1); awalBulan(d) <= kini; d.setMonth(d.getMonth() + 1)) o.push({ value: awalBulan(d), label: bln(awalBulan(d)) });
    return o;
  }, [kini]);
  const nama = useMemo(() => {
    const m = new Map<string, string>();
    (info.data || []).forEach((r: Row) => m.set(String(r.dist_code), String(r.kode || r.dist_code)));
    return m;
  }, [info.data]);
  const err = zona.error || isi.error || promo.error || efek.error;
  if (err) return <><PageHeader title="Efektivitas Ongkos & Promo" /><ErrorBox error={/v_promo|v_isi|v_ongkos_zona|Invalid object/i.test(String(err)) ? new Error('View efektivitas belum dibuat: jalankan 25_efektivitas.sql di SSMS (setelah 22_logistik.sql).') : err} /></>;
  const loading = !zona.data || !isi.data || !promo.data || !efek.data;
  const dists = [...new Set([...(zona.data || []), ...(isi.data || []), ...(promo.data || [])].map((r: Row) => String(r.dist_code)))].sort((a, b) => (nama.get(a) || a).localeCompare(nama.get(b) || b));
  const pakai = (r: Row) => dist === 'all' || String(r.dist_code) === dist;
  return (
    <>
      <PageHeader title="Efektivitas Ongkos & Promo" desc="Mana ongkos dan promo yang menghasilkan, mana yang perlu dikurangi" status={<DataBadge source={['ongkos', 'logistik', 'promo']} />} />
      <FilterBar label="Filter Efektivitas" stickyMobile={false}>
        <Select label="Distributor" value={dist} onChange={e => setDist(e.target.value)} style={{ minWidth: 150 }}
          options={[{ value: 'all', label: 'Semua distributor' }, ...dists.map(d => ({ value: d, label: nama.get(d) && nama.get(d) !== d ? `${nama.get(d)} (${d})` : d }))]} />
        <Select label="Dari bulan" value={dari} onChange={e => { setDari(e.target.value); if (e.target.value > sampai) setSampai(e.target.value); }} style={{ minWidth: 120 }} options={bulanOpts} />
        <Select label="Sampai bulan" value={sampai} onChange={e => { setSampai(e.target.value); if (e.target.value < dari) setDari(e.target.value); }} style={{ minWidth: 120 }} options={bulanOpts} />
        <Select label="Promo" value={semenSaja ? 'semen' : 'semua'} onChange={e => setSemenSaja(e.target.value === 'semen')} style={{ minWidth: 150 }}
          options={[{ value: 'semen', label: 'Produk semen saja' }, { value: 'semua', label: 'Semua produk' }]} />
      </FilterBar>
      {loading ? <PageSkeleton /> : (
        <Isi zona={zona.data!.filter(pakai)} isi={isi.data!.filter(pakai)} promo={promo.data!.filter(pakai)} efek={efek.data!.filter(pakai)}
          nama={nama} semua={dist === 'all'} semenSaja={semenSaja} judulPeriode={dari === sampai ? bln(dari) : `${bln(dari)} – ${bln(sampai)}`} />
      )}
    </>
  );
}

function Isi({ zona, isi, promo, efek, nama, semua, semenSaja, judulPeriode }: {
  zona: Row[]; isi: Row[]; promo: Row[]; efek: Row[]; nama: Map<string, string>; semua: boolean; semenSaja: boolean; judulPeriode: string;
}) {
  const { canDownload } = useAuth();
  const nm = (d: unknown) => nama.get(String(d)) || String(d);

  /* ---------- 1. zona ---------- */
  const z = useMemo(() => {
    const m = new Map<string, { dist: string; zona: string; tipe: string; jalur: string; ton: number; tonMargin: number; margin: number; tonTagih: number; tagih: number;
      tonLengkap: number; biaya: number; tonSubsidi: number; subsidi: number; doN: number }>();
    zona.forEach(r => {
      const k = `${r.dist_code}|${r.zona}|${r.tipe_kirim}`;
      const x = m.get(k) || { dist: String(r.dist_code), zona: String(r.zona), tipe: String(r.tipe_kirim || ''), jalur: String(r.jalur || ''), ton: 0, tonMargin: 0, margin: 0, tonTagih: 0, tagih: 0, tonLengkap: 0, biaya: 0, tonSubsidi: 0, subsidi: 0, doN: 0 };
      x.ton += n(r.ton); x.tonMargin += n(r.ton_margin); x.margin += n(r.margin); x.tonTagih += n(r.ton_tagih); x.tagih += n(r.tagih);
      x.tonLengkap += n(r.ton_lengkap); x.biaya += n(r.biaya_lengkap); x.tonSubsidi += n(r.ton_subsidi); x.subsidi -= n(r.subsidi);   // di tarif ERP subsidi ditulis minus (memotong ongkir): dibalik jadi biaya positif x.doN += n(r.jumlah_do);
      if (!x.jalur && r.jalur) x.jalur = String(r.jalur);
      m.set(k, x);
    });
    const rows = [...m.values()].filter(x => x.ton > 0.0005).map(x => ({ ...x, mTon: x.tonMargin > 0 ? x.margin / x.tonMargin : null,
      tagihTon: x.tonTagih > 0 ? x.tagih / x.tonTagih : null, biayaTon: x.tonLengkap > 0 ? x.biaya / x.tonLengkap : null, subsidiTon: x.tonSubsidi > 0 ? x.subsidi / x.tonSubsidi : null }));
    const ember = EMBER_MARGIN.map(e => ({ ...e, ton: rows.filter(x => x.mTon != null && x.mTon >= e.min && x.mTon < e.max).reduce((a, x) => a + x.tonMargin, 0) }));
    const rugi = rows.filter(x => x.mTon != null && x.mTon < 0);
    return {
      rows, ember, ton: rows.reduce((a, x) => a + x.ton, 0), tonMargin: rows.reduce((a, x) => a + x.tonMargin, 0), margin: rows.reduce((a, x) => a + x.margin, 0),
      rugiN: rugi.length, rugiTon: rugi.reduce((a, x) => a + x.tonMargin, 0), rugiRp: rugi.reduce((a, x) => a + x.margin, 0),
      subsidi: rows.reduce((a, x) => a + x.subsidi, 0), tonSubsidi: rows.reduce((a, x) => a + x.tonSubsidi, 0),
    };
  }, [zona]);

  /* ---------- 2. isi truk ---------- */
  const t = useMemo(() => {
    const kel = new Map<string, { trip: number; ton: number; tonB: number; biaya: number }>();
    const tipe = new Map<string, { tipe: string; trip: number; berat: number; kap: number; lt50: number; tonB: number; biaya: number }>();
    isi.forEach(r => {
      const k = String(r.kelompok);
      const a = kel.get(k) || { trip: 0, ton: 0, tonB: 0, biaya: 0 }; a.trip += n(r.trip); a.ton += n(r.ton); a.tonB += n(r.ton_berbiaya); a.biaya += n(r.biaya); kel.set(k, a);
      const tk = `${semua ? '' : ''}${r.tipe_truk}`;
      const b = tipe.get(tk) || { tipe: String(r.tipe_truk), trip: 0, berat: 0, kap: 0, lt50: 0, tonB: 0, biaya: 0 };
      b.trip += n(r.trip); b.berat += n(r.berat); b.kap += n(r.kapasitas); b.tonB += n(r.ton_berbiaya); b.biaya += n(r.biaya); if (k === 'a_lt50') b.lt50 += n(r.trip);
      tipe.set(tk, b);
    });
    const kelompok = Object.keys(KELOMPOK).map(k => ({ k, label: KELOMPOK[k], ...(kel.get(k) || { trip: 0, ton: 0, tonB: 0, biaya: 0 }) }))
      .map(x => ({ ...x, biayaTon: x.tonB > 0 ? x.biaya / x.tonB : null }));
    const trip = kelompok.reduce((a, x) => a + x.trip, 0);
    const lt50 = kelompok.find(x => x.k === 'a_lt50')!, penuh = kelompok.find(x => x.k === 'd_penuh')!;
    const hemat = lt50.biayaTon != null && penuh.biayaTon != null && lt50.biayaTon > penuh.biayaTon ? (lt50.biayaTon - penuh.biayaTon) * lt50.tonB : null;
    return { kelompok, trip, lt50, penuh, hemat, kurang80: kelompok.filter(x => x.k === 'a_lt50' || x.k === 'b_50_80').reduce((a, x) => a + x.trip, 0),
      tipe: [...tipe.values()].map(x => ({ ...x, isi: x.kap > 0 ? x.berat / x.kap : null, biayaTon: x.tonB > 0 ? x.biaya / x.tonB : null })).sort((a, b) => b.trip - a.trip) };
  }, [isi, semua]);

  /* ---------- 3. promo ---------- */
  const p = useMemo(() => {
    const rs = promo.filter(r => !semenSaja || r.semen === true || r.semen === 1 || r.semen === '1' || r.semen === 't');
    const produk = rs.filter(r => r.jenis === 'produk');
    const tonSemua = produk.reduce((a, r) => a + n(r.ton), 0), nilaiDo = produk.reduce((a, r) => a + n(r.nilai), 0);
    const m = new Map<string, { promo: string; jenis: string; biaya: number; ton: number; doN: number; tokoMaks: number; bulan: Set<string> }>();
    let pakaiVoucher = 0;
    rs.forEach(r => {
      if (r.jenis === 'pakai_voucher') { pakaiVoucher += n(r.nilai); return; }
      if (r.jenis !== 'potongan' && r.jenis !== 'voucher') return;
      const k = `${r.jenis}|${r.promo}`;
      const x = m.get(k) || { promo: String(r.promo), jenis: String(r.jenis), biaya: 0, ton: 0, doN: 0, tokoMaks: 0, bulan: new Set<string>() };
      x.biaya += n(r.nilai); x.ton += n(r.ton); x.doN += n(r.jumlah_do); x.tokoMaks = Math.max(x.tokoMaks, n(r.toko)); x.bulan.add(String(r.periode).slice(0, 7));
      m.set(k, x);
    });
    // efek (seluruh data J078, semua bulan): gabungan distributor ditimbang jumlah bulan
    const em = new Map<string, { tokoBanding: number; bs: number; bt: number; ts: number; tt: number; biaya: number }>();
    efek.forEach(r => {
      const k = `${r.jenis}|${r.promo}`;
      const x = em.get(k) || { tokoBanding: 0, bs: 0, bt: 0, ts: 0, tt: 0, biaya: 0 };
      const bs = n(r.bulan_saat), bt = n(r.bulan_tanpa);
      x.tokoBanding += n(r.toko_dibanding); x.bs += bs; x.bt += bt; x.ts += n(r.ton_saat) * bs; x.tt += n(r.ton_tanpa) * bt; x.biaya += n(r.biaya);
      em.set(k, x);
    });
    const rows = [...m.entries()].map(([k, x]) => {
      const e = em.get(k);
      const tonSaat = e && e.bs ? e.ts / e.bs : null, tonTanpa = e && e.bt ? e.tt / e.bt : null;
      const lift = tonSaat != null && tonTanpa ? tonSaat / tonTanpa - 1 : null;
      const tambahan = tonSaat != null && tonTanpa != null && e ? (tonSaat - tonTanpa) * e.bs : null;
      const biayaTambahan = tambahan && tambahan > 0 && e ? e.biaya / tambahan : null;
      const vonis = !e || e.tokoBanding < 5 || !e.bt ? 'kurang' : lift! <= 0 ? 'kurangi' : lift! < 0.1 ? 'lemah' : 'efektif';
      return { ...x, biayaTon: x.ton > 0 ? x.biaya / x.ton : null, tokoBanding: e?.tokoBanding ?? 0, tonSaat, tonTanpa, lift, biayaTambahan, vonis };
    }).sort((a, b) => b.biaya - a.biaya);
    const biaya = rows.reduce((a, x) => a + x.biaya, 0);
    const biayaKurangi = rows.filter(x => x.vonis === 'kurangi').reduce((a, x) => a + x.biaya, 0);
    return { rows, biaya, tonSemua, nilaiDo, pakaiVoucher, biayaKurangi };
  }, [promo, efek, semenSaja]);

  const zs = useSort(z.rows, 'margin', 'asc', (x, k) => (k === 'zona' ? x.zona : k === 'ton' ? x.ton : k === 'tagih' ? x.tagihTon : k === 'biaya' ? x.biayaTon
    : k === 'subsidi' ? x.subsidiTon : k === 'mton' ? x.mTon : k === 'margin' ? (x.tonMargin > 0 ? x.margin : null) : null));
  const ps = useSort(p.rows, 'biaya', 'desc', (x, k) => (k === 'promo' ? x.promo : k === 'biaya' ? x.biaya : k === 'ton' ? x.ton : k === 'bton' ? x.biayaTon
    : k === 'lift' ? x.lift : k === 'btambah' ? x.biayaTambahan : null));
  const th = (s: typeof zs | typeof ps, k: string, label: string, num = false, title?: string) =>
    <Th sortable num={num} ariaSort={s.ariaSort(k)} onSort={() => s.toggle(k)} title={title}>{label}</Th>;
  const [semuaZona, setSemuaZona] = useState(false);

  const unduh = () => exportRowsToExcel([
    { name: 'Ongkir per zona', header: ['Distributor', 'Zona', 'Tipe kirim', 'Jalur', 'Ton', 'Ongkir dibayar toko per ton', 'Bayar truk per ton', 'Subsidi ongkir per ton', 'Margin per ton', 'Margin (Rp)', 'Ton dihitung margin'],
      rows: z.rows.map(x => [nm(x.dist), x.zona, x.tipe, JALUR_LABEL[x.jalur] || x.jalur, x.ton, x.tagihTon, x.biayaTon, x.subsidiTon, x.mTon, x.tonMargin > 0 ? x.margin : null, x.tonMargin]),
      widths: [10, 28, 10, 16, 10, 14, 14, 14, 13, 14, 12] },
    { name: 'Isi truk', header: ['Tipe truk', 'Trip', 'Rata-rata isi', 'Trip isi < 50%', 'Biaya per ton'], rows: t.tipe.map(x => [x.tipe, x.trip, x.isi, x.lt50, x.biayaTon]), widths: [30, 8, 12, 12, 14] },
    { name: 'Promo', header: ['Promo', 'Jenis', 'DO', 'Ton', 'Biaya (Rp)', 'Biaya per ton', 'Toko dibanding', 'Ton/bulan saat promo', 'Ton/bulan tanpa promo', 'Kenaikan', 'Biaya per ton tambahan', 'Penilaian'],
      rows: p.rows.map(x => [x.promo, JENIS_PROMO[x.jenis] || x.jenis, x.doN, x.ton, x.biaya, x.biayaTon, x.tokoBanding, x.tonSaat, x.tonTanpa, x.lift, x.biayaTambahan, VONIS[x.vonis].label]),
      widths: [30, 16, 8, 10, 14, 12, 10, 12, 12, 10, 14, 22] },
  ], `Efektivitas_ongkos_promo.xlsx`, 'efektivitas');

  return (
    <>
      {canDownload('efektivitas') && <div className="flex justify-end -mt-2 mb-3"><button type="button" className="btn" onClick={unduh}><FileIcon />Download Excel</button></div>}

      {/* ---------- 1 ---------- */}
      <h2 className="section-title !mt-0">1. Ongkir per zona · {judulPeriode}</h2>
      <div className="grid-kpi">
        <Kpi title="Margin ongkir" value={<span className={z.margin < 0 ? 'text-red' : 'text-green'}>{fmtIDRCompact(z.margin)}</span>}
          delta={<span className="text-faint text-[11.5px]">ongkir dibayar toko − bayar truk, {fmtTon(z.tonMargin)} dari {fmtTon(z.ton)} ton yang lengkap datanya</span>} />
        <Kpi title="Zona rugi" value={fmt(z.rugiN)} unit="zona"
          delta={<span className="text-faint text-[11.5px]">{fmtTon(z.rugiTon)} ton, rugi {fmtIDRCompact(-z.rugiRp)}</span>} />
        <Kpi title="Subsidi ongkir di tarif" value={fmtIDRCompact(z.subsidi)}
          delta={<span className="text-faint text-[11.5px]">{z.tonSubsidi > 0 ? `${fmtIDR(z.subsidi / z.tonSubsidi)} per ton, ` : ''}Subsidi + Subsidi 2 di harga ERP</span>} />
        <Kpi title="Margin per ton" value={z.tonMargin > 0 ? fmtIDR(z.margin / z.tonMargin) : '–'} delta={<span className="text-faint text-[11.5px]">rata-rata semua zona</span>} />
      </div>
      <Card className="mt-3.5">
        <div className="card-title">Sebaran margin ongkir per ton (ton per kelompok zona)</div>
        <ChartBox label={`Ton menurut margin ongkir per ton: ${z.ember.map(e => `${e.label} ${fmtTon(e.ton)} ton`).join('; ')}`}
          deps={[z.ember.map(e => e.ton).join(',')]}
          build={() => ({
            type: 'bar',
            data: { labels: z.ember.map(e => e.label), datasets: [{ data: z.ember.map(e => e.ton), backgroundColor: z.ember.map(e => (e.max <= 0 ? COLORS.red : COLORS.green)), maxBarThickness: 48 }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: COLORS.line }, ticks: { callback: (x: any) => fmtCompact(x) } }, x: { grid: { display: false } } },
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => ` ${fmt(c.parsed.y)} ton` } } } },
          })} />
        <p className="text-faint text-[12px] mt-2">Merah = zona yang ongkir dari tokonya tidak menutup bayar truk. Hanya DO yang biaya perjalanannya lengkap dan ongkir tokonya bisa dihitung.</p>
      </Card>
      <TableWrap className="mt-3.5">
        <table className="tbl-dense">
          <thead><tr>
            {semua && <Th>Distributor</Th>}{th(zs, 'zona', 'Zona')}<Th>Tipe</Th>{th(zs, 'ton', 'Ton', true)}
            {th(zs, 'tagih', 'Ongkir toko / ton', true)}{th(zs, 'biaya', 'Bayar truk / ton', true)}{th(zs, 'subsidi', 'Subsidi / ton', true, 'Subsidi + Subsidi 2 di tarif ERP')}
            {th(zs, 'mton', 'Margin / ton', true)}{th(zs, 'margin', 'Margin', true)}<Th>Saran</Th>
          </tr></thead>
          <tbody>
            {(semuaZona ? zs.sorted : zs.sorted.slice(0, 25)).map(x => (
              <tr key={`${x.dist}|${x.zona}|${x.tipe}`}>
                {semua && <td>{nm(x.dist)}</td>}
                <td className="text-[12.5px]">{x.zona}{x.jalur && <span className="text-faint"> · {JALUR_LABEL[x.jalur] || x.jalur}</span>}</td>
                <td className="text-[12px]">{x.tipe || '–'}</td>
                <td className="num font-mono">{fmtTon(x.ton)}</td>
                <td className="num font-mono">{x.tagihTon == null ? '–' : fmtIDR(x.tagihTon)}</td>
                <td className="num font-mono">{x.biayaTon == null ? '–' : fmtIDR(x.biayaTon)}</td>
                <td className="num font-mono">{x.subsidiTon == null ? '–' : fmtIDR(x.subsidiTon)}</td>
                <td className={cx('num font-mono', x.mTon != null && (x.mTon < 0 ? 'text-red' : 'text-green'))}>{x.mTon == null ? '–' : fmtIDR(x.mTon)}</td>
                <td className={cx('num font-mono', x.tonMargin > 0 && (x.margin < 0 ? 'text-red' : 'text-green'))}>{x.tonMargin > 0 ? fmtIDRCompact(x.margin) : '–'}</td>
                <td className="text-[12px]">{x.mTon == null ? <span className="text-faint">data belum lengkap</span>
                  : x.mTon < 0 && /^LG/i.test(x.tipe) ? 'DO ambil sendiri tapi diantar: tagih ongkir'
                  : x.mTon < 0 ? (x.subsidiTon && x.subsidiTon > 0 ? 'Kurangi subsidi / naikkan tarif' : 'Naikkan tarif / truk lebih besar')
                  : <span className="text-soft">Aman</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {z.rows.length > 25 && <button type="button" className="btn mt-2" onClick={() => setSemuaZona(v => !v)}>{semuaZona ? 'Tampilkan 25 saja' : `Tampilkan semua ${fmt(z.rows.length)} zona`}</button>}

      {/* ---------- 2 ---------- */}
      <h2 className="section-title">2. Isi truk · {judulPeriode}</h2>
      {t.trip === 0 ? <p className="text-soft text-[13px]">Belum ada data tipe & kapasitas truk. Datanya dari job ERP J082 (Nazam Auto Task, bagian Ongkos kirim), atau upload J082 di <Link to="/kelola-data?data=ongkos&menu=logistik">Kelola Data</Link>.</p> : (
        <>
          <div className="grid-kpi">
            <Kpi title="Truk terisi < 50%" value={fmtPct(t.lt50.trip / t.trip)} delta={<span className="text-faint text-[11.5px]">{fmt(t.lt50.trip)} dari {fmt(t.trip)} perjalanan ke toko</span>} />
            <Kpi title="Truk terisi < 80%" value={fmtPct(t.kurang80 / t.trip)} delta={<span className="text-faint text-[11.5px]">{fmt(t.kurang80)} perjalanan</span>} />
            <Kpi title="Biaya per ton: isi < 50% vs penuh" value={t.lt50.biayaTon != null ? fmtIDRCompact(t.lt50.biayaTon) : '–'}
              delta={<span className="text-faint text-[11.5px]">truk penuh {t.penuh.biayaTon != null ? fmtIDRCompact(t.penuh.biayaTon) : '–'} per ton</span>} />
            <Kpi title="Potensi hemat" value={t.hemat != null ? fmtIDRCompact(t.hemat) : '–'}
              delta={<span className="text-faint text-[11.5px]">kalau muatan truk &lt; 50% dibayar setara truk penuh per ton</span>} />
          </div>
          <div className="grid gap-3.5 mt-3.5 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-[960px]:grid-cols-1">
            <Card>
              <div className="card-title">Biaya per ton menurut isi truk</div>
              <ChartBox label={`Biaya per ton menurut isi truk: ${t.kelompok.map(x => `${x.label} ${x.biayaTon != null ? fmtIDR(x.biayaTon) : '-'} (${x.trip} trip)`).join('; ')}`}
                deps={[t.kelompok.map(x => `${x.trip}:${x.biayaTon}`).join(',')]}
                build={() => ({
                  type: 'bar',
                  data: { labels: t.kelompok.map(x => [x.label, `${fmt(x.trip)} trip`]), datasets: [{ data: t.kelompok.map(x => x.biayaTon), backgroundColor: t.kelompok.map(x => (x.k === 'a_lt50' ? COLORS.red : x.k === 'b_50_80' ? COLORS.amber : COLORS.accent)), maxBarThickness: 44 }] } as any,
                  options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: COLORS.line }, ticks: { callback: (x: any) => fmtCompact(x) } }, x: { grid: { display: false } } },
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => ` ${fmtIDR(c.parsed.y)} per ton` } } } },
                })} />
            </Card>
            <TableWrap className="self-start">
              <table className="tbl-dense">
                <thead><tr><Th>Tipe truk</Th><Th num>Trip</Th><Th num>Rata-rata isi</Th><Th num>Trip &lt; 50%</Th><Th num>Biaya / ton</Th></tr></thead>
                <tbody>{t.tipe.slice(0, 12).map(x => (
                  <tr key={x.tipe}>
                    <td className="text-[12.5px]">{x.tipe}</td><td className="num font-mono">{fmt(x.trip)}</td>
                    <td className={cx('num font-mono', x.isi != null && x.isi < 0.6 && 'text-red')}>{fmtPct(x.isi)}</td>
                    <td className="num font-mono">{fmt(x.lt50)}</td><td className="num font-mono">{x.biayaTon == null ? '–' : fmtIDR(x.biayaTon)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </TableWrap>
          </div>
          <p className="text-faint text-[12px] mt-2">Isi truk = total berat muatan (J082 Total Berat) dibagi kapasitas truk (Truk Max Tonase). Biaya per ton hanya dari perjalanan yang biayanya ada. Truk yang sering setengah kosong: gabungkan pengiriman per rute atau pakai truk lebih kecil.</p>
        </>
      )}

      {/* ---------- 3 ---------- */}
      <h2 className="section-title">3. Promo & subsidi ke toko · {judulPeriode}</h2>
      {p.rows.length === 0 ? <p className="text-soft text-[13px]">Belum ada data promo. Datanya dari job ERP J078 DO Promo Detail (Nazam Auto Task), atau upload di <Link to="/kelola-data?data=ongkos&menu=promo">Kelola Data</Link>.</p> : (
        <>
          <div className="grid-kpi">
            <Kpi title="Biaya promo" value={fmtIDRCompact(p.biaya)} delta={<span className="text-faint text-[11.5px]">potongan langsung + cash back voucher diberikan</span>} />
            <Kpi title="Biaya promo per ton" value={p.tonSemua > 0 ? fmtIDR(p.biaya / p.tonSemua) : '–'} delta={<span className="text-faint text-[11.5px]">dibagi {fmtTon(p.tonSemua)} ton di DO J078</span>} />
            <Kpi title="Terhadap nilai DO" value={fmtPct(p.nilaiDo > 0 ? p.biaya / p.nilaiDo : null, 1)} delta={<span className="text-faint text-[11.5px]">nilai DO kotor {fmtIDRCompact(p.nilaiDo)}</span>} />
            <Kpi title="Promo tidak menambah volume" value={<span className={p.biayaKurangi > 0 ? 'text-red' : ''}>{fmtIDRCompact(p.biayaKurangi)}</span>}
              delta={<span className="text-faint text-[11.5px]">{fmt(p.rows.filter(x => x.vonis === 'kurangi').length)} promo, kandidat dikurangi</span>} />
          </div>
          <TableWrap className="mt-3.5">
            <table className="tbl-dense">
              <thead><tr>
                {th(ps, 'promo', 'Promo')}<Th>Jenis</Th><Th num>DO</Th>{th(ps, 'ton', 'Ton', true)}{th(ps, 'biaya', 'Biaya', true)}{th(ps, 'bton', 'Biaya / ton', true)}
                <Th num title="Rata-rata ton per toko per bulan: bulan dapat promo / bulan beli tanpa promo (toko yang sama, semua bulan J078)">Ton/bulan saat vs tanpa</Th>
                {th(ps, 'lift', 'Kenaikan', true)}{th(ps, 'btambah', 'Biaya / ton tambahan', true, 'Biaya promo dibagi ton tambahan dibanding bulan tanpa promo')}<Th>Penilaian</Th>
              </tr></thead>
              <tbody>{ps.sorted.slice(0, 40).map(x => (
                <tr key={x.jenis + x.promo}>
                  <td className="text-[12.5px]">{x.promo}</td><td className="text-[12px]">{JENIS_PROMO[x.jenis] || x.jenis}</td>
                  <td className="num font-mono">{fmt(x.doN)}</td><td className="num font-mono">{fmtTon(x.ton)}</td>
                  <td className="num font-mono">{fmtIDRCompact(x.biaya)}</td><td className="num font-mono">{x.biayaTon == null ? '–' : fmtIDR(x.biayaTon)}</td>
                  <td className="num font-mono whitespace-nowrap">{x.tonSaat == null || x.tonTanpa == null ? '–' : `${fmt(x.tonSaat, 1)} vs ${fmt(x.tonTanpa, 1)}`}</td>
                  <td className={cx('num font-mono', x.lift != null && (x.lift <= 0 ? 'text-red' : x.lift >= 0.1 ? 'text-green' : ''))}>{x.lift == null ? '–' : (x.lift > 0 ? '+' : '') + fmtPct(x.lift)}</td>
                  <td className="num font-mono">{x.biayaTambahan == null ? '–' : fmtIDR(x.biayaTambahan)}</td>
                  <td className={cx('text-[12px]', VONIS[x.vonis].cls)}>{VONIS[x.vonis].label}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableWrap>
          <p className="text-faint text-[12px] mt-2">
            Kenaikan = ton per bulan toko saat dapat promo dibanding bulan toko itu membeli tanpa promo tersebut (J073, toko yang sama, semua bulan sejak data J078 ada).
            Ini petunjuk, bukan bukti: musim, perubahan harga, dan promo lain di bulan yang sama ikut berpengaruh. Penilaian butuh minimal 5 toko pembanding.
            {p.pakaiVoucher > 0 && ` Pemakaian voucher lama ${fmtIDRCompact(p.pakaiVoucher)} tidak dihitung lagi (sudah dihitung saat voucher diberikan).`}
          </p>
        </>
      )}
    </>
  );
}

const VONIS: Record<string, { label: string; cls: string }> = {
  efektif: { label: 'Efektif', cls: 'text-green' },
  lemah: { label: 'Lemah (naik < 10%)', cls: 'text-amber' },
  kurangi: { label: 'Tidak menambah volume, kurangi', cls: 'text-red' },
  kurang: { label: 'Data belum cukup', cls: 'text-faint' },
};
