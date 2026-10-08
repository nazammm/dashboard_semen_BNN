import { useEffect, useState, type FormEvent } from 'react';
import { adminApi } from '../lib/api';
import { useAsync, useDocTitle } from '../lib/hooks';
import { ROLE_LABEL } from '../lib/format';
import { Breadcrumb, PageHeader, PageSkeleton, ErrorBox, Badge, TableWrap, cx } from '../components/ui';
import ConfirmDialog from '../components/ConfirmDialog';
import type { Row } from '../lib/types';

// Role yang datanya dibatasi server ke SATU distributor (aturan sebenarnya ada di server).
const DIST_SCOPED_ROLES = ['spv', 'sales'];
const ROLE_BADGE_VARIANT: Record<string, 'online' | 'good' | 'neutral'> = { admin: 'online', mo: 'good', sales: 'neutral', spv: 'neutral' };
const USER_RE = /^[a-z0-9_.-]{3,32}$/;

const TOGGLEABLE_PAGE_LABELS: [string, string][] = [
  ['beranda', 'Overview'], ['performa-daerah', 'Penjualan Daerah'], ['delivery', 'Delivery'],
  ['rekap-harian', 'Rekap Harian'], ['tim-sales', 'Tim Sales'], ['peta-toko', 'Peta Toko'], ['daftar-toko', 'Daftar Toko'],
  ['transaksi-detail', 'Detail Transaksi'], ['toko-detail', 'Detail Toko'],
];
const ROLE_PAGES_DESC: Record<string, string> = {
  mo: 'Biasanya semua halaman dicentang (akses penuh dashboard).',
  sales: 'Halaman yang boleh dibuka semua akun sales, + boleh lihat detail / download per halaman.',
  spv: 'Halaman yang boleh dibuka semua akun SPV, + boleh lihat detail / download per halaman.',
};
const PERM_ROLES = ['mo', 'sales', 'spv'] as const;

interface User { username: string; name: string | null; role: string; dist_code: string | null; created_at: string | null }
interface Distributor { dist_code: string; dist_name: string | null }
type Perm = { can_view_detail: boolean; can_download: boolean };
interface RolePagesResp { current: Record<string, string[]>; permissions?: Record<string, Record<string, Perm>> }

const roleBadge = (role: string) => <Badge variant={ROLE_BADGE_VARIANT[role] || 'neutral'}>{ROLE_LABEL[role] || role}</Badge>;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function RoleOptions() {
  return (
    <>
      <option value="sales">Sales</option>
      <option value="spv">SPV</option>
      <option value="mo">{ROLE_LABEL.mo}</option>
      <option value="admin">Admin</option>
    </>
  );
}
function DistOptions({ list }: { list: Distributor[] }) {
  return (
    <>
      <option value="">Pilih distributor…</option>
      {list.map(d => <option key={d.dist_code} value={d.dist_code}>{d.dist_code} · {d.dist_name || ''}</option>)}
    </>
  );
}

