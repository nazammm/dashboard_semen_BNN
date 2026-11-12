'use strict';
// SEMENTRACK lokal di atas SQL Server (MARKETING_ANALIS): tampilan web + backend mini.
// Port dari server preview PostgreSQL; meniru API backend .NET (prefix /api), jadi halaman web tidak diubah.
// Dipakai untuk menguji seluruh web terhadap SQL Server sebelum backend .NET diganti.
//  - sesi login disimpan di memori (tidak menulis auth_local.sessions)
//  - aktivitas tidak dicatat; mengubah akun / hak akses di Kelola Akses dimatikan
//  - Kelola Data (upload, hapus, tempel, target, edit tabel) MENULIS ke SQL Server
//
// Aturan SQL Server yang dipakai (lihat docs/mssql/CATATAN.md):
//  - prosedur tulis: EXEC skema.nama @p1, @p2, ... ; pesan pengguna bernomor 52023 -> HTTP 400
//  - fungsi dashboard: SELECT * FROM skema.fn(@p1, ...) ORDER BY ... ; array dikirim sebagai teks JSON
//  - kolom array (teks JSON) diubah kembali jadi array sebelum dikirim ke halaman
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const sql = require('mssql');
const bcrypt = require('bcryptjs');

const DIST_DIR = path.join(__dirname, 'dist');

// ---- Aturan akses (port dari AccessRules.cs) ----
const DashboardPages = ['overview', 'beranda', 'sell-in-bnn', 'outstanding-do', 'sell-out-bnn', 'rekap-harian', 'tim-sales', 'peta-toko', 'daftar-toko', 'transaksi-detail', 'toko-detail'];
const AdminOnlyPages = ['interaksi-web', 'kelola-akses', 'kelola-data'];
const KnownPageIds = new Set([...DashboardPages, ...AdminOnlyPages]);
const DistScopedRoles = ['spv', 'sales'];
const DefaultRolePages = {
  mo: DashboardPages.slice(),
  sales: ['tim-sales', 'rekap-harian', 'peta-toko', 'daftar-toko', 'toko-detail', 'transaksi-detail'],
  spv: ['rekap-harian', 'tim-sales', 'peta-toko', 'daftar-toko', 'toko-detail', 'transaksi-detail'],
};
const DefaultPagePermissions = {
  spv: { 'rekap-harian': [false, false] },
  sales: { 'rekap-harian': [false, false], 'daftar-toko': [true, false], 'peta-toko': [false, true], 'transaksi-detail': [true, false] },
};
const defaultPermFor = (role, p) => {
  const x = DefaultPagePermissions[role] && DefaultPagePermissions[role][p];
  return x ? { can_view_detail: x[0], can_download: x[1] } : { can_view_detail: true, can_download: true };
};
// v_cement_targets_ext dan v_delivery_ext tidak dipindah ke SQL Server (tidak dipakai halaman mana pun)
const AllowedTables = new Set(['v_transaksi_monthly', 'v_distributor_summary', 'v_salesman_performance', 'v_toko_agg', 'v_yearly_totals', 'v_monthly_totals', 'v_dist_monthly_totals', 'produk', 'v_target_dist', 'v_transaksi_detail', 'v_toko_pegangan_sales', 'status_sync', 'toko', 'distributor_target_salesman', 'v_sellin_bnn_daily', 'v_sellin_bnn_info', 'v_data_status', 'v_sellout_bnn_monthly', 'v_sellout_bnn_peta', 'v_sellout_bnn_ta', 'v_target_sell_in', 'v_target_sell_out', 'v_outstanding_do', 'v_outstanding_do_ringkas', 'v_outstanding_do_info', 'v_sellin_po_bulanan']);
const TablesWithDistCode = new Set(['v_salesman_performance', 'v_toko_agg', 'toko', 'v_transaksi_detail', 'v_toko_pegangan_sales', 'v_dist_monthly_totals', 'v_transaksi_monthly', 'distributor_target_salesman']);
const ReadAlias = { toko: 'sementrack.v_toko_multi', v_toko_agg: 'sementrack.v_toko_agg', distributor_target_salesman: 'sementrack.distributor_target_salesman', v_sellin_bnn_daily: 'sementrack.v_sellin_bnn_daily', v_sellin_bnn_info: 'sementrack.v_sellin_bnn_info', v_data_status: 'sementrack.v_data_status', v_sellout_bnn_monthly: 'sementrack.v_sellout_bnn_monthly', v_sellout_bnn_peta: 'sementrack.v_sellout_bnn_peta', v_sellout_bnn_ta: 'sementrack.v_sellout_bnn_ta', v_salesman_performance: 'sementrack.v_salesman_performance', v_toko_pegangan_sales: 'sementrack.v_toko_pegangan_sales', v_transaksi_detail: 'sementrack.v_transaksi_detail', v_target_dist: 'sementrack.v_target_dist', v_target_sell_in: 'sementrack.v_target_sell_in', v_target_sell_out: 'sementrack.v_target_sell_out', v_outstanding_do: 'sementrack.v_outstanding_do', v_outstanding_do_ringkas: 'sementrack.v_outstanding_do_ringkas', v_outstanding_do_info: 'sementrack.v_outstanding_do_info', v_sellin_po_bulanan: 'sementrack.v_sellin_po_bulanan' };
const RANGE_FNS = ['dashboard_period_summary_range', 'dashboard_top_customers_range', 'dashboard_channel_breakdown_range', 'dashboard_payment_breakdown_range', 'dashboard_delivery_type_breakdown_range', 'dashboard_product_breakdown_range'];
const RpcSchema = { dashboard_toko_monthly_v2: 'sementrack', dashboard_top_customers_v2: 'sementrack', dashboard_store_year: 'sementrack' };
RANGE_FNS.forEach((f) => { RpcSchema[f] = 'sementrack'; });
// ORDER BY tidak bisa di dalam fungsi tabel SQL Server: urutan hasil ditambahkan saat memanggil
const RpcOrder = {
  dashboard_top_customers_v2: 'total_qty DESC', dashboard_top_customers_range: 'total_qty DESC',
  dashboard_delivery_type_breakdown: 'total_qty DESC', dashboard_delivery_type_breakdown_range: 'total_qty DESC',
  dashboard_product_breakdown_range: 'total_qty DESC',
  dashboard_channel_breakdown: 'num_do DESC', dashboard_channel_breakdown_range: 'num_do DESC',
  dashboard_payment_breakdown: 'net_amount DESC', dashboard_payment_breakdown_range: 'net_amount DESC',
  dashboard_store_year: '[month]',
};
const RS = ['p_dist_code', 'p_start_date', 'p_end_date', 'p_product_codes'];
const PS = ['p_dist_code', 'p_year', 'p_start_month', 'p_end_month', 'p_product_codes'];
const AllowedFunctions = {
  dashboard_period_summary_v2: PS,
  dashboard_top_customers_v2: [...PS, 'p_limit'],
  dashboard_daily_matrix: ['p_year', 'p_month', 'p_product_codes', 'p_dist_code'],
  dashboard_delivery_type_breakdown: PS,
  dashboard_channel_breakdown: PS,
  dashboard_payment_breakdown: PS,
  dashboard_toko_monthly_v2: ['p_year', 'p_month', 'p_dist_code'],
  dashboard_store_year: ['p_customer_code', 'p_year'],
  dashboard_period_summary_range: RS,
  dashboard_top_customers_range: [...RS, 'p_limit'],
  dashboard_channel_breakdown_range: RS,
  dashboard_payment_breakdown_range: RS,
  dashboard_delivery_type_breakdown_range: RS,
  dashboard_product_breakdown_range: RS,
};
const PageDependencies = {
  beranda: [['v_distributor_summary', 'produk', 'v_target_dist', 'v_toko_agg', 'v_transaksi_monthly', 'v_dist_monthly_totals'], ['dashboard_period_summary_v2', 'dashboard_top_customers_v2', 'dashboard_delivery_type_breakdown', 'dashboard_channel_breakdown', 'dashboard_payment_breakdown', ...RANGE_FNS]],
  'rekap-harian': [['v_distributor_summary', 'v_monthly_totals', 'produk', 'v_target_dist'], ['dashboard_daily_matrix']],
  'tim-sales': [['v_salesman_performance', 'distributor_target_salesman'], []],
  overview: [['v_sellin_bnn_daily', 'v_sellin_bnn_info', 'v_target_sell_in', 'v_sellout_bnn_monthly', 'v_sellout_bnn_peta', 'v_sellout_bnn_ta', 'v_target_sell_out', 'v_outstanding_do_ringkas', 'v_outstanding_do_info', 'v_salesman_performance'], []],
  'sell-in-bnn': [['v_sellin_bnn_daily', 'v_sellin_bnn_info', 'v_target_sell_in'], []],
  'outstanding-do': [['v_outstanding_do', 'v_outstanding_do_ringkas', 'v_outstanding_do_info', 'v_sellin_po_bulanan', 'v_target_sell_in'], []],
  'sell-out-bnn': [['v_sellout_bnn_monthly', 'v_sellout_bnn_peta', 'v_sellout_bnn_ta', 'v_target_sell_out'], []],
  'peta-toko': [['v_monthly_totals'], ['dashboard_toko_monthly_v2']],
  'daftar-toko': [['v_monthly_totals', 'toko'], ['dashboard_toko_monthly_v2']],
  'transaksi-detail': [['produk', 'v_salesman_performance', 'v_toko_pegangan_sales', 'v_transaksi_detail'], []],
  'toko-detail': [['toko', 'v_transaksi_detail'], ['dashboard_store_year']],
};
const RoleOnlyTables = { distributor_target_salesman: ['admin', 'mo'] };

