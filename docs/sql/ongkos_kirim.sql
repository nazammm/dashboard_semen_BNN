-- =====================================================================
-- Ongkos kirim ke toko (ORDB019) + J073 lengkap. Kembaran PostgreSQL dari docs/mssql/17_ongkos_kirim.sql
-- (untuk uji lokal; produksi memakai SQL Server).
-- =====================================================================
begin;

alter table sementrack.sellout_j073
  add column if not exists delivery_type text, add column if not exists zona_kirim text,
  add column if not exists harga_kirim numeric, add column if not exists diskon_kirim numeric, add column if not exists tambah_kirim numeric,
  add column if not exists handling numeric, add column if not exists qty_kirim numeric,
  add column if not exists kecamatan text, add column if not exists kabupaten text, add column if not exists cust_group text,
  add column if not exists harga_produk numeric,
  add column if not exists qty_sisa numeric,
  add column if not exists data_per date;
create index if not exists sellout_j073_dist_do_idx on sementrack.sellout_j073 (dist_code, do_no);

drop function if exists sementrack.sellout_j073_simpan(json, text, text);
create or replace function sementrack.sellout_j073_simpan(p_rows json, p_user text, p_file text default null)
returns table(rows_saved integer, rows_deleted integer, ton numeric, date_from date, date_to date, dist_codes text[])
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_old integer; v_new integer; v_ton numeric; v_from date; v_to date; v_dists text[];
begin
  if json_typeof(p_rows) <> 'array' or json_array_length(p_rows) = 0 then raise exception 'Tidak ada baris J073' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('sellout_j073'));
  create temp table _j073 on commit drop as
  select r.ord::int as baris, btrim(r.val ->> 0) as dist_code, (r.val ->> 1)::date as do_date, btrim(r.val ->> 2) as do_no,
         btrim(r.val ->> 3) as customer_code, nullif(btrim(r.val ->> 4), '') as customer_name,
         upper(btrim(r.val ->> 5)) as product_code, nullif(btrim(r.val ->> 6), '') as product_name,
         (r.val ->> 7)::numeric as order_qty, coalesce((r.val ->> 8)::numeric, 0) as net_amount,
         nullif(upper(btrim(r.val ->> 9)), '') as warehouse,
         nullif(btrim(r.val ->> 10), '') as delivery_type, nullif(upper(btrim(r.val ->> 11)), '') as zona_kirim,
         nullif(r.val ->> 12, '')::numeric as harga_kirim, nullif(r.val ->> 13, '')::numeric as diskon_kirim,
         nullif(r.val ->> 14, '')::numeric as tambah_kirim, nullif(r.val ->> 15, '')::numeric as handling,
         nullif(r.val ->> 16, '')::numeric as qty_kirim,
         nullif(upper(btrim(r.val ->> 17)), '') as kecamatan, nullif(upper(btrim(r.val ->> 18)), '') as kabupaten, nullif(upper(btrim(r.val ->> 19)), '') as cust_group,
         nullif(r.val ->> 20, '')::numeric as harga_produk, nullif(r.val ->> 21, '')::numeric as qty_sisa
  from json_array_elements(p_rows) with ordinality as r(val, ord);
  if exists (select 1 from _j073 where coalesce(dist_code, '') = '' or do_date is null or coalesce(do_no, '') = ''
                                     or coalesce(customer_code, '') = '' or coalesce(product_code, '') = '' or order_qty is null) then
    raise exception 'Baris J073 tidak lengkap (baris %)', (select min(baris) from _j073 where coalesce(dist_code, '') = '' or do_date is null
      or coalesce(do_no, '') = '' or coalesce(customer_code, '') = '' or coalesce(product_code, '') = '' or order_qty is null) using errcode = '22023';
  end if;
  insert into sementrack.sellout_j073_dist (dist_code, nama, j028_dist)
  select x.dist_code, coalesce((select d.dist_code from public.distributor d where d.kode_erp = x.dist_code limit 1), x.dist_code), null
  from (select distinct dist_code from _j073) x
  where not exists (select 1 from sementrack.sellout_j073_dist d where d.dist_code = x.dist_code);
  with r as (select x.dist_code, min(x.do_date) a, max(x.do_date) b from _j073 x group by 1),
       d as (delete from sementrack.sellout_j073 j using r where j.dist_code = r.dist_code and j.do_date between r.a and r.b returning 1)
  select count(*) into v_old from d;
  insert into sementrack.sellout_j073 (dist_code, do_date, do_no, customer_code, customer_name, product_code, product_name, order_qty, net_amount, warehouse,
                                       delivery_type, zona_kirim, harga_kirim, diskon_kirim, tambah_kirim, handling, qty_kirim, kecamatan, kabupaten, cust_group, harga_produk, qty_sisa, data_per)
  select x.dist_code, x.do_date, x.do_no, x.customer_code, x.customer_name, x.product_code, x.product_name, x.order_qty, x.net_amount, x.warehouse,
         x.delivery_type, x.zona_kirim, x.harga_kirim, x.diskon_kirim, x.tambah_kirim, x.handling, x.qty_kirim, x.kecamatan, x.kabupaten,
         nullif(x.cust_group, 'RETAIL'), x.harga_produk, x.qty_sisa, current_date from _j073 x;
  select count(*), coalesce(sum(sementrack.j073_ton(x.product_code, x.product_name, x.order_qty)), 0), min(x.do_date), max(x.do_date),
         array_agg(distinct x.dist_code order by x.dist_code)
    into v_new, v_ton, v_from, v_to, v_dists from _j073 x;
  insert into sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes, rows_read, rows_saved, rows_deleted, status, finished_at)
  values ('j073', 'upload', p_user, 'file', p_file, v_from, v_to, v_dists, v_new, v_new, v_old, 'selesai', now());
  return query select v_new, v_old, v_ton, v_from, v_to, v_dists;
