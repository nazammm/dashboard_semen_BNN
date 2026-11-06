import { ApiError, apiCount, apiGet, apiGetAll, apiRpc } from './api';
import type { Row } from './types';

const cache = new Map<string, Promise<any>>();
/** Cache per kunci selama sesi tab; kegagalan tidak di-cache. */
export function getData<T>(key: string, loader: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) { p = loader().catch(e => { cache.delete(key); throw e; }); cache.set(key, p); }
  return p as Promise<T>;
}
export const clearDataCache = () => cache.clear();
/** Buang cache untuk kunci berawalan tertentu (mis. setelah upload data baru). */
export const forgetData = (prefix: string) => { [...cache.keys()].filter(k => k.startsWith(prefix)).forEach(k => cache.delete(k)); };
/** Lupakan semua data yang tersimpan (setelah data inti seperti transaksi diubah). */
export const forgetAllData = () => cache.clear();

const pcArg = (codes?: string[] | null) => (codes && codes.length ? codes : null);
const pcKey = (codes?: string[] | null) => (codes && codes.length ? codes.slice().sort().join(',') : 'all');

export interface PeriodSummary { total_qty: number; order_qty: number; bonus_qty: number; num_do: number; num_active_stores: number; num_lines: number; net_amount: number }

/** Ringkasan periode (distinct DO & toko aktif dihitung database). */
export function periodSummary(distCode: string | null, year: number, startMonth: number, endMonth: number, productCodes?: string[] | null): Promise<PeriodSummary> {
  return getData(`period:${distCode || 'all'}:${year}:${startMonth}:${endMonth}:${pcKey(productCodes)}`, async () => {
    const rows = await apiRpc<Row[]>('dashboard_period_summary_v2', {
      p_dist_code: distCode || null, p_year: year, p_start_month: startMonth, p_end_month: endMonth, p_product_codes: pcArg(productCodes),
    });
    return (rows[0] as PeriodSummary) || { total_qty: 0, order_qty: 0, bonus_qty: 0, num_do: 0, num_active_stores: 0, num_lines: 0, net_amount: 0 };
  });
}
export const topCustomers = (distCode: string | null, year: number, startMonth: number, endMonth: number, productCodes: string[] | null | undefined, limit: number) =>
  getData<Row[]>(`topcust:${distCode || 'all'}:${year}:${startMonth}:${endMonth}:${pcKey(productCodes)}:${limit}`, () =>
    apiRpc('dashboard_top_customers_v2', { p_dist_code: distCode || null, p_year: year, p_start_month: startMonth, p_end_month: endMonth, p_product_codes: pcArg(productCodes), p_limit: limit }));
/* ---- Overview: versi rentang tanggal (fungsi sementrack.*_range) ---- */
export interface DateRangeArg { from: string; to: string }
const rangeKey = (distCode: string | null, r: DateRangeArg, productCodes?: string[] | null) => `${distCode || 'all'}:${r.from}:${r.to}:${pcKey(productCodes)}`;
const rangeArgs = (distCode: string | null, r: DateRangeArg, productCodes?: string[] | null) =>
  ({ p_dist_code: distCode || null, p_start_date: r.from, p_end_date: r.to, p_product_codes: pcArg(productCodes) });
/** 404 = backend belum mengenal fungsi *_range (belum di-deploy ulang): beri pesan yang jelas. */
async function rangeRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  try { return await apiRpc<T>(fn, args); }
  catch (e) {
    if (e instanceof ApiError && e.status === 404)
      throw new ApiError('Filter rentang tanggal belum aktif di server: backend dan fungsi database *_range perlu dipasang dulu.', 404);
    throw e;
  }
}
const EMPTY_SUMMARY: PeriodSummary = { total_qty: 0, order_qty: 0, bonus_qty: 0, num_do: 0, num_active_stores: 0, num_lines: 0, net_amount: 0 };
export const rangeSummary = (distCode: string | null, r: DateRangeArg, productCodes?: string[] | null): Promise<PeriodSummary> =>
  getData(`rsum:${rangeKey(distCode, r, productCodes)}`, async () =>
    ((await rangeRpc<Row[]>('dashboard_period_summary_range', rangeArgs(distCode, r, productCodes)))[0] as PeriodSummary) || EMPTY_SUMMARY);
