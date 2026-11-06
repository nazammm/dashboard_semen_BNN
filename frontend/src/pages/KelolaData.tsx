/* ============================================================================
   Kelola Data (admin): perbarui, ganti, dan hapus data harian
   (Transaksi distributor dan Sell In BNN), plus riwayat semua perubahan.
============================================================================ */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../lib/api';
import { fmt } from '../lib/format';
import { fmtRange } from '../lib/dates';
import { useDocTitle } from '../lib/hooks';
import type { Row } from '../lib/types';
import { freshnessOf, useDataStatus } from '../components/DataStatus';
import { Badge, Breadcrumb, Chip, ErrorBox, PageHeader, TableWrap, cx } from '../components/ui';
import { ICON, Ic, errText, fmtWhen } from './kelola/shared';
import { TransaksiUpload, StatusSyncForm } from './kelola/TransaksiPanel';
import { SellinUpload } from './kelola/SellinPanel';
import { HapusPanel } from './kelola/HapusPanel';
import { SelloutPaste } from './kelola/SelloutPanel';
import { J073Upload } from './kelola/J073Panel';

type Tab = 'transaksi' | 'sellin' | 'sellout' | 'riwayat';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'transaksi', label: 'Transaksi', icon: 'M4 6.5h16M4 12h16M4 17.5h10' },
  { id: 'sellin', label: 'Sell In BNN', icon: 'M3.5 8 12 3.5 20.5 8v8L12 20.5 3.5 16V8ZM3.5 8 12 12.5 20.5 8M12 12.5v8' },
  { id: 'sellout', label: 'Sell Out BNN', icon: 'M4 20h16M6.5 16.5V11M11 16.5V7.5M15.5 16.5v-4M20 16.5V5' },
  { id: 'riwayat', label: 'Riwayat', icon: ICON.clock },
];
const MENUS: Record<Exclude<Tab, 'riwayat'>, { id: string; label: string }[]> = {
  transaksi: [{ id: 'upload', label: 'Upload / ganti' }, { id: 'hapus', label: 'Hapus' }, { id: 'sinkron', label: 'Waktu pembaruan' }],
  sellin: [{ id: 'upload', label: 'Upload / ganti' }, { id: 'hapus', label: 'Hapus' }],
  sellout: [{ id: 'dofas', label: 'Tempel DO FAS' }, { id: 'erp', label: 'Tempel Sub ERP' }, { id: 'j073', label: 'Upload J073' }],
};