end $$;

create table if not exists sementrack.ongkos_kirim (
  id bigserial primary key,
  dist_code text not null, periode date not null, kirim_date date, do_no text not null, foad text not null,
  segmen text, transporter text, truk text, asal text, tujuan text, zona text, harga_ritase numeric,
  kategori text, product_code text, product_name text, delivery text,
  qty numeric not null, harga_uom numeric, total numeric not null, ton numeric not null
);
create index if not exists ongkos_kirim_dist_periode_idx on sementrack.ongkos_kirim (dist_code, periode);

alter table sementrack.kelola_log drop constraint if exists kelola_log_dataset_check;
alter table sementrack.kelola_log add constraint kelola_log_dataset_check
  check (dataset in ('transaksi', 'sellin', 'dofas', 'erp', 'j073', 'target', 'outstanding', 'tabel', 'stock', 'ongkos', 'harga'));

create or replace function sementrack.ongkos_simpan(p_rows json, p_user text, p_file text default null)
returns table(rows_saved integer, rows_deleted integer, biaya numeric, ton numeric, periode_dari date, periode_sampai date, dist_codes text[])
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_old integer; v_new integer; v_read integer; v_biaya numeric; v_ton numeric; v_from date; v_to date; v_dists text[];
begin
  if json_typeof(p_rows) <> 'array' or json_array_length(p_rows) = 0 then raise exception 'Tidak ada baris ORDB019' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('ongkos_kirim'));
  create temp table _o on commit drop as
  select r.ord::int as baris, btrim(r.val ->> 0) as dist_code, (r.val ->> 1)::date as periode, nullif(r.val ->> 2, '')::date as kirim_date,
         btrim(r.val ->> 3) as do_no, btrim(r.val ->> 4) as foad, nullif(upper(btrim(r.val ->> 5)), '') as segmen,
         nullif(btrim(r.val ->> 6), '') as transporter, nullif(upper(btrim(r.val ->> 7)), '') as truk,
         nullif(upper(btrim(r.val ->> 8)), '') as asal, nullif(upper(btrim(r.val ->> 9)), '') as tujuan,
         nullif(upper(btrim(r.val ->> 10)), '') as zona, nullif(r.val ->> 11, '')::numeric as harga_ritase,
         nullif(upper(btrim(r.val ->> 12)), '') as kategori, nullif(upper(btrim(r.val ->> 13)), '') as product_code,
         nullif(btrim(r.val ->> 14), '') as product_name, nullif(upper(btrim(r.val ->> 15)), '') as delivery,
         nullif(r.val ->> 16, '')::numeric as qty, nullif(r.val ->> 17, '')::numeric as harga_uom,
         coalesce(nullif(r.val ->> 18, '')::numeric, 0) as total
  from json_array_elements(p_rows) with ordinality as r(val, ord);
  if exists (select 1 from _o where coalesce(dist_code, '') = '' or periode is null or extract(day from periode) <> 1
                                  or coalesce(do_no, '') = '' or coalesce(foad, '') = '' or qty is null) then
    raise exception 'Baris ORDB019 tidak lengkap (baris %)', (select min(baris) from _o where coalesce(dist_code, '') = '' or periode is null
      or extract(day from periode) <> 1 or coalesce(do_no, '') = '' or coalesce(foad, '') = '' or qty is null) using errcode = '22023';
  end if;
  if exists (select 1 from _o where periode > date_trunc('month', current_date)::date) then
    raise exception 'Periode ORDB019 setelah bulan ini' using errcode = '22023';
  end if;
  if exists (select 1 from _o where periode < date '2026-01-01') then
    raise exception 'Ongkos kirim dilacak mulai Januari 2026, ORDB019 sebelum itu tidak disimpan' using errcode = '22023';
  end if;
  with d as (delete from sementrack.ongkos_kirim k using (select distinct dist_code, periode from _o) r
             where k.dist_code = r.dist_code and k.periode = r.periode returning 1)
  select count(*) into v_old from d;
  insert into sementrack.ongkos_kirim (dist_code, periode, kirim_date, do_no, foad, segmen, transporter, truk, asal, tujuan, zona, harga_ritase,
                                       kategori, product_code, product_name, delivery, qty, harga_uom, total, ton)
  select dist_code, periode, kirim_date, do_no, foad, segmen, transporter, truk, asal, tujuan, zona, harga_ritase,
         kategori, product_code, product_name, delivery, qty, harga_uom, total,
         case when kategori in ('SEMEN', 'WHITE CEMENT') then coalesce(sementrack.j073_ton(product_code, product_name, qty), 0) else 0 end
  from _o where kategori in ('SEMEN', 'WHITE CEMENT') or total <> 0;
  get diagnostics v_new = row_count;
  select count(*), sum(total), min(periode), max(periode), array_agg(distinct dist_code order by dist_code) into v_read, v_biaya, v_from, v_to, v_dists from _o;
  select sum(k.ton) into v_ton from sementrack.ongkos_kirim k where exists (select 1 from _o r where r.dist_code = k.dist_code and r.periode = k.periode);
  insert into sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes, rows_read, rows_saved, rows_deleted, status, finished_at)
  values ('ongkos', 'upload', p_user, 'file', p_file, v_from, (v_to + interval '1 month - 1 day')::date, v_dists, v_read, v_new, v_old, 'selesai', now());
  return query select v_new, v_old, coalesce(v_biaya, 0), coalesce(v_ton, 0), v_from, v_to, v_dists;
