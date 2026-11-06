-- =====================================================================
-- Toko aktif TANPA subdist, di semua halaman.
-- Customer di sementrack.subdist_customer (mis. JMB 18001 PGS, 18469 MGSS, 19213 MAJU)
-- adalah subdist, bukan toko: transaksinya tetap dihitung tonase / amount, tetapi
-- TIDAK dihitung toko aktif dan tidak ikut capaian TA salesman.
-- Pasangan dicocokkan per distributor + customer (kode customer bisa sama di distributor lain).
--
-- Yang diubah (semua di schema sementrack; objek public TIDAK diubah, laporan PPT masih memakainya):
--   1. dashboard_period_summary_range  Overview: kartu Toko Aktif & Cakupan Toko Aktif
--   2. dashboard_top_customers_range   Overview: top customer diberi tanda subdist (tidak dibuang)
--   3. dashboard_toko_monthly_v2       Daftar Toko & Peta Toko: status per toko
--   4. dashboard_store_year            Detail Toko (versi baru, backend diarahkan ke sini)
--   5. v_salesman_performance          Tim Sales & Detail Transaksi: TA aktual (versi baru)
--   6. v_toko_pegangan_sales           Detail Transaksi: toko pegangan aktif (versi baru)
-- 4–6 baru terpakai setelah backend dideploy ulang; sebelum itu web tetap memakai versi public.
--
-- Jalankan SETELAH sell_out_bnn.sql (butuh tabel sementrack.subdist_customer),
-- sebagai pemilik tabel (nazamudin). Aman dijalankan ulang. Tidak mengubah data.
-- =====================================================================
begin;

-- Kalau sell_out_bnn.sql belum dijalankan: tabel subdist dibuat di sini juga (isi sama).
create table if not exists sementrack.subdist_customer (
  dist_code     text not null,
  customer_code text not null,
  subdist       text not null,
  primary key (dist_code, customer_code)
);
insert into sementrack.subdist_customer (dist_code, customer_code, subdist) values
  ('JMB', '18001', 'PGS'), ('JMB', '18469', 'MGSS'), ('JMB', '19213', 'MAJU'),
  ('PTK', '8285', 'BSJ'), ('PTK', '7105', 'Pangkalant'),
  ('PM', '10043', 'SIN'),
  ('PKB', '11733', 'Dumai-Patent')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1. Overview: ringkasan periode. Toko aktif = customer (bukan subdist) dengan net >= 200.000 sebulan.
-- ---------------------------------------------------------------------
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
$$;

-- ---------------------------------------------------------------------
-- 2. Overview: top customer + kolom is_subdist (semua transaksinya ke distributor yang mencatatnya sebagai subdist).
--    Tipe hasil berubah (kolom baru) -> drop dulu.
-- ---------------------------------------------------------------------
drop function if exists sementrack.dashboard_top_customers_range(text[], date, date, text[], integer);
create function sementrack.dashboard_top_customers_range(
  p_dist_code text[], p_start_date date, p_end_date date, p_product_codes text[] default null, p_limit integer default 10)
returns table(customer_code text, cust_name text, dist_code text, dist_name text, total_qty numeric,
              num_do bigint, net_amount numeric, is_subdist boolean)
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
    sum(coalesce(t.net_amount, 0)) as net_amount,
    bool_and(s.customer_code is not null) as is_subdist
  from public.transaksi t
  left join public.distributor d on d.dist_code = t.dist_code
  left join sementrack.subdist_customer s on s.dist_code = t.dist_code and s.customer_code = t.customer_code
  where t.do_date between p_start_date and p_end_date
    and (p_dist_code is null or t.dist_code = any(p_dist_code))
    and (p_product_codes is null or t.product_code = any(p_product_codes))
  group by 1
  order by total_qty desc nulls last
  limit least(greatest(coalesce(p_limit, 10), 1), 100);
$$;

