-- =====================================================================
-- Kelola Data: upload & hapus Transaksi dan Sell In BNN lewat web, riwayat, status data.
-- Jalankan SETELAH sell_in_bnn.sql. Aman dijalankan ulang.
-- Jalankan sebagai pemilik tabel (nazamudin): fungsi tulis memakai SECURITY DEFINER.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Sell In BNN: WHITE MORTAR & TR-15 THINBED tidak dipakai (cukup STR, RJW, CWC)
-- ---------------------------------------------------------------------
create or replace function sementrack.sellin_is_mortar(p_produk text) returns boolean
language sql immutable parallel safe as $$
  select coalesce(p_produk, '') ~* '(MORTAR|THINBED)'
$$;

create or replace function sementrack.sellin_rule(p_tipe text, p_distributor text, p_asal text, p_produk text) returns boolean
language sql immutable parallel safe as $$
  select sementrack.sellin_rule(p_tipe, p_distributor, p_asal) and not sementrack.sellin_is_mortar(p_produk)
$$;

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
                 and sementrack.sellin_rule(s.tipe_pesanan, s.distributor, s.asal_pengiriman, s.tipe_produk)) then
    raise exception 'tidak ada baris yang lolos aturan (Gudang / PM toko-project dari ITP-Palembang, tanpa mortar)' using errcode = '22023';
  end if;
  lock table sementrack.sellin_bnn in share row exclusive mode;
  delete from sementrack.sellin_bnn b where b.tanggal between v_from and v_to;
  get diagnostics v_replaced = row_count;
  insert into sementrack.sellin_bnn (upload_id, tanggal, tanggal_order, distributor, kode_customer, nama_customer, tipe_pesanan, tipe_produk,
    asal_pengiriman, kode_tujuan, nama_tujuan, kota_tujuan, loco_franco, order_no, sdo, nomor_truk, zona_group, status_order, delivery_qty)
  select p_upload, s.tanggal, s.tanggal_order, s.distributor, s.kode_customer, s.nama_customer, s.tipe_pesanan, s.tipe_produk,
    s.asal_pengiriman, s.kode_tujuan, s.nama_tujuan, s.kota_tujuan, s.loco_franco, s.order_no, s.sdo, s.nomor_truk, s.zona_group, s.status_order, s.delivery_qty
  from sementrack.sellin_bnn_staging s
  where s.upload_id = p_upload and sementrack.sellin_rule(s.tipe_pesanan, s.distributor, s.asal_pengiriman, s.tipe_produk);
  get diagnostics v_saved = row_count;
  select coalesce(sum(b.ton), 0) into v_ton from sementrack.sellin_bnn b where b.upload_id = p_upload;
  delete from sementrack.sellin_bnn_staging s where s.upload_id = p_upload;
  update sementrack.sellin_bnn_upload u
     set status = 'selesai', finished_at = now(), rows_saved = v_saved, rows_replaced = v_replaced, ton_saved = v_ton
   where u.id = p_upload;
  return query select v_saved, v_replaced, v_ton, v_from, v_to;
end $$;

-- Data mortar yang sudah terlanjur tersimpan juga tidak ikut dihitung
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
where not sementrack.sellin_is_mortar(b.tipe_produk)
group by 1, 2, 3, 4, 5;

-- ---------------------------------------------------------------------
-- 2. Log aksi kelola data (upload transaksi, hapus transaksi / sell in)
-- ---------------------------------------------------------------------
create table if not exists sementrack.kelola_log (
  id           bigserial primary key,
  dataset      text not null check (dataset in ('transaksi', 'sellin')),
  aksi         text not null check (aksi in ('upload', 'hapus')),
  created_at   timestamptz not null default now(),
  created_by   text not null,
  source       text,
  file_name    text,
  date_from    date not null,
  date_to      date not null,
  dist_codes   text[],                  -- null = semua distributor
  rows_read    integer,
  rows_staged  integer not null default 0,
  rows_saved   integer,
  rows_deleted integer,
  status       text not null default 'proses' check (status in ('proses', 'selesai', 'batal')),
  finished_at  timestamptz,
  check (date_from <= date_to)
);

-- ---------------------------------------------------------------------
-- 3. Upload transaksi (format sama dengan template ada.csv, 22 kolom)
--    Ganti data HANYA untuk rentang tanggal DAN distributor yang ada di file.
-- ---------------------------------------------------------------------
create unlogged table if not exists sementrack.transaksi_staging (
  log_id bigint not null,
  dist_code text, distributor_name text, do_date date, do_no text, mss_no_order text, payment text,
  customer_code text, customer_name text, parent_customer_code text, parent_customer_name text, cust_group text,
  delivery_type text, product_code text, product_name text, destination text,
  order_qty numeric, bonus_qty numeric, total_qty numeric, net_amount numeric,
  salesman_code text, sales_tim text, pelunasan_hari numeric
);
create index if not exists transaksi_staging_log_idx on sementrack.transaksi_staging (log_id);

