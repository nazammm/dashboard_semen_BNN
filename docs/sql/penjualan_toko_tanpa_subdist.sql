-- Penjualan Toko tanpa subdist. Versi PostgreSQL dari docs/mssql/14_penjualan_toko_tanpa_subdist.sql.
create or replace view sementrack.v_penjualan_toko_bulanan as
select extract(year from t.do_date)::int as year, extract(month from t.do_date)::int as month, t.dist_code, t.product_code,
       sum(calc_tonase(t.product_code, t.order_qty)) as total_qty, sum(coalesce(t.net_amount, 0)) as net_amount, count(distinct t.do_no) as num_do
from public.transaksi t
where t.do_date is not null
  and not exists (select 1 from sementrack.subdist_customer s where s.dist_code = t.dist_code and s.customer_code = t.customer_code)
group by 1, 2, 3, 4;
create or replace view sementrack.v_penjualan_toko_dist_bulanan as
select t.dist_code, extract(year from t.do_date)::int as year, extract(month from t.do_date)::int as month,
       sum(calc_tonase(t.product_code, t.order_qty)) as total_qty, sum(coalesce(t.net_amount, 0)) as net_amount, count(distinct t.do_no) as num_do
from public.transaksi t
where t.do_date is not null
  and not exists (select 1 from sementrack.subdist_customer s where s.dist_code = t.dist_code and s.customer_code = t.customer_code)
group by 1, 2, 3;
grant select on sementrack.v_penjualan_toko_bulanan, sementrack.v_penjualan_toko_dist_bulanan to public;

