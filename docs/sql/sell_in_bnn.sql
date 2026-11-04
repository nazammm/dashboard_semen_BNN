-- =====================================================================
-- Sell In BNN: tabel, fungsi upload, dan view untuk halaman "Sell In BNN"
-- Sumber: export raw sell in (format kolom sama dengan raw_sell_in.xlsx).
-- Aman dijalankan ulang (create ... if not exists / create or replace).
--
-- Aturan data yang dipakai (ditegakkan di sementrack.sellin_bnn_commit):
--   1. Tipe Pesanan = Gudang (semua distributor), DITAMBAH
--   2. PT Permata Multi Niaga: Tipe Pesanan Toko dan Project, hanya yang
--      Asal Pengiriman = ITP-Palembang Terminal.
-- 1 baris raw = 1 pengiriman (1 truk). Tonase = Delivery Quantity (zak) x berat
-- per zak dari nama produk (50KG / 40KG; tanpa keterangan = 40 kg).
-- JANGAN pakai "Order Quantity (Ton)": nilainya diulang di setiap pengiriman
-- untuk order yang dikirim bertahap.
-- =====================================================================

create schema if not exists sementrack;

-- ---------------------------------------------------------------------
-- 1. Peta Kode Customer -> Region (bisa ditambah dari halaman Upload Sell In)
-- ---------------------------------------------------------------------
create table if not exists sementrack.sellin_region_map (
  kode_customer text primary key,
  region        text not null check (btrim(region) <> ''),
  nama_customer text,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

insert into sementrack.sellin_region_map (kode_customer, region, nama_customer, updated_by) values
  ('3300526257', 'Lampung',    'Terminal Lampung - BMM ( Loco )', 'awal'),
  ('3300000006', 'Lampung',    'Gudang Way Lunik', 'awal'),
  ('3100003033', 'Kepri',      'Riau, Tj. Pinang, Pelabuhan', 'awal'),
  ('3100003048', 'Pekanbaru',  'Gudang Pelindo, Selat Panjang, Pelabuhan', 'awal'),
  ('3100003035', 'Belitung',   'Belitung, Tanjung Pandan, Pelabuhan', 'awal'),
  ('3100000546', 'Bangka',     'Pelabuhan Bangka - Pangkal Balam', 'awal'),
  ('3100003036', 'Belitung',   'Belitung, Tanjung Pandan, Pelabuhan', 'awal'),
  ('3100000553', 'Batam',      'Batam Batu Ampar, Pelabuhan', 'awal'),
  ('3100000561', 'Sumsel',     'Boom Baru, Pelabuhan', 'awal'),
  ('3300000001', 'Sumsel',     'Gudang Sukajaya', 'awal'),
  ('3300000003', 'Sumsel',     'Gudang Perintis', 'awal'),
  ('3100003140', 'Sumsel',     'GUDANG LAHAT', 'awal'),
  ('3000527716', 'Jambi',      'Gudang Jambi - Loco Citeureup', 'awal'),
  ('3000527548', 'Jambi',      'Gudang Jambi - Loco Terminal Lais', 'awal'),
  ('3000526397', 'Jambi',      'Gudang Jambi - Franco', 'awal'),
  ('3100000675', 'Kalbar-PTK', 'Pontianak, Pelabuhan', 'awal'),
  ('3300000012', 'Kalbar-PTK', 'GUDANG WAJOK - PONTIANAK', 'awal'),
  ('1000500762', 'Lampung',    'Gudang BNN Lampung - Loco Citeureup', 'awal'),
  ('3300000007', 'Lampung',    'Gudang Cilegon Lampung-BNN [Pallet]', 'awal'),
  ('3100003049', 'Pekanbaru',  'Tembilahan, Pelabuhan', 'awal'),          -- di daftar tertulis "pekanbaru" (huruf kecil): disamakan
  ('3100003034', 'Kepri',      'Balai Karimun, Pelabuhan', 'awal'),
  ('3300000017', 'Bengkulu',   'GUDANG BENGKULU KOKOH PERKASA', 'awal'),
  ('3100000864', 'Bengkulu',   'Pulau Baai, Pelabuhan', 'awal'),
  ('3100000548', 'Padang',     'Teluk Bayur Padang, Pelabuhan', 'awal'),
  ('3100003037', 'Bangka',     'Bangka - Pangkal Balam, Pelabuhan', 'awal'),
  ('3100003038', 'Sumut',      'Belawan, Pelabuhan', 'awal'),
  ('3100000601', 'Pekanbaru',  'Perawang, Pelabuhan', 'awal'),
  ('3100002659', 'Dumai',      'DUMAI PELABUHAN', 'awal'),               -- di daftar tertulis "DUMAI": disamakan gaya penulisannya
  ('3100001818', 'Pekanbaru',  'Bengkalis, Pelabuhan', 'awal'),
  ('3000524733', 'Sumsel',     'Gudang PM Palembang Loco Ctrp', 'awal'),
  ('3300000002', 'Sumsel',     'Gudang Baturaja', 'awal'),
  ('3100000484', 'Sumut',      'Belawan, Pelabuhan', 'awal'),
  ('3100000547', 'Sumut',      'Kuala Tanjung, Pelabuhan', 'awal'),
  ('3100000602', 'Jambi',      'Talang Duku, Pelabuhan', 'awal'),
  ('3100000897', 'Kalbar-KTP', 'Ketapang, Pelabuhan', 'awal')
on conflict (kode_customer) do nothing;

-- Dua kode Gudang di data yang belum ada di daftar. USULAN (cek dulu, hapus baris ini kalau salah):
insert into sementrack.sellin_region_map (kode_customer, region, nama_customer, updated_by) values
  ('1000532349', 'Sumsel', 'Gudang Baturaja - Terminal Lampung', 'usulan'),
  ('3000525492', 'Jambi',  'Gudang Talang Gulo Jambi - Loco Ctrp [Pallet]', 'usulan')
on conflict (kode_customer) do nothing;

-- ---------------------------------------------------------------------
-- 2. Riwayat upload, tabel sementara, dan data utama
-- ---------------------------------------------------------------------
create table if not exists sementrack.sellin_bnn_upload (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  created_by    text not null,
  source        text not null check (source in ('file', 'tempel')),
  file_name     text,
  date_from     date not null,
  date_to       date not null,
  rows_read     integer not null default 0,     -- baris di file (sebelum aturan)
  rows_staged   integer not null default 0,     -- baris terkirim ke server
  rows_saved    integer,                        -- baris tersimpan (lolos aturan)
  rows_replaced integer,                        -- baris lama pada rentang tanggal yang diganti
  ton_saved     numeric,
  status        text not null default 'proses' check (status in ('proses', 'selesai', 'batal')),
  finished_at   timestamptz,
  check (date_from <= date_to)
);

/** Berat per zak (kg) dari nama produk: "PCC 50KG" -> 50. Tanpa keterangan berat -> 40. */
create or replace function sementrack.sellin_kg(p_produk text) returns numeric
language sql immutable parallel safe as $$
  select coalesce((regexp_match(coalesce(p_produk, ''), '(\d+(?:[.,]\d+)?)\s*KG', 'i'))[1]::numeric, 40)
$$;

create table if not exists sementrack.sellin_bnn (
  id              bigserial primary key,
  upload_id       bigint not null references sementrack.sellin_bnn_upload(id),
  tanggal         date not null,              -- Tanggal Pengiriman
  tanggal_order   date,
  distributor     text not null,
  kode_customer   text not null,
  nama_customer   text,
  tipe_pesanan    text not null,
  tipe_produk     text not null,
  asal_pengiriman text,
  kode_tujuan     text,
  nama_tujuan     text,
  kota_tujuan     text,
  loco_franco     text,
  order_no        text,
  sdo             text,
  nomor_truk      text,
  zona_group      text,
  status_order    text,
  delivery_qty    numeric not null,           -- zak
  ton             numeric generated always as (delivery_qty * sementrack.sellin_kg(tipe_produk) / 1000) stored
);
create index if not exists sellin_bnn_tanggal_idx on sementrack.sellin_bnn (tanggal);

create unlogged table if not exists sementrack.sellin_bnn_staging (
  upload_id       bigint not null,
  tanggal         date not null,
  tanggal_order   date,
  distributor     text not null,
  kode_customer   text not null,
  nama_customer   text,
  tipe_pesanan    text not null,
  tipe_produk     text not null,
  asal_pengiriman text,
  kode_tujuan     text,
  nama_tujuan     text,
  kota_tujuan     text,
  loco_franco     text,
  order_no        text,
  sdo             text,
  nomor_truk      text,
  zona_group      text,
  status_order    text,
  delivery_qty    numeric not null
);
create index if not exists sellin_bnn_staging_upload_idx on sementrack.sellin_bnn_staging (upload_id);

/** Aturan baris yang dipakai (satu sumber kebenaran). */
create or replace function sementrack.sellin_rule(p_tipe text, p_distributor text, p_asal text) returns boolean
language sql immutable parallel safe as $$
  select lower(btrim(coalesce(p_tipe, ''))) = 'gudang'
      or (coalesce(p_distributor, '') ilike '%PERMATA MULTI NIAGA%'
          and lower(btrim(coalesce(p_tipe, ''))) in ('toko', 'project')
          and lower(btrim(coalesce(p_asal, ''))) = 'itp-palembang terminal')
$$;

/** Region sebuah baris: dari peta kode customer; toko/project PM (asal Palembang) -> Sumsel. */
create or replace function sementrack.sellin_region(p_map_region text, p_tipe text, p_distributor text) returns text
language sql immutable parallel safe as $$
  select coalesce(
    p_map_region,
    case when lower(btrim(coalesce(p_tipe, ''))) in ('toko', 'project') and coalesce(p_distributor, '') ilike '%PERMATA MULTI NIAGA%' then 'Sumsel' end,
    'Belum dipetakan')
$$;

-- ---------------------------------------------------------------------
-- 3. Fungsi upload (dipanggil backend; hanya untuk akun admin)
--    Alur: begin -> stage (berkali-kali, per paket) -> commit  (atau abort)
--    commit mengganti SEMUA data pada rentang tanggal file dalam 1 transaksi.
-- ---------------------------------------------------------------------
create or replace function sementrack.sellin_bnn_begin(
  p_user text, p_source text, p_file text, p_from date, p_to date, p_rows_read integer)
returns bigint
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_id bigint;
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'rentang tanggal tidak valid' using errcode = '22023'; end if;
  if p_to - p_from > 800 then raise exception 'rentang tanggal terlalu panjang (maks 800 hari)' using errcode = '22023'; end if;
  -- upload yang macet > 6 jam dianggap batal (bersih-bersih tabel sementara)
  with stale as (
    update sementrack.sellin_bnn_upload set status = 'batal', finished_at = now()
    where status = 'proses' and created_at < now() - interval '6 hours' returning id)
  delete from sementrack.sellin_bnn_staging s using stale where s.upload_id = stale.id;

  insert into sementrack.sellin_bnn_upload (created_by, source, file_name, date_from, date_to, rows_read)
  values (p_user, case when p_source = 'tempel' then 'tempel' else 'file' end, left(p_file, 200), p_from, p_to, greatest(coalesce(p_rows_read, 0), 0))
  returning id into v_id;
  return v_id;
end $$;

-- Satu paket baris dalam bentuk JSON array of array, urutan kolom:
-- [tanggal, tanggal_order, distributor, kode_customer, nama_customer, tipe_pesanan, tipe_produk,
--  asal_pengiriman, kode_tujuan, nama_tujuan, kota_tujuan, loco_franco, order_no, sdo, nomor_truk,
--  zona_group, status_order, delivery_qty]
create or replace function sementrack.sellin_bnn_stage(p_upload bigint, p_rows json)
returns integer
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_from date; v_to date; v_n integer; v_bad integer;
begin
  select date_from, date_to into v_from, v_to from sementrack.sellin_bnn_upload where id = p_upload and status = 'proses';
  if not found then raise exception 'upload % tidak ditemukan atau sudah selesai', p_upload using errcode = '22023'; end if;
  if json_typeof(p_rows) <> 'array' then raise exception 'format paket tidak valid' using errcode = '22023'; end if;

  create temp table if not exists _sellin_pkg (like sementrack.sellin_bnn_staging) on commit drop;
  truncate _sellin_pkg;
  insert into _sellin_pkg
  select p_upload,
         nullif(e->>0, '')::date, nullif(e->>1, '')::date,
         btrim(e->>2), btrim(e->>3), nullif(btrim(e->>4), ''), btrim(e->>5), btrim(e->>6),
         nullif(btrim(e->>7), ''), nullif(btrim(e->>8), ''), nullif(btrim(e->>9), ''), nullif(btrim(e->>10), ''),
         nullif(btrim(e->>11), ''), nullif(btrim(e->>12), ''), nullif(btrim(e->>13), ''), nullif(btrim(e->>14), ''),
         nullif(btrim(e->>15), ''), nullif(btrim(e->>16), ''),
         (e->>17)::numeric
  from json_array_elements(p_rows) e;
  get diagnostics v_n = row_count;

  select count(*) into v_bad from _sellin_pkg
  where tanggal is null or tanggal < v_from or tanggal > v_to or delivery_qty is null or delivery_qty < 0
     or coalesce(distributor, '') = '' or coalesce(kode_customer, '') = '' or coalesce(tipe_pesanan, '') = '' or coalesce(tipe_produk, '') = '';
  if v_bad > 0 then raise exception '% baris tidak valid (tanggal di luar rentang / kolom wajib kosong / qty negatif)', v_bad using errcode = '22023'; end if;

  insert into sementrack.sellin_bnn_staging select * from _sellin_pkg;
  update sementrack.sellin_bnn_upload set rows_staged = rows_staged + v_n where id = p_upload;
  return v_n;
end $$;

create or replace function sementrack.sellin_bnn_commit(p_upload bigint)
returns table(rows_saved integer, rows_replaced integer, ton_saved numeric, date_from date, date_to date)
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_from date; v_to date; v_saved integer; v_replaced integer; v_ton numeric;
begin
  select u.date_from, u.date_to into v_from, v_to from sementrack.sellin_bnn_upload u where u.id = p_upload and u.status = 'proses' for update;
  if not found then raise exception 'upload % tidak ditemukan atau sudah selesai', p_upload using errcode = '22023'; end if;
  if not exists (select 1 from sementrack.sellin_bnn_staging s where s.upload_id = p_upload
                 and sementrack.sellin_rule(s.tipe_pesanan, s.distributor, s.asal_pengiriman)) then
    raise exception 'tidak ada baris yang lolos aturan (Gudang / PM toko-project dari ITP-Palembang)' using errcode = '22023';
  end if;

  -- satu commit dalam satu waktu
  lock table sementrack.sellin_bnn in share row exclusive mode;

  delete from sementrack.sellin_bnn b where b.tanggal between v_from and v_to;
  get diagnostics v_replaced = row_count;

  insert into sementrack.sellin_bnn (upload_id, tanggal, tanggal_order, distributor, kode_customer, nama_customer, tipe_pesanan, tipe_produk,
    asal_pengiriman, kode_tujuan, nama_tujuan, kota_tujuan, loco_franco, order_no, sdo, nomor_truk, zona_group, status_order, delivery_qty)
  select p_upload, s.tanggal, s.tanggal_order, s.distributor, s.kode_customer, s.nama_customer, s.tipe_pesanan, s.tipe_produk,
    s.asal_pengiriman, s.kode_tujuan, s.nama_tujuan, s.kota_tujuan, s.loco_franco, s.order_no, s.sdo, s.nomor_truk, s.zona_group, s.status_order, s.delivery_qty
  from sementrack.sellin_bnn_staging s
  where s.upload_id = p_upload and sementrack.sellin_rule(s.tipe_pesanan, s.distributor, s.asal_pengiriman);
  get diagnostics v_saved = row_count;

  select coalesce(sum(b.ton), 0) into v_ton from sementrack.sellin_bnn b where b.upload_id = p_upload;
  delete from sementrack.sellin_bnn_staging s where s.upload_id = p_upload;
  update sementrack.sellin_bnn_upload u
     set status = 'selesai', finished_at = now(), rows_saved = v_saved, rows_replaced = v_replaced, ton_saved = v_ton
   where u.id = p_upload;

  return query select v_saved, v_replaced, v_ton, v_from, v_to;
end $$;

create or replace function sementrack.sellin_bnn_abort(p_upload bigint)
returns void
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
begin
  delete from sementrack.sellin_bnn_staging where upload_id = p_upload;
  update sementrack.sellin_bnn_upload set status = 'batal', finished_at = now() where id = p_upload and status = 'proses';
end $$;

/** Data lama yang akan diganti oleh upload dengan rentang tanggal ini (untuk pratinjau sebelum simpan). */
create or replace function sementrack.sellin_bnn_impact(p_from date, p_to date)
returns table(rows_existing bigint, ton_existing numeric, first_date date, last_date date)
language sql stable security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
  select count(*), coalesce(sum(ton), 0), min(tanggal), max(tanggal)
  from sementrack.sellin_bnn where tanggal between p_from and p_to
$$;

create or replace function sementrack.sellin_region_set(p_kode text, p_region text, p_nama text, p_user text)
returns void
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
begin
  if coalesce(btrim(p_kode), '') = '' or coalesce(btrim(p_region), '') = '' then
    raise exception 'kode customer dan region wajib diisi' using errcode = '22023';
  end if;
  insert into sementrack.sellin_region_map (kode_customer, region, nama_customer, updated_at, updated_by)
  values (btrim(p_kode), btrim(p_region), nullif(btrim(p_nama), ''), now(), p_user)
  on conflict (kode_customer) do update
    set region = excluded.region, nama_customer = coalesce(excluded.nama_customer, sellin_region_map.nama_customer),
        updated_at = now(), updated_by = excluded.updated_by;
end $$;

-- ---------------------------------------------------------------------
-- 4. View untuk dashboard
-- ---------------------------------------------------------------------
-- Ringkasan harian (grain kecil, dibaca halaman Sell In BNN lalu diolah di browser)
create or replace view sementrack.v_sellin_bnn_daily as
select b.tanggal,
       sementrack.sellin_region(m.region, b.tipe_pesanan, b.distributor) as region,
       b.tipe_produk  as produk,
       initcap(lower(b.tipe_pesanan)) as tipe_pesanan,
       coalesce(nullif(initcap(lower(b.loco_franco)), ''), 'Tidak diisi') as loco_franco,
       round(sum(b.ton), 3)   as ton,
       sum(b.delivery_qty)    as zak,
       count(*)::int          as pengiriman
from sementrack.sellin_bnn b
left join sementrack.sellin_region_map m on m.kode_customer = b.kode_customer
group by 1, 2, 3, 4, 5;

-- Informasi kesegaran data (badge "Data s.d. ...")
create or replace view sementrack.v_sellin_bnn_info as
select (select max(tanggal) from sementrack.sellin_bnn) as data_sampai,
       (select min(tanggal) from sementrack.sellin_bnn) as data_mulai,
       (select count(*)::int from sementrack.sellin_bnn) as total_baris,
       u.created_at as upload_terakhir, u.created_by as upload_oleh
from (select 1) x
left join lateral (select created_at, created_by from sementrack.sellin_bnn_upload where status = 'selesai' order by id desc limit 1) u on true;

-- Kode customer (Gudang) yang belum punya region
create or replace view sementrack.v_sellin_unmapped as
select b.kode_customer, max(b.nama_customer) as nama_customer, max(b.distributor) as distributor,
       count(*)::int as pengiriman, round(sum(b.ton), 1) as ton, max(b.tanggal) as terakhir
from sementrack.sellin_bnn b
left join sementrack.sellin_region_map m on m.kode_customer = b.kode_customer
where m.kode_customer is null
  and sementrack.sellin_region(null, b.tipe_pesanan, b.distributor) = 'Belum dipetakan'
group by b.kode_customer;

grant usage on schema sementrack to public;
grant select on sementrack.v_sellin_bnn_daily, sementrack.v_sellin_bnn_info, sementrack.v_sellin_unmapped, sementrack.sellin_region_map,
  sementrack.sellin_bnn_upload to public;

-- Cek setelah upload pertama:
-- select * from sementrack.v_sellin_bnn_info;
-- select region, round(sum(ton)) from sementrack.v_sellin_bnn_daily group by 1 order by 2 desc;
-- select * from sementrack.v_sellin_unmapped order by ton desc;
