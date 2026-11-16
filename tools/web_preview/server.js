'use strict';
// SEMENTRACK preview lokal: tampilan baru + backend mini yang langsung baca PostgreSQL.
// Meniru API backend .NET (v11). Mode PREVIEW = hanya membaca:
//  - sesi login disimpan di memori (tidak menulis auth_local.sessions)
//  - aktivitas tidak dicatat, tombol simpan/ubah akun di Kelola Akses ditolak
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

// ---- Bentuk nilai sama dengan backend .NET ----
types.setTypeParser(1082, (v) => v); // date -> "YYYY-MM-DD" tanpa geser zona
types.setTypeParser(1114, (v) => new Date(v.replace(' ', 'T') + 'Z').toISOString()); // timestamp: anggap UTC
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric -> angka
types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // bigint -> angka

const DIST_DIR = path.join(__dirname, 'dist');

// ---- Aturan akses (port dari AccessRules.cs) ----
const DashboardPages = ['overview', 'beranda', 'sell-in-bnn', 'outstanding-do', 'sell-out-bnn', 'stock', 'rekap-harian', 'tim-sales', 'peta-toko', 'daftar-toko', 'transaksi-detail', 'toko-detail'];
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
const AllowedTables = new Set(['v_cement_targets_ext', 'v_transaksi_monthly', 'v_distributor_summary', 'v_salesman_performance', 'v_toko_agg', 'v_yearly_totals', 'v_monthly_totals', 'v_dist_monthly_totals', 'produk', 'v_target_dist', 'v_delivery_ext', 'v_transaksi_detail', 'v_toko_pegangan_sales', 'status_sync', 'toko', 'distributor_target_salesman', 'v_sellin_bnn_daily', 'v_sellin_bnn_info', 'v_data_status', 'v_sellout_bnn_monthly', 'v_sellout_bnn_peta', 'v_sellout_bnn_ta', 'v_target_sell_in', 'v_target_sell_out', 'v_outstanding_do', 'v_outstanding_do_ringkas', 'v_outstanding_do_info', 'v_sellin_po_bulanan', 'v_stock_semen', 'v_stock_harian', 'v_stock_info', 'stock_daerah']);
const TablesWithDistCode = new Set(['v_salesman_performance', 'v_toko_agg', 'toko', 'v_transaksi_detail', 'v_toko_pegangan_sales', 'v_dist_monthly_totals', 'v_transaksi_monthly', 'distributor_target_salesman']);
const ReadAlias = { toko: 'sementrack.v_toko_multi', v_toko_agg: 'sementrack.v_toko_agg', distributor_target_salesman: 'sementrack.distributor_target_salesman', v_sellin_bnn_daily: 'sementrack.v_sellin_bnn_daily', v_sellin_bnn_info: 'sementrack.v_sellin_bnn_info', v_data_status: 'sementrack.v_data_status', v_sellout_bnn_monthly: 'sementrack.v_sellout_bnn_monthly', v_sellout_bnn_peta: 'sementrack.v_sellout_bnn_peta', v_sellout_bnn_ta: 'sementrack.v_sellout_bnn_ta', v_salesman_performance: 'sementrack.v_salesman_performance', v_toko_pegangan_sales: 'sementrack.v_toko_pegangan_sales', v_transaksi_detail: 'sementrack.v_transaksi_detail', v_target_dist: 'sementrack.v_target_dist', v_target_sell_in: 'sementrack.v_target_sell_in', v_target_sell_out: 'sementrack.v_target_sell_out', v_outstanding_do: 'sementrack.v_outstanding_do', v_outstanding_do_ringkas: 'sementrack.v_outstanding_do_ringkas', v_outstanding_do_info: 'sementrack.v_outstanding_do_info', v_sellin_po_bulanan: 'sementrack.v_sellin_po_bulanan', v_stock_semen: 'sementrack.v_stock_semen', v_stock_harian: 'sementrack.v_stock_harian', v_stock_info: 'sementrack.v_stock_info', stock_daerah: 'sementrack.stock_daerah' };
const RANGE_FNS = ['dashboard_period_summary_range', 'dashboard_top_customers_range', 'dashboard_channel_breakdown_range', 'dashboard_payment_breakdown_range', 'dashboard_delivery_type_breakdown_range', 'dashboard_product_breakdown_range'];
const RpcSchema = { dashboard_toko_monthly_v2: 'sementrack', dashboard_top_customers_v2: 'sementrack', dashboard_store_year: 'sementrack' };
RANGE_FNS.forEach((f) => { RpcSchema[f] = 'sementrack'; });
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
  overview: [['v_sellin_bnn_daily', 'v_sellin_bnn_info', 'v_target_sell_in', 'v_sellout_bnn_monthly', 'v_sellout_bnn_peta', 'v_sellout_bnn_ta', 'v_target_sell_out', 'v_outstanding_do_ringkas', 'v_outstanding_do_info', 'v_salesman_performance', 'v_stock_harian', 'v_stock_info'], []],
  'sell-in-bnn': [['v_sellin_bnn_daily', 'v_sellin_bnn_info', 'v_target_sell_in'], []],
  'outstanding-do': [['v_outstanding_do', 'v_outstanding_do_ringkas', 'v_outstanding_do_info', 'v_sellin_po_bulanan', 'v_target_sell_in'], []],
  'sell-out-bnn': [['v_sellout_bnn_monthly', 'v_sellout_bnn_peta', 'v_sellout_bnn_ta', 'v_target_sell_out'], []],
  stock: [['v_stock_semen', 'v_stock_harian', 'v_stock_info'], []],
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

