import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiLogin, configureApi, type LoginResponse } from './api';
import type { PagePerm, Role, Session } from './types';

const SESSION_KEY = 'st_session';
const IDLE_LOGOUT_MS = 10 * 60 * 1000;
export const ROLE_HOME: Record<Role, string> = { admin: '/beranda', mo: '/beranda', sales: '/tim-sales', spv: '/rekap-harian' };
const ROLES: Role[] = ['admin', 'mo', 'sales', 'spv'];

function readSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as Session | null;
    if (!s || !s.access_token || !s.expires_at) return null;
    if (s.expires_at * 1000 <= Date.now() + 30_000) return null;
    if (!ROLES.includes(s.role)) return null;
    return { ...s, pages: s.pages ?? [], pagePermissions: s.pagePermissions ?? {} };
  } catch { return null; }
}

interface AuthCtx {
  session: Session | null;
  login: (username: string, password: string) => ReturnType<typeof apiLogin>;
  logout: (reason?: string) => void;
  pageAllowed: (id: string) => boolean;
  canViewDetail: (id: string) => boolean;
  canDownload: (id: string) => boolean;
}
const Ctx = createContext<AuthCtx | null>(null);

// token terkini untuk lapisan api.ts (di luar React)
let currentToken: string | null = null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readSession());
  const sessionRef = useRef(session);
  sessionRef.current = session;
  currentToken = session?.access_token ?? null;

  const logout = useCallback((reason?: string) => {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    currentToken = null;
    setSession(null);
    if (reason) sessionStorage.setItem('st_logout_reason', reason);
  }, []);

  useEffect(() => {
    configureApi({ getToken: () => currentToken, onUnauthorized: () => logout('expired') });
  }, [logout]);

  // logout dari tab lain
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === SESSION_KEY && !e.newValue) { currentToken = null; setSession(null); } };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // token kedaluwarsa
  useEffect(() => {
    if (!session) return;
    const msLeft = session.expires_at * 1000 - Date.now() - 30_000;
    const t = setTimeout(() => logout('expired'), Math.max(0, Math.min(msLeft, 2_147_483_647)));
    return () => clearTimeout(t);
  }, [session, logout]);

  // idle logout 10 menit
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => logout('idle'), IDLE_LOGOUT_MS); };
    const evts = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
    evts.forEach(e => document.addEventListener(e, reset, { passive: true }));
    const vis = () => { if (!document.hidden) reset(); };
    document.addEventListener('visibilitychange', vis);
    reset();
    return () => { clearTimeout(timer); evts.forEach(e => document.removeEventListener(e, reset)); document.removeEventListener('visibilitychange', vis); };
  }, [session, logout]);

  const login = useCallback(async (username: string, password: string) => {
    const r = await apiLogin(username, password);
    if (r.ok) {
      const d: LoginResponse = r.data;
      if (!ROLES.includes(d.role as Role)) return { ok: false as const, status: 403, error: 'Akun tidak punya role yang dikenali.' };
      const s: Session = { ...d, role: d.role as Role, pages: d.pages ?? [], pagePermissions: (d.pagePermissions ?? {}) as Record<string, PagePerm> };
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ }
      currentToken = s.access_token;
      setSession(s);
    }
    return r;
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    session, login, logout,
    pageAllowed: id => !!session && session.pages.includes(id),
    canViewDetail: id => { const p = session?.pagePermissions[id]; return p ? !!p.can_view_detail : true; },
    canDownload: id => { const p = session?.pagePermissions[id]; return p ? !!p.can_download : true; },
  }), [session, login, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth di luar AuthProvider');
  return c;
}