function computeAccess(role, pages) {
  if (role === 'admin') return { tables: new Set(AllowedTables), functions: new Set(Object.keys(AllowedFunctions)) };
  const tables = new Set(['status_sync', 'v_data_status']);
  const functions = new Set();
  for (const p of pages) {
    const dep = PageDependencies[p];
    if (!dep) continue;
    dep[0].forEach((t) => tables.add(t));
    dep[1].forEach((f) => functions.add(f));
  }
  for (const t of [...tables]) if (RoleOnlyTables[t] && !RoleOnlyTables[t].includes(role)) tables.delete(t);
  return { tables, functions };
}
function defaultPagesFor(role) {
  if (role === 'admin') return [...DashboardPages, ...AdminOnlyPages];
  return DefaultRolePages[role] ? DefaultRolePages[role].slice() : [];
}
function mustForceDistScope(role, fn) {
  if (fn === 'dashboard_daily_matrix') return false;
  if (!DistScopedRoles.includes(role)) return false;
  return (AllowedFunctions[fn] || []).includes('p_dist_code');
}

// ---- Query-string bergaya PostgREST (port QueryParser.cs) -> T-SQL ----
const IDENT = /^[a-zA-Z0-9_]+$/;
function parseQuery(searchParams) {
  const r = { where: [], params: [], order: '', limit: null, offset: null };
  const add = (v) => { r.params.push(v); return '@p' + r.params.length; };
  r.add = add;
  const keys = [];
  for (const [k] of searchParams) if (!keys.includes(k)) keys.push(k);
  for (const key of keys) {
    const values = searchParams.getAll(key);
    if (key === 'select') continue;
    if (key === 'order') {
      r.order = values[values.length - 1].split(',').map((part) => {
        const [col, dir] = part.split('.');
        if (!IDENT.test(col)) { const e = new Error('invalid order column'); e.status = 400; throw e; }
        return `[${col}] ${dir === 'desc' ? 'DESC' : 'ASC'}`;
      }).join(', ');
      continue;
    }
    if (key === 'limit') { const n = parseInt(values[0], 10); if (!isNaN(n)) r.limit = n; continue; }
    if (key === 'offset') { const n = parseInt(values[0], 10); if (!isNaN(n)) r.offset = n; continue; }
    if (!IDENT.test(key)) continue;
    for (const v of values) {
      const m = /^(eq|gte|lte|gt|lt|in)\.([\s\S]*)$/.exec(v);
      if (!m) continue;
      const op = m[1]; const val = m[2];
      if (op === 'in') {
        let t = val;
        if (t.startsWith('(')) t = t.slice(1);
        if (t.endsWith(')')) t = t.slice(0, -1);
        const vals = t.split(',').filter((s) => s.length > 0);
        if (vals.length === 0) { r.where.push('1=0'); continue; }
        r.where.push(`[${key}] IN (${vals.map(add).join(',')})`);
      } else {
        const sqlOp = { eq: '=', gte: '>=', lte: '<=', gt: '>' }[op] || '<';
        r.where.push(`[${key}] ${sqlOp} ${add(val)}`);
      }
    }
  }
  return r;
}

