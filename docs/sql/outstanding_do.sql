-- =====================================================================
-- Outstanding DO (sell in): order ke pabrik yang belum terkirim.
-- Sumber: export raw sell in yang difilter menurut TANGGAL ORDER (bukan tanggal pengiriman),
-- format kolom sama dengan raw sell in, tetapi berisi semua status:
--   Delivered, Partially Delivered, Verified (belum dikirim), Not Verified, Reject.
--
-- Aturan baris sama dengan Sell In BNN (sementrack.sellin_rule): Gudang semua distributor,
-- ditambah PM Toko/Project dari ITP-Palembang Terminal; mortar & thinbed tidak dipakai.
-- Satu order = Distributor + Order No + Tipe Produk (Order No bisa sama di distributor lain).
--   order_qty   = Order Quantity (zak), sama di setiap baris pengiriman order itu
--   delivery_qty= jumlah Delivery Quantity semua pengiriman order itu
--   sisa        = order_qty - delivery_qty (tidak kurang dari 0)
-- Outstanding  = sisa order berstatus Verified atau Partially Delivered.
-- Not Verified dihitung terpisah (belum disetujui). Reject & Delivered tidak dihitung.
-- Posisi data  = tanggal pengiriman terakhir di file (atau tanggal order terakhir kalau lebih baru).
-- Upload mengganti semua order dengan tanggal order di rentang file.
--
-- Jalankan SETELAH sell_in_bnn.sql dan kelola_data.sql, sebagai pemilik tabel (nazamudin).
-- Aman dijalankan ulang.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Tabel
-- ---------------------------------------------------------------------
create table if not exists sementrack.sellin_po_upload (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  created_by    text not null,
  source        text not null check (source in ('file', 'tempel')),
  file_name     text,
  date_from     date not null,                  -- tanggal order pertama di file
  date_to       date not null,                  -- tanggal order terakhir di file
  rows_read     integer not null default 0,
  rows_staged   integer not null default 0,
  rows_saved    integer,                        -- jumlah order tersimpan
  rows_replaced integer,                        -- order lama pada rentang tanggal order yang diganti
  posisi        date,
  status        text not null default 'proses' check (status in ('proses', 'selesai', 'batal')),
  finished_at   timestamptz,
  check (date_from <= date_to)
);

-- 1 baris = 1 order (distributor + order no + produk), hasil gabungan baris pengiriman di file
create table if not exists sementrack.sellin_po (
  upload_id       bigint not null references sementrack.sellin_po_upload(id),
  distributor     text not null,
  order_no        text not null,
  tipe_produk     text not null,
  tanggal_order   date not null,
  estimasi_kirim  date,
  kirim_terakhir  date,
  status_order    text not null,
  alasan_reject   text,
  kode_customer   text not null,
  nama_customer   text,
  tipe_pesanan    text not null,
  asal_pengiriman text,
  kode_tujuan     text,
  nama_tujuan     text,
  kota_tujuan     text,
  loco_franco     text,
  order_qty       numeric not null,             -- zak
  delivery_qty    numeric not null default 0,   -- zak, semua pengiriman
  pengiriman      integer not null default 0,   -- jumlah baris pengiriman (truk)
  primary key (distributor, order_no, tipe_produk)
);
create index if not exists sellin_po_tanggal_idx on sementrack.sellin_po (tanggal_order);
create index if not exists sellin_po_status_idx on sementrack.sellin_po (status_order);

create unlogged table if not exists sementrack.sellin_po_staging (
  upload_id       bigint not null,
  tanggal_order   date not null,
  distributor     text not null,
  order_no        text not null,
  tipe_produk     text not null,
  status_order    text not null,
  estimasi_kirim  date,
  tanggal_kirim   date,
  alasan_reject   text,
  kode_customer   text not null,
  nama_customer   text,
  tipe_pesanan    text not null,
  asal_pengiriman text,
  kode_tujuan     text,
  nama_tujuan     text,
  kota_tujuan     text,
  loco_franco     text,
  order_qty       numeric,                      -- kosong di baris pengiriman ke-2 dst. sebagian export
  delivery_qty    numeric
);
alter table sementrack.sellin_po_staging alter column order_qty drop not null;
create index if not exists sellin_po_staging_upload_idx on sementrack.sellin_po_staging (upload_id);

