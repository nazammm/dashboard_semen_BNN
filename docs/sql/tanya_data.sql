-- Tanya Data: toko aktif per bulan tanpa subdist. Versi PostgreSQL dari docs/mssql/13_tanya_data.sql.
create or replace view sementrack.v_toko_aktif_bulanan as
with b as (
  select t.customer_code::text, t.dist_code::text, extract(year from t.do_date)::int as year, extract(month from t.do_date)::int as month, coalesce(t.net_amount, 0) as net_amount
  from public.transaksi t
  where t.do_date is not null and t.customer_code is not null and btrim(t.customer_code::text) <> ''
    and not exists (select 1 from sementrack.subdist_customer s where s.dist_code = t.dist_code and s.customer_code = t.customer_code)
), per_dist as (
  select dist_code, year, month, customer_code from b group by 1, 2, 3, 4 having sum(net_amount) >= 200000
), semua as (
  select year, month, customer_code from b group by 1, 2, 3 having sum(net_amount) >= 200000
)
select dist_code, year, month, count(*)::int as num_active_stores from per_dist group by 1, 2, 3
union all
select '*', year, month, count(*)::int from semua group by year, month;
grant select on sementrack.v_toko_aktif_bulanan to public;