// ---- Database ----
let pool;
// kolom berisi array JSON (PostgreSQL: text[] / jsonb) -> dikirim sebagai array
const JSON_ARRAY_COLS = new Set(['dofas_kode', 'j028_customers', 'dist_codes', 'pk', 'filter', 'tahun_list', 'metrik_list', 'bulan']);
const pad2 = (n) => String(n).padStart(2, '0');
function bentuk(rs) {
  // nilai dibentuk sama dengan backend lama: date "YYYY-MM-DD", time "HH:MM:SS", bigint angka, array JSON jadi array
  if (!rs) return [];
  const cols = rs.columns || {};
  const tipe = {};
  for (const [name, c] of Object.entries(cols)) tipe[name] = c.type;
  return rs.map((row) => {
    for (const k of Object.keys(row)) {
      const v = row[k];
      if (v === null || v === undefined) continue;
      const t = tipe[k];
      if (v instanceof Date) {
        if (t === sql.Date) row[k] = v.toISOString().slice(0, 10);
        else if (t === sql.Time) row[k] = `${pad2(v.getUTCHours())}:${pad2(v.getUTCMinutes())}:${pad2(v.getUTCSeconds())}`;
      } else if (t === sql.BigInt && typeof v === 'string') row[k] = Number(v);
      else if (typeof v === 'string' && JSON_ARRAY_COLS.has(k) && v.startsWith('[')) {
        try { row[k] = JSON.parse(v); } catch (e) { /* biarkan teks */ }
      }
    }
    return row;
  });
}
function masukkan(req, params) {
  (params || []).forEach((v, i) => {
    const n = 'p' + (i + 1);
    if (v === null || v === undefined) req.input(n, sql.NVarChar(4000), null);
    else if (v instanceof Date) req.input(n, sql.DateTimeOffset(3), v);
    else if (typeof v === 'number') req.input(n, Number.isInteger(v) ? sql.BigInt : sql.Float, v);
    else { const s = String(v); req.input(n, s.length > 4000 ? sql.NVarChar(sql.MAX) : sql.NVarChar(4000), s); }
  });
  return req;
}
async function q(text, params) { const r = await masukkan(pool.request(), params).query(text); return bentuk(r.recordset); }
const cache = new Map();
async function qCached(text, params, ttl = 45) {
  const key = text + '\u0001' + JSON.stringify(params);
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttl * 1000) return hit.p;
  const p = q(text, params);
  cache.set(key, { at: now, p });
  try { return await p; } catch (e) { cache.delete(key); throw e; } finally {
    if (cache.size > 300) for (const [k, v] of cache) if (now - v.at >= ttl * 1000) cache.delete(k);
  }
}
const json = (v) => JSON.stringify(v);   // array -> teks JSON untuk parameter

// ---- Sesi (memori saja) & hak halaman ----
const sessions = new Map();
const SESSION_HOURS = 8;
const nowSec = () => Math.floor(Date.now() / 1000);
function getSession(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return [null, 401, 'missing token'];
  const s = sessions.get(token);
  if (!s || s.expires_at < nowSec()) return [null, 401, 'expired'];
  return [s, 200, null];
}
const rolePagesCache = new Map();
async function getPagesForRole(role) {
  if (role === 'admin') return defaultPagesFor('admin');
  if (!DefaultRolePages[role]) return [];
  if (rolePagesCache.has(role)) return rolePagesCache.get(role);
  let pages;
  try {
    const rows = await q('SELECT page_id FROM auth_local.role_pages WHERE role = @p1 ORDER BY page_id', [role]);
    pages = rows.length > 0 ? rows.map((x) => x.page_id).filter((x) => x !== '__none__' && KnownPageIds.has(x)) : defaultPagesFor(role);
  } catch (e) { pages = defaultPagesFor(role); }
  rolePagesCache.set(role, pages);
  return pages;
}
async function getPagePermissions(role, pages) {
  const out = {};
  if (role === 'admin' || role === 'mo') { pages.forEach((p) => { out[p] = { can_view_detail: true, can_download: true }; }); return out; }
  let saved = {};
  try {
    const rows = await q('SELECT page_id, can_view_detail, can_download FROM auth_local.role_pages WHERE role = @p1', [role]);
    rows.forEach((r) => { saved[r.page_id] = { can_view_detail: r.can_view_detail, can_download: r.can_download }; });
  } catch (e) { saved = {}; }
  pages.forEach((p) => { out[p] = saved[p] || defaultPermFor(role, p); });
  return out;
}

// ---- Pembatas login sederhana (per akun) ----
const fails = new Map();
const lockMs = (n) => (n >= 15 ? 900000 : n >= 10 ? 120000 : n >= 5 ? 30000 : 0);
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8n6/wQJj6ZkvXWGvcH4PmlLbUj3qQy';