-- ---------------------------------------------------------------------
-- 2. Fungsi upload (backend admin): begin -> stage (per paket) -> commit, atau abort
-- ---------------------------------------------------------------------
create or replace function sementrack.sellin_po_begin(
  p_user text, p_source text, p_file text, p_from date, p_to date, p_rows_read integer)
returns bigint
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_id bigint;
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'rentang tanggal order tidak valid' using errcode = '22023'; end if;
  if p_to - p_from > 800 then raise exception 'rentang tanggal order terlalu panjang (maks 800 hari)' using errcode = '22023'; end if;
  with stale as (
    update sementrack.sellin_po_upload set status = 'batal', finished_at = now()
    where status = 'proses' and created_at < now() - interval '6 hours' returning id)
  delete from sementrack.sellin_po_staging s using stale where s.upload_id = stale.id;

  insert into sementrack.sellin_po_upload (created_by, source, file_name, date_from, date_to, rows_read)
  values (p_user, case when p_source = 'tempel' then 'tempel' else 'file' end, left(p_file, 200), p_from, p_to, greatest(coalesce(p_rows_read, 0), 0))
  returning id into v_id;
  return v_id;
end $$;

-- Paket JSON array of array, urutan kolom:
-- [tanggal_order, distributor, order_no, tipe_produk, status_order, estimasi_kirim, tanggal_kirim, alasan_reject,
--  kode_customer, nama_customer, tipe_pesanan, asal_pengiriman, kode_tujuan, nama_tujuan, kota_tujuan, loco_franco,
--  order_qty, delivery_qty]
create or replace function sementrack.sellin_po_stage(p_upload bigint, p_rows json)
returns integer
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_from date; v_to date; v_n integer; v_bad integer;
begin
  select date_from, date_to into v_from, v_to from sementrack.sellin_po_upload where id = p_upload and status = 'proses';
  if not found then raise exception 'upload % tidak ditemukan atau sudah selesai', p_upload using errcode = '22023'; end if;
  if json_typeof(p_rows) <> 'array' then raise exception 'format paket tidak valid' using errcode = '22023'; end if;

  create temp table if not exists _po_pkg (like sementrack.sellin_po_staging) on commit drop;
  truncate _po_pkg;
  insert into _po_pkg
  select p_upload,
         nullif(e->>0, '')::date, btrim(e->>1), btrim(e->>2), btrim(e->>3), btrim(e->>4),
         nullif(e->>5, '')::date, nullif(e->>6, '')::date, nullif(btrim(e->>7), ''),
         btrim(e->>8), nullif(btrim(e->>9), ''), btrim(e->>10), nullif(btrim(e->>11), ''),
         nullif(btrim(e->>12), ''), nullif(btrim(e->>13), ''), nullif(btrim(e->>14), ''), nullif(btrim(e->>15), ''),
         (e->>16)::numeric, nullif(e->>17, '')::numeric
  from json_array_elements(p_rows) e;
  get diagnostics v_n = row_count;

  select count(*) into v_bad from _po_pkg
  where tanggal_order is null or tanggal_order < v_from or tanggal_order > v_to
     or coalesce(order_qty, 0) < 0 or coalesce(delivery_qty, 0) < 0
     or coalesce(distributor, '') = '' or coalesce(order_no, '') = '' or coalesce(tipe_produk, '') = ''
     or coalesce(status_order, '') = '' or coalesce(kode_customer, '') = '' or coalesce(tipe_pesanan, '') = '';
  if v_bad > 0 then raise exception '% baris tidak valid (tanggal order di luar rentang / kolom wajib kosong / qty negatif)', v_bad using errcode = '22023'; end if;

  insert into sementrack.sellin_po_staging select * from _po_pkg;
  update sementrack.sellin_po_upload set rows_staged = rows_staged + v_n where id = p_upload;
  return v_n;