create or replace function sementrack.transaksi_begin(
  p_user text, p_source text, p_file text, p_from date, p_to date, p_dists text[], p_rows_read integer)
returns bigint
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_id bigint;
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'rentang tanggal tidak valid' using errcode = '22023'; end if;
  if p_dists is null or cardinality(p_dists) = 0 then raise exception 'distributor di file tidak terbaca' using errcode = '22023'; end if;
  with stale as (
    update sementrack.kelola_log set status = 'batal', finished_at = now()
    where dataset = 'transaksi' and aksi = 'upload' and status = 'proses' and created_at < now() - interval '6 hours' returning id)
  delete from sementrack.transaksi_staging s using stale where s.log_id = stale.id;
  insert into sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes, rows_read)
  values ('transaksi', 'upload', p_user, case when p_source = 'tempel' then 'tempel' else 'file' end, left(p_file, 200),
          p_from, p_to, (select array_agg(distinct btrim(d) order by btrim(d)) from unnest(p_dists) d), greatest(coalesce(p_rows_read, 0), 0))
  returning id into v_id;
  return v_id;
end $$;

-- Paket baris: JSON array of array, urutan kolom sama dengan ada.csv:
-- dist_code, distributor_name, do_date, do_no, mss_no_order, payment, customer_code, customer_name,
-- parent_customer_code, parent_customer_name, cust_group, delivery_type, product_code, product_name,
-- destination, order_qty, bonus_qty, total_qty, net_amount, salesman_code, sales_tim, pelunasan_hari
create or replace function sementrack.transaksi_stage(p_log bigint, p_rows json)
returns integer
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_from date; v_to date; v_dists text[]; v_n integer; v_bad integer;
begin
  select date_from, date_to, dist_codes into v_from, v_to, v_dists
  from sementrack.kelola_log where id = p_log and dataset = 'transaksi' and aksi = 'upload' and status = 'proses';
  if not found then raise exception 'upload % tidak ditemukan atau sudah selesai', p_log using errcode = '22023'; end if;
  if json_typeof(p_rows) <> 'array' then raise exception 'format paket tidak valid' using errcode = '22023'; end if;

  create temp table if not exists _trx_pkg (like sementrack.transaksi_staging) on commit drop;
  truncate _trx_pkg;
  insert into _trx_pkg
  select p_log,
    nullif(btrim(e->>0), ''), nullif(btrim(e->>1), ''), nullif(e->>2, '')::date, nullif(btrim(e->>3), ''),
    nullif(btrim(e->>4), ''), nullif(btrim(e->>5), ''), nullif(btrim(e->>6), ''), nullif(btrim(e->>7), ''),
    nullif(btrim(e->>8), ''), nullif(btrim(e->>9), ''), nullif(btrim(e->>10), ''), nullif(btrim(e->>11), ''),
    nullif(btrim(e->>12), ''), nullif(btrim(e->>13), ''), nullif(btrim(e->>14), ''),
    (e->>15)::numeric, (e->>16)::numeric, (e->>17)::numeric, (e->>18)::numeric,
    nullif(btrim(e->>19), ''), nullif(btrim(e->>20), ''), (e->>21)::numeric
  from json_array_elements(p_rows) e;
  get diagnostics v_n = row_count;

  select count(*) into v_bad from _trx_pkg
  where do_date is null or do_date < v_from or do_date > v_to or do_no is null
     or dist_code is null or not (dist_code = any(v_dists)) or customer_code is null or product_code is null;
  if v_bad > 0 then raise exception '% baris tidak valid (tanggal di luar rentang / do_no, dist_code, customer_code, product_code kosong)', v_bad using errcode = '22023'; end if;

  insert into sementrack.transaksi_staging select * from _trx_pkg;
  update sementrack.kelola_log set rows_staged = rows_staged + v_n where id = p_log;
  return v_n;
end $$;

/** Data transaksi yang sudah ada pada rentang & distributor ini (pratinjau sebelum simpan). */
create or replace function sementrack.transaksi_impact(p_from date, p_to date, p_dists text[])
returns table(dist_code text, baris bigint, jumlah_do bigint)
language sql stable security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
  select t.dist_code, count(*), count(distinct t.do_no)
  from public.transaksi t
  where t.do_date between p_from and p_to and t.dist_code = any(p_dists)
  group by t.dist_code order by t.dist_code
