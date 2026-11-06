/* ============================================================================
   Status kesegaran data: satu sumber kebenaran (view sementrack.v_data_status)
   untuk badge "Data s.d. …" di tiap halaman dan panel Status Data di sidebar.

   Aturan warna:
   - harian  : hari kerja (Senin–Sabtu) yang belum masuk, dihitung s.d. kemarin.
               0 = terkini (hijau), 1–2 = tertinggal (kuning), ≥3 = perlu dicek (merah)
   - bulanan : bulan closing yang belum masuk, dihitung s.d. bulan lalu
               (sebelum tanggal 10, closing bulan lalu belum dituntut).
               0 = terkini, 1 = tertinggal, ≥2 = perlu dicek
============================================================================ */
import { useEffect, useId, useRef, useState } from 'react';
import { DataSource } from '../lib/data';
import { useAuth } from '../lib/auth';
import { addDays, parseISO } from '../lib/dates';
import { MONTHS_ID } from '../lib/format';
import type { Row } from '../lib/types';
import { cx } from './ui';

export type DataSourceId = 'transaksi' | 'sellin' | 'sellout_bulanan' | 'sellin_bulanan' | 'dofas' | 'erp' | 'j073';
export type FreshLevel = 'good' | 'warn' | 'bad' | 'none';

export interface Freshness {
  level: FreshLevel;
  /** "4 Nov 2026" atau "Okt 2026" (bulanan) */
  sampai: string | null;
  /** "Terkini", "Tertinggal 2 hari kerja", … */
  keadaan: string;
  /** penjelasan singkat apa yang diharapkan */
  harapan: string;
}

const CLOSING_GRACE_DAY = 10;

/** Tanggal hari ini menurut WIB (data distributor dicatat dalam WIB). */
export const todayWIB = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

const fmtDay = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

/** Jumlah hari kerja (Senin–Sabtu) setelah `from` sampai dengan `to`. */
export function workdaysBetween(from: string, to: string) {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (new Date(d + 'T00:00:00').getDay() !== 0) n++;
  return n;
}

export function freshnessOf(row: Row | null | undefined, today = todayWIB()): Freshness {
  const sampai = row?.data_sampai ? String(row.data_sampai).slice(0, 10) : null;
  const harian = row?.frekuensi !== 'bulanan';
  if (!sampai) return { level: 'none', sampai: null, keadaan: 'Belum ada data', harapan: harian ? 'Diperbarui setiap hari kerja.' : 'Diperbarui setelah closing bulanan.' };
  if (harian) {
    const lag = workdaysBetween(sampai, addDays(today, -1));
    return {
      level: lag === 0 ? 'good' : lag <= 2 ? 'warn' : 'bad',
      sampai: fmtDay(sampai),
      keadaan: lag === 0 ? 'Terkini' : `Tertinggal ${lag} hari kerja`,
      harapan: 'Diharapkan berisi data s.d. hari kerja kemarin.',
    };
  }
  const s = parseISO(sampai), t = parseISO(today);
  const expected = t.y * 12 + t.m - (t.d >= CLOSING_GRACE_DAY ? 1 : 2);   // bulan closing terakhir yang sudah wajar ada
  const lag = Math.max(0, expected - (s.y * 12 + s.m));
  return {
    level: lag === 0 ? 'good' : lag === 1 ? 'warn' : 'bad',
    sampai: `${MONTHS_ID[s.m]} ${s.y}`,
    keadaan: lag === 0 ? 'Terkini' : `Tertinggal ${lag} bulan`,
    harapan: `Diharapkan berisi closing s.d. bulan lalu (mulai tanggal ${CLOSING_GRACE_DAY}).`,
  };
}

const fmtUpdated = (v: unknown) => {
  if (!v) return null;
  const s = String(v);
  const d = new Date(s.length <= 16 ? s + ':00' : s);
  if (isNaN(+d)) return s;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) + (s.length > 10 ? ', ' + s.slice(11, 16) + ' WIB' : '');
};