-- ---------------------------------------------------------------------
-- 3. Daftar Toko & Peta Toko: status per toko per distributor.
--    Subdist: is_active selalu false, is_subdist = true (web menampilkan "Subdist").
-- ---------------------------------------------------------------------
drop function if exists sementrack.dashboard_toko_monthly_v2(integer, integer, text[]);
create function sementrack.dashboard_toko_monthly_v2(p_year integer, p_month integer, p_dist_code text[] default null)
returns table(cust_code text, cust_name text, dist_code text, dist_name text, zona text, latitude numeric, longitude numeric,
              total_qty numeric, num_do bigint, net_amount numeric, is_active boolean, last_transaction date, is_subdist boolean)
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select tk.cust_code, tk.cust_name, tk.dist_code, tk.dist_name, tk.zona,
    tk.latitude, tk.longitude,
    coalesce(m.total_qty, 0) as total_qty,
    coalesce(m.num_do, 0) as num_do,
    coalesce(m.net_amount, 0) as net_amount,
    (coalesce(m.net_amount, 0) >= 200000 and s.customer_code is null) as is_active,
    o.last_transaction,
    (s.customer_code is not null) as is_subdist
  from sementrack.v_toko_multi tk
  left join sementrack.subdist_customer s on s.dist_code = tk.dist_code and s.customer_code = tk.cust_code
  left join (
    select customer_code, dist_code,
      sum(calc_tonase(product_code, order_qty)) as total_qty,
      count(distinct do_no) as num_do,
      sum(coalesce(net_amount, 0)) as net_amount
    from public.transaksi
    where extract(year from do_date)::int = p_year and extract(month from do_date)::int = p_month
    group by customer_code, dist_code
  ) m on m.customer_code = tk.cust_code and m.dist_code = tk.dist_code
  left join (
    select customer_code, dist_code, max(do_date) as last_transaction
    from public.transaksi
    group by customer_code, dist_code
  ) o on o.customer_code = tk.cust_code and o.dist_code = tk.dist_code
  where (p_dist_code is null or tk.dist_code = any(p_dist_code));
$$;

-- ---------------------------------------------------------------------
-- 4. Detail Toko: per bulan satu customer (semua distributor).
--    is_active hanya dari transaksi ke distributor yang TIDAK mencatatnya sebagai subdist.
--    is_subdist = semua transaksi bulan itu ke distributor yang mencatatnya sebagai subdist.
-- ---------------------------------------------------------------------
create or replace function sementrack.dashboard_store_year(p_customer_code text, p_year integer)
returns table(month integer, total_qty numeric, net_amount numeric, num_do bigint, is_active boolean, is_subdist boolean)
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select (extract(month from t.do_date))::int as month,
    sum(calc_tonase(t.product_code, t.order_qty)) as total_qty,
    sum(coalesce(t.net_amount, 0)) as net_amount,
    count(distinct t.do_no) as num_do,
    (coalesce(sum(coalesce(t.net_amount, 0)) filter (where s.customer_code is null), 0) >= 200000) as is_active,
    bool_and(s.customer_code is not null) as is_subdist
  from public.transaksi t
  left join sementrack.subdist_customer s on s.dist_code = t.dist_code and s.customer_code = t.customer_code
  where t.customer_code = p_customer_code
    and extract(year from t.do_date)::int = p_year
  group by (extract(month from t.do_date))::int
  order by month;
$$;

