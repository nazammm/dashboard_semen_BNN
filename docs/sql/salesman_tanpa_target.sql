-- Tim Sales: salesman baru (ada di transaksi, belum punya target bulan itu) ikut tampil, status 'Tanpa target'.
-- Versi PostgreSQL dari docs/mssql/15_salesman_tanpa_target.sql.
create or replace view sementrack.v_salesman_performance as
with t as (
  select tahun, bulan, area as dist_code, kode as salesman_code, max(nama) as salesman_name, max(status) as status,
         sum(nilai) filter (where metrik = 'target_ta') as target_ta,
         sum(nilai) filter (where metrik = 'target_ton') as target_tonase
  from sementrack.target where jenis = 'salesman'
  group by tahun, bulan, area, kode
), tr as (
  select x.salesman_code, x.dist_code, extract(year from x.do_date)::int as tahun, extract(month from x.do_date)::int as bulan,
         x.customer_code, x.do_no, x.net_amount, calc_tonase(x.product_code, x.order_qty) as ton
  from public.transaksi x
  where x.do_date >= make_date((select min(t1.tahun) from t t1), 1, 1)
    and not exists (select 1 from sementrack.subdist_customer s where s.dist_code = x.dist_code and s.customer_code = x.customer_code)
), tot as (
  select salesman_code, tahun, bulan, sum(ton) as total_qty, sum(coalesce(net_amount, 0)) as net_amount, count(distinct do_no) as num_do
  from tr group by salesman_code, tahun, bulan
), act as (
  select c.salesman_code, c.tahun, c.bulan, count(*) as num_active_stores
  from (select salesman_code, tahun, bulan, customer_code from tr group by 1, 2, 3, 4 having sum(coalesce(net_amount, 0)) >= 200000) c
  group by c.salesman_code, c.tahun, c.bulan
), baru as (
  select tr.tahun, tr.bulan, max(tr.dist_code) as dist_code, tr.salesman_code
  from tr
  where tr.salesman_code is not null and btrim(tr.salesman_code) <> ''
    and not exists (select 1 from t where t.salesman_code = tr.salesman_code and t.tahun = tr.tahun and t.bulan = tr.bulan)
  group by tr.tahun, tr.bulan, tr.salesman_code
), semua as (
  select tahun, bulan, dist_code, salesman_code, salesman_name, status, target_ta, target_tonase from t
  union all
  select b.tahun, b.bulan, b.dist_code, b.salesman_code,
         coalesce((select t2.salesman_name from t t2 where t2.salesman_code = b.salesman_code order by t2.tahun desc, t2.bulan desc limit 1),
                  (select max(st.salesman_name) from public.salesman_status_target st where st.salesman_code = b.salesman_code),
                  b.salesman_code),
         'Tanpa target', null, null
  from baru b
)
select t.tahun, t.dist_code, t.salesman_code, t.salesman_name, t.bulan as month,
       coalesce(t.target_ta, 0) as target_ta, coalesce(t.target_tonase, 0) as target_tonase, t.status,
       coalesce(tot.total_qty, 0) as actual_tonase, coalesce(act.num_active_stores, 0) as actual_ta,
       coalesce(tot.num_do, 0) as actual_num_do, coalesce(tot.net_amount, 0) as actual_omzet
from semua t
left join tot on tot.salesman_code = t.salesman_code and tot.tahun = t.tahun and tot.bulan = t.bulan
left join act on act.salesman_code = t.salesman_code and act.tahun = t.tahun and act.bulan = t.bulan;
