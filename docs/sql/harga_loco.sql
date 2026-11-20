-- ============================================================================
-- harga_loco.sql · Harga Loco Net untuk perkiraan nilai Outstanding DO (PostgreSQL).
-- Kembaran docs/mssql/18_harga_loco.sql. Jalankan setelah outstanding_do.sql dan ongkos_kirim.sql;
-- kalau outstanding_do.sql dijalankan ulang, jalankan file ini lagi sesudahnya.
-- ============================================================================
begin;

create table if not exists sementrack.harga_loco (
  dist_code text not null, product_code text not null, product_name text, semen text not null, kg numeric,
  opc boolean not null default false, warehouse text not null default '',
  berlaku_dari date not null, berlaku_sampai date, price numeric, net_price numeric not null, diambil date,
  created_by text, created_at timestamptz not null default now(),
  primary key (dist_code, product_code, warehouse, berlaku_dari)
);
create index if not exists harga_loco_cari_idx on sementrack.harga_loco (dist_code, semen, kg, berlaku_dari);

create table if not exists sementrack.harga_dist_map (
  os_code text not null, region_like text not null, erp_code text not null, primary key (os_code, region_like)
);
insert into sementrack.harga_dist_map (os_code, region_like, erp_code)
select * from (values ('1001', '%KTP%', '1001K'), ('1001', '%', '1001P')) v(a, b, c)
where not exists (select 1 from sementrack.harga_dist_map where os_code = '1001');

create table if not exists sementrack.harga_gudang_map (
  dist_code text not null, tujuan_like text not null, warehouse text not null, primary key (dist_code, tujuan_like)
);
insert into sementrack.harga_gudang_map (dist_code, tujuan_like, warehouse)
select * from (values ('4094', '%', 'INSA'), ('4094', '%KUALA TANJUNG%', 'KUALA TANJUNG'), ('4094', '%ACEH%', 'ACEH'),
                      ('4094', '%LHOKSEUMAWE%', 'ACEH'), ('4094', '%KRUENG GEUKUEH%', 'ACEH'), ('4094', '%MALAHAYATI%', 'ACEH'),
                      ('4094', '%MEULABOH%', 'ACEH')) v(a, b, c)
where not exists (select 1 from sementrack.harga_gudang_map where dist_code = '4094');

alter table sementrack.kelola_log drop constraint if exists kelola_log_dataset_check;
alter table sementrack.kelola_log add constraint kelola_log_dataset_check
  check (dataset in ('transaksi', 'sellin', 'dofas', 'erp', 'j073', 'target', 'outstanding', 'tabel', 'stock', 'ongkos', 'harga'));

create or replace function sementrack.harga_loco_simpan(p_rows json, p_user text, p_file text default null)
returns table(rows_saved integer, rows_deleted integer, date_from date, date_to date, dist_codes text[], kombinasi integer)
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_old integer; v_new integer; v_from date; v_to date; v_dists text[]; v_komb integer; v_b integer;
begin
  if json_typeof(p_rows) <> 'array' or json_array_length(p_rows) = 0 then raise exception 'Tidak ada baris harga' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('harga_loco'));
  create temp table _h on commit drop as
  select r.ord::int as baris, upper(btrim(r.val ->> 0)) as dist_code, upper(btrim(r.val ->> 1)) as product_code,
         nullif(btrim(r.val ->> 2), '') as product_name, upper(btrim(r.val ->> 3)) as semen, nullif(r.val ->> 4, '')::numeric as kg,
         coalesce(r.val ->> 5, '0') in ('1', 'true') as opc, coalesce(upper(btrim(r.val ->> 6)), '') as warehouse,
         nullif(r.val ->> 7, '')::date as berlaku_dari, nullif(r.val ->> 8, '')::date as berlaku_sampai,
         nullif(r.val ->> 9, '')::numeric as price, nullif(r.val ->> 10, '')::numeric as net_price, nullif(r.val ->> 11, '')::date as diambil
  from json_array_elements(p_rows) with ordinality as r(val, ord);
  select min(baris) into v_b from _h
  where coalesce(dist_code, '') = '' or coalesce(product_code, '') = '' or semen not in ('STR', 'RJW', 'CWC')
     or berlaku_dari is null or net_price is null or net_price <= 0 or (berlaku_sampai is not null and berlaku_sampai < berlaku_dari);
  if v_b is not null then raise exception 'Baris harga tidak lengkap (baris %)', v_b using errcode = '22023'; end if;
  delete from _h a using _h b
  where a.dist_code = b.dist_code and a.product_code = b.product_code and a.warehouse = b.warehouse and a.berlaku_dari = b.berlaku_dari
    and (coalesce(a.diambil, '1900-01-01') < coalesce(b.diambil, '1900-01-01') or (coalesce(a.diambil, '1900-01-01') = coalesce(b.diambil, '1900-01-01') and a.baris < b.baris));
  with d as (delete from sementrack.harga_loco h using (select dist_code, product_code, min(berlaku_dari) as mulai from _h group by 1, 2) r
             where h.dist_code = r.dist_code and h.product_code = r.product_code and h.berlaku_dari >= r.mulai returning 1)
  select count(*) into v_old from d;
  insert into sementrack.harga_loco (dist_code, product_code, product_name, semen, kg, opc, warehouse, berlaku_dari, berlaku_sampai, price, net_price, diambil, created_by)
  select dist_code, product_code, product_name, semen, kg, opc, warehouse, berlaku_dari, berlaku_sampai, price, net_price, diambil, p_user from _h;
  get diagnostics v_new = row_count;
  select min(berlaku_dari), max(coalesce(berlaku_sampai, diambil)), array_agg(distinct dist_code order by dist_code), count(distinct (dist_code, product_code))
    into v_from, v_to, v_dists, v_komb from _h;
  insert into sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes, rows_read, rows_saved, rows_deleted, status, finished_at)
  values ('harga', 'upload', p_user, 'file', left(p_file, 200), v_from, v_to, v_dists, v_new, v_new, v_old, 'selesai', now());
  return query select v_new, v_old, v_from, v_to, v_dists, v_komb;