end $$;

create or replace view sementrack.v_ongkos_dist as
select x.dist_code, coalesce(d.dist_code, x.dist_code) as kode, coalesce(d.dist_name, x.dist_code) as nama
from (select distinct dist_code from sementrack.ongkos_kirim) x
left join lateral (select d.dist_code, d.dist_name from public.distributor d where d.kode_erp = x.dist_code order by d.dist_code limit 1) d on true;

-- ongkos_insight.sql menambah kolom ke view-view ini; hapus dulu supaya file ini bisa dijalankan ulang
drop view if exists sementrack.v_ongkos_info;
drop view if exists sementrack.v_ongkos_do;
drop view if exists sementrack.v_ongkos_trip;
create view sementrack.v_ongkos_trip as
select k.dist_code, k.periode, k.foad, min(k.kirim_date) as kirim_date,
       max(k.transporter) as transporter, max(k.truk) as truk, max(k.asal) as asal, max(k.zona) as zona, max(k.tujuan) as tujuan,
       max(k.segmen) as segmen, max(k.harga_ritase) as harga_ritase, sum(k.total) as biaya, sum(k.ton) as ton,
       count(distinct k.do_no)::int as jumlah_do
from sementrack.ongkos_kirim k
group by k.dist_code, k.periode, k.foad;

