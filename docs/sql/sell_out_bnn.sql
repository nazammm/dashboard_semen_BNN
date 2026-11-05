-- =====================================================================
-- Sell Out BNN: gabungan 3 sumber per baris distributor/subdist.
--   J028   : transaksi distributor (public.transaksi), harian
--   DO FAS : rekap DO Korin per bulan (ditempel dari Excel), ton
--   Sub ERP: sell out subdist dari ERP per bulan (ditempel), ton
--   J073   : INSA & PKB (tabel warehouse) belum tersedia -> 0
--
-- Jalankan SETELAH kelola_data.sql, sebagai pemilik tabel (nazamudin).
-- Aman dijalankan ulang. Tidak mengubah data transaksi / sell in.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Peta Sell Out BNN: baris apa saja yang dihitung dan dari mana.
--    Baris DO FAS / Sub ERP yang tidak disebut di sini TIDAK dihitung.
--    j028_mode: penuh  = semua transaksi distributor itu
--               tanpa  = semua transaksi KECUALI ke j028_customers (customer = subdist)
--               hanya  = HANYA transaksi ke j028_customers (sell out subdist yang menumpang di J028)
--    target_region + target_key = baris di v_cement_targets_ext untuk target & tahun lalu.
-- ---------------------------------------------------------------------
create table if not exists sementrack.sellout_bnn_peta (
  id              integer primary key,
  urutan          integer not null,
  region          text not null,
  nama            text not null,
  j028_dist       text,
  j028_mode       text check (j028_mode in ('penuh', 'tanpa', 'hanya')),
  j028_customers  text[],
  dofas_kode      text[],
  dofas_tipe      text check (dofas_tipe in ('STR', 'RJW', 'CWC')),
  erp_kode        text,
  j073            boolean not null default false,
  target_region   text,
  target_key      text,
  unique (region, nama),
  check ((j028_dist is null) = (j028_mode is null)),
  check (j028_mode is distinct from 'penuh' or j028_customers is null),
  check (j028_mode not in ('tanpa', 'hanya') or cardinality(j028_customers) > 0)
);

insert into sementrack.sellout_bnn_peta
  (id, urutan, region, nama, j028_dist, j028_mode, j028_customers, dofas_kode, dofas_tipe, erp_kode, j073, target_region, target_key)
