import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, MONTHS_ID, chartSRSummary, fmt, fmtCompact } from '../lib/format';
import { daysInMonth } from '../lib/dates';
import type { Row } from '../lib/types';
import { DataBadge, todayWIB } from '../components/DataStatus';
import { GrowthTable } from '../components/GrowthTable';
import { Capaian, Card, ChartBox, ErrorBox, FileIcon, FilterBar, Kpi, PageHeader, PageSkeleton, Select, TableWrap, cx } from '../components/ui';
import { exportRowsToExcel } from '../lib/xlsx';

/* ============================================================================
   Sell Out BNN: per baris distributor/subdist dari peta sementrack.sellout_bnn_peta
   (J028 transaksi, DO FAS, Sub ERP; J073 belum tersedia = 0), per bulan.
   Target & realisasi tahun lalu dari data Sell Out bulanan (v_cement_targets_ext).
   Bulan berjalan: target = sebulan penuh; tahun lalu dibandingkan pada tanggal yang sama
   (diperkirakan dari total bulan dibagi jumlah hari).
============================================================================ */

interface Peta {
  id: number; urutan: number; region: string; nama: string; target_region: string | null; target_key: string | null;
  sumber: string; j073: boolean; dofas_kode: string[] | null; dofas_tipe: string | null; erp_kode: string | null; jenis?: 'dist' | 'subdist';
}
/** Distributor = transaksi sendiri (J028 penuh / tanpa subdist, J073); subdist = DO FAS, Sub ERP, customer subdist di J028. */
const isSubdist = (p: Peta) => (p.jenis ? p.jenis === 'subdist' : !p.j073 && !/^J028 \S+( tanpa|$| \+)/.test(p.sumber));
const SUB_COLOR = COLORS.amber;
const MONTH_EN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TIPE_OPTS = [
  { value: 'all', label: 'Semua Tipe' }, { value: 'STR', label: 'STR' }, { value: 'RJW', label: 'RJW' }, { value: 'CWC', label: 'CWC (putih)' },
];
const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 && t % 1 ? 1 : 0);
const sumArr = (a: number[]) => a.reduce((x, y) => x + y, 0);
const growthPct = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev * 100 : null);
const fmtPct = (p: number | null) => (p == null ? '–' : (p > 0 ? '+' : '') + p.toFixed(1) + '%');
const tgtType = (t: string) => (t === 'CWC' ? 'WC' : t);

/** Tahun target dari nama kolom do_YYYY di v_cement_targets_ext. */
function detectYear(rows: Row[], fallback: number) {
  let y = 0;
  if (rows[0]) for (const k of Object.keys(rows[0])) { const m = /^do_(\d{4})$/.exec(k); if (m) y = Math.max(y, Number(m[1])); }
  return y || fallback;
}

export default function SellOutBnn() {
  useDocTitle('Sell Out BNN');
  const load = useAsync(async () => {
    const [peta, monthly, targets, status] = await Promise.all([
      DataSource.selloutPeta(), DataSource.selloutMonthly(), DataSource.cementTargets(), DataSource.dataStatus().catch(() => [] as Row[]),
    ]);
    return { peta: peta as unknown as Peta[], monthly, targets, status };
  }, []);
  if (load.error) return <ErrorBox error={load.error} />;
  if (!load.data) return <PageSkeleton />;
  const { peta, monthly, targets, status } = load.data;
  if (!peta.length) return <EmptyState />;
  return <Body peta={peta} monthly={monthly} targets={targets} status={status} />;
}

function EmptyState() {
  const { pageAllowed } = useAuth();
  return (
    <>
      <PageHeader title="Sell Out BNN" />
      <div className="card max-w-[620px]">
        <h2 className="!text-[20px]">Belum ada data</h2>
        <p className="text-soft text-[13.5px] mt-2 leading-relaxed">Peta Sell Out BNN belum dipasang di database (docs/sql/sell_out_bnn.sql).</p>
        {pageAllowed('kelola-data') && <Link to="/kelola-data?data=sellout" className="btn btn-primary no-underline mt-4">Buka Kelola Data</Link>}
      </div>
    </>
  );
}

