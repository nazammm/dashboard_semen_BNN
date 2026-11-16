-- =====================================================================
-- Stock Semen: stok per tanggal, daerah (gudang), dan produk dari file "Stock Semen <BULAN> <TAHUN>.xlsx"
-- (satu file per bulan, satu sheet per tanggal). Jalankan di web_semen SETELAH outstanding_do.sql dan
-- kelola_tabel.sql, sebagai pemilik tabel. Aman dijalankan ulang.
--
--   sementrack.stock_daerah  : daerah (baris DAERAH di file) -> region web. Bisa diedit di Kelola Data -> Tabel.
--   sementrack.stock_semen   : zak dan ton per tanggal x daerah x produk. Disimpan per tanggal: upload
--                              mengganti seluruh isi tanggal yang ada di file, tanggal lain tetap.
--   v_stock_semen / v_stock_harian / v_stock_info : dibaca halaman Stock dan Overview.
-- =====================================================================
begin;

create table if not exists sementrack.stock_daerah (
  daerah  text primary key,
  region  text not null,
  urutan  int
);

-- Isi awal (urutan = urutan baris di file stok)
insert into sementrack.stock_daerah (daerah, region, urutan) values
  ('NC SELAT PANJANG', 'Riau', 1),
  ('NC TJ BALAI KARIMUN 01', 'Riau Island', 2),
  ('NC TJ BALAI KARIMUN 02', 'Riau Island', 3),
  ('BANGKA', 'Babel', 4),
  ('BATAM', 'Riau Island', 5),
  ('BENGKULU', 'Bengkulu', 6),
  ('BMM CILEGON', 'Lampung', 7),
  ('BMM TARAHAN', 'Lampung', 8),
  ('BMM WAYLUNIK', 'Lampung', 9),
  ('JAMBI', 'Jambi', 10),
  ('JAMBI - BUNGO', 'Jambi', 11),
  ('JAMBI - MUARA SABAK', 'Jambi', 12),
  ('KETAPANG', 'West Kal', 13),
  ('MEDAN KOTA BANGUN', 'North Sum', 14),
  ('MEDAN KIM 2', 'North Sum', 15),
  ('MEDAN KIM 2 (2)', 'North Sum', 16),
  ('MEDAN KIM 3', 'North Sum', 17),
  ('MEDAN KIM 3 (3)', 'North Sum', 18),
  ('PADANG', 'West Sum', 19),
  ('PEKANBARU', 'Riau', 20),
  ('PEKANBARU - DUMAI', 'Riau', 21),
  ('PEKANBARU - BENGKALIS', 'Riau', 22),
  ('PM BATURAJA', 'South Sum', 23),
  ('PM GD. GANDUS', 'South Sum', 24),
  ('PM GD. PERINTIS', 'South Sum', 25),
  ('PM SUKAJAYA', 'South Sum', 26),
  ('PTK BUMI RAYA', 'West Kal', 27),
  ('PTK WAJOK', 'West Kal', 28)
on conflict (daerah) do nothing;

create table if not exists sementrack.stock_semen (
  tanggal  date    not null,
  daerah   text    not null,
  produk   text    not null,                 -- dari judul kolom file, mis. 'PCC 50', 'TR 30', 'RAJAWALI 40'
  jenis    text    not null check (jenis in ('STR', 'RJW', 'CWC')),
  kg       numeric not null check (kg > 0),   -- kg per zak
  zak      numeric not null,
  ton      numeric not null,
  primary key (tanggal, daerah, produk)
);
create index if not exists stock_semen_tanggal on sementrack.stock_semen (tanggal);

alter table sementrack.kelola_log drop constraint if exists kelola_log_dataset_check;
alter table sementrack.kelola_log add constraint kelola_log_dataset_check
  check (dataset in ('transaksi', 'sellin', 'dofas', 'erp', 'j073', 'target', 'outstanding', 'tabel', 'stock'));

-- ---------------------------------------------------------------------
-- Simpan upload: p_rows = [[tanggal, daerah, produk, jenis, kg, zak], ...]. Tanggal yang ada di p_rows diganti seluruhnya.
-- ---------------------------------------------------------------------
create or replace function sementrack.stock_simpan(p_rows json, p_user text, p_file text default null)
returns table(rows_saved integer, rows_deleted integer, tanggal_dari date, tanggal_sampai date, jumlah_tanggal integer, ton_terakhir numeric)
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_old integer; v_new integer; v_dari date; v_sampai date; v_n integer; v_ton numeric;
begin
  if json_typeof(p_rows) <> 'array' or json_array_length(p_rows) = 0 then raise exception 'Tidak ada baris stok' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('stock_semen'));

  drop table if exists _stock;
  create temp table _stock on commit drop as
  select (r.val ->> 0)::date as tanggal, btrim(r.val ->> 1) as daerah, upper(btrim(r.val ->> 2)) as produk,
         upper(btrim(r.val ->> 3)) as jenis, (r.val ->> 4)::numeric as kg, coalesce((r.val ->> 5)::numeric, 0) as zak
  from json_array_elements(p_rows) as r(val);

  if exists (select 1 from _stock where tanggal is null or coalesce(daerah, '') = '' or coalesce(produk, '') = '') then
    raise exception 'Tanggal, daerah, dan produk wajib diisi' using errcode = '22023';
  end if;
  if exists (select 1 from _stock where jenis not in ('STR', 'RJW', 'CWC')) then raise exception 'Jenis harus STR, RJW, atau CWC' using errcode = '22023'; end if;
  if exists (select 1 from _stock where kg is null or kg <= 0) then raise exception 'Kg per zak tidak valid' using errcode = '22023'; end if;
  if exists (select 1 from _stock where tanggal > (now() at time zone 'Asia/Jakarta')::date) then
    raise exception 'Ada tanggal stok setelah hari ini' using errcode = '22023';
  end if;
  if exists (select 1 from _stock group by tanggal, upper(daerah), produk having count(*) > 1) then
    raise exception 'Daerah % muncul lebih dari sekali di tanggal yang sama',
      (select daerah from _stock group by tanggal, upper(daerah), daerah, produk having count(*) > 1 limit 1) using errcode = '22023';
  end if;

  with d as (delete from sementrack.stock_semen s where s.tanggal in (select distinct tanggal from _stock) returning 1)
  select count(*) into v_old from d;
  insert into sementrack.stock_semen (tanggal, daerah, produk, jenis, kg, zak, ton)
  select tanggal, daerah, produk, jenis, kg, zak, round(zak * kg / 1000.0, 3) from _stock;
  get diagnostics v_new = row_count;

  select min(tanggal), max(tanggal), count(distinct tanggal) into v_dari, v_sampai, v_n from _stock;
  select coalesce(sum(round(zak * kg / 1000.0, 3)), 0) into v_ton from _stock where tanggal = v_sampai;

  insert into sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, rows_read, rows_saved, rows_deleted, status, finished_at)
  values ('stock', 'upload', p_user, 'upload', p_file, v_dari, v_sampai, v_new, v_new, v_old, 'selesai', now());
  return query select v_new, v_old, v_dari, v_sampai, v_n, v_ton;