// ---- HTTP helpers ----
function send(res, status, obj, extra) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra || {}));
  res.end(body);
}
const err = (res, status, msg) => send(res, status, { error: msg });
function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve) => {
    const parts = []; let size = 0; let tooBig = false;
    req.on('data', (c) => { size += c.length; if (size > limit) tooBig = true; else parts.push(c); });
    req.on('end', () => {
      if (tooBig) return resolve({ __tooBig: true });
      try { const j = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); resolve(j && typeof j === 'object' && !Array.isArray(j) ? j : {}); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}
const scalar = (v) => (v === undefined || v === null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function logDbError(where, e) { console.error(`[${where}] ${e.number || e.code || ''} ${e.message}`); }

// Jenis galat SQL Server -> tanggapan HTTP
const nomor = (e) => e.number || (e.originalError && e.originalError.info && e.originalError.info.number) || 0;
const GALAT_NILAI = new Set([245, 241, 242, 8114, 8115, 8152, 2628, 9803, 13609, 517]);   // konversi / angka / teks terlalu panjang / JSON
const GALAT_DATA = new Set([547, 2627, 2601, 515]);                                       // relasi / kunci ganda / wajib isi
function tanggapanGalat(res, e, where, pesanUmum) {
  const n = nomor(e);
  if (n === 52023) return err(res, 400, e.message);
  if (GALAT_DATA.has(n)) return err(res, 400, 'Data ditolak database: ' + e.message);
  if (GALAT_NILAI.has(n)) return err(res, 400, 'parameter tidak valid');
  logDbError(where, e); return err(res, 500, pesanUmum);
}

// ---- Endpoint API ----
async function handleApi(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '') || '/';
  const m = req.method;

  if (p === '/' && m === 'GET') return send(res, 200, { ok: true, message: 'SEMENTRACK lokal (SQL Server) jalan.', version: 'lokal-mssql' });

  if (p === '/rpc/login' && m === 'POST') {
    const b = await readBody(req);
    const uname = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!uname || uname.length > 64 || password.length > 256) { await sleep(300); return err(res, 401, 'invalid credentials'); }
    const f = fails.get(uname);
    if (f && f.until > Date.now()) return send(res, 429, { error: 'too many failed attempts, try again later', retry_after_seconds: Math.ceil((f.until - Date.now()) / 1000) });
    let u;
    try {
      const rows = await q('SELECT username, password_hash, role, name, dist_code FROM auth_local.users WHERE username = @p1', [uname]);
      u = rows[0];
    } catch (e) { logDbError('login', e); return err(res, 500, 'server error'); }
    await sleep(300);
    let ok = false;
    try { ok = bcrypt.compareSync(password, (u && u.password_hash) || DUMMY_HASH) && !!u; } catch (e) { ok = false; }
    if (!ok) {
      const rec = fails.get(uname) || { n: 0, until: 0 };
      rec.n++; const d = lockMs(rec.n); if (d) rec.until = Date.now() + d;
      fails.set(uname, rec);
      console.log(`[login] gagal untuk "${uname}"` + (u ? ' (password tidak cocok)' : ' (username tidak ada di auth_local.users)'));
      return err(res, 401, 'invalid credentials');
    }
    fails.delete(uname);
    const role = u.role; const name = u.name || u.username; const dist_code = u.dist_code || null;
    const token = crypto.randomBytes(32).toString('hex');
    const expires_at = nowSec() + SESSION_HOURS * 3600;
    sessions.set(token, { token, username: u.username, role, name, dist_code, expires_at });
    const pages = await getPagesForRole(role);
    const pagePermissions = await getPagePermissions(role, pages);
    console.log(`[login] berhasil: ${u.username} (${role}${dist_code ? ', ' + dist_code : ''})`);
    return send(res, 200, { access_token: token, expires_at, role, username: u.username, name, dist_code, pages, pagePermissions });
  }

  if (p === '/auth/logout' && m === 'POST') {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) sessions.delete(h.slice(7));
    return send(res, 200, { ok: true });
  }

  const [s, st, e0] = getSession(req);

  if (p === '/activity/log' && m === 'POST') { if (!s) return err(res, st, e0); await readBody(req); return send(res, 200, { ok: true }); }

  if (p === '/data-freshness' && m === 'GET') {
    if (!s) return err(res, st, e0);
    try { const rows = await q('SELECT MAX(do_date) AS max_do_date FROM dbo.transaksi'); return send(res, 200, { max_do_date: rows.length ? rows[0].max_do_date : null }); }
    catch (e) { logDbError('data-freshness', e); return err(res, 500, 'Gagal mengambil kesegaran data.'); }
  }

  if (p === '/toko-count' && m === 'GET') {
    if (!s) return err(res, st, e0);
    try {
      const access = computeAccess(s.role, await getPagesForRole(s.role));
      if (!access.tables.has('v_toko_agg')) return err(res, 403, 'role ini tidak boleh mengakses data ini');
      // subdist bukan toko: tidak ikut jumlah toko terdaftar
      let where = ' WHERE NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer sc WHERE sc.dist_code = a.dist_code AND sc.customer_code = a.cust_code)'; const pars = [];
      if (DistScopedRoles.includes(s.role)) { if (!s.dist_code) return send(res, 200, { count: 0 }); pars.push(s.dist_code); where += ' AND a.[dist_code] IN (@p1)'; }
      const rows = await q(`SELECT COUNT(DISTINCT a.[cust_code]) AS c FROM ${ReadAlias.v_toko_agg} a${where}`, pars);
      return send(res, 200, { count: rows.length ? rows[0].c : 0 });
    } catch (e) { logDbError('toko-count', e); return err(res, 500, 'Gagal menghitung toko.'); }
  }

  if (p.startsWith('/admin/sellin/')) return handleSellin(req, res, url, p, m);
  if (p.startsWith('/admin/outstanding/')) return handleOutstanding(req, res, url, p, m);
  if (p === '/admin/tabel' || p.startsWith('/admin/tabel/')) return handleTabel(req, res, url, p, m);
  if (p.startsWith('/admin/transaksi/') || p.startsWith('/admin/data/')) return handleKelola(req, res, url, p, m);

  if (p.startsWith('/admin/')) {
    if (!s) return err(res, st, e0);
    if (s.role !== 'admin') return err(res, 403, 'khusus akun admin');
    if (m !== 'GET') return err(res, 403, 'Mode lokal: perubahan akun/hak akses dimatikan. Lakukan di web utama.');
    try {
      if (p === '/admin/users') return send(res, 200, await q('SELECT username, name, role, dist_code, created_at FROM auth_local.users ORDER BY role, username'));
      if (p === '/admin/distributor-list') return send(res, 200, await q("SELECT dist_code, dist_name FROM dbo.distributor WHERE tag = N'Distributor' ORDER BY dist_code"));
      if (p === '/admin/role-pages') {
        const mo = await getPagesForRole('mo'); const sales = await getPagesForRole('sales'); const spv = await getPagesForRole('spv');
        return send(res, 200, { allPages: DashboardPages, current: { mo, sales, spv }, permissions: { sales: await getPagePermissions('sales', sales), spv: await getPagePermissions('spv', spv) } });
      }
      if (p === '/admin/activity') {
        const since30 = new Date(Date.now() - 30 * 86400000);
        const d = new Date(); d.setHours(0, 0, 0, 0);
        const cnt = async (ev, t) => (await q("SELECT COUNT(*) AS c FROM auth_local.activity_log WHERE event_type = @p1 AND LOWER(role) <> N'admin' AND created_at >= @p2", [ev, t]))[0].c;
        const active = (await q("SELECT COUNT(DISTINCT username) AS c FROM auth_local.activity_log WHERE LOWER(role) <> N'admin' AND created_at >= @p1", [d]))[0].c;
        return send(res, 200, {
          summary: { logins_today: await cnt('login', d), page_views_today: await cnt('page_view', d), downloads_today: await cnt('download', d), active_users_today: active },
          active_users_by_role: await q("SELECT role, username, MAX(name) AS name, MAX(created_at) AS last_activity FROM auth_local.activity_log WHERE LOWER(role) <> N'admin' AND created_at >= @p1 GROUP BY role, username ORDER BY role, last_activity DESC", [d]),
          recent_logins: await q("SELECT TOP (20) username, name, role, created_at FROM auth_local.activity_log WHERE event_type = N'login' AND LOWER(role) <> N'admin' ORDER BY created_at DESC"),
          page_view_counts: await q("SELECT page_id, COUNT(*) AS c FROM auth_local.activity_log WHERE event_type = N'page_view' AND LOWER(role) <> N'admin' AND page_id IS NOT NULL AND created_at >= @p1 GROUP BY page_id ORDER BY c DESC", [since30]),
          recent_downloads: await q("SELECT TOP (20) username, name, detail, created_at FROM auth_local.activity_log WHERE event_type = N'download' AND LOWER(role) <> N'admin' ORDER BY created_at DESC"),
          recent_activity: await q("SELECT TOP (50) username, name, role, event_type, page_id, detail, created_at FROM auth_local.activity_log WHERE LOWER(role) <> N'admin' ORDER BY created_at DESC"),
        });
      }
      return err(res, 404, 'not found');
    } catch (e) { logDbError(p, e); return err(res, 500, 'Gagal mengambil data admin.'); }
  }

  const rpc = /^\/rpc\/([a-zA-Z0-9_]+)$/.exec(p);
  if (rpc && m === 'POST') {
    const fn = rpc[1];
    if (!s) return err(res, st, e0);
    const argNames = AllowedFunctions[fn];
    if (!argNames) return err(res, 404, 'unknown function');
    try {
      const access = computeAccess(s.role, await getPagesForRole(s.role));
      if (!access.functions.has(fn)) return err(res, 403, 'role ini tidak boleh memanggil fungsi ini');
      const body = await readBody(req);
      const distCodes = s.dist_code ? [s.dist_code] : [];
      const force = argNames.includes('p_dist_code') && mustForceDistScope(s.role, fn);
      if (fn === 'dashboard_store_year' && DistScopedRoles.includes(s.role)) {
        const rows = distCodes.length === 0 ? [] : await q("SELECT 1 AS ada FROM sementrack.toko_distributor WHERE cust_code = @p1 AND dist_code IN (SELECT value FROM OPENJSON(@p2))", [scalar(body.p_customer_code), json(distCodes)]);
        if (rows.length === 0) return send(res, 200, []);
      }
      // argumen berurutan sesuai AllowedFunctions; array -> teks JSON
      const pars = [];
      for (const name of argNames) {
        if (name === 'p_dist_code' && force) { pars.push(json(distCodes)); continue; }
        const has = Object.prototype.hasOwnProperty.call(body, name);
        const v = has ? body[name] : undefined;
        if (name === 'p_dist_code' && v !== undefined && v !== null && !Array.isArray(v)) pars.push(json([scalar(v)]));
        else if (Array.isArray(v)) pars.push(json(v.map(scalar)));
        else pars.push(v === undefined ? null : scalar(v));
      }
      const schema = RpcSchema[fn] || 'dbo';
      const order = RpcOrder[fn] ? ' ORDER BY ' + RpcOrder[fn] : '';
      return send(res, 200, await qCached(`SELECT * FROM ${schema}.${fn}(${pars.map((_, i) => '@p' + (i + 1)).join(', ')})${order}`, pars));
    } catch (e) {
      if (GALAT_NILAI.has(nomor(e))) return err(res, 400, 'parameter tidak valid');
      logDbError('RPC ' + fn, e); return send(res, 500, { error: 'query failed' });
    }
  }

  const tbl = /^\/([a-zA-Z0-9_]+)$/.exec(p);
  if (tbl && m === 'GET') {
    const table = tbl[1];
    if (!s) return err(res, st, e0);
    if (!AllowedTables.has(table)) return err(res, 404, 'unknown table');
    const sqlTable = ReadAlias[table] || 'dbo.' + table;
    try {
      const access = computeAccess(s.role, await getPagesForRole(s.role));
      if (!access.tables.has(table)) return err(res, 403, 'role ini tidak boleh mengakses data ini');
      const pq = parseQuery(url.searchParams);
      if (DistScopedRoles.includes(s.role) && TablesWithDistCode.has(table)) {
        if (!s.dist_code) return send(res, 200, []);
        pq.where.push(`[dist_code] IN (${pq.add(s.dist_code)})`);
      }
      const whereSql = pq.where.length ? ' WHERE ' + pq.where.join(' AND ') : '';
      const extra = {};
      if (req.headers.prefer === 'count=exact') {
        const c = await q(`SELECT COUNT(*) AS c FROM ${sqlTable}${whereSql}`, pq.params);
        extra['Content-Range'] = `0-0/${c[0].c}`;
      }
      const pars = pq.params.slice();
      const lim = pq.limit !== null ? Math.min(Math.max(pq.limit, 0), 10000) : 1000;
      const off = pq.offset !== null ? Math.max(pq.offset, 0) : 0;
      pars.push(off); const pOff = '@p' + pars.length;
      pars.push(lim); const pLim = '@p' + pars.length;
      // OFFSET/FETCH butuh ORDER BY; tanpa urutan dari halaman urutannya bebas (sama seperti PostgreSQL)
      const text = `SELECT * FROM ${sqlTable}${whereSql} ORDER BY ${pq.order || '(SELECT NULL)'} OFFSET ${pOff} ROWS FETCH NEXT ${pLim} ROWS ONLY`;
      return send(res, 200, await qCached(text, pars), extra);
    } catch (e) {
      if (e.status === 400) return err(res, 400, e.message);
      if (GALAT_NILAI.has(nomor(e)) || nomor(e) === 207) return err(res, 400, 'nilai filter / nama kolom tidak valid');
      logDbError('GET ' + table, e); return send(res, 500, { error: 'query failed' });
    }
  }

  return err(res, 404, 'not found');
}

