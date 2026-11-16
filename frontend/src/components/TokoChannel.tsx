/* ============================================================================
   Penjualan Toko · Toko per cara order: berapa toko yang order offline saja, online saja (MSS),
   atau keduanya pada filter halaman. Klik salah satu kelompok untuk melihat daftar tokonya.
   Online = DO dengan nomor order MSS (aturan sama dengan bauran DO online/offline di KPI).
============================================================================ */
import { useMemo, useState } from 'react';
import { COLORS, fmt } from '../lib/format';
import type { Row } from '../lib/types';
import { CellLink, Th, cx } from './ui';
import { exportRowsToExcel } from '../lib/xlsx';

type Cara = 'offline' | 'keduanya' | 'online';
const CARA: { id: Cara; label: string; desc: string; color: string }[] = [
  { id: 'offline', label: 'Offline saja', desc: 'Semua DO tanpa order MSS', color: COLORS.blueMid },
  { id: 'keduanya', label: 'Offline & online', desc: 'Pernah lewat MSS dan di luar MSS', color: COLORS.sub },
  { id: 'online', label: 'Online saja', desc: 'Semua DO lewat order MSS', color: COLORS.accent },
];
const caraOf = (r: Row): Cara => {
  const on = Number(r.do_online) > 0, off = Number(r.do_offline) > 0;
  return on && off ? 'keduanya' : on ? 'online' : 'offline';
};
const LANGKAH = 25;

