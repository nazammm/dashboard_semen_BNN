import { useMemo, useState } from 'react';
import { COLORS, capaianClass, fmt } from '../lib/format';
import { CONTEXT_PATH, DAERAH_SHAPES } from '../lib/petaDaerah';
import { Chip, cx } from './ui';

/* ============================================================================
   Peringkat daerah + peta yang menyorot satu daerah.
   Default: daerah peringkat 1 (berubah otomatis mengikuti data). Klik baris / daerah di peta untuk menyorot daerah lain.
   Peta = potongan peta wilayah BNN (lib/petaDaerah.ts): daerah terpilih diperbesar, tetangganya tetap terlihat.
============================================================================ */

export interface DaerahRow { key: string; name: string; target: number; cur: number; prev: number }

const VIEW = { x: 0, y: 14, w: 390, h: 252 };
const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 && t % 1 ? 1 : 0);
const pctOf = (cur: number, target: number) => (target > 0 ? cur / target * 100 : null);
const growth = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev * 100 : null);
const signed = (p: number | null) => (p == null ? '–' : `${p > 0 ? '+' : ''}${fmt(p, 1)}%`);
const toneText = (p: number | null) => { const t = capaianClass(p); return t === 'good' ? 'text-green' : t === 'warn' ? 'text-amber' : t === 'bad' ? 'text-red' : 'text-faint'; };
/** Warna daerah lain: makin besar realisasi makin biru (tetap muda supaya daerah terpilih menonjol). */
const shade = (v: number) => `rgba(1,129,213,${(0.1 + 0.32 * Math.max(0, Math.min(1, v))).toFixed(3)})`;

