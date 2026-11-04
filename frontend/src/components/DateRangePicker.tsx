import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  MONTHS_FULL, WEEKDAYS_SHORT, addDays, addMonths, dayCount, daysInMonth, firstWeekday, fmtDate, fmtRange, isISO, parseISO, toISO,
  type DateRange,
} from '../lib/dates';
import { cx } from './ui';

export interface RangePreset { label: string; range: DateRange }

const EMPTY: DateRange = { from: '', to: '' };
const sameRange = (a: DateRange, b: DateRange) => a.from === b.from && a.to === b.to;
const clamp = (iso: string, min?: string, max?: string) => (min && iso < min ? min : max && iso > max ? max : iso);

const Icon = ({ d, className }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}><path d={d} /></svg>
);
const CAL = 'M7 3v3M17 3v3M3.5 9h17M5 5h14a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6.5A1.5 1.5 0 0 1 5 5Z';

/**
 * Pemilih rentang tanggal: tombol pemicu + panel (preset di kiri, dua kalender di kanan).
 * Preset langsung diterapkan; pilihan manual di kalender diterapkan lewat tombol "Terapkan".
 * Panel dirender di <body> (portal) supaya tidak terpotong wadah ber-overflow (mis. hero Overview).
 */
export function DateRangePicker({
  label, value, onChange, min, max, presets = [], allowClear = false, placeholder = 'Pilih tanggal', labelClassName, triggerClassName,
}: {
  label: string;
  value: DateRange;
  onChange: (r: DateRange) => void;
  min?: string; max?: string;
  presets?: RangePreset[];
  allowClear?: boolean;
  placeholder?: string;
  labelClassName?: string;
  triggerClassName?: string;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hasValue = isISO(value.from) && isISO(value.to);
  const activePreset = hasValue ? presets.find(p => sameRange(p.range, value)) : undefined;

  return (
    <div className="control">
      <label htmlFor={uid} className={labelClassName}>{label}</label>
      <button ref={triggerRef} id={uid} type="button" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={cx('drp-trigger', open && 'is-open', triggerClassName)}>
        <Icon d={CAL} className="w-[15px] h-[15px] shrink-0 text-faint" />
        <span className="flex-1 min-w-0 text-left truncate">
          {hasValue
            ? <>{activePreset && <span className="text-soft">{activePreset.label} · </span>}<span className="text-ink">{fmtRange(value)}</span></>
            : <span className="text-faint">{placeholder}</span>}
        </span>
        <Icon d="m6 9 6 6 6-6" className={cx('w-3.5 h-3.5 shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <RangePanel anchor={triggerRef} value={value} min={min} max={max} presets={presets} allowClear={allowClear} labelledBy={uid}
          onClose={(focusTrigger) => { setOpen(false); if (focusTrigger) triggerRef.current?.focus(); }}
          onApply={r => { onChange(r); setOpen(false); triggerRef.current?.focus(); }} />
      )}
    </div>
  );
}

function RangePanel({ anchor, value, min, max, presets, allowClear, labelledBy, onClose, onApply }: {
  anchor: React.RefObject<HTMLElement>; value: DateRange; min?: string; max?: string; presets: RangePreset[]; allowClear: boolean; labelledBy: string;
  onClose: (focusTrigger: boolean) => void; onApply: (r: DateRange) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<DateRange>(isISO(value.from) && isISO(value.to) ? value : EMPTY);
  const [hover, setHover] = useState<string | null>(null);
  const anchorDay = isISO(value.to) ? value.to : (max || toISO(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()));
  // Kalender kanan menampilkan bulan tanggal akhir; kiri = bulan sebelumnya.
  const [rightMonth, setRightMonth] = useState(anchorDay.slice(0, 7) + '-01');
  const leftMonth = addMonths(rightMonth, -1);
  const [focusDay, setFocusDay] = useState(clamp(isISO(value.from) ? value.from : anchorDay, min, max));
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean; sheet: boolean } | null>(null);

  /* ---- posisi panel (fixed, ikut scroll/resize, pindah ke atas kalau di bawah tidak cukup) ---- */
  const place = useCallback(() => {
    const a = anchor.current, p = panelRef.current;
    if (!a || !p) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    // Layar sempit: panel jadi lembar dari bawah layar (tidak terpotong, tombol selalu terjangkau)
    if (vw <= 640) { setPos({ top: 0, left: 0, up: false, sheet: true }); return; }
    const r = a.getBoundingClientRect();
    const w = p.offsetWidth, h = p.offsetHeight;
    const up = r.bottom + 8 + h > vh && r.top - 8 - h > 0;
    setPos({ top: up ? r.top - 8 - h : r.bottom + 8, left: Math.max(12, Math.min(r.left, vw - w - 12)), up, sheet: false });
  }, [anchor]);
  useLayoutEffect(() => { place(); }, [place]);
  useEffect(() => {
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [place]);

  /* ---- tutup: klik di luar / Escape ---- */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(true); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [anchor, onClose]);

  // Fokus awal ke tanggal aktif di kalender, setelah panel diposisikan (elemen tersembunyi tidak bisa difokus)
  const placed = pos !== null;
  useEffect(() => {
    if (placed) panelRef.current?.querySelector<HTMLButtonElement>('[data-focus="1"]')?.focus({ preventScroll: true });
  }, [placed]);

  const disabled = (iso: string) => (!!min && iso < min) || (!!max && iso > max);
  const pick = (iso: string) => {
    if (disabled(iso)) return;
    setFocusDay(iso);
    if (!draft.from || draft.to) setDraft({ from: iso, to: '' });
    else if (iso < draft.from) setDraft({ from: iso, to: draft.from });
    else setDraft({ from: draft.from, to: iso });
  };

  // Rentang yang disorot: hasil pilihan, atau pratinjau saat baru memilih tanggal awal
  const shown = useMemo<DateRange>(() => {
    if (draft.from && draft.to) return draft;
    if (draft.from && hover) return hover < draft.from ? { from: hover, to: draft.from } : { from: draft.from, to: hover };
    return draft.from ? { from: draft.from, to: draft.from } : EMPTY;
  }, [draft, hover]);

  const moveFocus = (iso: string) => {
    const next = clamp(iso, min, max);
    setFocusDay(next);
    const nm = next.slice(0, 7) + '-01';
    if (pos?.sheet) { if (nm !== rightMonth) setRightMonth(nm); }   // layar sempit: hanya satu bulan tampil
    else if (nm > rightMonth) setRightMonth(nm);
    else if (nm < leftMonth) setRightMonth(addMonths(nm, 1));
    const focusIt = () => panelRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${next}"]`)?.focus({ preventScroll: true });
    const el = panelRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${next}"]`);
    if (el && el.offsetParent !== null) focusIt();     // sudah tampil: pindah fokus seketika
    else requestAnimationFrame(focusIt);                // bulan baru: tunggu dirender
  };
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) { e.preventDefault(); moveFocus(addDays(focusDay, step[e.key])); }
    else if (e.key === 'PageUp') { e.preventDefault(); moveFocus(addMonths(focusDay, -1)); }
    else if (e.key === 'PageDown') { e.preventDefault(); moveFocus(addMonths(focusDay, 1)); }
  };

  const canPrev = !min || (pos?.sheet ? rightMonth : leftMonth) > min.slice(0, 8) + '01';
  const canNext = !max || rightMonth < max.slice(0, 8) + '01';
  const ready = isISO(draft.from) && isISO(draft.to);
  const activePreset = presets.find(p => sameRange(p.range, draft));

  return createPortal(
    <div ref={panelRef} role="dialog" aria-modal="false" aria-labelledby={labelledBy}
      className={cx('drp-panel', pos?.up && 'is-up', pos?.sheet && 'is-sheet')}
      style={pos?.sheet ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}>
      {presets.length > 0 && (
        <div className="drp-presets" role="group" aria-label="Rentang cepat">
          {presets.map(p => (
            <button key={p.label} type="button" aria-pressed={activePreset === p}
              className={cx('drp-preset', activePreset === p && 'is-active')}
              onClick={() => onApply(p.range)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className="drp-main">
        <div className="drp-months" onKeyDown={onGridKey} onMouseLeave={() => setHover(null)}>
          {[leftMonth, rightMonth].map((mStart, i) => (
            <Month key={mStart} monthStart={mStart} className={i === 0 ? 'max-[640px]:hidden' : undefined}
              shown={shown} focusDay={focusDay} max={max} disabled={disabled} onPick={pick} onHover={setHover}
              nav={i === 0
                ? <button type="button" className="drp-nav" disabled={!canPrev} aria-label="Bulan sebelumnya" onClick={() => setRightMonth(addMonths(rightMonth, -1))}><Icon d="m15 6-6 6 6 6" className="w-4 h-4" /></button>
                : <button type="button" className="drp-nav" disabled={!canNext} aria-label="Bulan berikutnya" onClick={() => setRightMonth(addMonths(rightMonth, 1))}><Icon d="m9 6 6 6-6 6" className="w-4 h-4" /></button>}
              navMobilePrev={i === 1
                ? <button type="button" className="drp-nav min-[641px]:hidden" disabled={!canPrev} aria-label="Bulan sebelumnya" onClick={() => setRightMonth(addMonths(rightMonth, -1))}><Icon d="m15 6-6 6 6 6" className="w-4 h-4" /></button>
                : null}
              navSide={i === 0 ? 'left' : 'right'} />
          ))}
        </div>
        <div className="drp-foot">
          <div className="drp-summary" aria-live="polite">
            {ready
              ? <><b>{fmtDate(draft.from)}</b><span className="text-faint"> – </span><b>{fmtDate(draft.to)}</b><span className="text-faint"> · {dayCount(draft)} hari</span></>
              : draft.from ? <>Mulai <b>{fmtDate(draft.from)}</b><span className="text-faint"> · pilih tanggal akhir</span></>
                : <span className="text-faint">Pilih tanggal awal dan akhir</span>}
          </div>
          <div className="flex gap-2 shrink-0">
            {allowClear && <button type="button" className="btn btn-sm" onClick={() => onApply(EMPTY)}>Hapus</button>}
            <button type="button" className="btn btn-sm" onClick={() => onClose(true)}>Batal</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={!ready} onClick={() => onApply(draft)}>Terapkan</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Month({ monthStart, shown, focusDay, max, disabled, onPick, onHover, nav, navMobilePrev, navSide, className }: {
  monthStart: string; shown: DateRange; focusDay: string; max?: string;
  disabled: (iso: string) => boolean; onPick: (iso: string) => void; onHover: (iso: string | null) => void;
  nav: React.ReactNode; navMobilePrev: React.ReactNode; navSide: 'left' | 'right'; className?: string;
}) {
  const { y, m } = parseISO(monthStart);
  const lead = firstWeekday(y, m), n = daysInMonth(y, m);
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => toISO(y, m, i + 1))];
  while (cells.length % 7) cells.push(null);
  const titleId = `drp-${monthStart}`;
  return (
    <div className={cx('drp-month', className)}>
      <div className="drp-month-head">
        <span className="w-7 h-7">{navSide === 'left' ? nav : navMobilePrev}</span>
        <span id={titleId} className="drp-month-title">{MONTHS_FULL[m]} {y}</span>
        <span className="w-7 h-7">{navSide === 'right' ? nav : null}</span>
      </div>
      <div role="grid" aria-labelledby={titleId} className="drp-grid">
        <div role="row" className="contents">
          {WEEKDAYS_SHORT.map((w, i) => <span key={w} role="columnheader" className={cx('drp-wd', i === 6 && 'text-red/80')}>{w}</span>)}
        </div>
        {cells.map((iso, i) => {
          if (!iso) return <span key={'e' + i} role="gridcell" />;
          const off = disabled(iso);
          const isStart = iso === shown.from, isEnd = iso === shown.to;
          const inRange = !!shown.from && !!shown.to && iso > shown.from && iso < shown.to;
          const sunday = i % 7 === 6;
          return (
            <span key={iso} role="gridcell" aria-selected={isStart || isEnd || inRange}
              className={cx('drp-cell', inRange && 'in-range', isStart && 'is-start', isEnd && 'is-end', isStart && isEnd && 'is-single')}>
              <button type="button" data-iso={iso} data-focus={iso === focusDay ? '1' : undefined} tabIndex={iso === focusDay ? 0 : -1}
                disabled={off} aria-label={fmtDate(iso) + (iso === max ? ' (data terakhir)' : '')}
                onClick={() => onPick(iso)} onMouseEnter={() => !off && onHover(iso)} onFocus={() => !off && onHover(iso)}
                className={cx('drp-day', sunday && !off && 'text-red', iso === max && 'is-last')}>
                {Number(iso.slice(8))}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
