import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DataSource, sellOutTargetsFor } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, MONTHS_ID, chartSRSummary, fmt, fmtCompact } from '../lib/format';
import { daysInMonth } from '../lib/dates';
import type { Row } from '../lib/types';
import { DataBadge, todayWIB } from '../components/DataStatus';
import { GrowthTable } from '../components/GrowthTable';
import { Capaian, Card, ChartBox, ErrorBox, FileIcon, FilterBar, Kpi, PageHeader, PageSkeleton, Select } from '../components/ui';
import { exportRowsToExcel } from '../lib/xlsx';
import { isSubdist, type Peta } from '../lib/ringkasan';

/* ============================================================================
   Sell Out BNN: per baris distributor/subdist dari peta sementrack.sellout_bnn_peta
   (J028 transaksi, DO FAS, Sub ERP, J073 untuk INSA & PKB per gudang), per bulan.
   Target & realisasi tahun lalu dari tabel target per tahun (v_target_sell_out, diisi lewat Kelola Data → Target).
   Toko aktif dari transaksi J028 / J073 baris distributor saja (v_sellout_bnn_ta): subdist tidak dihitung,
   termasuk customer subdist di transaksi distributor induk (PGS, MGSS, MAJU di JMB, dst.).
   Bulan berjalan: target = sebulan penuh; tahun lalu dibandingkan pada tanggal yang sama
   (diperkirakan dari total bulan dibagi jumlah hari).
============================================================================ */

const SUB_COLOR = COLORS.sub;
const MONTH_EN = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TIPE_OPTS = [
  { value: 'all', label: 'Semua Tipe' }, { value: 'STR', label: 'STR' }, { value: 'RJW', label: 'RJW' }, { value: 'CWC', label: 'CWC (putih)' },
];
const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 && t % 1 ? 1 : 0);
const sumArr = (a: number[]) => a.reduce((x, y) => x + y, 0);
const growthPct = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev * 100 : null);
const fmtPct = (p: number | null) => (p == null ? '–' : (p > 0 ? '+' : '') + p.toFixed(1) + '%');
const tgtType = (t: string) => (t === 'CWC' ? 'WC' : t);


