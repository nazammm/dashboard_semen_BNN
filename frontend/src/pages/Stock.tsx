import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChartConfiguration } from 'chart.js';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, chartSRSummary, fmt, fmtCompact } from '../lib/format';
import { fmtDate } from '../lib/dates';
import type { Row } from '../lib/types';
import { DataBadge } from '../components/DataStatus';
import { Card, ChartBox, ErrorBox, FileIcon, FilterBar, Kpi, PageHeader, PageSkeleton, Select, TableWrap, cx } from '../components/ui';
import { exportRowsToExcel } from '../lib/xlsx';

/* ============================================================================
   Stock Semen: stok gudang per tanggal, daerah, dan produk dari file stok harian
   (Kelola Data → Stock). Region dari tabel Daerah stok.
   - KPI dan tabel: posisi satu tanggal (bawaan tanggal terakhir), dibanding tanggal sebelumnya yang ada
   - Grafik: tren stok harian (ton) per jenis semen
============================================================================ */

const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 && t % 1 ? 1 : 0);
const fmtDelta = (d: number) => (Math.abs(d) < 0.05 ? '0' : (d > 0 ? '+' : '−') + fmtTon(Math.abs(d)));
/** Ada perubahan berarti dibanding tanggal sebelumnya (stok sama persis tidak ditampilkan). */
const berubah = (x: number, p: number | null) => p != null && Math.abs(x - p) >= 0.05;
const JENIS = [
  { value: 'STR', label: 'Tiga Roda (STR)', color: COLORS.accent },
  { value: 'RJW', label: 'Rajawali (RJW)', color: COLORS.mark },
  { value: 'CWC', label: 'Semen putih (CWC)', color: COLORS.amber },
];
const URUT_PRODUK = ['PCC 50', 'PCC 40', 'WC 40', 'RAJAWALI 50', 'RAJAWALI 40'];
const urutProduk = (a: string, b: string) => {
  const ia = URUT_PRODUK.indexOf(a), ib = URUT_PRODUK.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
};
const RENTANG = [{ value: '30', label: '30 tanggal terakhir' }, { value: '90', label: '90 tanggal terakhir' }, { value: '0', label: 'Semua tanggal' }];

export default function Stock() {
  useDocTitle('Stock Semen');
  const load = useAsync(async () => {
    const [info, harian] = await Promise.all([DataSource.stockInfo(), DataSource.stockHarian()]);
    return { info, harian };
  }, []);
  if (load.error) return <ErrorBox error={load.error} />;
  if (!load.data) return <PageSkeleton />;
  if (!load.data.info?.tanggal_terakhir) return <EmptyState />;
  return <Body info={load.data.info} harian={load.data.harian} />;
}

function EmptyState() {
  const { pageAllowed } = useAuth();
  return (
    <>
      <PageHeader title="Stock Semen" />
      <div className="card max-w-[620px]">
        <h2 className="!text-[20px]">Belum ada data stok</h2>
        <p className="text-soft text-[13.5px] mt-2 leading-relaxed">
          Stok dibaca dari file Stock Semen bulanan (satu sheet per tanggal) yang diunggah admin di Kelola Data.
        </p>
        {pageAllowed('kelola-data') && <Link to="/kelola-data?data=stock" className="btn btn-primary no-underline mt-4">Upload file stok</Link>}
      </div>
    </>
  );
}

