import { useRef, type ReactNode, type ThHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { capaianClass, pct, type StatusVariant } from '../lib/format';
import { useChart } from '../lib/chart';
import { exportTablesToExcel } from '../lib/xlsx';
import { useAuth } from '../lib/auth';
import type { ChartConfiguration } from 'chart.js';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ---------- Header halaman ---------- */
export function PageHeader({ title, desc, status, statusVariant = 'good', children }: {
  title: string; desc?: string; status?: string; statusVariant?: StatusVariant; children?: ReactNode;
}) {
  return (
    <div className="mb-7">
      <div className="flex flex-wrap items-start justify-between gap-6 max-md:flex-col max-md:gap-2">
        <div>
          <h1 className="text-[clamp(30px,4vw,46px)]">{title}</h1>
          {desc && <p className="text-soft text-[14.5px] max-w-[640px] mt-2.5 leading-relaxed">{desc}</p>}
        </div>
        {status && <Badge variant={statusVariant} className="shrink-0"><span role="status">{status}</span></Badge>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function Badge({ variant = 'neutral', children, className, title }: { variant?: 'good' | 'warn' | 'bad' | 'neutral' | 'online'; children: ReactNode; className?: string; title?: string }) {
  return <span className={cx('badge', variant, className)} title={title}><span className="dot" aria-hidden="true" />{children}</span>;
}

/* ---------- Kartu & KPI ---------- */
export function Card({ title, children, className, plain }: { title?: string; children: ReactNode; className?: string; plain?: boolean }) {
  return <div className={cx('card', plain && 'plain', className)}>{title && <div className="card-title">{title}</div>}{children}</div>;
}

export function Kpi({ title, value, unit, delta, deltaTone, icon, iconTone = 'neutral', children }: {
  title: string; value: ReactNode; unit?: string; delta?: ReactNode; deltaTone?: 'up' | 'down';
  icon?: ReactNode; iconTone?: 'neutral' | 'accent' | 'good' | 'bad' | 'warn'; children?: ReactNode;
}) {
  return (
    <div className="card">
      {icon && <span className={cx('kpi-icon', 'i-' + iconTone)} aria-hidden="true">{icon}</span>}
      <div className={cx('card-title', !!icon && 'pr-[30px]')}>{title}</div>
      <div className="kpi-value">{value}{unit && <span className="unit">{unit}</span>}</div>
      {delta != null && <div className={cx('kpi-delta', deltaTone)}>{delta}</div>}
      {children}
    </div>
  );
}

/* ---------- Capaian (bar progres) ---------- */
export function Capaian({ actual, target }: { actual: unknown; target: unknown }) {
  const p = pct(actual, target);
  if (p == null) return <span className="font-mono text-faint">–</span>;
  const tone = capaianClass(p);
  return (
    <div className={cx('capaian', tone)}>
      <div className="capaian-track"><div className="capaian-bar" style={{ width: `${Math.min(100, p)}%` }} /></div>
      <span className="capaian-label">{p.toFixed(0)}%</span>
    </div>
  );
}
/** Persentase capaian rata-rata yang sudah dihitung pemanggil. */
export function CapaianAvg({ p }: { p: number | null | undefined }) {
  if (p == null || !Number.isFinite(p) || p < 0) return <span className="text-faint">–</span>;
  const tone = capaianClass(p);
  const color = tone === 'good' ? 'text-green' : tone === 'warn' ? 'text-amber' : 'text-red';
  return <span className={cx('font-mono text-xs font-semibold', color)}>{p.toFixed(1)}%</span>;
}

/* ---------- Badge domain ---------- */
export function PaymentBadge({ payment }: { payment?: string | null }) {
  if (!payment) return <span className="font-mono text-faint">–</span>;
  return <Badge variant={/cash/i.test(payment) ? 'good' : 'warn'}>{payment}</Badge>;
}
export function OnlineBadge({ mssNoOrder }: { mssNoOrder: unknown }) {
  const v = String(mssNoOrder ?? '').trim();
  if (v === '' || v === '0') return null;
  return <Badge variant="online" title={`Kode transaksi online: ${v}`}>Online</Badge>;
}

/* ---------- Status pemuatan ---------- */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Memuat data…">
      <div className="skel w-[190px] h-[11px] mb-3.5" />
      <div className="skel w-[min(280px,60%)] h-[34px] mb-[22px]" />
      <div className="flex gap-2.5 mb-[22px] flex-wrap"><div className="skel w-[150px] h-9" /><div className="skel w-[150px] h-9" /></div>
      <div className="grid-kpi mb-7">{[0, 1, 2, 3].map(i => <div key={i} className="skel h-24" />)}</div>
      <div className="skel h-[360px]" />
    </div>
  );
}
export function Loading({ text = 'Memuat…' }: { text?: string }) {
  return <div className="py-[60px] text-center text-faint font-mono text-[12.5px]" role="status"><div className="spinner" aria-hidden="true" />{text}</div>;
}
export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error || 'Terjadi kesalahan saat mengambil data.');
  return <div className="error-box" role="alert">{msg}</div>;
}
export function EmptyBox({ children }: { children: ReactNode }) { return <div className="empty-box">{children}</div>; }