// ---- Upload Sell In BNN (admin): logika di prosedur sementrack.sellin_bnn_* ----
async function handleSellin(req, res, url, p, m) {
  const [s, st, e0] = getSession(req);
  if (!s) return err(res, st, e0);
  if (s.role !== 'admin') return err(res, 403, 'khusus akun admin');
  const one = async (text, params) => (await q(text, params))[0];
  try {
    if (m === 'GET' && p === '/admin/sellin/uploads') return send(res, 200, await q('SELECT TOP (30) id, created_at, created_by, source, file_name, date_from, date_to, rows_read, rows_saved, rows_replaced, ton_saved, status FROM sementrack.sellin_bnn_upload ORDER BY id DESC'));
    if (m === 'GET' && p === '/admin/sellin/unmapped') return send(res, 200, await q('SELECT * FROM sementrack.v_sellin_unmapped ORDER BY CASE WHEN ton IS NULL THEN 1 ELSE 0 END, ton DESC'));
    if (m === 'GET' && p === '/admin/sellin/region-map') return send(res, 200, await q('SELECT kode_customer, region, nama_customer, updated_at, updated_by FROM sementrack.sellin_region_map ORDER BY region, kode_customer'));
    if (m === 'GET' && p === '/admin/sellin/impact') return send(res, 200, (await one('EXEC sementrack.sellin_bnn_impact @p1, @p2', [url.searchParams.get('from'), url.searchParams.get('to')])) || {});
    if (m !== 'POST') return err(res, 404, 'not found');
    const b = await readBody(req, p === '/admin/sellin/stage' ? 12 * 1024 * 1024 : 256 * 1024);
    if (b.__tooBig) return err(res, 413, 'paket terlalu besar');
    if (p === '/admin/sellin/region-map') {
      await q('EXEC sementrack.sellin_region_set @p1, @p2, @p3, @p4', [scalar(b.kode_customer), scalar(b.region), scalar(b.nama_customer), s.username]);
      cache.clear(); return send(res, 200, { ok: true });
    }
    if (p === '/admin/sellin/begin') {
      const r = await one('EXEC sementrack.sellin_bnn_begin @p1, @p2, @p3, @p4, @p5, @p6', [s.username, scalar(b.source), scalar(b.file_name), scalar(b.date_from), scalar(b.date_to), scalar(b.rows_read) || '0']);
      return send(res, 200, { id: Number(r.id) });
    }
    if (p === '/admin/sellin/stage') {
      if (!Array.isArray(b.rows)) return err(res, 400, 'paket baris tidak valid');
      const r = await one('EXEC sementrack.sellin_bnn_stage @p1, @p2', [scalar(b.upload_id), json(b.rows)]);
      return send(res, 200, { staged: r.n });
    }
    if (p === '/admin/sellin/commit') {
      const r = await one('EXEC sementrack.sellin_bnn_commit @p1', [scalar(b.upload_id)]);
      cache.clear(); return send(res, 200, r);
    }
    if (p === '/admin/sellin/abort') { await q('EXEC sementrack.sellin_bnn_abort @p1', [scalar(b.upload_id)]); return send(res, 200, { ok: true }); }
    return err(res, 404, 'not found');
  } catch (e) { return tanggapanGalat(res, e, 'sellin ' + p, 'Gagal memproses data sell in.'); }
}

