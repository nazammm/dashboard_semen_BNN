import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ChartConfiguration } from 'chart.js';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
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
   - Ditagih      : ongkos kirim di DO ke toko, dari J073 = (Delivery Price − Delivery Discount + Delivery Add) × qty.
   - Ditanggung   : real − ditagih (bagian ongkos yang dibayar distributor sendiri).
   Angka per ton dan per omzet hanya memakai DO yang semua perjalanannya sudah ada biayanya (tagihan
   transporter sering masuk belakangan); bagian yang belum lengkap ditunjukkan di peringatan atas.
============================================================================ */

const TIPE: Record<string, string> = { FF: 'Kirim dibongkar', FT: 'Kirim tanpa bongkar', FTK1: 'Tanpa bongkar · 1 kontainer', LG: 'Ambil di gudang' };
const tipeLabel = (t: string) => (t === '?' ? 'Belum ada di J073' : `${t} · ${TIPE[t] || t}`);
const n = (v: unknown) => Number(v || 0);
const fmtTon = (t: number) => fmt(t, t > 0 && t < 10 ? 1 : 0);
const perTon = (rp: number, ton: number) => (ton > 0 ? rp / ton : null);
const fmtRpTon = (v: number | null) => (v == null ? '–' : fmt(v));
const fmtPct = (v: number | null, d = 1) => (v == null || !isFinite(v) ? '–' : fmt(v * 100, d) + '%');
const judul = (s: unknown) => String(s ?? '').toLowerCase().replace(/(^|[\s(/.-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
/** "ISA065 - PT GLOBAL TRANSPORTINDO PRIMA" → "Global Transportindo Prima" */
const namaTransporter = (s: unknown) => judul(String(s ?? '').replace(/^[A-Z0-9]+\s*-\s*/i, '').replace(/^(PT|CV|UD|PD)\.?\s+/i, '')) || 'Tanpa transporter';
const namaTruk = (s: unknown) => judul(String(s ?? '').replace(/\s*\(([^)]*)\)/, ' $1').replace(/ TON\b/i, ' t').replace('FIT', 'ft')) || 'Tanpa tipe';
const bulanLabel = (iso: string) => `${MONTHS_FULL[Number(iso.slice(5, 7))]} ${iso.slice(0, 4)}`;

interface DoRow {
  dist: string; periode: string; doNo: string; biaya: number; ton: number; tanpaBiaya: number;
  truk: string; transporter: string; zona: string; cust: string; toko: string; tipe: string;
  omzet: number | null; tagih: number | null; lengkap: boolean;
}
interface Trip { dist: string; periode: string; foad: string; transporter: string; truk: string; zona: string; ritase: number; biaya: number; ton: number }

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

  const load = useAsync(async () => {
    const d = dist === 'all' ? null : [dist];
    const [trips, dos] = await Promise.all([DataSource.ongkosTrip(d, dari, sampai), DataSource.ongkosDo(d, dari, sampai)]);
    return { trips, dos };
  }, [dist, dari, sampai]);

  const data = useMemo(() => {
    if (!load.data) return null;
    const trips: Trip[] = load.data.trips.filter(r => n(r.ton) > 0).map(r => ({
      dist: String(r.dist_code), periode: String(r.periode).slice(0, 10), foad: String(r.foad), transporter: namaTransporter(r.transporter),
      truk: String(r.truk || ''), zona: judul(r.zona) || 'Tanpa zona', ritase: n(r.harga_ritase), biaya: n(r.biaya), ton: n(r.ton),
    }));
    const dos: DoRow[] = load.data.dos.map(r => {
      const tipeKirim = r.tipe_kirim ? String(r.tipe_kirim) : '?';
      return {
        dist: String(r.dist_code), periode: String(r.periode).slice(0, 10), doNo: String(r.do_no), biaya: n(r.biaya), ton: n(r.ton_kirim),
        tanpaBiaya: n(r.trip_tanpa_biaya), truk: String(r.truk || ''), transporter: namaTransporter(r.transporter), zona: judul(r.zona) || 'Tanpa zona',
        cust: String(r.customer_code ?? ''), toko: r.customer_name ? String(r.customer_name) : '', tipe: tipeKirim,
        omzet: r.omzet == null ? null : n(r.omzet), tagih: r.tagih == null || tipeKirim === '?' ? null : n(r.tagih),
        lengkap: n(r.trip_tanpa_biaya) === 0 && n(r.biaya) > 0,
      };
    });
    return { trips, dos };
  }, [load.data]);

  const transporters = useMemo(() => [...new Set((data?.trips || []).map(t => t.transporter))].sort(), [data]);
  const tipes = useMemo(() => [...new Set((data?.dos || []).map(d => d.tipe))].sort((a, b) => (a === '?' ? 1 : b === '?' ? -1 : a.localeCompare(b))), [data]);
  const transOk = trans === 'all' || transporters.includes(trans) ? trans : 'all';
  const tipeOk = tipe === 'all' || tipes.includes(tipe) ? tipe : 'all';

  const v = useMemo(() => (data ? hitung(data.trips, data.dos, tipeOk, transOk) : null), [data, tipeOk, transOk]);

  const infoScope = info.filter(r => dist === 'all' || r.dist_code === dist);
  const j073Sampai = infoScope.map(r => String(r.j073_sampai || '').slice(0, 10)).filter(Boolean).sort()[0];
  const distLabel = dist === 'all' ? 'Semua distributor' : (() => { const d = dists.find(x => x.code === dist)!; return `${d.kode} · ${d.code}`; })();
  const periodeLabel = dari === sampai ? bulanLabel(dari) : `${bulanLabel(dari)} s.d. ${bulanLabel(sampai)}`;
  const filterAktif = tipeOk !== 'all' || transOk !== 'all';

  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (!v) return;
    setBusy(true);
    try {
      await exportRowsToExcel([
        { name: 'Per zona', header: ['Zona', 'Ton', 'Ongkos real (Rp)', 'Real per ton', 'Ditagih (Rp)', 'Ditagih per ton', 'Ditanggung distributor (Rp)', 'Ongkos % omzet'],
          rows: v.zona.map(z => [z.nama, z.ton, z.biaya, perTon(z.biaya, z.ton), z.tagih, perTon(z.tagih, z.tonTagih), z.tanggung, z.omzet ? z.biayaOmzet / z.omzet : null]),
          widths: [24, 10, 16, 13, 14, 14, 20, 14] },
        { name: 'Per toko', header: ['Kode toko', 'Toko', 'Zona', 'DO', 'Ton', 'Ongkos real (Rp)', 'Real per ton', 'Ditagih (Rp)', 'Ditanggung distributor (Rp)', 'Ongkos % omzet'],
          rows: v.toko.map(t => [t.cust, t.toko, t.zona, t.jumlahDo, t.ton, t.biaya, perTon(t.biaya, t.ton), t.tagih, t.tanggung, t.omzet ? t.biayaOmzet / t.omzet : null]),
          widths: [11, 34, 20, 6, 9, 16, 13, 14, 20, 14] },
        { name: 'Per DO', header: ['Distributor', 'Bulan kirim', 'No DO', 'Kode toko', 'Toko', 'Tipe kirim', 'Zona', 'Truk', 'Transporter', 'Ton', 'Ongkos real (Rp)', 'Ditagih (Rp)', 'Omzet (Rp)', 'Biaya lengkap'],
          rows: v.dos.map(d => [d.dist, d.periode.slice(0, 7), d.doNo, d.cust, d.toko, d.tipe === '?' ? '' : d.tipe, d.zona, namaTruk(d.truk), d.transporter, d.ton, d.biaya, d.tagih, d.omzet, d.lengkap ? 'ya' : 'belum']),
          widths: [10, 10, 11, 10, 30, 8, 18, 22, 26, 8, 15, 13, 15, 11] },
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
        {filterAktif && <button type="button" className="btn btn-sm self-end max-[880px]:col-span-2 max-[880px]:justify-center" onClick={() => { setTipe('all'); setTrans('all'); }}>Reset filter</button>}
      </FilterBar>

      {load.error && <ErrorBox error={load.error} />}
      {!v && !load.error && <PageSkeleton />}
      {v && (
        <div className={cx(load.loading && 'opacity-60 transition-opacity')}>
          <Kelengkapan v={v} periodeLabel={periodeLabel} />

          <div className="grid-kpi mt-4">
            <Kpi title="Ongkos real" value={fmtIDRCompact(v.real)}
              delta={<>{fmtIDR(v.realTon ?? 0)} per ton · {fmt(v.tripBerbiaya)} perjalanan</>} />
            <Kpi title="Ongkos terhadap omzet" value={fmtPct(v.pctOmzet)}
              delta={v.omzetDasar ? <>dari omzet muatan {fmtIDRCompact(v.omzetDasar)}</> : 'omzet DO belum ada di J073'} />
            <Kpi title="Ditagih ke toko" value={v.tagihTon == null ? '–' : fmtIDR(v.tagihTon)} unit={v.tagihTon == null ? undefined : '/ton'}>
              <Tutup pct={v.tertutup} />
            </Kpi>
            <Kpi title="Ditanggung distributor" value={fmtIDRCompact(v.tanggung)}
              delta={v.doTagih ? <>{fmtIDR(v.tanggungTon ?? 0)} per ton · {fmt(v.doTagih)} DO</> : 'butuh J073 dengan kolom pengiriman'} />
          </div>

          <Tren info={infoScope} />

          <div className="grid gap-4 mt-4 grid-cols-2 max-[1100px]:grid-cols-1">
            <Card title={`Ongkos real per ton menurut tipe truk${tipeOk !== 'all' ? ' · semua tipe kirim' : ''}`}>
              <p className="text-faint text-[12px] -mt-1 mb-3">Perjalanan yang sudah ada biayanya. Isi truk = muatan semen dibanding kapasitas di nama tipe truk.</p>
              <BarList rows={v.truk.map(t => ({ key: t.truk, label: namaTruk(t.truk), sub: `${fmt(t.trips)} perjalanan · ${fmtTon(t.ton)} ton`, value: t.rpTon, side: t.isi == null ? '–' : fmtPct(t.isi, 0), sideTone: t.isi != null && t.isi < 0.8 ? 'warn' : undefined }))}
                sideTitle="Isi truk" />
            </Card>
            <Card title="Ditagih vs real per tipe kirim (Rp/ton)">
              <div className="flex gap-4 text-[12px] text-soft -mt-1 mb-3">
                <span className="inline-flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.blue }} />Ongkos real</span>
                <span className="inline-flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.sub }} />Ditagih ke toko</span>
              </div>
              <TipeBars rows={v.tipe} />
            </Card>
          </div>

          <div className="flex items-baseline justify-between flex-wrap gap-2.5 mt-[38px] mb-3.5">
            <h2 className="section-title !m-0">Ongkos per zona tujuan <span className="n">{distLabel} · {periodeLabel}</span></h2>
            {canDownload('ongkos-kirim') && (
              <button type="button" className="btn" onClick={download} disabled={busy || !v.dos.length}><FileIcon />{busy ? 'Menyiapkan…' : 'Download Excel'}</button>
            )}
          </div>
          <TableWrap>
            <table>
              <caption className="sr-only">Ongkos kirim per zona tujuan</caption>
              <thead><tr><th>Zona</th><th className="num">Ton</th><th className="num">Real /ton</th><th className="num">Ditagih /ton</th><th className="num">Ditanggung distributor</th><th className="num">Ongkos % omzet</th></tr></thead>
              <tbody>
                {!v.zona.length && <tr><td colSpan={6} className="!text-center !text-faint !p-5">Belum ada DO dengan biaya lengkap pada filter ini.</td></tr>}
                {v.zona.map(z => (
                  <tr key={z.nama}>
                    <td>{z.nama}</td>
                    <td className="num font-mono">{fmtTon(z.ton)}</td>
                    <td className="num font-mono">{fmtRpTon(perTon(z.biaya, z.ton))}</td>
                    <td className="num font-mono">{z.tonTagih ? fmtRpTon(perTon(z.tagih, z.tonTagih)) : '–'}</td>
                    <td className="num font-mono">{z.tonTagih ? fmtIDR(z.tanggung) : '–'}</td>
                    <td className="num font-mono">{z.omzet ? fmtPct(z.biayaOmzet / z.omzet) : '–'}</td>
                  </tr>
                ))}
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
                  <thead><tr><th>Transporter</th><th className="num">Ton</th><th className="num">Rp/ton</th><th className="num">vs ritase</th></tr></thead>
                  <tbody>
                    {v.transporter.map(t => (
                      <tr key={t.nama}>
                        <td className="text-[12.5px]">{t.nama}<span className="text-faint"> · {fmt(t.trips)} perjalanan</span></td>
                        <td className="num font-mono">{fmtTon(t.ton)}</td>
                        <td className="num font-mono">{fmtRpTon(perTon(t.biaya, t.ton))}</td>
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

          <TokoTable v={v} />

          <p className="text-faint text-[12px] mt-4 leading-relaxed max-w-[900px]">
            Ongkos real dari ORDB019, dibagi ke DO sesuai baris laporan (bulan = bulan kirim). Ditagih = (Delivery Price − Delivery Discount Price + Delivery Add Price) × qty dari J073,
            dibagi menurut ton yang terkirim di bulan itu. Per ton, omzet, dan ditanggung hanya memakai DO yang semua perjalanannya sudah ada biayanya; ditagih dan ditanggung juga hanya DO yang ada di J073 dengan kolom pengiriman.
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
function hitung(tripsAll: Trip[], dosAll: DoRow[], tipe: string, trans: string) {
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

  // perjalanan yang belum ada biayanya, per transporter
  const belum = new Map<string, { ton: number; trips: number; ritase: number }>();
  trips.filter(t => t.biaya === 0).forEach(t => {
    const x = belum.get(t.transporter) || { ton: 0, trips: 0, ritase: 0 };
    x.ton += t.ton; x.trips++; if (t.ritase > 0) x.ritase++; belum.set(t.transporter, x);
  });

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
  const zm = new Map<string, { nama: string; ton: number; biaya: number; tagih: number; tonTagih: number; tanggung: number; omzet: number; biayaOmzet: number }>();
  lengkap.forEach(d => {
    const x = zm.get(d.zona) || { nama: d.zona, ton: 0, biaya: 0, tagih: 0, tonTagih: 0, tanggung: 0, omzet: 0, biayaOmzet: 0 };
    x.ton += d.ton; x.biaya += d.biaya;
    if (d.tagih != null) { x.tagih += d.tagih; x.tonTagih += d.ton; x.tanggung += d.biaya - d.tagih; }
    if (d.omzet) { x.omzet += d.omzet; x.biayaOmzet += d.biaya; }
    zm.set(d.zona, x);
  });
  const zona = [...zm.values()].sort((a, b) => b.ton - a.ton);

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

  // per toko
  const km = new Map<string, { cust: string; toko: string; zonaTon: Map<string, number>; jumlahDo: number; ton: number; biaya: number; tagih: number; tanggung: number; adaTagih: boolean; omzet: number; biayaOmzet: number }>();
  lengkap.forEach(d => {
    const k = d.cust || `DO ${d.doNo}`;
    const x = km.get(k) || { cust: d.cust, toko: d.toko || (d.cust ? '' : 'DO belum ada di J073'), zonaTon: new Map(), jumlahDo: 0, ton: 0, biaya: 0, tagih: 0, tanggung: 0, adaTagih: false, omzet: 0, biayaOmzet: 0 };
    x.jumlahDo++; x.ton += d.ton; x.biaya += d.biaya; x.zonaTon.set(d.zona, (x.zonaTon.get(d.zona) || 0) + d.ton);
    if (d.tagih != null) { x.tagih += d.tagih; x.tanggung += d.biaya - d.tagih; x.adaTagih = true; }
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
    dos, ton, tonLengkap, real, realTon: perTon(real, tonLengkap), tripBerbiaya: trips.filter(t => t.biaya > 0).length, tripSemua: trips.length,
    pctOmzet: omzetDasar ? biayaOmzet / omzetDasar : null, omzetDasar,
    tagihTon: perTon(tagih, tonTagih), tertutup: realTagih ? tagih / realTagih : null,
    tanggung: realTagih - tagih, tanggungTon: perTon(realTagih - tagih, tonTagih), doTagih: ditagih.length,
    belum: [...belum.entries()].map(([nama, x]) => ({ nama, ...x })).sort((a, b) => b.ton - a.ton),
    truk, tipe: tipeRows, zona, transporter, ritaseBeda: { beda, total: totalR }, toko, cek: cek.slice(0, 5),
  };
}

/* ---------------------------------------------------------------------------
   Komponen
--------------------------------------------------------------------------- */
function Kelengkapan({ v, periodeLabel }: { v: Hasil; periodeLabel: string }) {
  if (!v.ton) return <div className="card text-soft text-[13px]">Tidak ada pengiriman semen pada filter ini.</div>;
  const p = v.tonLengkap / v.ton;
  if (p >= 0.97) return null;
  const top = v.belum.slice(0, 3);
  return (
    <div className={cx('upl-note', p < 0.8 ? 'is-warn' : 'is-info')} role="note">
      <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0 mt-px" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3.5 21.5 20h-19L12 3.5Z" /><path d="M12 10v4.5M12 17.2v.1" /></svg>
      <div className="text-[13px] leading-relaxed">
        <b>Biaya baru lengkap untuk {fmtPct(p, 0)} muatan {periodeLabel}</b> ({fmtTon(v.tonLengkap)} dari {fmtTon(v.ton)} ton).
        {top.length > 0 && <> Perjalanan yang tagihannya belum masuk: {top.map((t, i) => <span key={t.nama}>{i ? ', ' : ''}{t.nama} {fmtTon(t.ton)} ton{t.ritase ? ` (${fmt(t.ritase)} sudah ada ritase)` : ''}</span>)}.</>}
        {' '}Angka per ton, omzet, dan ditanggung di bawah hanya memakai DO yang biayanya sudah lengkap.
      </div>
    </div>
  );
}

function Tutup({ pct }: { pct: number | null }) {
  if (pct == null) return <div className="kpi-delta">butuh J073 dengan kolom pengiriman</div>;
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

function TipeBars({ rows }: { rows: Hasil['tipe'] }) {
  if (!rows.length) return <p className="text-faint text-[13px]">Butuh J073 dengan kolom pengiriman untuk DO pada periode ini.</p>;
  const max = Math.max(...rows.map(r => Math.max(r.biaya, r.tagih) / r.ton));
  return (
    <ul className="list-none p-0 m-0 flex flex-col gap-3.5">
      {rows.map(r => {
        const real = r.biaya / r.ton, tg = r.tagih / r.ton;
        return (
          <li key={r.tipe}>
            <div className="text-[13px] text-ink mb-1">{tipeLabel(r.tipe)} <span className="text-faint text-[11.5px]">· {fmtTon(r.ton)} ton</span></div>
            {[[real, COLORS.blue, 'Real'], [tg, COLORS.sub, 'Ditagih']].map(([val, c, l]) => (
              <div key={String(l)} className="flex items-center gap-2 mb-0.5">
                <div className="h-2.5 rounded-sm" style={{ width: `${Math.max(Number(val) > 0 ? 2 : 0, (Number(val) / max) * 80)}%`, background: String(c) }} aria-hidden="true" />
                <span className="font-mono text-[12px] text-soft whitespace-nowrap">{l} {fmt(val)}{l === 'Ditagih' && r.tipe === 'LG' && Number(val) === 0 ? ' · seharusnya tanpa kirim' : ''}</span>
              </div>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

function Tren({ info }: { info: Row[] }) {
  const t = useMemo(() => {
    const m = new Map<string, { biaya: number; ton: number; tonAll: number }>();
    info.forEach(r => {
      const k = String(r.periode).slice(0, 7);
      const x = m.get(k) || { biaya: 0, ton: 0, tonAll: 0 };
      x.biaya += n(r.biaya); x.ton += n(r.ton_berbiaya); x.tonAll += n(r.ton); m.set(k, x);
    });
    const keys = [...m.keys()].sort().slice(-24);
    return { keys, rp: keys.map(k => { const x = m.get(k)!; return x.ton ? Math.round(x.biaya / x.ton) : null; }), cov: keys.map(k => { const x = m.get(k)!; return x.tonAll ? x.ton / x.tonAll : 0; }) };
  }, [info]);
  if (t.keys.length < 2) return null;
  const labels = t.keys.map(k => `${MONTHS_FULL[Number(k.slice(5))].slice(0, 3)} ${k.slice(2, 4)}`);
  return (
    <Card title="Ongkos real per ton per bulan" className="mt-4">
      <p className="text-faint text-[12px] -mt-1 mb-2">Perjalanan yang sudah ada biayanya. Bulan dengan biaya belum lengkap (di bawah 80% muatan) diberi titik kosong.</p>
      <ChartBox className="!h-[220px]" label={`Ongkos per ton, ${labels[0]} sampai ${labels[labels.length - 1]}`} deps={[t.keys.join('|'), t.rp.join('|')]}
        build={() => ({
          type: 'line',
          data: { labels, datasets: [{ label: 'Rp/ton', data: t.rp, borderColor: COLORS.accent, backgroundColor: t.cov.map(c => (c < 0.8 ? '#fff' : COLORS.accent)),
            pointBorderColor: COLORS.accent, pointRadius: 3.5, borderWidth: 2.2, tension: 0.25, spanGaps: true }] },
          options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            scales: { y: { beginAtZero: true, grid: { color: COLORS.line }, border: { display: false }, ticks: { callback: (x: any) => fmt(x) } }, x: { grid: { display: false } } },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => ` Rp${fmt(c.parsed.y)}/ton · biaya lengkap ${fmtPct(t.cov[c.dataIndex], 0)} muatan` } } },
          },
        } as ChartConfiguration)} />
    </Card>
  );
}

const URUT_TOKO = [{ value: 'tanggung', label: 'Ditanggung distributor' }, { value: 'pct', label: 'Ongkos % omzet' }, { value: 'rpton', label: 'Ongkos per ton' }, { value: 'ton', label: 'Ton' }];
function TokoTable({ v }: { v: Hasil }) {
  const [urut, setUrut] = useState('tanggung');
  const [semua, setSemua] = useState(false);
  const rows = useMemo(() => {
    const val = (t: Hasil['toko'][number]) => (urut === 'tanggung' ? (t.adaTagih ? t.tanggung : -1) : urut === 'pct' ? (t.omzet ? t.biayaOmzet / t.omzet : -1) : urut === 'rpton' ? t.biaya / t.ton : t.ton);
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
            <tr><Th>Toko</Th><Th>Zona</Th><Th num>DO</Th><Th num>Ton</Th><Th num>Real /ton</Th><Th num>Ditagih</Th><Th num>Ditanggung</Th><Th num>% omzet</Th></tr>
          </thead>
          <tbody>
            {!rows.length && <tr><td colSpan={8} className="!text-center !text-faint !p-5">Belum ada DO dengan biaya lengkap pada filter ini.</td></tr>}
            {tampil.map(t => (
              <tr key={t.cust || t.toko}>
                <td>{t.toko || t.cust}{t.cust && !t.toko.includes(t.cust) && <span className="block text-faint text-[11.5px] font-mono">{t.cust}</span>}</td>
                <td className="text-[12.5px]">{t.zona}</td>
                <td className="num font-mono">{fmt(t.jumlahDo)}</td>
                <td className="num font-mono">{fmtTon(t.ton)}</td>
                <td className="num font-mono">{fmtRpTon(perTon(t.biaya, t.ton))}</td>
                <td className="num font-mono">{t.adaTagih ? (t.tagih ? fmtIDR(t.tagih) : '0') : '–'}</td>
                <td className="num font-mono">{t.adaTagih ? fmtIDR(t.tanggung) : '–'}</td>
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