end $$;

create or replace function sementrack.sellin_po_commit(p_upload bigint)
returns table(rows_saved integer, rows_replaced integer, ton_outstanding numeric, date_from date, date_to date, posisi date)
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_from date; v_to date; v_saved integer; v_replaced integer; v_ton numeric; v_posisi date;
begin
  select u.date_from, u.date_to into v_from, v_to from sementrack.sellin_po_upload u where u.id = p_upload and u.status = 'proses' for update;
  if not found then raise exception 'upload % tidak ditemukan atau sudah selesai', p_upload using errcode = '22023'; end if;
  if not exists (select 1 from sementrack.sellin_po_staging s where s.upload_id = p_upload
                 and sementrack.sellin_rule(s.tipe_pesanan, s.distributor, s.asal_pengiriman, s.tipe_produk)) then
    raise exception 'tidak ada baris yang lolos aturan sell in (Gudang / PM toko-project dari ITP-Palembang, tanpa mortar)' using errcode = '22023';
  end if;

  lock table sementrack.sellin_po in share row exclusive mode;

  select greatest(max(s.tanggal_kirim), max(s.tanggal_order)) into v_posisi
  from sementrack.sellin_po_staging s where s.upload_id = p_upload;

  delete from sementrack.sellin_po p where p.tanggal_order between v_from and v_to;
  get diagnostics v_replaced = row_count;

  insert into sementrack.sellin_po as p (upload_id, distributor, order_no, tipe_produk, tanggal_order, estimasi_kirim, kirim_terakhir,
    status_order, alasan_reject, kode_customer, nama_customer, tipe_pesanan, asal_pengiriman, kode_tujuan, nama_tujuan, kota_tujuan,
    loco_franco, order_qty, delivery_qty, pengiriman)
  select p_upload, s.distributor, s.order_no, s.tipe_produk, min(s.tanggal_order), max(s.estimasi_kirim), max(s.tanggal_kirim),
    -- order yang dikirim bertahap: status terlengkap menang (Delivered > Partially Delivered > lainnya)
    (array_agg(s.status_order order by case lower(s.status_order) when 'delivered' then 0 when 'partially delivered' then 1 else 2 end))[1],
    max(s.alasan_reject), max(s.kode_customer), max(s.nama_customer), max(s.tipe_pesanan), max(s.asal_pengiriman),
    max(s.kode_tujuan), max(s.nama_tujuan), max(s.kota_tujuan), max(s.loco_franco),
    coalesce(max(s.order_qty), 0), coalesce(sum(s.delivery_qty), 0), count(*) filter (where coalesce(s.delivery_qty, 0) > 0)
  from sementrack.sellin_po_staging s
  where s.upload_id = p_upload and sementrack.sellin_rule(s.tipe_pesanan, s.distributor, s.asal_pengiriman, s.tipe_produk)
  group by s.distributor, s.order_no, s.tipe_produk
  -- order yang tanggal ordernya di luar rentang lama tetapi muncul lagi: data file ini yang dipakai
  on conflict (distributor, order_no, tipe_produk) do update set
    upload_id = excluded.upload_id, tanggal_order = excluded.tanggal_order, estimasi_kirim = excluded.estimasi_kirim,
    kirim_terakhir = excluded.kirim_terakhir, status_order = excluded.status_order, alasan_reject = excluded.alasan_reject,
    kode_customer = excluded.kode_customer, nama_customer = excluded.nama_customer, tipe_pesanan = excluded.tipe_pesanan,
    asal_pengiriman = excluded.asal_pengiriman, kode_tujuan = excluded.kode_tujuan, nama_tujuan = excluded.nama_tujuan,
    kota_tujuan = excluded.kota_tujuan, loco_franco = excluded.loco_franco, order_qty = excluded.order_qty,
    delivery_qty = excluded.delivery_qty, pengiriman = excluded.pengiriman;
  get diagnostics v_saved = row_count;

  delete from sementrack.sellin_po_staging s where s.upload_id = p_upload;
  update sementrack.sellin_po_upload u
     set status = 'selesai', finished_at = now(), rows_saved = v_saved, rows_replaced = v_replaced, posisi = v_posisi
   where u.id = p_upload;

  select coalesce(sum(o.sisa_ton), 0) into v_ton from sementrack.v_outstanding_do o where o.upload_id = p_upload and o.status in ('Belum dikirim', 'Terkirim sebagian');
  return query select v_saved, v_replaced, round(v_ton, 1), v_from, v_to, v_posisi;
