import { useState } from 'react';
import { adminApi } from '../lib/api';
import { useAsync, useDocTitle } from '../lib/hooks';
import { fmt, ROLE_LABEL, PALETTE, COLORS } from '../lib/format';
import { PAGE_LABEL } from '../lib/pages';
import { Breadcrumb, PageHeader, PageSkeleton, ErrorBox, Kpi, ChartBox, TableWrap } from '../components/ui';
import type { Row } from '../lib/types';

interface ActivityData {
  summary: Row;
  active_users_by_role?: Row[];
  page_view_counts: Row[];
  recent_logins: Row[];
  recent_downloads: Row[];
  recent_activity: Row[];
}

const pageLabel = (id: unknown) => PAGE_LABEL[String(id)] || String(id);
const roleLabel = (r: unknown) => ROLE_LABEL[String(r)] || String(r || '').toUpperCase();
function iwWhen(iso: unknown) {
  const d = new Date(String(iso));
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const ACTION_LABEL: Record<string, string> = { login: 'Login', page_view: 'Buka halaman', download: 'Download' };

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return <tr><td colSpan={cols} className="text-center text-faint p-5">{text}</td></tr>;
}

export default function InteraksiWeb() {
  useDocTitle('Interaksi Web');
  const { data, error, loading } = useAsync(() => adminApi<ActivityData>('GET', 'admin/activity'), []);
  const [picked, setPicked] = useState<string | null>(null);

  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <PageSkeleton />;

  const s = data.summary || {};
  const byRole: Record<string, Row[]> = {};
  (data.active_users_by_role || []).forEach(r => { (byRole[String(r.role)] = byRole[String(r.role)] || []).push(r); });
  const roleOrder = Object.keys(byRole).sort((a, b) => byRole[b].length - byRole[a].length);
  const roleLabels = roleOrder.map(roleLabel);
  const roleCounts = roleOrder.map(r => byRole[r].length);
  const shownRole = picked && byRole[picked] ? picked : roleOrder[0] || null; // default: role dengan pengguna aktif terbanyak
  const srText = roleOrder.length
    ? roleOrder.map((_, i) => `${roleLabels[i]}: ${roleCounts[i]} orang`).join(', ')
    : 'Belum ada pengguna aktif hari ini.';

  const pv = data.page_view_counts || [];
  const maxViews = Math.max(1, ...pv.map(r => Number(r.c)));
  const logins = data.recent_logins || [];
  const downloads = data.recent_downloads || [];
  const activity = data.recent_activity || [];

  return (
    <div>
      <Breadcrumb items={['Dashboard', 'Interaksi Web']} />
      <PageHeader
        title="Interaksi Web"
        desc="Siapa memakai dashboard ini, halaman mana yang paling sering dibuka, dan siapa mengunduh file Excel. Hanya bisa dilihat akun admin."
      />

      <div className="grid-kpi">
        <Kpi title="Login Hari Ini" value={fmt(s.logins_today)} />
        <Kpi title="Pengguna Aktif Hari Ini" value={fmt(s.active_users_today)} />
        <Kpi title="Halaman Dibuka Hari Ini" value={fmt(s.page_views_today)} />
        <Kpi title="Download Excel Hari Ini" value={fmt(s.downloads_today)} />
      </div>

      <div className="flex gap-4 items-stretch mt-5 flex-wrap">
        <div className="card flex flex-col flex-[1_1_320px]">
          <h2 className="card-title !text-[13px] mb-1">Pengguna Aktif Hari Ini <span className="normal-case font-normal">per role</span></h2>
          <p className="text-xs text-faint mb-2.5">Klik salah satu batang untuk lihat siapa saja yang aktif.</p>
          {roleOrder.length ? (
            <>
              <ChartBox
                className="flex-1 min-h-[180px]"
                label={srText}
                deps={[data]}
                build={() => ({
                  type: 'bar',
                  data: { labels: roleLabels, datasets: [{ data: roleCounts, backgroundColor: PALETTE, maxBarThickness: 46, borderRadius: 4 }] },
                  options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: { y: { grid: { color: COLORS.line }, ticks: { precision: 0 } }, x: { grid: { display: false } } },
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => ` ${fmt(c.parsed.y)} orang aktif` } } },
                    onHover: (e: any, els: unknown[]) => { if (e.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                    onClick: (_e: unknown, els: { index: number }[]) => { if (els.length) setPicked(roleOrder[els[0].index]); },
                  } as any,
                })}
              />
              <p className="sr-only">{srText}</p>
            </>
          ) : (
            <p className="text-faint text-[13px] pt-5">Belum ada pengguna aktif hari ini.</p>
          )}
        </div>

        <div className="card flex flex-col flex-[1_1_320px]">
          <h2 className="card-title !text-[13px] mb-2.5">
            Siapa Saja yang Aktif
            {shownRole && <span className="normal-case font-normal"> · {roleLabel(shownRole)} ({byRole[shownRole].length})</span>}
          </h2>
          <div className="flex-1">
            {shownRole ? (
              <TableWrap className="!m-0">
                <table className="mono text-[12.5px]">
                  <thead><tr><th>Username</th><th>Nama</th><th>Terakhir Aktif</th></tr></thead>
                  <tbody>
                    {byRole[shownRole].map((r, i) => (
                      <tr key={i}><td>{r.username}</td><td>{r.name || '–'}</td><td>{iwWhen(r.last_activity)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <p className="text-faint text-[13px]">Belum ada pengguna aktif hari ini.</p>
            )}
          </div>
        </div>
      </div>

      <div className="card mt-5">
        <h2 className="card-title !text-[13px] mb-3">Halaman Paling Banyak Dibuka <span className="normal-case font-normal">(30 hari terakhir)</span></h2>
        {pv.length ? pv.map((r, i) => (
          <div key={i} className="mb-2.5">
            <div className="flex justify-between text-[12.5px] mb-1">
              <span>{pageLabel(r.page_id)}</span>
              <span className="font-mono text-faint">{fmt(r.c)}</span>
            </div>
            <div className="h-[7px] rounded bg-surface2 overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${((Number(r.c) / maxViews) * 100).toFixed(1)}%` }} />
            </div>
          </div>
        )) : <p className="text-faint text-[13px]">Belum ada data.</p>}
      </div>

      <h2 className="section-title mt-[34px]">Riwayat Login Terbaru</h2>
      <TableWrap>
        <table className="mono">
          <thead><tr><th>Waktu</th><th>Username</th><th>Nama</th><th>Role</th></tr></thead>
          <tbody>
            {logins.length ? logins.map((r, i) => (
              <tr key={i}><td>{iwWhen(r.created_at)}</td><td>{r.username}</td><td>{r.name || '–'}</td><td>{roleLabel(r.role)}</td></tr>
            )) : <EmptyRow cols={4} text="Belum ada data." />}
          </tbody>
        </table>
      </TableWrap>

      <h2 className="section-title mt-[34px]">Download Excel Terbaru</h2>
      <TableWrap>
        <table className="mono">
          <thead><tr><th>Waktu</th><th>Username</th><th>Nama</th><th>File</th></tr></thead>
          <tbody>
            {downloads.length ? downloads.map((r, i) => (
              <tr key={i}><td>{iwWhen(r.created_at)}</td><td>{r.username}</td><td>{r.name || '–'}</td><td>{r.detail || '–'}</td></tr>
            )) : <EmptyRow cols={4} text="Belum ada download." />}
          </tbody>
        </table>
      </TableWrap>

      <h2 className="section-title mt-[34px]">Aktivitas Terbaru <span className="n">(semua jenis, 50 terakhir)</span></h2>
      <TableWrap>
        <table className="mono text-[12.5px]">
          <thead><tr><th>Waktu</th><th>Username</th><th>Role</th><th>Aksi</th><th>Halaman/Detail</th></tr></thead>
          <tbody>
            {activity.length ? activity.map((r, i) => (
              <tr key={i}>
                <td>{iwWhen(r.created_at)}</td><td>{r.username}</td><td>{roleLabel(r.role)}</td>
                <td>{ACTION_LABEL[r.event_type] || r.event_type}</td>
                <td>{r.event_type === 'page_view' ? (PAGE_LABEL[r.page_id] || r.page_id || '–') : (r.detail || PAGE_LABEL[r.page_id] || '–')}</td>
              </tr>
            )) : <EmptyRow cols={5} text="Belum ada aktivitas." />}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}
