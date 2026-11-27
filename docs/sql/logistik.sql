-- ============================================================================
-- logistik.sql · Rekap logistik distributor, sumber kedua halaman Ongkos Kirim (PostgreSQL; kembaran docs/mssql/22_logistik.sql)
-- Tabel logistik_kirim + logistik_simpan, v_logistik_foad, dan view Ongkos Kirim (v_ongkos_baris, v_ongkos_trip, v_ongkos_do,
-- v_ongkos_info) yang memakai biaya rekap kalau ORDB019 0 / tidak ada.
-- Jalankan setelah ongkos_kirim.sql, harga_loco.sql, ongkos_insight.sql. Jalankan lagi kalau salah satunya dijalankan ulang.
-- ============================================================================
begin;

create table if not exists sementrack.logistik_kirim (
  id bigserial primary key,
  dist_code text not null, daerah text, foad text not null, periode date not null, tgl date not null,
  som_type text, jalur text not null, do_no text, do_date date, est_kirim date, sj_no text, kirim_date date,
  salesman text, status_sj text, cust_code text, cust_name text, product_code text, product_name text,
  qty numeric not null, ton numeric not null, transporter text, zona_kode text, zona text, plat text,
  gudang_asal text, gudang_tujuan text, harga_perzak numeric, jml_harga numeric, terima_toko date, terima_planner date, dalam_luar text
);
alter table sementrack.logistik_kirim add column if not exists tipe_truk text, add column if not exists truk_max_ton numeric,
  add column if not exists berat_ton numeric, add column if not exists pa text, add column if not exists ritase_cost numeric, add column if not exists payment_date date;
create index if not exists logistik_kirim_foad_idx on sementrack.logistik_kirim (dist_code, foad);
create index if not exists logistik_kirim_tgl_idx on sementrack.logistik_kirim (dist_code, tgl);
create index if not exists ongkos_kirim_foad_idx on sementrack.ongkos_kirim (dist_code, foad);

alter table sementrack.kelola_log drop constraint if exists kelola_log_dataset_check;
alter table sementrack.kelola_log add constraint kelola_log_dataset_check
  check (dataset in ('transaksi', 'sellin', 'dofas', 'erp', 'j073', 'target', 'outstanding', 'tabel', 'stock', 'ongkos', 'harga', 'logistik', 'promo'));

