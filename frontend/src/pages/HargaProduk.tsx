import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle, useSort } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, PALETTE, fmt, fmtCompact, fmtIDR } from '../lib/format';
import { addDays, fmtDate } from '../lib/dates';
import type { Row } from '../lib/types';
import { DataBadge } from '../components/DataStatus';
import { Card, ChartBox, ErrorBox, FileIcon, FilterBar, Kpi, PageHeader, PageSkeleton, Select, TableWrap, Th, cx } from '../components/ui';
import { exportRowsToExcel } from '../lib/xlsx';

/* ============================================================================
   Harga Produk: harga dari Harga ERP (dibaca Nazam Auto Task), 24_harga_produk.sql (v_harga_produk).
   - LOCO GUDANG = harga ambil sendiri di gudang (harga_loco). Tipe lain (FRANCO TRUK, FRANCO FLOOR, ...) = harga sampai
     di zona (harga_kirim), ongkir = Net Price - (Price - Discount).
   - Price = harga resmi sebelum promo; Net Price = setelah promo / subsidi / ongkir. Semua per zak.
   - Grafik: harga yang berlaku tiap minggu (garis bertangga, berubah pada tanggal Effective).
============================================================================ */

interface H {
  dist: string; kode: string; nama: string; tipe: string; zona: string; produk: string; produkNama: string; semen: string; kg: number | null;
  gudang: string; dari: string; sampai: string | null; price: number | null; net: number; ongkir: number | null;
  priceSeb: number | null; netSeb: number | null; diambil: string | null;
}
const nn = (v: unknown) => (v == null || v === '' ? null : Number(v));
const tgl = (v: unknown) => (v ? String(v).slice(0, 10) : null);
const judul = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const RENTANG = [{ value: '6', label: '6 bulan terakhir' }, { value: '12', label: '12 bulan terakhir' }, { value: '2025', label: 'Sejak Januari 2025' }];
const NILAI = [{ value: 'price', label: 'Price (sebelum promo)' }, { value: 'net', label: 'Net Price' }];
const MAKS_GARIS = 12;

export default function HargaProduk() {
  useDocTitle('Harga Produk');
  const { data, error, loading } = useAsync(() => DataSource.hargaProduk(), []);
  if (error) return <><PageHeader title="Harga Produk" /><ErrorBox error={error} /></>;
  if (loading || !data) return <PageSkeleton />;
  const rows: H[] = data.map((r: Row) => ({
    dist: String(r.dist_code), kode: String(r.kode || r.dist_code), nama: String(r.nama || r.dist_code), tipe: String(r.delivery_type || 'LOCO GUDANG'),
    zona: String(r.zone || ''), produk: String(r.product_code), produkNama: String(r.product_name || r.product_code), semen: String(r.semen || ''),
    kg: nn(r.kg), gudang: String(r.warehouse || ''), dari: tgl(r.berlaku_dari)!, sampai: tgl(r.berlaku_sampai), price: nn(r.price), net: Number(r.net_price),
    ongkir: nn(r.ongkir), priceSeb: nn(r.harga_sebelum), netSeb: nn(r.net_sebelum), diambil: tgl(r.diambil),
  }));
  if (!rows.length) {
    return (
      <>
        <PageHeader title="Harga Produk" />
        <div className="card max-w-[620px]">
          <h2 className="!text-[20px]">Belum ada data harga</h2>
          <p className="text-soft text-[13.5px] mt-2 leading-relaxed">Harga dibaca dari ERP oleh Nazam Auto Task (bagian Harga ERP), atau diunggah di Kelola Data → Ongkos kirim → Harga ERP.</p>
        </div>
      </>
    );
  }
  return <Body rows={rows} />;
}

