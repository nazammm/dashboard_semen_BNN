-- =====================================================================
-- Overview: filter rentang tanggal (dari - sampai)
-- Fungsi baru *_range, versi tanggal dari fungsi *_v2 yang berbasis bulan.
-- Fungsi lama TIDAK diubah (laporan PPT masih memakainya).
-- Aman dijalankan ulang (create or replace).
-- =====================================================================

-- 1. Ringkasan periode: tonase, DO, toko aktif, amount
--    Toko aktif = toko dengan net amount >= Rp200.000 dalam satu bulan (sama seperti v2),
--    dihitung dari transaksi di dalam rentang saja.
create or replace function sementrack.dashboard_period_summary_range(
  p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] default null)
returns table(total_qty numeric, order_qty numeric, bonus_qty numeric, num_do bigint,
              num_active_stores bigint, num_lines bigint, net_amount numeric)
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  with base as (
    select * from public.transaksi
    where do_date between p_start_date and p_end_date
      and (p_dist_code is null or dist_code = any(p_dist_code))
      and (p_product_codes is null or product_code = any(p_product_codes))
  ),
  cust_month as (
    select customer_code, date_trunc('month', do_date) as bulan, sum(coalesce(net_amount, 0)) as net_amount
    from base
    group by customer_code, date_trunc('month', do_date)
  )
  select
    coalesce((select sum(calc_tonase(product_code, order_qty)) from base), 0),
    coalesce((select sum(order_qty) from base), 0),
    coalesce((select sum(bonus_qty) from base), 0),
    coalesce((select count(distinct do_no) from base), 0),
    coalesce((select count(distinct customer_code) from cust_month where net_amount >= 200000), 0),
    coalesce((select count(*) from base), 0),
    coalesce((select sum(coalesce(net_amount, 0)) from base), 0);
$$;

-- 2. Top customer
--    Filter distributor memakai distributor di transaksi (toko yang dilayani 2 distributor
--    hanya dihitung tonase dari distributor yang dipilih). Kalau satu toko dilayani lebih dari
--    satu distributor dalam rentang itu, kolom dist_code berisi semua kodenya, mis. "BKP, PTK".
create or replace function sementrack.dashboard_top_customers_range(
  p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] default null, p_limit integer default 10)
returns table(customer_code text, cust_name text, dist_code text, dist_name text,
              total_qty numeric, num_do bigint, net_amount numeric)
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select
    coalesce(nullif(nullif(btrim(t.parent_customer_code), ''), '0'), t.customer_code) as customer_code,
    coalesce(max(nullif(nullif(btrim(t.parent_customer_name), ''), '0')), max(t.customer_name)) as cust_name,
    string_agg(distinct t.dist_code, ', ' order by t.dist_code) as dist_code,
    case when count(distinct t.dist_code) = 1 then coalesce(max(d.dist_name), max(t.distributor_name)) end as dist_name,
    sum(calc_tonase(t.product_code, t.order_qty)) as total_qty,
    count(distinct t.do_no) as num_do,
    sum(coalesce(t.net_amount, 0)) as net_amount
  from public.transaksi t
  left join public.distributor d on d.dist_code = t.dist_code
  where t.do_date between p_start_date and p_end_date
    and (p_dist_code is null or t.dist_code = any(p_dist_code))
    and (p_product_codes is null or t.product_code = any(p_product_codes))
  group by 1
  order by total_qty desc nulls last
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

-- 3. Online vs offline
create or replace function sementrack.dashboard_channel_breakdown_range(
  p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] default null)
returns table(channel text, num_do bigint, net_amount numeric)
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select case when t.mss_no_order is not null and btrim(t.mss_no_order) not in ('', '0') then 'Online' else 'Offline' end,
         count(distinct t.do_no),
         sum(coalesce(t.net_amount, 0))
  from public.transaksi t
  where t.do_date between p_start_date and p_end_date
    and (p_dist_code is null or t.dist_code = any(p_dist_code))
    and (p_product_codes is null or t.product_code = any(p_product_codes))
  group by 1
  order by 2 desc;
$$;

-- 4. Metode pembayaran
create or replace function sementrack.dashboard_payment_breakdown_range(
  p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] default null)
returns table(payment text, num_do bigint, net_amount numeric)
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(t.payment, 'Tidak diketahui'),
         count(distinct t.do_no),
         sum(coalesce(t.net_amount, 0))
  from public.transaksi t
  where t.do_date between p_start_date and p_end_date
    and (p_dist_code is null or t.dist_code = any(p_dist_code))
    and (p_product_codes is null or t.product_code = any(p_product_codes))
  group by 1
  order by 3 desc;
$$;

-- 5. Delivery type
create or replace function sementrack.dashboard_delivery_type_breakdown_range(
  p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] default null)
returns table(delivery_type text, total_qty numeric)
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(t.delivery_type, 'Tidak diketahui'),
         sum(calc_tonase(t.product_code, t.order_qty))
  from public.transaksi t
  where t.do_date between p_start_date and p_end_date
    and (p_dist_code is null or t.dist_code = any(p_dist_code))
    and (p_product_codes is null or t.product_code = any(p_product_codes))
  group by 1
  order by 2 desc nulls last;
$$;

-- 6. Bauran produk (sebelumnya dihitung di browser dari data bulanan)
create or replace function sementrack.dashboard_product_breakdown_range(
  p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] default null)
returns table(product_name text, total_qty numeric)
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(t.product_name, t.product_code, 'Tidak diketahui'),
         sum(calc_tonase(t.product_code, t.order_qty))
  from public.transaksi t
  where t.do_date between p_start_date and p_end_date
    and (p_dist_code is null or t.dist_code = any(p_dist_code))
    and (p_product_codes is null or t.product_code = any(p_product_codes))
  group by 1
  having sum(calc_tonase(t.product_code, t.order_qty)) > 0
  order by 2 desc;
$$;

-- Hak jalankan (fungsi hanya membaca data)
grant execute on function
  sementrack.dashboard_period_summary_range(text[], date, date, text[]),
  sementrack.dashboard_top_customers_range(text[], date, date, text[], integer),
  sementrack.dashboard_channel_breakdown_range(text[], date, date, text[]),
  sementrack.dashboard_payment_breakdown_range(text[], date, date, text[]),
  sementrack.dashboard_delivery_type_breakdown_range(text[], date, date, text[]),
  sementrack.dashboard_product_breakdown_range(text[], date, date, text[])
to public;

-- Cek cepat setelah dijalankan (1-2 Nov 2026, semua distributor):
-- select * from sementrack.dashboard_period_summary_range(null, '2026-11-01', '2026-11-02');
-- Harus sama dengan bulan penuh versi lama kalau rentangnya 1 bulan penuh:
-- select * from sementrack.dashboard_period_summary_range(null, '2026-10-01', '2026-10-31');
-- select * from public.dashboard_period_summary_v2(null, 2026, 10, 10);
