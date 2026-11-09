import { useMemo, useState, type ReactNode } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { DataSource, sellInTargetsFor, sellOutTargetsFor } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, MONTHS_ID, chartSRSummary, fmt, fmtCompact } from '../lib/format';
import { fmtDate, fmtRange, toISO, daysInMonth } from '../lib/dates';
import { DataBadge, todayWIB, type DataSourceId } from '../components/DataStatus';
import { DaerahHero } from '../components/DaerahHero';
import { Capaian, Card, ChartBox, Chip, ErrorBox, PageHeader, PageSkeleton, cx } from '../components/ui';
import {
  JALUR_DARAT, OPEN_STATUS, fmtPct, growthPct, outRecs, outSummary, ringkas, sellInRingkasan, sellOutRingkasan,
  type Bulanan, type OutRec, type Periode, type Peta, type SellInRingkasan, type SellOutRingkasan,
} from '../lib/ringkasan';

/* ============================================================================
   Overview: rangkuman Sell In BNN, Sell Out BNN, dan Outstanding DO dalam satu halaman.
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

function Body({ sellIn, sellOut, outstanding, sources }: {
  sellIn: SellInData | null; sellOut: SellOutData | null; outstanding: { recs: OutRec[]; posisi: string } | null; sources: DataSourceId[];
}) {
  const [kind, setKind] = useState<'ytd' | 'bulan'>('bulan');
  const si = sellIn?.s, so = sellOut?.s;
  const perSi: Periode = kind === 'ytd' || !si ? { kind: 'ytd' } : { kind: 'bulan', m: si.lastMonth };
  const perSo: Periode = kind === 'ytd' || !so ? { kind: 'ytd' } : { kind: 'bulan', m: so.lastMonth };

  const siTot = si ? ringkas(si.total, perSi, si.lastMonth, si.cutDay, si.P) : null;
  const soTot = so ? ringkas(so.total, perSo, so.lastMonth, so.cutDay, so.P) : null;
  const siLabel = si ? periodLabel(perSi, si.Y, si.lastMonth, si.cutDay) : '';
  const soLabel = so ? periodLabel(perSo, so.Y, so.lastMonth, so.cutDay) : '';

  const out = useMemo(() => {
    if (!outstanding) return null;
    const open = outstanding.recs.filter(r => OPEN_STATUS.includes(r.status));
    const ton = (j: string[]) => open.filter(r => j.includes(r.jalur)).reduce((a, r) => a + r.ton, 0);
    return { all: outSummary(open), kapal: ton(['FAS Kapal']), container: ton(['FAS Container']), darat: ton(JALUR_DARAT), open };
  }, [outstanding]);

  /* ---------- sell in & sell out per bulan (tahun berjalan) ---------- */
  const Y = si?.Y ?? so?.Y ?? Number(todayWIB().slice(0, 4));
  const trend = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const pick = (b: Bulanan | undefined, k: keyof Bulanan, upto: number) => months.map(m => (b && m <= upto ? b[k][m] : null));
    const t = {
      sameTarget: false,
      labels: months.map(m => MONTHS_ID[m]),
      si: pick(si?.total, 'cur', si && si.Y === Y ? si.lastMonth : 0), siT: si ? months.map(m => si.total.target[m] || null) : months.map(() => null),
      so: pick(so?.total, 'cur', so && so.Y === Y ? so.lastMonth : 0), soT: so ? months.map(m => so.total.target[m] || null) : months.map(() => null),
    };
    // target sell in & sell out biasanya sama: cukup satu garis
    t.sameTarget = !!si && !!so && months.every(m => Math.abs((si.total.target[m] || 0) - (so.total.target[m] || 0)) <= Math.max(1, (si.total.target[m] || 0) * 0.005));
    return t;
  }, [si, so, Y]);

  /* ---------- per region ---------- */
  const soRegions = useMemo(() => {
    if (!so) return [];
    const empty: Bulanan = { cur: new Array(13).fill(0), target: new Array(13).fill(0), prev: new Array(13).fill(0) };
    return so.regions.map(n => ({ name: n, ...ringkas(so.byRegion.get(n) || empty, perSo, so.lastMonth, so.cutDay, so.P) }))
      .filter(r => r.target || r.cur).sort((a, b) => b.target - a.target || b.cur - a.cur);
  }, [so, perSo.kind]);   // eslint-disable-line react-hooks/exhaustive-deps

  // toko aktif bulan terakhir sell out (baris distributor, tanpa subdist)
  const ta = so?.ta ? { m: so.taMonth, day: so.taDay, cur: so.ta.cur[so.taMonth], target: so.ta.target[so.taMonth], prev: so.ta.prevSame[so.taMonth] } : null;

  return (
    <>
      <PageHeader title="Overview" status={sources.length ? <DataBadge source={sources} /> : undefined} />
      <div className="pill-row mb-4" role="group" aria-label="Periode">
        <Chip active={kind === 'bulan'} onClick={() => setKind('bulan')}>Bulan berjalan</Chip>
        <Chip active={kind === 'ytd'} onClick={() => setKind('ytd')}>Tahun berjalan</Chip>
      </div>

      {so && <DaerahHero rows={soRegions.map(r => ({ key: r.name, name: r.name, target: r.target, cur: r.cur, prev: r.prev }))} P={so.P} period={soLabel} kind={kind} />}

      <div className="grid grid-cols-3 max-[1100px]:grid-cols-1 gap-4">
        <Panel title="Sell in" period={siLabel}>
          {siTot ? <Capai r={siTot} P={si!.P} /> : <Kosong />}
        </Panel>
        <Panel title="Sell out" period={soLabel}>
          {soTot ? (
            <>
              <Capai r={soTot} P={so!.P} />
              {ta && (
                <div className="ov-sub">
                  <span className="text-soft">Toko aktif {MONTHS_ID[ta.m]}{ta.day < daysInMonth(so!.Y, ta.m) ? ` (s.d. tgl ${ta.day})` : ''}</span>
                  <span><b>{fmt(ta.cur)}</b>{ta.target > 0 && <span className="text-soft"> dari target {fmt(ta.target)}</span>}</span>
                </div>
              )}
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
                <div><dt>Lewat estimasi kirim</dt><dd>{fmtTon(out.all.lewat)} ton</dd></div>
              </dl>
            </>
          ) : <Kosong />}
        </Panel>
      </div>

      {(si || so) && (
        <Card title={`Sell in dan sell out per bulan · ${Y}`} className="mt-4">
          <div className="legend">
            {si && <span><i style={{ background: COLORS.accent }} aria-hidden="true" />Sell in</span>}
            {so && <span><i style={{ background: COLORS.blue }} aria-hidden="true" />Sell out</span>}
            {trend.sameTarget
              ? <span><i style={{ background: COLORS.target, height: 2 }} aria-hidden="true" />Target (sama untuk sell in & sell out)</span>
              : <span><i style={{ background: COLORS.target, height: 2 }} aria-hidden="true" />Target (garis putus, warna sesuai batang)</span>}
          </div>
          <ChartBox className="tall" label={chartSRSummary(trend.labels, trend.si.map(x => x ?? 0), 'ton sell in')}
            deps={[trend.si.join('|'), trend.so.join('|'), trend.siT.join('|'), trend.soT.join('|')]}
            build={() => ({
              type: 'bar',
              data: { labels: trend.labels, datasets: [
                ...(si ? [{ type: 'line', label: trend.sameTarget ? 'Target' : 'Target sell in', data: trend.siT, borderColor: trend.sameTarget ? COLORS.target : COLORS.accent, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false, order: 0 }] : []),
                ...(so && !trend.sameTarget ? [{ type: 'line', label: 'Target sell out', data: trend.soT, borderColor: COLORS.blue, borderDash: [2, 3], borderWidth: 1.5, pointRadius: 0, fill: false, order: 0 }] : []),
                ...(si ? [{ label: 'Sell in', data: trend.si, backgroundColor: COLORS.accent, maxBarThickness: 20, order: 1 }] : []),
                ...(so ? [{ label: 'Sell out', data: trend.so, backgroundColor: COLORS.blue, maxBarThickness: 20, order: 2 }] : []),
              ] } as any,
              options: {
                responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                scales: { y: { beginAtZero: true, grid: { color: COLORS.line }, border: { display: false }, ticks: { callback: (x: any) => fmtCompact(x) } }, x: { grid: { display: false } } },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => (c.parsed.y == null ? null : ` ${c.dataset.label}: ${fmt(c.parsed.y)} ton`) } } },
              },
            } as ChartConfiguration)} />
          {(si && si.cutDay < daysInMonth(si.Y, si.lastMonth)) && (
            <p className="text-faint text-[12px] mt-2">{MONTHS_ID[si.lastMonth]} baru s.d. tanggal {si.cutDay} (sell in){so && so.Y === si.Y && so.lastMonth === si.lastMonth && so.cutDay < daysInMonth(so.Y, so.lastMonth) ? `, ${so.cutDay} (sell out)` : ''}.</p>
          )}
        </Card>
      )}

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

/** Target dulu, lalu realisasi + capaian, lalu pertumbuhan vs tahun lalu tanggal sama. */
function Capai({ r, P }: { r: { target: number; cur: number; prev: number; hasTarget: boolean }; P: number }) {
  const g = growthPct(r.cur, r.prev);
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
    </>
  );
}