end $$;

create or replace function sementrack.sellin_po_abort(p_upload bigint)
returns void
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
begin
  delete from sementrack.sellin_po_staging where upload_id = p_upload;
  update sementrack.sellin_po_upload set status = 'batal', finished_at = now() where id = p_upload and status = 'proses';
end $$;

/** Order lama yang akan diganti upload dengan rentang tanggal order ini (pratinjau sebelum simpan). */
create or replace function sementrack.sellin_po_impact(p_from date, p_to date)
returns table(rows_existing bigint, first_date date, last_date date, posisi date)
language sql stable security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
  select count(*), min(p.tanggal_order), max(p.tanggal_order), max(u.posisi)
  from sementrack.sellin_po p join sementrack.sellin_po_upload u on u.id = p.upload_id
  where p.tanggal_order between p_from and p_to
$$;

-- ---------------------------------------------------------------------
-- 3. View
-- ---------------------------------------------------------------------
/** Nama distributor tanpa nomor & badan usaha: "6984 - BANGUN MITRA MAKMUR, PT" -> "Bangun Mitra Makmur". */
create or replace function sementrack.sellin_dist_nama(p text) returns text
language sql immutable parallel safe as $$
  select initcap(btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''), '^\s*\d+\s*-\s*', ''),
    '(^|[\s,.])(PT|UD|FA|CV)\.?(?=$|[\s,.])', ' ', 'gi'), '[\s,.]+$|^[\s,.]+', '', 'g')))
$$;

/** Jalur pengiriman dari Asal Pengiriman: FAS Kapal (Sunda Kelapa, Marunda), FAS Container (CCY, Tanjung Priok),
    Terminal (ITP-... Terminal), Pabrik (ITP-Citeureup). */
create or replace function sementrack.sellin_jalur(p_asal text) returns text
language sql immutable parallel safe as $$
  select case
    when coalesce(p_asal, '') ~* '(SUNDA KELAPA|MARUNDA)' then 'FAS Kapal'
    when coalesce(p_asal, '') ~* '(CONTAINER|CCY|PRIOK)' then 'FAS Container'
    when coalesce(p_asal, '') ~* 'TERMINAL' then 'Terminal'
    when coalesce(p_asal, '') ~* 'CITEUREUP' then 'Pabrik'
    else 'Lainnya' end
$$;

