import { useMemo, useState, type ReactNode } from 'react';
import { DataSource, sellInTargetsFor, sellOutTargetsFor } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { MONTHS_ID, fmt } from '../lib/format';
import { fmtDate, fmtRange, toISO, daysInMonth } from '../lib/dates';
import { DataBadge, todayWIB, type DataSourceId } from '../components/DataStatus';
import { DaerahHero } from '../components/DaerahHero';
import { Capaian, Card, Chip, ErrorBox, PageHeader, PageSkeleton, TableWrap, cx } from '../components/ui';
import {
  JALUR_DARAT, OPEN_STATUS, REGION_ORDER, fmtPct, growthPct, key, outRecs, outSummary, ringkas, sellInRingkasan, sellOutRingkasan,
  type Bulanan, type OutRec, type Periode, type Peta, type Ringkas, type SellInRingkasan, type SellOutRingkasan,
} from '../lib/ringkasan';

/* ============================================================================
   Overview: kondisi perusahaan dalam satu layar. Empat angka utama (sell in, sell out, toko aktif,
   outstanding DO), daftar yang perlu perhatian (dihitung dari angka), lalu satu baris per daerah.
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
    const [siRows, siInfo, siTarget, peta, soMonthly, soTarget, status, soTa, outRows, outInfo] = await Promise.all([
      opt(DataSource.sellinDaily()), opt(DataSource.sellinInfo()), opt(DataSource.targetSellIn()),
      opt(DataSource.selloutPeta()), opt(DataSource.selloutMonthly()), opt(DataSource.targetSellOut()), opt(DataSource.dataStatus()), opt(DataSource.selloutTa()),
      opt(DataSource.outstandingRingkas()), opt(DataSource.outstandingInfo()),
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
    return { sellIn, sellOut, outstanding };
  }, []);
  if (load.error) return <ErrorBox error={load.error} />;
  if (!load.data) return <PageSkeleton />;
  const sources: DataSourceId[] = [
    ...(pageAllowed('sell-in-bnn') || load.data.sellIn ? ['sellin' as const] : []),
    ...(load.data.sellOut ? ['transaksi' as const, 'dofas' as const, 'erp' as const] : []),
    ...(load.data.outstanding ? ['outstanding' as const] : []),
  ];
  return <Body {...load.data} sources={sources} />;
}

/** Nama daerah sell out -> nama daerah sell in / outstanding (keduanya 10 daerah yang sama). */
const SO_KE_DAERAH: Record<string, string> = {
  'North Sum': 'Sumut', 'West Sum': 'Padang', Riau: 'Pekanbaru', 'Riau Island': 'Kepri', 'South Sum': 'Sumsel', 'West Kal': 'Kalbar',
};
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