// ---- Query-string bergaya PostgREST (port QueryParser.cs) ----
const IDENT = /^[a-zA-Z0-9_]+$/;
function parseQuery(searchParams) {
  const r = { where: [], params: [], order: '', limit: null, offset: null };
  const add = (v) => { r.params.push(v); return '$' + r.params.length; };
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
        return `"${col}" ${dir === 'desc' ? 'DESC' : 'ASC'}`;
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
        r.where.push(`"${key}" IN (${vals.map(add).join(',')})`);
      } else {
        const sqlOp = { eq: '=', gte: '>=', lte: '<=', gt: '>' }[op] || '<';
        r.where.push(`"${key}" ${sqlOp} ${add(val)}`);
      }
    }
  }
  return r;
}

// ---- Database ----
let pool;
async function q(sql, params) { const res = await pool.query(sql, params || []); return res.rows; }
const cache = new Map();
async function qCached(sql, params, ttl = 45) {
  const key = sql + '\u0001' + JSON.stringify(params);
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttl * 1000) return hit.p;
  const p = q(sql, params);
  cache.set(key, { at: now, p });
  try { return await p; } catch (e) { cache.delete(key); throw e; } finally {
    if (cache.size > 300) for (const [k, v] of cache) if (now - v.at >= ttl * 1000) cache.delete(k);
  }
}

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
    const rows = await q('select page_id from auth_local.role_pages where role=$1 order by page_id', [role]);
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
    const rows = await q('select page_id, can_view_detail, can_download from auth_local.role_pages where role=$1', [role]);
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
function logDbError(where, e) { console.error(`[${where}] ${e.code || ''} ${e.message}`); }

