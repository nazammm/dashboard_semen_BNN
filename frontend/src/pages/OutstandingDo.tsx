import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChartConfiguration } from 'chart.js';
import { DataSource, sellInTargetsFor } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, MONTHS_ID, chartSRSummary, fmt, fmtCompact, fmtIDR, fmtIDRCompact } from '../lib/format';
import { addDays, addMonths, endOfMonth, fmtDate, fmtRange, isISO, startOfMonth, startOfYear, type DateRange } from '../lib/dates';
import type { Row } from '../lib/types';
import { DataBadge } from '../components/DataStatus';
import { Badge, Card, ChartBox, ErrorBox, FileIcon, FilterBar, Kpi, PageHeader, PageSkeleton, Select, TableWrap, Th, cx } from '../components/ui';
import { exportRowsToExcel } from '../lib/xlsx';
import { DateRangePicker, type RangePreset } from '../components/DateRangePicker';
import { JALUR_DARAT, JALUR_FAS, OPEN_STATUS, REGION_ORDER, UNMAPPED, key, outRecs, outSummary, sellinGeo, type OutRec, type OutSummary } from '../lib/ringkasan';

/* ============================================================================
   Outstanding DO (sell in): order ke pabrik yang belum terkirim, dari upload raw sell in
   menurut tanggal order (Kelola Data → Sell In BNN → Outstanding DO).
   Aturan baris sama dengan Sell In BNN (Gudang + PM toko/project dari ITP-Palembang).
   Outstanding = sisa order Verified (belum dikirim) + Partially Delivered (terkirim sebagian).
   Not Verified dihitung terpisah karena belum disetujui.
   Tabel utama mengikuti laporan outstanding: per daerah x jalur (FAS Kapal = Sunda Kelapa, FAS Container = CCY & Tanjung Priok)
   x tipe semen + perkiraan nilai, mengikuti filter rentang tanggal order (bawaan semua order). Rentang tanggal juga
   membatasi KPI, tabel per distributor, grafik, daftar order, dan unduhan.
   Terminal & pabrik (ITP Lampung/Palembang/Pontianak Terminal, ITP-Citeureup) di tabel terpisah.
   Lewat estimasi = estimasi tanggal pengiriman sudah lewat dari posisi data.
   Perkiraan nilai = sisa zak x harga Loco Net yang berlaku pada tanggal order, per PT dan produk
   (18_harga_loco.sql; harga diambil Nazam Auto Task dari ERP Price & Promo Simulation).
============================================================================ */

const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 && t % 1 ? 1 : 0);
const share = (a: number, b: number) => (b > 0 ? `${fmt(a / b * 100, 1)}%` : '–');
const STATUS_OPTS = [
  { value: 'open', label: 'Outstanding' },
  { value: 'Belum dikirim', label: 'Belum dikirim' },
  { value: 'Terkirim sebagian', label: 'Terkirim sebagian' },
  { value: 'Belum diverifikasi', label: 'Belum diverifikasi' },
];
const SEMEN_OPTS = [
  { value: 'all', label: 'Semua Tipe' }, { value: 'STR', label: 'STR' }, { value: 'RJW', label: 'RJW' }, { value: 'CWC', label: 'CWC (putih)' },
];
const statusList = (s: string) => (s === 'open' ? OPEN_STATUS : [s]);
const EMPTY_RANGE: DateRange = { from: '', to: '' };
const inRange = (t: string, r: DateRange | null) => !r || (t >= r.from && t <= r.to);
function presetsFor(last: string): RangePreset[] {
  const prev = addMonths(startOfMonth(last), -1);
  return [
    { label: 'Bulan order terakhir', range: { from: startOfMonth(last), to: last } },
    { label: 'Bulan sebelumnya', range: { from: prev, to: endOfMonth(prev) } },
    { label: '7 hari terakhir', range: { from: addDays(last, -6), to: last } },
    { label: '30 hari terakhir', range: { from: addDays(last, -29), to: last } },
    { label: '3 bulan terakhir', range: { from: addMonths(startOfMonth(last), -2), to: last } },
    { label: 'Tahun ini', range: { from: startOfYear(last), to: last } },
  ];
}
const LIST_LIMIT = 50;
/** "Rp1,2 M" atau "–" kalau belum ada harga sama sekali. */
const nilaiTeks = (n: number | null, ton: number, tanpa: number) => (n == null || (tanpa >= ton - 1e-6 && !n) ? '–' : fmtIDRCompact(n));

