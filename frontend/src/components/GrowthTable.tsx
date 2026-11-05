import { Fragment, useEffect, useMemo, useState } from 'react';
import { MONTHS_ID, fmt, pct } from '../lib/format';
import { Capaian, TableWrap, Th, cx } from './ui';
import { MonthDetailRow, MonthToggle, NO_GROWTH } from './RegionalDetail';

/** Satu baris bulan: target, realisasi tahun lalu (prev) dan tahun berjalan (cur). */
export interface GrowthInput { month_num: number; target: number; prev: number; cur: number }

interface GrowthRow extends GrowthInput {
  growth: number;      // cur - prev
  growthPct: number;   // growth / prev
  cumGrowth: number;   // akumulasi growth Jan s.d. bulan ini
  cumPct: number;      // akumulasi growth / akumulasi prev
  capaian: number;
}

/**
 * Hitung kolom growth. "Up to" selalu diakumulasi berurutan Jan -> Des (tidak terpengaruh urutan sort tabel):
 *   Growth Up To   = jumlah (cur - prev) sejak Januari
 *   % Growth Up To = Growth Up To / jumlah prev sejak Januari
 */
export function buildGrowthRows(input: GrowthInput[]): GrowthRow[] {
  let cumGrowth = 0, cumPrev = 0;
  return [...input].sort((a, b) => a.month_num - b.month_num).map(r => {
    const growth = r.cur - r.prev;
    cumGrowth += growth; cumPrev += r.prev;
    return {
      ...r, growth,
      growthPct: r.prev > 0 ? growth / r.prev * 100 : NO_GROWTH,
      cumGrowth,
      cumPct: cumPrev > 0 ? cumGrowth / cumPrev * 100 : NO_GROWTH,
      capaian: pct(r.cur, r.target) ?? -1,
    };
  });
}

/** Selisih: negatif dalam kurung (gaya akuntansi), positif apa adanya. */
const fmtDiff = (v: number) => (v < 0 ? `(${fmt(-v)})` : fmt(v));
const fmtPct = (v: number, d: number) => {
  if (v === NO_GROWTH) return '–';
  const t = v.toFixed(d);
  return (Number(t) === 0 ? (0).toFixed(d) : t) + '%';   // hindari "-0%"
};
const tone = (v: number) => (v === NO_GROWTH ? 'text-faint' : v >= 0 ? 'text-green' : 'text-red');

type SortKey = keyof GrowthRow;

export interface GrowthDrill {
  enabled: boolean;
  groupsFor: (month: number) => { label: string; value: number }[];
  heading: (month: number) => string;
  title: (month: number) => string;
  unit?: string;
}

export function GrowthTable({ caption, rows: input, Y, P, labels, hasTarget = true, drill, monthLabel = m => MONTHS_ID[m] }: {
  caption: string;
  rows: GrowthInput[];
  Y: number; P: number;
  /** Nama metrik di header, mis. { target: 'Target DO', value: 'DO', capaian: 'Capaian DO' } */
  labels: { target: string; value: string; capaian: string };
  hasTarget?: boolean;
  drill?: GrowthDrill;
  /** Label bulan, mis. "Nov (1–3)" untuk bulan yang belum penuh. */
  monthLabel?: (month: number) => string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('month_num');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [expanded, setExpanded] = useState<number | null>(null);

  const rows = useMemo(() => {
    const list = buildGrowthRows(input);
    list.sort((a, b) => sortDir * ((a[sortKey] - b[sortKey]) || (a.month_num - b.month_num)));
    return list;
  }, [input, sortKey, sortDir]);

  const canDrill = !!drill?.enabled;
  useEffect(() => {
    if (expanded != null && (!canDrill || !rows.some(r => r.month_num === expanded))) setExpanded(null);
  }, [canDrill, rows, expanded]);

  // drill dibuat ulang tiap render induk; hitung ulang komposisi hanya saat bulan dibuka atau data (rows) berubah.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => (expanded != null && drill ? drill.groupsFor(expanded) : []), [expanded, input]);

  const sortBy = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => (d === 1 ? -1 : 1)); else { setSortKey(k); setSortDir(-1); }
  };
  const th = (k: SortKey, label: string, num = true) => (
    <Th sortable num={num} role="button" onSort={() => sortBy(k)}
      ariaSort={k === sortKey ? (sortDir === 1 ? 'ascending' : 'descending') : undefined}>{label}</Th>
  );
  const yy = (y: number) => String(y).slice(-2);
  const COLS = 9;

  return (
    <TableWrap>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>
          {th('month_num', 'Bulan', false)}
          {th('target', labels.target)}
          {th('prev', `${labels.value} ${P}`)}
          {th('cur', `${labels.value} ${Y}`)}
          {th('growth', `Growth ${yy(P)} vs ${yy(Y)}`)}
          {th('growthPct', 'Growth Monthly')}
          {th('cumGrowth', 'Growth Up To')}
          {th('cumPct', '% Growth Up To')}
          {th('capaian', labels.capaian, false)}
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <Fragment key={r.month_num}>
              <tr>
                <td>{canDrill
                  ? <MonthToggle month={r.month_num} expanded={expanded === r.month_num} title={drill!.title(r.month_num)}
                      onToggle={() => setExpanded(expanded === r.month_num ? null : r.month_num)} label={monthLabel(r.month_num)} />
                  : <strong>{monthLabel(r.month_num)}</strong>}</td>
                <td className={cx('num font-mono', !hasTarget && 'text-faint')}>{hasTarget ? fmt(r.target) : '–'}</td>
                <td className="num font-mono">{fmt(r.prev)}</td>
                <td className="num font-mono font-semibold">{fmt(r.cur)}</td>
                <td className={cx('num font-mono', tone(r.growth))}>{fmtDiff(r.growth)}</td>
                <td className={cx('num font-mono', tone(r.growthPct))}>{fmtPct(r.growthPct, 0)}</td>
                <td className={cx('num font-mono', tone(r.cumGrowth))}>{fmtDiff(r.cumGrowth)}</td>
                <td className={cx('num font-mono', tone(r.cumPct))}>{fmtPct(r.cumPct, 1)}</td>
                <td>{hasTarget ? <Capaian actual={r.cur} target={r.target} /> : <span className="font-mono text-faint">–</span>}</td>
              </tr>
              {canDrill && expanded === r.month_num && (
                <MonthDetailRow colSpan={COLS} groups={groups} heading={drill!.heading(r.month_num)} unit={drill!.unit} />
              )}
            </Fragment>
          ))}
          {rows.length === 0 && <tr><td colSpan={COLS} className="!text-center !text-faint !p-6">Tidak ada data untuk filter ini.</td></tr>}
        </tbody>
      </table>
    </TableWrap>
  );
}