function Body({ sellIn, sellOut, outstanding, sources }: {
  sellIn: SellInData | null; sellOut: SellOutData | null; outstanding: { recs: OutRec[]; posisi: string } | null; sources: DataSourceId[];
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

  /* ---------- yang perlu perhatian: dari angka, bukan penilaian ---------- */
  const perhatian = useMemo(() => {
    const list: { tone: 'bad' | 'warn'; teks: ReactNode }[] = [];
    const total = (nama: string, r: Baris | null) => {
      const d = r ? selisihLaju(r) : null;
      if (r && d != null && d < -TOL) list.push({ tone: 'bad', teks: <><b>{nama}</b> tertinggal {fmtTon(r.laju - r.cur)} ton dari laju target: realisasi {fmtTon(r.cur)} ton, seharusnya sudah {fmtTon(r.laju)} ton.</> });
    };
    total('Sell in', siTot); total('Sell out', soTot);
    const tertinggal = (nama: string, pick: (d: typeof daerah[number]) => Baris | null) => {
      const rows = daerah.map(d => ({ n: d.nama, r: pick(d) })).filter(x => x.r && x.r.target > 0)
        .map(x => ({ n: x.n, r: x.r!, d: selisihLaju(x.r!)! })).filter(x => x.d < -TOL).sort((a, b) => (a.r.cur - a.r.laju) - (b.r.cur - b.r.laju));
      if (!rows.length) return;
      const top = rows.slice(0, 3);
      list.push({ tone: 'warn', teks: <><b>{nama}</b> di bawah laju target di {rows.length} daerah. Selisih terbesar: {top.map((x, i) => <span key={x.n}>{i ? ', ' : ''}{x.n} ({fmtTon(x.r.laju - x.r.cur)} ton, capaian {fmt(x.r.cur / x.r.target * 100, 0)}%)</span>)}.</> });
    };
    tertinggal('Sell in', d => d.si); tertinggal('Sell out', d => d.so);
    const turun = daerah.map(d => ({ n: d.nama, g: d.so ? growthPct(d.so.cur, d.so.prev) : null })).filter(x => x.g != null && x.g < -10).sort((a, b) => a.g! - b.g!);
    if (turun.length) list.push({ tone: 'warn', teks: <><b>Sell out turun</b> lebih dari 10% dibanding {so!.P} di {turun.length} daerah: {turun.slice(0, 4).map((x, i) => <span key={x.n}>{i ? ', ' : ''}{x.n} ({fmtPct(x.g, 0)})</span>)}.</> });
    if (ta && ta.target > 0 && ta.cur < ta.target * 0.8) list.push({ tone: 'warn', teks: <><b>Toko aktif</b> {MONTHS_ID[ta.m]} baru {fmt(ta.cur)} dari target {fmt(ta.target)} ({fmt(ta.cur / ta.target * 100, 0)}%).</> });
    if (out && out.all.lewat > 0) {
      const top = [...out.byRegion.entries()].filter(([, v]) => v.lewat > 0).sort((a, b) => b[1].lewat - a[1].lewat).slice(0, 3);
      list.push({ tone: out.all.lewat > out.all.ton * 0.25 ? 'bad' : 'warn', teks: <><b>Outstanding DO</b> {fmtTon(out.all.lewat)} ton sudah lewat estimasi kirim ({fmt(out.all.lewat / out.all.ton * 100, 0)}% dari yang belum terkirim). Terbesar: {top.map(([n, v], i) => <span key={n}>{i ? ', ' : ''}{n} ({fmtTon(v.lewat)} ton)</span>)}.</> });
    }
    return list;
  }, [siTot, soTot, daerah, ta, out, so]);   // eslint-disable-line react-hooks/exhaustive-deps

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

      <div className="grid grid-cols-4 max-[1240px]:grid-cols-2 max-[640px]:grid-cols-1 gap-4">
        <Panel title="Sell in" period={siLabel}>
          {siTot ? <Capai r={siTot} P={si!.P} proyeksi={kind === 'bulan' && partial(si) ? siTot.cur / si!.cutDay * daysInMonth(si!.Y, si!.lastMonth) : null} /> : <Kosong />}
        </Panel>
        <Panel title="Sell out" period={soLabel}>
          {soTot ? <Capai r={soTot} P={so!.P} proyeksi={kind === 'bulan' && partial(so) ? soTot.cur / so!.cutDay * daysInMonth(so!.Y, so!.lastMonth) : null} /> : <Kosong />}
        </Panel>
        <Panel title="Toko aktif" period={ta ? `${MONTHS_ID[ta.m]} ${so!.Y}${ta.day < daysInMonth(so!.Y, ta.m) ? `, s.d. tgl ${ta.day}` : ''}` : ''}>
          {ta ? (
            <>
              <div className="ov-sub !mt-0 !pt-0 !border-0"><span className="text-soft">Target</span><span>{ta.target > 0 ? `${fmt(ta.target)} toko` : '–'}</span></div>
              <div className="ov-k mt-2">Realisasi</div>
              <div className="kpi-value">{fmt(ta.cur)}<span className="unit">toko</span></div>
              {ta.target > 0 && <div className="mt-1.5"><Capaian actual={ta.cur} target={ta.target} /></div>}
              <div className="ov-sub">
                <span className="text-soft">vs {so!.P} tanggal sama</span>
                <span className={cx('font-medium', ta.prev > 0 ? (ta.cur >= ta.prev ? 'text-green' : 'text-red') : '')}>{fmtPct(growthPct(ta.cur, ta.prev))}</span>
              </div>
              <div className="ov-sub"><span className="text-soft">{so!.P}, tanggal sama</span><span>{ta.prev > 0 ? `${fmt(ta.prev)} toko` : '–'}</span></div>
            </>
          ) : <Kosong />}
        </Panel>
        <Panel title="Outstanding DO" period={outstanding ? `Posisi ${fmtDate(outstanding.posisi)}` : ''}>
          {out ? (
            <>
              <div className="ov-k">Belum terkirim</div>
              <div className="kpi-value">{fmtTon(out.all.ton)}<span className="unit">ton</span></div>
              <div className="text-soft text-[12.5px] mt-0.5">{fmt(out.all.orders)} order</div>
              <dl className="ov-list">
                <div><dt>FAS Kapal</dt><dd>{fmtTon(out.kapal)} ton</dd></div>
                <div><dt>FAS Container</dt><dd>{fmtTon(out.container)} ton</dd></div>
                <div><dt>Terminal & pabrik</dt><dd>{fmtTon(out.darat)} ton</dd></div>
                <div><dt>Lewat estimasi kirim</dt><dd className={out.all.lewat > 0 ? 'text-red' : undefined}>{fmtTon(out.all.lewat)} ton</dd></div>
              </dl>
            </>
          ) : <Kosong />}
        </Panel>
      </div>

      <Card title="Perlu perhatian" className="mt-4">
        {perhatian.length ? (
          <ul className="ov-alert">
            {perhatian.map((x, i) => <li key={i} className={x.tone}><span>{x.teks}</span></li>)}
          </ul>
        ) : <p className="text-soft text-[13.5px]">Sell in dan sell out sesuai laju target di semua daerah, dan tidak ada outstanding yang lewat estimasi kirim.</p>}
        <p className="text-faint text-[12px] mt-3">Laju target = target yang seharusnya sudah tercapai sampai tanggal data (bulan berjalan dihitung proporsional hari). Dianggap tertinggal bila selisihnya lebih dari {TOL}% target.</p>
      </Card>

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
            Capaian dihitung terhadap target {kind === 'bulan' ? 'sebulan penuh' : 'Januari sampai bulan berjalan'}. Tanda ▼ = di bawah laju target sampai tanggal data.
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

function Panel({ title, period, children }: { title: string; period: string; children: ReactNode }) {
  return (
    <div className="card flex flex-col">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {period && <span className="text-faint text-[12px]">{period}</span>}
      </div>
      <div className="mt-3 flex-1">{children}</div>
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
      <div className="ov-sub !mt-0 !pt-0 !border-0"><span className="text-soft">Target</span><span>{r.hasTarget ? `${fmtTon(r.target)} ton` : '–'}</span></div>
      <div className="ov-k mt-2">Realisasi</div>
      <div className="kpi-value">{fmtTon(r.cur)}<span className="unit">ton</span></div>
      {r.hasTarget && <div className="mt-1.5"><Capaian actual={r.cur} target={r.target} /></div>}
      <div className="ov-sub">
        <span className="text-soft">vs {P} tanggal sama</span>
        <span className={cx('font-medium', g == null ? '' : g >= 0 ? 'text-green' : 'text-red')}>{fmtPct(g)}</span>
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