// ---- Endpoint API ----
async function handleApi(req, res, url) {
  const p = url.pathname.replace(/^\/api/, '') || '/';
  const m = req.method;

  if (p === '/' && m === 'GET') return send(res, 200, { ok: true, message: 'SEMENTRACK preview lokal jalan.', version: 'preview-node' });

  if (p === '/rpc/login' && m === 'POST') {
    const b = await readBody(req);
    const uname = String(b.username || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!uname || uname.length > 64 || password.length > 256) { await sleep(300); return err(res, 401, 'invalid credentials'); }
    const f = fails.get(uname);
    if (f && f.until > Date.now()) return send(res, 429, { error: 'too many failed attempts, try again later', retry_after_seconds: Math.ceil((f.until - Date.now()) / 1000) });
    let u;
    try {
      const rows = await q('select username, password_hash, role, name, dist_code from auth_local.users where username=$1', [uname]);
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
    try { const rows = await q('select max(do_date) as max_do_date from public.transaksi'); return send(res, 200, { max_do_date: rows.length ? rows[0].max_do_date : null }); }
    catch (e) { logDbError('data-freshness', e); return err(res, 500, 'Gagal mengambil kesegaran data.'); }
  }

  if (p === '/toko-count' && m === 'GET') {
    if (!s) return err(res, st, e0);
    try {
      const access = computeAccess(s.role, await getPagesForRole(s.role));
      if (!access.tables.has('v_toko_agg')) return err(res, 403, 'role ini tidak boleh mengakses data ini');
      // subdist bukan toko: tidak ikut jumlah toko terdaftar
      let where = ' WHERE NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer sc WHERE sc.dist_code = a.dist_code AND sc.customer_code = a.cust_code)'; const pars = [];
      if (DistScopedRoles.includes(s.role)) { if (!s.dist_code) return send(res, 200, { count: 0 }); pars.push(s.dist_code); where += ' AND a."dist_code" IN ($1)'; }
      const rows = await q(`SELECT COUNT(DISTINCT a."cust_code")::int AS c FROM ${ReadAlias.v_toko_agg} a${where}`, pars);
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
    if (m !== 'GET') return err(res, 403, 'Mode preview: perubahan akun/hak akses dimatikan. Lakukan di web utama.');
    try {
      if (p === '/admin/users') return send(res, 200, await q('select username, name, role, dist_code, created_at from auth_local.users order by role, username'));
      if (p === '/admin/distributor-list') return send(res, 200, await q("select dist_code, dist_name from public.distributor where tag = 'Distributor' order by dist_code"));
      if (p === '/admin/role-pages') {
        const mo = await getPagesForRole('mo'); const sales = await getPagesForRole('sales'); const spv = await getPagesForRole('spv');
        return send(res, 200, { allPages: DashboardPages, current: { mo, sales, spv }, permissions: { sales: await getPagePermissions('sales', sales), spv: await getPagePermissions('spv', spv) } });
      }
      if (p === '/admin/activity') {
        const since30 = new Date(Date.now() - 30 * 86400000);
        const d = new Date(); d.setHours(0, 0, 0, 0);
        const cnt = async (ev, t) => (await q(`select count(*)::int c from auth_local.activity_log where event_type='${ev}' and lower(role)!='admin' and created_at >= $1`, [t]))[0].c;
        const active = (await q("select count(distinct username)::int c from auth_local.activity_log where lower(role)!='admin' and created_at >= $1", [d]))[0].c;
        return send(res, 200, {
          summary: { logins_today: await cnt('login', d), page_views_today: await cnt('page_view', d), downloads_today: await cnt('download', d), active_users_today: active },
          active_users_by_role: await q("select role, username, max(name) as name, max(created_at) as last_activity from auth_local.activity_log where lower(role) != 'admin' and created_at >= $1 group by role, username order by role, last_activity desc", [d]),
          recent_logins: await q("select username, name, role, created_at from auth_local.activity_log where event_type='login' and lower(role)!='admin' order by created_at desc limit 20"),
          page_view_counts: await q("select page_id, count(*)::int c from auth_local.activity_log where event_type='page_view' and lower(role)!='admin' and page_id is not null and created_at >= $1 group by page_id order by c desc", [since30]),
          recent_downloads: await q("select username, name, detail, created_at from auth_local.activity_log where event_type='download' and lower(role)!='admin' order by created_at desc limit 20"),
          recent_activity: await q("select username, name, role, event_type, page_id, detail, created_at from auth_local.activity_log where lower(role)!='admin' order by created_at desc limit 50"),
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
        const rows = distCodes.length === 0 ? [] : await q('select 1 from sementrack.toko_distributor where cust_code=$1 and dist_code = any($2::text[])', [scalar(body.p_customer_code), distCodes]);
        if (rows.length === 0) return send(res, 200, []);
      }
      const pars = []; const args = [];
      const arr = (name, vals) => { const ph = vals.map((v) => { pars.push(v); return '$' + pars.length; }); return `${name} => ARRAY[${ph.join(',')}]::text[]`; };
      for (const name of argNames) {
        if (name === 'p_dist_code' && force) { args.push(arr(name, distCodes)); continue; }
        const has = Object.prototype.hasOwnProperty.call(body, name);
        const v = has ? body[name] : undefined;
        if (name === 'p_dist_code' && v !== undefined && v !== null && !Array.isArray(v)) args.push(arr(name, [scalar(v)]));
        else if (Array.isArray(v)) args.push(arr(name, v.map(scalar)));
        else { pars.push(v === undefined ? null : scalar(v)); args.push(`${name} => $${pars.length}`); }
      }
      const schema = RpcSchema[fn] ? RpcSchema[fn] + '.' : '';
      return send(res, 200, await qCached(`SELECT * FROM ${schema}${fn}(${args.join(', ')})`, pars));
    } catch (e) {
      if (e.code && String(e.code).startsWith('22')) return err(res, 400, 'parameter tidak valid');
      logDbError('RPC ' + fn, e); return send(res, 500, { error: 'query failed' });
    }
  }

  const tbl = /^\/([a-zA-Z0-9_]+)$/.exec(p);
  if (tbl && m === 'GET') {
    const table = tbl[1];
    if (!s) return err(res, st, e0);
    if (!AllowedTables.has(table)) return err(res, 404, 'unknown table');
    const sqlTable = ReadAlias[table] || table;
    try {
      const access = computeAccess(s.role, await getPagesForRole(s.role));
      if (!access.tables.has(table)) return err(res, 403, 'role ini tidak boleh mengakses data ini');
      const pq = parseQuery(url.searchParams);
      if (DistScopedRoles.includes(s.role) && TablesWithDistCode.has(table)) {
        if (!s.dist_code) return send(res, 200, []);
        pq.where.push(`"dist_code" IN (${pq.add(s.dist_code)})`);
      }
      const whereSql = pq.where.length ? ' WHERE ' + pq.where.join(' AND ') : '';
      const extra = {};
      if (req.headers.prefer === 'count=exact') {
        const c = await q(`SELECT COUNT(*)::int AS c FROM ${sqlTable}${whereSql}`, pq.params);
        extra['Content-Range'] = `0-0/${c[0].c}`;
      }
      let sql = `SELECT * FROM ${sqlTable}${whereSql}`;
      const pars = pq.params.slice();
      if (pq.order) sql += ' ORDER BY ' + pq.order;
      const lim = pq.limit !== null ? Math.min(Math.max(pq.limit, 0), 10000) : 1000;
      const off = pq.offset !== null ? Math.max(pq.offset, 0) : 0;
      pars.push(lim); sql += ` LIMIT $${pars.length}`;
      if (off > 0) { pars.push(off); sql += ` OFFSET $${pars.length}`; }
      return send(res, 200, await qCached(sql, pars), extra);
    } catch (e) {
      if (e.status === 400) return err(res, 400, e.message);
      if (e.code && (String(e.code).startsWith('22') || e.code === '42703')) return err(res, 400, 'nilai filter / nama kolom tidak valid');
      logDbError('GET ' + table, e); return send(res, 500, { error: 'query failed' });
    }
  }

  return err(res, 404, 'not found');
}

// ---- Upload Sell In BNN (admin): logika ada di fungsi database sementrack.sellin_bnn_* ----
async function handleSellin(req, res, url, p, m) {
  const [s, st, e0] = getSession(req);
  if (!s) return err(res, st, e0);
  if (s.role !== 'admin') return err(res, 403, 'khusus akun admin');
  const one = async (sql, params) => (await q(sql, params))[0];
  try {
    if (m === 'GET' && p === '/admin/sellin/uploads') return send(res, 200, await q('select id, created_at, created_by, source, file_name, date_from, date_to, rows_read, rows_saved, rows_replaced, ton_saved, status from sementrack.sellin_bnn_upload order by id desc limit 30'));
    if (m === 'GET' && p === '/admin/sellin/unmapped') return send(res, 200, await q('select * from sementrack.v_sellin_unmapped order by ton desc nulls last'));
    if (m === 'GET' && p === '/admin/sellin/region-map') return send(res, 200, await q('select kode_customer, region, nama_customer, updated_at, updated_by from sementrack.sellin_region_map order by region, kode_customer'));
    if (m === 'GET' && p === '/admin/sellin/impact') return send(res, 200, (await one('select * from sementrack.sellin_bnn_impact($1::date, $2::date)', [url.searchParams.get('from'), url.searchParams.get('to')])) || {});
    if (m !== 'POST') return err(res, 404, 'not found');
    const b = await readBody(req, p === '/admin/sellin/stage' ? 12 * 1024 * 1024 : 256 * 1024);
    if (b.__tooBig) return err(res, 413, 'paket terlalu besar');
    if (p === '/admin/sellin/region-map') {
      await q('select sementrack.sellin_region_set($1, $2, $3, $4)', [scalar(b.kode_customer), scalar(b.region), scalar(b.nama_customer), s.username]);
      cache.clear(); return send(res, 200, { ok: true });
    }
    if (p === '/admin/sellin/begin') {
      const r = await one('select sementrack.sellin_bnn_begin($1, $2, $3, $4::date, $5::date, $6::int) as id', [s.username, scalar(b.source), scalar(b.file_name), scalar(b.date_from), scalar(b.date_to), scalar(b.rows_read) || '0']);
      return send(res, 200, { id: r.id });
    }
    if (p === '/admin/sellin/stage') {
      if (!Array.isArray(b.rows)) return err(res, 400, 'paket baris tidak valid');
      const r = await one('select sementrack.sellin_bnn_stage($1::bigint, $2::json) as n', [scalar(b.upload_id), JSON.stringify(b.rows)]);
      return send(res, 200, { staged: r.n });
    }
    if (p === '/admin/sellin/commit') {
      const r = await one('select * from sementrack.sellin_bnn_commit($1::bigint)', [scalar(b.upload_id)]);
      cache.clear(); return send(res, 200, r);
    }
    if (p === '/admin/sellin/abort') { await q('select sementrack.sellin_bnn_abort($1::bigint)', [scalar(b.upload_id)]); return send(res, 200, { ok: true }); }
    return err(res, 404, 'not found');
  } catch (e) {
    if (e.code && String(e.code).startsWith('22')) return err(res, 400, e.message);
    if (e.code && String(e.code).startsWith('23')) return err(res, 400, 'Data ditolak database: ' + (e.detail || e.message));
    logDbError('sellin ' + p, e); return err(res, 500, 'Gagal memproses data sell in.');
  }
}

// ---- Upload Outstanding DO (admin): logika ada di fungsi database sementrack.sellin_po_* ----
async function handleOutstanding(req, res, url, p, m) {
  const [s, st, e0] = getSession(req);
  if (!s) return err(res, st, e0);
  if (s.role !== 'admin') return err(res, 403, 'khusus akun admin');
  const one = async (sql, params) => (await q(sql, params))[0];
  try {
    if (m === 'GET' && p === '/admin/outstanding/impact') return send(res, 200, (await one('select * from sementrack.sellin_po_impact($1::date, $2::date)', [url.searchParams.get('from'), url.searchParams.get('to')])) || {});
    if (m !== 'POST') return err(res, 404, 'not found');
    const b = await readBody(req, p === '/admin/outstanding/stage' ? 12 * 1024 * 1024 : 256 * 1024);
    if (b.__tooBig) return err(res, 413, 'paket terlalu besar');
    if (p === '/admin/outstanding/begin') {
      const r = await one('select sementrack.sellin_po_begin($1, $2, $3, $4::date, $5::date, $6::int) as id', [s.username, scalar(b.source), scalar(b.file_name), scalar(b.date_from), scalar(b.date_to), scalar(b.rows_read) || '0']);
      return send(res, 200, { id: r.id });
    }
    if (p === '/admin/outstanding/stage') {
      if (!Array.isArray(b.rows)) return err(res, 400, 'paket baris tidak valid');
      const r = await one('select sementrack.sellin_po_stage($1::bigint, $2::json) as n', [scalar(b.upload_id), JSON.stringify(b.rows)]);
      return send(res, 200, { staged: r.n });
    }
    if (p === '/admin/outstanding/commit') {
      const r = await one('select * from sementrack.sellin_po_commit($1::bigint)', [scalar(b.upload_id)]);
      cache.clear(); return send(res, 200, r);
    }
    if (p === '/admin/outstanding/abort') { await q('select sementrack.sellin_po_abort($1::bigint)', [scalar(b.upload_id)]); return send(res, 200, { ok: true }); }
    return err(res, 404, 'not found');
  } catch (e) {
    if (e.code && String(e.code).startsWith('22')) return err(res, 400, e.message);
    if (e.code && String(e.code).startsWith('23')) return err(res, 400, 'Data ditolak database: ' + (e.detail || e.message));
    logDbError('outstanding ' + p, e); return err(res, 500, 'Gagal memproses data outstanding DO.');
  }
}

// ---- Kelola Data → Tabel (admin): edit tabel master; daftar & aturan di sementrack.tabel_edit ----
async function handleTabel(req, res, url, p, m) {
  const [s, st, e0] = getSession(req);
  if (!s) return err(res, st, e0);
  if (s.role !== 'admin') return err(res, 403, 'khusus akun admin');
  try {
    if (m === 'GET' && p === '/admin/tabel') return send(res, 200, await q('select id, grup, label, keterangan, pk, kolom::text as kolom, filter from sementrack.tabel_edit where aktif order by urutan, label'));
    const mm = /^\/admin\/tabel\/([a-z0-9_]+)(\/opsi)?$/.exec(p);
    if (!mm) return err(res, 404, 'not found');
    const id = mm[1];
    if (m === 'GET' && mm[2]) return send(res, 200, (await q('select sementrack.tabel_opsi($1) as j', [id]))[0].j);
    if (m === 'GET') {
      const filter = Object.fromEntries(url.searchParams.entries());
      return send(res, 200, (await q('select sementrack.tabel_baca($1, $2::json) as j', [id, JSON.stringify(filter)]))[0].j);
    }
    if (m !== 'POST' || mm[2]) return err(res, 404, 'not found');
    const b = await readBody(req, 12 * 1024 * 1024);
    if (b.__tooBig) return err(res, 413, 'paket terlalu besar');
    if (!Array.isArray(b.upsert) || !Array.isArray(b.delete)) return err(res, 400, 'perubahan tidak valid');
    const r = (await q('select * from sementrack.tabel_simpan($1, $2, $3::json, $4::json)', [id, s.username, JSON.stringify(b.upsert), JSON.stringify(b.delete)]))[0];
    cache.clear(); return send(res, 200, r);
  } catch (e) {
    if (e.code && String(e.code).startsWith('22')) return err(res, 400, e.message);
    if (e.code && String(e.code).startsWith('23')) return err(res, 400, 'Data ditolak database: ' + (e.detail || e.message));
    logDbError('tabel ' + p, e); return err(res, 500, 'Gagal memproses tabel.');
  }
}

// ---- Kelola Data (admin): upload transaksi, hapus, riwayat, status sinkronisasi ----
const strArr = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean))] : []);
async function handleKelola(req, res, url, p, m) {
  const [s, st, e0] = getSession(req);
  if (!s) return err(res, st, e0);
  if (s.role !== 'admin') return err(res, 403, 'khusus akun admin');
  const one = async (sql, params) => (await q(sql, params))[0];
  try {
    if (m === 'GET' && p === '/admin/data/riwayat') return send(res, 200, await q('select * from sementrack.v_kelola_riwayat order by created_at desc limit 50'));
    if (m === 'GET' && p === '/admin/data/status-sync') return send(res, 200, (await one('select tanggal_update, jam_update, keterangan from public.status_sync where id = 1')) || {});
    if (m === 'GET' && p === '/admin/data/target-ringkas') return send(res, 200, await q('select * from sementrack.v_target_ringkas order by jenis, tahun desc, metrik'));
    if (m === 'GET' && p === '/admin/data/target') {
      const tahun = Number(url.searchParams.get('tahun'));
      if (!Number.isInteger(tahun)) return err(res, 400, 'tahun tidak valid');
      return send(res, 200, await q('select metrik, tahun, bulan, region, area, tipe, kode, nama, status, nilai from sementrack.target where jenis = $1 and tahun = $2 order by region, area, tipe, kode, metrik, bulan', [url.searchParams.get('jenis'), tahun]));
    }
    if (m === 'GET' && p === '/admin/data/distributor') return send(res, 200, await q('select dist_code, dist_name, kode_erp from public.distributor order by dist_code'));
    if (m !== 'POST') return err(res, 404, 'not found');
    const b = await readBody(req, p === '/admin/transaksi/stage' || p === '/admin/data/sellout' || p === '/admin/data/target' || p === '/admin/data/stock' ? 12 * 1024 * 1024 : 256 * 1024);
    if (b.__tooBig) return err(res, 413, 'paket terlalu besar');
    const dists = strArr(b.dist_codes);
    switch (p) {
      case '/admin/transaksi/impact':
        return send(res, 200, await q('select * from sementrack.transaksi_impact($1::date, $2::date, $3)', [scalar(b.date_from), scalar(b.date_to), dists]));
      case '/admin/transaksi/begin': {
        const r = await one('select sementrack.transaksi_begin($1, $2, $3, $4::date, $5::date, $6, $7::int) as id', [s.username, scalar(b.source), scalar(b.file_name), scalar(b.date_from), scalar(b.date_to), dists, scalar(b.rows_read) || '0']);
        return send(res, 200, { id: r.id });
      }
      case '/admin/transaksi/stage': {
        if (!Array.isArray(b.rows)) return err(res, 400, 'paket baris tidak valid');
        const r = await one('select sementrack.transaksi_stage($1::bigint, $2::json) as n', [scalar(b.upload_id), JSON.stringify(b.rows)]);
        return send(res, 200, { staged: r.n });
      }
      case '/admin/transaksi/commit': {
        const r = await one('select * from sementrack.transaksi_commit($1::bigint)', [scalar(b.upload_id)]);
        cache.clear(); return send(res, 200, r);
      }
      case '/admin/transaksi/abort':
        await q('select sementrack.transaksi_abort($1::bigint)', [scalar(b.upload_id)]); return send(res, 200, { ok: true });
      case '/admin/data/hapus-pratinjau':
        return send(res, 200, await one('select * from sementrack.kelola_hapus_pratinjau($1, $2::date, $3::date, $4)', [scalar(b.dataset), scalar(b.date_from), scalar(b.date_to), dists.length ? dists : null]));
      case '/admin/data/hapus': {
        if (b.konfirmasi !== 'HAPUS') return err(res, 400, 'konfirmasi hapus tidak valid');
        const r = await one('select sementrack.kelola_hapus($1, $2::date, $3::date, $4, $5) as n', [scalar(b.dataset), scalar(b.date_from), scalar(b.date_to), dists.length ? dists : null, s.username]);
        cache.clear(); return send(res, 200, { deleted: r.n });
      }
      case '/admin/data/sellout': {
        if (!Array.isArray(b.rows)) return err(res, 400, 'baris tidak valid');
        if (b.dataset === 'j073') {
          const r = await one('select * from sementrack.sellout_j073_simpan($1::json, $2, $3)', [JSON.stringify(b.rows), s.username, scalar(b.file_name) || null]);
          cache.clear(); return send(res, 200, r);
        }
        const fn = { dofas: 'sellout_dofas_simpan', erp: 'sellout_erp_simpan' }[b.dataset];
        if (!fn) return err(res, 400, 'dataset harus dofas, erp, atau j073');
        const r = await one(`select * from sementrack.${fn}($1::int, $2::json, $3)`, [scalar(b.tahun), JSON.stringify(b.rows), s.username]);
        cache.clear(); return send(res, 200, r);
      }
      case '/admin/data/stock': {
        // stock_semen.sql: [[tanggal, daerah, produk, jenis, kg, zak], ...]; tanggal di file diganti seluruhnya
        if (!Array.isArray(b.rows)) return err(res, 400, 'baris tidak valid');
        const r = await one('select * from sementrack.stock_simpan($1::json, $2, $3)', [JSON.stringify(b.rows), s.username, scalar(b.file_name) || null]);
        cache.clear(); return send(res, 200, r);
      }
      case '/admin/data/target': {
        if (!Array.isArray(b.rows)) return err(res, 400, 'baris tidak valid');
        const r = await one('select * from sementrack.target_simpan($1, $2::json, $3, $4)', [scalar(b.jenis), JSON.stringify(b.rows), s.username, scalar(b.file_name) || null]);
        cache.clear(); return send(res, 200, r);
      }
      case '/admin/data/status-sync':
        await q('select sementrack.status_sync_set($1::date, $2::time, $3)', [scalar(b.tanggal_update), scalar(b.jam_update) || null, scalar(b.keterangan)]);
        cache.clear(); return send(res, 200, { ok: true });
      default: return err(res, 404, 'not found');
    }
  } catch (e) {
    if (e.code && String(e.code).startsWith('22')) return err(res, 400, e.message);
    if (e.code && String(e.code).startsWith('23')) return err(res, 400, 'Data ditolak database: ' + (e.detail || e.message));
    logDbError('kelola ' + p, e); return err(res, 500, 'Gagal memproses data.');
  }
}