values
  ( 1,  10, 'Babel',       'Belitung',     null,  null,    null,                          '{CB,KB}',  null,  null,   false, 'Babel',       'Belitung'),
  ( 2,  20, 'Babel',       'GMD',          'GMD', 'penuh', null,                          null,       null,  null,   false, 'Babel',       'GMD'),
  ( 3,  30, 'Babel',       'JAN',          null,  null,    null,                          '{JAN}',    null,  null,   false, 'Babel',       'JAP'),
  ( 4,  40, 'Babel',       'WJM',          null,  null,    null,                          null,       null,  'S006', false, 'Babel',       'WJM'),
  ( 5,  50, 'Bengkulu',    'BKP',          'BKP', 'penuh', null,                          null,       null,  null,   false, 'Bengkulu',    'BKP'),
  ( 6,  60, 'Jambi',       'PGS',          'JMB', 'hanya', '{18001}',                     '{PGS}',    null,  null,   false, 'Jambi',       'PGS'),
  ( 7,  70, 'Jambi',       'MGSS',         'JMB', 'hanya', '{18469}',                     '{MGS,MGSS}', null, null,  false, 'Jambi',       'MGSS'),
  ( 8,  80, 'Jambi',       'MAJU',         'JMB', 'hanya', '{19213}',                     '{MAJU}',   null,  null,   false, 'Jambi',       'MAJU'),
  ( 9,  90, 'Jambi',       'JMB',          'JMB', 'tanpa', '{18001,18469,19213}',         null,       null,  null,   false, 'Jambi',       'JMB'),
  (10, 100, 'Lampung',     'BMM',          'BMM', 'penuh', null,                          null,       null,  null,   false, 'Lampung',     'BMM'),
  (11, 110, 'North Sum',   'INSA',         null,  null,    null,                          null,       null,  null,   true,  'North Sum',   'INSA'),
  (12, 120, 'North Sum',   'INSA-E',       null,  null,    null,                          null,       null,  null,   true,  null,          null),
  (13, 130, 'North Sum',   'INSA - ACEH',  null,  null,    null,                          null,       null,  null,   true,  'North Sum',   'INSA - ACEH'),
  (14, 140, 'Riau',        'PKB',          null,  null,    null,                          null,       null,  null,   true,  'Riau',        'PKB'),
  (15, 150, 'Riau',        'Dumai-PKB',    null,  null,    null,                          null,       null,  null,   true,  'Riau',        'Dumai-PKB'),
  (16, 160, 'Riau',        'Dumai-Patent', null,  null,    null,                          null,       null,  null,   true,  'Riau',        'Dumai-Patent'),
  (17, 170, 'Riau',        'NC',           'NC',  'penuh', null,                          null,       null,  null,   false, 'Riau',        'PKB - NC'),
  (18, 180, 'Riau',        'Rosalia',      null,  null,    null,                          '{ROSALIA}', 'STR', null,  false, 'Riau',        'Rosalia'),
  (19, 190, 'Riau Island', 'Kepri',        null,  null,    null,                          '{BS,HUR,MA,RENULI,SS,SSK,TMA,UBS,SLA}', null, null, false, 'Riau Island', 'Kepri'),
  (20, 200, 'Riau Island', 'NSA',          'NSA', 'penuh', null,                          null,       null,  null,   false, 'Riau Island', 'NSA'),
  (21, 210, 'Riau Island', 'Rosalia',      null,  null,    null,                          '{ROSALIA}', 'RJW', null,  false, 'Riau Island', 'Rosalia'),
  (22, 220, 'Riau Island', 'NCB',          'NCB', 'penuh', null,                          null,       null,  null,   false, 'Riau Island', 'Tj. Balai'),
  (23, 230, 'South Sum',   'PM',           'PM',  'penuh', null,                          null,       null,  null,   false, 'South Sum',   'PM'),
  (24, 240, 'South Sum',   'SIN',          null,  null,    null,                          null,       null,  'S014', false, 'South Sum',   'SIN'),
  (25, 250, 'West Kal',    'BSJ',          null,  null,    null,                          null,       null,  'S010', false, 'West Kal',    'BSJ'),
  (26, 260, 'West Kal',    'KTP',          'KTP', 'penuh', null,                          null,       null,  null,   false, 'West Kal',    'KTP'),
  (27, 270, 'West Kal',    'Pangkalant',   null,  null,    null,                          null,       null,  'S011', false, 'West Kal',    'Pangkalan'),
  (28, 280, 'West Kal',    'PTK',          'PTK', 'penuh', null,                          null,       null,  null,   false, 'West Kal',    'PTK'),
  (29, 290, 'West Sum',    'CBS',          'CBS', 'penuh', null,                          null,       null,  null,   false, 'West Sum',    'CBS')
on conflict (id) do nothing;

-- Customer yang sebenarnya subdist (bukan toko). Dipakai tahap berikutnya untuk membuang
-- mereka dari top customer, toko aktif, dan capaian sales. Sell out distributor induk TIDAK
-- dikurangi kecuali peta di atas berkata 'tanpa' (saat ini hanya JMB).
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
-- 2. Data tempelan DO FAS dan Sub ERP (disimpan apa adanya, per tahun)
-- ---------------------------------------------------------------------
create table if not exists sementrack.sellout_dofas (
  tahun        integer not null check (tahun between 2020 and 2100),
  baris        integer not null,
  tipe         text not null check (tipe in ('STR', 'RJW', 'CWC')),
  area         text,
  distributor  text not null,
  keterangan   text,
  bulan        integer not null check (bulan between 1 and 12),
  ton          numeric not null,
  primary key (tahun, baris, bulan)
);
create table if not exists sementrack.sellout_erp (
  tahun   integer not null check (tahun between 2020 and 2100),
  kode    text not null,
  nama    text,
  tipe    text check (tipe in ('STR', 'RJW', 'CWC')),   -- null = total tanpa pemisahan tipe
  bulan   integer not null check (bulan between 1 and 12),
  ton     numeric not null
);
create index if not exists sellout_erp_tahun_idx on sementrack.sellout_erp (tahun, kode);

-- log kelola data ikut mencatat tempelan DO FAS / Sub ERP
alter table sementrack.kelola_log drop constraint if exists kelola_log_dataset_check;
alter table sementrack.kelola_log add constraint kelola_log_dataset_check check (dataset in ('transaksi', 'sellin', 'dofas', 'erp'));

