-- ============================================================================
-- ongkos_insight.sql · Ongkos Kirim lebih tepat (PostgreSQL; kembaran docs/mssql/20_ongkos_insight.sql)
-- - Angkutan ke gudang (baris ORDB019 tanpa No DO, "-") dipisah dari ongkos ke toko.
-- - Status transporter: normal / armada_sendiri (biaya di luar ERP, mis. LAM) / truk_toko (Eks. Toko, memang tanpa biaya).
-- - Ongkir dibayar toko: rincian Delivery di J073 kalau diisi; kalau kosong pada DO kirim, dari harga:
--   Product Price - harga Loco Net (harga_loco) pada tanggal DO (minimal 0).
-- Jalankan setelah ongkos_kirim.sql dan harga_loco.sql.
-- ============================================================================
begin;

create table if not exists sementrack.ongkos_transporter (
  kode text primary key,                       -- kode di depan nama transporter ORDB019 (BMM055, ISA061, ...)
  status text not null check (status in ('normal', 'armada_sendiri', 'truk_toko')),
  catatan text
);
create index if not exists harga_loco_produk_idx on sementrack.harga_loco (dist_code, product_code, berlaku_dari);

drop view if exists sementrack.v_ongkos_info;
drop view if exists sementrack.v_ongkos_do;
drop view if exists sementrack.v_ongkos_trip;

create view sementrack.v_ongkos_trip as
select t.*, coalesce(ot.status,
         case when t.transporter ilike '%LINTAS ABADI MAKMUR%' then 'armada_sendiri'
              when t.transporter ~* 'EKS\.?\s*TOKO' then 'truk_toko' else 'normal' end) as status_transporter
from (
  select k.dist_code, k.periode, k.foad, min(k.kirim_date) as kirim_date,
         max(k.transporter) as transporter, max(k.truk) as truk, max(k.asal) as asal, max(k.zona) as zona, max(k.tujuan) as tujuan,
         max(k.segmen) as segmen, max(k.harga_ritase) as harga_ritase, sum(k.total) as biaya, sum(k.ton) as ton,
         count(distinct k.do_no)::int as jumlah_do,
         bool_and(coalesce(btrim(k.do_no), '') in ('-', '')) as ke_gudang,
         split_part(max(k.transporter), ' - ', 1) as transporter_kode
  from sementrack.ongkos_kirim k
  group by k.dist_code, k.periode, k.foad
) t
left join sementrack.ongkos_transporter ot on ot.kode = t.transporter_kode;

create view sementrack.v_ongkos_do as
select k.dist_code, k.periode, k.do_no, k.biaya, k.ton_kirim, k.trip, k.trip_tanpa_biaya, k.trip_luar_erp, k.trip_truk_toko, k.truk, k.transporter, k.zona, k.segmen, k.tujuan,
       j.do_date, j.customer_code, j.customer_name, j.delivery_type,
       split_part(j.delivery_type, ' ', 1) as tipe_kirim,
       j.zona_kirim, j.kecamatan, j.kabupaten, j.ton_do,
       case when j.ton_do > 0 then j.net * k.ton_kirim / j.ton_do end as omzet,
       case when j.ton_do > 0 and j.delivery_type is not null then
         (case when j.ada_rincian then j.tagih_rincian when split_part(j.delivery_type, ' ', 1) = 'LG' then 0
               when j.tagih_harga is not null then j.tagih_harga end) * k.ton_kirim / j.ton_do end as tagih,   -- kosong = belum bisa dihitung (null), bukan 0
       case when j.delivery_type is null then null when j.ada_rincian then 'rincian' when split_part(j.delivery_type, ' ', 1) = 'LG' then 'lg'
            when j.tagih_harga is not null then 'harga' else 'kosong' end as tagih_sumber,
       case when j.ton_do > 0 and j.delivery_type is not null then j.handling * k.ton_kirim / j.ton_do end as handling,
       case when j.ton_loco > 0 then j.nilai_loco / j.ton_loco end as loco_per_ton,
       case when j.ton_harga > 0 then j.nilai_harga / j.ton_harga end as harga_per_ton
