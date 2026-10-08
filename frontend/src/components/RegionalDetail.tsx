import { useChart } from '../lib/chart';
import { COLORS, MONTHS_ID, chartSRSummary, fmt, fmtCompact } from '../lib/format';
import { cx } from './ui';

/** Persentase pertumbuhan YoY; sentinel -9999 = tidak ada pembanding. */
export const NO_GROWTH = -9999;
export const fmtGrowth = (g: number) => (g === NO_GROWTH ? '–' : (g >= 0 ? '+' : '') + g.toFixed(1) + '%');

/** Tombol buka/tutup komposisi sebuah bulan (expand/collapse di tempat, bukan navigasi). */
export function MonthToggle({ month, expanded, title, onToggle }: { month: number; expanded: boolean; title: string; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={expanded} title={title} onClick={onToggle}
      className={cx('inline-flex items-center gap-1.5 bg-transparent border-0 p-0 font-bold cursor-pointer hover:text-accent-ink', expanded ? 'text-accent-ink' : 'text-ink')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        className={cx('w-[9px] h-[9px] shrink-0 transition-transform', expanded ? 'rotate-90 opacity-100' : 'opacity-55')}>
        <polyline points="9 6 15 12 9 18" />
      </svg>
      {MONTHS_ID[month]}
    </button>
  );
}

/** Baris komposisi (bar horizontal) yang disisipkan di bawah baris bulan. */
export function MonthDetailRow({ colSpan, heading, groups }: { colSpan: number; heading: string; groups: { label: string; value: number }[] }) {
  const total = groups.reduce((a, g) => a + g.value, 0);
  const height = Math.max(140, Math.min(480, groups.length * 32 + 40));
  const ref = useChart(() => ({
    type: 'bar',
    data: { labels: groups.map(g => g.label), datasets: [{ data: groups.map(g => g.value), backgroundColor: COLORS.accent, maxBarThickness: 22 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      scales: { x: { grid: { color: COLORS.line }, ticks: { callback: (v: any) => fmtCompact(v) } }, y: { grid: { display: false } } },
      plugins: { tooltip: { callbacks: { label: (c: any) => {
        const p = total > 0 ? (c.parsed.x / total * 100) : 0;
        return ` ${fmt(c.parsed.x)} ton (${p.toFixed(1)}% dari total)`;
      } } } },
    },
  }), [groups]);
  return (
    <tr className="detail-row">
      <td colSpan={colSpan} className="!bg-surface2 !px-4 !pt-[18px] !pb-5">
        <div className="flex justify-between items-baseline flex-wrap gap-2 mb-2.5">
          <h3 className="text-[13px] font-bold text-ink font-sans normal-case">{heading}</h3>
          <span className="font-mono text-[11px] text-faint">Total {fmt(total)} ton</span>
        </div>
        <div className="chart-box" style={{ height }}>
          <canvas ref={ref} role="img" aria-label={heading} />
        </div>
        <p className="sr-only">{chartSRSummary(groups.map(g => g.label), groups.map(g => g.value), 'ton')}</p>
      </td>
    </tr>
  );
}