-- Baris: [daerah, foad, som_type, tgl, do_no, do_date, est_kirim, sj_no, kirim_date, salesman, status_sj, cust_code, cust_name,
--         product_code, product_name, qty, transporter, zona_kode, zona, plat, gudang_asal, gudang_tujuan, harga_perzak, jml_harga,
--         terima_toko, terima_planner, dalam_luar]
drop function if exists sementrack.logistik_simpan(json, text, text);
drop function if exists sementrack.logistik_simpan(json, text, text, text);
create function sementrack.logistik_simpan(p_rows json, p_user text, p_file text default null, p_mode text default 'rekap')
returns table(rows_saved integer, rows_deleted integer, ton numeric, biaya numeric, date_from date, date_to date, dist_codes text[],
              foad integer, foad_tanpa_ordb integer, foad_isi_biaya integer)
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare v_old integer; v_old2 integer; v_new integer; v_x text; v_b integer;
begin
  if json_typeof(p_rows) <> 'array' or json_array_length(p_rows) = 0 then raise exception 'Tidak ada baris rekap logistik' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('logistik_kirim'));
  create temp table _r on commit drop as
  select r.ord::int as baris, upper(btrim(r.v ->> 0)) as daerah, btrim(r.v ->> 1) as foad, nullif(upper(btrim(r.v ->> 2)), '') as som_type,
         nullif(r.v ->> 3, '')::date as tgl, nullif(btrim(r.v ->> 4), '') as do_no, nullif(r.v ->> 5, '')::date as do_date,
         nullif(r.v ->> 6, '')::date as est_kirim, nullif(btrim(r.v ->> 7), '') as sj_no, nullif(r.v ->> 8, '')::date as kirim_date,
         nullif(btrim(r.v ->> 9), '') as salesman, nullif(upper(btrim(r.v ->> 10)), '') as status_sj, nullif(btrim(r.v ->> 11), '') as cust_code,
         nullif(btrim(r.v ->> 12), '') as cust_name, nullif(upper(btrim(r.v ->> 13)), '') as product_code, nullif(btrim(r.v ->> 14), '') as product_name,
         nullif(r.v ->> 15, '')::numeric as qty, nullif(btrim(r.v ->> 16), '') as transporter, nullif(upper(btrim(r.v ->> 17)), '') as zona_kode,
         nullif(upper(btrim(r.v ->> 18)), '') as zona, nullif(upper(btrim(r.v ->> 19)), '') as plat, nullif(upper(btrim(r.v ->> 20)), '') as gudang_asal,
         nullif(upper(btrim(r.v ->> 21)), '') as gudang_tujuan, nullif(r.v ->> 22, '')::numeric as harga_perzak, nullif(r.v ->> 23, '')::numeric as jml_harga,
         nullif(r.v ->> 24, '')::date as terima_toko, nullif(r.v ->> 25, '')::date as terima_planner, nullif(upper(btrim(r.v ->> 26)), '') as dalam_luar,
         nullif(upper(btrim(r.v ->> 27)), '') as tipe_truk, nullif(r.v ->> 28, '')::numeric as truk_max_ton, nullif(r.v ->> 29, '')::numeric as berat_ton,
         nullif(upper(btrim(r.v ->> 30)), '') as pa, nullif(r.v ->> 31, '')::numeric as ritase_cost, nullif(r.v ->> 32, '')::date as payment_date
  from json_array_elements(p_rows) with ordinality as r(v, ord);
  select min(baris) into v_b from _r where coalesce(daerah, '') = '' or coalesce(foad, '') = '' or tgl is null or qty is null;
  if v_b is not null then
    raise exception 'Baris rekap logistik tidak lengkap (baris %): Daerah, FOAD No., tanggal, dan Jumlah wajib', v_b using errcode = '22023';
  end if;
  if exists (select 1 from _r where tgl < date '2026-01-01') then
    raise exception 'Ongkos kirim dilacak mulai Januari 2026, baris rekap sebelum itu tidak disimpan' using errcode = '22023';
  end if;
  create temp table _d on commit drop as
  select x.daerah, coalesce((select d.kode_erp from public.distributor d where upper(d.dist_code) = x.daerah and coalesce(d.kode_erp, '') <> '' order by d.dist_code limit 1),
                            (select d.kode_erp from public.distributor d where upper(d.kode_erp) = x.daerah order by d.dist_code limit 1),
                            (select j.dist_code from sementrack.sellout_j073_dist j where upper(j.dist_code) = x.daerah limit 1)) as dist_code
  from (select distinct daerah from _r) x;
  select string_agg(daerah, ', ' order by daerah) into v_x from _d where dist_code is null;
  if v_x is not null then raise exception 'Daerah belum punya kode ERP di master distributor: %', v_x using errcode = '22023'; end if;

  create temp table _l on commit drop as
  select r.*, d.dist_code,
         case when r.som_type like 'GUDANG%-%TOKO%' then 'gudang_toko' when r.som_type like 'PELABUHAN%-%TOKO%' then 'pelabuhan_toko'
              when r.som_type like 'GUDANG%-%GUDANG%' then 'gudang_gudang' when r.som_type like 'PABRIK%-%GUDANG%' then 'pabrik_gudang'
              when r.som_type like 'PABRIK%-%TOKO%' then 'pabrik_toko' else 'lain' end as jalur,
         case when public.calc_tonase(r.product_code, 1) > 0
                or exists (select 1 from sementrack.ongkos_kirim o where o.product_code = r.product_code and o.kategori in ('SEMEN', 'WHITE CEMENT'))
              then coalesce(sementrack.j073_ton(r.product_code, r.product_name, r.qty), 0) else 0 end as ton
  from _r r join _d d on d.daerah = r.daerah;
  create temp table _lk on commit drop as
  select dist_code, foad, coalesce(do_no, '') as do_no, coalesce(product_code, '') as product_code, sum(qty) as qty from _l group by 1, 2, 3, 4;
  -- data lama FOAD di file: isian yang kosong di file baru diambil dari sini
  create temp table _lama on commit drop as
  select k.dist_code, k.foad, coalesce(k.do_no, '') as do_no, coalesce(k.product_code, '') as product_code,
         max(k.harga_perzak) as harga_perzak, sum(k.jml_harga) as jml_harga, max(k.tipe_truk) as tipe_truk, max(k.truk_max_ton) as truk_max_ton,
         sum(k.berat_ton) as berat_ton, max(k.pa) as pa, max(k.ritase_cost) as ritase_cost, max(k.payment_date) as payment_date,
         max(k.est_kirim) as est_kirim, max(k.terima_toko) as terima_toko, max(k.terima_planner) as terima_planner, max(k.dalam_luar) as dalam_luar
  from sementrack.logistik_kirim k
  where exists (select 1 from _lk x where x.dist_code = k.dist_code and x.foad = k.foad)
  group by 1, 2, 3, 4;

  v_old := 0;
  if p_mode <> 'j082' then
    with x as (delete from sementrack.logistik_kirim k using (select dist_code, min(tgl) a, max(tgl) b from _l group by dist_code) r
               where k.dist_code = r.dist_code and k.tgl between r.a and r.b returning 1)
    select count(*) into v_old from x;
  end if;
  -- (J082 per bulan Order Date: satu FOAD bisa memuat DO dari dua bulan, jadi yang diganti hanya FOAD + DO yang ada di file)
  with x as (delete from sementrack.logistik_kirim k
             where exists (select 1 from _lk x where x.dist_code = k.dist_code and x.foad = k.foad and (p_mode <> 'j082' or x.do_no = coalesce(k.do_no, '')))
             returning 1)
  select count(*) into v_old2 from x;
  insert into sementrack.logistik_kirim (dist_code, daerah, foad, periode, tgl, som_type, jalur, do_no, do_date, est_kirim, sj_no, kirim_date, salesman, status_sj,
                                         cust_code, cust_name, product_code, product_name, qty, ton, transporter, zona_kode, zona, plat, gudang_asal, gudang_tujuan,
                                         harga_perzak, jml_harga, terima_toko, terima_planner, dalam_luar,
                                         tipe_truk, truk_max_ton, berat_ton, pa, ritase_cost, payment_date)
  select l.dist_code, l.daerah, l.foad, date_trunc('month', f.a)::date, l.tgl, l.som_type, l.jalur, l.do_no, l.do_date,
         coalesce(l.est_kirim, o.est_kirim), l.sj_no, l.kirim_date,
         l.salesman, l.status_sj, l.cust_code, l.cust_name, l.product_code, l.product_name, l.qty, l.ton, l.transporter, l.zona_kode, l.zona, l.plat,
         l.gudang_asal, l.gudang_tujuan, coalesce(l.harga_perzak, o.harga_perzak), coalesce(l.jml_harga, o.jml_harga * l.qty / nullif(x.qty, 0)),
         coalesce(l.terima_toko, o.terima_toko), coalesce(l.terima_planner, o.terima_planner), coalesce(l.dalam_luar, o.dalam_luar),
         coalesce(l.tipe_truk, o.tipe_truk), coalesce(l.truk_max_ton, o.truk_max_ton), coalesce(l.berat_ton, o.berat_ton * l.qty / nullif(x.qty, 0)),
         coalesce(l.pa, o.pa), coalesce(l.ritase_cost, o.ritase_cost), coalesce(l.payment_date, o.payment_date)
  from _l l join (select dist_code, foad, min(tgl) a from _l group by dist_code, foad) f on f.dist_code = l.dist_code and f.foad = l.foad
  join _lk x on x.dist_code = l.dist_code and x.foad = l.foad and x.do_no = coalesce(l.do_no, '') and x.product_code = coalesce(l.product_code, '')
  left join _lama o on o.dist_code = l.dist_code and o.foad = l.foad and o.do_no = coalesce(l.do_no, '') and o.product_code = coalesce(l.product_code, '');
  get diagnostics v_new = row_count;

  insert into sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes, rows_read, rows_saved, rows_deleted, status, finished_at)
  select 'logistik', 'upload', p_user, 'file', p_file, min(tgl), max(tgl), array_agg(distinct dist_code order by dist_code), v_new, v_new, v_old + v_old2, 'selesai', now() from _l;

  return query
  select v_new, v_old + v_old2, coalesce(sum(l.ton), 0), coalesce(sum(coalesce(l.jml_harga, 0)), 0), min(l.tgl), max(l.tgl), array_agg(distinct l.dist_code order by l.dist_code),
         (select count(distinct (x.dist_code, x.foad))::int from _l x),
         (select count(*)::int from (select dist_code, foad from _l group by dist_code, foad having sum(ton) > 0) f
           where not exists (select 1 from sementrack.ongkos_kirim o where o.dist_code = f.dist_code and o.foad = f.foad)),
         (select count(*)::int from (select dist_code, foad from _l group by dist_code, foad having sum(ton) > 0 and sum(coalesce(jml_harga, 0)) > 0) f
           where exists (select 1 from sementrack.ongkos_kirim o where o.dist_code = f.dist_code and o.foad = f.foad)
             and not exists (select 1 from sementrack.ongkos_kirim o where o.dist_code = f.dist_code and o.foad = f.foad and o.total <> 0))
  from _l l;
