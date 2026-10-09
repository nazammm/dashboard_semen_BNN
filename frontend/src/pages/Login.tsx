import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ROLE_HOME, useAuth } from '../lib/auth';

const lockKey = (u: string) => `st_login_lock_${u.toLowerCase()}`;
interface Lock { fails: number; until: number }
const getLock = (u: string): Lock => { try { return JSON.parse(localStorage.getItem(lockKey(u)) || 'null') || { fails: 0, until: 0 }; } catch { return { fails: 0, until: 0 }; } };
const setLock = (u: string, s: Lock) => { try { localStorage.setItem(lockKey(u), JSON.stringify(s)); } catch { /* ignore */ } };
const lockSecs = (f: number) => (f < 3 ? 0 : f < 5 ? 5 : f < 7 ? 20 : 60);

const REASONS: Record<string, string> = {
  idle: 'Sesi berakhir karena tidak ada aktivitas selama 10 menit. Silakan masuk lagi.',
  expired: 'Sesi berakhir, silakan masuk lagi.',
  norole: 'Akun ini belum diberi akses. Hubungi admin.',
};

export default function Login() {
  const { session, login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const r = sessionStorage.getItem('st_logout_reason');
    if (r) sessionStorage.removeItem('st_logout_reason');
    return r ? REASONS[r] ?? null : null;
  });
  const [, tick] = useState(0);

  // hitung mundur lockout lokal
  const lock = username.trim() ? getLock(username.trim()) : { fails: 0, until: 0 };
  const left = Math.ceil((lock.until - Date.now()) / 1000);
  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => tick(n => n + 1), 500);
    return () => clearInterval(t);
  }, [left > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session) return <Navigate to={ROLE_HOME[session.role]} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const u = username.trim();
    if (!u || !password) { setError('Username & password wajib diisi.'); return; }
    if (getLock(u).until > Date.now()) return;
    setLoading(true);
    try {
      const r = await login(u, password);
      if (!r.ok) {
        if (r.status === 403) { setError(r.error); return; }
        const s = getLock(u); s.fails += 1; const secs = lockSecs(s.fails); s.until = secs ? Date.now() + secs * 1000 : 0; setLock(u, s);
        // Pesan generik (tidak membedakan password salah / akun tidak ada).
        setError(r.status === 429 ? `Terlalu banyak percobaan gagal. Coba lagi dalam ${r.retryAfter ?? 30} detik.` : 'Username atau password salah.');
        return;
      }
      setLock(u, { fails: 0, until: 0 });
      nav('/', { replace: true });
    } catch {
      setError('Tidak bisa terhubung ke server. Hubungi admin/IT.');
    } finally { setLoading(false); }
  }

  const locked = left > 0;
  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden bg-bg">
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute w-[480px] h-[480px] -top-40 -left-[120px] rounded-full blur-[60px] opacity-35" style={{ background: 'radial-gradient(circle,#FF5A1F 0%,transparent 72%)' }} />
        <div className="absolute w-[520px] h-[520px] -bottom-[200px] -right-[140px] rounded-full blur-[60px] opacity-35" style={{ background: 'radial-gradient(circle,#3F7A52 0%,transparent 72%)' }} />
        <div className="absolute -inset-0.5 opacity-50" style={{ backgroundImage: 'radial-gradient(#AFA790 1px,transparent 1px)', backgroundSize: '26px 26px', maskImage: 'radial-gradient(ellipse 70% 60% at 50% 40%,#000 0%,transparent 75%)' }} />
      </div>
      <div className="w-full max-w-[400px] relative z-[1]">
        <div className="card plain px-8 pt-9 pb-7 shadow-[0_8px_30px_rgba(33,30,25,.12)]" role="main">
          <div className="flex items-center gap-3.5 mb-6">
            <img src={`${import.meta.env.BASE_URL}assets/logo.svg`} alt="" className="w-14 h-14 object-contain" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            <div className="font-extrabold text-xl leading-tight text-ink" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif' }}>DASHBOARD<br />SEMEN</div>
          </div>
          <h1 className="text-[28px]">Masuk ke Dashboard</h1>
          <p className="text-soft text-[13.5px] mt-1.5 mb-5">Gunakan username &amp; password yang diberikan admin.</p>
          <form onSubmit={onSubmit} noValidate>
            <div className="control mb-3.5">
              <label htmlFor="fUsername">Username</label>
              <input id="fUsername" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus
                className="w-full" placeholder="Username" value={username} onChange={e => { setUsername(e.target.value); setError(null); }} />
            </div>
            <div className="control mb-3.5">
              <label htmlFor="fPassword">Password</label>
              <div className="relative">
                <input id="fPassword" type={showPw ? 'text' : 'password'} autoComplete="current-password" className="w-full pr-14" placeholder="Password"
                  value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" tabIndex={-1} onClick={() => setShowPw(s => !s)} aria-label={showPw ? 'Sembunyikan password' : 'Tampilkan password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase text-faint hover:text-accent-ink bg-transparent border-0 cursor-pointer">{showPw ? 'Tutup' : 'Lihat'}</button>
              </div>
            </div>
            {(error || locked) && <div role="alert" className="error-box mb-3.5 py-2.5">{locked ? 'Terlalu banyak percobaan gagal. Tunggu sebentar sebelum mencoba lagi.' : error}</div>}
            <button type="submit" disabled={loading || locked} className="btn btn-primary w-full justify-center py-[11px]">
              {loading ? 'Memeriksa…' : locked ? `Coba lagi dalam ${left}d` : 'Masuk'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