/* ---------- Form tambah pengguna ---------- */
function AddUserForm({ distributors, onCreated }: { distributors: Distributor[]; onCreated: () => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('sales');
  const [dist, setDist] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const scoped = DIST_SCOPED_ROLES.includes(role);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const uname = username.trim();
    if (!USER_RE.test(uname.toLowerCase())) return setMsg({ ok: false, text: 'Username tidak valid (huruf kecil, angka, titik/underscore/strip, 3-32 karakter).' });
    if (password.length < 8) return setMsg({ ok: false, text: 'Password minimal 8 karakter.' });
    if (scoped && !dist) return setMsg({ ok: false, text: 'Role spv/sales wajib diisi distributornya.' });
    const body: Record<string, unknown> = { username: uname, name: name.trim(), role, password };
    if (scoped) body.dist_code = dist;
    setBusy(true);
    try {
      await adminApi('POST', 'admin/users', body);
      setMsg({ ok: true, text: `Akun "${uname}" dibuat.` });
      setUsername(''); setName(''); setRole('sales'); setDist(''); setPassword('');
      await onCreated();
    } catch (err) {
      setMsg({ ok: false, text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-[26px]">
      <h2 className="card-title !text-[13px] mb-3.5">Tambah Pengguna</h2>
      <form className="controls !mb-0" onSubmit={submit} noValidate>
        <div className="control">
          <label htmlFor="kaUsername">Username</label>
          <input type="text" id="kaUsername" value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="mis. budi.santoso" required />
        </div>
        <div className="control">
          <label htmlFor="kaName">Nama Tampilan</label>
          <input type="text" id="kaName" value={name} onChange={e => setName(e.target.value)} autoComplete="off" placeholder="mis. Budi Santoso" />
        </div>
        <div className="control">
          <label htmlFor="kaRole">Role</label>
          <select id="kaRole" value={role} onChange={e => setRole(e.target.value)}><RoleOptions /></select>
        </div>
        {scoped && (
          <div className="control">
            <label htmlFor="kaDist">Distributor</label>
            <select id="kaDist" value={dist} onChange={e => setDist(e.target.value)}><DistOptions list={distributors} /></select>
          </div>
        )}
        <div className="control">
          <label htmlFor="kaPassword">Password</label>
          <input type="password" id="kaPassword" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" placeholder="Minimal 8 karakter" required minLength={8} />
        </div>
        <div className="control">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Tambah
          </button>
        </div>
      </form>
      {msg && <div className={cx('mt-2.5 text-[13px]', msg.ok ? 'text-green' : 'text-red')} role="status">{msg.text}</div>}
    </div>
  );
}

/* ---------- Panel edit pengguna ---------- */
function EditUserPanel({ user, distributors, onClose, onSaved }: { user: User; distributors: Distributor[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(user.name || '');
  const [role, setRole] = useState(user.role);
  const [dist, setDist] = useState(user.dist_code || '');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scoped = DIST_SCOPED_ROLES.includes(role);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw && pw.length < 8) return setErr('Password minimal 8 karakter.');
    if (scoped && !dist) return setErr('Role spv/sales wajib diisi distributornya.');
    const body: Record<string, unknown> = { name: name.trim(), role };
    if (scoped) body.dist_code = dist;
    if (pw) body.password = pw;
    setBusy(true);
    try {
      await adminApi('PUT', `admin/users/${encodeURIComponent(user.username)}`, body);
      onClose();
      await onSaved();
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-3.5">
      <h2 className="card-title !text-[13px] mb-3.5">Edit: {user.username}</h2>
      <form className="controls !mb-0" onSubmit={submit} noValidate>
        <div className="control">
          <label htmlFor="keName">Nama Tampilan</label>
          <input type="text" id="keName" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="control">
          <label htmlFor="keRole">Role</label>
          <select id="keRole" value={role} onChange={e => setRole(e.target.value)}><RoleOptions /></select>
        </div>
        {scoped && (
          <div className="control">
            <label htmlFor="keDist">Distributor</label>
            <select id="keDist" value={dist} onChange={e => setDist(e.target.value)}><DistOptions list={distributors} /></select>
          </div>
        )}
        <div className="control">
          <label htmlFor="keNewPassword">Password Baru (opsional)</label>
          <input type="password" id="keNewPassword" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" placeholder="Kosongkan jika tidak diganti (min. 8 karakter)" minLength={8} />
        </div>
        <div className="control !flex-row gap-2">
          <button type="submit" className="btn btn-primary" disabled={busy}>Simpan</button>
          <button type="button" className="btn" onClick={onClose}>Batal</button>
        </div>
      </form>
      {err && <div className="mt-2.5 text-[13px] text-red" role="alert">{err}</div>}
    </div>
  );
}

/* ---------- Hak akses halaman per role ---------- */
function RolePagesCard({ role, initialPages, initialPerms }: { role: string; initialPages: string[]; initialPerms: Record<string, Perm> }) {
  const [pages, setPages] = useState<Set<string>>(() => new Set(initialPages));
  const [perms, setPerms] = useState<Record<string, Perm>>(() => {
    const out: Record<string, Perm> = {};
    TOGGLEABLE_PAGE_LABELS.forEach(([id]) => { out[id] = initialPerms[id] || { can_view_detail: true, can_download: true }; });
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const showExtra = DIST_SCOPED_ROLES.includes(role);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  function togglePage(id: string) {
    setPages(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function setPerm(id: string, field: keyof Perm, v: boolean) {
    setPerms(prev => ({ ...prev, [id]: { ...prev[id], [field]: v } }));
  }

  async function save() {
    // Urutan halaman mengikuti daftar (sama seperti urutan DOM di kode lama).
    const checked = TOGGLEABLE_PAGE_LABELS.map(([id]) => id).filter(id => pages.has(id));
    // permissions hanya relevan untuk sales/spv (checkbox hanya dirender untuk role itu); mo -> {}.
    const permsBody: Record<string, Perm> = {};
    if (showExtra) TOGGLEABLE_PAGE_LABELS.forEach(([id]) => { permsBody[id] = { ...perms[id] }; });
    setBusy(true);
    try {
      await adminApi('POST', 'admin/role-pages', { role, pages: checked, permissions: permsBody });
      setMsg({ ok: true, text: 'Tersimpan.' });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="card-title !text-[13px] mb-0.5">{ROLE_LABEL[role]}</h2>
      <p className="text-faint text-xs mb-2.5">{ROLE_PAGES_DESC[role]}</p>
      <div>
        {TOGGLEABLE_PAGE_LABELS.map(([id, label]) => (
          <div key={id} className="py-[7px]">
            <label className="flex items-center gap-2 text-[13.5px] cursor-pointer">
              <input type="checkbox" className="w-4 h-4" checked={pages.has(id)} onChange={() => togglePage(id)} />
              {label}
            </label>
            {showExtra && (
              <span className="inline-flex gap-3 ml-[26px] text-xs text-soft">
                <label className="flex items-center gap-[5px] cursor-pointer">
                  <input type="checkbox" className="w-3.5 h-3.5" checked={perms[id].can_view_detail} onChange={e => setPerm(id, 'can_view_detail', e.target.checked)} />Detail
                </label>
                <label className="flex items-center gap-[5px] cursor-pointer">
                  <input type="checkbox" className="w-3.5 h-3.5" checked={perms[id].can_download} onChange={e => setPerm(id, 'can_download', e.target.checked)} />Download
                </label>
              </span>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-primary mt-3" disabled={busy} onClick={save}>Simpan {ROLE_LABEL[role]}</button>
      <span className={cx('font-mono ml-2.5 text-xs', msg && (msg.ok ? 'text-green' : 'text-red'))} role="status">{msg?.text}</span>
    </div>
  );
}

/* ---------- Halaman ---------- */
export default function KelolaAkses() {
  useDocTitle('Kelola Akses');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = async () => { setReloadKey(k => k + 1); };

  // Distributor sekali di awal (gagal -> daftar kosong, sama seperti kode lama); role-pages sekali.
  const init = useAsync(async () => {
    const [distributors, rolePages] = await Promise.all([
      adminApi<Distributor[]>('GET', 'admin/distributor-list').catch(() => [] as Distributor[]),
      adminApi<RolePagesResp>('GET', 'admin/role-pages'),
    ]);
    return { distributors, rolePages };
  }, []);
  const usersState = useAsync(() => adminApi<User[]>('GET', 'admin/users'), [reloadKey]);

  const [editing, setEditing] = useState<string | null>(null);
  const [delUser, setDelUser] = useState<string | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  if (init.error) return <ErrorBox error={init.error} />;
  if (init.loading || !init.data) return <PageSkeleton />;
  const { distributors, rolePages } = init.data;
  const users = usersState.data;
  const editUser = users?.find(u => u.username === editing) || null;

  async function doDelete() {
    if (!delUser) return;
    setDelBusy(true); setDelErr(null);
    try {
      await adminApi('DELETE', `admin/users/${encodeURIComponent(delUser)}`);
      if (editing === delUser) setEditing(null);
      setDelUser(null);
      await reload();
    } catch (e) {
      setDelErr(errMsg(e));
    } finally {
      setDelBusy(false);
    }
  }

  return (
    <div>
      <Breadcrumb items={['Dashboard', 'Kelola Akses']} />
      <PageHeader
        title="Kelola Akses"
        desc="Tambah/ubah/hapus akun (username & password masing-masing orang), dan atur halaman mana yang boleh dibuka role Management & Sales. Semua perubahan di sini langsung berlaku begitu orangnya login lagi -- tidak perlu restart server."
      />

      <AddUserForm distributors={distributors} onCreated={reload} />

      <h2 className="section-title">Daftar Pengguna <span className="n">{users ? `${users.length} akun` : ''}</span></h2>
      {usersState.error && <ErrorBox error={usersState.error} />}
      <TableWrap>
        <table className="mono">
          <thead><tr><th>Username</th><th>Nama</th><th>Role</th><th>Distributor</th><th>Dibuat</th><th style={{ width: '1%' }}>Aksi</th></tr></thead>
          <tbody>
            {!users ? <tr><td colSpan={6} className="text-center text-faint p-5">Memuat…</td></tr>
              : users.length === 0 ? <tr><td colSpan={6} className="text-center text-faint p-5">Belum ada akun.</td></tr>
              : users.map((u: Row) => (
                <tr key={u.username}>
                  <td>{u.username}</td>
                  <td>{u.name || '–'}</td>
                  <td>{roleBadge(u.role)}</td>
                  <td>{u.dist_code || '–'}</td>
                  <td>{u.created_at ? new Date(u.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '–'}</td>
                  <td className="whitespace-nowrap">
                    <button type="button" className="btn !px-2.5 !py-[5px] !text-xs mr-1.5" onClick={() => setEditing(u.username)}>Edit</button>
                    <button type="button" className="btn !px-2.5 !py-[5px] !text-xs !text-red" onClick={() => { setDelErr(null); setDelUser(u.username); }}>Hapus</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </TableWrap>
      {editUser && (
        <EditUserPanel key={editUser.username} user={editUser} distributors={distributors} onClose={() => setEditing(null)} onSaved={reload} />
      )}

      <h2 className="section-title mt-[34px]">Hak Akses Halaman per Role</h2>
      <p className="text-soft text-[13px] -mt-1 mb-4 max-w-[640px]">Semua akun dengan role yang sama otomatis dapat halaman yang sama (centang di bawah). Role Admin selalu dapat semua halaman + Interaksi Web + Kelola Akses, jadi tidak ditampilkan di sini.</p>
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
        {PERM_ROLES.map(role => (
          <RolePagesCard key={role} role={role} initialPages={rolePages.current?.[role] || []} initialPerms={rolePages.permissions?.[role] || {}} />
        ))}
      </div>

      {delUser && (
        <ConfirmDialog title="Hapus akun" busy={delBusy} error={delErr} onConfirm={doDelete} onCancel={() => setDelUser(null)}>
          Hapus akun "{delUser}"? Tindakan ini tidak bisa dibatalkan.
        </ConfirmDialog>
      )}
    </div>
  );
}
