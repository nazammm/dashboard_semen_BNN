import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DataSource, sellInTargetsFor, sellOutTargetsFor } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { MONTHS_ID, fmt } from '../lib/format';
import { fmtDate, fmtRange, toISO, daysInMonth } from '../lib/dates';
import { DataBadge, todayWIB, type DataSourceId } from '../components/DataStatus';
import { DaerahHero } from '../components/DaerahHero';
import type { Row } from '../lib/types';
import { Badge, Capaian, Card, Chip, ErrorBox, PageHeader, PageSkeleton, TableWrap, cx } from '../components/ui';
import {
  JALUR_DARAT, OPEN_STATUS, REGION_ORDER, fmtPct, growthPct, key, outRecs, outSummary, ringkas, sellInRingkasan, sellOutRingkasan,
  type Bulanan, type OutRec, type Periode, type Peta, type Ringkas, type SellInRingkasan, type SellOutRingkasan,
} from '../lib/ringkasan';

/* ============================================================================
   Overview: kondisi perusahaan dalam satu layar. Empat angka utama (sell in, sell out, toko aktif,
   outstanding DO, ), satu baris per daerah.
   Tanpa grafik: grafik ada di halaman detail masing-masing.
   Angka dihitung dengan aturan yang sama dengan halaman detailnya (lib/ringkasan.ts),
   jadi kartu di sini selalu sama dengan KPI di halaman Sell In BNN / Sell Out BNN.
   Setiap bagian dimuat terpisah: kalau satu sumber gagal / tidak boleh dibuka, bagian lain tetap tampil.
============================================================================ */

const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 && t % 1 ? 1 : 0);
const opt = <T,>(p: Promise<T>) => p.catch(() => null);

interface SellInData { s: SellInRingkasan }
interface SellOutData { s: SellOutRingkasan }

export default function Overview() {
  useDocTitle('Overview');
  const { pageAllowed } = useAuth();
  const load = useAsync(async () => {
    const [siRows, siInfo, siTarget, peta, soMonthly, soTarget, status, soTa, outRows, outInfo, fresh, stockRows] = await Promise.all([
      opt(DataSource.sellinDaily()), opt(DataSource.sellinInfo()), opt(DataSource.targetSellIn()),
      opt(DataSource.selloutPeta()), opt(DataSource.selloutMonthly()), opt(DataSource.targetSellOut()), opt(DataSource.dataStatus()), opt(DataSource.selloutTa()),
      opt(DataSource.outstandingRingkas()), opt(DataSource.outstandingInfo()), opt(DataSource.dataFreshness()),
      opt(DataSource.stockHarian()),
    ]);
    const last = String(siInfo?.data_sampai ?? '').slice(0, 10);
    const sellIn: SellInData | null = siRows && siRows.length && last
      ? { s: sellInRingkasan(siRows, siTarget ? sellInTargetsFor(siTarget, Number(last.slice(0, 4))) : null, last) } : null;
    let sellOut: SellOutData | null = null;
    if (peta && peta.length && soMonthly) {
      const Y = soMonthly.reduce((a, r) => (Number(r.ton) > 0 ? Math.max(a, Number(r.tahun)) : a), 0) || Number(todayWIB().slice(0, 4));
      const trx = String((status || []).find(r => r.sumber === 'transaksi')?.data_sampai ?? '').slice(0, 10);
      sellOut = { s: sellOutRingkasan(peta as unknown as Peta[], soMonthly, soTarget ? sellOutTargetsFor(soTarget, Y) : [], soTa, trx, Y) };
    }
    const outstanding = outRows && outInfo?.posisi ? { recs: outRecs(outRows), posisi: String(outInfo.posisi).slice(0, 10) } : null;
    const stock = stockRows && stockRows.length ? stokRingkas(stockRows) : null;
    return { sellIn, sellOut, outstanding, stock, };
  }, []);
  if (load.error) return <ErrorBox error={load.error} />;
  if (!load.data) return <PageSkeleton />;
  const sources: DataSourceId[] = [
    ...(pageAllowed('sell-in-bnn') || load.data.sellIn ? ['sellin' as const] : []),
    ...(load.data.sellOut ? ['transaksi' as const, 'dofas' as const, 'erp' as const] : []),
    ...(load.data.outstanding ? ['outstanding' as const] : []),
    ...(load.data.stock ? ['stock' as const] : []),
  ];
  return <Body {...load.data} sources={sources} />;
}