end $$;

-- ---------------------------------------------------------------------
-- Baca
-- ---------------------------------------------------------------------
create or replace view sementrack.v_stock_semen as
select s.tanggal, coalesce(d.region, 'Tanpa region') as region, s.daerah, s.produk, s.jenis, s.kg, s.zak, s.ton,
       coalesce(d.urutan, 999) as urutan
from sementrack.stock_semen s
left join sementrack.stock_daerah d on upper(btrim(d.daerah)) = upper(btrim(s.daerah));

create or replace view sementrack.v_stock_harian as
select tanggal, region, jenis, sum(zak) as zak, sum(ton) as ton
from sementrack.v_stock_semen
group by tanggal, region, jenis;

create or replace view sementrack.v_stock_info as
select max(tanggal) as tanggal_terakhir, min(tanggal) as tanggal_awal, count(distinct tanggal)::int as jumlah_tanggal,
       (select count(*)::int from sementrack.stock_semen s
        where s.tanggal = (select max(tanggal) from sementrack.stock_semen)
          and not exists (select 1 from sementrack.stock_daerah d where upper(btrim(d.daerah)) = upper(btrim(s.daerah)))) as tanpa_region
from sementrack.stock_semen;

-- ---------------------------------------------------------------------
-- Status data (salinan v_data_status dari outstanding_do.sql + baris 'stock' di akhir)
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
erp_up as (select l.created_at, l.created_by, l.date_from from sementrack.kelola_log l where l.dataset = 'erp' and l.status = 'selesai' order by l.id desc limit 1),
j073_up as (select l.created_at, l.created_by from sementrack.kelola_log l where l.dataset = 'j073' and l.status = 'selesai' order by l.id desc limit 1),
po_up as (select u.created_at, u.created_by, u.posisi from sementrack.sellin_po_upload u where u.status = 'selesai' order by u.id desc limit 1),
stock_up as (select l.created_at, l.created_by from sementrack.kelola_log l where l.dataset = 'stock' and l.status = 'selesai' order by l.id desc limit 1)
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
       (select 'Upload oleh ' || created_by from po_up)
union all
select 'stock', 'Stock semen', 'harian',
       (select max(tanggal) from sementrack.stock_semen),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from stock_up),
       (select 'Upload oleh ' || created_by from stock_up);

-- ---------------------------------------------------------------------
-- Kelola Data -> Tabel: mapping daerah stok -> region
-- ---------------------------------------------------------------------
insert into sementrack.tabel_edit (id, urutan, grup, label, keterangan, objek, pk, kolom, filter, urut) values
('stock_daerah', 75, 'Master', 'Daerah stok',
 'Daerah/gudang di file Stock Semen dan region-nya (halaman Stock). Daerah baru di file harus ditambahkan di sini.',
 'sementrack.stock_daerah', '{daerah}',
 '[{"name":"daerah","label":"Daerah","tipe":"text","wajib":true},{"name":"region","label":"Region","tipe":"text","wajib":true},{"name":"urutan","label":"Urutan","tipe":"int"}]',
 '{region}', 'region, urutan, daerah')
on conflict (id) do update set urutan = excluded.urutan, grup = excluded.grup, label = excluded.label, keterangan = excluded.keterangan,
  objek = excluded.objek, pk = excluded.pk, kolom = excluded.kolom, filter = excluded.filter, urut = excluded.urut;

-- Halaman Stock ikut akses Sell Out BNN untuk role yang hak halamannya diatur manual
do $$
begin
  if to_regclass('auth_local.role_pages') is not null then
    insert into auth_local.role_pages (role, page_id, can_view_detail, can_download)
    select r.role, 'stock', r.can_view_detail, r.can_download
    from auth_local.role_pages r
    where r.page_id = 'sell-out-bnn'
      and not exists (select 1 from auth_local.role_pages t where t.role = r.role and t.page_id = 'stock');
  end if;
end $$;

grant select on sementrack.stock_daerah, sementrack.v_stock_semen, sementrack.v_stock_harian, sementrack.v_stock_info,
  sementrack.v_data_status to public;

commit;

-- Cek:
-- select * from sementrack.v_stock_info;
-- select tanggal, region, sum(ton) from sementrack.v_stock_harian group by 1, 2 order by 1 desc, 2;