$$;

create or replace function sementrack.transaksi_commit(p_log bigint)
returns table(rows_saved integer, rows_deleted integer, date_from date, date_to date, dist_codes text[])
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_from date; v_to date; v_dists text[]; v_user text; v_saved integer; v_deleted integer; v_dup text; v_dup_n integer;
begin
  select l.date_from, l.date_to, l.dist_codes, l.created_by into v_from, v_to, v_dists, v_user
  from sementrack.kelola_log l where l.id = p_log and l.dataset = 'transaksi' and l.aksi = 'upload' and l.status = 'proses' for update;
  if not found then raise exception 'upload % tidak ditemukan atau sudah selesai', p_log using errcode = '22023'; end if;
  if not exists (select 1 from sementrack.transaksi_staging s where s.log_id = p_log) then
    raise exception 'tidak ada baris untuk disimpan' using errcode = '22023';
  end if;

  -- Nomor DO unik per distributor (bukan antar distributor). DO distributor yang sama yang sudah ada
  -- di LUAR rentang tanggal file = kemungkinan data dobel / tanggal salah: tolak.
  select count(*), string_agg(dist_code || ' ' || do_no, ', ') filter (where rn <= 5) into v_dup_n, v_dup
  from (select s.dist_code, s.do_no, row_number() over (order by s.dist_code, s.do_no) rn
        from (select distinct dist_code, do_no from sementrack.transaksi_staging where log_id = p_log) s
        where exists (select 1 from public.transaksi t where t.dist_code = s.dist_code and t.do_no = s.do_no
                      and not (t.do_date between v_from and v_to))) x;
  if v_dup_n > 0 then
    raise exception '% nomor DO di file sudah ada di tanggal lain untuk distributor yang sama, mis. %. Periksa file agar tidak dobel.', v_dup_n, v_dup using errcode = '22023';
  end if;

  -- Kode produk / distributor harus sudah ada di master (foreign key). Beri pesan yang jelas sebelum database menolak.
  if to_regclass('public.produk') is not null then
    select string_agg(x, ', ') into v_dup from (select distinct s.product_code x from sementrack.transaksi_staging s
      where s.log_id = p_log and not exists (select 1 from public.produk p where p.kode = s.product_code) order by 1 limit 10) z;
    if v_dup is not null then raise exception 'Kode produk belum terdaftar di master produk: %. Tambahkan dulu ke tabel produk.', v_dup using errcode = '22023'; end if;
  end if;
  if to_regclass('public.distributor') is not null then
    select string_agg(x, ', ') into v_dup from (select distinct s.dist_code x from sementrack.transaksi_staging s
      where s.log_id = p_log and not exists (select 1 from public.distributor d where d.dist_code = s.dist_code) order by 1 limit 10) z;
    if v_dup is not null then raise exception 'Kode distributor belum terdaftar di master distributor: %.', v_dup using errcode = '22023'; end if;
  end if;

  lock table public.transaksi in share row exclusive mode;
  delete from public.transaksi t where t.do_date between v_from and v_to and t.dist_code = any(v_dists);
  get diagnostics v_deleted = row_count;

  insert into public.transaksi (dist_code, distributor_name, do_date, do_no, mss_no_order, payment, customer_code, customer_name,
    parent_customer_code, parent_customer_name, cust_group, delivery_type, product_code, product_name, destination,
    order_qty, bonus_qty, total_qty, net_amount, salesman_code, sales_tim, pelunasan_hari)
  select dist_code, distributor_name, do_date, do_no, mss_no_order, payment, customer_code, customer_name,
    parent_customer_code, parent_customer_name, cust_group, delivery_type, product_code, product_name, destination,
    order_qty, bonus_qty, total_qty, net_amount, salesman_code, sales_tim, pelunasan_hari
  from sementrack.transaksi_staging s where s.log_id = p_log;
  get diagnostics v_saved = row_count;

  delete from sementrack.transaksi_staging s where s.log_id = p_log;
  update sementrack.kelola_log l set status = 'selesai', finished_at = now(), rows_saved = v_saved, rows_deleted = v_deleted where l.id = p_log;

  -- status sinkronisasi ikut diperbarui (dipakai info "diperbarui" di web)
  update public.status_sync
     set tanggal_update = (now() at time zone 'Asia/Jakarta')::date,
         jam_update = date_trunc('minute', (now() at time zone 'Asia/Jakarta')::time),
         keterangan = 'Upload transaksi lewat web oleh ' || v_user
   where id = 1;

  return query select v_saved, v_deleted, v_from, v_to, v_dists;
end $$;