/** Nama daerah sell out -> nama daerah sell in / outstanding (keduanya 10 daerah yang sama). */
const SO_KE_DAERAH: Record<string, string> = {
  'North Sum': 'Sumut', 'West Sum': 'Padang', Riau: 'Pekanbaru', 'Riau Island': 'Kepri', 'South Sum': 'Sumsel', 'West Kal': 'Kalbar',
};

/** Stok tanggal terakhir dan tanggal sebelumnya (dari v_stock_harian): total, per jenis, per daerah. */
interface StokRingkas { tgl: string; prev: string | null; ton: number; tonPrev: number | null; jenis: Record<string, number>; byDaerah: Map<string, { ton: number; prev: number | null }> }
const JENIS_STOK: [string, string][] = [['STR', 'Tiga Roda'], ['RJW', 'Rajawali'], ['CWC', 'Semen putih']];
function stokRingkas(rows: Row[]): StokRingkas | null {
  const dates = [...new Set(rows.map(r => String(r.tanggal).slice(0, 10)))].sort();
  const tgl = dates[dates.length - 1], prev = dates.length > 1 ? dates[dates.length - 2] : null;
  if (!tgl) return null;
  const jenis: Record<string, number> = {};
  const byDaerah = new Map<string, { ton: number; prev: number | null }>();
  let ton = 0, tonPrev = 0;
  for (const r of rows) {
    const t = String(r.tanggal).slice(0, 10);
    if (t !== tgl && t !== prev) continue;
    const v = Number(r.ton) || 0;
    const d = SO_KE_DAERAH[String(r.region)] || String(r.region);
    const x = byDaerah.get(d) || { ton: 0, prev: prev ? 0 : null };
    if (t === tgl) { ton += v; jenis[String(r.jenis)] = (jenis[String(r.jenis)] || 0) + v; x.ton += v; }
    else { tonPrev += v; x.prev = (x.prev || 0) + v; }
    byDaerah.set(d, x);
  }
  return { tgl, prev, ton, tonPrev: prev ? tonPrev : null, jenis, byDaerah };
}
const fmtSelisih = (d: number) => (Math.abs(d) < 0.05 ? '0' : (d > 0 ? '+' : '−') + fmtTon(Math.abs(d)));

const kosong = (): Bulanan => ({ cur: new Array(13).fill(0), target: new Array(13).fill(0), prev: new Array(13).fill(0) });
const TOL = 5;   // selisih capaian terhadap laju (poin persen) yang masih dianggap sesuai

/** Target yang seharusnya sudah tercapai s.d. tanggal data: bulan penuh dihitung utuh, bulan berjalan dihitung proporsional hari. */
function targetSdHariIni(b: Bulanan, per: Periode, lastMonth: number, cutDay: number, Y: number) {
  const months = per.kind === 'ytd' ? Array.from({ length: lastMonth }, (_, i) => i + 1) : [per.m];
  return months.reduce((a, m) => a + (m === lastMonth ? b.target[m] * Math.min(1, cutDay / daysInMonth(Y, m)) : b.target[m]), 0);
}
interface Baris extends Ringkas { laju: number }
const baris = (b: Bulanan, per: Periode, lastMonth: number, cutDay: number, Y: number, P: number): Baris =>
  ({ ...ringkas(b, per, lastMonth, cutDay, P), laju: targetSdHariIni(b, per, lastMonth, cutDay, Y) });
/** Selisih capaian terhadap laju, dalam poin persen dari target. Negatif = tertinggal. */
const selisihLaju = (r: Baris) => (r.target > 0 ? (r.cur - r.laju) / r.target * 100 : null);

