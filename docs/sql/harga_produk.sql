-- harga_produk.sql · Halaman Harga Produk (PostgreSQL; kembaran docs/mssql/24_harga_produk.sql). Jalankan setelah harga_loco.sql.
drop view if exists sementrack.v_harga_produk;
create view sementrack.v_harga_produk as
select x.*, d.kode, d.nama
from (
  select h.dist_code, 'LOCO GUDANG'::text as delivery_type, ''::text as zone, h.product_code, h.product_name, h.semen, h.kg, h.warehouse,
         h.berlaku_dari, h.berlaku_sampai, h.price, null::numeric as discount, h.net_price, null::numeric as ongkir,
         lag(h.price) over (partition by h.dist_code, h.product_code, h.warehouse order by h.berlaku_dari) as harga_sebelum,
         lag(h.net_price) over (partition by h.dist_code, h.product_code, h.warehouse order by h.berlaku_dari) as net_sebelum,
         h.diambil
  from sementrack.harga_loco h
  union all
  select k.dist_code, k.delivery_type, k.zone, k.product_code, k.product_name, l.semen, l.kg, k.warehouse,
         k.berlaku_dari, k.berlaku_sampai, k.price, k.discount, k.net_price, k.ongkir,
         lag(k.price) over (partition by k.dist_code, k.product_code, k.delivery_type, k.zone, k.warehouse order by k.berlaku_dari),
         lag(k.net_price) over (partition by k.dist_code, k.product_code, k.delivery_type, k.zone, k.warehouse order by k.berlaku_dari),
         k.diambil
  from sementrack.harga_kirim k
  left join lateral (select h.semen, h.kg from sementrack.harga_loco h where h.dist_code = k.dist_code and h.product_code = k.product_code order by h.berlaku_dari desc limit 1) l on true
) x
left join lateral (select d.dist_code as kode, d.dist_name as nama from public.distributor d where d.kode_erp = x.dist_code order by d.dist_code limit 1) d on true
where x.berlaku_sampai is null or x.berlaku_sampai >= date '2025-01-01';
grant select on sementrack.v_harga_produk to public;