CREATE OR REPLACE FUNCTION sementrack.dashboard_period_summary_range(p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] DEFAULT NULL::text[])
 RETURNS TABLE(total_qty numeric, order_qty numeric, bonus_qty numeric, num_do bigint, num_active_stores bigint, num_lines bigint, net_amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with base as (
    select * from public.transaksi t0
    where not exists (select 1 from sementrack.subdist_customer s where s.dist_code = t0.dist_code and s.customer_code = t0.customer_code)
      and do_date between p_start_date and p_end_date
      and (p_dist_code is null or dist_code = any(p_dist_code))
      and (p_product_codes is null or product_code = any(p_product_codes))
  ),
  cust_month as (
    select b.customer_code, date_trunc('month', b.do_date) as bulan, sum(coalesce(b.net_amount, 0)) as net_amount
    from base b
    where not exists (select 1 from sementrack.subdist_customer s
                      where s.dist_code = b.dist_code and s.customer_code = b.customer_code)
    group by b.customer_code, date_trunc('month', b.do_date)
  )
  select
    coalesce((select sum(calc_tonase(product_code, order_qty)) from base), 0),
    coalesce((select sum(order_qty) from base), 0),
    coalesce((select sum(bonus_qty) from base), 0),
    coalesce((select count(distinct do_no) from base), 0),
    coalesce((select count(distinct customer_code) from cust_month where net_amount >= 200000), 0),
    coalesce((select count(*) from base), 0),
    coalesce((select sum(coalesce(net_amount, 0)) from base), 0);
$function$;

CREATE OR REPLACE FUNCTION sementrack.dashboard_top_customers_range(p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] DEFAULT NULL::text[], p_limit integer DEFAULT 10)
 RETURNS TABLE(customer_code text, cust_name text, dist_code text, dist_name text, total_qty numeric, num_do bigint, net_amount numeric, is_subdist boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    coalesce(nullif(nullif(btrim(t.parent_customer_code), ''), '0'), t.customer_code) as customer_code,
    coalesce(max(nullif(nullif(btrim(t.parent_customer_name), ''), '0')), max(t.customer_name)) as cust_name,
    string_agg(distinct t.dist_code, ', ' order by t.dist_code) as dist_code,
    case when count(distinct t.dist_code) = 1 then coalesce(max(d.dist_name), max(t.distributor_name)) end as dist_name,
    sum(calc_tonase(t.product_code, t.order_qty)) as total_qty,
    count(distinct t.do_no) as num_do,
    sum(coalesce(t.net_amount, 0)) as net_amount,
    bool_and(s.customer_code is not null) as is_subdist
  from public.transaksi t
  left join public.distributor d on d.dist_code = t.dist_code
  left join sementrack.subdist_customer s on s.dist_code = t.dist_code and s.customer_code = t.customer_code
  where t.do_date between p_start_date and p_end_date
    and (p_dist_code is null or t.dist_code = any(p_dist_code))
    and (p_product_codes is null or t.product_code = any(p_product_codes))
    and not exists (select 1 from sementrack.subdist_customer sx where sx.dist_code = t.dist_code and sx.customer_code = t.customer_code)
  group by 1
  order by total_qty desc nulls last
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$function$;

CREATE OR REPLACE FUNCTION sementrack.dashboard_channel_breakdown_range(p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] DEFAULT NULL::text[])
 RETURNS TABLE(channel text, num_do bigint, net_amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when t.mss_no_order is not null and btrim(t.mss_no_order) not in ('', '0') then 'Online' else 'Offline' end,
         count(distinct t.do_no),
         sum(coalesce(t.net_amount, 0))
  from public.transaksi t
  where t.do_date between p_start_date and p_end_date
    and (p_dist_code is null or t.dist_code = any(p_dist_code))
    and (p_product_codes is null or t.product_code = any(p_product_codes))
    and not exists (select 1 from sementrack.subdist_customer sx where sx.dist_code = t.dist_code and sx.customer_code = t.customer_code)
  group by 1
  order by 2 desc;
$function$;

CREATE OR REPLACE FUNCTION sementrack.dashboard_payment_breakdown_range(p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] DEFAULT NULL::text[])
 RETURNS TABLE(payment text, num_do bigint, net_amount numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(t.payment, 'Tidak diketahui'),
         count(distinct t.do_no),
         sum(coalesce(t.net_amount, 0))
  from public.transaksi t
  where t.do_date between p_start_date and p_end_date
    and (p_dist_code is null or t.dist_code = any(p_dist_code))
    and (p_product_codes is null or t.product_code = any(p_product_codes))
    and not exists (select 1 from sementrack.subdist_customer sx where sx.dist_code = t.dist_code and sx.customer_code = t.customer_code)
  group by 1
  order by 3 desc;
$function$;

CREATE OR REPLACE FUNCTION sementrack.dashboard_delivery_type_breakdown_range(p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] DEFAULT NULL::text[])
 RETURNS TABLE(delivery_type text, total_qty numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(t.delivery_type, 'Tidak diketahui'),
         sum(calc_tonase(t.product_code, t.order_qty))
  from public.transaksi t
  where t.do_date between p_start_date and p_end_date
    and (p_dist_code is null or t.dist_code = any(p_dist_code))
    and (p_product_codes is null or t.product_code = any(p_product_codes))
    and not exists (select 1 from sementrack.subdist_customer sx where sx.dist_code = t.dist_code and sx.customer_code = t.customer_code)
  group by 1
  order by 2 desc nulls last;
$function$;

CREATE OR REPLACE FUNCTION sementrack.dashboard_product_breakdown_range(p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] DEFAULT NULL::text[])
 RETURNS TABLE(product_name text, total_qty numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(t.product_name, t.product_code, 'Tidak diketahui'),
         sum(calc_tonase(t.product_code, t.order_qty))
  from public.transaksi t
  where t.do_date between p_start_date and p_end_date
    and (p_dist_code is null or t.dist_code = any(p_dist_code))
    and (p_product_codes is null or t.product_code = any(p_product_codes))
    and not exists (select 1 from sementrack.subdist_customer sx where sx.dist_code = t.dist_code and sx.customer_code = t.customer_code)
  group by 1
  having sum(calc_tonase(t.product_code, t.order_qty)) > 0
  order by 2 desc;
$function$;