end $$;

drop view if exists sementrack.v_outstanding_do_ringkas;
drop view if exists sementrack.v_outstanding_do_harga;
create view sementrack.v_outstanding_do_harga as
select o.*, e.erp_code as harga_dist, h.product_code as harga_produk, h.warehouse as harga_gudang, h.net_price as harga_loco,
       h.berlaku_dari as harga_dari, h.berlaku_sampai as harga_sampai, round(o.sisa_zak * h.net_price, 2) as nilai
from sementrack.v_outstanding_do o
cross join lateral (select split_part(o.distributor, ' ', 1) as os_code,
                           round(o.sisa_ton * 1000 / nullif(o.sisa_zak, 0), 0) as kg, o.produk ~* 'OPC' as opc) k
left join lateral (select m.erp_code from sementrack.harga_dist_map m
                   where m.os_code = k.os_code and coalesce(o.region, '') like m.region_like
                   order by (m.region_like = '%'), length(m.region_like) desc limit 1) mp on true
cross join lateral (select coalesce(mp.erp_code, k.os_code) as erp_code) e
cross join lateral (select upper(coalesce(o.nama_tujuan, '') || ' | ' || coalesce(o.region, '')) as tujuan) t
left join lateral (select g.warehouse from sementrack.harga_gudang_map g
                   where g.dist_code = e.erp_code and g.tujuan_like <> '%' and t.tujuan like upper(g.tujuan_like)
                   order by length(g.tujuan_like) desc limit 1) gm on true
left join lateral (select g.warehouse from sementrack.harga_gudang_map g where g.dist_code = e.erp_code and g.tujuan_like = '%' limit 1) gd on true
left join lateral (select h.product_code, h.net_price, h.berlaku_dari, h.berlaku_sampai, h.warehouse, r.rk
                   from sementrack.harga_loco h
                   cross join lateral (select case when h.warehouse = gm.warehouse then 0
                                                   when h.warehouse <> '' and strpos(t.tujuan, h.warehouse) > 0 then 1
                                                   when h.warehouse = gd.warehouse then 2 else 3 end as rk) r
                   where h.dist_code = e.erp_code and h.semen = o.semen and h.kg = k.kg and h.opc = k.opc
                     and o.tanggal_order >= h.berlaku_dari and (h.berlaku_sampai is null or o.tanggal_order <= h.berlaku_sampai)
                     and (r.rk < 3 or not exists (select 1 from sementrack.harga_loco h2
                                                  where h2.dist_code = h.dist_code and h2.semen = h.semen and h2.kg = h.kg and h2.opc = h.opc
                                                    and h2.warehouse <> h.warehouse and o.tanggal_order >= h2.berlaku_dari
                                                    and (h2.berlaku_sampai is null or o.tanggal_order <= h2.berlaku_sampai)))
                   order by r.rk, h.berlaku_dari desc, h.product_code limit 1) h on true;

create view sementrack.v_outstanding_do_ringkas as
select region, distributor, dist_nama, semen, status, jalur, tanggal_order, estimasi_kirim, posisi,
       count(*)::int as orders, round(sum(sisa_ton), 3) as ton,
       round(sum(nilai), 2) as nilai, round(sum(case when harga_loco is null then sisa_ton else 0 end), 3) as ton_tanpa_harga
from sementrack.v_outstanding_do_harga
group by 1, 2, 3, 4, 5, 6, 7, 8, 9;

drop view if exists sementrack.v_harga_loco_info;
create view sementrack.v_harga_loco_info as
select h.dist_code, h.product_code, h.warehouse, max(h.product_name) as product_name, h.semen, max(h.kg) as kg,
       count(*)::int as masa_berlaku, min(h.berlaku_dari) as dari, max(h.diambil) as diambil,
       (array_agg(h.net_price order by h.berlaku_dari desc))[1] as harga_terakhir,
       max(h.berlaku_dari) as berlaku_terakhir,
       (array_agg(h.berlaku_sampai order by h.berlaku_dari desc))[1] as sampai_terakhir
from sementrack.harga_loco h
group by h.dist_code, h.product_code, h.warehouse, h.semen;

grant select on sementrack.v_outstanding_do_harga, sementrack.v_outstanding_do_ringkas, sementrack.v_harga_loco_info to public;

commit;