export default function KelolaData() {
  useDocTitle('Kelola Data');
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some(t => t.id === params.get('data')) ? params.get('data') : 'transaksi') as Tab;
  const menus = tab === 'riwayat' ? [] : MENUS[tab];
  const menu = menus.find(m => m.id === params.get('menu'))?.id || menus[0]?.id;
  const go = (data: Tab, m?: string) => setParams(m ? { data, menu: m } : { data }, { replace: true });
  const [version, setVersion] = useState(0);   // naik setiap data berubah → riwayat dimuat ulang
  const changed = useCallback(() => setVersion(v => v + 1), []);
  const { rows: status } = useDataStatus();
  // Sell Out BNN: status mengikuti menu yang dibuka (DO FAS / Sub ERP / J073)
  const statusRow = status?.find(r => r.sumber === (tab === 'sellout' ? menu : tab)) || null;

  return (
    <div>
      <Breadcrumb items={['Administrasi', 'Kelola Data']} />
      <PageHeader title="Kelola Data" desc="Upload, ganti, dan hapus data harian. Setiap perubahan tercatat di Riwayat." />

      <div className="kd-tabs" role="tablist" aria-label="Jenis data">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" id={`kd-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="kd-panel"
            className={cx('kd-tab', tab === t.id && 'is-active')} onClick={() => go(t.id)}>
            <Ic d={t.icon} />{t.label}
          </button>
        ))}
      </div>

      <div id="kd-panel" role="tabpanel" aria-labelledby={`kd-tab-${tab}`}>
        {tab !== 'riwayat' && (
          <>
            <StatusStrip row={statusRow} />
            <nav className="kd-menu" aria-label="Menu">
              {menus.map(m => (
                <button key={m.id} type="button" aria-current={menu === m.id ? 'page' : undefined} className={cx('kd-menu-btn', menu === m.id && 'is-active')}
                  onClick={() => go(tab, m.id)}>{m.label}</button>
              ))}
            </nav>
          </>
        )}

        {/* key: ganti tab = mulai bersih (impor yang belum disimpan tidak terbawa ke data lain) */}
        <div key={`${tab}-${menu}`}>
          {tab === 'transaksi' && menu === 'upload' && <TransaksiUpload onChanged={changed} />}
          {tab === 'transaksi' && menu === 'hapus' && <HapusPanel dataset="transaksi" lastDate={statusRow?.data_sampai ? String(statusRow.data_sampai).slice(0, 10) : null} onChanged={changed} />}
          {tab === 'transaksi' && menu === 'sinkron' && <StatusSyncForm onChanged={changed} />}
          {tab === 'sellin' && menu === 'upload' && <SellinUpload onChanged={changed} />}
          {tab === 'sellin' && menu === 'hapus' && <HapusPanel dataset="sellin" lastDate={statusRow?.data_sampai ? String(statusRow.data_sampai).slice(0, 10) : null} onChanged={changed} />}
          {tab === 'sellout' && (menu === 'dofas' || menu === 'erp') && <SelloutPaste dataset={menu} onChanged={changed} />}
          {tab === 'sellout' && menu === 'j073' && <J073Upload onChanged={changed} />}
          {tab === 'riwayat' && <Riwayat version={version} />}
        </div>

        {tab !== 'riwayat' && (
          <>
            <div className="flex items-baseline justify-between gap-3 mt-[38px] mb-3.5 flex-wrap">
              <h2 className="section-title !m-0">Perubahan terakhir</h2>
              <button type="button" className="btn btn-sm" onClick={() => go('riwayat')}>Lihat semua riwayat</button>
            </div>
            <Riwayat version={version} dataset={tab} limit={5} compact />
          </>
        )}
      </div>
    </div>
  );
}