// ---- Upload Outstanding DO (admin): logika di prosedur sementrack.sellin_po_* ----
async function handleOutstanding(req, res, url, p, m) {
  const [s, st, e0] = getSession(req);
  if (!s) return err(res, st, e0);
  if (s.role !== 'admin') return err(res, 403, 'khusus akun admin');
  const one = async (text, params) => (await q(text, params))[0];
  try {
    if (m === 'GET' && p === '/admin/outstanding/impact') return send(res, 200, (await one('EXEC sementrack.sellin_po_impact @p1, @p2', [url.searchParams.get('from'), url.searchParams.get('to')])) || {});
    if (m !== 'POST') return err(res, 404, 'not found');
    const b = await readBody(req, p === '/admin/outstanding/stage' ? 12 * 1024 * 1024 : 256 * 1024);
    if (b.__tooBig) return err(res, 413, 'paket terlalu besar');
    if (p === '/admin/outstanding/begin') {
      const r = await one('EXEC sementrack.sellin_po_begin @p1, @p2, @p3, @p4, @p5, @p6', [s.username, scalar(b.source), scalar(b.file_name), scalar(b.date_from), scalar(b.date_to), scalar(b.rows_read) || '0']);
      return send(res, 200, { id: Number(r.id) });
    }
    if (p === '/admin/outstanding/stage') {
      if (!Array.isArray(b.rows)) return err(res, 400, 'paket baris tidak valid');
      const r = await one('EXEC sementrack.sellin_po_stage @p1, @p2', [scalar(b.upload_id), json(b.rows)]);
      return send(res, 200, { staged: r.n });
    }
    if (p === '/admin/outstanding/commit') {
      const r = await one('EXEC sementrack.sellin_po_commit @p1', [scalar(b.upload_id)]);
      cache.clear(); return send(res, 200, r);
    }
    if (p === '/admin/outstanding/abort') { await q('EXEC sementrack.sellin_po_abort @p1', [scalar(b.upload_id)]); return send(res, 200, { ok: true }); }
    return err(res, 404, 'not found');
  } catch (e) { return tanggapanGalat(res, e, 'outstanding ' + p, 'Gagal memproses data outstanding DO.'); }
}