drop view if exists sementrack.v_ongkos_do;
create view sementrack.v_ongkos_do as
select k.dist_code, k.periode, k.do_no, k.biaya, k.ton_kirim, k.trip, k.trip_tanpa_biaya, k.truk, k.transporter, k.zona, k.segmen, k.tujuan,
       j.do_date, j.customer_code, j.customer_name, j.delivery_type,
       split_part(j.delivery_type, ' ', 1) as tipe_kirim,
       j.zona_kirim, j.kecamatan, j.kabupaten, j.ton_do,
       case when j.ton_do > 0 then j.net * k.ton_kirim / j.ton_do end as omzet,
       case when j.ton_do > 0 and j.delivery_type is not null then j.tagih * k.ton_kirim / j.ton_do end as tagih,
       case when j.ton_do > 0 and j.delivery_type is not null then j.handling * k.ton_kirim / j.ton_do end as handling
from (
  select o.dist_code, o.periode, o.do_no, sum(o.total) as biaya, sum(o.ton) as ton_kirim, count(distinct o.foad)::int as trip,
         count(distinct case when f.biaya = 0 then o.foad end)::int as trip_tanpa_biaya,
         max(o.truk) as truk, max(o.transporter) as transporter, max(o.zona) as zona, max(o.segmen) as segmen, max(o.tujuan) as tujuan
  from sementrack.ongkos_kirim o
  join (select dist_code, periode, foad, sum(total) as biaya from sementrack.ongkos_kirim group by 1, 2, 3) f
    on f.dist_code = o.dist_code and f.periode = o.periode and f.foad = o.foad
  where o.ton > 0
  group by o.dist_code, o.periode, o.do_no
) k
left join lateral (
  select min(s.do_date) as do_date, max(s.customer_code) as customer_code, max(s.customer_name) as customer_name,
         max(s.delivery_type) as delivery_type, max(s.zona_kirim) as zona_kirim, max(s.kecamatan) as kecamatan, max(s.kabupaten) as kabupaten,
         sum(sementrack.j073_ton(s.product_code, s.product_name, s.order_qty)) as ton_do, sum(s.net_amount) as net,
         sum((coalesce(s.harga_kirim, 0) - coalesce(s.diskon_kirim, 0) + coalesce(s.tambah_kirim, 0)) * s.order_qty) as tagih,
         sum(coalesce(s.handling, 0) * s.order_qty) as handling
  from sementrack.sellout_j073 s
  where s.dist_code = k.dist_code and s.do_no = k.do_no
) j on true;

create or replace view sementrack.v_ongkos_info as
select t.dist_code, d.kode, d.nama, t.periode, count(*)::int as trip, sum(t.ton) as ton,
       sum(case when t.biaya > 0 then t.ton else 0 end) as ton_berbiaya, sum(t.biaya) as biaya,
       (select max(do_date) from sementrack.sellout_j073 j where j.dist_code = t.dist_code) as j073_sampai
from sementrack.v_ongkos_trip t join sementrack.v_ongkos_dist d on d.dist_code = t.dist_code
where t.ton > 0 and t.periode >= date '2026-01-01'          -- ongkos kirim dilacak mulai 2026
group by t.dist_code, d.kode, d.nama, t.periode;

create or replace view sementrack.v_sellout_j073_baris as
with thn as (select extract(year from current_date)::int as y),
ada as (select distinct j.dist_code, date_trunc('month', j.do_date)::date as bln from sementrack.sellout_j073 j
        where exists (select 1 from sementrack.sellout_j073_dist d where d.dist_code = j.dist_code and d.j028_dist is not null)),