-- Satu baris per order yang masih punya sisa (outstanding & belum diverifikasi).
-- View ringkas bergantung pada view ini: dibuat ulang di bawah.
drop view if exists sementrack.v_outstanding_do_ringkas;
drop view if exists sementrack.v_outstanding_do;
create view sementrack.v_outstanding_do as
select p.upload_id,
       sementrack.sellin_region(m.region, p.tipe_pesanan, p.distributor) as region,
       p.distributor,
       sementrack.sellin_dist_nama(p.distributor) as dist_nama,
       p.order_no,
       p.tipe_produk as produk,
       case when p.tipe_produk ~* 'RAJAWALI' then 'RJW' when p.tipe_produk ~* 'WHITE' then 'CWC' else 'STR' end as semen,
       case lower(p.status_order) when 'verified' then 'Belum dikirim' when 'partially delivered' then 'Terkirim sebagian' else 'Belum diverifikasi' end as status,
       p.tanggal_order, p.estimasi_kirim, p.kirim_terakhir, u.posisi,
       (u.posisi - p.tanggal_order) as umur_hari,
       case when p.estimasi_kirim is not null and p.estimasi_kirim < u.posisi then u.posisi - p.estimasi_kirim else 0 end as lewat_hari,
       p.kode_customer, p.nama_customer, p.kode_tujuan, p.nama_tujuan, p.asal_pengiriman,
       sementrack.sellin_jalur(p.asal_pengiriman) as jalur,
       initcap(lower(p.tipe_pesanan)) as tipe_pesanan,
       coalesce(nullif(initcap(lower(p.loco_franco)), ''), 'Tidak diisi') as loco_franco,
       p.order_qty, p.delivery_qty,
       greatest(p.order_qty - p.delivery_qty, 0) as sisa_zak,
       round(greatest(p.order_qty - p.delivery_qty, 0) * sementrack.sellin_kg(p.tipe_produk) / 1000, 3) as sisa_ton,
       round(p.order_qty * sementrack.sellin_kg(p.tipe_produk) / 1000, 3) as order_ton
from sementrack.sellin_po p
join sementrack.sellin_po_upload u on u.id = p.upload_id
left join sementrack.sellin_region_map m on m.kode_customer = p.kode_customer
where lower(p.status_order) in ('verified', 'partially delivered', 'not verified')
  and p.order_qty > p.delivery_qty
  and not sementrack.sellin_is_mortar(p.tipe_produk);

-- Ringkasan kecil untuk halaman (dibaca utuh lalu diolah di browser)
create view sementrack.v_outstanding_do_ringkas as
select region, distributor, dist_nama, semen, status, jalur, tanggal_order, estimasi_kirim, posisi,
       count(*)::int as orders, round(sum(sisa_ton), 3) as ton
from sementrack.v_outstanding_do
group by 1, 2, 3, 4, 5, 6, 7, 8, 9;

-- Order per bulan tanggal order (semua status kecuali reject): masuk, terkirim, sisa
drop view if exists sementrack.v_sellin_po_bulanan;
create view sementrack.v_sellin_po_bulanan as
select extract(year from p.tanggal_order)::int as tahun, extract(month from p.tanggal_order)::int as bulan,
       sementrack.sellin_region(m.region, p.tipe_pesanan, p.distributor) as region,
       p.distributor,
       case when p.tipe_produk ~* 'RAJAWALI' then 'RJW' when p.tipe_produk ~* 'WHITE' then 'CWC' else 'STR' end as semen,
       round(sum(p.order_qty * sementrack.sellin_kg(p.tipe_produk) / 1000) filter (where lower(p.status_order) <> 'reject'), 3) as order_ton,
       round(sum(least(p.delivery_qty, p.order_qty) * sementrack.sellin_kg(p.tipe_produk) / 1000) filter (where lower(p.status_order) <> 'reject'), 3) as terkirim_ton,
       round(sum(greatest(p.order_qty - p.delivery_qty, 0) * sementrack.sellin_kg(p.tipe_produk) / 1000)
             filter (where lower(p.status_order) in ('verified', 'partially delivered')), 3) as outstanding_ton,
       round(sum(greatest(p.order_qty - p.delivery_qty, 0) * sementrack.sellin_kg(p.tipe_produk) / 1000)
             filter (where lower(p.status_order) = 'not verified'), 3) as belum_verifikasi_ton,
       round(sum(p.order_qty * sementrack.sellin_kg(p.tipe_produk) / 1000) filter (where lower(p.status_order) = 'reject'), 3) as reject_ton
from sementrack.sellin_po p
left join sementrack.sellin_region_map m on m.kode_customer = p.kode_customer
where not sementrack.sellin_is_mortar(p.tipe_produk)
group by 1, 2, 3, 4, 5;