// ---- Kelola Data → Tabel (admin): edit tabel master; daftar & aturan di sementrack.tabel_edit ----
async function handleTabel(req, res, url, p, m) {
  const [s, st, e0] = getSession(req);
  if (!s) return err(res, st, e0);
  if (s.role !== 'admin') return err(res, 403, 'khusus akun admin');
  try {
    if (m === 'GET' && p === '/admin/tabel') return send(res, 200, await q('SELECT id, grup, label, keterangan, pk, kolom, filter FROM sementrack.tabel_edit WHERE aktif = 1 ORDER BY urutan, label'));
    const mm = /^\/admin\/tabel\/([a-z0-9_]+)(\/opsi)?$/.exec(p);
    if (!mm) return err(res, 404, 'not found');
    const id = mm[1];
    if (m === 'GET' && mm[2]) return send(res, 200, JSON.parse((await q('EXEC sementrack.tabel_opsi @p1', [id]))[0].j));
    if (m === 'GET') {
      const filter = Object.fromEntries(url.searchParams.entries());
      return send(res, 200, JSON.parse((await q('EXEC sementrack.tabel_baca @p1, @p2', [id, json(filter)]))[0].j));
    }
    if (m !== 'POST' || mm[2]) return err(res, 404, 'not found');
    const b = await readBody(req, 12 * 1024 * 1024);
    if (b.__tooBig) return err(res, 413, 'paket terlalu besar');
    if (!Array.isArray(b.upsert) || !Array.isArray(b.delete)) return err(res, 400, 'perubahan tidak valid');
    const r = (await q('EXEC sementrack.tabel_simpan @p1, @p2, @p3, @p4', [id, s.username, json(b.upsert), json(b.delete)]))[0];
    cache.clear(); return send(res, 200, r);
  } catch (e) { return tanggapanGalat(res, e, 'tabel ' + p, 'Gagal memproses tabel.'); }
}

// ---- Kelola Data (admin): upload transaksi, hapus, riwayat, status sinkronisasi, sell out, target ----
const strArr = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean))] : []);
async function handleKelola(req, res, url, p, m) {
  const [s, st, e0] = getSession(req);
  if (!s) return err(res, st, e0);
  if (s.role !== 'admin') return err(res, 403, 'khusus akun admin');
  const one = async (text, params) => (await q(text, params))[0];
  try {
    if (m === 'GET' && p === '/admin/data/riwayat') return send(res, 200, await q('SELECT TOP (50) * FROM sementrack.v_kelola_riwayat ORDER BY created_at DESC'));
    if (m === 'GET' && p === '/admin/data/status-sync') return send(res, 200, (await one('SELECT tanggal_update, jam_update, keterangan FROM dbo.status_sync WHERE id = 1')) || {});
    if (m === 'GET' && p === '/admin/data/target-ringkas') return send(res, 200, await q('SELECT * FROM sementrack.v_target_ringkas ORDER BY jenis, tahun DESC, metrik'));
    if (m === 'GET' && p === '/admin/data/target') {
      const tahun = Number(url.searchParams.get('tahun'));
      if (!Number.isInteger(tahun)) return err(res, 400, 'tahun tidak valid');
      return send(res, 200, await q('SELECT metrik, tahun, bulan, region, area, tipe, kode, nama, status, nilai FROM sementrack.target WHERE jenis = @p1 AND tahun = @p2 ORDER BY region, area, tipe, kode, metrik, bulan', [url.searchParams.get('jenis'), tahun]));
    }
    if (m === 'GET' && p === '/admin/data/distributor') return send(res, 200, await q('SELECT dist_code, dist_name FROM dbo.distributor ORDER BY dist_code'));
    if (m !== 'POST') return err(res, 404, 'not found');
    const b = await readBody(req, p === '/admin/transaksi/stage' || p === '/admin/data/sellout' || p === '/admin/data/target' ? 12 * 1024 * 1024 : 256 * 1024);
    if (b.__tooBig) return err(res, 413, 'paket terlalu besar');
    const dists = strArr(b.dist_codes);
    switch (p) {
      case '/admin/transaksi/impact':
        return send(res, 200, await q('EXEC sementrack.transaksi_impact @p1, @p2, @p3', [scalar(b.date_from), scalar(b.date_to), json(dists)]));
      case '/admin/transaksi/begin': {
        const r = await one('EXEC sementrack.transaksi_begin @p1, @p2, @p3, @p4, @p5, @p6, @p7', [s.username, scalar(b.source), scalar(b.file_name), scalar(b.date_from), scalar(b.date_to), json(dists), scalar(b.rows_read) || '0']);
        return send(res, 200, { id: Number(r.id) });
      }
      case '/admin/transaksi/stage': {
        if (!Array.isArray(b.rows)) return err(res, 400, 'paket baris tidak valid');
        const r = await one('EXEC sementrack.transaksi_stage @p1, @p2', [scalar(b.upload_id), json(b.rows)]);
        return send(res, 200, { staged: r.n });
      }
      case '/admin/transaksi/commit': {
        const r = await one('EXEC sementrack.transaksi_commit @p1', [scalar(b.upload_id)]);
        cache.clear(); return send(res, 200, r);
      }
      case '/admin/transaksi/abort':
        await q('EXEC sementrack.transaksi_abort @p1', [scalar(b.upload_id)]); return send(res, 200, { ok: true });
      case '/admin/data/hapus-pratinjau':
        return send(res, 200, await one('EXEC sementrack.kelola_hapus_pratinjau @p1, @p2, @p3, @p4', [scalar(b.dataset), scalar(b.date_from), scalar(b.date_to), dists.length ? json(dists) : null]));
      case '/admin/data/hapus': {
        if (b.konfirmasi !== 'HAPUS') return err(res, 400, 'konfirmasi hapus tidak valid');
        const r = await one('EXEC sementrack.kelola_hapus @p1, @p2, @p3, @p4, @p5', [scalar(b.dataset), scalar(b.date_from), scalar(b.date_to), dists.length ? json(dists) : null, s.username]);
        cache.clear(); return send(res, 200, { deleted: r.n });
      }
      case '/admin/data/sellout': {
        if (!Array.isArray(b.rows)) return err(res, 400, 'baris tidak valid');
        if (b.dataset === 'j073') {
          const r = await one('EXEC sementrack.sellout_j073_simpan @p1, @p2, @p3', [json(b.rows), s.username, scalar(b.file_name) || null]);
          cache.clear(); return send(res, 200, r);
        }
        const fn = { dofas: 'sellout_dofas_simpan', erp: 'sellout_erp_simpan' }[b.dataset];
        if (!fn) return err(res, 400, 'dataset harus dofas, erp, atau j073');
        const r = await one(`EXEC sementrack.${fn} @p1, @p2, @p3`, [scalar(b.tahun), json(b.rows), s.username]);
        cache.clear(); return send(res, 200, r);
      }
      case '/admin/data/target': {
        if (!Array.isArray(b.rows)) return err(res, 400, 'baris tidak valid');
        const r = await one('EXEC sementrack.target_simpan @p1, @p2, @p3, @p4', [scalar(b.jenis), json(b.rows), s.username, scalar(b.file_name) || null]);
        cache.clear(); return send(res, 200, r);
      }
      case '/admin/data/status-sync':
        await q('EXEC sementrack.status_sync_set @p1, @p2, @p3', [scalar(b.tanggal_update), scalar(b.jam_update) || null, scalar(b.keterangan)]);
        cache.clear(); return send(res, 200, { ok: true });
      default: return err(res, 404, 'not found');
    }
  } catch (e) { return tanggapanGalat(res, e, 'kelola ' + p, 'Gagal memproses data.'); }
}