export function DaerahSpotlight({ rows, P, period }: { rows: DaerahRow[]; P: number; period: string }) {
  const [sortBy, setSortBy] = useState<'ton' | 'capaian'>('ton');
  const [picked, setPicked] = useState<string | null>(null);

  const ranked = useMemo(() => rows.filter(r => r.cur > 0 || r.target > 0).slice().sort((a, b) => (sortBy === 'ton'
    ? b.cur - a.cur
    : (pctOf(b.cur, b.target) ?? -1) - (pctOf(a.cur, a.target) ?? -1) || b.cur - a.cur)), [rows, sortBy]);
  const max = ranked.reduce((a, r) => Math.max(a, r.cur, r.target), 0) || 1;
  const maxCur = ranked.reduce((a, r) => Math.max(a, r.cur), 0) || 1;
  const sel = ranked.find(r => r.key === picked) ?? ranked[0];
  if (!sel) return null;
  const rank = ranked.indexOf(sel) + 1;

  // bingkai zoom: daerah terpilih + ruang di sekitarnya (maks 1,9x supaya tetangga tetap terlihat)
  const shape = DAERAH_SHAPES[sel.key];
  let tf = 'translate(0px,0px) scale(1)';
  if (shape) {
    const [x0, y0, x1, y1] = shape.box;
    const s = Math.max(1, Math.min(1.9, Math.min(VIEW.w / ((x1 - x0) * 2.4), VIEW.h / ((y1 - y0) * 2.4))));
    const cx0 = (x0 + x1) / 2, cy0 = (y0 + y1) / 2;
    // pusat daerah sedikit ke kanan-bawah: kiri atas dipakai kartu keterangan; kiri-kanan bisa terpotong di layar sempit
    const tx = VIEW.x + VIEW.w * 0.55 - cx0 * s, ty = VIEW.y + VIEW.h * 0.6 - cy0 * s;
    tf = `translate(${tx}px,${ty}px) scale(${s})`;
  }
  const p = pctOf(sel.cur, sel.target), g = growth(sel.cur, sel.prev);
  const choose = (k: string) => setPicked(k === ranked[0].key ? null : k);

  return (
    <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] max-[1100px]:grid-cols-1">
      {/* ---------- peta ---------- */}
      <div className="relative min-h-[300px] max-[640px]:min-h-[250px] bg-[#F7F9FB] overflow-hidden border-r border-line max-[1100px]:border-r-0 max-[1100px]:border-b">
        <svg viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" role="img"
          aria-label={`Peta daerah, ${sel.name} disorot`}>
          <g style={{ transform: tf, transformOrigin: '0 0', transition: 'transform .7s cubic-bezier(.3,.7,.2,1)' }}>
            <path d={CONTEXT_PATH} fill="#E6E9ED" />
            {ranked.map(r => {
              const sh = DAERAH_SHAPES[r.key]; if (!sh) return null;
              const on = r.key === sel.key;
              return (
                <path key={r.key} d={sh.d} fill={on ? COLORS.accent : shade(r.cur / maxCur)} stroke="#fff" strokeWidth={on ? 1.2 : 0.8}
                  vectorEffect="non-scaling-stroke" className="cursor-pointer transition-[fill] duration-300 hover:opacity-80" onClick={() => choose(r.key)}>
                  <title>{`${r.name}: ${fmtTon(r.cur)} ton`}</title>
                </path>
              );
            })}
          </g>
        </svg>
        <div className="absolute left-4 top-4 max-w-[62%] rounded bg-surface/95 border border-line px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,.06)] pointer-events-none">
          <div className="text-[12px] text-soft">{picked ? `Peringkat ${rank}` : 'Tertinggi'} · {period}</div>
          <div className="text-[22px] font-semibold leading-tight mt-0.5">{sel.name}</div>
          <div className="mt-2 flex items-baseline gap-1.5"><span className="text-[20px] font-semibold tabular-nums">{fmtTon(sel.cur)}</span><span className="text-faint text-[12.5px]">ton</span></div>
          <div className="text-[12.5px] text-soft mt-1 leading-relaxed">
            {sel.target > 0 && <>Target {fmtTon(sel.target)} · <span className={cx('font-semibold', toneText(p))}>{fmt(p, 1)}%</span><br /></>}
            vs {P} tanggal sama <span className={cx('font-semibold', g == null ? '' : g >= 0 ? 'text-green' : 'text-red')}>{signed(g)}</span>
          </div>
        </div>
      </div>

      {/* ---------- peringkat ---------- */}
      <div className="p-4 max-[640px]:p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[12.5px] text-soft">Urutkan</span>
          <div className="pill-row" role="group" aria-label="Urutkan peringkat">
            <Chip active={sortBy === 'ton'} onClick={() => { setSortBy('ton'); setPicked(null); }}>Tonase</Chip>
            <Chip active={sortBy === 'capaian'} onClick={() => { setSortBy('capaian'); setPicked(null); }}>Capaian</Chip>
          </div>
        </div>
        <ol className="list-none m-0 p-0">
          {ranked.map((r, i) => {
            const on = r.key === sel.key, rp = pctOf(r.cur, r.target);
            return (
              <li key={r.key}>
                <button type="button" onClick={() => choose(r.key)} aria-pressed={on}
                  className={cx('w-full grid grid-cols-[18px_minmax(0,1fr)_auto_52px] items-center gap-x-2.5 px-2 py-[7px] rounded-sm text-left border-0 bg-transparent cursor-pointer',
                    on ? 'bg-accent-soft' : 'hover:bg-surface2')}>
                  <span className={cx('text-[12px] text-right tabular-nums', on ? 'text-accent-ink font-semibold' : 'text-faint')}>{i + 1}</span>
                  <span className="min-w-0">
                    <span className={cx('block text-[13px] truncate', on ? 'font-semibold text-ink' : 'font-medium')}>{r.name}</span>
                    <span className="relative block h-1.5 mt-1 rounded-full bg-surface3">
                      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${r.cur / max * 100}%`, background: on ? COLORS.accent : COLORS.sub }} />
                      {r.target > 0 && <span className="absolute -top-[2px] -bottom-[2px] w-[2px] rounded-full" style={{ left: `calc(${r.target / max * 100}% - 1px)`, background: COLORS.target }} title={`Target ${fmtTon(r.target)} ton`} />}
                    </span>
                  </span>
                  <span className="text-[12.5px] tabular-nums text-right whitespace-nowrap">{fmtTon(r.cur)}</span>
                  <span className={cx('text-[12px] font-semibold tabular-nums text-right', toneText(rp))}>{rp == null ? '–' : `${fmt(rp, 0)}%`}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="text-faint text-[11.5px] mt-2 px-2">Garis tegak = target. Persen = capaian target.</p>
      </div>
    </div>
  );
}