src as (
  select 'J073'::text as asal, j.dist_code, j.do_date, j.do_no, j.customer_code, j.product_code, j.product_name, j.order_qty, j.net_amount,
         upper(btrim(j.warehouse)) as gudang
  from sementrack.sellout_j073 j
  where j.cust_group is null
    and exists (select 1 from sementrack.sellout_j073_aturan a where a.dist_code = j.dist_code)
  union all
  select 'J028', d.dist_code, t.do_date, t.do_no, t.customer_code, t.product_code, null, t.order_qty, coalesce(t.net_amount, 0), null
  from sementrack.sellout_j073_dist d
  join public.transaksi t on t.dist_code = d.j028_dist
  cross join thn
  where t.do_date >= make_date(thn.y - 1, 1, 1) and t.do_date < make_date(thn.y, 1, 1)
    and t.customer_code is not null and btrim(t.customer_code) <> ''
    and not exists (select 1 from ada where ada.dist_code = d.dist_code and ada.bln = date_trunc('month', t.do_date)::date)
),
dj as (   -- nomor DO di J028 untuk aturan do_j028 (mis. INSA-E)
  select t.do_no, array_agg(distinct t.dist_code) as dists
  from public.transaksi t cross join thn
  where t.dist_code in (select a.do_j028 from sementrack.sellout_j073_aturan a where a.do_j028 is not null)
    and t.do_date >= make_date(thn.y - 1, 1, 1)
  group by t.do_no
)
select s.asal, s.dist_code, s.do_date, extract(year from s.do_date)::int as tahun, extract(month from s.do_date)::int as bulan,
       s.do_no, s.customer_code, s.gudang,
       case when upper(s.product_code) like 'RJW%' then 'RJW' when upper(s.product_code) like 'CWC%' then 'CWC' else 'STR' end as tipe,
       sementrack.j073_ton(s.product_code, s.product_name, s.order_qty) as ton, s.net_amount as net,
       (select a.peta_id from sementrack.sellout_j073_aturan a
         where a.dist_code = s.dist_code
           and (a.gudang is null or upper(a.gudang) = s.gudang)
           and (a.customer_code is null or a.customer_code = s.customer_code)
           and (a.do_j028 is null or a.do_j028 = any (dj.dists))
         order by a.urutan limit 1) as peta_id
from src s
left join dj on dj.do_no = s.do_no;

create or replace view sementrack.v_data_status as
with
yr_so as (select max(substring(k from 4)::int) y from jsonb_object_keys((select to_jsonb(v) from public.v_cement_targets_ext v limit 1)) k where k ~ '^do_\d{4}$'),
yr_si as (select max(substring(k from 11)::int) y from jsonb_object_keys((select to_jsonb(v) from public.v_delivery_ext v limit 1)) k where k ~ '^realisasi_\d{4}$'),
so as (select (select y from yr_so) y, max(v.month_num) m from public.v_cement_targets_ext v, yr_so
       where coalesce((to_jsonb(v) ->> ('do_' || yr_so.y))::numeric, 0) > 0),
si as (select (select y from yr_si) y, max(v.month_num) m from public.v_delivery_ext v, yr_si
       where coalesce((to_jsonb(v) ->> ('realisasi_' || yr_si.y))::numeric, 0) > 0),