-- ---------------------------------------------------------------------
-- 5. Tim Sales: TA aktual per salesman per bulan, tanpa subdist (salinan public.v_salesman_performance).
-- ---------------------------------------------------------------------
create or replace view sementrack.v_salesman_performance as
 SELECT t.dist_code,
    t.salesman_code,
    t.salesman_name,
    t."Month" AS month,
    t."Target TA" AS target_ta,
    t."Target Tonase" AS target_tonase,
    t.status,
    COALESCE(tot.total_qty, 0::numeric) AS actual_tonase,
    COALESCE(act.num_active_stores, 0::bigint) AS actual_ta,
    COALESCE(tot.num_do, 0::bigint) AS actual_num_do,
    COALESCE(tot.net_amount, 0::numeric) AS actual_omzet
   FROM public.salesman_status_target t
     LEFT JOIN ( SELECT tr.salesman_code,
            EXTRACT(month FROM tr.do_date)::integer AS month,
            sum(public.calc_tonase(tr.product_code, tr.order_qty)) AS total_qty,
            sum(COALESCE(tr.net_amount, 0::numeric)) AS net_amount,
            count(DISTINCT tr.do_no) AS num_do
           FROM public.transaksi tr
          WHERE EXTRACT(year FROM tr.do_date) = (SELECT max(EXTRACT(year FROM t1.do_date)) FROM public.transaksi t1)
          GROUP BY tr.salesman_code, (EXTRACT(month FROM tr.do_date)::integer)) tot
       ON tot.salesman_code = t.salesman_code AND tot.month = t."Month"
     LEFT JOIN ( SELECT cs.salesman_code, cs.month, count(DISTINCT cs.customer_code) AS num_active_stores
           FROM ( SELECT tr.salesman_code, tr.customer_code,
                    EXTRACT(month FROM tr.do_date)::integer AS month,
                    sum(COALESCE(tr.net_amount, 0::numeric)) AS cust_net
                   FROM public.transaksi tr
                  WHERE EXTRACT(year FROM tr.do_date) = (SELECT max(EXTRACT(year FROM t1.do_date)) FROM public.transaksi t1)
                    AND NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer s
                                    WHERE s.dist_code = tr.dist_code AND s.customer_code = tr.customer_code)
                  GROUP BY tr.salesman_code, tr.customer_code, (EXTRACT(month FROM tr.do_date)::integer)) cs
          WHERE cs.cust_net >= 200000::numeric
          GROUP BY cs.salesman_code, cs.month) act
       ON act.salesman_code = t.salesman_code AND act.month = t."Month";

-- ---------------------------------------------------------------------
-- 6. Detail Transaksi: toko pegangan salesman, subdist tidak dihitung aktif (+ kolom is_subdist).
-- ---------------------------------------------------------------------
create or replace view sementrack.v_toko_pegangan_sales as
 SELECT tp.salesman_code,
    tp.month::integer AS month,
    tp.dist_code,
    tp.dist_name,
    tp.cust_code,
    tp.cust_name,
    COALESCE(a.total_qty, 0::numeric) AS omset,
    COALESCE(a.num_do, 0::bigint) AS num_do,
    COALESCE(a.net_amount, 0::numeric) AS net_amount,
    COALESCE(a.net_amount, 0::numeric) >= 200000::numeric AND s.customer_code IS NULL AS is_active,
    s.customer_code IS NOT NULL AS is_subdist
   FROM public.toko_pegangan_sales tp
     LEFT JOIN sementrack.subdist_customer s ON s.dist_code = tp.dist_code AND s.customer_code = tp.cust_code
     LEFT JOIN ( SELECT tr.customer_code, tr.salesman_code,
            EXTRACT(month FROM tr.do_date)::integer AS month,
            sum(public.calc_tonase(tr.product_code, tr.order_qty)) AS total_qty,
            count(DISTINCT tr.do_no) AS num_do,
            sum(COALESCE(tr.net_amount, 0::numeric)) AS net_amount
           FROM public.transaksi tr
          WHERE EXTRACT(year FROM tr.do_date) = (SELECT max(EXTRACT(year FROM t1.do_date)) FROM public.transaksi t1)
          GROUP BY tr.customer_code, tr.salesman_code, (EXTRACT(month FROM tr.do_date)::integer)) a
       ON a.customer_code = tp.cust_code AND a.salesman_code = tp.salesman_code AND a.month = tp.month::integer;

grant select on sementrack.subdist_customer, sementrack.v_salesman_performance, sementrack.v_toko_pegangan_sales to public;
grant execute on function sementrack.dashboard_period_summary_range(text[], date, date, text[]),
  sementrack.dashboard_top_customers_range(text[], date, date, text[], integer),
  sementrack.dashboard_toko_monthly_v2(integer, integer, text[]),
  sementrack.dashboard_store_year(text, integer) to public;

commit;