function Body({ info, harian }: { info: Row; harian: Row[] }) {
  const { canDownload } = useAuth();
  const dates = useMemo(() => [...new Set(harian.map(r => String(r.tanggal).slice(0, 10)))].sort().reverse(), [harian]);
  const [tgl, setTgl] = useState(() => String(info.tanggal_terakhir).slice(0, 10));
  const prev = dates[dates.indexOf(tgl) + 1] || null;
  const [region, setRegion] = useState('all');
  const [jenis, setJenis] = useState('all');
  const [satuan, setSatuan] = useState<'ton' | 'zak'>('ton');
  const [rentang, setRentang] = useState('30');

  const detail = useAsync(() => DataSource.stockTanggal(prev ? [tgl, prev] : [tgl]), [tgl, prev]);
  const rows = detail.data || [];
  const cocok = (r: Row) => (region === 'all' || r.region === region) && (jenis === 'all' || r.jenis === jenis);

  // urutan region mengikuti urutan daerah di file stok
  const regionOrder = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => { const u = Number(r.urutan); const reg = String(r.region); m.set(reg, Math.min(m.get(reg) ?? 1e9, u)); });
    return (a: string, b: string) => (a === 'Tanpa region' ? 1 : b === 'Tanpa region' ? -1 : (m.get(a) ?? 1e9) - (m.get(b) ?? 1e9) || a.localeCompare(b));
  }, [rows]);
  const regions = useMemo(() => [...new Set(harian.map(r => String(r.region)))].sort(regionOrder), [harian, regionOrder]);

  /* ---------- posisi tanggal terpilih vs tanggal sebelumnya ---------- */
  const v = useMemo(() => {
    const now = rows.filter(r => String(r.tanggal).slice(0, 10) === tgl && cocok(r));
    const before = prev ? rows.filter(r => String(r.tanggal).slice(0, 10) === prev && cocok(r)) : [];
    const sum = (rs: Row[], f: (r: Row) => boolean = () => true) => rs.filter(f).reduce((a, r) => a + Number(r.ton || 0), 0);
    const produk = [...new Set(now.map(r => String(r.produk)))].sort(urutProduk);
    // per daerah (dikelompokkan per region)
    type D = { region: string; daerah: string; urutan: number; nilai: Record<string, number>; ton: number; tonPrev: number | null };
    const byD = new Map<string, D>();
    now.forEach(r => {
      const k = String(r.daerah);
      const d = byD.get(k) || { region: String(r.region), daerah: k, urutan: Number(r.urutan), nilai: {}, ton: 0, tonPrev: prev ? 0 : null };
      d.nilai[String(r.produk)] = (d.nilai[String(r.produk)] || 0) + Number(satuan === 'ton' ? r.ton : r.zak);
      d.ton += Number(r.ton || 0);
      byD.set(k, d);
    });
    before.forEach(r => { const d = byD.get(String(r.daerah)); if (d) d.tonPrev = (d.tonPrev || 0) + Number(r.ton || 0); });
    const daerah = [...byD.values()].sort((a, b) => regionOrder(a.region, b.region) || a.urutan - b.urutan || a.daerah.localeCompare(b.daerah));
    const grup = [...new Set(daerah.map(d => d.region))].map(reg => {
      const ds = daerah.filter(d => d.region === reg);
      const nilai: Record<string, number> = {};
      ds.forEach(d => produk.forEach(p => { nilai[p] = (nilai[p] || 0) + (d.nilai[p] || 0); }));
      return { region: reg, daerah: ds, nilai, ton: ds.reduce((a, d) => a + d.ton, 0), tonPrev: prev ? ds.reduce((a, d) => a + (d.tonPrev || 0), 0) : null };
    });
    return {
      produk, daerah, grup,
      total: sum(now), totalPrev: prev ? sum(before) : null,
      perJenis: JENIS.map(j => ({ ...j, ton: sum(now, r => r.jenis === j.value), prev: prev ? sum(before, r => r.jenis === j.value) : null })),
    };
  }, [rows, tgl, prev, region, jenis, satuan, regionOrder]);

  /* ---------- tren harian ---------- */
  const tren = useMemo(() => {
    const byT = new Map<string, Record<string, number>>();
    harian.forEach(r => {
      if (region !== 'all' && r.region !== region) return;
      const t = String(r.tanggal).slice(0, 10);
      const o = byT.get(t) || {};
      o[String(r.jenis)] = (o[String(r.jenis)] || 0) + Number(r.ton || 0);
      byT.set(t, o);
    });
    let keys = [...byT.keys()].sort();
    if (rentang !== '0') keys = keys.slice(-Number(rentang));
    const tahunBeda = new Set(keys.map(k => k.slice(0, 4))).size > 1;
    const label = (k: string) => new Date(k + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', ...(tahunBeda ? { year: '2-digit' } : {}) });
    const pilih = jenis === 'all' ? JENIS.map(j => j.value) : [jenis];
    return { keys, labels: keys.map(label), total: keys.map(k => pilih.reduce((a, j) => a + (byT.get(k)![j] || 0), 0)) };
  }, [harian, region, jenis, rentang]);

  const warnaTren = JENIS.find(j => j.value === jenis)?.color ?? COLORS.accent;
  const scope = [region !== 'all' && region, jenis !== 'all' && JENIS.find(j => j.value === jenis)?.label].filter(Boolean).join(' · ') || 'Semua region';
  const prevLabel = prev ? fmtDate(prev) : null;
  const filterActive = region !== 'all' || jenis !== 'all';
  const nilai = (x: number) => (satuan === 'ton' ? fmtTon(x) : fmt(x));

  const [buka, setBuka] = useState<Set<string>>(() => new Set());
  const toggle = (reg: string) => setBuka(s => { const n = new Set(s); if (n.has(reg)) n.delete(reg); else n.add(reg); return n; });
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      await exportRowsToExcel([{
        name: `Stok ${tgl}`,
        header: ['Region', 'Daerah', ...v.produk.map(p => `${p} (${satuan})`), 'Total (ton)', ...(prev ? [`Total ${prev} (ton)`, 'Perubahan (ton)'] : [])],
        rows: v.daerah.map(d => [d.region, d.daerah, ...v.produk.map(p => d.nilai[p] || 0), d.ton, ...(prev ? [d.tonPrev || 0, d.ton - (d.tonPrev || 0)] : [])]),
        widths: [14, 26, ...v.produk.map(() => 13), 12, ...(prev ? [16, 14] : [])],
      }], `Stock_Semen_${tgl}.xlsx`, 'stock');
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Stock Semen" status={<DataBadge source="stock" />}>
        <p className="text-soft text-[13px] -mt-2">
          Posisi {fmtDate(tgl)}{prevLabel ? `, dibanding ${prevLabel}` : ''} · data {fmt(info.jumlah_tanggal)} tanggal
          ({fmtDate(String(info.tanggal_awal).slice(0, 10))} s.d. {fmtDate(String(info.tanggal_terakhir).slice(0, 10))})
        </p>
      </PageHeader>

      <FilterBar label="Filter stok" stickyMobile={false} className="max-[880px]:grid max-[880px]:grid-cols-2 max-[880px]:gap-2 max-[880px]:[&_select]:w-full max-[880px]:[&_select]:min-w-0">
        <Select label="Tanggal" value={tgl} onChange={e => setTgl(e.target.value)} style={{ minWidth: 140 }}
          options={dates.map(d => ({ value: d, label: fmtDate(d) }))} />
        <Select label="Region" value={region} onChange={e => setRegion(e.target.value)} style={{ minWidth: 140 }}
          options={[{ value: 'all', label: 'Semua Region' }, ...regions.map(r => ({ value: r, label: r }))]} />
        <Select label="Jenis" value={jenis} onChange={e => setJenis(e.target.value)} style={{ minWidth: 150 }}
          options={[{ value: 'all', label: 'Semua Jenis' }, ...JENIS.map(j => ({ value: j.value, label: j.label }))]} />
        <Select label="Satuan tabel" value={satuan} onChange={e => setSatuan(e.target.value as 'ton' | 'zak')} style={{ minWidth: 110 }}
          options={[{ value: 'ton', label: 'Ton' }, { value: 'zak', label: 'Zak' }]} />
        {filterActive && <button type="button" className="btn btn-sm self-end max-[880px]:col-span-2 max-[880px]:justify-center" onClick={() => { setRegion('all'); setJenis('all'); }}>Reset filter</button>}
      </FilterBar>

      {detail.error && <div className="mb-3"><ErrorBox error={detail.error} /></div>}

      <div className="grid-kpi">
        <Kpi title={`Total stok · ${scope}`} value={fmtTon(v.total)} unit="ton"
          delta={berubah(v.total, v.totalPrev) ? `${fmtDelta(v.total - v.totalPrev!)} ton dari ${prevLabel}` : undefined} />
        {v.perJenis.map(j => (
          <Kpi key={j.value} title={j.label} value={fmtTon(j.ton)} unit="ton"
            delta={berubah(j.ton, j.prev) ? `${fmtDelta(j.ton - j.prev!)} ton dari ${prevLabel}` : undefined} />
        ))}
      </div>

      <Card title={`Tren stok harian (ton) · ${scope}`} className="mt-4">
        <div className="flex items-center justify-end flex-wrap gap-2 mb-1">
          <Select label="Rentang" value={rentang} onChange={e => setRentang(e.target.value)} options={RENTANG} />
        </div>
        <ChartBox label={chartSRSummary(tren.labels, tren.total, 'ton stok')} deps={[tren.labels.join('|'), tren.total.join('|')]}
          build={() => ({
            type: 'line',
            data: {
              labels: tren.labels,
              datasets: [
                { label: 'Stok', data: tren.total, borderColor: warnaTren, backgroundColor: warnaTren, borderWidth: 2.2, pointRadius: tren.keys.length > 40 ? 0 : 2.5, tension: 0.25 },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
              scales: {
                y: { beginAtZero: true, grid: { color: COLORS.line }, border: { display: false }, ticks: { callback: (x: any) => fmtCompact(x) } },
                x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
              },
              plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${fmtTon(c.parsed.y)} ton` } } },
            },
          } as ChartConfiguration)} />
        {tren.keys.length < 2 && <p className="text-faint text-[12px] mt-2">Tren muncul setelah ada stok lebih dari satu tanggal.</p>}
      </Card>

      <div className="flex items-baseline justify-between flex-wrap gap-2.5 mt-[38px] mb-3.5">
        <h2 className="section-title !m-0">Stok per daerah <span className="n">{satuan} · {fmtDate(tgl)} · {scope}</span></h2>
        {canDownload('stock') && (
          <button type="button" className="btn" onClick={download} disabled={busy || !v.daerah.length}>
            <FileIcon />{busy ? 'Menyiapkan…' : 'Download Excel'}
          </button>
        )}
      </div>
      <TableWrap>
        <table className={cx(detail.loading && detail.data && 'opacity-60')}>
          <caption className="sr-only">Stok semen per daerah dan produk</caption>
          <thead>
            <tr>
              <th>Daerah</th>
              {v.produk.map(p => <th key={p} className="num">{p}</th>)}
              <th className="num">Total (ton)</th>
              {prev && <th className="num">Perubahan (ton)</th>}
            </tr>
          </thead>
          <tbody>
            {!detail.data && <tr><td colSpan={v.produk.length + 3} className="!text-center !text-faint !p-5">Memuat…</td></tr>}
            {detail.data && !v.daerah.length && <tr><td colSpan={v.produk.length + 3} className="!text-center !text-faint !p-5">Tidak ada stok pada filter ini.</td></tr>}
            {v.grup.map(g => (
              <RegionRows key={g.region} g={g} produk={v.produk} prev={!!prev} nilai={nilai}
                buka={region !== 'all' || buka.has(g.region)} onToggle={region === 'all' ? () => toggle(g.region) : undefined} />
            ))}
          </tbody>
          {v.grup.length > 1 && (
            <tfoot>
              <tr className="font-semibold">
                <td>Total</td>
                {v.produk.map(p => <td key={p} className="num font-mono">{nilai(v.grup.reduce((a, g) => a + (g.nilai[p] || 0), 0))}</td>)}
                <td className="num font-mono">{fmtTon(v.total)}</td>
                {prev && <td className="num font-mono">{fmtDelta(v.total - (v.totalPrev || 0))}</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </TableWrap>
    </>
  );
}

type Grup = { region: string; daerah: { daerah: string; nilai: Record<string, number>; ton: number; tonPrev: number | null }[]; nilai: Record<string, number>; ton: number; tonPrev: number | null };

function RegionRows({ g, produk, prev, nilai, buka, onToggle }: {
  g: Grup; produk: string[]; prev: boolean; nilai: (x: number) => string; buka: boolean; onToggle?: () => void;
}) {
  return (
    <>
      <tr className={cx(buka && 'bg-[#F7F8FA]', onToggle && 'cursor-pointer hover:bg-[#F7F8FA]')} onClick={onToggle}>
        <td className="font-semibold">
          {onToggle ? (
            <button type="button" className="inline-flex items-center gap-1.5 font-semibold text-left" aria-expanded={buka}
              onClick={e => { e.stopPropagation(); onToggle(); }}>
              <span aria-hidden="true" className={cx('inline-block text-faint text-[10px] transition-transform', buka && 'rotate-90')}>▶</span>{g.region}
            </button>
          ) : g.region}
          <span className="text-faint font-normal text-[12px]"> · {fmt(g.daerah.length)} daerah</span>
        </td>
        {produk.map(p => <td key={p} className="num font-mono font-semibold">{g.nilai[p] ? nilai(g.nilai[p]) : '–'}</td>)}
        <td className="num font-mono font-semibold">{fmtTon(g.ton)}</td>
        {prev && <td className="num font-mono font-semibold">{fmtDelta(g.ton - (g.tonPrev || 0))}</td>}
      </tr>
      {buka && g.daerah.map(d => (
        <tr key={d.daerah} className={cx(d.ton === 0 && 'text-faint')}>
          <td className="pl-9">{d.daerah}</td>
          {produk.map(p => <td key={p} className="num font-mono">{d.nilai[p] ? nilai(d.nilai[p]) : '–'}</td>)}
          <td className="num font-mono">{d.ton ? fmtTon(d.ton) : '–'}</td>
          {prev && <td className="num font-mono text-soft">{d.tonPrev != null ? fmtDelta(d.ton - d.tonPrev) : '–'}</td>}
        </tr>
      ))}
    </>
  );
}