-- Ganti seluruh DO FAS satu tahun. p_rows = [[tipe, area, distributor, keterangan, jan..des], ...]
create or replace function sementrack.sellout_dofas_simpan(p_tahun integer, p_rows json, p_user text)
returns table(rows_saved integer, rows_deleted integer, ton numeric)
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_old integer; v_new integer; v_ton numeric; v_baris integer;
begin
  if p_tahun is null or p_tahun not between 2020 and 2100 then raise exception 'Tahun tidak valid' using errcode = '22023'; end if;
  if json_typeof(p_rows) <> 'array' or json_array_length(p_rows) = 0 then raise exception 'Tidak ada baris DO FAS' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('sellout_dofas'), p_tahun);

  create temp table _dofas on commit drop as
  select (r.ord)::int as baris,
         upper(btrim(r.val ->> 0)) as tipe, nullif(btrim(r.val ->> 1), '') as area,
         btrim(r.val ->> 2) as distributor, nullif(btrim(r.val ->> 3), '') as keterangan,
         b.bulan, (r.val ->> (3 + b.bulan))::numeric as ton
  from json_array_elements(p_rows) with ordinality as r(val, ord)
  cross join generate_series(1, 12) as b(bulan);

  if exists (select 1 from _dofas where tipe not in ('STR', 'RJW', 'CWC')) then
    raise exception 'Tipe harus STR, RJW, atau CWC (baris %)', (select min(baris) from _dofas where tipe not in ('STR', 'RJW', 'CWC')) using errcode = '22023';
  end if;
  if exists (select 1 from _dofas where coalesce(distributor, '') = '') then
    raise exception 'Kolom Distributor kosong (baris %)', (select min(baris) from _dofas where coalesce(distributor, '') = '') using errcode = '22023';
  end if;

  delete from sementrack.sellout_dofas d where d.tahun = p_tahun;
  get diagnostics v_old = row_count;
  insert into sementrack.sellout_dofas (tahun, baris, tipe, area, distributor, keterangan, bulan, ton)
  select p_tahun, x.baris, x.tipe, x.area, x.distributor, x.keterangan, x.bulan, coalesce(x.ton, 0) from _dofas x;
  select count(distinct x.baris), coalesce(sum(x.ton), 0) into v_new, v_ton from _dofas x;
  select count(distinct d.baris) into v_baris from sementrack.sellout_dofas d where d.tahun = p_tahun;

  insert into sementrack.kelola_log (dataset, aksi, created_by, source, date_from, date_to, rows_read, rows_saved, rows_deleted, status, finished_at)
  values ('dofas', 'upload', p_user, 'tempel', make_date(p_tahun, 1, 1), make_date(p_tahun, 12, 31), v_new, v_baris, v_old / 12, 'selesai', now());
  return query select v_baris, v_old / 12, v_ton;
end $$;

-- Ganti seluruh Sub ERP satu tahun. p_rows = [[kode, nama, tipe|null, jan..des], ...]
create or replace function sementrack.sellout_erp_simpan(p_tahun integer, p_rows json, p_user text)
returns table(rows_saved integer, rows_deleted integer, ton numeric)
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_old integer; v_new integer; v_ton numeric;
begin
  if p_tahun is null or p_tahun not between 2020 and 2100 then raise exception 'Tahun tidak valid' using errcode = '22023'; end if;
  if json_typeof(p_rows) <> 'array' or json_array_length(p_rows) = 0 then raise exception 'Tidak ada baris Sub ERP' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('sellout_erp'), p_tahun);

  create temp table _erp on commit drop as
  select upper(btrim(r.val ->> 0)) as kode, nullif(btrim(r.val ->> 1), '') as nama,
         nullif(upper(btrim(r.val ->> 2)), '') as tipe, b.bulan, (r.val ->> (2 + b.bulan))::numeric as ton
  from json_array_elements(p_rows) as r(val)
  cross join generate_series(1, 12) as b(bulan);

  if exists (select 1 from _erp where coalesce(kode, '') = '') then raise exception 'Kode distributor kosong' using errcode = '22023'; end if;
  if exists (select 1 from _erp where tipe is not null and tipe not in ('STR', 'RJW', 'CWC')) then
    raise exception 'Tipe harus STR, RJW, atau CWC' using errcode = '22023';
  end if;
  if exists (select 1 from _erp group by kode, tipe, bulan having count(*) > 1) then
    raise exception 'Kode % muncul lebih dari sekali', (select kode from _erp group by kode, tipe, bulan having count(*) > 1 limit 1) using errcode = '22023';
  end if;

  delete from sementrack.sellout_erp e where e.tahun = p_tahun;
  get diagnostics v_old = row_count;
  insert into sementrack.sellout_erp (tahun, kode, nama, tipe, bulan, ton)
  select p_tahun, x.kode, x.nama, x.tipe, x.bulan, coalesce(x.ton, 0) from _erp x;
  select count(distinct (x.kode, x.tipe)), coalesce(sum(x.ton), 0) into v_new, v_ton from _erp x;

  insert into sementrack.kelola_log (dataset, aksi, created_by, source, date_from, date_to, rows_read, rows_saved, rows_deleted, status, finished_at)
  values ('erp', 'upload', p_user, 'tempel', make_date(p_tahun, 1, 1), make_date(p_tahun, 12, 31), v_new, v_new, v_old / 12, 'selesai', now());
  return query select v_new, v_old / 12, v_ton;