end $$;

-- view efektivitas.sql bergantung pada view di bawah: ikut dihapus, jalankan efektivitas.sql lagi sesudah file ini
drop view if exists sementrack.v_ongkos_zona;
drop view if exists sementrack.v_isi_truk;
drop view if exists sementrack.v_ongkos_info;
drop view if exists sementrack.v_ongkos_do;
drop view if exists sementrack.v_ongkos_trip;
drop view if exists sementrack.v_ongkos_baris;
drop view if exists sementrack.v_logistik_foad;

create view sementrack.v_logistik_foad as
select l.dist_code, l.foad, min(l.periode) as periode, min(l.tgl) as tgl, max(l.jalur) as jalur,
       sum(l.ton) as ton, count(distinct l.do_no)::int as jumlah_do,
       case when coalesce(sum(l.jml_harga) filter (where l.ton > 0), 0) > 0 then sum(l.jml_harga) filter (where l.ton > 0)
            else coalesce(sum(l.jml_harga), 0) end as biaya,
       max(l.transporter) as transporter, max(l.plat) as plat, max(l.gudang_asal) as gudang_asal, max(l.gudang_tujuan) as gudang_tujuan,
       max(l.zona) as zona, max(l.dalam_luar) as dalam_luar,
       sum(l.ton) filter (where l.ton > 0 and l.do_date is not null and l.kirim_date is not null) as ton_waktu,
       sum(l.ton * (l.kirim_date - l.do_date)) filter (where l.ton > 0 and l.do_date is not null and l.kirim_date is not null)
         / nullif(sum(l.ton) filter (where l.ton > 0 and l.do_date is not null and l.kirim_date is not null), 0) as hari_kirim,
       sum(l.ton) filter (where l.ton > 0 and l.est_kirim is not null and l.kirim_date is not null) as ton_est,
       coalesce(sum(l.ton) filter (where l.ton > 0 and l.est_kirim is not null and l.kirim_date > l.est_kirim), 0) as ton_telat,
       max(l.terima_planner) - min(l.kirim_date) as hari_sj,
       max(l.tipe_truk) as tipe_truk, max(l.truk_max_ton) as truk_max_ton, sum(l.berat_ton) as berat_ton,
       sum(l.berat_ton) / nullif(max(l.truk_max_ton), 0) as isi_truk, max(l.ritase_cost) as ritase_cost, max(l.payment_date) as payment_date
