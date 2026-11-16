-- Penjualan Toko: toko per cara order (offline / online / keduanya). Versi PostgreSQL dari docs/mssql/12_toko_channel.sql.
create or replace function sementrack.dashboard_toko_channel_range(p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] default null)
returns table(customer_code text, cust_name text, dist_code text, do_online bigint, do_offline bigint, total_qty numeric, net_amount numeric)
language sql stable set search_path to 'public', 'pg_temp' as $$
  with base as (
    select t.customer_code::text, t.customer_name::text, t.dist_code::text, t.do_no, t.product_code, t.order_qty, t.net_amount,
           (t.mss_no_order is not null and btrim(t.mss_no_order::text) not in ('', '0')) as online
    from public.transaksi t
    where t.do_date between p_start_date and p_end_date
      and t.customer_code is not null
      and (p_dist_code is null or t.dist_code = any(p_dist_code))
      and (p_product_codes is null or t.product_code = any(p_product_codes))
      and not exists (select 1 from sementrack.subdist_customer s where s.dist_code = t.dist_code and s.customer_code = t.customer_code)
  )
  select b.customer_code, max(b.customer_name), min(b.dist_code),
         count(distinct b.do_no) filter (where b.online), count(distinct b.do_no) filter (where not b.online),
         coalesce(sum(calc_tonase(b.product_code, b.order_qty)), 0), sum(coalesce(b.net_amount, 0))
  from base b group by b.customer_code order by 6 desc;
$$;
grant execute on function sementrack.dashboard_toko_channel_range(text[], date, date, text[]) to public;