end $$;

-- ---------------------------------------------------------------------
-- 3. Hasil: sell out per baris peta x bulan x tipe x sumber (ton)
-- ---------------------------------------------------------------------
create or replace view sementrack.v_sellout_bnn_peta as
select p.id, p.urutan, p.region, p.nama, p.target_region, p.target_key, p.dofas_kode, p.dofas_tipe, p.erp_kode, p.j073,
       concat_ws(' + ',
         case p.j028_mode when 'penuh' then 'J028 ' || p.j028_dist
                          when 'tanpa' then 'J028 ' || p.j028_dist || ' tanpa ' || array_to_string(p.j028_customers, ', ')
                          when 'hanya' then 'J028 ' || p.j028_dist || ' cust ' || array_to_string(p.j028_customers, ', ') end,
         case when p.dofas_kode is not null then 'DO FAS ' || array_to_string(p.dofas_kode, ', ') || coalesce(' (' || p.dofas_tipe || ')', '') end,
         case when p.erp_kode is not null then 'Sub ERP ' || p.erp_kode end,
         case when p.j073 then 'J073 (belum tersedia)' end) as sumber,
       -- distributor = punya transaksi sendiri (J028 penuh / tanpa subdist, atau J073);
       -- subdist = dari DO FAS, Sub ERP, atau customer subdist yang menumpang di J028
       case when p.j073 or p.j028_mode in ('penuh', 'tanpa') then 'dist' else 'subdist' end as jenis
from sementrack.sellout_bnn_peta p;

create or replace view sementrack.v_sellout_bnn_monthly as
with subc as (
  select coalesce(array_agg(distinct c), '{}') as arr from sementrack.sellout_bnn_peta p, unnest(p.j028_customers) c
),
trx as (
  select extract(year from t.do_date)::int as tahun, extract(month from t.do_date)::int as bulan, t.dist_code,
         case when t.customer_code = any (subc.arr) then t.customer_code end as cc,
         case when upper(t.product_code) like 'RJW%' then 'RJW' when upper(t.product_code) like 'CWC%' then 'CWC' else 'STR' end as tipe,
         sum(public.calc_tonase(t.product_code, t.order_qty)) as ton
  from public.transaksi t cross join subc
  where t.do_date >= make_date(extract(year from current_date)::int - 1, 1, 1)
    and t.dist_code in (select j028_dist from sementrack.sellout_bnn_peta where j028_dist is not null)
  group by 1, 2, 3, 4, 5
)
select p.id as peta_id, x.tahun, x.bulan, x.tipe, sum(x.ton) as ton, 'J028'::text as sumber
from sementrack.sellout_bnn_peta p
join trx x on x.dist_code = p.j028_dist
 and (p.j028_mode = 'penuh'
      or (p.j028_mode = 'tanpa' and (x.cc is null or not (x.cc = any (p.j028_customers))))
      or (p.j028_mode = 'hanya' and x.cc = any (p.j028_customers)))
group by 1, 2, 3, 4
union all
select p.id, d.tahun, d.bulan, d.tipe, sum(d.ton), 'DO FAS'
from sementrack.sellout_bnn_peta p
join sementrack.sellout_dofas d on upper(btrim(d.distributor)) = any (p.dofas_kode) and (p.dofas_tipe is null or d.tipe = p.dofas_tipe)
group by 1, 2, 3, 4
union all
select p.id, e.tahun, e.bulan, e.tipe, sum(e.ton), 'Sub ERP'
from sementrack.sellout_bnn_peta p
join sementrack.sellout_erp e on e.kode = p.erp_kode
group by 1, 2, 3, 4;