function Body({ peta, monthly, targets, status }: { peta: Peta[]; monthly: Row[]; targets: Row[]; status: Row[] }) {
  const { pageAllowed, canDownload } = useAuth();
  const today = todayWIB();
  const Y = detectYear(targets, Number(today.slice(0, 4))), P = Y - 1;
  const kTgt = `target_do_${Y}`, kPrev = `do_${P}`;

  // bulan terakhir berisi data tahun ini & tanggal potong bulan berjalan (dari transaksi harian)
  const lastMonth = useMemo(() => monthly.reduce((a, r) => (Number(r.tahun) === Y && Number(r.ton) > 0 ? Math.max(a, Number(r.bulan)) : a), 0) || 1, [monthly, Y]);
  const trxSampai = String(status.find(r => r.sumber === 'transaksi')?.data_sampai ?? '').slice(0, 10);
  const cutDay = trxSampai.startsWith(`${Y}-${String(lastMonth).padStart(2, '0')}`) ? Number(trxSampai.slice(8, 10)) : daysInMonth(Y, lastMonth);
  const partial = cutDay < daysInMonth(Y, lastMonth);

  /* ---------- filter ---------- */
  const [mFrom, setMFrom] = useState(1);
  const [mTo, setMTo] = useState(lastMonth);
  const [region, setRegion] = useState('all');
  const [baris, setBaris] = useState('all');   // id peta
  const [tipe, setTipe] = useState('all');
  const regions = useMemo(() => [...new Set(peta.map(p => p.region))], [peta]);
  const barisOpts = peta.filter(p => region === 'all' || p.region === region);
  const changeRegion = (v: string) => { setRegion(v); if (v !== 'all' && baris !== 'all' && peta.find(p => String(p.id) === baris)?.region !== v) setBaris('all'); };
  const filterActive = region !== 'all' || baris !== 'all' || tipe !== 'all' || mFrom !== 1 || mTo !== lastMonth;
  const resetFilter = () => { setRegion('all'); setBaris('all'); setTipe('all'); setMFrom(1); setMTo(lastMonth); };
  const groupBy: 'region' | 'baris' = region === 'all' ? 'region' : 'baris';

  const v = useMemo(() => {
    const inScope = (p: Peta) => (region === 'all' || p.region === region) && (baris === 'all' || String(p.id) === baris);
    const scoped = peta.filter(inScope);
    const ids = new Set(scoped.map(p => p.id));
    const byId = new Map(peta.map(p => [p.id, p]));
    const typeOk = (t: unknown) => tipe === 'all' || t === tipe;

    // realisasi tahun ini per baris x bulan
    const cur = new Map<number, number[]>();
    let untyped = 0;   // Sub ERP tanpa tipe yang tidak ikut saat filter tipe
    monthly.forEach(r => {
      if (Number(r.tahun) !== Y || !ids.has(Number(r.peta_id))) return;
      if (!typeOk(r.tipe)) { if (r.tipe == null && tipe !== 'all') untyped += Number(r.ton || 0); return; }
      const arr = cur.get(Number(r.peta_id)) || new Array(13).fill(0);
      arr[Number(r.bulan)] += Number(r.ton || 0);
      cur.set(Number(r.peta_id), arr);
    });
    // target & tahun lalu per baris x bulan
    const tgt = new Map<number, number[]>(), prv = new Map<number, number[]>();
    scoped.forEach(p => {
      if (!p.target_key) return;
      const t = new Array(13).fill(0), q = new Array(13).fill(0);
      targets.forEach(r => {
        if (r.region !== p.target_region || r.distributor !== p.target_key) return;
        if (tipe !== 'all' && r.type_cement !== tgtType(tipe)) return;
        const m = Number(r.month_num); if (!(m >= 1 && m <= 12)) return;
        t[m] += Number(r[kTgt] || 0); q[m] += Number(r[kPrev] || 0);
      });
      tgt.set(p.id, t); prv.set(p.id, q);
    });

    const months = Array.from({ length: mTo - mFrom + 1 }, (_, i) => mFrom + i);
    const isPartial = (m: number) => partial && m === lastMonth;
    const prevSame = (q: number[], m: number) => (isPartial(m) ? q[m] * cutDay / daysInMonth(P, m) : q[m]);
    const get = (map: Map<number, number[]>, id: number, m: number) => map.get(id)?.[m] || 0;
    const sumOver = (fn: (id: number, m: number) => number, idList = scoped.map(p => p.id), ms = months) =>
      idList.reduce((a, id) => a + ms.reduce((b, m) => b + fn(id, m), 0), 0);

    // J073 (INSA, PKB) belum ada datanya: target & tahun lalunya tidak ikut dibandingkan
    const live = scoped.filter(p => !p.j073).map(p => p.id);
    const ton = sumOver((id, m) => get(cur, id, m));
    const target = sumOver((id, m) => get(tgt, id, m), live);
    const prev = sumOver((id, m) => prevSame(prv.get(id) || [], m), live);
    const hasTarget = target > 0;

    const monthLabel = (m: number) => MONTHS_ID[m] + (isPartial(m) ? ` (1–${cutDay})` : '');
    const distIds = scoped.filter(p => !isSubdist(p)).map(p => p.id), subIds = scoped.filter(isSubdist).map(p => p.id);
    const trend = {
      labels: months.map(monthLabel),
      cur: months.map(m => sumOver((id) => get(cur, id, m), undefined, [m])),
      dist: months.map(m => sumOver((id) => get(cur, id, m), distIds, [m])),
      sub: months.map(m => sumOver((id) => get(cur, id, m), subIds, [m])),
      target: months.map(m => sumOver((id) => get(tgt, id, m), live, [m])),
      prev: months.map(m => sumOver((id) => get(prv, id, m), live, [m])),   // tahun lalu sebulan penuh
    };
    const monthRows = months.map(m => ({
      month_num: m, target: sumOver(id => get(tgt, id, m), live, [m]),
      prev: sumOver(id => prevSame(prv.get(id) || [], m), live, [m]), cur: trend.cur[months.indexOf(m)],
    }));
    const drillGroups = (m: number) => {
      const g = new Map<string, number>();
      scoped.forEach(p => { const k = groupBy === 'region' ? p.region : `${p.nama} · ${p.region}`; g.set(k, (g.get(k) || 0) + get(cur, p.id, m)); });
      return [...g.entries()].map(([label, value]) => ({ label, value })).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
    };

    // tabel per baris peta, dikelompokkan per region
    const perBaris = scoped.map(p => ({
      p, target: months.reduce((a, m) => a + get(tgt, p.id, m), 0), ton: months.reduce((a, m) => a + get(cur, p.id, m), 0),
      prev: months.reduce((a, m) => a + prevSame(prv.get(p.id) || [], m), 0),
    }));
    // sumber tempelan yang belum ada sama sekali untuk tahun ini → baris subdist-nya masih 0
    const has = (src: string) => monthly.some(r => Number(r.tahun) === Y && r.sumber === src);
    const kosong = [
      !has('DO FAS') && { src: 'DO FAS', menu: 'dofas', rows: scoped.filter(p => p.dofas_kode?.length) },
      !has('Sub ERP') && { src: 'Sub ERP', menu: 'erp', rows: scoped.filter(p => p.erp_kode) },
    ].filter((x): x is { src: string; menu: string; rows: Peta[] } => !!x && x.rows.length > 0);
    return { ton, target, prev, hasTarget, months, monthLabel, trend, monthRows, drillGroups, perBaris, untyped, byId, kosong };
  }, [peta, monthly, targets, region, baris, tipe, mFrom, mTo, Y, P, kTgt, kPrev, partial, lastMonth, cutDay, groupBy]);

  /* ---------- Download Excel: Region | Distributor | Month | Type Cement | Target DO | DO P | DO Y ---------- */
  const downloadExcel = () => {
    const scoped = peta.filter(p => (region === 'all' || p.region === region) && (baris === 'all' || String(p.id) === baris));
    const types = tipe === 'all' ? ['STR', 'RJW', 'CWC'] : [tipe];
    const cur = new Map<string, number>(), tgt = new Map<string, number>(), prv = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, x: unknown) => m.set(k, (m.get(k) || 0) + Number(x || 0));
    monthly.forEach(r => { if (Number(r.tahun) === Y) add(cur, `${r.peta_id}|${r.tipe ?? 'Total'}|${r.bulan}`, r.ton); });
    const byKey = new Map<string, Peta[]>();
    scoped.forEach(p => { if (p.target_key) { const k = `${p.target_region}|${p.target_key}`; byKey.set(k, [...(byKey.get(k) || []), p]); } });
    targets.forEach(r => {
      const ps = byKey.get(`${r.region}|${r.distributor}`); if (!ps) return;
      const t = String(r.type_cement).toUpperCase() === 'WC' ? 'CWC' : String(r.type_cement).toUpperCase();
      ps.forEach(p => { add(tgt, `${p.id}|${t}|${r.month_num}`, r[kTgt]); add(prv, `${p.id}|${t}|${r.month_num}`, r[kPrev]); });
    });
    const rows: (string | number | null)[][] = [];
    for (let m = mFrom; m <= mTo; m++) {
      // Sub ERP lama tanpa tipe (kalau masih ada) tampil sebagai tipe "Total"
      const tlist = tipe === 'all' && scoped.some(p => cur.get(`${p.id}|Total|${m}`)) ? [...types, 'Total'] : types;
      tlist.forEach(t => scoped.forEach(p => {
        const k = `${p.id}|${t}|${m}`;
        const c = cur.get(k) || 0, tg = tgt.get(k) || 0, pv = prv.get(k) || 0;
        // baris DO FAS khusus satu tipe (Rosalia) hanya tipenya sendiri; CWC & Total hanya kalau ada angka
        if (p.dofas_tipe && t !== p.dofas_tipe && !c && !tg && !pv) return;
        if ((t === 'CWC' || t === 'Total') && !c && !tg && !pv) return;
        rows.push([p.region, p.nama, MONTH_EN[m], t, p.target_key ? tg : null, p.target_key ? pv : null, p.j073 ? null : c]);
      }));
    }
    const per = mFrom === mTo ? MONTH_EN[mFrom] : `${MONTH_EN[mFrom]}-${MONTH_EN[mTo]}`;
    exportRowsToExcel([{
      name: `Sell Out BNN ${Y}`, header: ['Region', 'Distributor', 'Month', 'Type Cement', `Target DO ${Y}`, `DO ${P}`, `DO ${Y}`],
      rows, widths: [13, 15, 8, 12, 15, 12, 12],
    }], `Sell_Out_BNN_${per}_${Y}.xlsx`, 'sell-out-bnn');
  };

  const growth = growthPct(v.ton, v.prev);
  const monthsLabel = mFrom === mTo ? `${MONTHS_ID[mFrom]} ${Y}` : `${MONTHS_ID[mFrom]}–${MONTHS_ID[mTo]} ${Y}`;
  const scope = [baris !== 'all' ? peta.find(p => String(p.id) === baris)?.nama : region !== 'all' && region, tipe !== 'all' && TIPE_OPTS.find(o => o.value === tipe)!.label].filter(Boolean).join(' · ') || 'Semua';
  const monthOpts = Array.from({ length: lastMonth }, (_, i) => ({ value: i + 1, label: `${MONTHS_ID[i + 1]} ${Y}` }));

  return (
    <>
      <PageHeader title="Sell Out BNN" status={<DataBadge source={['transaksi', 'dofas', 'erp']} />} />

      <FilterBar label="Filter Sell Out BNN" stickyMobile={false} className="max-[880px]:grid max-[880px]:grid-cols-2 max-[880px]:gap-2 max-[880px]:[&_select]:w-full max-[880px]:[&_select]:min-w-0 max-[880px]:[&_select]:text-[12px]">
        <Select label="Dari" value={mFrom} onChange={e => { const x = +e.target.value; setMFrom(x); if (x > mTo) setMTo(x); }} options={monthOpts} />
        <Select label="Sampai" value={mTo} onChange={e => { const x = +e.target.value; setMTo(x); if (x < mFrom) setMFrom(x); }} options={monthOpts} />
        <Select label="Region" value={region} onChange={e => changeRegion(e.target.value)} style={{ minWidth: 130 }}
          options={[{ value: 'all', label: 'Semua Region' }, ...regions.map(r => ({ value: r, label: r }))]} />
        <Select label="Distributor" value={baris} onChange={e => setBaris(e.target.value)} style={{ minWidth: 150 }}
          options={[{ value: 'all', label: 'Semua Distributor' }, ...barisOpts.map(p => ({ value: String(p.id), label: region === 'all' && peta.filter(x => x.nama === p.nama).length > 1 ? `${p.nama} (${p.region})` : p.nama }))]} />
        <Select label="Tipe Semen" value={tipe} onChange={e => setTipe(e.target.value)} style={{ minWidth: 120 }} options={TIPE_OPTS} />
        {filterActive && <button type="button" className="btn btn-sm self-end max-[880px]:col-span-2 max-[880px]:justify-center" onClick={resetFilter}>Reset filter</button>}
        {canDownload('sell-out-bnn') && (
          <div className="ml-auto self-end max-[880px]:col-span-2 max-[880px]:ml-0">
            <button type="button" className="btn max-[880px]:w-full max-[880px]:justify-center" onClick={downloadExcel}
              title="Unduh Excel per distributor/subdist, bulan, dan tipe semen (mengikuti filter)">
              <FileIcon />Download Excel
            </button>
          </div>
        )}
      </FilterBar>

      {v.kosong.map(k => (
        <div key={k.src} className="upl-note is-warn mb-3.5" role="status">
          <span><b>{k.src} {Y} belum ditempel</b>, jadi {k.rows.map(p => p.nama).filter((n, i, a) => a.indexOf(n) === i).join(', ')} masih 0.
            {pageAllowed('kelola-data') && <> <Link to={`/kelola-data?data=sellout&menu=${k.menu}`}>Tempel {k.src}</Link></>}</span>
        </div>
      ))}

      <div className="grid-kpi">
        <Kpi title={`Target ${monthsLabel}`} value={v.hasTarget ? fmtTon(v.target) : '–'} unit={v.hasTarget ? 'ton' : undefined} />
        <Kpi title={`Realisasi ${Y}`} value={fmtTon(v.ton)} unit="ton" delta={v.hasTarget ? <Capaian actual={v.ton} target={v.target} /> : undefined}>
          <div className="text-[12px] text-soft mt-1.5 font-mono">Dist {fmtTon(sumArr(v.trend.dist))} · Subdist {fmtTon(sumArr(v.trend.sub))}</div>
        </Kpi>
        <Kpi title={`Pertumbuhan vs ${P}`} value={<span className={growth == null ? '' : growth >= 0 ? 'text-green' : 'text-red'}>{fmtPct(growth)}</span>} />
        <Kpi title={`Realisasi ${P} Tanggal Sama`} value={v.prev > 0 ? fmtTon(v.prev) : '–'} unit={v.prev > 0 ? 'ton' : undefined} />
      </div>

      <Card className="mt-3.5">
        <div className="card-title">Sell Out Bulanan (Ton) · {scope}</div>
        <div className="legend">
          {v.hasTarget && <span><i style={{ background: COLORS.blueMid }} aria-hidden="true" />Target {Y}</span>}
          <span><i style={{ background: COLORS.accent }} aria-hidden="true" />Distributor {Y}</span>
          <span><i style={{ background: SUB_COLOR }} aria-hidden="true" />Subdist {Y}</span>
          <span><i style={{ background: COLORS.ink, opacity: .35 }} aria-hidden="true" />Realisasi {P}</span>
        </div>
        <ChartBox className="tall" label={chartSRSummary(v.trend.labels, v.trend.cur, `ton sell out ${Y}`)}
          deps={[v.trend.labels.join('|'), v.trend.dist.join('|'), v.trend.sub.join('|'), v.trend.target.join('|'), v.trend.prev.join('|'), v.hasTarget]}
          build={() => ({
            type: 'bar',
            data: { labels: v.trend.labels, datasets: [
              { label: `Target ${Y}`, data: v.trend.target, type: 'line', stack: 'target', borderColor: COLORS.blueMid, backgroundColor: COLORS.blueMid, borderDash: [4, 3], borderWidth: 2, pointRadius: 2, fill: false, tension: .3, order: 1, hidden: !v.hasTarget },
              // realisasi tahun ini = batang bertumpuk distributor + subdist
              { label: `Distributor ${Y}`, data: v.trend.dist, stack: 'cur', backgroundColor: COLORS.accent, maxBarThickness: 26, order: 2 },
              { label: `Subdist ${Y}`, data: v.trend.sub, stack: 'cur', backgroundColor: SUB_COLOR, borderRadius: { topLeft: 3, topRight: 3 }, maxBarThickness: 26, order: 2 },
              { label: `Realisasi ${P}`, data: v.trend.prev, stack: 'prev', backgroundColor: 'rgba(33,30,25,.22)', borderRadius: 3, maxBarThickness: 26, order: 3 },
            ] } as any,
            options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
              scales: { y: { stacked: true, beginAtZero: true, grid: { color: COLORS.line }, ticks: { callback: (x: any) => fmtCompact(x) } }, x: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0 } } },
              plugins: { tooltip: { callbacks: {
                label: (c: any) => ` ${c.dataset.label}: ${fmt(c.parsed.y)} ton`,
                footer: (items: any[]) => (items.length ? `Total ${Y}: ${fmt(v.trend.cur[items[0].dataIndex])} ton` : ''),
              } } } },
          })} />
        {v.untyped > 0 && <p className="text-faint text-[12px] mt-2">{fmtTon(v.untyped)} ton Sub ERP masih tersimpan tanpa tipe (ditempel versi total), jadi tidak ikut saat filter tipe. Tempel ulang Sub ERP per tipe untuk memisahkannya.</p>}
      </Card>

      <h2 className="section-title">Rincian per Bulan · Sell Out (Ton)</h2>
      <GrowthTable caption={`Rincian sell out per bulan: target, realisasi ${P} dan ${Y}, pertumbuhan, capaian`}
        rows={v.monthRows} Y={Y} P={P} hasTarget={v.hasTarget} labels={{ target: 'Target', value: 'Sell Out', capaian: 'Capaian' }} monthLabel={v.monthLabel}
        drill={{ enabled: true, groupsFor: v.drillGroups,
          heading: m => `Komposisi Sell Out ${v.monthLabel(m)} ${Y} · per ${groupBy === 'region' ? 'Region' : 'Distributor'}`,
          title: m => `Lihat komposisi sell out ${MONTHS_ID[m]}` }} />

      <h2 className="section-title">Per Distributor · {monthsLabel} (Ton)</h2>
      <TableWrap>
        <table>
          <caption className="sr-only">Sell out per distributor dan subdist</caption>
          <thead><tr>
            <th>Region</th><th>Distributor</th><th>Sumber</th>
            <th className="num">Target</th><th className="num">{P}</th><th className="num">{Y}</th><th className="num">Growth</th><th>Capaian</th>
          </tr></thead>
          <tbody>
            {regionGroups(v.perBaris).map(([reg, items]) => {
              const live = items.filter(x => !x.p.j073);
              const t = live.reduce((a, x) => a + x.target, 0), c = items.reduce((a, x) => a + x.ton, 0), q = live.reduce((a, x) => a + x.prev, 0);
              return [
                ...items.map(x => {
                  const g = growthPct(x.ton, x.prev);
                  return (
                    <tr key={x.p.id}>
                      <td className="text-soft whitespace-nowrap">{x.p.region}</td>
                      <td className="font-semibold whitespace-nowrap">{x.p.nama}{isSubdist(x.p) && <span className="sob-sub">Subdist</span>}</td>
                      <td className="text-faint text-[12px] max-w-[300px]">{x.p.sumber}</td>
                      <td className="num font-mono">{x.target ? fmtTon(x.target) : '–'}</td>
                      <td className="num font-mono">{x.prev ? fmtTon(x.prev) : '–'}</td>
                      <td className="num font-mono font-semibold">{x.p.j073 ? <span className="text-faint font-normal" title="J073 (tabel warehouse) belum tersedia">belum ada</span> : fmtTon(x.ton)}</td>
                      <td className={cx('num font-mono', g == null || x.p.j073 ? 'text-faint' : g >= 0 ? 'text-green' : 'text-red')}>{x.p.j073 ? '–' : fmtPct(g)}</td>
                      <td>{x.p.j073 ? <span className="text-faint">–</span> : <Capaian actual={x.ton} target={x.target} />}</td>
                    </tr>
                  );
                }),
                items.length > 1 && live.length > 0 && (
                  <tr key={reg + '-sub'} className="bg-surface2/70">
                    <td colSpan={3} className="font-semibold">Subtotal {reg}</td>
                    <td className="num font-mono font-semibold">{t ? fmtTon(t) : '–'}</td>
                    <td className="num font-mono font-semibold">{q ? fmtTon(q) : '–'}</td>
                    <td className="num font-mono font-semibold">{fmtTon(c)}</td>
                    <td className={cx('num font-mono font-semibold', growthPct(c, q) == null ? 'text-faint' : growthPct(c, q)! >= 0 ? 'text-green' : 'text-red')}>{fmtPct(growthPct(c, q))}</td>
                    <td><Capaian actual={c} target={t} /></td>
                  </tr>
                ),
              ];
            })}
          </tbody>
          <tfoot>
            {totalRows(v.perBaris).map(r => {
              const g = growthPct(r.ton, r.prev);
              return (
                <tr key={r.label} className={cx('sob-total', r.grand && 'sob-grand')}>
                  <td colSpan={3} className="font-semibold">{r.label}</td>
                  <td className="num font-mono font-semibold">{r.target ? fmtTon(r.target) : '–'}</td>
                  <td className="num font-mono font-semibold">{r.prev ? fmtTon(r.prev) : '–'}</td>
                  <td className="num font-mono font-semibold">{fmtTon(r.ton)}</td>
                  <td className={cx('num font-mono font-semibold', g == null ? 'text-faint' : g >= 0 ? 'text-green' : 'text-red')}>{fmtPct(g)}</td>
                  <td><Capaian actual={r.ton} target={r.target} /></td>
                </tr>
              );
            })}
          </tfoot>
        </table>
      </TableWrap>
    </>
  );
}

/** Baris total di bawah tabel: Distributor, Subdist, dan Sell Out BNN (J073 tidak ikut target / tahun lalu). */
function totalRows(rows: { p: Peta; target: number; ton: number; prev: number }[]) {
  const agg = (label: string, xs: typeof rows, grand = false) => {
    const live = xs.filter(x => !x.p.j073);
    return { label, grand, target: live.reduce((a, x) => a + x.target, 0), prev: live.reduce((a, x) => a + x.prev, 0), ton: xs.reduce((a, x) => a + x.ton, 0), n: xs.length };
  };
  const dist = agg('Total Distributor', rows.filter(x => !isSubdist(x.p))), sub = agg('Total Subdist', rows.filter(x => isSubdist(x.p)));
  return dist.n && sub.n ? [dist, sub, agg('Total Sell Out BNN', rows, true)] : [agg('Total Sell Out BNN', rows, true)];
}

function regionGroups<T extends { p: Peta }>(rows: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  rows.forEach(r => { const a = m.get(r.p.region) || []; a.push(r); m.set(r.p.region, a); });
  return [...m.entries()];
}
