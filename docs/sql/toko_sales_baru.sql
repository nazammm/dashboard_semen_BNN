-- Kelola Data -> Toko & sales baru. Versi PostgreSQL dari docs/mssql/16_toko_sales_baru.sql.
create or replace view sementrack.v_toko_baru as
with a as (
  select t.customer_code::text, t.dist_code::text, max(t.customer_name)::text as customer_name,
         min(t.do_date) as first_do, max(t.do_date) as last_do, count(distinct t.do_no) as num_do,
         sum(calc_tonase(t.product_code, t.order_qty)) as total_qty, sum(coalesce(t.net_amount, 0)) as net_amount
  from public.transaksi t
  where t.do_date is not null and t.customer_code is not null and btrim(t.customer_code::text) <> ''
  group by 1, 2
)
select a.customer_code as cust_code, coalesce(k.cust_name, a.customer_name) as cust_name, a.dist_code,
       k.zona, k.latitude, k.longitude, (k.cust_code is not null) as ada_master, (s.customer_code is not null) as is_subdist,
       a.first_do, min(a.first_do) over (partition by a.customer_code) as first_do_toko, a.last_do, a.num_do, a.total_qty, a.net_amount
from a
left join public.toko k on k.cust_code = a.customer_code
left join sementrack.subdist_customer s on s.dist_code = a.dist_code and s.customer_code = a.customer_code;

create or replace view sementrack.v_salesman_baru as
with a as (
  select t.salesman_code::text, max(t.dist_code)::text as dist_code, min(t.do_date) as first_do, max(t.do_date) as last_do, count(distinct t.do_no) as num_do
  from public.transaksi t
  where t.do_date is not null and t.salesman_code is not null and btrim(t.salesman_code::text) <> ''
  group by 1
), tg as (
  select kode as salesman_code, max(tahun * 100 + bulan) as target_terakhir from sementrack.target where jenis = 'salesman' group by 1
)
select a.salesman_code, a.dist_code,
       coalesce((select g.nama from sementrack.target g where g.jenis = 'salesman' and g.kode = a.salesman_code order by g.tahun desc, g.bulan desc limit 1),
                (select max(st.salesman_name) from public.salesman_status_target st where st.salesman_code = a.salesman_code),
                a.salesman_code) as salesman_name,
       a.first_do, a.last_do, a.num_do, tg.target_terakhir
from a left join tg on tg.salesman_code = a.salesman_code;
grant select on sementrack.v_toko_baru, sementrack.v_salesman_baru to public;