function Body({ rows }: { rows: H[] }) {
  const hari = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);   // WIB
  const tipes = useMemo(() => [...new Set(rows.map(r => r.tipe))].sort((a, b) => (a === 'LOCO GUDANG' ? -1 : b === 'LOCO GUDANG' ? 1 : a.localeCompare(b))), [rows]);
  const [tipe, setTipe] = useState(tipes[0]);
  const diTipe = useMemo(() => rows.filter(r => r.tipe === tipe), [rows, tipe]);
  const produks = useMemo(() => {
    const m = new Map<string, { nama: string; n: number }>();
    diTipe.forEach(r => { const x = m.get(r.produk) || { nama: r.produkNama, n: 0 }; x.n++; m.set(r.produk, x); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, x]) => ({ value: k, label: `${k} · ${x.nama}` }));
  }, [diTipe]);
  const dists = useMemo(() => {
    const m = new Map<string, string>(); diTipe.forEach(r => m.set(r.dist, r.kode));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([k, v]) => ({ value: k, label: v === k ? k : `${v} (${k})` }));
  }, [diTipe]);
  const [produkPilih, setProduk] = useState<string>('');
  const produk = produks.some(p => p.value === produkPilih) ? produkPilih : (produks.find(p => p.value === 'CMT002') || produks[0])?.value || '';
  const [distPilih, setDist] = useState('all');
  const dist = distPilih === 'all' || dists.some(d => d.value === distPilih) ? distPilih : 'all';
  const [rentang, setRentang] = useState('12');
  const [nilai, setNilai] = useState<'price' | 'net'>('price');
  const loco = tipe === 'LOCO GUDANG';
  const dari = rentang === '2025' ? '2025-01-01' : (() => { const d = new Date(hari); d.setMonth(d.getMonth() - Number(rentang)); return d.toISOString().slice(0, 10); })();
  const val = (r: H) => (nilai === 'price' ? r.price ?? r.net : r.net);

  const v = useMemo(() => {
    const cakup = diTipe.filter(r => dist === 'all' || r.dist === dist);
    const pr = cakup.filter(r => r.produk === produk);
    // garis: distributor x gudang (x zona) yang berlaku dalam rentang
    const kunci = (r: H) => `${r.dist}|${r.gudang}|${r.zona}`;
    const label = (r: H) => [dist === 'all' ? r.kode : '', r.gudang && `gudang ${r.gudang}`, !loco && r.zona].filter(Boolean).join(' · ');
    const garisMap = new Map<string, { label: string; rows: H[] }>();
    pr.filter(r => r.sampai == null || r.sampai >= dari).forEach(r => {
      const g = garisMap.get(kunci(r)) || { label: label(r), rows: [] }; g.rows.push(r); garisMap.set(kunci(r), g);
    });
    const semuaGaris = [...garisMap.values()].sort((a, b) => a.label.localeCompare(b.label));
    const titik: string[] = [];
    for (let d = dari; d < hari; d = addDays(d, 7)) titik.push(d);
    titik.push(hari);
    const pada = (rs: H[], d: string) => rs.find(r => r.dari <= d && (r.sampai == null || d <= r.sampai));
    // garis yang angkanya sama persis digabung jadi satu (mis. semua distributor dengan harga gudang yang sama)
    const gabung = new Map<string, { label: string[]; data: (number | null)[] }>();
    semuaGaris.forEach(g => {
      const data = titik.map(d => { const r = pada(g.rows, d); return r ? val(r) : null; });
      const k = data.join(','), x = gabung.get(k);
      if (x) x.label.push(g.label); else gabung.set(k, { label: [g.label], data });
    });
    const semuaSeri = [...gabung.values()].filter(x => x.data.some(y => y != null)).map(x => ({ label: x.label.join(', '), data: x.data }));
    const seri = semuaSeri.slice(0, MAKS_GARIS);

    // harga yang berlaku hari ini
    const sekarang = pr.filter(r => r.dari <= hari && (r.sampai == null || hari <= r.sampai));
    // perubahan dalam rentang (harga sebelumnya ada dan berbeda)
    const ubah = pr.filter(r => r.dari >= dari && r.dari <= hari && ((r.priceSeb != null && r.priceSeb !== r.price) || (r.netSeb != null && r.netSeb !== r.net)))
      .sort((a, b) => b.dari.localeCompare(a.dari));
    const ubahProduk = ubah;
    const naik = ubahProduk.map(r => ({ r, d: nilai === 'price' ? (r.price ?? 0) - (r.priceSeb ?? r.price ?? 0) : r.net - (r.netSeb ?? r.net) }))
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
    const kini = sekarang.map(val).filter((x): x is number => x != null);
    const diambil = rows.reduce<string | null>((m, r) => (r.diambil && (!m || r.diambil > m) ? r.diambil : m), null);
    return { titik, seri, lebih: semuaSeri.length - seri.length, sekarang, ubah, ubahProduk, naik, min: kini.length ? Math.min(...kini) : null, max: kini.length ? Math.max(...kini) : null, diambil };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diTipe, dist, produk, dari, hari, nilai, loco]);

  const produkNama = produks.find(p => p.value === produk)?.label || produk;
  const { canDownload } = useAuth();
  const unduh = () => {
    const baris = (r: H) => [r.kode, r.dist, r.produk, r.produkNama, r.gudang, ...(loco ? [] : [r.zona]), r.price, r.net, ...(loco ? [] : [r.ongkir]),
      r.kg ? r.net * 1000 / r.kg : null, r.dari, r.sampai];
    const kol = ['Distributor', 'Kode ERP', 'Kode produk', 'Produk', 'Gudang', ...(loco ? [] : ['Zona']), 'Price per zak', 'Net Price per zak', ...(loco ? [] : ['Ongkir per zak']),
      'Net Price per ton', 'Berlaku dari', 'Berlaku sampai'];
    exportRowsToExcel([
      { name: 'Harga berlaku', header: kol, rows: v.sekarang.map(baris), widths: [10, 9, 11, 22, 14, ...(loco ? [] : [20]), 12, 12, ...(loco ? [] : [11]), 13, 12, 12] },
      { name: 'Perubahan harga', header: ['Tanggal berlaku', 'Distributor', 'Kode produk', 'Produk', 'Gudang', ...(loco ? [] : ['Zona']), 'Price sebelum', 'Price', 'Net sebelum', 'Net Price'],
        rows: v.ubah.map(r => [r.dari, r.kode, r.produk, r.produkNama, r.gudang, ...(loco ? [] : [r.zona]), r.priceSeb, r.price, r.netSeb, r.net]), widths: [12, 10, 11, 22, 14, ...(loco ? [] : [20]), 12, 12, 12, 12] },
    ], `Harga_${tipe.replace(/\W+/g, '_')}_${hari}.xlsx`, 'harga-produk');
  };

  return (
    <>
      <PageHeader title="Harga Produk" status={<DataBadge source="harga" />} desc={`Harga dari ERP per zak${v.diambil ? ` · terakhir dibaca ${fmtDate(v.diambil)}` : ''}`} />
      <FilterBar label="Filter Harga Produk" stickyMobile={false}>
        <Select label="Tipe harga" value={tipe} onChange={e => setTipe(e.target.value)} style={{ minWidth: 170 }}
          options={tipes.map(t => ({ value: t, label: t === 'LOCO GUDANG' ? 'Loco gudang (ambil sendiri)' : judul(t) }))} />
        <Select label="Produk" value={produk} onChange={e => setProduk(e.target.value)} style={{ minWidth: 220 }} options={produks} />
        <Select label="Distributor" value={dist} onChange={e => setDist(e.target.value)} style={{ minWidth: 150 }} options={[{ value: 'all', label: 'Semua distributor' }, ...dists]} />
        <Select label="Rentang grafik" value={rentang} onChange={e => setRentang(e.target.value)} style={{ minWidth: 160 }} options={RENTANG} />
        <Select label="Nilai" value={nilai} onChange={e => setNilai(e.target.value as 'price' | 'net')} style={{ minWidth: 170 }} options={NILAI} />
        {canDownload('harga-produk') && (
          <div className="ml-auto self-end"><button type="button" className="btn" onClick={unduh}><FileIcon />Download Excel</button></div>
        )}
      </FilterBar>

      <div className="grid-kpi">
        <Kpi title="Harga berubah" value={fmt(v.ubah.length)} unit="kali"
          delta={<span className="text-faint text-[11.5px]">{produk}, {dist === 'all' ? 'semua distributor' : 'distributor ini'}, sejak {fmtDate(dari)}</span>} />
        <Kpi title={`Perubahan terbesar · ${produk}`}
          value={v.naik ? <span className={v.naik.d > 0 ? 'text-red' : v.naik.d < 0 ? 'text-green' : ''}>{v.naik.d > 0 ? '+' : ''}{fmtIDR(v.naik.d)}</span> : '–'}
          delta={v.naik ? <span className="text-faint text-[11.5px]">{v.naik.r.kode}{v.naik.r.gudang ? ` · ${v.naik.r.gudang}` : ''}, berlaku {fmtDate(v.naik.r.dari)}</span> : undefined} />
        <Kpi title={`Harga ${produk} sekarang`}
          value={v.min == null ? '–' : v.min === v.max ? fmtIDR(v.min) : <>{fmtCompact(v.min)} – {fmtCompact(v.max!)}</>}
          delta={v.min != null && v.max != null && v.max > v.min ? <span className="text-faint text-[11.5px]">beda {fmtIDR(v.max - v.min)} per zak antar {dist === 'all' ? 'distributor / gudang' : 'gudang'}</span> : undefined} />
        <Kpi title="Baris harga berlaku" value={fmt(v.sekarang.length)} delta={<span className="text-faint text-[11.5px]">produk × gudang{loco ? '' : ' × zona'} hari ini</span>} />
      </div>

      <Card className="mt-3.5">
        <div className="card-title">{nilai === 'price' ? 'Price' : 'Net Price'} per zak · {produkNama} · {tipe === 'LOCO GUDANG' ? 'Loco gudang' : judul(tipe)}</div>
        <div className="legend flex-wrap">
          {v.seri.map((s, i) => <span key={s.label}><i style={{ background: PALETTE[i % PALETTE.length], height: 2 }} aria-hidden="true" />{s.label || 'semua'}</span>)}
        </div>
        {v.seri.length ? (
          <ChartBox className="tall" label={`Harga ${produkNama} per minggu: ${v.seri.map(s => `${s.label} ${fmtIDR(s.data[s.data.length - 1] ?? 0)}`).join('; ')}`}
            deps={[v.titik.join('|'), v.seri.map(s => s.label + s.data.join(',')).join('|')]}
            build={() => ({
              type: 'line',
              data: { labels: v.titik.map(d => fmtDate(d)), datasets: v.seri.map((s, i) => ({ label: s.label, data: s.data, borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length], stepped: true, borderWidth: 2, pointRadius: 0, pointHitRadius: 6, spanGaps: false })) } as any,
              options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                scales: { y: { grid: { color: COLORS.line }, ticks: { callback: (x: any) => fmtCompact(x) } }, x: { grid: { display: false }, ticks: { autoSkip: true, maxTicksLimit: 12, maxRotation: 0 } } },
                plugins: { legend: { display: false }, tooltip: { filter: (c: any) => c.parsed.y != null, callbacks: { label: (c: any) => ` ${c.dataset.label || 'harga'}: ${fmtIDR(c.parsed.y)}` } } } },
            })} />
        ) : <p className="text-soft text-[13px] py-8 text-center">Tidak ada harga {produk} yang berlaku di rentang ini.</p>}
        {v.lebih > 0 && <p className="text-faint text-[12px] mt-2">{v.lebih} garis lain tidak digambar. Pilih satu distributor untuk melihat semua gudang{loco ? '' : ' dan zona'}nya.</p>}
        <p className="text-faint text-[12px] mt-2">Harga per minggu (garis bertangga): naik / turun pada tanggal berlaku di ERP. {loco ? 'Loco gudang = harga ambil sendiri di gudang distributor.' : 'Harga sampai di zona; ongkir = Net Price − (Price − Discount).'}</p>
      </Card>

      <h2 className="section-title">Harga {produk} berlaku hari ini</h2>
      <TabelSekarang rows={v.sekarang} loco={loco} produk={produk} />

      <h2 className="section-title">Perubahan harga {produk} sejak {fmtDate(dari)}</h2>
      {v.ubah.length ? (
        <TableWrap>
          <table className="tbl-dense">
            <thead><tr><th>Berlaku</th><th>Distributor</th><th>Produk</th><th>Gudang</th>{!loco && <th>Zona</th>}<th className="num">Price</th><th className="num">Net Price</th></tr></thead>
            <tbody>
              {v.ubah.slice(0, 200).map(r => (
                <tr key={`${r.dist}|${r.produk}|${r.gudang}|${r.zona}|${r.dari}`} className={cx(r.produk === produk && 'font-medium')}>
                  <td className="whitespace-nowrap">{fmtDate(r.dari)}</td>
                  <td>{r.kode}</td>
                  <td className="whitespace-nowrap">{r.produk} <span className="text-faint">{r.produkNama}</span></td>
                  <td>{r.gudang || '–'}</td>
                  {!loco && <td>{r.zona || '–'}</td>}
                  <td className="num font-mono whitespace-nowrap"><Ubah seb={r.priceSeb} kini={r.price} /></td>
                  <td className="num font-mono whitespace-nowrap"><Ubah seb={r.netSeb} kini={r.net} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : <p className="text-soft text-[13px]">Tidak ada perubahan harga di rentang ini.</p>}
      <p className="text-faint text-[12px] mt-3">Ongkir per zona dipakai di halaman <Link to="/ongkos-kirim">Ongkos Kirim</Link>; selisih harga DO lama dengan harga sekarang di <Link to="/os-do-toko">OS DO Toko</Link>.</p>
    </>
  );
}

function Ubah({ seb, kini }: { seb: number | null; kini: number | null }) {
  if (kini == null) return <>–</>;
  if (seb == null || seb === kini) return <span className="text-soft">{fmtIDR(kini)}</span>;
  const d = kini - seb;
  return <>{fmtIDR(seb)} → {fmtIDR(kini)} <span className={d > 0 ? 'text-red' : 'text-green'}>({d > 0 ? '+' : ''}{fmt(d)})</span></>;
}

function TabelSekarang({ rows, loco, produk }: { rows: H[]; loco: boolean; produk: string }) {
  const sort = useSort(rows, 'kode', 'asc', (r, k) => {
    switch (k) {
      case 'kode': return `${r.kode}|${r.produk}|${r.gudang}|${r.zona}`;
      case 'produk': return `${r.produk}|${r.kode}`;
      case 'gudang': return r.gudang; case 'zona': return r.zona;
      case 'price': return r.price; case 'net': return r.net; case 'ongkir': return r.ongkir;
      case 'ton': return r.kg ? r.net * 1000 / r.kg : null; case 'dari': return r.dari;
      default: return null;
    }
  });
  const sortProps = (k: string) => ({ sortable: true, ariaSort: sort.ariaSort(k), onSort: () => sort.toggle(k) });
  if (!rows.length) return <p className="text-soft text-[13px]">Tidak ada harga yang berlaku hari ini.</p>;
  return (
    <TableWrap>
      <table className="tbl-dense">
        <thead><tr>
          <Th {...sortProps('kode')}>Distributor</Th><Th {...sortProps('produk')}>Produk</Th><Th {...sortProps('gudang')}>Gudang</Th>
          {!loco && <Th {...sortProps('zona')}>Zona</Th>}
          <Th num {...sortProps('price')}>Price / zak</Th><Th num {...sortProps('net')}>Net / zak</Th>
          {!loco && <Th num {...sortProps('ongkir')}>Ongkir / zak</Th>}
          <Th num {...sortProps('ton')}>Net / ton</Th><Th {...sortProps('dari')}>Berlaku sejak</Th>
        </tr></thead>
        <tbody>
          {sort.sorted.map(r => (
            <tr key={`${r.dist}|${r.produk}|${r.gudang}|${r.zona}|${r.dari}`} className={cx(r.produk === produk && 'font-medium')}>
              <td>{r.kode}</td>
              <td className="whitespace-nowrap">{r.produk} <span className="text-faint">{r.produkNama}</span></td>
              <td>{r.gudang || '–'}</td>
              {!loco && <td>{r.zona || '–'}</td>}
              <td className="num font-mono">{r.price == null ? '–' : fmtIDR(r.price)}</td>
              <td className="num font-mono">{fmtIDR(r.net)}</td>
              {!loco && <td className="num font-mono">{r.ongkir == null ? '–' : fmtIDR(r.ongkir)}</td>}
              <td className="num font-mono">{r.kg ? fmtIDR(r.net * 1000 / r.kg) : '–'}</td>
              <td className="whitespace-nowrap">{fmtDate(r.dari)}{r.priceSeb != null && r.priceSeb !== r.price ? <span className="text-faint"> · dari {fmtIDR(r.priceSeb)}</span> : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