/* ---------- Form ---------- */
export function Control({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div className="control"><label>{label}</label>{children}{hint && <div className="text-[11px] text-faint mt-1 max-w-[230px] leading-snug">{hint}</div>}</div>;
}
export function Select({ label, options, ...rest }: { label: string; options: { value: string | number; label: string }[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Control label={label}>
      <select {...rest}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </Control>
  );
}
export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return <button type="button" className={cx('chip', active && 'active')} aria-pressed={!!active} onClick={onClick}>{children}</button>;
}

/* ---------- Tabel ---------- */
export function Th({ children, sortable, ariaSort, onSort, num, ...rest }: {
  children?: ReactNode; sortable?: boolean; ariaSort?: 'ascending' | 'descending'; onSort?: () => void; num?: boolean;
} & Omit<ThHTMLAttributes<HTMLTableCellElement>, 'onClick'>) {
  return (
    <th {...rest} className={cx(sortable && 'sortable', num && 'num', rest.className)} aria-sort={ariaSort}
      onClick={sortable ? onSort : undefined} tabIndex={sortable ? 0 : undefined}
      onKeyDown={sortable ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort?.(); } } : undefined}>
      {children}
    </th>
  );
}
export function TableWrap({ children, className }: { children: ReactNode; className?: string }) { return <div className={cx('table-wrap', className)}>{children}</div>; }
export function CellLink({ to, children }: { to: string; children: ReactNode }) { return <Link to={to} className="cell-link">{children}</Link>; }

/* ---------- Grafik ---------- */
export function ChartBox({ build, deps, className, label }: { build: () => ChartConfiguration | null; deps: unknown[]; className?: string; label?: string }) {
  const ref = useChart(build, deps);
  return <div className={cx('chart-box', className)}><canvas ref={ref} role="img" aria-label={label} /></div>;
}

/* ---------- Ikon format file & tombol export ---------- */
export function FileIcon({ kind }: { kind: 'xlsx' | 'pptx' }) {
  const c = kind === 'xlsx' ? { fill: '#E4F3E8', stroke: '#1D7A46', body: '#1D7A46' } : { fill: '#FBE9E4', stroke: '#C6471F', body: '#C6471F' };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 2.5h9l5 5V21a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" fill={c.fill} stroke={c.stroke} strokeWidth="1.2" />
      <path d="M14 2.5V7a1 1 0 0 0 1 1h4.5" fill="none" stroke={c.stroke} strokeWidth="1.2" />
      <rect x="6.2" y="11.3" width="11.6" height="7.6" rx="1" fill={c.body} />
      {kind === 'xlsx'
        ? <><path d="m8.5 13 2.4 4.2m0-4.2-2.4 4.2" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" /><path d="M13.7 13v4.2h2.5" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>
        : <><path d="M9.3 13v4.2" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" /><path d="M9.3 13h1.8a1.4 1.4 0 0 1 0 2.8H9.3" fill="none" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" /></>}
    </svg>
  );
}

/**
 * Tombol "Export ke Excel". `getTables` dipanggil saat klik, mengembalikan <table> yang sedang tampil.
 * Disembunyikan otomatis kalau role tidak boleh download di halaman ini.
 */
export function ExportButton({ pageId, filename, getTables, label = 'Export ke Excel' }: {
  pageId: string; filename: string | (() => string); getTables: () => { name: string; el: HTMLTableElement | null | undefined }[]; label?: string;
}) {
  const { canDownload } = useAuth();
  const busy = useRef(false);
  if (!canDownload(pageId)) return null;
  return (
    <button type="button" className="btn" onClick={() => {
      if (busy.current) return;
      busy.current = true;
      try { exportTablesToExcel(getTables(), typeof filename === 'function' ? filename() : filename, pageId); } finally { busy.current = false; }
    }}>
      <FileIcon kind="xlsx" />{label}
    </button>
  );
}

/** Breadcrumb kecil. */
export function Breadcrumb({ items }: { items: string[] }) {
  return (
    <div className="font-mono text-[10.5px] uppercase text-faint mb-2.5" style={{ letterSpacing: '.05em' }}>
      {items.map((it, i) => <span key={i}>{i > 0 && <span className="mx-1.5 text-line-strong">/</span>}<span className={i === items.length - 1 ? 'text-soft' : ''}>{it}</span></span>)}
    </div>
  );
}

export function BackLink({ to, children = 'Kembali' }: { to: string; children?: ReactNode }) {
  return <Link to={to} className="inline-flex items-center gap-1.5 font-mono text-xs text-soft hover:text-accent-ink mb-4">← {children}</Link>;
}
