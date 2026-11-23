import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle, useSort } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { fmt, fmtIDR, fmtIDRCompact } from '../lib/format';
import { addDays, fmtDate } from '../lib/dates';
import type { Row } from '../lib/types';
import { ErrorBox, FileIcon, FilterBar, Kpi, PageHeader, PageSkeleton, Select, TableWrap, Th, cx } from '../components/ui';
import { exportRowsToExcel } from '../lib/xlsx';

/* ============================================================================
   OS DO Toko: DO distributor ke toko / proyek yang belum dikirim (J073 kolom Qty Remains),
   dari 21_os_do_toko.sql (v_os_do_toko). Bukan OS pesanan ke pabrik (TIRO, halaman Outstanding DO).
   - Posisi sisa = saat file J073 diunduh (data_per). DO yang tanggalnya tidak ikut unduhan terbaru
     tidak diperbarui: posisi lebih dari 7 hari sebelum unduhan terbaru distributor itu ditandai.
   - Harga sekarang = harga ERP yang berlaku hari ini untuk produk, tipe kirim, zona, dan gudang yang sama
     (LOCO GUDANG: Net Price; kirim: Price - Discount + ongkir tarif zona).
   - Selisih = (Product Price di DO − harga sekarang) × sisa zak. Minus = DO lama lebih murah dari harga sekarang:
     kalau tetap dikirim dengan harga lama, distributor menerima sebesar itu lebih sedikit dari harga yang berlaku.
============================================================================ */