from sementrack.logistik_kirim l
group by l.dist_code, l.foad;

create or replace view sementrack.v_ongkos_dist as
select x.dist_code, coalesce(d.dist_code, x.dist_code) as kode, coalesce(d.dist_name, x.dist_code) as nama
from (select dist_code from sementrack.ongkos_kirim union select dist_code from sementrack.logistik_kirim) x
left join lateral (select d.dist_code, d.dist_name from public.distributor d where d.kode_erp = x.dist_code order by d.dist_code limit 1) d on true;

create view sementrack.v_ongkos_baris as
select 'erp'::text as sumber_baris, k.dist_code, k.periode, k.kirim_date, k.do_no, k.foad, k.segmen, k.transporter, k.truk, k.asal, k.tujuan, k.zona,
       k.harga_ritase, k.total, k.ton
from sementrack.ongkos_kirim k
union all
select 'logistik', l.dist_code, l.periode, coalesce(l.kirim_date, l.tgl),
       case when l.jalur in ('gudang_gudang', 'pabrik_gudang') or coalesce(l.do_no, '') = '' then '-' else l.do_no end,
       l.foad, null, l.transporter, null, l.gudang_asal, coalesce(l.zona, l.gudang_tujuan), l.zona, null, coalesce(l.jml_harga, 0), l.ton