// ---- File statis (hasil build React) ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  let file = path.normalize(path.join(DIST_DIR, rel));
  if (!file.startsWith(DIST_DIR)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) file = path.join(DIST_DIR, 'index.html');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': file.includes(path.sep + 'assets' + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

// ---- Minta password tanpa tampil di layar ----
function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    if (!stdin.isTTY) {
      const rl = readline.createInterface({ input: stdin });
      rl.once('line', (l) => { rl.close(); resolve(l); });
      return;
    }
    let buf = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); process.stdout.write('\n'); return resolve(buf); }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(1); }
        if (c === '\u0008' || c === '\u007f') { if (buf.length) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        buf += c; process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}
function ask(question, def) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question + (def ? ` [${def}]: ` : ': '), (a) => { rl.close(); resolve(a.trim() || def || ''); });
  });
}

async function main() {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) { console.error('Folder dist tidak ditemukan. Ekstrak SELURUH isi zip ke satu folder.'); process.exit(1); }
  const host = process.env.DB_HOST || '10.10.20.8';
  const port = parseInt(process.env.DB_PORT || '61385', 10);
  const database = process.env.DB_NAME || 'web_semen';
  const user = process.env.DB_USER || await ask('User database', 'nazamudin');
  const password = process.env.DB_PASSWORD || await askHidden('Password database (tidak tampil): ');

  pool = new Pool({ host, port, database, user, password, max: 8, connectionTimeoutMillis: 10000 });
  pool.on('error', (e) => console.error('[db]', e.message));
  console.log(`\nMenghubungkan ke PostgreSQL ${host}:${port}/${database} sebagai ${user} ...`);
  try {
    const r = await q("select now() as now, (select count(*)::int from auth_local.users) as akun, (select max(do_date) from public.transaksi) as data_terakhir");
    console.log(`Terhubung. Akun di auth_local.users: ${r[0].akun}. Data transaksi terakhir: ${r[0].data_terakhir}`);
  } catch (e) {
    console.error('\nGAGAL terhubung / membaca database:');
    console.error('  ' + (e.code ? e.code + ' ' : '') + e.message);
    if (e.code === '28P01') console.error('  -> Password database salah.');
    else if (e.code === '42501') console.error('  -> User ini tidak punya izin baca tabel tersebut (minta GRANT ke IT).');
    else if (e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH') console.error('  -> Laptop tidak bisa menjangkau server database. Pastikan tersambung jaringan kantor / VPN.');
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return serveStatic(req, res, url);
    } catch (e) { console.error('[server]', e); if (!res.headersSent) err(res, 500, 'server error'); else res.end(); }
  });

  let webPort = parseInt(process.env.PORT || '5173', 10);
  const maxPort = webPort + 10;
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && webPort < maxPort) { webPort++; server.listen(webPort, '127.0.0.1'); }
    else { console.error('Gagal membuka port:', e.message); process.exit(1); }
  });
  server.on('listening', () => {
    const link = `http://localhost:${webPort}/`;
    console.log('\n========================================');
    console.log(' SEMENTRACK preview jalan di: ' + link);
    console.log(' Login pakai akun web biasa (auth_local.users).');
    console.log(' Mode preview: akun & hak akses tidak bisa diubah di sini. Upload Sell In BNN tetap menyimpan ke database.');
    console.log(' Tutup jendela ini untuk berhenti.');
    console.log('========================================\n');
    if (process.platform === 'win32') require('child_process').exec(`start "" "${link}"`);
  });
  server.listen(webPort, '127.0.0.1');
}

main();