sync as (select (s.tanggal_update + coalesce(s.jam_update, time '00:00')) as ts, s.keterangan from public.status_sync s where s.id = 1),
sellin_up as (select u.created_at, u.created_by from sementrack.sellin_bnn_upload u where u.status = 'selesai' order by u.id desc limit 1),
dofas_up as (select l.created_at, l.created_by, l.date_from from sementrack.kelola_log l where l.dataset = 'dofas' and l.status = 'selesai' order by l.id desc limit 1),
erp_up as (select l.created_at, l.created_by, l.date_from from sementrack.kelola_log l where l.dataset = 'erp' and l.status = 'selesai' order by l.id desc limit 1),
j073_up as (select l.created_at, l.created_by from sementrack.kelola_log l where l.dataset = 'j073' and l.status = 'selesai' order by l.id desc limit 1),
po_up as (select u.created_at, u.created_by, u.posisi from sementrack.sellin_po_upload u where u.status = 'selesai' order by u.id desc limit 1),
stock_up as (select l.created_at, l.created_by from sementrack.kelola_log l where l.dataset = 'stock' and l.status = 'selesai' order by l.id desc limit 1),
ongkos_up as (select l.created_at, l.created_by from sementrack.kelola_log l where l.dataset = 'ongkos' and l.status = 'selesai' order by l.id desc limit 1)
select 'transaksi'::text as sumber, 'Transaksi distributor'::text as nama, 'harian'::text as frekuensi,
       (select max(do_date) from public.transaksi) as data_sampai,
       (select to_char(ts, 'YYYY-MM-DD"T"HH24:MI') from sync) as diperbarui,
       (select keterangan from sync) as keterangan
union all
select 'sellin', 'Sell In BNN', 'harian',
       (select max(tanggal) from sementrack.sellin_bnn where not sementrack.sellin_is_mortar(tipe_produk)),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from sellin_up),
       (select 'Upload oleh ' || created_by from sellin_up)
union all
select 'sellout_bulanan', 'Sell Out bulanan', 'bulanan',
       (select case when m is null then null else (make_date(y, m::int, 1) + interval '1 month - 1 day')::date end from so), null, null
union all
select 'sellin_bulanan', 'Sell In bulanan', 'bulanan',
       (select case when m is null then null else (make_date(y, m::int, 1) + interval '1 month - 1 day')::date end from si), null, null
union all
select 'dofas', 'DO FAS', 'harian',
       (select (created_at at time zone 'Asia/Jakarta')::date from dofas_up),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from dofas_up),
       (select 'Tempel data ' || extract(year from date_from) || ' oleh ' || created_by from dofas_up)
union all
select 'erp', 'Sub ERP', 'harian',
       (select (created_at at time zone 'Asia/Jakarta')::date from erp_up),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from erp_up),
       (select 'Tempel data ' || extract(year from date_from) || ' oleh ' || created_by from erp_up)
union all
select 'j073', 'J073', 'harian',
       (select max(do_date) from sementrack.sellout_j073),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from j073_up),
       (select 'Upload oleh ' || created_by from j073_up)
union all
select 'outstanding', 'Outstanding DO', 'harian',
       (select posisi from po_up),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from po_up),
       (select 'Upload oleh ' || created_by from po_up)
union all
select 'stock', 'Stock semen', 'harian',
       (select max(tanggal) from sementrack.stock_semen),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from stock_up),
       (select 'Upload oleh ' || created_by from stock_up)
union all
select 'ongkos', 'Ongkos kirim (ORDB019)', 'mingguan',
       (select max(kirim_date) from sementrack.ongkos_kirim),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from ongkos_up),
       (select 'Upload oleh ' || created_by from ongkos_up);

do $$
begin
  if to_regclass('auth_local.role_pages') is not null then
    insert into auth_local.role_pages (role, page_id, can_view_detail, can_download)
    select r.role, 'ongkos-kirim', r.can_view_detail, r.can_download
    from auth_local.role_pages r
    where r.page_id = 'sell-out-bnn'
      and not exists (select 1 from auth_local.role_pages t where t.role = r.role and t.page_id = 'ongkos-kirim');
  end if;
end $$;

grant select on sementrack.v_ongkos_dist, sementrack.v_ongkos_trip, sementrack.v_ongkos_do, sementrack.v_ongkos_info,
  sementrack.v_sellout_j073_baris, sementrack.v_data_status to public;


-- Ongkos kirim dilacak mulai 2026: data sebelum itu dihapus (J073 RETAIL distributor Sell Out tetap)
delete from sementrack.ongkos_kirim where periode < date '2026-01-01';
delete from sementrack.sellout_j073 j
where j.do_date < date '2026-01-01'
  and (j.cust_group is not null or not exists (select 1 from sementrack.sellout_j073_aturan a where a.dist_code = j.dist_code));

commit;
