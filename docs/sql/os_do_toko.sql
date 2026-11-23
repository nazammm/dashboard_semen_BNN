-- os_do_toko.sql · OS DO toko (J073 Qty Remains) + selisih terhadap harga sekarang (PostgreSQL; kembaran docs/mssql/21_os_do_toko.sql)
drop view if exists sementrack.v_os_do_toko;
create view sementrack.v_os_do_toko as
select s.dist_code, coalesce(d.nama, s.dist_code) as dist_nama, s.do_date, s.do_no, s.customer_code, s.customer_name,
       coalesce(s.cust_group, 'RETAIL') as cust_group, s.product_code, s.product_name, s.delivery_type,
       upper(split_part(btrim(s.delivery_type), ' ', 1)) as tipe_kode,
       s.zona_kirim, s.warehouse, s.order_qty, s.qty_sisa,
       sementrack.j073_ton(s.product_code, s.product_name, s.qty_sisa) as ton_sisa,
       s.harga_produk as harga_do, b.harga_baru, b.harga_dari, tm.delivery_type as tipe_harga,
       s.harga_produk * s.qty_sisa as nilai_sisa,
       (s.harga_produk - b.harga_baru) * s.qty_sisa as selisih,
       s.data_per, coalesce(s.data_per, current_date) - s.do_date as umur_hari
from sementrack.sellout_j073 s
left join sementrack.sellout_j073_dist d on d.dist_code = s.dist_code
left join lateral (select m.delivery_type from sementrack.harga_tipe_map m where m.kode = upper(split_part(btrim(s.delivery_type), ' ', 1)) limit 1) tm on true
left join lateral (select h.price, h.net_price, h.berlaku_dari from sementrack.harga_loco h
                   where h.dist_code = s.dist_code and h.product_code = s.product_code
                     and current_date >= h.berlaku_dari and (h.berlaku_sampai is null or current_date <= h.berlaku_sampai)
                     and (h.warehouse = coalesce(s.warehouse, '')
                          or (h.warehouse <> '' and coalesce(s.warehouse, '') like '%' || h.warehouse || '%')
                          or (coalesce(s.warehouse, '') <> '' and h.warehouse like '%' || s.warehouse || '%')
                          or not exists (select 1 from sementrack.harga_loco h2
                                         where h2.dist_code = h.dist_code and h2.product_code = h.product_code and h2.warehouse <> h.warehouse
                                           and current_date >= h2.berlaku_dari and (h2.berlaku_sampai is null or current_date <= h2.berlaku_sampai)))
                   order by (h.warehouse = coalesce(s.warehouse, '')) desc, h.berlaku_dari desc limit 1) hl on true
left join lateral (select hk.ongkir, hk.discount, hk.berlaku_dari from sementrack.harga_kirim hk
                   where tm.delivery_type is not null and tm.delivery_type <> 'LOCO GUDANG'
                     and hk.dist_code = s.dist_code and hk.product_code = s.product_code and hk.delivery_type = tm.delivery_type
                     and (hk.zone = upper(btrim(coalesce(s.zona_kirim, ''))) or hk.zone = '')
                     and current_date >= hk.berlaku_dari and (hk.berlaku_sampai is null or current_date <= hk.berlaku_sampai)
                     and (hk.warehouse = coalesce(s.warehouse, '')
                          or (hk.warehouse <> '' and coalesce(s.warehouse, '') like '%' || hk.warehouse || '%')
                          or (coalesce(s.warehouse, '') <> '' and hk.warehouse like '%' || s.warehouse || '%'))
                   order by (hk.zone = '') asc, (hk.warehouse = coalesce(s.warehouse, '')) desc, hk.berlaku_dari desc limit 1) hk on true
cross join lateral (select case when tm.delivery_type = 'LOCO GUDANG' or (tm.delivery_type is null and s.delivery_type like 'LG%') then hl.net_price
                                when hk.ongkir is not null and hl.price is not null then hl.price - coalesce(hk.discount, 0) + hk.ongkir end as harga_baru,
                           case when hk.berlaku_dari > coalesce(hl.berlaku_dari, date '1900-01-01') then hk.berlaku_dari else hl.berlaku_dari end as harga_dari) b
where s.qty_sisa > 0;
grant select on sementrack.v_os_do_toko to public;