export default function SellOutBnn() {
  useDocTitle('Sell Out BNN');
  const load = useAsync(async () => {
    const [peta, monthly, targets, status, ta] = await Promise.all([
      DataSource.selloutPeta(), DataSource.selloutMonthly(), DataSource.targetSellOut().catch(() => [] as Row[]), DataSource.dataStatus().catch(() => [] as Row[]),
      DataSource.selloutTa().catch(() => null),
    ]);
    // Tahun halaman = tahun terakhir yang punya sell out; target tahun itu + realisasi pembanding tahun sebelumnya
    const Y = monthly.reduce((a, r) => (Number(r.ton) > 0 ? Math.max(a, Number(r.tahun)) : a), 0) || Number(todayWIB().slice(0, 4));
    return { peta: peta as unknown as Peta[], monthly, targets: sellOutTargetsFor(targets, Y), status, ta, Y };
  }, []);
  if (load.error) return <ErrorBox error={load.error} />;
  if (!load.data) return <PageSkeleton />;
  const { peta, monthly, targets, status, ta, Y } = load.data;
  if (!peta.length) return <EmptyState />;
  return <Body peta={peta} monthly={monthly} targets={targets} status={status} ta={ta} Y={Y} />;
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

function Body({ peta, monthly, targets, status, ta, Y }: { peta: Peta[]; monthly: Row[]; targets: Row[]; status: Row[]; ta: Row[] | null; Y: number }) {
  const { pageAllowed, canDownload } = useAuth();
  const P = Y - 1;
  const kTgt = `target_do_${Y}`, kPrev = `do_${P}`, kTgtTa = `target_ta_${Y}`;

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

  const j073Ready = useMemo(() => monthly.some(r => Number(r.tahun) === Y && r.sumber === 'J073'), [monthly, Y]);
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
    const tgt = new Map<number, number[]>(), prv = new Map<number, number[]>(), tgtTa = new Map<number, number[]>();
    scoped.forEach(p => {
      if (!p.target_key) return;
      const t = new Array(13).fill(0), q = new Array(13).fill(0), tt = new Array(13).fill(0);
      targets.forEach(r => {
        if (r.region !== p.target_region || r.distributor !== p.target_key) return;
        const m = Number(r.month_num); if (!(m >= 1 && m <= 12)) return;
        tt[m] += Number(r[kTgtTa] || 0);   // target toko aktif hanya ada di level semua tipe
        if (tipe !== 'all' && r.type_cement !== tgtType(tipe)) return;
        t[m] += Number(r[kTgt] || 0); q[m] += Number(r[kPrev] || 0);
      });
      tgt.set(p.id, t); prv.set(p.id, q); tgtTa.set(p.id, tt);
    });

    const months = Array.from({ length: mTo - mFrom + 1 }, (_, i) => mFrom + i);
    const isPartial = (m: number) => partial && m === lastMonth;
    const prevSame = (q: number[], m: number) => { const x = q[m] || 0; return isPartial(m) ? x * cutDay / daysInMonth(P, m) : x; };
    const get = (map: Map<number, number[]>, id: number, m: number) => map.get(id)?.[m] || 0;
    const sumOver = (fn: (id: number, m: number) => number, idList = scoped.map(p => p.id), ms = months) =>
      idList.reduce((a, id) => a + ms.reduce((b, m) => b + fn(id, m), 0), 0);

    // J073 (INSA, PKB) belum diupload untuk tahun ini: target & tahun lalunya tidak ikut dibandingkan
    const live = scoped.filter(p => !p.j073 || j073Ready).map(p => p.id);
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

    // toko aktif: hanya baris distributor (subdist tidak dihitung); J073 ikut kalau sudah diupload
    const taKey = tipe === 'all' ? 'ALL' : tipe;
    const taIds = scoped.filter(p => !isSubdist(p) && (!p.j073 || j073Ready)).map(p => p.id);
    const taSet = new Set(taIds);
    const taCur = new Map<number, number[]>(), taPrev = new Map<number, number[]>(), taPrevSd = new Map<number, number[]>();
    (ta || []).forEach(r => {
      const id = Number(r.peta_id), y = Number(r.tahun), m = Number(r.bulan);
      if (!taSet.has(id) || r.tipe !== taKey || !(m >= 1 && m <= 12)) return;
      const put = (map: Map<number, number[]>, x: unknown) => { const a = map.get(id) || new Array(13).fill(0); a[m] += Number(x || 0); map.set(id, a); };
      if (y === Y) put(taCur, r.ta);
      else if (y === P) { put(taPrev, r.ta); put(taPrevSd, r.ta_sd); }
    });
    const taPrevSame = (id: number, m: number) => (isPartial(m) ? get(taPrevSd, id, m) : get(taPrev, id, m));
    const taHasTarget = tipe === 'all' && sumOver((id, m) => get(tgtTa, id, m), taIds) > 0;
    const taTrend = {
      cur: months.map(m => sumOver(id => get(taCur, id, m), taIds, [m])),
      target: months.map(m => (taHasTarget ? sumOver(id => get(tgtTa, id, m), taIds, [m]) : 0)),
      prev: months.map(m => sumOver(id => get(taPrev, id, m), taIds, [m])),   // tahun lalu sebulan penuh
    };
    const taRows = months.map((m, i) => ({
      month_num: m, target: taTrend.target[i], prev: sumOver(id => taPrevSame(id, m), taIds, [m]), cur: taTrend.cur[i],
    }));
    const taTotal = { cur: sumArr(taTrend.cur), target: sumArr(taTrend.target), prev: sumArr(taRows.map(r => r.prev)) };
    const taDrill = (m: number) => {
      const g = new Map<string, number>();
      scoped.forEach(p => { if (!taSet.has(p.id)) return; const k = groupBy === 'region' ? p.region : `${p.nama} · ${p.region}`; g.set(k, (g.get(k) || 0) + get(taCur, p.id, m)); });
      return [...g.entries()].map(([label, value]) => ({ label, value })).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
    };
    const subdistNames = [...new Set(scoped.filter(isSubdist).map(p => p.nama))];
    // sumber tempelan yang belum ada sama sekali untuk tahun ini → baris subdist-nya masih 0
    const has = (src: string) => monthly.some(r => Number(r.tahun) === Y && r.sumber === src);
    const kosong = [
      !has('DO FAS') && { src: 'DO FAS', verb: 'ditempel', act: 'Tempel DO FAS', menu: 'dofas', rows: scoped.filter(p => p.dofas_kode?.length) },
      !has('Sub ERP') && { src: 'Sub ERP', verb: 'ditempel', act: 'Tempel Sub ERP', menu: 'erp', rows: scoped.filter(p => p.erp_kode) },
      !j073Ready && { src: 'J073', verb: 'diupload', act: 'Upload J073', menu: 'j073', rows: scoped.filter(p => p.j073) },
    ].filter((x): x is { src: string; verb: string; act: string; menu: string; rows: Peta[] } => !!x && x.rows.length > 0);
    return { ton, target, prev, hasTarget, months, monthLabel, trend, monthRows, drillGroups, untyped, byId, kosong,
      taTrend, taRows, taTotal, taHasTarget, taDrill, taIds, subdistNames };
  }, [peta, monthly, targets, ta, region, baris, tipe, mFrom, mTo, Y, P, kTgt, kPrev, kTgtTa, partial, lastMonth, cutDay, groupBy, j073Ready]);

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
        rows.push([p.region, p.nama, MONTH_EN[m], t, p.target_key ? tg : null, p.target_key ? pv : null, p.j073 && !j073Ready ? null : c]);
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
      <PageHeader title="Sell Out BNN" status={<DataBadge source={['transaksi', 'dofas', 'erp', 'j073']} />} />

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
          <span><b>{k.src} {Y} belum {k.verb}</b>, jadi {k.rows.map(p => p.nama).filter((n, i, a) => a.indexOf(n) === i).join(', ')} masih 0.
            {pageAllowed('kelola-data') && <> <Link to={`/kelola-data?data=sellout&menu=${k.menu}`}>{k.act}</Link></>}</span>
        </div>
      ))}

      <div className="grid-kpi">
        <Kpi title={`Target ${monthsLabel}`} value={v.hasTarget ? fmtTon(v.target) : '–'} unit={v.hasTarget ? 'ton' : undefined} />
        <Kpi title={`Realisasi ${Y}`} value={fmtTon(v.ton)} unit="ton" delta={v.hasTarget ? <Capaian actual={v.ton} target={v.target} /> : undefined}>
          <div className="text-[12px] text-soft mt-1.5 font-mono">Dist {fmtTon(sumArr(v.trend.dist))} · Subdist {fmtTon(sumArr(v.trend.sub))}</div>
        </Kpi>
        <Kpi title={`Pertumbuhan vs ${P}`} value={<span className={growth == null ? '' : growth >= 0 ? 'text-green' : 'text-red'}>{fmtPct(growth)}</span>}
          delta={v.prev > 0 ? `${P} tanggal sama: ${fmtTon(v.prev)} ton` : undefined} />
        <Kpi title={`Toko Aktif ${Y}`} value={ta && v.taIds.length ? fmt(v.taTotal.cur) : '–'}
          delta={!ta || !v.taIds.length ? undefined : v.taHasTarget ? <Capaian actual={v.taTotal.cur} target={v.taTotal.target} /> : tipe !== 'all' ? `${tipe} · tanpa target` : undefined}>
          <div className="text-[12px] text-soft mt-1.5">{!v.taIds.length ? 'Subdist tidak dihitung toko aktif' : `${v.months.length > 1 ? `Jumlah ${v.months.length} bulan · ` : ''}distributor saja, subdist tidak dihitung`}</div>
        </Kpi>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-3.5 max-[1000px]:grid-cols-1">
        <Card title={`Sell Out per Bulan (Ton) · ${scope}`}>
          <div className="legend">
            {v.hasTarget && <span><i style={{ background: COLORS.target, height: 2 }} aria-hidden="true" />Target {Y}</span>}
            <span><i style={{ background: COLORS.accent }} aria-hidden="true" />Distributor {Y}</span>
            <span><i style={{ background: SUB_COLOR }} aria-hidden="true" />Subdist {Y}</span>
            <span><i style={{ background: COLORS.prev }} aria-hidden="true" />Realisasi {P}</span>
          </div>
          <ChartBox className="tall" label={chartSRSummary(v.trend.labels, v.trend.cur, `ton sell out ${Y}`)}
            deps={[v.trend.labels.join('|'), v.trend.dist.join('|'), v.trend.sub.join('|'), v.trend.target.join('|'), v.trend.prev.join('|'), v.hasTarget]}
            build={() => ({
              type: 'bar',
              data: { labels: v.trend.labels, datasets: [
                { label: `Target ${Y}`, data: v.trend.target, type: 'line', stack: 'target', borderColor: COLORS.target, backgroundColor: COLORS.target, borderDash: [4, 3], borderWidth: 1.5, pointRadius: 2, fill: false, tension: .3, order: 1, hidden: !v.hasTarget },
                // realisasi tahun ini = batang bertumpuk distributor + subdist
                { label: `Distributor ${Y}`, data: v.trend.dist, stack: 'cur', backgroundColor: COLORS.accent, maxBarThickness: 26, order: 2 },
                { label: `Subdist ${Y}`, data: v.trend.sub, stack: 'cur', backgroundColor: SUB_COLOR, maxBarThickness: 26, order: 2 },
                { label: `Realisasi ${P}`, data: v.trend.prev, stack: 'prev', backgroundColor: COLORS.prev, maxBarThickness: 26, order: 3 },
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

        <Card title={`Toko Aktif per Bulan · ${scope}`}>
          <div className="legend">
            {v.taHasTarget && <span><i style={{ background: COLORS.target, height: 2 }} aria-hidden="true" />Target {Y}</span>}
            <span><i style={{ background: COLORS.accent }} aria-hidden="true" />Realisasi {Y}{tipe !== 'all' ? ` (${tipe}, tanpa target)` : ''}</span>
            <span><i style={{ background: COLORS.prev }} aria-hidden="true" />Realisasi {P}</span>
          </div>
          {!ta ? <p className="text-soft text-[13px] py-10 text-center">Data toko aktif belum tersedia. Jalankan ulang docs/sql/sell_out_bnn.sql.</p>
            : !v.taIds.length ? <p className="text-soft text-[13px] py-10 text-center">{scope} adalah subdist: tidak dihitung toko aktif.</p>
            : <ChartBox className="tall" label={chartSRSummary(v.trend.labels, v.taTrend.cur, `toko aktif ${Y}`)}
                deps={[v.trend.labels.join('|'), v.taTrend.cur.join('|'), v.taTrend.target.join('|'), v.taTrend.prev.join('|'), v.taHasTarget]}
                build={() => ({
                  type: 'bar',
                  data: { labels: v.trend.labels, datasets: [
                    { label: `Target ${Y}`, data: v.taTrend.target, type: 'line', borderColor: COLORS.target, backgroundColor: COLORS.target, borderDash: [4, 3], borderWidth: 1.5, pointRadius: 2, fill: false, tension: .3, order: 1, hidden: !v.taHasTarget },
                    { label: `Realisasi ${Y}`, data: v.taTrend.cur, backgroundColor: COLORS.accent, maxBarThickness: 26, order: 2 },
                    { label: `Realisasi ${P}`, data: v.taTrend.prev, backgroundColor: COLORS.prev, maxBarThickness: 26, order: 3 },
                  ] } as any,
                  options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                    scales: { y: { beginAtZero: true, grid: { color: COLORS.line }, ticks: { callback: (x: any) => fmtCompact(x) } }, x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0 } } },
                    plugins: { tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${fmt(c.parsed.y)} toko` } } } },
                })} />}
          {ta && v.taIds.length > 0 && v.subdistNames.length > 0 && (
            <p className="text-faint text-[12px] mt-2">Subdist ({v.subdistNames.join(', ')}) tidak dihitung, termasuk saat tercatat sebagai customer di transaksi distributor induk.</p>
          )}
        </Card>
      </div>

      <h2 className="section-title">Rincian per Bulan · Sell Out (Ton)</h2>
      <GrowthTable caption={`Rincian sell out per bulan: target, realisasi ${P} dan ${Y}, pertumbuhan, capaian`}
        rows={v.monthRows} Y={Y} P={P} hasTarget={v.hasTarget} labels={{ target: 'Target', value: 'Sell Out', capaian: 'Capaian' }} monthLabel={v.monthLabel}
        drill={{ enabled: true, groupsFor: v.drillGroups,
          heading: m => `Komposisi Sell Out ${v.monthLabel(m)} ${Y} · per ${groupBy === 'region' ? 'Region' : 'Distributor'}`,
          title: m => `Lihat komposisi sell out ${MONTHS_ID[m]}` }} />

      {ta && v.taIds.length > 0 && (
        <>
          <h2 className="section-title">Rincian per Bulan · Toko Aktif</h2>
          {tipe !== 'all' && <p className="text-xs text-faint -mt-2 mb-3">Tipe {tipe}: toko dengan pembelian {tipe} minimal Rp200.000 sebulan, tanpa target (target TA hanya ada di level semua tipe).</p>}
          <GrowthTable caption={`Rincian toko aktif per bulan: target, realisasi ${P} dan ${Y}, pertumbuhan, capaian`}
            rows={v.taRows} Y={Y} P={P} hasTarget={v.taHasTarget} labels={{ target: 'Target TA', value: 'TA', capaian: 'Capaian TA' }} monthLabel={v.monthLabel}
            drill={{ enabled: true, groupsFor: v.taDrill, unit: 'toko',
              heading: m => `Komposisi Toko Aktif ${v.monthLabel(m)} ${Y} · per ${groupBy === 'region' ? 'Region' : 'Distributor'}`,
              title: m => `Lihat komposisi toko aktif ${MONTHS_ID[m]}` }} />
        </>
      )}
    </>
  );
}