create or replace view sementrack.v_outstanding_do_info as
select (select max(u.posisi) from sementrack.sellin_po_upload u where u.status = 'selesai'
          and exists (select 1 from sementrack.sellin_po p where p.upload_id = u.id)) as posisi,
       (select min(u.posisi) from sementrack.sellin_po_upload u where u.status = 'selesai'
          and exists (select 1 from sementrack.sellin_po p where p.upload_id = u.id)) as posisi_terlama,
       (select min(tanggal_order) from sementrack.sellin_po) as order_mulai,
       (select max(tanggal_order) from sementrack.sellin_po) as order_sampai,
       (select count(*)::int from sementrack.sellin_po) as total_order,
       u.created_at as upload_terakhir, u.created_by as upload_oleh
from (select 1) x
left join lateral (select created_at, created_by from sementrack.sellin_po_upload where status = 'selesai' order by id desc limit 1) u on true;

-- ---------------------------------------------------------------------
-- 4. Riwayat Kelola Data & status data: tambah Outstanding DO
-- ---------------------------------------------------------------------
alter table sementrack.kelola_log drop constraint if exists kelola_log_dataset_check;
alter table sementrack.kelola_log add constraint kelola_log_dataset_check
  check (dataset in ('transaksi', 'sellin', 'dofas', 'erp', 'j073', 'target', 'outstanding'));

-- Riwayat gabungan Kelola Data (salinan kelola_data.sql + upload Outstanding DO)
create or replace view sementrack.v_kelola_riwayat as
select 'sellin'::text as dataset, 'upload'::text as aksi, u.created_at, u.created_by, u.source, u.file_name, u.date_from, u.date_to,
       null::text[] as dist_codes, u.rows_read, u.rows_saved, u.rows_replaced as rows_deleted, u.status
from sementrack.sellin_bnn_upload u
union all
select l.dataset, l.aksi, l.created_at, l.created_by, l.source, l.file_name, l.date_from, l.date_to,
       l.dist_codes, l.rows_read, l.rows_saved, l.rows_deleted, l.status
from sementrack.kelola_log l
union all
select 'outstanding', 'upload', u.created_at, u.created_by, u.source, u.file_name, u.date_from, u.date_to,
       null::text[], u.rows_read, u.rows_saved, u.rows_replaced, u.status
from sementrack.sellin_po_upload u;

-- Salinan v_data_status dari sell_out_bnn.sql + baris 'outstanding' di akhir
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
po_up as (select u.created_at, u.created_by, u.posisi from sementrack.sellin_po_upload u where u.status = 'selesai' order by u.id desc limit 1)
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
select 'j073', 'J073 (INSA, PKB)', 'harian',
       (select max(do_date) from sementrack.sellout_j073),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from j073_up),
       (select 'Upload oleh ' || created_by from j073_up)
union all
select 'outstanding', 'Outstanding DO', 'harian',
       (select posisi from po_up),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from po_up),
       (select 'Upload oleh ' || created_by from po_up);

-- ---------------------------------------------------------------------
-- 5. Hak halaman baru untuk role yang sudah diatur manual:
--    Overview (rangkuman) ikut akses halaman lama "beranda"; Outstanding DO ikut akses Sell In BNN.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('auth_local.role_pages') is not null then
    insert into auth_local.role_pages (role, page_id, can_view_detail, can_download)
    select r.role, x.baru, r.can_view_detail, r.can_download
    from auth_local.role_pages r
    join (values ('beranda', 'overview'), ('sell-in-bnn', 'outstanding-do')) as x(lama, baru) on x.lama = r.page_id
    where not exists (select 1 from auth_local.role_pages t where t.role = r.role and t.page_id = x.baru);
  end if;
end $$;

grant select on sementrack.v_outstanding_do, sementrack.v_outstanding_do_ringkas, sementrack.v_sellin_po_bulanan,
  sementrack.v_outstanding_do_info, sementrack.v_data_status to public;

commit;
