import type { Row } from './types';

/** Alamat API. Default '/api/' (satu origin dengan aplikasi). Bisa diganti lewat VITE_API_URL saat build. */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/';

// --- Penyimpan token (diisi oleh auth.tsx) ---
let tokenGetter: () => string | null = () => null;
let unauthorizedHandler: () => void = () => {};
export function configureApi(opts: { getToken: () => string | null; onUnauthorized: () => void }) {
  tokenGetter = opts.getToken;
  unauthorizedHandler = opts.onUnauthorized;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const SESSION_ENDED = 'Sesi berakhir, silakan login ulang.';

/** fetch dengan retry untuk gangguan jaringan sesaat / 5xx (tidak untuk 4xx). */
async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 2): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 && attempt < maxRetries) { await new Promise(r => setTimeout(r, 400 * (attempt + 1))); continue; }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = tokenGetter();
  if (!token) { unauthorizedHandler(); throw new ApiError(SESSION_ENDED, 401); }
  return { Authorization: `Bearer ${token}`, ...extra };
}

function checkAuth(res: Response) {
  if (res.status === 401) { unauthorizedHandler(); throw new ApiError(SESSION_ENDED, 401); }
}

/** GET tabel/view: path mis. "v_toko_agg?select=*&order=x.asc" */
export async function apiGet<T = Row[]>(path: string): Promise<T> {
  const res = await fetchWithRetry(API_URL + path, { headers: authHeaders() });
  checkAuth(res);
  if (!res.ok) throw new ApiError(`Gagal memuat data (${res.status})`, res.status);
  return res.json() as Promise<T>;
}

/** GET semua halaman (1000 baris per request). */
export async function apiGetAll(view: string, query: string): Promise<Row[]> {
  const pageSize = 1000;
  let offset = 0;
  let out: Row[] = [];
  for (;;) {
    const sep = query.includes('?') ? '&' : '?';
    const rows = await apiGet<Row[]>(`${view}${query}${sep}limit=${pageSize}&offset=${offset}`);
    out = out.concat(rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

export async function apiRpc<T = Row[]>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetchWithRetry(API_URL + 'rpc/' + fn, {
    method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(args),
  });
  checkAuth(res);
  if (!res.ok) throw new ApiError(`Gagal memuat data (${res.status})`, res.status);
  return res.json() as Promise<T>;
}

/** Jumlah baris (header Content-Range) untuk satu tabel/view. */
export async function apiCount(view: string): Promise<number | null> {
  const res = await fetch(API_URL + view + '?select=cust_code&limit=1', { headers: authHeaders({ Prefer: 'count=exact' }) });
  checkAuth(res);
  if (!res.ok) throw new ApiError(`Gagal memuat data (${res.status})`, res.status);
  const range = res.headers.get('content-range');
  if (!range) return null;
  const total = range.split('/')[1];
  return total === '*' ? null : parseInt(total, 10);
}

/** Endpoint /admin/* (khusus admin). */
export async function adminApi<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method, headers: authHeaders({ 'Content-Type': 'application/json' }), body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  checkAuth(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as any).error || `Gagal (${res.status})`, res.status);
  return data as T;
}

/** Catat aktivitas; gagal = diam (tidak boleh mengganggu pemakaian). */
export async function logActivity(eventType: 'page_view' | 'download', pageId?: string | null, detail?: string | null) {
  try {
    const token = tokenGetter();
    if (!token) return;
    await fetch(API_URL + 'activity/log', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: eventType, page_id: pageId || null, detail: detail || null }),
    });
  } catch { /* diam */ }
}

export interface LoginResponse {
  access_token: string; expires_at: number; role: string; username: string; name: string;
  dist_code: string | null; pages: string[]; pagePermissions: Record<string, { can_view_detail: boolean; can_download: boolean }>;
}

/** POST /rpc/login: kembalikan {ok, data|error, retryAfter}. */
export async function apiLogin(username: string, password: string): Promise<
  { ok: true; data: LoginResponse } | { ok: false; status: number; error: string; retryAfter?: number }
> {
  const res = await fetch(API_URL + 'rpc/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: (data as any).error || 'Gagal masuk', retryAfter: (data as any).retry_after_seconds };
  return { ok: true, data: data as LoginResponse };
}
