import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChartConfiguration } from 'chart.js';
import { DataSource, sellInTargetsFor } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, MONTHS_ID, chartSRSummary, fmt, fmtCompact } from '../lib/format';
import { fmtDate } from '../lib/dates';
import type { Row } from '../lib/types';
import { DataBadge } from '../components/DataStatus';
import { Badge, Card, ChartBox, ErrorBox, FileIcon, FilterBar, Kpi, PageHeader, PageSkeleton, Select, TableWrap, Th, cx } from '../components/ui';
import { exportRowsToExcel } from '../lib/xlsx';
import { OPEN_STATUS, UMUR_BUCKETS, UNMAPPED, key, outRecs, outSummary, sellinGeo, type OutRec } from '../lib/ringkasan';

/* ============================================================================
   Outstanding DO (sell in): order ke pabrik yang belum terkirim, dari upload raw sell in
   menurut tanggal order (Kelola Data → Sell In BNN → Outstanding DO).
   Aturan baris sama dengan Sell In BNN (Gudang + PM toko/project dari ITP-Palembang).
   Outstanding = sisa order Verified (belum dikirim) + Partially Delivered (terkirim sebagian).
   Not Verified dihitung terpisah karena belum disetujui.
   Umur = posisi data - tanggal order. Lewat estimasi = estimasi tanggal pengiriman sudah lewat.
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
const LIST_LIMIT = 50;

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
  const opts = useMemo(() => {
    const regions = new Map<string, number>(), dists = new Map<string, { nama: string; ton: number }>();
    recs.forEach(r => {
      if (!OPEN_STATUS.includes(r.status) && r.status !== 'Belum diverifikasi') return;
      regions.set(r.region, (regions.get(r.region) || 0) + r.ton);
      if (region === 'all' || r.region === region) {
        const d = dists.get(r.distributor) || { nama: r.dist_nama, ton: 0 }; d.ton += r.ton; dists.set(r.distributor, d);
      }
    });
    return {
      regions: [...regions.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k),
      dists: [...dists.entries()].sort((a, b) => b[1].ton - a[1].ton).map(([k, v]) => ({ value: k, label: v.nama })),
    };
  }, [recs, region]);
  const changeRegion = (v: string) => { setRegion(v); if (v !== 'all' && dist !== 'all' && !recs.some(r => r.region === v && r.distributor === dist)) setDist('all'); };
  const filterActive = region !== 'all' || dist !== 'all' || semen !== 'all' || status !== 'open';
  const resetFilter = () => { setRegion('all'); setDist('all'); setSemen('all'); setStatus('open'); };
  const groupBy: 'region' | 'dist' = region === 'all' && dist === 'all' ? 'region' : 'dist';

  const v = useMemo(() => {
    const geoOk = (r: OutRec) => (region === 'all' || r.region === region) && (dist === 'all' || r.distributor === dist) && (semen === 'all' || r.semen === semen);
    const wanted = new Set(statusList(status));
    const cur = recs.filter(r => geoOk(r) && wanted.has(r.status));
    const sum = outSummary(cur);
    const nv = outSummary(recs.filter(r => geoOk(r) && r.status === 'Belum diverifikasi'));

    // per region / distributor
    const g = new Map<string, { label: string; recs: OutRec[] }>();
    cur.forEach(r => {
      const k = groupBy === 'region' ? r.region : r.distributor;
      const x = g.get(k) || { label: groupBy === 'region' ? r.region : r.dist_nama, recs: [] };
      x.recs.push(r); g.set(k, x);
    });
    const groups = [...g.entries()].map(([k, x]) => ({ key: k, label: x.label, ...outSummary(x.recs) })).sort((a, b) => b.ton - a.ton);
    return { cur, sum, nv, groups };
  }, [recs, region, dist, semen, status, groupBy]);

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
    const keys = [...byM.keys()].sort().slice(-12);
    const multiYear = new Set(keys.map(k => k.slice(0, 4))).size > 1;
    return {
      labels: keys.map(k => MONTHS_ID[+k.slice(5)] + (multiYear ? ` ${k.slice(2, 4)}` : '')),
      kirim: keys.map(k => byM.get(k)!.kirim), out: keys.map(k => byM.get(k)!.out), nv: keys.map(k => byM.get(k)!.nv),
    };
  }, [bulanan, region, dist, semen, parentOf]);

  /* ---------- daftar order (dimuat per filter) ---------- */
  const subs = region === 'all' ? undefined : [...new Set(recs.filter(r => r.region === region).map(r => r.sub))];
  const listFilter = { regions: subs, distributor: dist === 'all' ? undefined : dist, semen: semen === 'all' ? undefined : semen, status: statusList(status) };
  const list = useAsync(() => DataSource.outstandingList(listFilter, LIST_LIMIT), [region, dist, semen, status]);
  const [busy, setBusy] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const download = async () => {
    setBusy(true); setDlErr(null);
    try {
      const all = await DataSource.outstandingList(listFilter, null);
      await exportRowsToExcel([{
        name: 'Outstanding DO',
        header: ['Tanggal Order', 'Umur (hari)', 'Estimasi Kirim', 'Lewat (hari)', 'Status', 'Region', 'Sub Region', 'Distributor', 'Order No', 'Produk',
          'Kode Customer', 'Nama Customer', 'Tujuan', 'Asal Pengiriman', 'Loco/Franco', 'Order (zak)', 'Terkirim (zak)', 'Sisa (zak)', 'Sisa (ton)'],
        rows: all.map(r => [String(r.tanggal_order).slice(0, 10), Number(r.umur_hari), r.estimasi_kirim ? String(r.estimasi_kirim).slice(0, 10) : null, Number(r.lewat_hari),
          String(r.status), parentOf(r.region), String(r.region), String(r.dist_nama), String(r.order_no), String(r.produk), String(r.kode_customer), r.nama_customer as string | null,
          r.nama_tujuan as string | null, r.asal_pengiriman as string | null, String(r.loco_franco), Number(r.order_qty), Number(r.delivery_qty), Number(r.sisa_zak), Number(r.sisa_ton)]),
        widths: [12, 10, 12, 10, 16, 12, 14, 26, 16, 22, 12, 30, 30, 26, 11, 11, 12, 10, 10],
      }], `Outstanding_DO_posisi_${posisi}.xlsx`, 'outstanding-do');
    } catch (e) { setDlErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const s = v.sum;
  const statusLabel = STATUS_OPTS.find(o => o.value === status)!.label;
  const scope = [dist !== 'all' ? opts.dists.find(o => o.value === dist)?.label : region !== 'all' && region, semen !== 'all' && semen].filter(Boolean).join(' · ') || 'Semua';
  const bucketLabels = UMUR_BUCKETS.map(b => b.label);

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
        {filterActive && <button type="button" className="btn btn-sm self-end max-[880px]:col-span-2 max-[880px]:justify-center" onClick={resetFilter}>Reset filter</button>}
      </FilterBar>

      <div className="grid-kpi">
        <Kpi title={status === 'open' ? 'Outstanding' : statusLabel} value={fmtTon(s.ton)} unit="ton"
          delta={`${fmt(s.orders)} order${s.umurRata != null ? ` · umur rata-rata ${fmt(s.umurRata)} hari` : ''}`} />
        <Kpi title="Lewat estimasi kirim" value={fmtTon(s.lewat)} unit="ton" delta={`${share(s.lewat, s.ton)} dari ${status === 'open' ? 'outstanding' : statusLabel.toLowerCase()}`} />
        <Kpi title="Umur lebih dari 30 hari" value={fmtTon(s.tua)} unit="ton" delta={s.tertua ? `Order tertua ${fmtDate(s.tertua)}` : undefined} />
        <Kpi title="Belum diverifikasi" value={fmtTon(v.nv.ton)} unit="ton"
          delta={status === 'Belum diverifikasi' ? 'Ditampilkan di atas' : `${fmt(v.nv.orders)} order, tidak termasuk outstanding`} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] max-[1100px]:grid-cols-1 gap-4 mt-4">
        <Card title={`Umur order · ${statusLabel} · ${scope}`}>
          <ChartBox label={chartSRSummary(bucketLabels, s.buckets, 'ton')} deps={[s.buckets.join('|')]}
            build={() => ({
              type: 'bar',
              data: { labels: bucketLabels, datasets: [{ data: s.buckets, backgroundColor: UMUR_BUCKETS.map(b => (b.max > 30 ? COLORS.blue : COLORS.accent)), maxBarThickness: 22 }] },
              options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                scales: { x: { beginAtZero: true, grid: { color: COLORS.line }, border: { display: false }, ticks: { callback: (x: any) => fmtCompact(x) } }, y: { grid: { display: false } } },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => ` ${fmt(c.parsed.x)} ton (${share(c.parsed.x, s.ton)})` } } },
              },
            } as ChartConfiguration)} />
          <p className="text-faint text-[12px] mt-2">Umur dihitung dari tanggal order sampai posisi data.</p>
        </Card>
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
          <p className="text-faint text-[12px] mt-2">Tinggi batang = order masuk bulan itu (tanpa reject).</p>
        </Card>
      </div>

      <h2 className="section-title">Per {groupBy === 'region' ? 'region' : 'distributor'} <span className="n">{statusLabel.toLowerCase()} · {scope}</span></h2>
      <TableWrap>
        <table>
          <caption className="sr-only">Outstanding per {groupBy === 'region' ? 'region' : 'distributor'}</caption>
          <thead>
            <tr>
              <Th>{groupBy === 'region' ? 'Region' : 'Distributor'}</Th><Th num>Order</Th><Th num>{statusLabel} (ton)</Th><Th num>Lewat estimasi (ton)</Th>
              <Th num>Umur &gt; 30 hari (ton)</Th><Th num>Umur rata-rata</Th><Th>Order tertua</Th>
            </tr>
          </thead>
          <tbody>
            {v.groups.length === 0 && <tr><td colSpan={7} className="!text-center !text-faint !p-5">Tidak ada order pada filter ini.</td></tr>}
            {v.groups.map(g => (
              <tr key={g.key}>
                <td>
                  {groupBy === 'region'
                    ? <button type="button" className="link-btn !no-underline font-medium" onClick={() => changeRegion(g.key)}>{g.label}</button>
                    : <span className="font-medium">{g.label}</span>}
                </td>
                <td className="num font-mono">{fmt(g.orders)}</td>
                <td className="num font-mono font-semibold">{fmtTon(g.ton)}</td>
                <td className="num font-mono">{fmtTon(g.lewat)} <span className="text-faint text-[11.5px]">{share(g.lewat, g.ton)}</span></td>
                <td className="num font-mono">{fmtTon(g.tua)}</td>
                <td className="num font-mono whitespace-nowrap">{g.umurRata == null ? '–' : `${fmt(g.umurRata)} hari`}</td>
                <td className="whitespace-nowrap">{g.tertua ? fmtDate(g.tertua) : '–'}</td>
              </tr>
            ))}
          </tbody>
          {v.groups.length > 1 && (
            <tfoot>
              <tr>
                <td>Total</td><td className="num font-mono">{fmt(s.orders)}</td><td className="num font-mono">{fmtTon(s.ton)}</td>
                <td className="num font-mono">{fmtTon(s.lewat)}</td><td className="num font-mono">{fmtTon(s.tua)}</td>
                <td className="num font-mono">{s.umurRata == null ? '–' : `${fmt(s.umurRata)} hari`}</td><td>{s.tertua ? fmtDate(s.tertua) : '–'}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </TableWrap>

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
              <Th>Tanggal order</Th><Th num>Umur</Th><Th>Estimasi kirim</Th><Th>Distributor</Th><Th>Tujuan</Th><Th>Produk</Th>
              <Th num>Order (zak)</Th><Th num>Sisa (ton)</Th><Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {list.error && <tr><td colSpan={9} className="!text-center !text-red !p-5">{list.error.message}</td></tr>}
            {!list.data && !list.error && <tr><td colSpan={9} className="!text-center !text-faint !p-5">Memuat…</td></tr>}
            {list.data && list.data.length === 0 && <tr><td colSpan={9} className="!text-center !text-faint !p-5">Tidak ada order pada filter ini.</td></tr>}
            {list.data && list.data.map(r => (
              <tr key={`${r.distributor}|${r.order_no}|${r.produk}`}>
                <td className="whitespace-nowrap">{fmtDate(String(r.tanggal_order).slice(0, 10))}</td>
                <td className="num font-mono whitespace-nowrap">{fmt(r.umur_hari)} hari</td>
                <td className="whitespace-nowrap">
                  {r.estimasi_kirim ? fmtDate(String(r.estimasi_kirim).slice(0, 10)) : '–'}
                  {Number(r.lewat_hari) > 0 && <span className="text-red text-[11.5px]"> lewat {fmt(r.lewat_hari)} hari</span>}
                </td>
                <td className="whitespace-nowrap">{String(r.dist_nama)}</td>
                <td className="max-w-[260px] truncate" title={String(r.nama_tujuan || r.nama_customer || '')}>{String(r.nama_tujuan || r.nama_customer || '–')}</td>
                <td className="whitespace-nowrap">{String(r.produk).replace(/^NEW\s*-\s*/i, '')}</td>
                <td className="num font-mono">{fmt(r.order_qty)}</td>
                <td className="num font-mono font-semibold">{fmtTon(Number(r.sisa_ton))}</td>
                <td>{r.status === 'Terkirim sebagian' ? <Badge variant="warn">Sebagian</Badge> : r.status === 'Belum diverifikasi' ? <Badge variant="neutral">Belum verifikasi</Badge> : <Badge variant="neutral">Belum dikirim</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}
