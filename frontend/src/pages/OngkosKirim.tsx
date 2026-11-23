import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ChartConfiguration } from 'chart.js';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle, useSort } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, fmt, fmtIDR, fmtIDRCompact } from '../lib/format';
import { MONTHS_FULL, fmtDate } from '../lib/dates';
import type { Row } from '../lib/types';
import { kapasitasTruk } from '../lib/ordbImport';
import { DataBadge } from '../components/DataStatus';
import { Card, ChartBox, ErrorBox, FileIcon, FilterBar, Kpi, PageHeader, PageSkeleton, Select, TableWrap, Th, cx } from '../components/ui';
import { exportRowsToExcel } from '../lib/xlsx';

/* ============================================================================
   Ongkos Kirim: ongkos kirim dari gudang distributor ke toko.
   - Ongkos real  : yang dibayar ke transporter, dari laporan ORDB019 (per perjalanan / No Foad, per DO).
   - Ongkir dibayar toko (ditagih): bagian harga DO di atas harga ambil sendiri. J073: Product Price = harga Loco + Delivery Price
     − Delivery Discount + Delivery Add + Handling Cost. Urutan: kolom Delivery diisi -> (DP − DDP + DAP + Handling) × qty;
     kosong pada DO kirim -> tarif resmi ERP per tipe kirim x zona (Net Price − (Price − Discount)) × qty; belum ada tarifnya ->
     (Product Price − harga Loco kolom Price, gudang sama) × qty. Diskon / promo / cash back = potongan
     harga semen per toko, tidak dihitung sebagai potongan ongkir.
   - Margin       : ongkir dibayar toko − bayar truk, dari DO yang sama. Plus = untung (hijau), minus = rugi / ditanggung distributor.
   Angkutan ke gudang (baris ORDB019 tanpa No DO) dipisah dan tidak masuk hitungan ke toko.
   Status transporter (20_ongkos_insight.sql): armada sendiri = biaya di luar ERP, truk toko = memang tanpa biaya.
   Angka per ton dan per omzet hanya memakai DO yang semua perjalanannya sudah ada biayanya (tagihan
   transporter sering masuk belakangan); bagian yang belum lengkap ditunjukkan di peringatan atas.
============================================================================ */

const TIPE: Record<string, string> = { FF: 'Kirim dibongkar', FT: 'Kirim tanpa bongkar', FTK1: 'Tanpa bongkar · 1 kontainer', LG: 'Ambil di gudang' };
const tipeLabel = (t: string) => (t === '?' ? 'Belum ada di J073' : `${t} · ${TIPE[t] || t}`);
const n = (v: unknown) => Number(v || 0);
const fmtTon = (t: number) => fmt(t, t > 0 && t < 10 ? 1 : 0);
const perTon = (rp: number, ton: number) => (ton > 0 ? rp / ton : null);
const fmtRpTon = (v: number | null) => (v == null ? '–' : fmt(v));
/* Satuan tampilan. Ongkos truk dihitung per muatan (ton), jadi per zak = per ton x berat zak:
   zak 50 kg = 1/20 ton, zak 40 kg = 1/25 ton. Zak 40 kg ongkosnya 80% zak 50 kg (truk membawa ton, bukan zak). */
type Satuan = { f: number; lbl: string; kata: string };
const SATUAN_OPTS = [{ value: 'ton', label: 'Rp per ton' }, { value: 'zak50', label: 'Rp per zak 50 kg' }, { value: 'zak40', label: 'Rp per zak 40 kg' }];
const satuanOf = (s: string): Satuan => (s === 'zak50' ? { f: 0.05, lbl: '/zak 50 kg', kata: 'per zak 50 kg' }
  : s === 'zak40' ? { f: 0.04, lbl: '/zak 40 kg', kata: 'per zak 40 kg' } : { f: 1, lbl: '/ton', kata: 'per ton' });