/** Semua baris status, dimuat sekali per sesi (dibersihkan lewat forgetData('dataStatus')). */
export function useDataStatus() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => DataSource.dataStatus().then(r => { if (alive) { setRows(r); setFailed(false); } }).catch(() => { if (alive) setFailed(true); });
    load();
    window.addEventListener('data-status-changed', load);
    return () => { alive = false; window.removeEventListener('data-status-changed', load); };
  }, []);
  return { rows, failed };
}
/** Panggil setelah data diubah dari Kelola Data supaya badge & sidebar ikut segar. */
export const notifyDataStatusChanged = () => window.dispatchEvent(new Event('data-status-changed'));

/** Halaman yang memakai tiap sumber: panel sidebar hanya menampilkan sumber yang halamannya boleh dibuka. */
const SOURCE_PAGES: Record<string, string[]> = {
  transaksi: ['beranda', 'rekap-harian', 'tim-sales', 'daftar-toko', 'peta-toko', 'sell-out-bnn', 'kelola-data'],
  sellin: ['sell-in-bnn', 'kelola-data'],
  sellout_bulanan: ['performa-daerah'],
  dofas: ['sell-out-bnn', 'kelola-data'],
  erp: ['sell-out-bnn', 'kelola-data'],
  j073: ['sell-out-bnn', 'kelola-data'],
  sellin_bulanan: [],   // halaman Sell In dihapus; target & 2025 di Sell In BNN tidak bergantung pada closing terbaru
};
const SHORT_NAME: Record<string, string> = { transaksi: 'Transaksi', sellin: 'Sell In BNN', sellout_bulanan: 'Sell Out bulanan', sellin_bulanan: 'Sell In bulanan', dofas: 'DO FAS', erp: 'Sub ERP', j073: 'J073' };
const LEVEL_LABEL: Record<FreshLevel, string> = { good: 'Terkini', warn: 'Tertinggal', bad: 'Perlu dicek', none: 'Kosong' };

function Detail({ row, f }: { row: Row; f: Freshness }) {
  const upd = fmtUpdated(row.diperbarui);
  return (
    <dl className="ds-detail">
      <div><dt>Data s.d.</dt><dd>{f.sampai || '–'}</dd></div>
      <div><dt>Keadaan</dt><dd className={cx('ds-state', `is-${f.level}`)}>{f.keadaan}</dd></div>
      <div><dt>Diperbarui</dt><dd>{upd || <span className="text-faint">tidak tercatat</span>}</dd></div>
      {row.keterangan && <div><dt>Keterangan</dt><dd>{String(row.keterangan)}</dd></div>}
      <p className="ds-note">{f.harapan}</p>
    </dl>
  );
}

const LEVEL_RANK: Record<FreshLevel, number> = { good: 0, warn: 1, bad: 2, none: 3 };

/**
 * Badge kesegaran data di header halaman. Klik untuk detail (kapan diperbarui, oleh siapa).
 * Beberapa sumber (mis. Sell Out BNN = transaksi + DO FAS + Sub ERP): warna = sumber yang paling tertinggal,
 * tanggal = data s.d. paling awal, detail per sumber di popover.
 */