-- ---------------------------------------------------------------------
-- 4. Status data: tambah DO FAS & Sub ERP (salinan v_data_status dari kelola_data.sql + 2 baris)
-- ---------------------------------------------------------------------
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
erp_up as (select l.created_at, l.created_by, l.date_from from sementrack.kelola_log l where l.dataset = 'erp' and l.status = 'selesai' order by l.id desc limit 1)
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
-- DO FAS & Sub ERP berupa rekap s.d. hari ditempel: "data s.d." = tanggal tempel (WIB)
select 'dofas', 'DO FAS', 'harian',
       (select (created_at at time zone 'Asia/Jakarta')::date from dofas_up),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from dofas_up),
       (select 'Tempel data ' || extract(year from date_from) || ' oleh ' || created_by from dofas_up)
union all
select 'erp', 'Sub ERP', 'harian',
       (select (created_at at time zone 'Asia/Jakarta')::date from erp_up),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from erp_up),
       (select 'Tempel data ' || extract(year from date_from) || ' oleh ' || created_by from erp_up);

grant select on sementrack.v_data_status, sementrack.v_sellout_bnn_peta, sementrack.v_sellout_bnn_monthly to public;

-- ---------------------------------------------------------------------
-- 5. Isi awal 2026: DO FAS (tempelan 5 Nov 2026) & Sub ERP per tipe (Jan–Okt), supaya baris subdist
--    (Belitung, JAN, WJM, Jambi, Kepri, Rosalia, SIN, BSJ, Pangkalant) langsung terisi.
--    HANYA jika 2026 masih kosong; tempelan harian di Kelola Data menggantikannya.
-- ---------------------------------------------------------------------
do $do$
begin
  if not exists (select 1 from sementrack.sellout_dofas where tahun = 2026) then
    perform sementrack.sellout_dofas_simpan(2026, $j$[
  ["STR", null, "GMD", "Kapal", 32, 0, 0, 7572, 2130, 0, 900, 2280, 3024, 2468, 0, 0],
  ["STR", null, "JAN", "Kapal", 400, 0, 80, 840, 0, 336, 648, 1080, 96, 408, 0, 0],
  ["STR", null, "WJM", "Kapal", 2352, 1552, 2016, 4896, 1220, 1160, 2056, 2452, 3504, 2460, 0, 0],
  ["STR", null, "NSA", "Kapal", 3848, 832, 3152, 2600, 600, 2200, 288, 3496, 312, 4568, 0, 0],
  ["STR", null, "CB", "Kapal", 456, 0, 0, 360, 352, 456, 648, 288, 552, 432, 0, 0],
  ["STR", null, "KB", "Kapal", 880, 0, 896, 1328, 600, 1192, 1496, 936, 912, 1032, 312, 0],
  ["STR", null, "BKP", "Kapal", 2696, 0, 5936, 4232, 0, 0, 504, 0, 4800, 4304, 0, 0],
  ["STR", null, "BKP", "Darat", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["STR", null, "GUDANG JAMBI - TERMINAL LAMPUNG", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["STR", null, "GUDANG JAMBI - TERMINAL PALEMBANG", "Terminal", 0, 40, 140, 320, 200, 300, 20, 20, 0, 0, 0, 0],
  ["STR", null, "JAMBI - LOCO TERMINAL", "Terminal", 1301, 900, 690, 400, 360, 742, 522, 522, 80, 0, 0, 0],
  ["STR", null, "JMB", "Kapal", 0, 0, 2540, 4548, 156, 0, 390, 156, 780, 5148, 0, 0],
  ["STR", null, "JMB", "Darat", 0, 600, 655, 90, 0, 1898, 800, 2800, 60, 600, 10, 0],
  ["STR", null, "MGS", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["STR", null, "PGS", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["STR", null, "MAJU", "Kapal", 156, 0, 468, 780, 0, 546, 728, 0, 364, 780, 0, 0],
  ["STR", null, "KTP", "Kapal", 1104, 0, 0, 1400, 0, 2000, 0, 0, 0, 0, 0, 0],
  ["STR", null, "CILEGON", "Darat", 5000, 5000, 0, 2000, 0, 2016, 4840, 17008, 0, 10000, 0, 0],
  ["STR", null, "BMM", "Darat", 0, 3650, 0, 0, 0, 0, 3200, 5000, 0, 3000, 0, 0],
  ["STR", null, "GUDANG BYPASS - LAMPUNG (35244)", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["STR", null, "Gudang Way Lunik", "Terminal", 2920, 19920, 7600, 6685, 75, 3100, 13160, 59880, 5625, 0, 0, 0],
  ["STR", null, "Terminal Lampung - BMM ( Loco )", "Terminal", 11444, 5075, 3398, 5730, 2326, 6890, 11838, 14910, 3157, 2650, 0, 0],
  ["STR", null, "INSA", "Kapal", 16050, 2090, 2940, 3898, 4078, 6712, 3000, 6636, 4410, 4895, 200, 0],
  ["STR", null, "MB", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["STR", null, "CBS", "Kapal", 9464, 3120, 4784, 3900, 4420, 7280, 8060, 7540, 3640, 5460, 0, 0],
  ["STR", null, "GUDANG BATURAJA - TERMINAL LAMPUNG", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["STR", null, "GUDANG GANDUS - PM", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["STR", null, "GUDANG PERINTIS KEMERDEKAAN - PM", "Terminal", 1000, 3500, 1000, 1000, 0, 0, 1000, 6000, 0, 0, 0, 0],
  ["STR", null, "GUDANG SUKAJAYA - PM", "Terminal", 7500, 6000, 4800, 2000, 2000, 6000, 5000, 50000, 0, 0, 0, 0],
  ["STR", null, "GUDANG SUKAJAYA - TERMINAL LAMPUNG", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["STR", null, "GUDANG LAHAT", "Terminal", 640, 740, 200, 400, 190, 490, 480, 4280, 0, 0, 0, 0],
  ["STR", null, "PM", "Kapal", 0, 0, 1120, 3080, 0, 0, 840, 11648, 448, 3360, 0, 0],
  ["STR", null, "PM", "Darat", 120, 250, 0, 200, 0, 0, 0, 0, 0, 0, 0, 0],
  ["STR", null, "SIN", "Kapal", 24920, 624, 3360, 8400, 8400, 11200, 11200, 22400, 0, 0, 0, 0],
  ["STR", null, "PKB", "Kapal", 5956, 2108, 5060, 3520, 0, 0, 1692, 3484, 5044, 4160, 0, 0],
  ["STR", null, "PATEN", "Kapal", 2632, 2800, 1288, 3304, 672, 3304, 2968, 3296, 1344, 1008, 0, 0],
  ["STR", null, "BSJ", "Kapal", 0, 552, 400, 1504, 0, 304, 1000, 0, 0, 0, 0, 0],
  ["STR", null, "GUDANG WAJOK", "Terminal", 0, 1000, 3000, 5000, 1000, 3500, 10000, 0, 0, 0, 0, 0],
  ["STR", null, "PKL", "Kapal", 440, 0, 472, 848, 0, 32, 1000, 0, 0, 0, 0, 0],
  ["STR", null, "PTK", "Kapal", 6152, 80, 2960, 2928, 84, 5664, 2575, 943, 400, 16593, 0, 0],
  ["STR", null, "NBB", "Kapal", 0, 0, 0, 0, 0, 320, 408, 0, 240, 0, 0, 0],
  ["STR", null, "BS", "Kapal", 792, 0, 0, 264, 168, 96, 96, 120, 96, 288, 0, 0],
  ["STR", null, "HUR", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["STR", null, "MA", "Kapal", 528, 0, 0, 312, 96, 24, 216, 96, 144, 192, 0, 0],
  ["STR", null, "NC", "Kapal", 3528, 0, 0, 2400, 0, 0, 200, 600, 680, 4512, 0, 0],
  ["STR", null, "NCTB", "Kapal", 144, 0, 0, 96, 0, 0, 0, 0, 0, 0, 0, 0],
  ["STR", null, "RENULI", "Kapal", 392, 0, 0, 384, 0, 16, 240, 216, 360, 168, 0, 0],
  ["STR", null, "ROSALIA", "Kapal", 288, 0, 0, 0, 72, 0, 240, 144, 312, 0, 168, 0],
  ["STR", null, "SS", "Kapal", 216, 272, 280, 168, 0, 120, 0, 392, 280, 264, 0, 0],
  ["STR", null, "SLA", "Kapal", 0, 0, 0, 24, 0, 24, 0, 24, 24, 24, 0, 0],
  ["STR", null, "SSK", "Kapal", 456, 0, 216, 336, 0, 0, 216, 0, 768, 720, 0, 0],
  ["STR", null, "TMA", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["STR", null, "UBS", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "GMD", "Kapal", 1568, 0, 832, 3132, 2626, 200, 2328, 2148, 3648, 3580, 0, 0],
  ["RJW", null, "JAN", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "WJM", "Kapal", 1216, 48, 1256, 3264, 508, 976, 696, 1236, 2664, 2244, 0, 0],
  ["RJW", null, "NSA", "Kapal", 5936, 280, 3240, 4688, 1264, 2464, 2456, 6896, 5336, 6688, 152, 0],
  ["RJW", null, "CB", "Kapal", 128, 0, 0, 360, 0, 0, 0, 240, 192, 264, 48, 0],
  ["RJW", null, "KB", "Kapal", 816, 0, 808, 1208, 640, 832, 1624, 968, 1032, 1168, 120, 0],
  ["RJW", null, "BKP", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "GUDANG JAMBI - TERMINAL LAMPUNG", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "GUDANG JAMBI - TERMINAL PALEMBANG", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "JAMBI - LOCO TERMINAL", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "JMB", "Kapal", 0, 0, 3234, 2964, 364, 520, 728, 104, 364, 4992, 0, 0],
  ["RJW", null, "JMB", "Darat", 0, 50, 0, 0, 0, 1510, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "MGS", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "PGS", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "MAJU", "Kapal", 104, 0, 312, 780, 0, 494, 416, 0, 156, 520, 0, 0],
  ["RJW", null, "KTP", "Kapal", 896, 0, 0, 608, 0, 2000, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "CILEGON", "Darat", 5000, 10000, 0, 0, 0, 1512, 5944, 16008, 0, 15000, 0, 0],
  ["RJW", null, "GUDANG BYPASS - LAMPUNG (35244)", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "Gudang Way Lunik", "Terminal", 600, 2000, 2000, 0, 0, 0, 0, 3000, 0, 0, 0, 0],
  ["RJW", null, "LAMPUNG TERMINAL - LOCO (XXXXX)", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "INSA", "Kapal", 22634, 2250, 3610, 9358, 9810, 12708, 11000, 14954, 12288, 10285, 550, 0],
  ["RJW", null, "MB", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "CBS", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "GUDANG BATURAJA - TERMINAL LAMPUNG", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "GUDANG GANDUS - PM", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "GUDANG PERINTIS KEMERDEKAAN - PM", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "GUDANG SUKAJAYA - PM", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "GUDANG SUKAJAYA - TERMINAL LAMPUNG", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "PM", "Kapal", 280, 0, 560, 0, 840, 840, 840, 840, 1820, 5712, 0, 0],
  ["RJW", null, "PM", "Darat", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "SIN", "Kapal", 0, 0, 0, 0, 0, 1008, 1232, 1008, 0, 0, 0, 0],
  ["RJW", null, "PKB", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "BSJ", "Kapal", 0, 752, 704, 3000, 0, 1408, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "NBB", "Kapal", 0, 0, 0, 0, 0, 544, 848, 64, 952, 224, 0, 0],
  ["RJW", null, "GUDANG WAJOK", "Terminal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "PKL", "Kapal", 640, 0, 1320, 1160, 0, 2736, 0, 1000, 0, 264, 0, 0],
  ["RJW", null, "PTK", "Kapal", 4444, 0, 4632, 4860, 0, 13940, 1175, 3255, 1501, 7598, 0, 0],
  ["RJW", null, "BS", "Kapal", 1416, 0, 336, 744, 576, 984, 672, 576, 240, 744, 0, 0],
  ["RJW", null, "HUR", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "MA", "Kapal", 528, 24, 264, 264, 120, 264, 240, 312, 168, 288, 0, 0],
  ["RJW", null, "NC", "Kapal", 0, 0, 0, 0, 0, 0, 800, 0, 1456, 1432, 0, 0],
  ["RJW", null, "NCTB", "Kapal", 936, 0, 0, 1576, 0, 0, 0, 0, 120, 0, 0, 0],
  ["RJW", null, "RENULI", "Kapal", 536, 0, 88, 216, 144, 120, 240, 144, 392, 16, 0, 0],
  ["RJW", null, "ROSALIA", "Kapal", 696, 0, 168, 744, 192, 0, 960, 456, 936, 0, 408, 0],
  ["RJW", null, "SS", "Kapal", 184, 176, 216, 312, 0, 80, 240, 600, 96, 168, 0, 0],
  ["RJW", null, "SSK", "Kapal", 888, 0, 192, 336, 0, 96, 384, 48, 480, 480, 0, 0],
  ["RJW", null, "SLA", "Kapal", 288, 0, 24, 216, 48, 96, 240, 120, 96, 192, 0, 0],
  ["RJW", null, "TMA", "Kapal", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ["RJW", null, "UBS", "Kapal", 0, 250, 0, 250, 0, 0, 300, 0, 350, 0, 0, 0]
]$j$::json, 'isi awal');
    update sementrack.kelola_log set created_at = timestamptz '2026-11-05 17:00+07'
     where dataset = 'dofas' and created_by = 'isi awal';
  end if;
  if not exists (select 1 from sementrack.sellout_erp where tahun = 2026) then
    perform sementrack.sellout_erp_simpan(2026, $j$[
  ["S006", "PT. WANDI JAYA MAKMUR", "STR", 3369.7, 1932.7, 2683.8, 2979.05, 1500, 2288.35, 3095.8, 2214.65, 2634.3, 2952.6, 0, 0],
  ["S006", "PT. WANDI JAYA MAKMUR", "RJW", 1919.5, 1229.3, 777.25, 2023.85, 263.3, 1135.6, 2099.1, 1735.75, 1677.95, 1671.85, 0, 0],
  ["S010", "PT. BINTANG SENTOSA JAYA", "STR", 1696.05, 470.5, 636.6, 531.9, 0, 685.55, 427.6, 586.45, 944.65, 390.1, 0, 0],
  ["S010", "PT. BINTANG SENTOSA JAYA", "RJW", 1458.4, 580.2, 750.4, 640.75, 0, 1189.05, 833.75, 987.7, 880.5, 1008.5, 0, 0],
  ["S011", "CV. PANGKALANT", "STR", 432.75, 528.4, 734.85, 562.35, 443.6, 413.9, 701.75, 512.6, 506.15, 622.8, 0, 0],
  ["S011", "CV. PANGKALANT", "RJW", 809.65, 765, 333.55, 447.25, 1143.45, 909.35, 1404.25, 1066.1, 1022.65, 1491.92, 0, 0],
  ["S014", "PT. SUMATERA INVESTA NIAGA", "STR", 9291.5, 9574.5, 9592, 10572.5, 9077, 10901, 10686, 10361.5, 8594.5, 5297, 0, 0],
  ["S014", "PT. SUMATERA INVESTA NIAGA", "RJW", 0, 0, 0, 0, 0, 1195, 1015, 1000, 0, 0, 0, 0],
  ["S023", "CV. CAHAYA MATAHARI", "STR", 0, 0, 328.35, 0, 15, 7.5, 15, 15, 35.6, 20.5, 0, 0],
  ["S028", "PT. PASIFIC GLOBAL SEJAHTERA", "STR", 54, 0, 102.75, 0, 0, 0, 0, 0, 0, 71.5, 0, 0],
  ["S028", "PT. PASIFIC GLOBAL SEJAHTERA", "RJW", 118.5, 0, 255.05, 0, 0, 0, 0, 0, 0, 90.5, 0, 0],
  ["S029", "PT MANDIRI GLOBAL SUKSES SEJAHTERA", "STR", 21.9, 0, 37.2, 214.1, 450.75, 342, 60.7, 480.4, 0, 91, 0, 0],
  ["S029", "PT MANDIRI GLOBAL SUKSES SEJAHTERA", "RJW", 7.25, 249.9, 201.9, 295, 680.6, 561.85, 206.45, 444.4, 0, 266.55, 0, 0],
  ["S032", "PT. MULIA ABADI JAYA UNGGUL", "STR", 703.7, 157.5, 483.45, 249, 165.25, 577.8, 498.35, 677.6, 435.5, 390.25, 0, 0],
  ["S032", "PT. MULIA ABADI JAYA UNGGUL", "RJW", 459.1, 288.9, 379.3, 266.9, 119.2, 494.75, 326.85, 555.05, 206.75, 184.6, 0, 0]
]$j$::json, 'isi awal');
    update sementrack.kelola_log set created_at = timestamptz '2026-11-05 17:00+07'
     where dataset = 'erp' and created_by = 'isi awal';
  end if;
end $do$;

-- Cek:
-- select * from sementrack.v_sellout_bnn_peta order by urutan;
-- select p.region, p.nama, m.bulan, round(sum(m.ton)) from sementrack.v_sellout_bnn_monthly m
--   join sementrack.sellout_bnn_peta p on p.id = m.peta_id where m.tahun = 2026 group by 1, 2, 3 order by 1, 2, 3;