export default function OutstandingDo() {
  useDocTitle('Outstanding DO');
  const load = useAsync(async () => {
    const [rows, info, bulanan, targets] = await Promise.all([
      DataSource.outstandingRingkas(), DataSource.outstandingInfo(), DataSource.poBulanan().catch(() => [] as Row[]), DataSource.targetSellIn().catch(() => null),
    ]);
    // region induk sama dengan Sell In BNN: sub region (peta kode customer) -> region di tabel target
    const Y = Number(String(info?.posisi ?? '').slice(0, 4)) || new Date().getFullYear();
    const geo = sellinGeo(targets ? sellInTargetsFor(targets, Y) : null, rows, Y);
    return { rows, info, bulanan, parentOf: (sub: unknown) => geo.parentOf(key(sub || UNMAPPED)) };
  }, []);
  if (load.error) return <ErrorBox error={load.error} />;
  if (!load.data) return <PageSkeleton />;
  const { rows, info, bulanan, parentOf } = load.data;
  if (!info?.posisi) return <EmptyState />;
  return <Body rows={rows} info={info} bulanan={bulanan} parentOf={parentOf} />;
}

function EmptyState() {
  const { pageAllowed } = useAuth();
  return (
    <>
      <PageHeader title="Outstanding DO" />
      <div className="card max-w-[620px]">
        <h2 className="!text-[20px]">Belum ada data</h2>
        <p className="text-soft text-[13.5px] mt-2 leading-relaxed">
          Outstanding DO dibaca dari export raw sell in menurut tanggal order (semua status), diunggah admin di Kelola Data.
        </p>
        {pageAllowed('kelola-data') && <Link to="/kelola-data?data=sellin&menu=outstanding" className="btn btn-primary no-underline mt-4">Upload data sekarang</Link>}
      </div>
    </>
  );
}

