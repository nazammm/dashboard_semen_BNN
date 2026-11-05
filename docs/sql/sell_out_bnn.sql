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
         case when p.j073 then 'J073 (belum tersedia)' end) as sumber
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

-- Cek:
-- select * from sementrack.v_sellout_bnn_peta order by urutan;
-- select p.region, p.nama, m.bulan, round(sum(m.ton)) from sementrack.v_sellout_bnn_monthly m
--   join sementrack.sellout_bnn_peta p on p.id = m.peta_id where m.tahun = 2026 group by 1, 2, 3 order by 1, 2, 3;
