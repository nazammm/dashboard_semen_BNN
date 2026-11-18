/* ============================================================================
   Kelola Data · Toko & sales baru: pantau toko yang baru pertama kali order dan salesman yang baru
   muncul di transaksi (atau belum punya target) pada bulan yang dipilih.
   Hanya membaca (v_toko_baru, v_salesman_baru). Tindak lanjutnya lewat Kelola Data → Tabel:
   Subdist (kalau "toko" itu sebenarnya subdist) dan Target salesman (kalau salesman perlu target).
============================================================================ */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGetAll } from '../../lib/api';
import { MONTHS_ID, fmt, fmtIDRCompact } from '../../lib/format';
import { daysInMonth, fmtDate, toISO } from '../../lib/dates';
import { useAsync } from '../../lib/hooks';
import type { Row } from '../../lib/types';
import { Badge, CellLink, Chip, ErrorBox, Select, TableWrap } from '../../components/ui';
import { exportRowsToExcel } from '../../lib/xlsx';
import { isSalesCounter } from '../../lib/salesman';

const tgl = (v: unknown) => String(v ?? '').slice(0, 10);
const kosong = (v: unknown) => { const s = String(v ?? '').replace(/[\s-]/g, ''); return !s || s === '0'; };

export function BaruPanel({ dataSampai }: { dataSampai: string | null }) {
  // bulan yang bisa dipilih: 12 bulan terakhir sampai bulan data transaksi terakhir
  const akhir = dataSampai && /^\d{4}-\d{2}/.test(dataSampai) ? dataSampai : new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const bulanList = useMemo(() => {
    const y = Number(akhir.slice(0, 4)), m = Number(akhir.slice(5, 7));
    return Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - i, 1)); return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1; });
  }, [akhir]);
  const [ym, setYm] = useState(bulanList[0]);
  const Y = Math.floor(ym / 100), M = ym % 100;
  const from = toISO(Y, M, 1), to = toISO(Y, M, daysInMonth(Y, M));
  const label = `${MONTHS_ID[M]} ${Y}`;

  const { data, error } = useAsync(async () => {
    const [toko, sales] = await Promise.all([
      apiGetAll('v_toko_baru', `?select=*&first_do=gte.${from}&first_do=lte.${to}&order=first_do.desc,cust_code.asc,dist_code.asc`),
      apiGetAll('v_salesman_baru', `?select=*&last_do=gte.${from}&order=first_do.desc,salesman_code.asc`),
    ]);
    return { toko, sales };
  }, [from, to]);

  const [jenis, setJenis] = useState<'semua' | 'lengkapi' | 'pindah'>('semua');
  const [q, setQ] = useState('');
  const toko = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.toko || []).filter(r => {
      if (jenis === 'lengkapi' && !(kosong(r.zona) || r.latitude == null || !r.ada_master)) return false;
      if (jenis === 'pindah' && !(tgl(r.first_do_toko) < tgl(r.first_do))) return false;
      return !s || `${r.cust_name} ${r.cust_code} ${r.dist_code} ${r.zona}`.toLowerCase().includes(s);
    });
  }, [data, jenis, q]);
  const sales = useMemo(() => {
    const all = (data?.sales || []).filter(r => tgl(r.first_do) <= to && !isSalesCounter(r));
    const baru = all.filter(r => tgl(r.first_do) >= from);
    // salesman lama yang masih bertransaksi sejak bulan ini tetapi targetnya belum sampai bulan ini
    const tanpa = all.filter(r => tgl(r.first_do) < from && (r.target_terakhir == null || Number(r.target_terakhir) < ym));
    return { baru, tanpa };
  }, [data, from, to, ym]);

  if (error) return <ErrorBox error={/404|tidak dikenal|not allowed/i.test(error.message) ? 'View v_toko_baru / v_salesman_baru belum dipasang. Jalankan 16_toko_sales_baru.sql dulu.' : error} />;
  const semuaToko = data?.toko || [];
  const perluLengkap = semuaToko.filter(r => kosong(r.zona) || r.latitude == null || !r.ada_master).length;
  const pindahan = semuaToko.filter(r => tgl(r.first_do_toko) < tgl(r.first_do)).length;

  const unduhToko = () => exportRowsToExcel([{
    name: 'Toko baru', header: ['Order pertama', 'Kode toko', 'Nama toko', 'Distributor', 'Zona', 'Koordinat', 'Subdist', 'Jumlah DO', 'Tonase', 'Omzet (Rp)', 'Catatan'],
    rows: toko.map(r => [tgl(r.first_do), r.cust_code, r.cust_name, r.dist_code, kosong(r.zona) ? '' : r.zona, r.latitude == null ? 'Belum ada' : 'Ada', r.is_subdist ? 'Ya' : '',
      Number(r.num_do), Number(r.total_qty), Number(r.net_amount), tgl(r.first_do_toko) < tgl(r.first_do) ? `Sudah order di distributor lain sejak ${tgl(r.first_do_toko)}` : '']),
    widths: [13, 13, 34, 11, 26, 11, 9, 10, 10, 15, 40],
  }], `Toko_baru_${label.replace(' ', '_')}.xlsx`, 'kelola-data');

  return (
    <div>
      <div className="flex items-end gap-3 flex-wrap mb-4">
        <Select label="Bulan" value={ym} onChange={e => setYm(+e.target.value)}
          options={bulanList.map(p => ({ value: p, label: `${MONTHS_ID[p % 100]} ${Math.floor(p / 100)}` }))} />
        <p className="text-faint text-[12.5px] m-0 pb-2 max-w-[620px]">Toko baru = toko yang order pertamanya ke distributor itu jatuh di bulan ini. Salesman baru = kode salesman yang transaksi pertamanya di bulan ini.</p>
      </div>

      <div className="grid-kpi">
        <Angka judul="Toko baru" nilai={data ? semuaToko.length : null} ket={`Order pertama di ${label}`} />
        <Angka judul="Perlu dilengkapi" nilai={data ? perluLengkap : null} ket="Belum punya zona atau koordinat" tone={perluLengkap > 0 ? 'warn' : undefined} />
        <Angka judul="Salesman baru" nilai={data ? sales.baru.length : null} ket={`Transaksi pertama di ${label}`} />
        <Angka judul="Salesman tanpa target" nilai={data ? sales.tanpa.length + sales.baru.filter(r => r.target_terakhir == null || Number(r.target_terakhir) < ym).length : null}
          ket="Aktif bulan ini, belum ada target" tone="warn" />
      </div>

      {/* ---------------- toko ---------------- */}
      <div className="flex items-end justify-between flex-wrap gap-2.5 mt-8 mb-3">
        <h2 className="section-title !m-0">Toko baru · {label}</h2>
        <div className="flex items-center gap-2.5 flex-wrap">
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Cari toko, kode, zona…" aria-label="Cari toko baru" className="!w-[210px] !py-[7px]" />
          <div className="pill-row" role="group" aria-label="Saring toko baru">
            <Chip active={jenis === 'semua'} onClick={() => setJenis('semua')}>Semua ({fmt(semuaToko.length)})</Chip>
            <Chip active={jenis === 'lengkapi'} onClick={() => setJenis('lengkapi')}>Perlu dilengkapi ({fmt(perluLengkap)})</Chip>
            {pindahan > 0 && <Chip active={jenis === 'pindah'} onClick={() => setJenis('pindah')}>Sudah ada di distributor lain ({fmt(pindahan)})</Chip>}
          </div>
          <button type="button" className="btn btn-sm" onClick={unduhToko} disabled={!toko.length}>Download Excel</button>
        </div>
      </div>
      <TableWrap>
        <table className="tbl-dense">
          <caption className="sr-only">Toko yang order pertamanya di {label}</caption>
          <thead><tr><th>Order pertama</th><th>Toko</th><th>Distributor</th><th>Zona</th><th>Koordinat</th><th className="num">DO</th><th className="num">Tonase</th><th className="num">Omzet</th></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={8} className="!text-center text-faint !p-5">Memuat…</td></tr>}
            {data && toko.length === 0 && <tr><td colSpan={8} className="!text-center text-faint !p-5">Tidak ada toko baru untuk saringan ini.</td></tr>}
            {toko.slice(0, 300).map(r => (
              <tr key={`${r.cust_code}|${r.dist_code}`}>
                <td className="whitespace-nowrap">{fmtDate(tgl(r.first_do))}</td>
                <td className="min-w-[220px]">
                  <CellLink to={`/toko-detail?code=${encodeURIComponent(r.cust_code)}&from=kelola-data`}>{r.cust_name || r.cust_code}</CellLink>
                  <span className="text-faint text-[12px] font-mono ml-1.5">{r.cust_code}</span>
                  {r.is_subdist && <Badge variant="neutral" className="ml-1.5">Subdist</Badge>}
                  {tgl(r.first_do_toko) < tgl(r.first_do) && <Badge variant="neutral" className="ml-1.5" title={`Sudah order di distributor lain sejak ${fmtDate(tgl(r.first_do_toko))}`}>Toko lama</Badge>}
                </td>
                <td><span className="tag-code">{r.dist_code}</span></td>
                <td className="text-[12.5px]">{kosong(r.zona) ? <span className="text-amber">Belum ada</span> : r.zona}</td>
                <td className="text-[12.5px]">{r.latitude == null ? <span className="text-amber">Belum ada</span> : 'Ada'}</td>
                <td className="num font-mono">{fmt(r.num_do)}</td>
                <td className="num font-mono">{fmt(r.total_qty, Number(r.total_qty) < 10 ? 1 : 0)}</td>
                <td className="num font-mono whitespace-nowrap">{fmtIDRCompact(r.net_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {toko.length > 300 && <p className="text-faint text-[12px] mt-2">Menampilkan 300 dari {fmt(toko.length)} toko. Pakai pencarian atau unduh Excel untuk semuanya.</p>}
      <p className="text-faint text-[12px] mt-2">Kalau ada yang sebenarnya subdist, daftarkan di <Link to="/kelola-data?data=tabel">Tabel → Subdist</Link> supaya tidak dihitung sebagai toko.</p>

      {/* ---------------- salesman ---------------- */}
      <h2 className="section-title">Salesman baru dan tanpa target · {label}</h2>
      <TableWrap>
        <table className="tbl-dense">
          <caption className="sr-only">Salesman baru dan salesman tanpa target di {label}</caption>
          <thead><tr><th>Salesman</th><th>Distributor</th><th>Keterangan</th><th>Transaksi pertama</th><th>Transaksi terakhir</th><th>Target terakhir</th><th className="num">Jumlah DO</th></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={7} className="!text-center text-faint !p-5">Memuat…</td></tr>}
            {data && sales.baru.length + sales.tanpa.length === 0 && <tr><td colSpan={7} className="!text-center text-faint !p-5">Tidak ada salesman baru atau tanpa target.</td></tr>}
            {[...sales.baru.map(r => ({ r, baru: true })), ...sales.tanpa.map(r => ({ r, baru: false }))].map(({ r, baru }) => {
              const tt = r.target_terakhir == null ? null : Number(r.target_terakhir);
              return (
                <tr key={String(r.salesman_code)}>
                  <td className="min-w-[200px]">
                    <CellLink to={`/transaksi-detail?salesman=${encodeURIComponent(r.salesman_code)}&year=${Y}&month=${M}&name=${encodeURIComponent(r.salesman_name)}`}>{r.salesman_name}</CellLink>
                    <span className="text-faint text-[12px] font-mono ml-1.5">{r.salesman_code}</span>
                  </td>
                  <td><span className="tag-code">{r.dist_code}</span></td>
                  <td className="whitespace-nowrap">
                    {baru && <Badge variant="online">Baru</Badge>}
                    {(tt == null || tt < ym) && <Badge variant="warn" className={baru ? 'ml-1.5' : undefined}>Belum ada target</Badge>}
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(tgl(r.first_do))}</td>
                  <td className="whitespace-nowrap">{fmtDate(tgl(r.last_do))}</td>
                  <td className="whitespace-nowrap">{tt == null ? <span className="text-faint">Belum pernah</span> : `${MONTHS_ID[tt % 100]} ${Math.floor(tt / 100)}`}</td>
                  <td className="num font-mono">{fmt(r.num_do)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      <p className="text-faint text-[12px] mt-2">Tambahkan target (dan nama) salesman di <Link to="/kelola-data?data=target">Target</Link> atau <Link to="/kelola-data?data=tabel">Tabel → Target salesman</Link>. Di halaman Tim Sales mereka tampil dengan tanda Tanpa target.</p>
    </div>
  );
}

function Angka({ judul, nilai, ket, tone }: { judul: string; nilai: number | null; ket: string; tone?: 'warn' }) {
  return (
    <div className="card">
      <div className="card-title">{judul}</div>
      <div className={`kpi-value${tone === 'warn' && nilai ? ' !text-amber' : ''}`}>{nilai == null ? '…' : fmt(nilai)}</div>
      <div className="kpi-delta">{ket}</div>
    </div>
  );
}