export function TokoChannel({ rows, loading, error, periodLabel, distName, canDownload }: {
  rows: Row[] | null; loading: boolean; error: Error | null; periodLabel: string;
  distName: (code: string) => string; canDownload: boolean;
}) {
  const [pilih, setPilih] = useState<Cara | null>(null);
  const [q, setQ] = useState('');
  const [n, setN] = useState(LANGKAH);

  const g = useMemo(() => {
    const per: Record<Cara, { toko: number; ton: number; rows: Row[] }> = {
      offline: { toko: 0, ton: 0, rows: [] }, keduanya: { toko: 0, ton: 0, rows: [] }, online: { toko: 0, ton: 0, rows: [] },
    };
    (rows || []).forEach(r => { const c = per[caraOf(r)]; c.toko++; c.ton += Number(r.total_qty || 0); c.rows.push(r); });
    Object.values(per).forEach(c => c.rows.sort((a, b) => Number(b.total_qty) - Number(a.total_qty)));
    const toko = (rows || []).length;
    return { per, toko, ton: CARA.reduce((a, c) => a + per[c.id].ton, 0) };
  }, [rows]);

  const daftar = useMemo(() => {
    if (!pilih) return [];
    const s = q.trim().toLowerCase();
    return g.per[pilih].rows.filter(r => !s || `${r.cust_name} ${r.customer_code} ${r.dist_code}`.toLowerCase().includes(s));
  }, [g, pilih, q]);

  const pct = (x: number, t: number) => (t > 0 ? (x / t) * 100 : 0);
  const klik = (c: Cara) => { setPilih(p => (p === c ? null : c)); setQ(''); setN(LANGKAH); };
  const info = pilih ? CARA.find(c => c.id === pilih)! : null;

  const unduh = () => exportRowsToExcel([{
    name: info!.label,
    header: ['Kode toko', 'Nama toko', 'Distributor', 'DO online', 'DO offline', 'Tonase', 'Amount (IDR)'],
    rows: daftar.map(r => [r.customer_code, r.cust_name, r.dist_code, Number(r.do_online), Number(r.do_offline), Number(r.total_qty), Number(r.net_amount)]),
    widths: [14, 34, 10, 10, 10, 10, 16],
  }], `Toko_${info!.label.replace(/\W+/g, '_')}_${periodLabel.replace(/\W+/g, '_')}.xlsx`, 'beranda');

  return (
    <section className="card mt-4" aria-labelledby="tc-judul">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 id="tc-judul" className="card-title !mb-0">Toko per cara order · {periodLabel}</h2>
        {rows && <span className="text-faint text-[12.5px]">{fmt(g.toko)} toko order (tanpa subdist)</span>}
      </div>

      {error ? <p className="text-red text-[13px] mt-3">{/404|belum aktif/i.test(error.message) ? 'Fungsi database dashboard_toko_channel_range belum dipasang (12_toko_channel.sql).' : error.message}</p>
        : !rows ? <div className="skel h-[120px] mt-3" />
        : g.toko === 0 ? <p className="text-faint text-[13px] mt-3">Tidak ada transaksi toko pada filter ini.</p>
        : (
          <div className={cx('transition-opacity', loading && 'opacity-60')}>
            {/* proporsi */}
            <div className="flex h-3 rounded-full overflow-hidden mt-4 bg-surface3" role="img"
              aria-label={CARA.map(c => `${c.label} ${fmt(g.per[c.id].toko)} toko`).join(', ')}>
              {CARA.map(c => g.per[c.id].toko > 0 && (
                <div key={c.id} style={{ width: `${pct(g.per[c.id].toko, g.toko)}%`, background: c.color }} title={`${c.label}: ${fmt(g.per[c.id].toko)} toko`} />
              ))}
            </div>

            {/* tiga kelompok */}
            <div className="grid grid-cols-3 max-[760px]:grid-cols-1 gap-3 mt-4">
              {CARA.map(c => {
                const x = g.per[c.id], on = pilih === c.id;
                return (
                  <button key={c.id} type="button" onClick={() => klik(c.id)} aria-pressed={on} aria-controls="tc-daftar"
                    className={cx('flex flex-col items-stretch justify-start text-left rounded-lg border px-4 py-3 transition-colors bg-surface',
                      on ? 'border-accent ring-2 ring-[rgba(1,129,213,.18)]' : 'border-line hover:border-line-strong')}>
                    <div className="flex items-center gap-2 text-[13px] font-medium">
                      <i aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: c.color }} />{c.label}
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-1.5">
                      <span className="text-[26px] font-semibold leading-none tabular-nums">{fmt(x.toko)}</span>
                      <span className="text-soft text-[13px]">toko · {fmt(pct(x.toko, g.toko))}%</span>
                    </div>
                    <div className="text-faint text-[12px] mt-1.5">{fmt(x.ton)} ton ({fmt(pct(x.ton, g.ton))}% tonase) · {c.desc}</div>
                    <div className={cx('text-[12px] mt-2 font-medium', on ? 'text-accent' : 'text-soft')}>{on ? 'Sembunyikan daftar ▴' : 'Lihat daftar toko ▾'}</div>
                  </button>
                );
              })}
            </div>

            {/* daftar toko kelompok terpilih */}
            {info && (
              <div id="tc-daftar" className="mt-4">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div className="text-[13.5px] font-semibold">{info.label} <span className="text-faint font-normal">· {fmt(daftar.length)} toko</span></div>
                  <div className="flex items-center gap-2">
                    <input type="search" value={q} onChange={e => { setQ(e.target.value); setN(LANGKAH); }} placeholder="Cari nama / kode toko…"
                      aria-label="Cari toko" className="!w-[220px] !py-[7px]" />
                    {canDownload && <button type="button" className="btn btn-sm" onClick={unduh} disabled={!daftar.length}>Download Excel</button>}
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="tbl-dense">
                    <caption className="sr-only">Toko {info.label.toLowerCase()} pada {periodLabel}</caption>
                    <thead>
                      <tr>
                        <Th num style={{ width: 44 }}>#</Th>
                        <Th>Toko</Th>
                        <Th>Distributor</Th>
                        <Th num>DO online</Th>
                        <Th num>DO offline</Th>
                        <Th num>Tonase</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {daftar.length === 0 && <tr><td colSpan={6} className="text-center text-faint p-5">Tidak ada toko yang cocok.</td></tr>}
                      {daftar.slice(0, n).map((r, i) => (
                        <tr key={String(r.customer_code)}>
                          <td className="num font-mono">{i + 1}</td>
                          <td><CellLink to={`/toko-detail?code=${encodeURIComponent(r.customer_code)}&from=beranda`}>{r.cust_name || r.customer_code}</CellLink>
                            <span className="text-faint text-[12px] font-mono ml-1.5">{r.customer_code}</span></td>
                          <td><span className="tag-code mr-1">{r.dist_code}</span><span className="text-soft">{distName(String(r.dist_code))}</span></td>
                          <td className="num font-mono">{Number(r.do_online) ? fmt(r.do_online) : '–'}</td>
                          <td className="num font-mono">{Number(r.do_offline) ? fmt(r.do_offline) : '–'}</td>
                          <td className="num font-mono">{fmt(r.total_qty, Number(r.total_qty) < 10 ? 1 : 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {daftar.length > n && (
                  <div className="flex justify-center gap-2 mt-3">
                    <button type="button" className="btn btn-sm" onClick={() => setN(x => x + 100)}>Tampilkan 100 lagi</button>
                    <button type="button" className="btn btn-sm" onClick={() => setN(daftar.length)}>Tampilkan semua ({fmt(daftar.length)})</button>
                  </div>
                )}
              </div>
            )}
            <p className="text-faint text-[12px] mt-3">
              Toko (tanpa subdist) yang punya DO pada periode dan filter ini. Online = DO dari order MSS. Urutan daftar: tonase terbesar.
            </p>
          </div>
        )}
    </section>
  );
}