const SEGMEN_OPTS = [{ value: 'all', label: 'Retail + proyek' }, { value: 'RETAIL', label: 'Retail' }, { value: 'PROJECT', label: 'Proyek' }];
/** Margin = ongkir dibayar toko − bayar truk. Plus = untung (hijau), minus = rugi / ditanggung distributor (merah). */
const judulMargin = (v: number) => (v > 0 ? 'Untung: ongkir dari toko lebih besar dari bayar truk' : v < 0 ? 'Rugi: bayar truk lebih besar dari ongkir dari toko, selisihnya ditanggung distributor' : undefined);
const warnaMargin = (v: number) => cx(v > 0 && 'text-green font-semibold', v < 0 && 'text-red');
const Margin = ({ v, compact }: { v: number; compact?: boolean }) => (
  <span className={warnaMargin(v)} title={judulMargin(v)}>{v > 0 ? '+' : ''}{compact ? fmtIDRCompact(v) : fmtIDR(v)}</span>
);
const MarginSatuan = ({ v }: { v: number }) => <span className={warnaMargin(v)} title={judulMargin(v)}>{v > 0 ? '+' : ''}{fmt(v)}</span>;
const fmtPct = (v: number | null, d = 1) => (v == null || !isFinite(v) ? '–' : fmt(v * 100, d) + '%');
const judul = (s: unknown) => String(s ?? '').toLowerCase().replace(/(^|[\s(/.-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
/** "ISA065 - PT GLOBAL TRANSPORTINDO PRIMA" → "Global Transportindo Prima" */
const namaTransporter = (s: unknown) => judul(String(s ?? '').replace(/^[A-Z0-9]+\s*-\s*/i, '').replace(/^(PT|CV|UD|PD)\.?\s+/i, '')) || 'Tanpa transporter';
const namaTruk = (s: unknown) => judul(String(s ?? '').replace(/\s*\(([^)]*)\)/, ' $1').replace(/ TON\b/i, ' t').replace('FIT', 'ft')) || 'Tanpa tipe';
const bulanLabel = (iso: string) => `${MONTHS_FULL[Number(iso.slice(5, 7))]} ${iso.slice(0, 4)}`;

const SUMBER: Record<string, string> = { rincian: 'kolom Delivery J073', tarif: 'tarif resmi per zona', harga: 'harga DO − Loco', lg: 'ambil sendiri', kosong: 'belum bisa dihitung' };
interface DoRow {
  dist: string; periode: string; doNo: string; biaya: number; ton: number; tanpaBiaya: number; luarErp: boolean;
  sumber: string | null; locoTon: number | null; hargaTon: number | null;
  truk: string; transporter: string; zona: string; segmen: string; cust: string; toko: string; tipe: string;
  omzet: number | null; tagih: number | null; lengkap: boolean;
}
interface Trip {
  dist: string; periode: string; foad: string; transporter: string; truk: string; zona: string; tujuan: string; segmen: string; ritase: number; biaya: number; ton: number;
  keGudang: boolean; status: string;
}

export default function OngkosKirim() {
  useDocTitle('Ongkos Kirim');
  const info = useAsync(() => DataSource.ongkosInfo(), []);
  if (info.error) return <ErrorBox error={info.error} />;
  if (!info.data) return <PageSkeleton />;
  if (!info.data.length) return <EmptyState />;
  return <Body info={info.data} />;
}

function EmptyState() {
  const { pageAllowed } = useAuth();
  return (
    <>
      <PageHeader title="Ongkos Kirim" status={<DataBadge source="ongkos" />} />
      <div className="card max-w-[640px]">
        <h2 className="!text-[20px]">Belum ada data ongkos kirim</h2>
        <p className="text-soft text-[13.5px] mt-2 leading-relaxed">
          Halaman ini membandingkan ongkos kirim ke toko yang benar-benar dibayar ke transporter (laporan ORDB019) dengan ongkos yang ditagih ke toko di DO (J073).
          Upload ORDB019 per distributor per bulan di Kelola Data, atau biarkan Nazam Auto Task mengunduh dan mengunggahnya.
        </p>
        {pageAllowed('kelola-data') && <Link to="/kelola-data?data=ongkos" className="btn btn-primary no-underline mt-4">Upload ORDB019</Link>}
      </div>
    </>
  );
}

function Body({ info }: { info: Row[] }) {
  const { canDownload } = useAuth();
  const dists = useMemo(() => {
    const m = new Map<string, { code: string; kode: string; nama: string }>();
    info.forEach(r => m.set(String(r.dist_code), { code: String(r.dist_code), kode: String(r.kode), nama: String(r.nama) }));
    return [...m.values()].sort((a, b) => a.kode.localeCompare(b.kode));
  }, [info]);
  const [dist, setDist] = useState(() => (dists.length === 1 ? dists[0].code : 'all'));
  const periodes = useMemo(() => [...new Set(info.filter(r => dist === 'all' || r.dist_code === dist).map(r => String(r.periode).slice(0, 10)))].sort().reverse(), [info, dist]);
  const [bulan, setBulan] = useState(() => periodes[0]);
  const bulanOk = bulan === '3' || periodes.includes(bulan) ? bulan : periodes[0];
  const [dari, sampai] = bulanOk === '3' ? [periodes[Math.min(2, periodes.length - 1)], periodes[0]] : [bulanOk, bulanOk];
  const [tipe, setTipe] = useState('all');
  const [trans, setTrans] = useState('all');
  const [zonaBuka, setZonaBuka] = useState<Set<string>>(() => new Set());
  const [satuan, setSatuan] = useState('zak50');
  const [segmen, setSegmen] = useState('all');
  const S = satuanOf(satuan);
  const rp = (x: number | null) => (x == null ? '–' : fmt(x * S.f));

  const load = useAsync(async () => {
    const d = dist === 'all' ? null : [dist];
    const [trips, dos] = await Promise.all([DataSource.ongkosTrip(d, dari, sampai), DataSource.ongkosDo(d, dari, sampai)]);
    return { trips, dos };
  }, [dist, dari, sampai]);

  const data = useMemo(() => {
    if (!load.data) return null;
    const trips: Trip[] = load.data.trips.filter(r => n(r.ton) > 0).map(r => ({
      dist: String(r.dist_code), periode: String(r.periode).slice(0, 10), foad: String(r.foad), transporter: namaTransporter(r.transporter),
      truk: String(r.truk || ''), zona: judul(r.zona) || 'Tanpa zona', tujuan: judul(r.tujuan) || judul(r.zona) || 'Tanpa tujuan',
      segmen: String(r.segmen || '').toUpperCase(), ritase: n(r.harga_ritase), biaya: n(r.biaya), ton: n(r.ton),
      keGudang: r.ke_gudang === true || r.ke_gudang === 1 || r.ke_gudang === '1', status: String(r.status_transporter || 'normal'),
    }));
    const dos: DoRow[] = load.data.dos.map(r => {
      const tipeKirim = r.tipe_kirim ? String(r.tipe_kirim) : '?';
      return {
        dist: String(r.dist_code), periode: String(r.periode).slice(0, 10), doNo: String(r.do_no), biaya: n(r.biaya), ton: n(r.ton_kirim),
        tanpaBiaya: n(r.trip_tanpa_biaya), truk: String(r.truk || ''), transporter: namaTransporter(r.transporter), zona: judul(r.zona) || 'Tanpa zona',
        segmen: String(r.segmen || '').toUpperCase(),
        cust: String(r.customer_code ?? ''), toko: r.customer_name ? String(r.customer_name) : '', tipe: tipeKirim,
        omzet: r.omzet == null ? null : n(r.omzet), tagih: r.tagih == null || tipeKirim === '?' ? null : n(r.tagih),
        // lengkap: semua perjalanan sudah ada biaya (truk toko memang tanpa biaya)
        lengkap: n(r.trip_tanpa_biaya) === 0 && (n(r.biaya) > 0 || n(r.trip_truk_toko) > 0),
        luarErp: n(r.trip_luar_erp) > 0, sumber: r.tagih_sumber == null ? null : String(r.tagih_sumber),
        locoTon: r.loco_per_ton == null ? null : n(r.loco_per_ton), hargaTon: r.harga_per_ton == null ? null : n(r.harga_per_ton),
      };
    });
    return { trips, dos };
  }, [load.data]);

  const transporters = useMemo(() => [...new Set((data?.trips || []).map(t => t.transporter))].sort(), [data]);
  const tipes = useMemo(() => [...new Set((data?.dos || []).map(d => d.tipe))].sort((a, b) => (a === '?' ? 1 : b === '?' ? -1 : a.localeCompare(b))), [data]);
  const transOk = trans === 'all' || transporters.includes(trans) ? trans : 'all';
  const tipeOk = tipe === 'all' || tipes.includes(tipe) ? tipe : 'all';

  const v = useMemo(() => (data ? hitung(data.trips.filter(t => segmen === 'all' || t.segmen === segmen), data.dos.filter(d => segmen === 'all' || d.segmen === segmen), tipeOk, transOk) : null),
    [data, tipeOk, transOk, segmen]);

  // tabel zona: klik judul kolom untuk mengurutkan (seperti halaman Tim Sales)
  const zonaSort = useSort(v?.zona ?? [], 'ton', 'desc', (z, k) => (
    k === 'nama' ? z.nama : k === 'ton' ? z.ton : k === 'real' ? (z.tonTagih ? perTon(z.biayaTagih, z.tonTagih) : perTon(z.biaya, z.ton)) : k === 'tagih' ? (z.tonTagih ? perTon(z.tagih, z.tonTagih) : null)
      : k === 'margin' ? (z.tonTagih ? z.tanggung : null) : k === 'marginTon' ? (z.tonTagih ? perTon(z.tanggung, z.tonTagih) : null) : z.omzet ? z.biayaOmzet / z.omzet : null));
  const zh = (k: string, text: ReactNode, num = true, title?: string) => (
    <Th sortable num={num} ariaSort={zonaSort.ariaSort(k)} onSort={() => zonaSort.toggle(k)} title={title}>{text}</Th>
  );
  const infoScope = info.filter(r => dist === 'all' || r.dist_code === dist);
  const j073Sampai = infoScope.map(r => String(r.j073_sampai || '').slice(0, 10)).filter(Boolean).sort()[0];
  const distLabel = dist === 'all' ? 'Semua distributor' : (() => { const d = dists.find(x => x.code === dist)!; return `${d.kode} · ${d.code}`; })();
  const periodeLabel = dari === sampai ? bulanLabel(dari) : `${bulanLabel(dari)} s.d. ${bulanLabel(sampai)}`;
  const filterAktif = tipeOk !== 'all' || transOk !== 'all' || segmen !== 'all';

  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (!v) return;
    setBusy(true);
    try {
      await exportRowsToExcel([
        { name: 'Per zona', header: ['Zona', 'Ton', 'Bayar truk (Rp)', 'Bayar truk per ton', 'Ongkir dibayar toko (Rp)', 'Ongkir dibayar toko per ton', 'Margin (Rp; + untung, − rugi)', 'Ongkos % omzet'],
          rows: v.zona.map(z => [z.nama, z.ton, z.biaya, z.tonTagih ? perTon(z.biayaTagih, z.tonTagih) : perTon(z.biaya, z.ton), z.tagih, perTon(z.tagih, z.tonTagih), z.tanggung, z.omzet ? z.biayaOmzet / z.omzet : null]),
          widths: [24, 10, 16, 13, 14, 14, 20, 14] },
        { name: 'Per zona x transporter', header: ['Zona', 'Transporter', 'Ton', 'Bayar truk (Rp)', 'Bayar truk per ton', 'Ongkir dibayar toko (Rp)', 'Ongkir dibayar toko per ton', 'Margin (Rp; + untung, − rugi)', 'Ongkos % omzet'],
          rows: v.zona.flatMap(z => z.transporter.map(t => [z.nama, t.nama, t.ton, t.biaya, t.tonTagih ? perTon(t.biayaTagih, t.tonTagih) : perTon(t.biaya, t.ton), t.tagih, perTon(t.tagih, t.tonTagih), t.tanggung, t.omzet ? t.biayaOmzet / t.omzet : null])),
          widths: [24, 30, 10, 16, 13, 14, 14, 20, 14] },
        { name: 'Per transporter', header: ['Transporter', 'Perjalanan', 'Perjalanan ada biaya', 'Ton', 'Ton DO lengkap', 'Bayar truk (Rp)', 'Bayar truk per ton', 'Ongkir dibayar toko (Rp)', 'Ongkir dibayar toko per ton', 'Margin (Rp; + untung, − rugi)', 'Ongkos % omzet'],
          rows: v.perTransporter.map(t => [t.nama, t.trips, t.tripsBiaya, t.ton, t.tonL, t.biaya, perTon(t.biaya, t.tonL), t.tagih, perTon(t.tagih, t.tonTagih), t.tanggung, t.omzet ? t.biayaOmzet / t.omzet : null]),
          widths: [32, 10, 12, 10, 12, 16, 12, 14, 13, 20, 14] },
        { name: 'Per toko', header: ['Kode toko', 'Toko', 'Zona', 'DO', 'Ton', 'Bayar truk (Rp)', 'Bayar truk per ton', 'Ongkir dibayar toko (Rp)', 'Margin (Rp; + untung, − rugi)', 'Ongkos % omzet'],
          rows: v.toko.map(t => [t.cust, t.toko, t.zona, t.jumlahDo, t.ton, t.biaya, perTon(t.biaya, t.ton), t.tagih, t.tanggung, t.omzet ? t.biayaOmzet / t.omzet : null]),
          widths: [11, 34, 20, 6, 9, 16, 13, 14, 20, 14] },
        { name: 'Per DO', header: ['Distributor', 'Bulan kirim', 'No DO', 'Kode toko', 'Toko', 'Tipe kirim', 'Zona', 'Truk', 'Transporter', 'Ton', 'Bayar truk (Rp)', 'Ongkir dibayar toko (Rp)', 'Sumber ongkir', 'Harga Loco per ton', 'Harga DO (Product Price) per ton', 'Omzet (Rp)', 'Biaya lengkap'],
          rows: v.dos.map(d => [d.dist, d.periode.slice(0, 7), d.doNo, d.cust, d.toko, d.tipe === '?' ? '' : d.tipe, d.zona, namaTruk(d.truk), d.transporter, d.ton, d.biaya, d.tagih,
            d.sumber ? SUMBER[d.sumber] || d.sumber : '', d.locoTon, d.hargaTon, d.omzet, d.lengkap ? 'ya' : d.luarErp ? 'armada sendiri' : 'belum']),
          widths: [10, 10, 11, 10, 30, 8, 18, 22, 26, 8, 15, 15, 20, 13, 13, 15, 13] },
        { name: 'Angkutan ke gudang', header: ['Tujuan', 'Perjalanan', 'Ton', 'Biaya (Rp)', 'Per ton'],
          rows: v.gudang.tujuan.map(g => [g.nama, g.trips, g.ton, g.biaya, perTon(g.biaya, g.ton)]), widths: [34, 11, 11, 16, 12] },
      ], `Ongkos_Kirim_${dist === 'all' ? 'semua' : dists.find(x => x.code === dist)!.kode}_${dari.slice(0, 7)}${dari !== sampai ? '_' + sampai.slice(0, 7) : ''}.xlsx`, 'ongkos-kirim');
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Ongkos Kirim" status={<DataBadge source="ongkos" />}>
        <p className="text-soft text-[13px] -mt-2 max-w-[760px] leading-relaxed">
          Ongkos kirim dari gudang distributor ke toko: yang benar-benar dibayar ke transporter (ORDB019) dibandingkan dengan ongkos yang ditagih ke toko di DO (J073).
          {j073Sampai && <> J073 s.d. {fmtDate(j073Sampai)}.</>}
        </p>
        <CaraBaca />
      </PageHeader>

      <FilterBar label="Filter ongkos kirim" stickyMobile={false} className="max-[880px]:grid max-[880px]:grid-cols-2 max-[880px]:gap-2 max-[880px]:[&_select]:w-full max-[880px]:[&_select]:min-w-0">
        <Select label="Distributor" value={dist} onChange={e => { setDist(e.target.value); setTrans('all'); }} style={{ minWidth: 170 }}
          options={[...(dists.length > 1 ? [{ value: 'all', label: 'Semua distributor' }] : []), ...dists.map(d => ({ value: d.code, label: `${d.kode} · ${d.code}` }))]} />
        <Select label="Bulan kirim" value={bulanOk} onChange={e => setBulan(e.target.value)} style={{ minWidth: 160 }}
          options={[...periodes.map(p => ({ value: p, label: bulanLabel(p) })), ...(periodes.length >= 3 ? [{ value: '3', label: '3 bulan terakhir' }] : [])]} />
        <Select label="Tipe kirim" value={tipeOk} onChange={e => setTipe(e.target.value)} style={{ minWidth: 170 }}
          options={[{ value: 'all', label: 'Semua tipe kirim' }, ...tipes.map(t => ({ value: t, label: tipeLabel(t) }))]} />
        <Select label="Transporter" value={transOk} onChange={e => setTrans(e.target.value)} style={{ minWidth: 170 }}
          options={[{ value: 'all', label: 'Semua transporter' }, ...transporters.map(t => ({ value: t, label: t }))]} />
        <Select label="Segmen" value={segmen} onChange={e => setSegmen(e.target.value)} style={{ minWidth: 140 }} options={SEGMEN_OPTS} />
        <Select label="Satuan" value={satuan} onChange={e => setSatuan(e.target.value)} style={{ minWidth: 150 }} options={SATUAN_OPTS} />
        {filterAktif && <button type="button" className="btn btn-sm self-end max-[880px]:col-span-2 max-[880px]:justify-center" onClick={() => { setTipe('all'); setTrans('all'); setSegmen('all'); }}>Reset filter</button>}
      </FilterBar>

      {load.error && <ErrorBox error={load.error} />}
      {!v && !load.error && <PageSkeleton />}
      {v && (
        <div className={cx(load.loading && 'opacity-60 transition-opacity')}>
          <Kelengkapan v={v} periodeLabel={periodeLabel} namaDist={c => dists.find(x => x.code === c)?.kode || c} />
          <BelumHitung v={v} />
          <SatuZak v={v} S={S} />

          <div className="grid-kpi mt-4">
            <Kpi title="Bayar truk" value={v.tonLengkap ? fmtIDRCompact(v.real) : '–'}
              delta={v.tonLengkap ? <>{fmtIDR((v.realTon ?? 0) * S.f)} {S.kata} · {fmt(v.tripBerbiaya)} perjalanan</> : 'belum ada biaya di ORDB019'} />
            <Kpi title="Ongkos terhadap omzet" value={fmtPct(v.pctOmzet)}
              delta={v.omzetDasar ? <>dari omzet muatan {fmtIDRCompact(v.omzetDasar)}</> : v.tonLengkap ? 'omzet DO belum ada di J073' : 'belum ada biaya di ORDB019'} />
            <Kpi title="Ongkir dibayar toko" value={v.tagihTon == null ? '–' : fmtIDR(v.tagihTon * S.f)} unit={v.tagihTon == null ? undefined : S.lbl}>
              <Tutup pct={v.tertutup} adaTagih={v.tagihTon != null} />
            </Kpi>
            <Kpi title="Margin ongkos" value={v.doTagih ? <Margin v={v.tanggung} compact /> : '–'}
              delta={v.doTagih ? <>{fmtIDR((v.tanggungTon ?? 0) * S.f)} {S.kata} · {v.tanggung > 0 ? 'untung' : v.tanggung < 0 ? 'rugi, ditanggung distributor' : 'impas'} · {fmt(v.doTagih)} DO</> : v.tonLengkap ? 'butuh J073 dengan kolom pengiriman' : 'belum ada biaya di ORDB019'} />
          </div>

          <Tren info={infoScope} S={S} />
          {v.gudang.trips > 0 && <Gudang g={v.gudang} S={S} />}

          <div className={cx('grid gap-4 mt-4 max-[1100px]:grid-cols-1', dist !== 'all' ? 'grid-cols-3 max-[1400px]:grid-cols-2' : 'grid-cols-2')}>
            <Card title={`Bayar truk ${S.kata} menurut tipe truk${tipeOk !== 'all' ? ' · semua tipe kirim' : ''}`}>
              <p className="text-faint text-[12px] -mt-1 mb-3">Perjalanan yang sudah ada biayanya. Isi truk = muatan semen dibanding kapasitas di nama tipe truk.</p>
              <BarList rows={v.truk.map(t => ({ key: t.truk, label: namaTruk(t.truk), sub: `${fmt(t.trips)} perjalanan · ${fmtTon(t.ton)} ton`, value: t.rpTon * S.f, side: t.isi == null ? '–' : fmtPct(t.isi, 0), sideTone: t.isi != null && t.isi < 0.8 ? 'warn' : undefined }))}
                sideTitle="Isi truk" />
            </Card>
            <Card title={`Bayar truk vs ongkir dibayar toko per tipe kirim (Rp${S.lbl})`}>
              <div className="flex gap-4 text-[12px] text-soft -mt-1 mb-3">
                <span className="inline-flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.blue }} />Bayar truk</span>
                <span className="inline-flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.sub }} />Ongkir dibayar toko</span>
              </div>
              <TipeBars rows={v.tipe} f={S.f} />
            </Card>
            {dist !== 'all' && <Card title={`Bayar truk ${S.kata} menurut transporter`}>
              <p className="text-faint text-[12px] -mt-1 mb-3">DO yang biayanya lengkap. Ada biaya = perjalanan yang sudah ada ongkosnya di ORDB019.</p>
              <BarList rows={v.perTransporter.filter(t => t.tonL > 0).map(t => {
                const pct = t.trips ? t.tripsBiaya / t.trips : 0;
                return { key: t.nama, label: t.nama, sub: `${fmt(t.trips)} perjalanan · ${fmtTon(t.ton)} ton`, value: (perTon(t.biaya, t.tonL) ?? 0) * S.f, side: fmtPct(pct, 0), sideTone: pct < 0.5 ? 'warn' as const : undefined };
              }).sort((a, b) => a.value - b.value)} sideTitle="Ada biaya" />
              {v.perTransporter.some(t => t.tonL === 0) && (
                <p className="text-faint text-[12px] mt-3">Belum ada biaya sama sekali: {v.perTransporter.filter(t => t.tonL === 0).map(t => `${t.nama} (${fmtTon(t.ton)} ton)`).join(', ')}.</p>
              )}
            </Card>}
          </div>

          <div className="flex items-baseline justify-between flex-wrap gap-2.5 mt-[38px] mb-3.5">
            <h2 className="section-title !m-0">Ongkos per zona tujuan <span className="n">{distLabel} · {periodeLabel} · klik judul kolom untuk mengurutkan, klik zona untuk rincian transporter</span></h2>
            {canDownload('ongkos-kirim') && (
              <button type="button" className="btn" onClick={download} disabled={busy || !v.dos.length}><FileIcon />{busy ? 'Menyiapkan…' : 'Download Excel'}</button>
            )}
          </div>
          <TableWrap>
            <table>
              <caption className="sr-only">Ongkos kirim per zona tujuan</caption>
              <thead><tr>
                {zh('nama', 'Zona', false)}{zh('ton', 'Ton')}{zh('real', <>Bayar truk {S.lbl}</>, true, 'Dari DO yang sama dengan kolom ongkir dibayar toko (DO yang ada di J073), supaya bisa langsung dikurangkan')}{zh('tagih', <>Ongkir dibayar toko {S.lbl}</>)}
                {zh('marginTon', <>Margin {S.lbl}</>, true, 'Ongkir dibayar toko − bayar truk, per satuan. Plus (hijau) = untung, minus (merah) = rugi / ditanggung distributor')}
                {zh('margin', 'Margin (Rp)', true, 'Total margin. Plus (hijau) = untung, minus (merah) = rugi / ditanggung distributor')}{zh('pct', 'Ongkos % omzet')}
              </tr></thead>
              <tbody>
                {!v.zona.length && <tr><td colSpan={7} className="!text-center !text-faint !p-5">Belum ada DO dengan biaya lengkap pada filter ini.</td></tr>}
                {/* klik zona: rincian per transporter di zona itu */}
                {zonaSort.sorted.map(z => {
                  const buka = zonaBuka.has(z.nama);
                  const sel = (x: typeof z | (typeof z.transporter)[number], anak?: boolean) => {
                    const rt = x.tonTagih ? perTon(x.biayaTagih, x.tonTagih) : perTon(x.biaya, x.ton), rz = z.tonTagih ? perTon(z.biayaTagih, z.tonTagih) : perTon(z.biaya, z.ton);
                    const mahal = anak && rt != null && rz != null && z.transporter.length > 1 && rt > rz * 1.1;
                    return <>
                      <td className="num font-mono">{fmtTon(x.ton)}</td>
                      <td className={cx('num font-mono', mahal && 'text-red font-semibold')} title={mahal ? 'Lebih dari 10% di atas rata-rata zona ini' : undefined}>{rp(rt)}</td>
                      <td className="num font-mono">{x.tonTagih ? rp(perTon(x.tagih, x.tonTagih)) : '–'}</td>
                      <td className="num font-mono">{x.tonTagih ? <MarginSatuan v={(perTon(x.tanggung, x.tonTagih) ?? 0) * S.f} /> : '–'}</td>
                      <td className="num font-mono">{x.tonTagih ? <Margin v={x.tanggung} /> : '–'}</td>
                      <td className="num font-mono">{x.omzet ? fmtPct(x.biayaOmzet / x.omzet) : '–'}</td>
                    </>;
                  };
                  return [
                    <tr key={z.nama} className={cx(buka && 'bg-[#f3f7f5]')}>
                      <td>
                        <button type="button" className="link-btn !no-underline text-left inline-flex items-center gap-1.5" aria-expanded={buka}
                          onClick={() => setZonaBuka(s => { const n = new Set(s); if (n.has(z.nama)) n.delete(z.nama); else n.add(z.nama); return n; })}>
                          <span aria-hidden="true" className={cx('inline-block text-[10px] text-faint transition-transform', buka && 'rotate-90')}>▶</span>
                          <span className="text-ink">{z.nama}</span>
                          <span className="text-faint text-[12px]">· {fmt(z.transporter.length)} transporter</span>
                        </button>
                      </td>
                      {sel(z)}
                    </tr>,
                    ...(buka ? z.transporter.map(t => (
                      <tr key={z.nama + '|' + t.nama} className="bg-[#f8faf9]">
                        <td className="!pl-9 text-[12.5px] text-soft">{t.nama}</td>
                        {sel(t, true)}
                      </tr>
                    )) : []),
                  ];
                })}
              </tbody>
            </table>
          </TableWrap>

          <div className="grid gap-4 mt-6 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] max-[1100px]:grid-cols-1">
            <Card title="Tagihan transporter vs harga ritase">
              <p className="text-faint text-[12px] -mt-1 mb-3">
                {v.ritaseBeda.total ? <>{fmt(v.ritaseBeda.beda)} dari {fmt(v.ritaseBeda.total)} perjalanan ditagih beda lebih dari 1% dari ritase.</> : 'Belum ada perjalanan dengan harga ritase dan biaya.'}
              </p>
              <div className="border border-line rounded overflow-x-auto">
                <table className="!min-w-0 tbl-dense">
                  <thead><tr><th>Transporter</th><th className="num">Ton</th><th className="num">Rp{S.lbl}</th><th className="num">vs ritase</th></tr></thead>
                  <tbody>
                    {v.transporter.map(t => (
                      <tr key={t.nama}>
                        <td className="text-[12.5px]">{t.nama}<span className="text-faint"> · {fmt(t.trips)} perjalanan</span></td>
                        <td className="num font-mono">{fmtTon(t.ton)}</td>
                        <td className="num font-mono">{rp(perTon(t.biaya, t.ton))}</td>
                        <td className={cx('num font-mono', t.vsRitase != null && t.vsRitase > 0.05 && 'text-red font-semibold')}>
                          {t.vsRitase == null ? '–' : Math.abs(t.vsRitase) < 0.005 ? '0%' : (t.vsRitase > 0 ? '+' : '−') + fmt(Math.abs(t.vsRitase) * 100, 0) + '%'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Perlu dicek">
              {!v.cek.length && <p className="text-soft text-[13px]">Tidak ada yang menonjol pada filter ini.</p>}
              <ul className="list-none p-0 m-0 flex flex-col gap-3">
                {v.cek.map(c => (
                  <li key={c.judul} className={cx('border-l-[3px] pl-3', c.tone === 'bad' ? 'border-red' : 'border-amber')}>
                    <div className="font-semibold text-[13.5px] text-ink">{c.judul}</div>
                    <div className="text-soft text-[12.5px] mt-0.5 leading-relaxed">{c.isi}</div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <TokoTable v={v} S={S} />
          <TanpaOngkir v={v} />

          <p className="text-faint text-[12px] mt-4 leading-relaxed max-w-[900px]">
            Bayar truk dari ORDB019, dibagi ke DO sesuai baris laporan (bulan = bulan kirim); baris tanpa No DO (angkutan ke gudang) dipisah. Ongkir dibayar toko = (Delivery Price − Delivery Discount Price + Delivery Add Price + Handling Cost) × qty dari J073;
            kalau kolom Delivery kosong pada DO kirim, dipakai tarif resmi ERP untuk tipe kirim dan zona itu pada tanggal DO (Transport + Subsidi + Handling, halaman Price & Promo Simulation);
            kalau tarifnya belum ada, dihitung dari harga: (Product Price − harga Loco kolom Price, gudang yang sama, pada tanggal DO) × qty, minimal 0.
            Diskon / promo / cash back tidak dihitung, karena itu potongan harga semen per toko (toko yang ambil sendiri juga dapat), bukan potongan ongkir. Per ton / per zak, omzet, dan margin hanya memakai DO yang semua perjalanannya sudah ada biayanya.
            Truk toko (Eks. Toko) memang tanpa biaya; armada sendiri (mis. LAM) biayanya di luar ERP dan tidak dihitung.
            Margin = ongkir dibayar toko − bayar truk, dari DO yang sama: plus (hijau) = untung, minus (merah) = rugi / ditanggung distributor. Per zak = per ton x berat zak (50 kg = 1/20 ton, 40 kg = 1/25 ton).
          </p>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------------
   Perhitungan
--------------------------------------------------------------------------- */
type Hasil = ReturnType<typeof hitung>;
function hitung(tripsSemua: Trip[], dosAll: DoRow[], tipe: string, trans: string) {
  // angkutan ke gudang (tanpa No DO) dipisah: bukan pengiriman ke toko
  const gudangTrips = tripsSemua.filter(t => t.keGudang && (trans === 'all' || t.transporter === trans));
  const tripsAll = tripsSemua.filter(t => !t.keGudang);
  const trips = tripsAll.filter(t => trans === 'all' || t.transporter === trans);
  const dos = dosAll.filter(d => (tipe === 'all' || d.tipe === tipe) && (trans === 'all' || d.transporter === trans));
  const sum = <T,>(rs: T[], f: (r: T) => number) => rs.reduce((a, r) => a + f(r), 0);
  const lengkap = dos.filter(d => d.lengkap);
  const ditagih = lengkap.filter(d => d.tagih != null);
  const omzetDos = lengkap.filter(d => d.omzet != null && d.omzet > 0);

  const ton = sum(dos, d => d.ton), tonLengkap = sum(lengkap, d => d.ton);
  const real = sum(lengkap, d => d.biaya);
  const tagih = sum(ditagih, d => d.tagih!), realTagih = sum(ditagih, d => d.biaya), tonTagih = sum(ditagih, d => d.ton);
  const omzetDasar = sum(omzetDos, d => d.omzet!), biayaOmzet = sum(omzetDos, d => d.biaya);

  // distributor x bulan yang laporan ORDB019-nya sama sekali tanpa biaya (Harga Ritase dan Total semua 0 di ERP):
  // bukan tagihan yang telat, ERP memang belum mencatat ongkos untuk periode itu
  const grup = new Map<string, { dist: string; periode: string; ton: number; ada: boolean }>();
  tripsAll.forEach(t => {
    const k = `${t.dist}|${t.periode}`;
    const g = grup.get(k) || { dist: t.dist, periode: t.periode, ton: 0, ada: false };
    g.ton += t.ton; if (t.biaya > 0 || t.ritase > 0) g.ada = true; grup.set(k, g);
  });
  const kosong = [...grup.values()].filter(g => !g.ada).sort((a, b) => a.periode.localeCompare(b.periode) || a.dist.localeCompare(b.dist));
  const kunciKosong = new Set(kosong.map(g => `${g.dist}|${g.periode}`));
  const tonKosong = sum(dos.filter(d => kunciKosong.has(`${d.dist}|${d.periode}`)), d => d.ton);

  // perjalanan yang belum ada biayanya, per transporter (di luar laporan yang kosong sama sekali).
  // Hanya transporter normal; armada sendiri = biaya di luar ERP (dicatat terpisah), truk toko memang tanpa biaya.
  const belum = new Map<string, { ton: number; trips: number; ritase: number; bulan: Set<string>; dist: Set<string> }>();
  const luar = new Map<string, { ton: number; trips: number }>();
  trips.filter(t => t.biaya === 0 && !kunciKosong.has(`${t.dist}|${t.periode}`)).forEach(t => {
    if (t.status === 'armada_sendiri') { const y = luar.get(t.transporter) || { ton: 0, trips: 0 }; y.ton += t.ton; y.trips++; luar.set(t.transporter, y); return; }
    if (t.status !== 'normal') return;
    const x = belum.get(t.transporter) || { ton: 0, trips: 0, ritase: 0, bulan: new Set<string>(), dist: new Set<string>() };
    x.ton += t.ton; x.trips++; if (t.ritase > 0) x.ritase++; x.bulan.add(t.periode.slice(0, 7)); x.dist.add(t.dist); belum.set(t.transporter, x);
  });
  const tonLuar = sum(dos.filter(d => d.luarErp && !d.lengkap && !kunciKosong.has(`${d.dist}|${d.periode}`)), d => d.ton);

  // angkutan ke gudang
  const gm = new Map<string, { ton: number; biaya: number; trips: number }>();
  gudangTrips.forEach(t => { const x = gm.get(t.tujuan) || { ton: 0, biaya: 0, trips: 0 }; x.ton += t.ton; x.biaya += t.biaya; x.trips++; gm.set(t.tujuan, x); });
  const gudang = {
    trips: gudangTrips.length, ton: sum(gudangTrips, t => t.ton), biaya: sum(gudangTrips, t => t.biaya),
    tonBiaya: sum(gudangTrips.filter(t => t.biaya > 0), t => t.ton), biayaAda: sum(gudangTrips.filter(t => t.biaya > 0), t => t.biaya),
    tujuan: [...gm.entries()].map(([nama, x]) => ({ nama, ...x })).sort((a, b) => b.ton - a.ton),
  };

  // hitungan per zak: harga ambil sendiri (Loco), ongkir dibayar toko, bayar ke truk
  const sumberTon = new Map<string, number>();
  dos.filter(d => d.sumber).forEach(d => sumberTon.set(d.sumber!, (sumberTon.get(d.sumber!) || 0) + d.ton));
  const denganLoco = ditagih.filter(d => d.locoTon != null);

  // DO kirim yang tokonya tidak membayar ongkir (rincian 0, atau harga DO tidak di atas Loco); "kosong" = belum bisa dicek
  const tk = new Map<string, { cust: string; toko: string; zonaTon: Map<string, number>; jumlahDo: number; ton: number; biaya: number; dicek: number; belumDicek: number }>();
  dos.filter(d => d.tipe !== 'LG' && d.tipe !== '?' && d.tagih === 0 && (d.sumber === 'rincian' || d.sumber === 'tarif' || d.sumber === 'harga')).forEach(d => {
    const k = d.cust || `DO ${d.doNo}`;
    const x = tk.get(k) || { cust: d.cust, toko: d.toko, zonaTon: new Map(), jumlahDo: 0, ton: 0, biaya: 0, dicek: 0, belumDicek: 0 };
    x.jumlahDo++; x.ton += d.ton; x.biaya += d.biaya; x.zonaTon.set(d.zona, (x.zonaTon.get(d.zona) || 0) + d.ton);
    if (d.sumber === 'kosong') x.belumDicek += d.ton; else x.dicek += d.ton;
    tk.set(k, x);
  });
  // DO kirim yang ongkir tokonya belum bisa dihitung (Delivery kosong, Product Price / Loco belum ada): tidak ikut margin
  const bz = new Map<string, { ton: number; biaya: number }>();
  dos.filter(d => d.sumber === 'kosong' && d.tipe !== '?').forEach(d => { const x = bz.get(d.zona) || { ton: 0, biaya: 0 }; x.ton += d.ton; x.biaya += d.biaya; bz.set(d.zona, x); });
  const belumHitung = { ton: [...bz.values()].reduce((a, x) => a + x.ton, 0), zona: [...bz.entries()].map(([nama, x]) => ({ nama, ...x })).sort((a, b) => b.ton - a.ton) };
  const tanpaOngkir = [...tk.values()].map(x => ({ ...x, zona: [...x.zonaTon.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '' })).sort((a, b) => b.biaya - a.biaya || b.ton - a.ton);

  // per tipe truk
  const tm = new Map<string, { truk: string; trips: number; ton: number; biaya: number; isiSum: number; isiN: number; kurang: number }>();
  trips.forEach(t => {
    const x = tm.get(t.truk) || { truk: t.truk, trips: 0, ton: 0, biaya: 0, isiSum: 0, isiN: 0, kurang: 0 };
    const cap = kapasitasTruk(t.truk);
    if (cap) { x.isiSum += Math.min(t.ton / cap, 1.2); x.isiN++; if (t.ton / cap < 0.8) x.kurang++; }
    if (t.biaya > 0) { x.trips++; x.ton += t.ton; x.biaya += t.biaya; }
    tm.set(t.truk, x);
  });
  const truk = [...tm.values()].filter(x => x.trips > 0).map(x => ({ ...x, rpTon: x.biaya / x.ton, isi: x.isiN ? x.isiSum / x.isiN : null, semua: x.isiN }))
    .sort((a, b) => a.rpTon - b.rpTon);

  // per tipe kirim
  const tp = new Map<string, { tipe: string; ton: number; biaya: number; tagih: number }>();
  ditagih.forEach(d => { const x = tp.get(d.tipe) || { tipe: d.tipe, ton: 0, biaya: 0, tagih: 0 }; x.ton += d.ton; x.biaya += d.biaya; x.tagih += d.tagih!; tp.set(d.tipe, x); });
  const tipeRows = [...tp.values()].sort((a, b) => b.ton - a.ton);

  // per zona
  type Agg = { nama: string; ton: number; biaya: number; tagih: number; tonTagih: number; biayaTagih: number; tanggung: number; omzet: number; biayaOmzet: number };
  const baru = (nama: string): Agg => ({ nama, ton: 0, biaya: 0, tagih: 0, tonTagih: 0, biayaTagih: 0, tanggung: 0, omzet: 0, biayaOmzet: 0 });
  const tambah = (x: Agg, d: DoRow) => {
    x.ton += d.ton; x.biaya += d.biaya;
    if (d.tagih != null) { x.tagih += d.tagih; x.tonTagih += d.ton; x.tanggung += d.tagih - d.biaya; x.biayaTagih += d.biaya; }
    if (d.omzet) { x.omzet += d.omzet; x.biayaOmzet += d.biaya; }
  };
  // per zona, dengan rincian per transporter di zona itu (jarak sama, jadi Rp/ton antar transporter sebanding)
  const zm = new Map<string, Agg & { per: Map<string, Agg> }>();
  lengkap.forEach(d => {
    const x = zm.get(d.zona) || { ...baru(d.zona), per: new Map<string, Agg>() };
    tambah(x, d);
    const t = x.per.get(d.transporter) || baru(d.transporter); tambah(t, d); x.per.set(d.transporter, t);
    zm.set(d.zona, x);
  });
  const zona = [...zm.values()].map(z => ({ ...z, transporter: [...z.per.values()].sort((a, b) => b.ton - a.ton) })).sort((a, b) => b.ton - a.ton);

  // per transporter vs ritase
  const trm = new Map<string, { nama: string; trips: number; ton: number; biaya: number; biayaR: number; ritase: number }>();
  let beda = 0, totalR = 0;
  trips.filter(t => t.biaya > 0).forEach(t => {
    const x = trm.get(t.transporter) || { nama: t.transporter, trips: 0, ton: 0, biaya: 0, biayaR: 0, ritase: 0 };
    x.trips++; x.ton += t.ton; x.biaya += t.biaya;
    if (t.ritase > 0) { x.biayaR += t.biaya; x.ritase += t.ritase; totalR++; if (Math.abs(t.biaya / t.ritase - 1) > 0.01) beda++; }
    trm.set(t.transporter, x);
  });
  const transporter = [...trm.values()].map(x => ({ ...x, vsRitase: x.ritase > 0 ? x.biayaR / x.ritase - 1 : null })).sort((a, b) => b.ton - a.ton);

  // rangkuman per transporter (semua transporter pada filter tipe kirim; filter transporter hanya menandai barisnya)
  const dosTipe = dosAll.filter(d => tipe === 'all' || d.tipe === tipe);
  const rk = new Map<string, { nama: string; trips: number; tripsBiaya: number; ton: number; tonL: number; biaya: number; tagih: number; tonTagih: number; biayaTagih: number; tanggung: number; omzet: number; biayaOmzet: number }>();
  const ambil = (nama: string) => rk.get(nama) || rk.set(nama, { nama, trips: 0, tripsBiaya: 0, ton: 0, tonL: 0, biaya: 0, tagih: 0, tonTagih: 0, biayaTagih: 0, tanggung: 0, omzet: 0, biayaOmzet: 0 }).get(nama)!;
  tripsAll.forEach(t => { const x = ambil(t.transporter); x.trips++; x.ton += t.ton; if (t.biaya > 0) x.tripsBiaya++; });
  dosTipe.filter(d => d.lengkap).forEach(d => {
    const x = ambil(d.transporter);
    x.tonL += d.ton; x.biaya += d.biaya;
    if (d.tagih != null) { x.tagih += d.tagih; x.tonTagih += d.ton; x.tanggung += d.tagih - d.biaya; x.biayaTagih += d.biaya; }
    if (d.omzet) { x.omzet += d.omzet; x.biayaOmzet += d.biaya; }
  });
  const perTransporter = [...rk.values()].sort((a, b) => b.ton - a.ton);

  // per toko
  const km = new Map<string, { cust: string; toko: string; zonaTon: Map<string, number>; jumlahDo: number; ton: number; biaya: number; tagih: number; tanggung: number; adaTagih: boolean; omzet: number; biayaOmzet: number }>();
  lengkap.forEach(d => {
    const k = d.cust || `DO ${d.doNo}`;
    const x = km.get(k) || { cust: d.cust, toko: d.toko || (d.cust ? '' : 'DO belum ada di J073'), zonaTon: new Map(), jumlahDo: 0, ton: 0, biaya: 0, tagih: 0, tanggung: 0, adaTagih: false, omzet: 0, biayaOmzet: 0 };
    x.jumlahDo++; x.ton += d.ton; x.biaya += d.biaya; x.zonaTon.set(d.zona, (x.zonaTon.get(d.zona) || 0) + d.ton);
    if (d.tagih != null) { x.tagih += d.tagih; x.tanggung += d.tagih - d.biaya; x.adaTagih = true; }
    if (d.omzet) { x.omzet += d.omzet; x.biayaOmzet += d.biaya; }
    km.set(k, x);
  });
  const toko = [...km.values()].map(x => ({ ...x, zona: [...x.zonaTon.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '' }));

  // perlu dicek
  const cek: { judul: string; isi: ReactNode; tone: 'warn' | 'bad'; nilai: number }[] = [];
  const lg = dos.filter(d => d.tipe === 'LG' && d.biaya > 0);
  if (lg.length) cek.push({ judul: 'Ambil di gudang tapi ada ongkos kirim', tone: 'bad', nilai: sum(lg, d => d.biaya) + 1e12,
    isi: <>{fmt(lg.length)} DO tipe LG ({fmtTon(sum(lg, d => d.ton))} ton) tercatat di ORDB019 dengan ongkos {fmtIDR(sum(lg, d => d.biaya))}. Toko mengambil sendiri, jadi ongkos ini perlu dicek ke gudang atau transporter.</> });
  // tipe truk mahal di zona yang sama
  const zt = new Map<string, Map<string, { ton: number; biaya: number; trips: number }>>();
  trips.filter(t => t.biaya > 0).forEach(t => {
    const m = zt.get(t.zona) || new Map(); const x = m.get(t.truk) || { ton: 0, biaya: 0, trips: 0 };
    x.ton += t.ton; x.biaya += t.biaya; x.trips++; m.set(t.truk, x); zt.set(t.zona, m);
  });
  type Mahal = { zona: string; mahal: string; murah: string; rpMahal: number; rpMurah: number; ton: number; hemat: number };
  const kandidat: Mahal[] = [];
  zt.forEach((m, z) => {
    const xs = [...m.entries()].filter(([, x]) => x.trips >= 3).map(([k, x]) => ({ k, rp: x.biaya / x.ton, ton: x.ton }));
    if (xs.length < 2) return;
    const murah = xs.reduce((a, b) => (b.rp < a.rp ? b : a));
    xs.forEach(x => {
      if (x.rp > murah.rp * 1.2) kandidat.push({ zona: z, mahal: x.k, murah: murah.k, rpMahal: x.rp, rpMurah: murah.rp, ton: x.ton, hemat: (x.rp - murah.rp) * x.ton });
    });
  });
  const t = kandidat.sort((a, b) => b.hemat - a.hemat)[0];
  if (t) {
    cek.push({ judul: `${namaTruk(t.mahal)} ke ${t.zona}`, tone: 'warn', nilai: t.hemat,
      isi: <>{fmtIDR(t.rpMahal)}/ton, sedangkan {namaTruk(t.murah).toLowerCase()} ke zona yang sama {fmtIDR(t.rpMurah)}/ton. {fmtTon(t.ton)} ton pada periode ini, selisih sekitar {fmtIDRCompact(t.hemat)}.</> });
  }
  const kurang = [...tm.values()].filter(x => x.isiN >= 10 && x.kurang / x.isiN >= 0.15).sort((a, b) => b.kurang / b.isiN - a.kurang / a.isiN)[0];
  if (kurang) cek.push({ judul: `${namaTruk(kurang.truk)} kurang muatan`, tone: 'warn', nilai: kurang.kurang * 1e5,
    isi: <>{fmt(kurang.kurang)} dari {fmt(kurang.isiN)} perjalanan terisi di bawah 80% kapasitas.</> });
  transporter.filter(t => t.vsRitase != null && t.vsRitase > 0.05 && t.trips >= 3).forEach(t => cek.push({
    judul: `${t.nama} di atas harga ritase`, tone: 'warn', nilai: t.biayaR - t.ritase,
    isi: <>Ditagih {fmt(t.vsRitase! * 100, 0)}% di atas ritase kontrak pada {fmt(t.trips)} perjalanan, sekitar {fmtIDRCompact(t.biayaR - t.ritase)} lebih mahal.</>,
  }));
  const tanpaJ073 = dos.filter(d => d.tipe === '?');
  if (tanpaJ073.length && sum(tanpaJ073, d => d.ton) > 0.05 * ton) cek.push({ judul: 'DO belum ada data pengiriman J073', tone: 'warn', nilai: 0,
    isi: <>{fmt(tanpaJ073.length)} DO ({fmtTon(sum(tanpaJ073, d => d.ton))} ton) tidak ditemukan di J073 atau J073-nya tanpa kolom pengiriman, jadi tagihan ke toko belum bisa dihitung. Biasanya DO bulan sebelumnya yang baru dikirim; pastikan J073 bulan itu sudah diunggah.</> });
  cek.sort((a, b) => b.nilai - a.nilai);

  return {
    dos, ton, tonLengkap, real, kosong, tonKosong, realTon: perTon(real, tonLengkap), tripBerbiaya: trips.filter(t => t.biaya > 0).length, tripSemua: trips.length,
    pctOmzet: omzetDasar ? biayaOmzet / omzetDasar : null, omzetDasar,
    tagihTon: perTon(sum(dos.filter(d => d.tagih != null), d => d.tagih!), sum(dos.filter(d => d.tagih != null), d => d.ton)),
    tertutup: realTagih ? tagih / realTagih : null,
    tanggung: tagih - realTagih, tanggungTon: perTon(tagih - realTagih, tonTagih), doTagih: ditagih.length,
    belum: [...belum.entries()].map(([nama, x]) => ({ nama, ...x })).sort((a, b) => b.ton - a.ton),
    luar: [...luar.entries()].map(([nama, x]) => ({ nama, ...x })).sort((a, b) => b.ton - a.ton), tonLuar, gudang, tanpaOngkir, belumHitung,
    sumberTon, satuZak: {
      loco: perTon(sum(denganLoco, d => d.locoTon! * d.ton), sum(denganLoco, d => d.ton)),
      ongkir: perTon(tagih, tonTagih), truk: perTon(realTagih, tonTagih), ton: tonTagih,
    },
    truk, tipe: tipeRows, zona, transporter, perTransporter, ritaseBeda: { beda, total: totalR }, toko, cek: cek.slice(0, 5),
  };
}

/* ---------------------------------------------------------------------------
   Komponen
--------------------------------------------------------------------------- */
function Kelengkapan({ v, periodeLabel, namaDist }: { v: Hasil; periodeLabel: string; namaDist: (kode: string) => string }) {
  if (!v.ton) return <div className="card text-soft text-[13px]">Tidak ada pengiriman semen pada filter ini.</div>;
  const daftarKosong = v.kosong.map(g => `${namaDist(g.dist)} ${bulanLabel(g.periode).replace(/^(\w{3})\w*/, '$1')}`);
  const ringkasKosong = daftarKosong.length > 6 ? `${daftarKosong.slice(0, 6).join(', ')}, dan ${fmt(daftarKosong.length - 6)} lainnya` : daftarKosong.join(', ');
  if (v.tonKosong >= v.ton * 0.999) {
    return (
      <div className="upl-note is-info" role="note">
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0 mt-px" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.1" /></svg>
        <div className="text-[13px] leading-relaxed">
          <b>ORDB019 {periodeLabel} belum berisi biaya sama sekali</b> ({ringkasKosong}): kolom Harga Ritase dan Total di laporan ERP bernilai 0 untuk semua perjalanan.
          Ini bukan tagihan transporter yang telat; ERP memang belum mencatat ongkos kirim untuk periode itu, jadi ongkos real, per ton, dan margin tidak bisa dihitung.
          Ongkos yang ditagih ke toko (dari J073) dan isi truk tetap dihitung.
        </div>
      </div>
    );
  }
  // muatan armada sendiri yang tanpa biaya tidak akan pernah lengkap di ERP: tidak ikut penyebut
  const p = v.tonLengkap / Math.max(v.ton - v.tonKosong - v.tonLuar, 1e-9);
  const luarTeks = v.luar.length > 0 && <> Armada sendiri, biaya di luar ERP (tidak dihitung): {v.luar.slice(0, 3).map((t, i) => <span key={t.nama}>{i ? ', ' : ''}{t.nama} {fmtTon(t.ton)} ton</span>)}.</>;
  if (p >= 0.97 && !v.kosong.length) return v.luar.length ? <div className="upl-note is-info text-[13px]" role="note"><div>{luarTeks}</div></div> : null;
  const top = v.belum.slice(0, 3);
  return (
    <div className={cx('upl-note', p < 0.8 ? 'is-warn' : 'is-info')} role="note">
      <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0 mt-px" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3.5 21.5 20h-19L12 3.5Z" /><path d="M12 10v4.5M12 17.2v.1" /></svg>
      <div className="text-[13px] leading-relaxed">
        <b>Biaya baru lengkap untuk {fmtPct(p, 0)} muatan {periodeLabel}</b> ({fmtTon(v.tonLengkap)} dari {fmtTon(v.ton - v.tonKosong - v.tonLuar)} ton{v.tonKosong ? ' yang laporannya sudah berisi biaya' : ''}).
        {top.length > 0 && <> Perjalanan yang tagihannya belum masuk: {top.map((t, i) => <span key={t.nama}>{i ? ', ' : ''}{t.nama} {fmtTon(t.ton)} ton{t.ritase ? ` (${fmt(t.ritase)} sudah ada ritase)` : ''}</span>)}.</>}
        {luarTeks}
        {v.kosong.length > 0 && <> ORDB019 tanpa biaya sama sekali (Harga Ritase dan Total 0 di ERP): {ringkasKosong}, {fmtTon(v.tonKosong)} ton.</>}
        {' '}Angka per ton, omzet, dan margin di bawah hanya memakai DO yang biayanya sudah lengkap.
        {v.belum.length > 0 && (
          <details className="mt-2 group">
            <summary className="cursor-pointer text-[#0B6BCB] select-none">Tagihan belum masuk per transporter ({fmt(v.belum.length)})</summary>
            <div className="mt-2 border border-line rounded overflow-x-auto bg-surface text-ink">
              <table className="tbl-dense !min-w-0">
                <thead><tr><th>Transporter</th><th className="num">Perjalanan</th><th className="num">Ton</th><th className="num" title="Perjalanan yang Harga Ritase-nya sudah ada tapi Total masih 0">Sudah ada ritase</th><th>Bulan</th></tr></thead>
                <tbody>
                  {v.belum.map(t => (
                    <tr key={t.nama}>
                      <td className="text-[12.5px]">{t.nama}</td>
                      <td className="num font-mono">{fmt(t.trips)}</td>
                      <td className="num font-mono">{fmtTon(t.ton)}</td>
                      <td className="num font-mono">{t.ritase ? fmt(t.ritase) : '–'}</td>
                      <td className="text-[12px] whitespace-nowrap">{[...t.bulan].sort().map(b => `${MONTHS_FULL[Number(b.slice(5))].slice(0, 3)} ${b.slice(2, 4)}`).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-faint text-[11.5px] mt-1.5">Transporter berstatus normal yang perjalanannya belum ada biaya di ORDB019: tagihannya perlu dikejar atau diinput. Armada sendiri dan truk toko tidak masuk daftar ini.</p>
          </details>
        )}
      </div>
    </div>
  );
}

/** DO kirim yang ongkir tokonya belum bisa dihitung: tidak ikut margin (bukan dianggap 0). */
function BelumHitung({ v }: { v: Hasil }) {
  const b = v.belumHitung;
  if (b.ton < 0.5) return null;
  const pct = b.ton / Math.max(v.ton, 1e-9);
  return (
    <div className={cx('upl-note mt-3', pct > 0.2 ? 'is-warn' : 'is-info')} role="note">
      <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0 mt-px" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.1" /></svg>
      <div className="text-[13px] leading-relaxed">
        <b>Ongkir dari toko belum bisa dihitung untuk {fmtTon(b.ton)} ton ({fmtPct(pct, 0)})</b>
        {b.zona.length > 0 && <>, terutama {b.zona.slice(0, 4).map(z => `${z.nama} ${fmtTon(z.ton)} t`).join(', ')}</>}.
        {' '}Kolom Delivery di J073 kosong, padahal ongkirnya biasanya sudah ada di harga DO, dan tarif resmi untuk tipe kirim dan zona itu belum tersimpan.
        DO ini <b>tidak ikut</b> margin (tidak dianggap ongkir 0). Supaya terhitung: di Nazam Auto Task jalankan "Baca ulang harga sejak 1 Januari" (tarif per zona),
        lalu "Upload ulang salinan J073". Kalau masih tersisa, kode tipe kirimnya belum dipasangkan di harga_tipe_map.
      </div>
    </div>
  );
}

/** Penjelasan singkat cara membaca halaman (bisa dibuka-tutup). */
function CaraBaca() {
  return (
    <details className="mt-3 max-w-[820px] text-[13px] text-soft group">
      <summary className="cursor-pointer text-[#0B6BCB] select-none list-none inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block text-[10px] transition-transform group-open:rotate-90">▶</span> Cara baca halaman ini
      </summary>
      <div className="card mt-2 !py-3.5 leading-relaxed">
        <p>Contoh satu zak semen 50 kg di bulan yang sama:</p>
        <ul className="mt-1.5 ml-4 list-disc">
          <li>Toko yang <b>ambil sendiri</b> di gudang bayar <b>69.950</b>. Ini harga semen saja (Loco).</li>
          <li>Toko yang <b>dikirim</b> bayar <b>71.350</b> (Product Price J073). Selisih <b>1.400</b> itu <b>ongkir yang dibayar toko</b>, sudah termasuk di harga DO.
            Di J073 kadang ditulis rinciannya (Delivery Price 1.950 − Delivery Discount 550 + Handling Cost bongkar), kadang kosong; kalau kosong, halaman ini memakai tarif resmi ERP untuk zona itu (Transport + Subsidi + Handling).</li>
          <li>Diskon / promo / cash back toko <b>tidak</b> mengurangi ongkir: itu potongan harga semen, toko yang ambil sendiri juga dapat.</li>
          <li>Distributor membayar truk (ORDB019), misalnya <b>2.960</b> per zak.</li>
          <li><b>Margin</b> = ongkir dibayar toko − bayar truk = 1.400 − 2.960 = <b className="text-red">−1.560</b> per zak: rugi, selisihnya ditanggung distributor.
            Kalau toko membayar ongkir 3.400 dan truk 2.974, margin <b className="text-green">+426</b>: untung.</li>
        </ul>
        <p className="mt-1.5">Per zak = per ton x berat zak (50 kg = 1/20 ton, 40 kg = 1/25 ton), karena truk dibayar per muatan. Angkutan dari pelabuhan / terminal ke gudang distributor
          (baris ORDB019 tanpa No DO) ditampilkan terpisah dan tidak ikut dihitung.</p>
      </div>
    </details>
  );
}

/** Kartu "satu zak": harga ambil sendiri + ongkir dibayar toko, dibanding bayar ke truk. */
function SatuZak({ v, S }: { v: Hasil; S: Satuan }) {
  const z = v.satuZak;
  if (z.ongkir == null || z.truk == null) return null;
  const m = z.ongkir - z.truk;   // margin: plus = untung
  const baris = (label: ReactNode, val: number | null, opts: { tanda?: string; tebal?: boolean; warna?: string; sub?: ReactNode } = {}) => (
    <div className={cx('flex items-baseline justify-between gap-4 py-1.5', opts.tebal && 'border-t border-line mt-1 pt-2.5')}>
      <div className="min-w-0"><div className={cx('text-[13.5px]', opts.tebal ? 'text-ink font-semibold' : 'text-soft')}>{label}</div>{opts.sub && <div className="text-faint text-[11.5px]">{opts.sub}</div>}</div>
      <div className={cx('font-mono text-[15px] whitespace-nowrap', opts.tebal && 'font-semibold', opts.warna)}>{opts.tanda}{val == null ? '–' : fmt(val * S.f)}</div>
    </div>
  );
  const total = [...v.sumberTon.values()].reduce((a, b) => a + b, 0) || 1;
  const pecah = ['rincian', 'tarif', 'harga', 'lg', 'kosong'].filter(k => v.sumberTon.get(k)).map(k => `${SUMBER[k]} ${fmtPct((v.sumberTon.get(k) || 0) / total, 0)}`);
  return (
    <section className="card mt-4 grid gap-6 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-[880px]:grid-cols-1">
      <div>
        <div className="card-title">Hitungan rata-rata {S.kata}</div>
        {z.loco != null && baris('Harga ambil sendiri (Loco, sebelum diskon)', z.loco)}
        {baris('Ongkir dibayar toko', z.ongkir, { tanda: z.loco != null ? '+ ' : '', sub: 'sudah termasuk di harga DO' })}
        {z.loco != null && baris('Harga sampai toko', z.loco + z.ongkir, { tebal: true })}
        <div className="h-3" />
        {baris('Ongkir dibayar toko (uang masuk)', z.ongkir)}
        {baris('Bayar ke truk (uang keluar, ORDB019)', z.truk, { tanda: '− ' })}
        {baris(m > 0 ? 'Margin: untung' : m < 0 ? 'Margin: rugi (ditanggung distributor)' : 'Margin: impas', m, { tebal: true, tanda: m > 0 ? '+' : '', warna: m > 0 ? 'text-green' : m < 0 ? 'text-red' : undefined })}
      </div>
      <div className="text-[13px] text-soft leading-relaxed self-center">
        <p>
          {m >= 0
            ? <>Untuk setiap {S.kata.replace('per ', '')}, toko membayar ongkir {fmt(z.ongkir * S.f)} dan distributor membayar truk {fmt(z.truk * S.f)}: untung <b className="text-green">{fmt(m * S.f)}</b>.</>
            : <>Untuk setiap {S.kata.replace('per ', '')}, distributor menombok <b className="text-red">{fmt(-m * S.f)}</b>: bayar ke truk {fmt(z.truk * S.f)}, sedangkan toko hanya membayar ongkir {fmt(z.ongkir * S.f)}.</>}
        </p>
        <p className="mt-2 text-faint text-[12px]">Dari DO yang biaya truknya lengkap ({fmtTon(z.ton)} ton). Ongkir dibayar toko diambil dari: {pecah.join(' · ') || '–'}.</p>
      </div>
    </section>
  );
}

/** Angkutan ke gudang (baris ORDB019 tanpa No DO): bukan pengiriman ke toko. */
function Gudang({ g, S }: { g: Hasil['gudang']; S: Satuan }) {
  return (
    <section className="card mt-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="card-title !mb-0">Angkutan ke gudang <span className="text-faint font-normal">· tidak ikut hitungan ongkos ke toko</span></div>
        <div className="text-[13px] text-soft">
          <b className="text-ink font-mono">{fmtTon(g.ton)}</b> ton · {fmt(g.trips)} perjalanan · biaya <b className="text-ink">{fmtIDRCompact(g.biaya)}</b>
          {g.tonBiaya > 0 && <> · {fmt(g.biayaAda / g.tonBiaya * S.f)} {S.kata}</>}
        </div>
      </div>
      <p className="text-faint text-[12px] mt-1">Baris ORDB019 tanpa No DO: angkutan dari pelabuhan / terminal ke gudang distributor atau antar gudang.</p>
      <div className="flex flex-wrap gap-2 mt-2.5">
        {g.tujuan.slice(0, 8).map(t => (
          <span key={t.nama} className="badge neutral !text-[12px]">{t.nama} · {fmtTon(t.ton)} t{t.biaya ? ` · ${fmtIDRCompact(t.biaya)}` : ' · tanpa biaya'}</span>
        ))}
      </div>
    </section>
  );
}

/** Toko yang dikirim tapi tidak membayar ongkir (subsidi tersembunyi). */
function TanpaOngkir({ v }: { v: Hasil }) {
  const [semua, setSemua] = useState(false);
  if (!v.tanpaOngkir.length) return null;
  const tampil = semua ? v.tanpaOngkir : v.tanpaOngkir.slice(0, 10);
  const ton = v.tanpaOngkir.reduce((a, t) => a + t.ton, 0), biaya = v.tanpaOngkir.reduce((a, t) => a + t.biaya, 0);
  return (
    <>
      <div className="flex items-end justify-between flex-wrap gap-2.5 mt-[38px] mb-3.5">
        <h2 className="section-title !m-0">Dikirim tanpa ongkir <span className="n">{fmt(v.tanpaOngkir.length)} toko · {fmtTon(ton)} ton · bayar truk {fmtIDRCompact(biaya)}</span></h2>
      </div>
      <p className="text-soft text-[12.5px] -mt-2 mb-3 max-w-[900px]">
        DO kirim yang tokonya tidak membayar ongkir: kolom Delivery di J073 bernilai 0 atau habis oleh potongan, tarif resmi zonanya 0, atau harga DO tidak di atas harga Loco.
        DO yang ongkirnya belum bisa dihitung tidak masuk daftar ini (lihat catatan di atas).
      </p>
      <TableWrap>
        <table>
          <caption className="sr-only">Toko yang dikirim tanpa ongkir</caption>
          <thead><tr><Th>Toko</Th><Th>Zona</Th><Th num>DO</Th><Th num>Ton</Th><Th num>Bayar truk</Th><Th>Keterangan</Th></tr></thead>
          <tbody>
            {tampil.map(t => (
              <tr key={t.cust || t.toko}>
                <td>{t.toko || t.cust}{t.cust && !t.toko.includes(t.cust) && <span className="block text-faint text-[11.5px] font-mono">{t.cust}</span>}</td>
                <td className="text-[12.5px]">{t.zona}</td>
                <td className="num font-mono">{fmt(t.jumlahDo)}</td>
                <td className="num font-mono">{fmtTon(t.ton)}</td>
                <td className="num font-mono">{t.biaya ? fmtIDR(t.biaya) : '–'}</td>
                <td className="text-[12.5px]">{t.belumDicek >= t.ton - 0.01 ? <span className="text-faint">belum bisa dicek</span> : t.belumDicek > 0 ? 'sebagian belum bisa dicek' : 'tanpa ongkir'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {v.tanpaOngkir.length > 10 && (
        <button type="button" className="btn btn-sm mt-3" onClick={() => setSemua(s => !s)}>{semua ? 'Tampilkan 10 teratas' : `Tampilkan semua ${fmt(v.tanpaOngkir.length)} toko`}</button>
      )}
    </>
  );
}

function Tutup({ pct, adaTagih }: { pct: number | null; adaTagih: boolean }) {
  if (pct == null) return <div className="kpi-delta">{adaTagih ? 'rata-rata DO yang terkirim; belum bisa dibanding ongkos real' : 'butuh J073 dengan kolom pengiriman'}</div>;
  const w = Math.max(0, Math.min(1, pct));
  return (
    <div className="mt-2">
      <div className="h-1.5 rounded-full bg-[#E9ECF0] overflow-hidden" aria-hidden="true"><div className="h-full rounded-full" style={{ width: `${w * 100}%`, background: COLORS.accent }} /></div>
      <div className="kpi-delta mt-1"><b className="text-ink">{fmtPct(pct, 0)}</b> ongkos real yang tertutup tagihan</div>
    </div>
  );
}

function BarList({ rows, sideTitle }: { rows: { key: string; label: string; sub: string; value: number; side: string; sideTone?: 'warn' }[]; sideTitle: string }) {
  if (!rows.length) return <p className="text-faint text-[13px]">Belum ada perjalanan dengan biaya.</p>;
  const max = Math.max(...rows.map(r => r.value));
  return (
    <div>
      <div className="flex justify-end text-[11.5px] text-faint mb-1.5 pr-0.5">{sideTitle}</div>
      <ul className="list-none p-0 m-0 flex flex-col gap-2.5">
        {rows.map(r => (
          <li key={r.key} className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_48px] items-center gap-3 max-[560px]:grid-cols-[minmax(0,110px)_minmax(0,1fr)_42px]">
            <div className="min-w-0"><div className="text-[13px] text-ink truncate">{r.label}</div><div className="text-[11px] text-faint truncate">{r.sub}</div></div>
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-3 rounded-sm" style={{ width: `${Math.max(4, (r.value / max) * 100)}%`, background: COLORS.blue }} aria-hidden="true" />
              <span className="font-mono text-[12.5px] text-ink whitespace-nowrap">{fmtIDR(r.value)}</span>
            </div>
            <div className={cx('text-right font-mono text-[12.5px]', r.sideTone === 'warn' ? 'text-amber font-semibold' : 'text-soft')}>{r.side}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TipeBars({ rows, f }: { rows: Hasil['tipe']; f: number }) {
  if (!rows.length) return <p className="text-faint text-[13px]">Butuh J073 dengan kolom pengiriman untuk DO pada periode ini.</p>;
  const max = Math.max(...rows.map(r => Math.max(r.biaya, r.tagih) / r.ton * f));
  return (
    <ul className="list-none p-0 m-0 flex flex-col gap-3.5">
      {rows.map(r => {
        const real = r.biaya / r.ton * f, tg = r.tagih / r.ton * f;
        return (
          <li key={r.tipe}>
            <div className="text-[13px] text-ink mb-1">{tipeLabel(r.tipe)} <span className="text-faint text-[11.5px]">· {fmtTon(r.ton)} ton</span></div>
            {[[real, COLORS.blue, 'Bayar truk'], [tg, COLORS.sub, 'Dibayar toko']].map(([val, c, l]) => (
              <div key={String(l)} className="flex items-center gap-2 mb-0.5">
                <div className="h-2.5 rounded-sm" style={{ width: `${Math.max(Number(val) > 0 ? 2 : 0, (Number(val) / max) * 80)}%`, background: String(c) }} aria-hidden="true" />
                <span className="font-mono text-[12px] text-soft whitespace-nowrap">{l} {fmt(val)}{l === 'Dibayar toko' && r.tipe === 'LG' && Number(val) === 0 ? ' · seharusnya tanpa kirim' : ''}</span>
              </div>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

function Tren({ info, S }: { info: Row[]; S: Satuan }) {
  const t = useMemo(() => {
    const m = new Map<string, { biaya: number; ton: number; tonAll: number; real: number; tonReal: number; tagih: number; tonTagih: number }>();
    let adaLengkap = false;
    info.forEach(r => {
      const k = String(r.periode).slice(0, 7);
      const x = m.get(k) || { biaya: 0, ton: 0, tonAll: 0, real: 0, tonReal: 0, tagih: 0, tonTagih: 0 };
      x.biaya += n(r.biaya); x.ton += n(r.ton_berbiaya); x.tonAll += n(r.ton);
      if (r.ton_lengkap != null) adaLengkap = true;
      x.real += n(r.real_lengkap); x.tonReal += n(r.ton_lengkap); x.tagih += n(r.tagih_lengkap); x.tonTagih += n(r.ton_tagih);
      m.set(k, x);
    });
    const keys = [...m.keys()].sort().slice(-24);
    const g = (k: string) => m.get(k)!;
    return {
      keys, adaLengkap,
      rp: keys.map(k => (adaLengkap ? (g(k).tonReal ? Math.round(g(k).real / g(k).tonReal * S.f) : null) : g(k).ton ? Math.round(g(k).biaya / g(k).ton * S.f) : null)),
      tagih: keys.map(k => (g(k).tonTagih ? Math.round(g(k).tagih / g(k).tonTagih * S.f) : null)),
      cov: keys.map(k => (g(k).tonAll ? g(k).ton / g(k).tonAll : 0)),
    };
  }, [info, S.f]);
  if (t.keys.length < 2) return null;
  const labels = t.keys.map(k => `${MONTHS_FULL[Number(k.slice(5))].slice(0, 3)} ${k.slice(2, 4)}`);
  const duaGaris = t.adaLengkap && t.tagih.some(x => x != null);
  const ds: any[] = [{ label: 'Bayar truk', data: t.rp, borderColor: COLORS.accent, backgroundColor: t.cov.map(c => (c < 0.8 ? '#fff' : COLORS.accent)),
    pointBorderColor: COLORS.accent, pointRadius: 3.5, borderWidth: 2.2, tension: 0.25, spanGaps: true }];
  if (duaGaris) ds.push({ label: 'Ongkir dibayar toko', data: t.tagih, borderColor: COLORS.green, backgroundColor: COLORS.green, pointRadius: 3, borderWidth: 2, borderDash: [5, 4], tension: 0.25, spanGaps: true });
  return (
    <Card title={duaGaris ? `Bayar truk vs ongkir dibayar toko, ${S.kata} per bulan` : `Ongkos real ${S.kata} per bulan`} className="mt-4">
      <p className="text-faint text-[12px] -mt-1 mb-2">
        {duaGaris ? 'Dari DO yang biaya truknya lengkap. Garis hijau di atas garis biru = untung, di bawah = rugi (ditanggung distributor). ' : 'Perjalanan yang sudah ada biayanya. '}
        Bulan dengan biaya belum lengkap (di bawah 80% muatan) diberi titik kosong.
      </p>
      {duaGaris && (
        <div className="flex gap-4 text-[12px] text-soft mb-1.5">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-[3px] rounded" style={{ background: COLORS.accent }} />Bayar truk</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: COLORS.green }} />Ongkir dibayar toko</span>
        </div>
      )}
      <ChartBox className="!h-[230px]" label={`Ongkos ${S.kata}, ${labels[0]} sampai ${labels[labels.length - 1]}`} deps={[t.keys.join('|'), t.rp.join('|'), t.tagih.join('|')]}
        build={() => ({
          type: 'line',
          data: { labels, datasets: ds },
          options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            scales: { y: { beginAtZero: true, grid: { color: COLORS.line }, border: { display: false }, ticks: { callback: (x: any) => fmt(x) } }, x: { grid: { display: false } } },
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: {
                label: (c: any) => ` ${c.dataset.label}: Rp${fmt(c.parsed.y)}${S.lbl}`,
                footer: (items: any[]) => {
                  const i = items[0]?.dataIndex; if (i == null) return '';
                  const r = t.rp[i], g = t.tagih[i];
                  const out = [`Biaya lengkap ${fmtPct(t.cov[i], 0)} muatan`];
                  if (duaGaris && r != null && g != null) out.unshift(`Margin: ${g - r > 0 ? '+' : ''}${fmt(g - r)}${S.lbl} (${g - r > 0 ? 'untung' : g - r < 0 ? 'rugi' : 'impas'})`);
                  return out;
                },
              } },
            },
          },
        } as ChartConfiguration)} />
    </Card>
  );
}

const URUT_TOKO = [{ value: 'tanggung', label: 'Margin (paling rugi dulu)' }, { value: 'pct', label: 'Ongkos % omzet' }, { value: 'rpton', label: 'Ongkos per satuan' }, { value: 'ton', label: 'Ton' }];
function TokoTable({ v, S }: { v: Hasil; S: Satuan }) {
  const [urut, setUrut] = useState('tanggung');
  const [semua, setSemua] = useState(false);
  const rows = useMemo(() => {
    const val = (t: Hasil['toko'][number]) => (urut === 'tanggung' ? (t.adaTagih ? -t.tanggung : -Infinity) : urut === 'pct' ? (t.omzet ? t.biayaOmzet / t.omzet : -1) : urut === 'rpton' ? t.biaya / t.ton : t.ton);
    return [...v.toko].sort((a, b) => val(b) - val(a));
  }, [v.toko, urut]);
  const tampil = semua ? rows : rows.slice(0, 15);
  return (
    <>
      <div className="flex items-end justify-between flex-wrap gap-2.5 mt-[38px] mb-3.5">
        <h2 className="section-title !m-0">Ongkos per toko <span className="n">{fmt(v.toko.length)} toko</span></h2>
        <Select label="Urutkan" value={urut} onChange={e => setUrut(e.target.value)} options={URUT_TOKO} />
      </div>
      <TableWrap>
        <table>
          <caption className="sr-only">Ongkos kirim per toko</caption>
          <thead>
            <tr><Th>Toko</Th><Th>Zona</Th><Th num>DO</Th><Th num>Ton</Th><Th num>Bayar truk {S.lbl}</Th><Th num>Ongkir dibayar toko</Th><Th num>Margin</Th><Th num>% omzet</Th></tr>
          </thead>
          <tbody>
            {!rows.length && <tr><td colSpan={8} className="!text-center !text-faint !p-5">Belum ada DO dengan biaya lengkap pada filter ini.</td></tr>}
            {tampil.map(t => (
              <tr key={t.cust || t.toko}>
                <td>{t.toko || t.cust}{t.cust && !t.toko.includes(t.cust) && <span className="block text-faint text-[11.5px] font-mono">{t.cust}</span>}</td>
                <td className="text-[12.5px]">{t.zona}</td>
                <td className="num font-mono">{fmt(t.jumlahDo)}</td>
                <td className="num font-mono">{fmtTon(t.ton)}</td>
                <td className="num font-mono">{fmtRpTon(perTon(t.biaya * S.f, t.ton))}</td>
                <td className="num font-mono">{t.adaTagih ? (t.tagih ? fmtIDR(t.tagih) : '0') : '–'}</td>
                <td className="num font-mono">{t.adaTagih ? <Margin v={t.tanggung} /> : '–'}</td>
                <td className="num font-mono">{t.omzet ? fmtPct(t.biayaOmzet / t.omzet) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {rows.length > 15 && (
        <button type="button" className="btn btn-sm mt-3" onClick={() => setSemua(s => !s)}>{semua ? 'Tampilkan 15 teratas' : `Tampilkan semua ${fmt(rows.length)} toko`}</button>
      )}
    </>
  );
}