from sementrack.logistik_kirim l
where not exists (select 1 from sementrack.ongkos_kirim k where k.dist_code = l.dist_code and k.foad = l.foad);

create view sementrack.v_ongkos_trip as
select t.dist_code, t.periode, t.foad, t.kirim_date, t.transporter, t.truk, t.asal, t.zona, t.tujuan, t.segmen, t.harga_ritase, t.ton, t.jumlah_do,
       t.ke_gudang, t.transporter_kode,
       case when t.dari_erp and t.biaya_baris > 0 then t.biaya_baris when lf.biaya > 0 then lf.biaya else 0 end as biaya,
       case when t.dari_erp and t.biaya_baris > 0 then 'erp' when lf.biaya > 0 then 'logistik' end as sumber_biaya,
       case when t.dari_erp then t.biaya_baris end as biaya_erp, lf.biaya as biaya_logistik, t.dari_erp,
       coalesce(ot.status,
         case when t.transporter ilike '%LINTAS ABADI MAKMUR%' then 'armada_sendiri'
              when t.transporter ~* 'EKS\.?\s*TOKO' then 'truk_toko' else 'normal' end) as status_transporter,
       lf.jalur, lf.dalam_luar, lf.gudang_asal as gudang_asal_rekap, lf.ton_waktu, lf.hari_kirim, lf.ton_est, lf.ton_telat, lf.hari_sj,
       lf.tipe_truk, lf.truk_max_ton, lf.berat_ton, lf.isi_truk
from (
  select k.dist_code, k.periode, k.foad, min(k.kirim_date) as kirim_date,
         max(k.transporter) as transporter, max(k.truk) as truk, max(k.asal) as asal, max(k.zona) as zona, max(k.tujuan) as tujuan,
         max(k.segmen) as segmen, max(k.harga_ritase) as harga_ritase, sum(k.total) as biaya_baris, sum(k.ton) as ton,
         count(distinct k.do_no)::int as jumlah_do,
         bool_and(coalesce(btrim(k.do_no), '') in ('-', '')) as ke_gudang,
         split_part(max(k.transporter), ' - ', 1) as transporter_kode,
         bool_or(k.sumber_baris = 'erp') as dari_erp
  from sementrack.v_ongkos_baris k
  group by k.dist_code, k.periode, k.foad
) t
left join sementrack.ongkos_transporter ot on ot.kode = t.transporter_kode
left join sementrack.v_logistik_foad lf on lf.dist_code = t.dist_code and lf.foad = t.foad;