create or replace function sementrack.transaksi_abort(p_log bigint)
returns void
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
begin
  delete from sementrack.transaksi_staging where log_id = p_log;
  update sementrack.kelola_log set status = 'batal', finished_at = now()
   where id = p_log and dataset = 'transaksi' and status = 'proses';
end $$;

-- ---------------------------------------------------------------------
-- 4. Hapus data per rentang tanggal (transaksi: bisa dibatasi distributor)
-- ---------------------------------------------------------------------
create or replace function sementrack.kelola_hapus_pratinjau(p_dataset text, p_from date, p_to date, p_dists text[])
returns table(baris bigint, ton numeric, tanggal_pertama date, tanggal_terakhir date)
language plpgsql stable security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
begin
  if p_dataset = 'transaksi' then
    return query select count(*), coalesce(round(sum(public.calc_tonase(t.product_code, t.order_qty)), 1), 0), min(t.do_date), max(t.do_date)
      from public.transaksi t
      where t.do_date between p_from and p_to and (p_dists is null or cardinality(p_dists) = 0 or t.dist_code = any(p_dists));
  elsif p_dataset = 'sellin' then
    return query select count(*), coalesce(round(sum(b.ton), 1), 0), min(b.tanggal), max(b.tanggal)
      from sementrack.sellin_bnn b where b.tanggal between p_from and p_to;
  else
    raise exception 'dataset tidak dikenal' using errcode = '22023';
  end if;
end $$;

create or replace function sementrack.kelola_hapus(p_dataset text, p_from date, p_to date, p_dists text[], p_user text)
returns integer
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_n integer; v_dists text[];
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'rentang tanggal tidak valid' using errcode = '22023'; end if;
  v_dists := case when p_dists is null or cardinality(p_dists) = 0 then null else p_dists end;
  if p_dataset = 'transaksi' then
    delete from public.transaksi t where t.do_date between p_from and p_to and (v_dists is null or t.dist_code = any(v_dists));
    get diagnostics v_n = row_count;
  elsif p_dataset = 'sellin' then
    v_dists := null;
    delete from sementrack.sellin_bnn b where b.tanggal between p_from and p_to;
    get diagnostics v_n = row_count;
  else
    raise exception 'dataset tidak dikenal' using errcode = '22023';
  end if;
  insert into sementrack.kelola_log (dataset, aksi, created_by, date_from, date_to, dist_codes, rows_deleted, status, finished_at)
  values (p_dataset, 'hapus', p_user, p_from, p_to, v_dists, v_n, 'selesai', now());
  return v_n;
end $$;

create or replace function sementrack.status_sync_set(p_tanggal date, p_jam time, p_keterangan text)
returns void
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
begin
  if p_tanggal is null then raise exception 'tanggal wajib diisi' using errcode = '22023'; end if;
  update public.status_sync set tanggal_update = p_tanggal, jam_update = p_jam, keterangan = nullif(btrim(p_keterangan), '') where id = 1;
  if not found then
    insert into public.status_sync (id, tanggal_update, jam_update, keterangan) values (1, p_tanggal, p_jam, nullif(btrim(p_keterangan), ''));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Riwayat gabungan (halaman Kelola Data)
-- ---------------------------------------------------------------------
create or replace view sementrack.v_kelola_riwayat as
select 'sellin'::text as dataset, 'upload'::text as aksi, u.created_at, u.created_by, u.source, u.file_name, u.date_from, u.date_to,
       null::text[] as dist_codes, u.rows_read, u.rows_saved, u.rows_replaced as rows_deleted, u.status
from sementrack.sellin_bnn_upload u
union all
select l.dataset, l.aksi, l.created_at, l.created_by, l.source, l.file_name, l.date_from, l.date_to,
       l.dist_codes, l.rows_read, l.rows_saved, l.rows_deleted, l.status
from sementrack.kelola_log l;

-- ---------------------------------------------------------------------
-- 6. Status data untuk semua halaman (badge per halaman + panel Status Data)
--    data_sampai = tanggal data terakhir; diperbarui = kapan data terakhir masuk.
--    Kolom tahun di view bulanan (do_YYYY / realisasi_YYYY) dicari otomatis.
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
sellin_up as (select u.created_at, u.created_by from sementrack.sellin_bnn_upload u where u.status = 'selesai' order by u.id desc limit 1)
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
       (select case when m is null then null else (make_date(y, m::int, 1) + interval '1 month - 1 day')::date end from si), null, null;

grant select on sementrack.v_data_status, sementrack.v_kelola_riwayat, sementrack.kelola_log to public;

-- Cek:
-- select * from sementrack.v_data_status;
-- select * from sementrack.v_kelola_riwayat order by created_at desc limit 10;