// ---- File statis (hasil build React) ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, url) {
  const rel = decodeURIComponent(url.pathname);
  let file = path.normalize(path.join(DIST_DIR, rel));
  if (!file.startsWith(DIST_DIR)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) file = path.join(DIST_DIR, 'index.html');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': file.includes(path.sep + 'assets' + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

// ---- Isian di layar: satu readline; password tidak tampil ----
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
rl._writeToOutput = function (str) { if (!this.sembunyi) this.output.write(str); };
rl.on('SIGINT', () => { process.stdout.write('\n'); process.exit(1); });
const antre = []; const tunggu = [];
rl.on('line', (l) => (tunggu.length ? tunggu.shift()(l) : antre.push(l)));
const baris = () => new Promise((r) => (antre.length ? r(antre.shift()) : tunggu.push(r)));
async function ask(label, def) {
  process.stdout.write(`${label}${def ? ` [${def}]` : ''}: `);
  const j = (await baris()) || '';
  if (!process.stdin.isTTY) process.stdout.write('\n');
  return j.trim() || def || '';
}
async function askHidden(label) {
  process.stdout.write(`${label}: `);
  rl.sembunyi = true;
  const j = await baris();
  rl.sembunyi = false;
  process.stdout.write('\n');
  return j || '';
}

async function main() {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) { console.error('Folder dist tidak ditemukan. Ekstrak SELURUH isi zip ke satu folder.'); process.exit(1); }
  console.log('\nSEMENTRACK lokal di atas SQL Server\n');
  const server = process.env.DB_SERVER || await ask('  Server (seperti di kotak "Server name" SSMS)', '6MN1134');
  const database = process.env.DB_NAME || await ask('  Database', 'MARKETING_ANALIS');
  const user = process.env.DB_USER || await ask('  Login', 'mktagent');
  const password = process.env.DB_PASSWORD || await askHidden('  Password (tidak tampil)');
  rl.pause();

  let host = server; let instanceName; let port;
  if (server.includes('\\')) [host, instanceName] = server.split('\\');
  else if (server.includes(',')) { [host, port] = server.split(','); port = Number(port); }
  pool = new sql.ConnectionPool({
    server: host, database, user, password, ...(port ? { port } : {}),
    options: { ...(instanceName ? { instanceName } : {}), encrypt: true, trustServerCertificate: true, useUTC: true },
    pool: { max: 8, min: 0 }, requestTimeout: 5 * 60 * 1000, connectionTimeout: 30000,
  });
  pool.on('error', (e) => console.error('[db]', e.message));
  console.log(`\nMenghubungkan ke SQL Server ${server}/${database} sebagai ${user} ...`);
  try {
    await pool.connect();
    const r = await q('SELECT (SELECT COUNT(*) FROM auth_local.users) AS akun, (SELECT MAX(do_date) FROM dbo.transaksi) AS data_terakhir');
    console.log(`Terhubung. Akun di auth_local.users: ${r[0].akun}. Data transaksi terakhir: ${r[0].data_terakhir}`);
  } catch (e) {
    console.error('\nGAGAL terhubung / membaca database:');
    console.error('  ' + (nomor(e) ? nomor(e) + ' ' : '') + e.message);
    if (nomor(e) === 18456) console.error('  -> Login atau password salah.');
    process.exit(1);
  }

  const web = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return serveStatic(req, res, url);
    } catch (e) { console.error('[server]', e); if (!res.headersSent) err(res, 500, 'server error'); else res.end(); }
  });

  let webPort = parseInt(process.env.PORT || '5173', 10);
  const maxPort = webPort + 10;
  web.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && webPort < maxPort) { webPort++; web.listen(webPort, '127.0.0.1'); }
    else { console.error('Gagal membuka port:', e.message); process.exit(1); }
  });
  web.on('listening', () => {
    const link = `http://localhost:${webPort}/`;
    console.log('\n========================================');
    console.log(' SEMENTRACK (SQL Server) jalan di: ' + link);
    console.log(' Login pakai akun web biasa (auth_local.users).');
    console.log(' Kelola Data MENULIS ke SQL Server. Akun & hak akses tidak bisa diubah di sini.');
    console.log(' Tutup jendela ini untuk berhenti.');
    console.log('========================================\n');
    if (process.platform === 'win32' && !process.env.NO_BROWSER) require('child_process').exec(`start "" "${link}"`);
  });
  web.listen(webPort, '127.0.0.1');
}

main();