function Body({ rows, info, bulanan, parentOf }: { rows: Row[]; info: Row; bulanan: Row[]; parentOf: (sub: unknown) => string }) {
  const { canDownload } = useAuth();
  const recs = useMemo(() => outRecs(rows).map(r => ({ ...r, sub: r.region, region: parentOf(r.region) })), [rows, parentOf]);
  const posisi = String(info.posisi).slice(0, 10);
  const posisiLama = info.posisi_terlama ? String(info.posisi_terlama).slice(0, 10) : posisi;

  /* ---------- filter ---------- */
  const [region, setRegion] = useState('all');
  const [dist, setDist] = useState('all');
  const [semen, setSemen] = useState('all');
  const [status, setStatus] = useState('open');
  /* rentang tanggal order: kosong = semua order */
  const { first, last } = useMemo(() => {
    let a = '', b = '';
    recs.forEach(r => { if (!a || r.tanggal_order < a) a = r.tanggal_order; if (!b || r.tanggal_order > b) b = r.tanggal_order; });
    return { first: a, last: b };
  }, [recs]);
  const presets = useMemo(() => (last ? presetsFor(last) : []), [last]);
  const [range, setRange] = useState<DateRange>(EMPTY_RANGE);
  const rng = isISO(range.from) && isISO(range.to) ? range : null;
  const opts = useMemo(() => {
    const regions = new Map<string, number>(), dists = new Map<string, { nama: string; ton: number }>();
    recs.forEach(r => {
      regions.set(r.region, (regions.get(r.region) || 0) + r.ton);
      if (region === 'all' || r.region === region) {
        const d = dists.get(r.distributor) || { nama: r.dist_nama, ton: 0 }; d.ton += r.ton; dists.set(r.distributor, d);
      }
    });
    return {
      regions: sortRegions([...regions.entries()]),
      dists: [...dists.entries()].sort((a, b) => b[1].ton - a[1].ton).map(([k, v]) => ({ value: k, label: v.nama })),
    };
  }, [recs, region]);
  const changeRegion = (v: string) => { setRegion(v); if (v !== 'all' && dist !== 'all' && !recs.some(r => r.region === v && r.distributor === dist)) setDist('all'); };
  const filterActive = region !== 'all' || dist !== 'all' || semen !== 'all' || status !== 'open' || !!rng;
  const resetFilter = () => { setRegion('all'); setDist('all'); setSemen('all'); setStatus('open'); setRange(EMPTY_RANGE); };

  const v = useMemo(() => {
    const wanted = new Set(statusList(status));
    const base = recs.filter(r => (region === 'all' || r.region === region) && (dist === 'all' || r.distributor === dist) && (semen === 'all' || r.semen === semen) && wanted.has(r.status));
    const cur = rng ? base.filter(r => inRange(r.tanggal_order, rng)) : base;
    const of = (jalurs: string[]) => cur.filter(r => jalurs.includes(r.jalur));
    const byDist = new Map<string, { label: string; recs: OutRec[] }>();
    cur.forEach(r => { const x = byDist.get(r.distributor) || { label: r.dist_nama, recs: [] }; x.recs.push(r); byDist.set(r.distributor, x); });
    return {
      cur, sum: outSummary(cur), fas: outSummary(of(JALUR_FAS)), kapal: outSummary(of(['FAS Kapal'])), container: outSummary(of(['FAS Container'])),
      darat: outSummary(of(JALUR_DARAT)),
      regions: sortRegions([...cur.reduce((m, r) => m.set(r.region, (m.get(r.region) || 0) + r.ton), new Map<string, number>()).entries()]),
      dists: [...byDist.entries()].map(([k, x]) => ({ key: k, label: x.label, ...outSummary(x.recs) })).sort((a, b) => b.ton - a.ton),
    };
  }, [recs, region, dist, semen, status, rng?.from, rng?.to]);

  /* ---------- order per bulan (tanggal order): terkirim, outstanding, belum diverifikasi ---------- */
  const monthly = useMemo(() => {
    const byM = new Map<string, { kirim: number; out: number; nv: number }>();
    bulanan.forEach(r => {
      if ((region !== 'all' && parentOf(r.region) !== region) || (dist !== 'all' && r.distributor !== dist) || (semen !== 'all' && r.semen !== semen)) return;
      const k = `${r.tahun}-${String(r.bulan).padStart(2, '0')}`;
      const x = byM.get(k) || { kirim: 0, out: 0, nv: 0 };
      x.kirim += Number(r.terkirim_ton || 0); x.out += Number(r.outstanding_ton || 0); x.nv += Number(r.belum_verifikasi_ton || 0);
      byM.set(k, x);
    });
    // dengan rentang: bulan yang bersinggungan dengan rentang; tanpa rentang: 12 bulan terakhir
    const keys = rng ? [...byM.keys()].filter(k => k >= rng.from.slice(0, 7) && k <= rng.to.slice(0, 7)).sort() : [...byM.keys()].sort().slice(-12);
    const multiYear = new Set(keys.map(k => k.slice(0, 4))).size > 1;
    return {
      labels: keys.map(k => MONTHS_ID[+k.slice(5)] + (multiYear ? ` ${k.slice(2, 4)}` : '')),
      kirim: keys.map(k => byM.get(k)!.kirim), out: keys.map(k => byM.get(k)!.out), nv: keys.map(k => byM.get(k)!.nv),
    };
  }, [bulanan, region, dist, semen, parentOf, rng?.from, rng?.to]);

  /* ---------- daftar order (dimuat per filter) ---------- */
  const subs = region === 'all' ? undefined : [...new Set(recs.filter(r => r.region === region).map(r => String(r.sub)))];
  const listFilter = { regions: subs, distributor: dist === 'all' ? undefined : dist, semen: semen === 'all' ? undefined : semen, status: statusList(status), dari: rng?.from, sampai: rng?.to };
  const list = useAsync(() => DataSource.outstandingList(listFilter, LIST_LIMIT), [region, dist, semen, status, rng?.from, rng?.to]);
  const [busy, setBusy] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const download = async () => {
    setBusy(true); setDlErr(null);
    try {
      const all = await DataSource.outstandingList(listFilter, null);
      await exportRowsToExcel([{
        name: 'Outstanding DO',
        header: ['Tanggal Order', 'Umur (hari)', 'Estimasi Kirim', 'Lewat (hari)', 'Status', 'Region', 'Sub Region', 'Jalur', 'Asal Pengiriman', 'Distributor', 'Order No', 'Produk', 'Tipe',
          'Kode Customer', 'Nama Customer', 'Tujuan', 'Loco/Franco', 'Order (zak)', 'Terkirim (zak)', 'Sisa (zak)', 'Sisa (ton)',
          'PT harga', 'Gudang harga', 'Loco Net (Rp/zak)', 'Harga berlaku dari', 'Perkiraan nilai (Rp)'],
        rows: all.map(r => [String(r.tanggal_order).slice(0, 10), Number(r.umur_hari), r.estimasi_kirim ? String(r.estimasi_kirim).slice(0, 10) : null, Number(r.lewat_hari),
          String(r.status), parentOf(r.region), String(r.region), String(r.jalur), r.asal_pengiriman as string | null, String(r.dist_nama), String(r.order_no), String(r.produk), String(r.semen),
          String(r.kode_customer), r.nama_customer as string | null, r.nama_tujuan as string | null, String(r.loco_franco),
          Number(r.order_qty), Number(r.delivery_qty), Number(r.sisa_zak), Number(r.sisa_ton),
          (r.harga_dist as string | null) ?? null, (r.harga_gudang as string | null) ?? null, r.harga_loco != null ? Number(r.harga_loco) : null,
          r.harga_dari ? String(r.harga_dari).slice(0, 10) : null, r.nilai != null ? Number(r.nilai) : null]),
        widths: [12, 10, 12, 10, 16, 12, 14, 14, 26, 26, 16, 22, 6, 12, 30, 30, 11, 11, 12, 10, 10, 10, 16, 14, 14, 18],
      }], `Outstanding_DO_posisi_${posisi}${rng ? `_order_${rng.from}_${rng.to}` : ''}.xlsx`, 'outstanding-do');
    } catch (e) { setDlErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const s = v.sum;
  const statusLabel = STATUS_OPTS.find(o => o.value === status)!.label;
  const scope = [dist !== 'all' ? opts.dists.find(o => o.value === dist)?.label : region !== 'all' && region, semen !== 'all' && semen, rng && `order ${fmtRange(rng)}`].filter(Boolean).join(' · ') || 'Semua';

  return (
    <>
      <PageHeader title="Outstanding DO" status={<DataBadge source="outstanding" />}>
        <p className="text-soft text-[13px] -mt-2">
          Posisi {fmtDate(posisi)} · order {info.order_mulai ? fmtDate(String(info.order_mulai).slice(0, 10)) : '–'} s.d. {info.order_sampai ? fmtDate(String(info.order_sampai).slice(0, 10)) : '–'}
          {posisiLama !== posisi && <span className="text-amber"> · sebagian order masih posisi {fmtDate(posisiLama)}, upload ulang rentang itu supaya statusnya terbaru</span>}
        </p>
      </PageHeader>

      <FilterBar label="Filter Outstanding DO" stickyMobile={false} className="max-[880px]:grid max-[880px]:grid-cols-2 max-[880px]:gap-2 max-[880px]:[&_select]:w-full max-[880px]:[&_select]:min-w-0">
        <Select label="Region" value={region} onChange={e => changeRegion(e.target.value)} style={{ minWidth: 130 }}
          options={[{ value: 'all', label: 'Semua Region' }, ...opts.regions.map(r => ({ value: r, label: r }))]} />
        <Select label="Distributor" value={dist} onChange={e => setDist(e.target.value)} className="min-w-[200px] max-[880px]:min-w-0"
          options={[{ value: 'all', label: 'Semua Distributor' }, ...opts.dists]} />
        <Select label="Tipe Semen" value={semen} onChange={e => setSemen(e.target.value)} style={{ minWidth: 120 }} options={SEMEN_OPTS} />
        <Select label="Status" value={status} onChange={e => setStatus(e.target.value)} style={{ minWidth: 150 }} options={STATUS_OPTS} />
        <div className="min-w-[230px] max-[880px]:col-span-2 max-[880px]:min-w-0">
          <DateRangePicker label="Tanggal order" value={range} onChange={setRange} min={first} max={last} presets={presets} allowClear placeholder="Semua tanggal order" />
        </div>
        {filterActive && <button type="button" className="btn btn-sm self-end max-[880px]:col-span-2 max-[880px]:justify-center" onClick={resetFilter}>Reset filter</button>}
      </FilterBar>

      <div className="grid-kpi min-[1180px]:grid-cols-5">
        <Kpi title={status === 'open' ? 'Outstanding' : statusLabel} value={fmtTon(s.ton)} unit="ton"
          delta={`${fmt(s.orders)} order · ${fmtTon(s.lewat)} ton lewat estimasi kirim`} />
        <NilaiKpi s={s} />
        <Kpi title="FAS Kapal" value={fmtTon(v.kapal.ton)} unit="ton" delta={`${share(v.kapal.ton, s.ton)} · ${fmt(v.kapal.orders)} order`} />
        <Kpi title="FAS Container" value={fmtTon(v.container.ton)} unit="ton" delta={`${share(v.container.ton, s.ton)} · ${fmt(v.container.orders)} order`} />
        <Kpi title="Terminal & pabrik" value={fmtTon(v.darat.ton)} unit="ton" delta={`${share(v.darat.ton, s.ton)} · ${fmt(v.darat.orders)} order`} />
      </div>

      <h2 className="section-title">Outstanding FAS per daerah <span className="n">ton · {statusLabel.toLowerCase()} · {scope}</span></h2>
      <JalurTable recs={v.cur} jalurs={JALUR_FAS} regions={v.regions} caption="Outstanding FAS Kapal dan FAS Container per daerah dan tipe semen" />

      <h2 className="section-title">Outstanding terminal & pabrik per daerah <span className="n">ton · ITP Terminal (Lampung, Palembang, Pontianak) dan ITP-Citeureup</span></h2>
      <JalurTable recs={v.cur} jalurs={JALUR_DARAT} regions={v.regions} caption="Outstanding dari terminal dan pabrik per daerah dan tipe semen" />

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-[1100px]:grid-cols-1 gap-4 mt-9">
        <Card title={`Order per bulan tanggal order · ${scope}`}>
          <div className="legend">
            <span><i style={{ background: COLORS.prev }} aria-hidden="true" />Terkirim</span>
            <span><i style={{ background: COLORS.accent }} aria-hidden="true" />Outstanding</span>
            <span><i style={{ background: COLORS.sub }} aria-hidden="true" />Belum diverifikasi</span>
          </div>
          <ChartBox label={chartSRSummary(monthly.labels, monthly.out, 'ton outstanding')} deps={[monthly.labels.join('|'), monthly.out.join('|'), monthly.kirim.join('|'), monthly.nv.join('|')]}
            build={() => ({
              type: 'bar',
              data: { labels: monthly.labels, datasets: [
                { label: 'Terkirim', data: monthly.kirim, backgroundColor: COLORS.prev, maxBarThickness: 26, stack: 's' },
                { label: 'Outstanding', data: monthly.out, backgroundColor: COLORS.accent, maxBarThickness: 26, stack: 's' },
                { label: 'Belum diverifikasi', data: monthly.nv, backgroundColor: COLORS.sub, maxBarThickness: 26, stack: 's' },
              ] },
              options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { stacked: true, beginAtZero: true, grid: { color: COLORS.line }, border: { display: false }, ticks: { callback: (x: any) => fmtCompact(x) } }, x: { stacked: true, grid: { display: false } } },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${fmt(c.parsed.y)} ton` } } },
              },
            } as ChartConfiguration)} />
          <p className="text-faint text-[12px] mt-2">Tinggi batang = order masuk bulan itu (tanpa reject).{rng && ' Bulan pertama dan terakhir ditampilkan penuh, tidak dipotong sesuai rentang.'}</p>
        </Card>
        <Card className="!p-0 overflow-hidden">
          <div className="card-title px-4 pt-3.5 !mb-2">Per distributor · {statusLabel.toLowerCase()}</div>
          <div className="max-h-[360px] overflow-auto border-t border-line">
            <table className="tbl-dense !min-w-0">
              <caption className="sr-only">Outstanding per distributor</caption>
              <thead><tr><th>Distributor</th><th className="num">Order</th><th className="num">Ton</th><th className="num" title="Ton yang estimasi kirimnya sudah lewat">Lewat est.</th>{s.nilai != null && <th className="num" title="Nilai jual OS (perkiraan): sisa zak pesanan ke pabrik x harga jual Loco Net. Bukan kerugian.">Nilai</th>}</tr></thead>
              <tbody>
                {v.dists.length === 0 && <tr><td colSpan={5} className="!text-center !text-faint !p-5">Tidak ada order pada filter ini.</td></tr>}
                {v.dists.map(d => (
                  <tr key={d.key}>
                    <td><button type="button" className="link-btn !no-underline font-medium text-left" onClick={() => setDist(d.key)}>{d.label}</button></td>
                    <td className="num font-mono">{fmt(d.orders)}</td>
                    <td className="num font-mono font-semibold">{fmtTon(d.ton)}</td>
                    <td className="num font-mono">{fmtTon(d.lewat)}</td>
                    {s.nilai != null && (
                      <td className="num font-mono whitespace-nowrap" title={d.tanpaHarga > 0.05 ? `${fmtTon(d.tanpaHarga)} ton belum ada harga Loco` : undefined}>
                        {nilaiTeks(d.nilai, d.ton, d.tanpaHarga)}{d.tanpaHarga > 0.05 && d.tanpaHarga < d.ton - 0.05 && <span className="text-amber">*</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.nilai != null && v.dists.some(d => d.tanpaHarga > 0.05 && d.tanpaHarga < d.ton - 0.05) && (
            <p className="text-faint text-[12px] px-4 py-2 border-t border-line">* sebagian order belum ada harga Loco, nilainya belum dihitung.</p>
          )}
        </Card>
      </div>

      <div className="flex items-baseline justify-between flex-wrap gap-2.5 mt-[38px] mb-3.5">
        <h2 className="section-title !m-0">Order tertua <span className="n">{fmt(Math.min(LIST_LIMIT, s.orders))} dari {fmt(s.orders)} order · {statusLabel.toLowerCase()} · {scope}</span></h2>
        {canDownload('outstanding-do') && (
          <button type="button" className="btn" onClick={download} disabled={busy || s.orders === 0}>
            <FileIcon />{busy ? 'Menyiapkan…' : `Download Excel (${fmt(s.orders)} order)`}
          </button>
        )}
      </div>
      {dlErr && <div className="mb-3"><ErrorBox error={dlErr} /></div>}
      <TableWrap>
        <table className={cx(list.loading && list.data && 'opacity-60')}>
          <caption className="sr-only">Order outstanding paling lama</caption>
          <thead>
            <tr>
              <Th>Tanggal order</Th><Th num>Umur</Th><Th>Estimasi kirim</Th><Th>Distributor</Th><Th>Tujuan</Th><Th>Jalur</Th><Th>Produk</Th>
              <Th num>Order (zak)</Th><Th num>Sisa (ton)</Th>{s.nilai != null && <Th num>Perkiraan nilai</Th>}<Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {list.error && <tr><td colSpan={11} className="!text-center !text-red !p-5">{list.error.message}</td></tr>}
            {!list.data && !list.error && <tr><td colSpan={11} className="!text-center !text-faint !p-5">Memuat…</td></tr>}
            {list.data && list.data.length === 0 && <tr><td colSpan={11} className="!text-center !text-faint !p-5">Tidak ada order pada filter ini.</td></tr>}
            {list.data && list.data.map(r => (
              <tr key={`${r.distributor}|${r.order_no}|${r.produk}`}>
                <td className="whitespace-nowrap">{fmtDate(String(r.tanggal_order).slice(0, 10))}</td>
                <td className="num font-mono whitespace-nowrap">{fmt(r.umur_hari)} hari</td>
                <td className="whitespace-nowrap">
                  {r.estimasi_kirim ? fmtDate(String(r.estimasi_kirim).slice(0, 10)) : '–'}
                  {Number(r.lewat_hari) > 0 && <span className="text-red text-[11.5px]"> lewat {fmt(r.lewat_hari)} hari</span>}
                </td>
                <td className="whitespace-nowrap">{String(r.dist_nama)}</td>
                <td className="max-w-[240px] truncate" title={String(r.nama_tujuan || r.nama_customer || '')}>{String(r.nama_tujuan || r.nama_customer || '–')}</td>
                <td className="whitespace-nowrap">{String(r.jalur)}</td>
                <td className="whitespace-nowrap">{String(r.produk).replace(/^NEW\s*-\s*/i, '')}</td>
                <td className="num font-mono">{fmt(r.order_qty)}</td>
                <td className="num font-mono font-semibold">{fmtTon(Number(r.sisa_ton))}</td>
                {s.nilai != null && (
                  <td className="num font-mono whitespace-nowrap" title={r.harga_loco != null ? `Loco Net ${fmtIDR(r.harga_loco)} per zak (${String(r.harga_dist ?? '')}${r.harga_gudang ? ` gudang ${String(r.harga_gudang)}` : ''}, berlaku sejak ${fmtDate(String(r.harga_dari).slice(0, 10))})` : 'Belum ada harga Loco untuk PT, produk, dan tanggal order ini'}>
                    {r.harga_loco != null ? fmtIDRCompact(r.nilai) : <span className="text-faint">belum ada harga</span>}
                  </td>
                )}
                <td>{r.status === 'Terkirim sebagian' ? <Badge variant="warn">Sebagian</Badge> : r.status === 'Belum diverifikasi' ? <Badge variant="neutral">Belum verifikasi</Badge> : <Badge variant="neutral">Belum dikirim</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}

/** KPI perkiraan nilai: sisa zak x Loco Net pada tanggal order. */
function NilaiKpi({ s }: { s: OutSummary }) {
  const { pageAllowed } = useAuth();
  if (s.nilai == null) return <Kpi title="Nilai jual OS (perkiraan)" value="–" delta="Harga Loco belum disiapkan di database (18_harga_loco.sql)" />;
  const berharga = s.ton - s.tanpaHarga;
  if (berharga <= 0.05) {
    return (
      <Kpi title="Nilai jual OS (perkiraan)" value="–"
        delta={<>Belum ada harga Loco untuk order ini{pageAllowed('kelola-data') && <> · <Link to="/kelola-data?data=sellin&menu=harga" className="underline">upload harga</Link></>}</>} />
    );
  }
  return (
    <Kpi title="Nilai jual OS (perkiraan)" value={fmtIDRCompact(s.nilai)}
      delta={s.tanpaHarga > 0.05
        ? <span>Sisa pesanan ke pabrik x harga jual Loco · <span className="text-amber">{fmtTon(s.tanpaHarga)} ton ({share(s.tanpaHarga, s.ton)}) belum ada harga</span></span>
        : 'Sisa pesanan ke pabrik x harga jual Loco pada tanggal order; bukan kerugian'} />
  );
}

/** Urutan daerah seperti laporan; daerah di luar daftar menyusul menurut tonase. */
function sortRegions(entries: [string, number][]) {
  const rank = (r: string) => { const i = REGION_ORDER.indexOf(r); return i < 0 ? REGION_ORDER.length : i; };
  return entries.sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1]).map(([k]) => k);
}

const SEMEN_ORDER = ['STR', 'RJW', 'CWC'];
/**
 * Tabel laporan outstanding: baris = daerah, kolom = jalur x tipe semen, Total ton, lalu perkiraan nilai (Loco Net x sisa zak).
 * Isinya mengikuti filter (termasuk rentang tanggal order; bawaan semua order).
 * Kolom tipe semen hanya yang ada isinya (CWC biasanya hanya dari pabrik).
 */
function JalurTable({ recs, jalurs, caption, regions }: { recs: OutRec[]; jalurs: string[]; caption: string; regions: string[] }) {
  const t = useMemo(() => {
    const rows = recs.filter(r => jalurs.includes(r.jalur));
    const usedJalur = jalurs.filter(j => rows.some(r => r.jalur === j));
    const semenOf = (j: string) => SEMEN_ORDER.filter(sm => rows.some(r => r.jalur === j && r.semen === sm));
    const cols = usedJalur.flatMap(j => semenOf(j).map(sm => ({ j, sm })));
    const cell = new Map<string, number>();
    const add = (k: string, x: number) => cell.set(k, (cell.get(k) || 0) + x);
    rows.forEach(r => {
      for (const reg of [r.region, '__total']) {
        add(`${reg}|${r.jalur}|${r.semen}`, r.ton); add(`${reg}|sum`, r.ton);
        add(`${reg}|nilai`, r.nilai || 0); add(`${reg}|tanpa`, r.tanpaHarga);
      }
    });
    return { usedJalur, semenOf, cols, adaNilai: rows.some(r => r.nilai != null), get: (k: string) => cell.get(k) || 0 };
  }, [recs, jalurs]);

  if (!t.cols.length) return <div className="card text-faint text-[13px]">Tidak ada outstanding pada filter ini.</div>;
  const num = (x: number) => (x ? fmtTon(x) : '–');
  const nilaiSel = (reg: string, strong?: boolean) => {
    const ton = t.get(`${reg}|sum`), tanpa = t.get(`${reg}|tanpa`), n = t.get(`${reg}|nilai`);
    const sebagian = tanpa > 0.05 && tanpa < ton - 0.05;
    return (
      <td key="nilai" className={cx('num font-mono whitespace-nowrap otb-sep', strong && 'font-semibold')}
        title={tanpa > 0.05 ? `${fmtTon(tanpa)} ton belum ada harga Loco, tidak ikut dihitung` : undefined}>
        {ton && tanpa < ton - 0.05 ? fmtIDRCompact(n) : '–'}{sebagian && <span className="text-amber">*</span>}
      </td>
    );
  };
  const line = (reg: string, strong?: boolean) => [
    ...t.cols.map(c => <td key={`${c.j}${c.sm}`} className="num font-mono">{num(t.get(`${reg}|${c.j}|${c.sm}`))}</td>),
    <td key="sum" className={cx('num font-mono', strong !== false && 'font-semibold')}>{num(t.get(`${reg}|sum`))}</td>,
    ...(t.adaNilai ? [nilaiSel(reg, strong !== false)] : []),
  ];
  return (
    <>
      <TableWrap>
        <table className="tbl-dense otb">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th rowSpan={2} className="align-bottom">Daerah</th>
              {t.usedJalur.map(j => <th key={j} colSpan={t.semenOf(j).length} className="!text-center">{j}</th>)}
              <th rowSpan={2} className="num align-bottom">Total (ton)</th>
              {t.adaNilai && <th rowSpan={2} className="num align-bottom otb-sep" title="Nilai jual OS (perkiraan): sisa zak pesanan ke pabrik x harga jual Loco Net pada tanggal order. Bukan kerugian.">Est. nilai</th>}
            </tr>
            <tr>
              {t.cols.map(c => <th key={`${c.j}${c.sm}`} className="num">{c.sm}</th>)}
            </tr>
          </thead>
          <tbody>
            {regions.map(reg => <tr key={reg}><td className="font-medium">{reg}</td>{line(reg, false)}</tr>)}
          </tbody>
          <tfoot>
            <tr><td>Total</td>{line('__total')}</tr>
          </tfoot>
        </table>
      </TableWrap>
      {t.adaNilai && t.get('__total|tanpa') > 0.05 && (
        <p className="text-faint text-[12px] mt-1.5">Est. nilai = sisa zak x Loco Net. {fmtTon(t.get('__total|tanpa'))} ton belum ada harga Loco dan tidak ikut dihitung (* = sebagian).</p>
      )}
    </>
  );
}