create view sementrack.v_ongkos_do as
select k.dist_code, k.periode, k.do_no, k.biaya, k.biaya_logistik, k.ton_kirim, k.trip, k.trip_tanpa_biaya, k.trip_luar_erp, k.trip_truk_toko, k.truk, k.transporter, k.zona, k.segmen, k.tujuan,
       k.jalur,
       j.do_date, j.customer_code, j.customer_name, j.delivery_type,
       split_part(j.delivery_type, ' ', 1) as tipe_kirim,
       j.zona_kirim, j.kecamatan, j.kabupaten, j.ton_do,
       case when j.ton_do > 0 then j.net * k.ton_kirim / j.ton_do end as omzet,
       case when j.ton_do > 0 and j.delivery_type is not null then
         (case when j.ada_rincian then j.tagih_rincian when split_part(j.delivery_type, ' ', 1) = 'LG' or j.tipe_loco then 0
               when j.baris_tanpa_tarif = 0 then j.tagih_tarif
               when j.tagih_harga is not null then j.tagih_harga end) * k.ton_kirim / j.ton_do end as tagih,
       case when j.delivery_type is null then null when j.ada_rincian then 'rincian' when split_part(j.delivery_type, ' ', 1) = 'LG' or j.tipe_loco then 'lg'
            when j.baris_tanpa_tarif = 0 then 'tarif' when j.tagih_harga is not null then 'harga' else 'kosong' end as tagih_sumber,
       case when j.ton_do > 0 and j.delivery_type is not null then j.handling * k.ton_kirim / j.ton_do end as handling,
       case when j.ton_do > 0 and j.delivery_type is not null then j.tagih_harga * k.ton_kirim / j.ton_do end as tagih_dari_harga,
       case when j.ton_do > 0 and j.delivery_type is not null and j.baris_tanpa_tarif = 0 then j.tagih_tarif * k.ton_kirim / j.ton_do end as tagih_dari_tarif,
       case when j.ton_do > 0 and j.delivery_type is not null and j.baris_tanpa_tarif = 0 then j.subsidi_tarif * k.ton_kirim / j.ton_do end as subsidi,
       case when j.ton_loco > 0 then j.nilai_loco / j.ton_loco end as loco_per_ton,
       case when j.ton_harga > 0 then j.nilai_harga / j.ton_harga end as harga_per_ton