/** Ringkasan kesegaran data yang sedang dikelola. */
function StatusStrip({ row }: { row: Row | null }) {
  if (!row) return <div className="kd-status is-loading" aria-hidden="true" />;
  const f = freshnessOf(row);
  const upd = row.diperbarui ? fmtWhen(String(row.diperbarui).length <= 16 ? row.diperbarui + ':00' : row.diperbarui) : null;
  return (
    <div className={cx('kd-status', `is-${f.level}`)} role="status">
      <i className="ds-dot" aria-hidden="true" />
      <div className="kd-status-main">
        <span className="kd-status-k">Data s.d.</span>
        <b>{f.sampai || 'belum ada'}</b>
        <span className={cx('ds-state', `is-${f.level}`)}>{f.keadaan}</span>
      </div>
      <div className="kd-status-side">
        {upd ? <>Diperbarui {upd}</> : 'Waktu pembaruan belum tercatat'}
        {row.keterangan && <span className="text-faint"> · {String(row.keterangan)}</span>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Riwayat upload & hapus (Transaksi + Sell In BNN)
--------------------------------------------------------------------------- */
const DS_LABEL: Record<string, string> = { transaksi: 'Transaksi', sellin: 'Sell In BNN', dofas: 'DO FAS', erp: 'Sub ERP', j073: 'J073' };
const inFilter = (f: string, ds: unknown) => f === 'all' || ds === f || (f === 'sellout' && (ds === 'dofas' || ds === 'erp' || ds === 'j073'));

function Riwayat({ version, dataset, limit, compact }: { version: number; dataset?: string; limit?: number; compact?: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(dataset || 'all');
  useEffect(() => {
    let alive = true;
    adminApi<Row[]>('GET', 'admin/data/riwayat').then(r => { if (alive) { setRows(r); setError(null); } }).catch(e => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, [version]);

  const shown = (rows || []).filter(r => inFilter(filter, r.dataset)).slice(0, limit ?? 50);
  const cols = compact ? 7 : 9;
  const cell = (v: unknown) => (v == null ? '–' : fmt(v));

  return (
    <div>
      {!compact && (
        <div className="flex gap-2 flex-wrap mb-3" role="group" aria-label="Saring riwayat">
          {[['all', 'Semua'], ['transaksi', 'Transaksi'], ['sellin', 'Sell In BNN'], ['sellout', 'Sell Out BNN']].map(([k, l]) => <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{l}</Chip>)}
        </div>
      )}
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <TableWrap>
        <table>
          <caption className="sr-only">Riwayat perubahan data</caption>
          <thead>
            <tr>
              <th>Waktu</th>{!compact && <th>Data</th>}<th>Aksi</th><th>Oleh</th><th>Periode</th>{!compact && <th>Distributor</th>}
              <th className="num">Tersimpan</th><th className="num">Diganti / dihapus</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {!rows && !error && <tr><td colSpan={cols} className="!text-center !text-faint !p-5">Memuat…</td></tr>}
            {rows && shown.length === 0 && <tr><td colSpan={cols} className="!text-center !text-faint !p-5">Belum ada perubahan.</td></tr>}
            {shown.map((r, i) => {
              const dists = (r.dist_codes as string[] | null) || [];
              const src = r.aksi === 'hapus' ? null : r.dataset === 'dofas' || r.dataset === 'erp' ? `Tempel ${DS_LABEL[String(r.dataset)]}` : r.source === 'tempel' ? 'Tempel dari Excel' : r.file_name || 'File';
              return (
                <tr key={`${r.dataset}-${r.created_at}-${i}`}>
                  <td className="font-mono text-[12px] whitespace-nowrap">{fmtWhen(r.created_at)}</td>
                  {!compact && <td className="whitespace-nowrap">{DS_LABEL[String(r.dataset)] || r.dataset}</td>}
                  <td className="max-w-[260px]">
                    <span className={cx('kd-aksi', r.aksi === 'hapus' && 'is-hapus')}>{r.aksi === 'hapus' ? 'Hapus' : 'Upload'}</span>
                    {src && <span className="text-soft text-[12px] ml-1.5 truncate inline-block max-w-[180px] align-bottom" title={src}>{src}</span>}
                  </td>
                  <td>{r.created_by || '–'}</td>
                  <td className="whitespace-nowrap">{r.date_from ? fmtRange({ from: String(r.date_from), to: String(r.date_to) }) : '–'}</td>
                  {!compact && <td className="text-[12px]" title={dists.join(', ')}>{r.dataset !== 'transaksi' && r.dataset !== 'j073' ? '–' : dists.length ? (dists.length > 3 ? `${dists.slice(0, 3).join(', ')} +${dists.length - 3}` : dists.join(', ')) : 'Semua'}</td>}
                  <td className="num font-mono">{cell(r.rows_saved)}</td>
                  <td className="num font-mono">{cell(r.rows_deleted)}</td>
                  <td><StatusBadge s={String(r.status)} at={r.created_at} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}

function StatusBadge({ s, at }: { s: string; at: unknown }): ReactNode {
  if (s === 'selesai') return <Badge variant="good">Selesai</Badge>;
  if (s === 'batal') return <Badge variant="neutral">Batal</Badge>;
  if (Date.now() - new Date(String(at)).getTime() < 15 * 60e3) return <Badge variant="warn">Berjalan</Badge>;
  return <Badge variant="warn" title="Belum selesai: tertutup di tengah jalan atau masih berjalan. Data lama tidak berubah.">Terputus</Badge>;
}