export const topCustomersRange = (distCode: string | null, r: DateRangeArg, productCodes: string[] | null | undefined, limit: number) =>
  getData<Row[]>(`rtop:${rangeKey(distCode, r, productCodes)}:${limit}`, () =>
    rangeRpc('dashboard_top_customers_range', { ...rangeArgs(distCode, r, productCodes), p_limit: limit }));
const rangeBreakdown = (fn: string, tag: string) => (distCode: string | null, r: DateRangeArg, productCodes?: string[] | null) =>
  getData<Row[]>(`${tag}:${rangeKey(distCode, r, productCodes)}`, () => rangeRpc(fn, rangeArgs(distCode, r, productCodes)));
export const channelRange = rangeBreakdown('dashboard_channel_breakdown_range', 'rch');
export const paymentRange = rangeBreakdown('dashboard_payment_breakdown_range', 'rpay');
export const deliveryTypeRange = rangeBreakdown('dashboard_delivery_type_breakdown_range', 'rdel');
export const productMixRange = rangeBreakdown('dashboard_product_breakdown_range', 'rprod');

export const dailyMatrix = (year: number, month: number, productCodes?: string[] | null) =>
  getData<Row[]>(`daily:${year}:${month}:${pcKey(productCodes)}`, () => apiRpc('dashboard_daily_matrix', { p_year: year, p_month: month, p_product_codes: pcArg(productCodes) }));

function breakdown(fn: string, tag: string) {
  return (distCode: string | null, year: number, startMonth: number, endMonth: number, productCodes?: string[] | null) =>
    getData<Row[]>(`${tag}:${distCode || 'all'}:${year}:${startMonth}:${endMonth}:${pcKey(productCodes)}`, () =>
      apiRpc(fn, { p_dist_code: distCode || null, p_year: year, p_start_month: startMonth, p_end_month: endMonth, p_product_codes: pcArg(productCodes) }));
}
export const deliveryTypeBreakdown = breakdown('dashboard_delivery_type_breakdown', 'delivery');
export const channelBreakdown = breakdown('dashboard_channel_breakdown', 'channel');
export const paymentBreakdown = breakdown('dashboard_payment_breakdown', 'payment');

const enc = encodeURIComponent;