const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const nn = (v: unknown) => (v == null || v === '' ? null : Number(v));
const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 && t % 1 ? 1 : 0);
const judul = (s: unknown) => String(s ?? '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();
const LAMA_HARI = 7;
const UMUR = [
  { id: 'u7', label: '≤ 7 hari', max: 7 },
  { id: 'u30', label: '8–30 hari', max: 30 },
  { id: 'u90', label: '31–90 hari', max: 90 },
  { id: 'lama', label: '> 90 hari', max: Infinity },
];
const SEGMEN_OPTS = [{ value: 'all', label: 'Semua pelanggan' }, { value: 'RETAIL', label: 'Retail' }, { value: 'lain', label: 'Proyek / relasi / lainnya' }];

interface Os {
  dist: string; distNama: string; tgl: string; doNo: string; cust: string; toko: string; grup: string;
  produk: string; produkNama: string; tipe: string; tipeHarga: string | null; zona: string; gudang: string;
  zak: number; ton: number; hargaDo: number | null; hargaBaru: number | null; hargaDari: string | null;
  nilai: number | null; selisih: number | null; dataPer: string | null; umur: number; lama: boolean;
}

export default function OsDoToko() {
  useDocTitle('OS DO Toko');
  const rows = useAsync(() => DataSource.osDoToko(), []);
  if (rows.error) return <ErrorBox error={rows.error} />;
  if (!rows.data) return <PageSkeleton />;
  if (!rows.data.length) return <EmptyState />;
  return <Body rows={rows.data} />;
}

function EmptyState() {
  const { pageAllowed } = useAuth();
  return (
    <>
      <PageHeader title="OS DO Toko" />
      <div className="card max-w-[680px]">
        <h2 className="!text-[20px]">Belum ada DO toko yang tercatat belum dikirim</h2>
        <p className="text-soft text-[13.5px] mt-2 leading-relaxed">
          Halaman ini membaca kolom Qty Remains di J073. Kolom itu baru disimpan sejak versi 23 Nov 2026: jalankan docs/mssql/20_ongkos_insight.sql dan
          21_os_do_toko.sql di SSMS, lalu upload ulang J073 (Nazam Auto Task: Ambil ongkos kirim → Upload ulang salinan J073).
        </p>
        {pageAllowed('kelola-data') && <Link to="/kelola-data?data=ongkos&menu=j073" className="btn btn-primary no-underline mt-4">Upload J073</Link>}
      </div>
    </>
  );
}

function Body({ rows }: { rows: Row[] }) {
  const { canDownload } = useAuth();
  const semua: Os[] = useMemo(() => {
    const per = new Map<string, string>();
    rows.forEach(r => { const d = String(r.data_per ?? '').slice(0, 10); if (d && d > (per.get(String(r.dist_code)) ?? '')) per.set(String(r.dist_code), d); });
    return rows.map(r => {
      const dist = String(r.dist_code), dataPer = r.data_per ? String(r.data_per).slice(0, 10) : null, terbaru = per.get(dist);
      return {
        dist, distNama: String(r.dist_nama || dist), tgl: String(r.do_date).slice(0, 10), doNo: String(r.do_no), cust: String(r.customer_code ?? ''),
        toko: judul(r.customer_name) || String(r.customer_code ?? ''), grup: String(r.cust_group || 'RETAIL').toUpperCase(),
        produk: String(r.product_code ?? ''), produkNama: String(r.product_name ?? ''), tipe: String(r.tipe_kode || '?'),
        tipeHarga: r.tipe_harga ? String(r.tipe_harga) : null, zona: judul(r.zona_kirim) || '–', gudang: String(r.warehouse ?? ''),
        zak: n(r.qty_sisa), ton: n(r.ton_sisa), hargaDo: nn(r.harga_do), hargaBaru: nn(r.harga_baru),
        hargaDari: r.harga_dari ? String(r.harga_dari).slice(0, 10) : null, nilai: nn(r.nilai_sisa), selisih: nn(r.selisih),
        dataPer, umur: n(r.umur_hari), lama: !!(dataPer && terbaru && dataPer < addDays(terbaru, -LAMA_HARI)),
      };
    });
  }, [rows]);

  const dists = useMemo(() => [...new Map(semua.map(o => [o.dist, o.distNama])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [semua]);
  const [dist, setDist] = useState('all');
  const [segmen, setSegmen] = useState('all');
  const [lamaIkut, setLamaIkut] = useState('ya');
  const v = useMemo(() => semua.filter(o => (dist === 'all' || o.dist === dist)
    && (segmen === 'all' || (segmen === 'RETAIL' ? o.grup === 'RETAIL' : o.grup !== 'RETAIL'))
    && (lamaIkut === 'ya' || !o.lama)), [semua, dist, segmen, lamaIkut]);

  const tot = useMemo(() => {
    const t = { zak: 0, ton: 0, nilai: 0, selisih: 0, tonHarga: 0, tonTanpaHarga: 0, tonLama: 0, rugi: 0, dos: new Set<string>(), toko: new Set<string>() };
    v.forEach(o => {
      t.zak += o.zak; t.ton += o.ton; t.nilai += o.nilai ?? 0; t.dos.add(o.dist + o.doNo); t.toko.add(o.dist + o.cust);
      if (o.selisih != null) { t.selisih += o.selisih; t.tonHarga += o.ton; if (o.selisih < 0) t.rugi += o.selisih; } else t.tonTanpaHarga += o.ton;
      if (o.lama) t.tonLama += o.ton;
    });
    return t;
  }, [v]);

  const perDist = useMemo(() => {
    const m = new Map<string, { kode: string; nama: string; dos: Set<string>; toko: Set<string>; ton: number; nilai: number; selisih: number; tanpa: number; dataPer: string; umurMax: number; lama: number }>();
    v.forEach(o => {
      const x = m.get(o.dist) || m.set(o.dist, { kode: o.dist, nama: o.distNama, dos: new Set(), toko: new Set(), ton: 0, nilai: 0, selisih: 0, tanpa: 0, dataPer: '', umurMax: 0, lama: 0 }).get(o.dist)!;
      x.dos.add(o.doNo); x.toko.add(o.cust); x.ton += o.ton; x.nilai += o.nilai ?? 0;
      if (o.selisih != null) x.selisih += o.selisih; else x.tanpa += o.ton;
      if ((o.dataPer ?? '') > x.dataPer) x.dataPer = o.dataPer ?? '';
      x.umurMax = Math.max(x.umurMax, o.umur); if (o.lama) x.lama += o.ton;
    });
    return [...m.values()].sort((a, b) => b.ton - a.ton);
  }, [v]);

  const umur = useMemo(() => UMUR.map((u, i) => {
    const lo = i ? UMUR[i - 1].max : -1;
    const xs = v.filter(o => o.umur > lo && o.umur <= u.max);
    return { ...u, ton: xs.reduce((a, o) => a + o.ton, 0), dos: new Set(xs.map(o => o.dist + o.doNo)).size, selisih: xs.reduce((a, o) => a + (o.selisih ?? 0), 0) };
  }), [v]);

  const sort = useSort(v, 'selisih', 'asc', (o, k) => (k === 'tgl' ? o.tgl : k === 'toko' ? o.toko : k === 'zak' ? o.zak : k === 'hargaDo' ? o.hargaDo
    : k === 'hargaBaru' ? o.hargaBaru : k === 'umur' ? o.umur : k === 'dist' ? o.distNama : o.selisih));
  const [semuaBaris, setSemuaBaris] = useState(false);
  const tampil = semuaBaris ? sort.sorted : sort.sorted.slice(0, 50);
  const th = (k: string, label: string, num = false, title?: string) => <Th sortable num={num} ariaSort={sort.ariaSort(k)} onSort={() => sort.toggle(k)} title={title}>{label}</Th>;

  const unduh = () => exportRowsToExcel([{
    name: 'OS DO toko',
    header: ['Distributor', 'Tanggal DO', 'No DO', 'Kode toko', 'Toko', 'Cust group', 'Produk', 'Nama produk', 'Tipe kirim', 'Tipe harga', 'Zona', 'Gudang',
      'Sisa (zak)', 'Sisa (ton)', 'Harga DO (Rp/zak)', 'Harga sekarang (Rp/zak)', 'Harga sekarang berlaku dari', 'Nilai sisa (Rp)', 'Selisih (Rp)', 'Umur (hari)', 'Posisi per', 'Posisi lama'],
    rows: v.map(o => [o.distNama, o.tgl, o.doNo, o.cust, o.toko, o.grup, o.produk, o.produkNama, o.tipe, o.tipeHarga, o.zona, o.gudang, o.zak, o.ton,
      o.hargaDo, o.hargaBaru, o.hargaDari, o.nilai, o.selisih, o.umur, o.dataPer, o.lama ? 'ya' : '']),
  }], `os_do_toko_${new Date().toISOString().slice(0, 10)}`, 'os-do-toko');

  return (
    <>
      <PageHeader title="OS DO Toko">
        <p className="text-soft text-[13.5px] max-w-[860px] mt-1.5 leading-relaxed">
          DO distributor ke toko dan proyek yang belum dikirim (J073, kolom Qty Remains), dibandingkan dengan harga ERP yang berlaku hari ini.
          Ini bukan sisa pesanan ke pabrik; itu ada di <Link to="/outstanding-do" className="underline">Outstanding DO</Link>.
        </p>
      </PageHeader>

      <FilterBar label="Filter OS DO toko">
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Distributor" value={dist} onChange={e => setDist(e.target.value)}
            options={[{ value: 'all', label: 'Semua distributor' }, ...dists.map(([c, nm]) => ({ value: c, label: nm }))]} />
          <Select label="Pelanggan" value={segmen} onChange={e => setSegmen(e.target.value)} options={SEGMEN_OPTS} />
          <Select label="Posisi lama" value={lamaIkut} onChange={e => setLamaIkut(e.target.value)}
            options={[{ value: 'ya', label: 'Ikut dihitung' }, { value: 'tidak', label: `Tanpa posisi > ${LAMA_HARI} hari` }]} />
          {canDownload('os-do-toko') && <button type="button" className="btn ml-auto" onClick={unduh}><FileIcon /> Excel</button>}
        </div>
      </FilterBar>

      <div className="grid gap-4 grid-cols-4 max-[1100px]:grid-cols-2 max-[560px]:grid-cols-1">
        <Kpi title="Belum dikirim" value={fmtTon(tot.ton)} unit="ton" delta={`${fmt(tot.zak)} zak · ${fmt(tot.dos.size)} DO · ${fmt(tot.toko.size)} toko`} />
        <Kpi title="Nilai sisa (harga DO)" value={fmtIDRCompact(tot.nilai)} delta="Product Price di DO × sisa zak" />
        <Kpi title="Selisih vs harga sekarang" value={tot.tonHarga > 0 ? <span className={cx(tot.selisih < 0 && 'text-red')}>{fmtIDRCompact(tot.selisih)}</span> : '–'}
          delta={tot.tonHarga > 0
            ? <span>DO yang lebih murah: {fmtIDRCompact(tot.rugi)}{tot.tonTanpaHarga > 0.05 && <span className="text-amber"> · {fmtTon(tot.tonTanpaHarga)} ton tanpa harga sekarang</span>}</span>
            : 'Harga ERP sekarang belum ada untuk DO ini'} />
        <Kpi title="Posisi data" value={tot.tonLama > 0.05 ? <span className="text-amber">{fmtTon(tot.tonLama)} ton</span> : 'Terkini'}
          delta={tot.tonLama > 0.05 ? `posisinya > ${LAMA_HARI} hari lebih lama dari unduhan J073 terbaru` : `semua dari unduhan J073 terbaru (± ${LAMA_HARI} hari)`} />
      </div>

      <div className="grid gap-4 mt-4 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] max-[1100px]:grid-cols-1">
        <section className="card !p-0 overflow-hidden">
          <div className="card-title px-4 pt-3.5 !mb-2">Per distributor</div>
          <TableWrap>
            <table className="tbl-dense !min-w-0">
              <thead><tr><Th>Distributor</Th><Th num>DO</Th><Th num>Toko</Th><Th num>Ton</Th><Th num>Nilai sisa</Th><Th num>Selisih</Th><Th num>Tertua</Th><Th>Posisi per</Th></tr></thead>
              <tbody>
                {perDist.map(d => (
                  <tr key={d.kode}>
                    <td className="text-[12.5px]">{d.nama}</td>
                    <td className="num font-mono">{fmt(d.dos.size)}</td>
                    <td className="num font-mono">{fmt(d.toko.size)}</td>
                    <td className="num font-mono">{fmtTon(d.ton)}</td>
                    <td className="num font-mono">{fmtIDRCompact(d.nilai)}</td>
                    <td className={cx('num font-mono', d.selisih < 0 && 'text-red')} title={d.tanpa > 0.05 ? `${fmtTon(d.tanpa)} ton tanpa harga sekarang` : undefined}>
                      {fmtIDRCompact(d.selisih)}{d.tanpa > 0.05 && <span className="text-amber">*</span>}
                    </td>
                    <td className="num font-mono">{fmt(d.umurMax)} hr</td>
                    <td className="text-[12px] whitespace-nowrap">{d.dataPer ? fmtDate(d.dataPer) : '–'}{d.lama > 0.05 && <span className="text-amber" title={`${fmtTon(d.lama)} ton posisi lama`}> · lama</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </section>
        <section className="card !p-0 overflow-hidden">
          <div className="card-title px-4 pt-3.5 !mb-2">Umur DO</div>
          <TableWrap>
            <table className="tbl-dense !min-w-0">
              <thead><tr><Th>Umur sejak tanggal DO</Th><Th num>DO</Th><Th num>Ton</Th><Th num>Selisih</Th></tr></thead>
              <tbody>
                {umur.map(u => (
                  <tr key={u.id}>
                    <td className="text-[12.5px]">{u.label}</td>
                    <td className="num font-mono">{fmt(u.dos)}</td>
                    <td className="num font-mono">{fmtTon(u.ton)}</td>
                    <td className={cx('num font-mono', u.selisih < 0 && 'text-red')}>{u.ton ? fmtIDRCompact(u.selisih) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="text-faint text-[11.5px] px-4 py-2.5">DO yang sudah lama belum dikirim perlu dicek: bisa memang menunggu, bisa juga sudah batal tapi belum ditutup di ERP.</p>
        </section>
      </div>

      <div className="flex items-end justify-between flex-wrap gap-2.5 mt-[38px] mb-3.5">
        <h2 className="section-title !m-0">Daftar DO <span className="n">{fmt(v.length)} baris · diurutkan dari selisih paling minus</span></h2>
      </div>
      <TableWrap>
        <table>
          <caption className="sr-only">DO toko yang belum dikirim</caption>
          <thead><tr>
            {th('tgl', 'Tanggal DO')}<Th>No DO</Th>{th('dist', 'Distributor')}{th('toko', 'Toko')}<Th>Produk</Th><Th>Tipe · zona</Th>
            {th('zak', 'Sisa zak', true)}{th('hargaDo', 'Harga DO', true, 'Product Price di DO per zak (sebelum diskon toko)')}
            {th('hargaBaru', 'Harga sekarang', true, 'Harga ERP hari ini untuk produk, tipe kirim, zona, dan gudang yang sama')}
            {th('selisih', 'Selisih', true, '(Harga DO − harga sekarang) × sisa zak')}{th('umur', 'Umur', true)}<Th>Posisi per</Th>
          </tr></thead>
          <tbody>
            {tampil.map(o => (
              <tr key={o.dist + o.doNo + o.produk + o.zak}>
                <td className="whitespace-nowrap text-[12.5px]">{fmtDate(o.tgl)}</td>
                <td className="font-mono text-[12px]">{o.doNo}</td>
                <td className="text-[12.5px]">{o.distNama}</td>
                <td className="text-[12.5px]">{o.toko}{o.grup !== 'RETAIL' && <span className="badge neutral ml-1.5 !text-[10.5px]">{judul(o.grup)}</span>}</td>
                <td className="text-[12px] whitespace-nowrap">{o.produk}</td>
                <td className="text-[12px]">{o.tipe} · {o.zona}</td>
                <td className="num font-mono">{fmt(o.zak)}</td>
                <td className="num font-mono whitespace-nowrap">{o.hargaDo == null ? '–' : fmtIDR(o.hargaDo)}</td>
                <td className="num font-mono whitespace-nowrap">{o.hargaBaru == null ? <span className="text-faint">–</span> : fmtIDR(o.hargaBaru)}</td>
                <td className={cx('num font-mono whitespace-nowrap', (o.selisih ?? 0) < 0 && 'text-red')}>{o.selisih == null ? '–' : fmtIDR(o.selisih)}</td>
                <td className="num font-mono">{fmt(o.umur)} hr</td>
                <td className={cx('text-[12px] whitespace-nowrap', o.lama && 'text-amber')}>{o.dataPer ? fmtDate(o.dataPer) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {v.length > 50 && (
        <button type="button" className="btn btn-sm mt-3" onClick={() => setSemuaBaris(s => !s)}>{semuaBaris ? 'Tampilkan 50 teratas' : `Tampilkan semua ${fmt(v.length)} baris`}</button>
      )}

      <p className="text-faint text-[12px] mt-4 leading-relaxed max-w-[900px]">
        Sisa zak dari kolom Qty Remains J073 (Order Qty − Qty Delivery − retur), posisi saat file J073 diunduh. J073 diunduh per rentang tanggal DO, jadi DO lama
        hanya diperbarui kalau tanggalnya ikut unduhan; posisi yang lebih dari {LAMA_HARI} hari lebih lama dari unduhan terbaru distributor itu diberi tanda.
        Harga DO = Product Price per zak (sebelum diskon toko, sudah termasuk ongkir untuk DO kirim). Harga sekarang = harga ERP yang berlaku hari ini untuk produk,
        tipe kirim, zona, dan gudang yang sama: LOCO GUDANG memakai Net Price; DO kirim memakai Price − Discount + ongkir tarif zona.
        Selisih minus berarti DO lama lebih murah dari harga sekarang. Ini selisih harga jual: jadi kerugian bagi distributor kalau harga tebus dari pabrik
        untuk barang itu juga naik, atau jadi tambahan bayar toko kalau DO dibatalkan lalu dipesan ulang dengan harga baru.
      </p>
    </>
  );
}