export function DataBadge({ source, dark }: { source: DataSourceId | DataSourceId[]; dark?: boolean }) {
  const { rows, failed } = useDataStatus();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (failed) return null;
  if (!rows) return <span className={cx('ds-badge is-loading', dark && 'is-dark')} aria-hidden="true"><i className="ds-dot" />Memuat status…</span>;
  const ids = Array.isArray(source) ? source : [source];
  const items = ids.map(s => rows.find(r => r.sumber === s)).filter((r): r is Row => !!r).map(row => ({ row, f: freshnessOf(row) }));
  if (!items.length) return null;
  const worst = items.reduce((a, b) => (LEVEL_RANK[b.f.level] > LEVEL_RANK[a.f.level] ? b : a));
  const earliest = items.filter(x => x.row.data_sampai).sort((a, b) => String(a.row.data_sampai).localeCompare(String(b.row.data_sampai)))[0];
  const level = worst.f.level, single = items.length === 1;
  const freq = items.every(x => x.row.frekuensi === 'bulanan') ? 'Bulanan' : 'Harian';
  const title = single ? String(items[0].row.nama) : items.map(x => SHORT_NAME[String(x.row.sumber)] || x.row.nama).join(' + ');
  return (
    <div className="relative shrink-0 inline-block" ref={ref}>
      <button type="button" className={cx('ds-badge', `is-${level}`, dark && 'is-dark')} aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}
        title={`${title}: ${worst.f.keadaan}`}>
        <i className="ds-dot" aria-hidden="true" />
        <span role="status">{earliest ? `Data s.d. ${earliest.f.sampai}` : 'Belum ada data'}</span>
        <span className="ds-freq">{freq}</span>
      </button>
      {open && (
        <div id={id} className={cx('ds-pop', !single && 'is-multi')} role="dialog" aria-label={`Status data ${title}`}>
          {items.map(({ row, f }) => (
            <div key={String(row.sumber)} className="ds-pop-item">
              <div className="ds-pop-head"><span>{String(row.nama)}</span><span className={cx('ds-pill', `is-${f.level}`)}>{LEVEL_LABEL[f.level]}</span></div>
              <Detail row={row} f={f} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Panel ringkas di sidebar: semua sumber data dan kesegarannya. */
export function DataStatusPanel() {
  const { rows: all } = useDataStatus();
  const { pageAllowed } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  // terlipat = satu baris titik warna (hemat tempat menu); pilihan diingat per browser
  const [shown, setShown] = useState(() => { try { return localStorage.getItem('ds-side-open') !== '0'; } catch { return true; } });
  const toggle = () => setShown(v => { try { localStorage.setItem('ds-side-open', v ? '0' : '1'); } catch { /* abaikan */ } return !v; });
  const rows = all?.filter(r => (SOURCE_PAGES[String(r.sumber)] || []).some(pageAllowed));
  if (!rows?.length) return null;
  const levels = rows.map(r => freshnessOf(r).level);
  const worst = levels.reduce((a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a), 'good' as FreshLevel);
  return (
    <div className="ds-side" aria-label="Status data">
      <button type="button" className="ds-side-title" aria-expanded={shown} onClick={toggle} title={shown ? 'Lipat' : 'Tampilkan status semua sumber data'}>
        <span>Status data</span>
        {!shown && <span className="ds-side-dots" aria-label={LEVEL_LABEL[worst]}>{levels.map((l, i) => <i key={i} className={cx('ds-dot', `is-${l}`)} />)}</span>}
        <svg viewBox="0 0 24 24" aria-hidden="true" className={cx('w-3 h-3 ml-auto transition-transform', shown && 'rotate-180')}><path d="m6 15 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
      </button>
      {shown && <ul>
        {rows.map(r => {
          const f = freshnessOf(r), k = String(r.sumber), upd = fmtUpdated(r.diperbarui);
          return (
            <li key={k}>
              <button type="button" className="ds-side-row" aria-expanded={open === k} onClick={() => setOpen(o => (o === k ? null : k))}
                title={`${r.nama}: ${f.keadaan}`}>
                <i className={cx('ds-dot', `is-${f.level}`)} aria-hidden="true" />
                <span className="ds-side-name">{SHORT_NAME[k] || String(r.nama)}</span>
                <span className="ds-side-date">{f.sampai || '–'}</span>
              </button>
              {open === k && (
                <div className="ds-side-more">
                  <div className={cx('ds-state', `is-${f.level}`)}>{f.keadaan}</div>
                  {upd && <div>Diperbarui {upd}</div>}
                  {r.keterangan && <div className="truncate" title={String(r.keterangan)}>{String(r.keterangan)}</div>}
                </div>
              )}
            </li>
          );
        })}
      </ul>}
    </div>
  );
}