export const DataSource = {
  cementTargets: () => getData('cementTargets', () => apiGetAll('v_cement_targets_ext', '?select=*')),
  transaksiMonthly: () => getData('transaksiMonthly', () => apiGetAll('v_transaksi_monthly', '?select=*&order=year.asc,month.asc')),
  distributors: () => getData('distributors', () => apiGetAll('v_distributor_summary', '?select=*&order=total_qty_ytd.desc')),
  salesman: () => getData('salesman', () => apiGetAll('v_salesman_performance', '?select=*')),
  /** v_toko_agg: 1 baris per (toko, distributor). */
  toko: () => getData('toko', () => apiGetAll('v_toko_agg', '?select=*')),
  /** Master toko mentah (1 baris per toko+distributor). */
  tokoMaster: () => getData('tokoMaster', () => apiGetAll('toko', '?select=*&order=cust_name.asc')),
  tokoMonthly: (year: number, month: number) => getData<Row[]>(`tokoMonthly:${year}:${month}`, () => apiRpc('dashboard_toko_monthly_v2', { p_year: year, p_month: month })),
  yearlyTotals: () => getData('yearlyTotals', () => apiGetAll('v_yearly_totals', '?select=*&order=year.asc')),
  monthlyTotals: () => getData('monthlyTotals', () => apiGetAll('v_monthly_totals', '?select=*&order=year.asc,month.asc')),
  distMonthlyTotals: () => getData('distMonthlyTotals', () => apiGetAll('v_dist_monthly_totals', '?select=*&order=dist_code.asc,year.asc,month.asc')),
  produk: () => getData('produk', () => apiGetAll('produk', '?select=*')),
  /** Jumlah toko UNIK. */
  tokoCount: () => getData('tokoCount', async () => {
    try {
      const r = await apiGet<{ count: number }>('toko-count');   // dihitung database (1 request ringan)
      if (typeof r?.count === 'number') return r.count;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 404) throw e;  // 404 = backend lama belum punya endpoint ini
    }
    return new Set((await apiGetAll('v_toko_agg', '?select=cust_code')).map(r => r.cust_code)).size; // cadangan (lambat)
  }),
  /** Target jumlah salesman aktif per distributor (flat per bulan). */
  targetSalesman: () => getData('targetSalesman', () => apiGetAll('distributor_target_salesman', '?select=*&order=dist_code.asc')),
  targetDist: () => getData('targetDist', () => apiGetAll('v_target_dist', '?select=*')),
  delivery: () => getData('delivery', () => apiGetAll('v_delivery_ext', '?select=*')),
  /** Sell In BNN: ringkasan harian (tanggal x region x produk x tipe pesanan). Urutan lengkap supaya paging stabil. */
  selloutMonthly: () => getData('sellout:monthly', () => apiGetAll('v_sellout_bnn_monthly', '?select=*')),
  selloutTa: () => getData('sellout:ta', () => apiGetAll('v_sellout_bnn_ta', '?select=*')),
  selloutPeta: () => getData('sellout:peta', () => apiGetAll('v_sellout_bnn_peta', '?select=*&order=urutan.asc')),
  sellinDaily: () => getData('sellin:daily', () => apiGetAll('v_sellin_bnn_daily', '?select=*&order=tanggal.asc,region.asc,produk.asc,tipe_pesanan.asc,loco_franco.asc')),
  sellinInfo: () => getData<Row | null>('sellin:info', async () => (await apiGet<Row[]>('v_sellin_bnn_info?select=*'))[0] || null),
  transaksiDetail: (date: string, distCode?: string | null, productCodes?: string[] | null) => {
    const distFilter = distCode && distCode !== 'all' ? `&dist_code=eq.${enc(distCode)}` : '';
    const prodFilter = productCodes && productCodes.length ? `&product_code=in.(${productCodes.join(',')})` : '';
    return apiGetAll('v_transaksi_detail', `?select=*&do_date=eq.${date}${distFilter}${prodFilter}&order=do_no.asc`);
  },
  /** Transaksi satu salesman, satu tahun penuh. */
  transaksiDetailBySalesmanYear: (salesmanCode: string, year: number) =>
    apiGetAll('v_transaksi_detail', `?select=*&salesman_code=eq.${enc(salesmanCode)}&do_date=gte.${year}-01-01&do_date=lt.${year + 1}-01-01&order=do_date.asc,do_no.asc`),
  tokoPegangan: (salesmanCode: string, month: number) =>
    apiGetAll('v_toko_pegangan_sales', `?select=*&salesman_code=eq.${enc(salesmanCode)}&month=eq.${month}&order=omset.desc`),
  /** Kesegaran tiap sumber data (transaksi, sell in harian, sell out & sell in bulanan). */
  dataStatus: () => getData('dataStatus', () => apiGet<Row[]>('v_data_status?select=*')),
  statusSync: () => getData<Row | null>('statusSync', async () => (await apiGet<Row[]>('status_sync?select=*&id=eq.1'))[0] || null),
  dataFreshness: () => getData<Row>('dataFreshness', () => apiGet<Row>('data-freshness')),
  storeInfo: async (custCode: string) => (await apiGet<Row[]>(`toko?select=*&cust_code=eq.${enc(custCode)}`))[0] || null,
  storeYear: (custCode: string, year: number) => apiRpc<Row[]>('dashboard_store_year', { p_customer_code: custCode, p_year: year }),
  storeRecentTx: (custCode: string, limit = 50) =>
    apiGet<Row[]>(`v_transaksi_detail?select=*&customer_code=eq.${enc(custCode)}&order=do_date.desc,do_no.desc&limit=${limit}`),
};
export { apiCount };