from (
  select o.dist_code, o.periode, o.do_no, sum(o.total) as biaya, sum(o.ton) as ton_kirim, count(distinct o.foad)::int as trip,
         count(distinct case when f.biaya = 0 and f.status_transporter <> 'truk_toko' then o.foad end)::int as trip_tanpa_biaya,
         count(distinct case when f.biaya = 0 and f.status_transporter = 'armada_sendiri' then o.foad end)::int as trip_luar_erp,
         count(distinct case when f.status_transporter = 'truk_toko' then o.foad end)::int as trip_truk_toko,
         max(o.truk) as truk, max(o.transporter) as transporter, max(o.zona) as zona, max(o.segmen) as segmen, max(o.tujuan) as tujuan
  from sementrack.ongkos_kirim o
  join sementrack.v_ongkos_trip f on f.dist_code = o.dist_code and f.periode = o.periode and f.foad = o.foad
  where o.ton > 0 and coalesce(btrim(o.do_no), '') not in ('-', '')
  group by o.dist_code, o.periode, o.do_no
) k
left join lateral (
  select min(s.do_date) as do_date, max(s.customer_code) as customer_code, max(s.customer_name) as customer_name,
         max(s.delivery_type) as delivery_type, max(s.zona_kirim) as zona_kirim, max(s.kecamatan) as kecamatan, max(s.kabupaten) as kabupaten,
         sum(sementrack.j073_ton(s.product_code, s.product_name, s.order_qty)) as ton_do, sum(s.net_amount) as net,
         bool_or(coalesce(s.harga_kirim, 0) <> 0 or coalesce(s.diskon_kirim, 0) <> 0 or coalesce(s.tambah_kirim, 0) <> 0) as ada_rincian,
         sum((coalesce(s.harga_kirim, 0) - coalesce(s.diskon_kirim, 0) + coalesce(s.tambah_kirim, 0)) * s.order_qty) as tagih_rincian,
         sum(greatest(s.harga_produk - hl.net_price, 0) * s.order_qty) filter (where s.harga_produk is not null and hl.net_price is not null) as tagih_harga,
         sum(coalesce(s.handling, 0) * s.order_qty) as handling,
         sum(hl.net_price * s.order_qty) filter (where hl.net_price is not null) as nilai_loco,
         sum(sementrack.j073_ton(s.product_code, s.product_name, s.order_qty)) filter (where hl.net_price is not null) as ton_loco,
         sum(s.harga_produk * s.order_qty) filter (where s.harga_produk is not null) as nilai_harga,
         sum(sementrack.j073_ton(s.product_code, s.product_name, s.order_qty)) filter (where s.harga_produk is not null) as ton_harga
  from sementrack.sellout_j073 s
  left join lateral (select h.net_price from sementrack.harga_loco h
                     where h.dist_code = s.dist_code and h.product_code = s.product_code
                       and s.do_date >= h.berlaku_dari and (h.berlaku_sampai is null or s.do_date <= h.berlaku_sampai)
                     order by (h.warehouse = coalesce(s.warehouse, '')) desc, h.berlaku_dari desc limit 1) hl on true
  where s.dist_code = k.dist_code and s.do_no = k.do_no
) j on true;

create view sementrack.v_ongkos_info as
select t.dist_code, d.kode, d.nama, t.periode,
       count(*) filter (where not t.ke_gudang)::int as trip,
       coalesce(sum(t.ton) filter (where not t.ke_gudang), 0) as ton,
       coalesce(sum(t.ton) filter (where not t.ke_gudang and t.biaya > 0), 0) as ton_berbiaya,
       coalesce(sum(t.biaya) filter (where not t.ke_gudang), 0) as biaya,
       count(*) filter (where t.ke_gudang)::int as trip_gudang,
       coalesce(sum(t.ton) filter (where t.ke_gudang), 0) as ton_gudang,
       coalesce(sum(t.biaya) filter (where t.ke_gudang), 0) as biaya_gudang,
       (select max(do_date) from sementrack.sellout_j073 j where j.dist_code = t.dist_code) as j073_sampai,
       l.real_lengkap, l.ton_lengkap, l.tagih_lengkap, l.ton_tagih
from sementrack.v_ongkos_trip t
join sementrack.v_ongkos_dist d on d.dist_code = t.dist_code
left join lateral (
  select sum(o.biaya) as real_lengkap, sum(o.ton_kirim) as ton_lengkap,
         sum(o.tagih) filter (where o.tagih is not null) as tagih_lengkap, sum(o.ton_kirim) filter (where o.tagih is not null) as ton_tagih
  from sementrack.v_ongkos_do o
  where o.dist_code = t.dist_code and o.periode = t.periode and o.trip_tanpa_biaya = 0
) l on true
where t.ton > 0 and t.periode >= date '2026-01-01'
group by t.dist_code, d.kode, d.nama, t.periode, l.real_lengkap, l.ton_lengkap, l.tagih_lengkap, l.ton_tagih;

grant select on sementrack.v_ongkos_trip, sementrack.v_ongkos_do, sementrack.v_ongkos_info to public;

commit;