from (
  select o.dist_code, o.periode, o.do_no,
         sum(case when f.sumber_biaya = 'logistik' then case when f.ton > 0 then f.biaya * o.ton / f.ton else 0 end else o.total end) as biaya,
         sum(f.biaya * o.ton / f.ton) filter (where f.sumber_biaya = 'logistik' and f.ton > 0) as biaya_logistik,
         sum(o.ton) as ton_kirim, count(distinct o.foad)::int as trip,
         count(distinct case when f.biaya = 0 and f.status_transporter <> 'truk_toko' then o.foad end)::int as trip_tanpa_biaya,
         count(distinct case when f.biaya = 0 and f.status_transporter = 'armada_sendiri' then o.foad end)::int as trip_luar_erp,
         count(distinct case when f.status_transporter = 'truk_toko' then o.foad end)::int as trip_truk_toko,
         max(o.truk) as truk, max(o.transporter) as transporter, max(o.zona) as zona, max(o.segmen) as segmen, max(o.tujuan) as tujuan, max(f.jalur) as jalur
  from sementrack.v_ongkos_baris o
  join sementrack.v_ongkos_trip f on f.dist_code = o.dist_code and f.periode = o.periode and f.foad = o.foad
  where o.ton > 0 and coalesce(btrim(o.do_no), '') not in ('-', '')
  group by o.dist_code, o.periode, o.do_no
) k
left join lateral (
  select min(s.do_date) as do_date, max(s.customer_code) as customer_code, max(s.customer_name) as customer_name,
         max(s.delivery_type) as delivery_type, max(s.zona_kirim) as zona_kirim, max(s.kecamatan) as kecamatan, max(s.kabupaten) as kabupaten,
         sum(sementrack.j073_ton(s.product_code, s.product_name, s.order_qty)) as ton_do, sum(s.net_amount) as net,
         bool_or(coalesce(s.harga_kirim, 0) <> 0 or coalesce(s.diskon_kirim, 0) <> 0 or coalesce(s.tambah_kirim, 0) <> 0) as ada_rincian,
         sum((coalesce(s.harga_kirim, 0) - coalesce(s.diskon_kirim, 0) + coalesce(s.tambah_kirim, 0) + coalesce(s.handling, 0)) * s.order_qty) as tagih_rincian,
         sum(greatest(s.harga_produk - hl.loco, 0) * s.order_qty) filter (where s.harga_produk is not null and hl.loco is not null) as tagih_harga,
         sum(coalesce(s.handling, 0) * s.order_qty) as handling,
         sum(tk.ongkir * s.order_qty) as tagih_tarif,
         sum(tk.subsidi * s.order_qty) as subsidi_tarif,
         count(*) filter (where tk.ongkir is null) as baris_tanpa_tarif,
         coalesce(bool_or(tm.delivery_type like 'LOCO%'), false) as tipe_loco,
         sum(hl.loco * s.order_qty) filter (where hl.loco is not null) as nilai_loco,
         sum(sementrack.j073_ton(s.product_code, s.product_name, s.order_qty)) filter (where hl.loco is not null) as ton_loco,
         sum(s.harga_produk * s.order_qty) filter (where s.harga_produk is not null) as nilai_harga,
         sum(sementrack.j073_ton(s.product_code, s.product_name, s.order_qty)) filter (where s.harga_produk is not null) as ton_harga
  from sementrack.sellout_j073 s
  left join lateral (select coalesce(h.price, h.net_price) as loco from sementrack.harga_loco h
                     where h.dist_code = s.dist_code and h.product_code = s.product_code
                       and s.do_date >= h.berlaku_dari and (h.berlaku_sampai is null or s.do_date <= h.berlaku_sampai)
                       and (h.warehouse = coalesce(s.warehouse, '')
                            or (h.warehouse <> '' and coalesce(s.warehouse, '') like '%' || h.warehouse || '%')
                            or (coalesce(s.warehouse, '') <> '' and h.warehouse like '%' || s.warehouse || '%')
                            or not exists (select 1 from sementrack.harga_loco h2
                                           where h2.dist_code = h.dist_code and h2.product_code = h.product_code and h2.warehouse <> h.warehouse
                                             and s.do_date >= h2.berlaku_dari and (h2.berlaku_sampai is null or s.do_date <= h2.berlaku_sampai)))
                     order by (h.warehouse = coalesce(s.warehouse, '')) desc, h.berlaku_dari desc limit 1) hl on true
  left join lateral (select m.delivery_type from sementrack.harga_tipe_map m
                     where m.kode = upper(split_part(btrim(s.delivery_type), ' ', 1)) limit 1) tm on true
  left join lateral (select hk.ongkir, coalesce(hk.subsidi, 0) + coalesce(hk.subsidi2, 0) as subsidi from sementrack.harga_kirim hk
                     where tm.delivery_type not like 'LOCO%' and hk.dist_code = s.dist_code and hk.product_code = s.product_code
                       and hk.delivery_type = tm.delivery_type and hk.zone = upper(btrim(coalesce(s.zona_kirim, '')))
                       and s.do_date >= hk.berlaku_dari and (hk.berlaku_sampai is null or s.do_date <= hk.berlaku_sampai)
                       and (hk.warehouse = coalesce(s.warehouse, '')
                            or (hk.warehouse <> '' and coalesce(s.warehouse, '') like '%' || hk.warehouse || '%')
                            or (coalesce(s.warehouse, '') <> '' and hk.warehouse like '%' || s.warehouse || '%')
                            or not exists (select 1 from sementrack.harga_kirim k2
                                           where k2.dist_code = hk.dist_code and k2.product_code = hk.product_code and k2.delivery_type = hk.delivery_type
                                             and k2.zone = hk.zone and k2.warehouse <> hk.warehouse
                                             and s.do_date >= k2.berlaku_dari and (k2.berlaku_sampai is null or s.do_date <= k2.berlaku_sampai)))
                     order by (hk.warehouse = coalesce(s.warehouse, '')) desc, hk.berlaku_dari desc limit 1) tk on true
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
       coalesce(sum(t.ton) filter (where not t.ke_gudang and t.sumber_biaya = 'logistik'), 0) as ton_biaya_rekap,
       coalesce(sum(t.ton) filter (where not t.ke_gudang and t.jalur is not null), 0) as ton_rekap,
       coalesce(sum(t.ton) filter (where not t.ke_gudang and not t.dari_erp), 0) as ton_tanpa_ordb,
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

grant select on sementrack.v_logistik_foad, sementrack.v_ongkos_baris, sementrack.v_ongkos_trip, sementrack.v_ongkos_do, sementrack.v_ongkos_info to public;

commit;