function Body({ sellIn, sellOut, outstanding, stock, sources }: {
  sellIn: SellInData | null; sellOut: SellOutData | null; outstanding: { recs: OutRec[]; posisi: string } | null; stock: StokRingkas | null; sources: DataSourceId[];
}) {
  const [kind, setKind] = useState<'ytd' | 'bulan'>('bulan');
  const si = sellIn?.s, so = sellOut?.s;
  const perSi: Periode = kind === 'ytd' || !si ? { kind: 'ytd' } : { kind: 'bulan', m: si.lastMonth };
  const perSo: Periode = kind === 'ytd' || !so ? { kind: 'ytd' } : { kind: 'bulan', m: so.lastMonth };

  const siTot = si ? baris(si.total, perSi, si.lastMonth, si.cutDay, si.Y, si.P) : null;
  const soTot = so ? baris(so.total, perSo, so.lastMonth, so.cutDay, so.Y, so.P) : null;
  const siLabel = si ? periodLabel(perSi, si.Y, si.lastMonth, si.cutDay) : '';
  const soLabel = so ? periodLabel(perSo, so.Y, so.lastMonth, so.cutDay) : '';

  const out = useMemo(() => {
    if (!outstanding) return null;
    const open = outstanding.recs.filter(r => OPEN_STATUS.includes(r.status))
      .map(r => ({ ...r, region: si ? si.parentOf(key(r.region)) : r.region }));
    const ton = (j: string[]) => open.filter(r => j.includes(r.jalur)).reduce((a, r) => a + r.ton, 0);
    const byRegion = new Map<string, { ton: number; lewat: number }>();
    open.forEach(r => { const x = byRegion.get(r.region) || { ton: 0, lewat: 0 }; x.ton += r.ton; if (r.lewat) x.lewat += r.ton; byRegion.set(r.region, x); });
    return { all: outSummary(open), kapal: ton(['FAS Kapal']), container: ton(['FAS Container']), darat: ton(JALUR_DARAT), byRegion };
  }, [outstanding, si]);

  /* ---------- sell out per daerah (untuk hero) ---------- */
  const soRegions = useMemo(() => {
    if (!so) return [];
    return so.regions.map(n => ({ name: n, ...ringkas(so.byRegion.get(n) || kosong(), perSo, so.lastMonth, so.cutDay, so.P) }))
      .filter(r => r.target || r.cur).sort((a, b) => b.target - a.target || b.cur - a.cur);
  }, [so, perSo.kind]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- satu baris per daerah: sell in, sell out, outstanding ---------- */
  const daerah = useMemo(() => {
    const names = new Set<string>();
    si?.byRegion.forEach((_, n) => names.add(n));
    const soBy = new Map<string, Bulanan>();
    so?.byRegion.forEach((b, n) => { const d = SO_KE_DAERAH[n] || n; soBy.set(d, b); names.add(d); });
    out?.byRegion.forEach((_, n) => names.add(n));
    const urut = (n: string) => { const i = REGION_ORDER.indexOf(n); return i < 0 ? 99 : i; };
    return [...names].sort((a, b) => urut(a) - urut(b) || a.localeCompare(b)).map(n => ({
      nama: n,
      si: si && si.byRegion.has(n) ? baris(si.byRegion.get(n)!, perSi, si.lastMonth, si.cutDay, si.Y, si.P) : null,
      so: so && soBy.has(n) ? baris(soBy.get(n)!, perSo, so.lastMonth, so.cutDay, so.Y, so.P) : null,
      os: out?.byRegion.get(n) || null,
    })).filter(r => (r.si && (r.si.target || r.si.cur)) || (r.so && (r.so.target || r.so.cur)) || (r.os && r.os.ton > 0));
  }, [si, so, out, perSi.kind, perSo.kind]);   // eslint-disable-line react-hooks/exhaustive-deps

  // toko aktif bulan terakhir sell out (baris distributor, tanpa subdist)
  const ta = so?.ta ? { m: so.taMonth, day: so.taDay, cur: so.ta.cur[so.taMonth], target: so.ta.target[so.taMonth], prev: so.ta.prevSame[so.taMonth] } : null;

  const partial = (x: { Y: number; lastMonth: number; cutDay: number } | undefined) => !!x && x.cutDay < daysInMonth(x.Y, x.lastMonth);
  const adaTotal = daerah.length > 1;

  return (
    <>
      <PageHeader title="Overview" status={sources.length ? <DataBadge source={sources} /> : undefined} />
      <div className="pill-row mb-4" role="group" aria-label="Periode">
        <Chip active={kind === 'bulan'} onClick={() => setKind('bulan')}>Bulan berjalan</Chip>
        <Chip active={kind === 'ytd'} onClick={() => setKind('ytd')}>Tahun berjalan</Chip>
      </div>

      {so && <DaerahHero rows={soRegions.map(r => ({ key: r.name, name: r.name, target: r.target, cur: r.cur, prev: r.prev }))} P={so.P} period={soLabel} kind={kind} />}

      <div className={cx('grid gap-4 max-[640px]:grid-cols-1', stock ? 'grid-cols-5 max-[1500px]:grid-cols-3 max-[980px]:grid-cols-2' : 'grid-cols-4 max-[1240px]:grid-cols-2')}>
        <Panel title="Sell in" period={siLabel} ikon="sellin" warna="#0181D5" ke="sell-in-bnn">
          {siTot ? <Capai r={siTot} P={si!.P} proyeksi={kind === 'bulan' && partial(si) ? siTot.cur / si!.cutDay * daysInMonth(si!.Y, si!.lastMonth) : null} /> : <Kosong />}
        </Panel>
        <Panel title="Sell out" period={soLabel} ikon="sellout" warna="#1E3A5C" ke="sell-out-bnn">
          {soTot ? <Capai r={soTot} P={so!.P} proyeksi={kind === 'bulan' && partial(so) ? soTot.cur / so!.cutDay * daysInMonth(so!.Y, so!.lastMonth) : null} /> : <Kosong />}
        </Panel>
        <Panel title="Toko aktif" ikon="toko" warna="#C8035F" ke="sell-out-bnn" period={ta ? `${MONTHS_ID[ta.m]} ${so!.Y}${ta.day < daysInMonth(so!.Y, ta.m) ? `, s.d. tgl ${ta.day}` : ''}` : ''}>
          {ta ? (
            <>
              <div className="kpi-value">{fmt(ta.cur)}<span className="unit">toko</span></div>
              <Target actual={ta.cur} target={ta.target} teks={ta.target > 0 ? `dari target ${fmt(ta.target)} toko` : 'Belum ada target'} />
              <div className="ov-sub">
                <span className="text-soft">vs {so!.P} tanggal sama</span>
                <Naik g={ta.prev > 0 ? growthPct(ta.cur, ta.prev) : null} />
              </div>
              <div className="ov-sub"><span className="text-soft">{so!.P}, tanggal sama</span><span>{ta.prev > 0 ? `${fmt(ta.prev)} toko` : '–'}</span></div>
            </>
          ) : <Kosong />}
        </Panel>
        <Panel title="Outstanding DO" ikon="outstanding" warna="#A86300" ke="outstanding-do" period={outstanding ? `Posisi ${fmtDate(outstanding.posisi)}` : ''}>
          {out ? (
            <>
              <div className="ov-k">Belum terkirim</div>
              <div className="kpi-value">{fmtTon(out.all.ton)}<span className="unit">ton</span></div>
              <div className="text-soft text-[12.5px] mt-0.5">{fmt(out.all.orders)} order</div>
              <Porsi items={[
                { label: 'FAS Kapal', nilai: out.kapal, warna: '#A86300' },
                { label: 'FAS Container', nilai: out.container, warna: '#D9A441' },
                { label: 'Terminal & pabrik', nilai: out.darat, warna: '#B9C1CC' },
              ]} />
              <div className="ov-sub"><span className="text-soft">Lewat estimasi kirim</span><span className={cx('font-medium', out.all.lewat > 0 && 'text-red')}>{fmtTon(out.all.lewat)} ton</span></div>
            </>
          ) : <Kosong />}
        </Panel>
        {stock && (
          <Panel title="Stock semen" ikon="stock" warna="#2E7D4F" ke="stock" period={`Posisi ${fmtDate(stock.tgl)}`}>
            <div className="ov-k">Stok gudang</div>
            <div className="kpi-value">{fmtTon(stock.ton)}<span className="unit">ton</span></div>
            {stock.tonPrev != null && Math.abs(stock.ton - stock.tonPrev) >= 0.05 && (
              <div className="text-soft text-[12.5px] mt-0.5">
                <span className={cx('font-medium', stock.ton - stock.tonPrev > 0 ? 'text-green' : stock.ton - stock.tonPrev < 0 ? 'text-red' : '')}>{fmtSelisih(stock.ton - stock.tonPrev)} ton</span> vs {fmtDate(stock.prev!)}
              </div>
            )}
            <Porsi items={JENIS_STOK.map(([j, l], i) => ({ label: l, nilai: stock.jenis[j] || 0, warna: ['#2E7D4F', '#7FB894', '#B9C1CC'][i] }))} />
          </Panel>
        )}
      </div>

      {daerah.length > 0 && (
        <Card title="Kondisi per daerah" className="mt-4">
          <TableWrap>
            <table className="tbl-dense otb">
              <thead>
                <tr>
                  <th rowSpan={2}>Daerah</th>
                  <th colSpan={4} className="!text-center otb-sep">Sell in (ton){siLabel ? ` · ${siLabel}` : ''}</th>
                  <th colSpan={4} className="!text-center otb-sep">Sell out (ton){soLabel ? ` · ${soLabel}` : ''}</th>
                  <th colSpan={2} className="!text-center otb-sep">Outstanding DO (ton)</th>
                </tr>
                <tr>
                  <th className="num otb-sep">Target</th><th className="num">Realisasi</th><th className="num">Capaian</th><th className="num">vs {si?.P ?? so?.P ?? ''}</th>
                  <th className="num otb-sep">Target</th><th className="num">Realisasi</th><th className="num">Capaian</th><th className="num">vs {so?.P ?? si?.P ?? ''}</th>
                  <th className="num otb-sep">Belum terkirim</th><th className="num">Lewat estimasi</th>
                </tr>
              </thead>
              <tbody>
                {daerah.map(d => (
                  <tr key={d.nama}>
                    <td className="font-medium">{d.nama}</td>
                    <SelRingkas r={d.si} />
                    <SelRingkas r={d.so} />
                    <td className="num font-mono otb-sep">{d.os && d.os.ton > 0 ? fmtTon(d.os.ton) : '–'}</td>
                    <td className={cx('num font-mono', d.os && d.os.lewat > 0 && 'text-red')}>{d.os && d.os.lewat > 0 ? fmtTon(d.os.lewat) : '–'}</td>
                  </tr>
                ))}
              </tbody>
              {adaTotal && (
                <tfoot>
                  <tr className="font-semibold">
                    <td>Total</td>
                    <SelRingkas r={siTot} />
                    <SelRingkas r={soTot} />
                    <td className="num font-mono otb-sep">{out ? fmtTon(out.all.ton) : '–'}</td>
                    <td className={cx('num font-mono', out && out.all.lewat > 0 && 'text-red')}>{out && out.all.lewat > 0 ? fmtTon(out.all.lewat) : '–'}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </TableWrap>
          <p className="text-faint text-[12px] mt-2">
            Capaian dihitung terhadap target {kind === 'bulan' ? 'sebulan penuh' : 'Januari sampai bulan berjalan'}. Tanda ▼ = di bawah laju target, yaitu target yang seharusnya sudah tercapai sampai tanggal data (selisih lebih dari {TOL}% target).
            {' '}Pembanding tahun lalu memakai tanggal yang sama.
          </p>
        </Card>
      )}
    </>
  );
}

/** Empat sel: target, realisasi, capaian (dengan tanda bila di bawah laju), pertumbuhan. */
function SelRingkas({ r }: { r: Baris | null }) {
  if (!r || !(r.target || r.cur)) return <><td className="num otb-sep text-faint">–</td><td className="num text-faint">–</td><td className="num text-faint">–</td><td className="num text-faint">–</td></>;
  const g = growthPct(r.cur, r.prev), d = selisihLaju(r);
  return (
    <>
      <td className="num font-mono otb-sep">{r.hasTarget ? fmtTon(r.target) : '–'}</td>
      <td className="num font-mono">{fmtTon(r.cur)}</td>
      <td className="num whitespace-nowrap">
        {d != null && d < -TOL && <span className="text-red text-[10px] mr-1" title="Di bawah laju target sampai tanggal data">▼</span>}
        {r.hasTarget
          ? <span className={cx('font-mono text-xs font-semibold', r.cur >= r.target ? 'text-green' : r.cur >= r.target * 0.8 ? 'text-amber' : 'text-red')}>{fmt(r.cur / r.target * 100, 1)}%</span>
          : <span className="text-faint">–</span>}
      </td>
      <td className={cx('num font-mono', g == null ? 'text-faint' : g >= 0 ? 'text-green' : 'text-red')}>{fmtPct(g)}</td>
    </>
  );
}

/** "1 Jan – 3 Nov 2026" kalau bulan terakhir belum penuh, "Jan–Okt 2026" kalau penuh. */
function periodLabel(per: Periode, Y: number, lastMonth: number, cutDay: number) {
  const m0 = per.kind === 'ytd' ? 1 : lastMonth;
  if (cutDay >= daysInMonth(Y, lastMonth)) return m0 === lastMonth ? `${MONTHS_ID[m0]} ${Y}` : `${MONTHS_ID[m0]}–${MONTHS_ID[lastMonth]} ${Y}`;
  return fmtRange({ from: toISO(Y, m0, 1), to: toISO(Y, lastMonth, cutDay) });
}


const IKON: Record<string, string> = {
  sellin: '<rect x="3.5" y="12.5" width="7.5" height="7" rx=".6"/><rect x="13" y="12.5" width="7.5" height="7" rx=".6"/><rect x="8.25" y="4.5" width="7.5" height="7" rx=".6"/>',
  sellout: '<path d="M4 20h16"/><path d="M6.5 16.5V11M11 16.5V7.5M15.5 16.5v-4"/><path d="m15 6 3-2.5L21 6M18 3.5V10"/>',
  toko: '<path d="M4 9.5 5.5 4h13L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 12v8h13v-8M10 20v-4.5h4V20"/>',
  outstanding: '<rect x="3.5" y="5" width="17" height="14" rx="1.2"/><path d="M3.5 9.5h17M8 14h4"/>',
  stock: '<path d="M3.5 9.5 12 5l8.5 4.5V20h-17V9.5Z"/><path d="M7.5 20v-6h9v6M7.5 16.5h9"/>',
};

/** Kartu ringkasan: ikon berwarna lembut, isi, dan tautan ke halaman rinciannya (kalau role punya akses). */
function Panel({ title, period, ikon, warna, ke, children }: { title: string; period: string; ikon: string; warna: string; ke: string; children: ReactNode }) {
  const { pageAllowed } = useAuth();
  return (
    <div className="card flex flex-col transition-shadow hover:shadow-[0_4px_14px_rgba(16,24,40,.08)]">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `${warna}14`, color: warna }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]" dangerouslySetInnerHTML={{ __html: IKON[ikon] }} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
          {period && <div className="text-faint text-[12px] leading-tight mt-0.5 truncate">{period}</div>}
        </div>
      </div>
      <div className="mt-3.5 flex-1">{children}</div>
      {pageAllowed(ke) && <Link to={`/${ke}`} className="mt-3 pt-2.5 border-t border-line text-[12.5px] text-soft no-underline hover:text-accent-ink flex items-center justify-between">Lihat rincian<span aria-hidden="true">→</span></Link>}
    </div>
  );
}

/** Batang capaian terhadap target: persen besar di kanan, keterangan target di bawah. */
function Target({ actual, target, teks }: { actual: number; target: number; teks: string }) {
  const p = target > 0 ? (actual / target) * 100 : null;
  const tone = p == null ? '' : p >= 100 ? 'bg-green' : p >= 80 ? 'bg-amber' : 'bg-red';
  const teksTone = p == null ? 'text-faint' : p >= 100 ? 'text-green' : p >= 80 ? 'text-amber' : 'text-red';
  return (
    <div className="mt-2.5">
      <div className="flex items-center gap-2.5">
        <div className="flex-1 h-2 rounded-full bg-surface3 overflow-hidden" role="img" aria-label={p == null ? 'Belum ada target' : `Capaian ${fmt(p, 0)} persen`}>
          {p != null && <div className={cx('h-full rounded-full', tone)} style={{ width: `${Math.min(100, p)}%` }} />}
        </div>
        <span className={cx('text-[15px] font-semibold tabular-nums w-[46px] text-right', teksTone)}>{p == null ? '–' : `${fmt(p, 0)}%`}</span>
      </div>
      <div className="text-faint text-[12px] mt-1">{teks}</div>
    </div>
  );
}

/** Pertumbuhan dengan panah naik / turun. */
function Naik({ g }: { g: number | null }) {
  if (g == null) return <span className="text-faint">–</span>;
  return <span className={cx('font-medium inline-flex items-center gap-1', g >= 0 ? 'text-green' : 'text-red')}><span aria-hidden="true" className="text-[10px]">{g >= 0 ? '▲' : '▼'}</span>{fmtPct(g)}</span>;
}

/** Porsi beberapa bagian: satu batang bertumpuk dan daftar nilainya. */
function Porsi({ items }: { items: { label: string; nilai: number; warna: string }[] }) {
  const total = items.reduce((a, b) => a + b.nilai, 0);
  return (
    <div className="mt-3">
      <div className="flex h-2 rounded-full overflow-hidden bg-surface3" aria-hidden="true">
        {total > 0 && items.map(it => it.nilai > 0 && <div key={it.label} style={{ width: `${(it.nilai / total) * 100}%`, background: it.warna }} />)}
      </div>
      <dl className="mt-2 text-[13px]">
        {items.map(it => (
          <div key={it.label} className="flex items-baseline justify-between gap-3 py-1">
            <dt className="text-soft flex items-center gap-2"><i aria-hidden="true" className="inline-block w-2 h-2 rounded-sm" style={{ background: it.warna }} />{it.label}</dt>
            <dd className="m-0 font-medium tabular-nums">{it.nilai ? `${fmtTon(it.nilai)} ton` : '–'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
const Kosong = () => <p className="text-faint text-[13px]">Data belum tersedia.</p>;

/** Target dulu, lalu realisasi + capaian, pertumbuhan vs tahun lalu tanggal sama, dan proyeksi akhir bulan bila bulan belum penuh. */
function Capai({ r, P, proyeksi }: { r: { target: number; cur: number; prev: number; hasTarget: boolean }; P: number; proyeksi?: number | null }) {
  const g = growthPct(r.cur, r.prev);
  const pp = proyeksi != null && r.hasTarget ? proyeksi / r.target * 100 : null;
  return (
    <>
      <div className="kpi-value">{fmtTon(r.cur)}<span className="unit">ton</span></div>
      <Target actual={r.cur} target={r.hasTarget ? r.target : 0} teks={r.hasTarget ? `dari target ${fmtTon(r.target)} ton` : 'Belum ada target'} />
      <div className="ov-sub">
        <span className="text-soft">vs {P} tanggal sama</span>
        <Naik g={g} />
      </div>
      {proyeksi != null && (
        <div className="ov-sub" title="Realisasi sampai tanggal data dibagi jumlah hari berjalan, dikali jumlah hari sebulan">
          <span className="text-soft">Proyeksi akhir bulan</span>
          <span className="whitespace-nowrap">{fmtTon(proyeksi)} ton{pp != null && <span className={cx('ml-1.5 font-medium', pp >= 100 ? 'text-green' : pp >= 80 ? 'text-amber' : 'text-red')}>{fmt(pp, 0)}%</span>}</span>
        </div>
      )}
    </>
  );
}
