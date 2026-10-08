import { apiCount, apiGet, apiGetAll, apiRpc } from './api';
import type { Row } from './types';

const cache = new Map<string, Promise<any>>();
/** Cache per kunci selama sesi tab; kegagalan tidak di-cache. */
export function getData<T>(key: string, loader: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) { p = loader().catch(e => { cache.delete(key); throw e; }); cache.set(key, p); }
  return p as Promise<T>;
}
export const clearDataCache = () => cache.clear();

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
  tokoCount: () => getData('tokoCount', async () => new Set((await apiGetAll('v_toko_agg', '?select=cust_code')).map(r => r.cust_code)).size),
  targetDist: () => getData('targetDist', () => apiGetAll('v_target_dist', '?select=*')),
  delivery: () => getData('delivery', () => apiGetAll('v_delivery_ext', '?select=*')),
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
  statusSync: () => getData<Row | null>('statusSync', async () => (await apiGet<Row[]>('status_sync?select=*&id=eq.1'))[0] || null),
  dataFreshness: () => getData<Row>('dataFreshness', () => apiGet<Row>('data-freshness')),
  storeInfo: async (custCode: string) => (await apiGet<Row[]>(`toko?select=*&cust_code=eq.${enc(custCode)}`))[0] || null,
  storeYear: (custCode: string, year: number) => apiRpc<Row[]>('dashboard_store_year', { p_customer_code: custCode, p_year: year }),
  storeRecentTx: (custCode: string, limit = 50) =>
    apiGet<Row[]>(`v_transaksi_detail?select=*&customer_code=eq.${enc(custCode)}&order=do_date.desc,do_no.desc&limit=${limit}`),
};
export { apiCount };
