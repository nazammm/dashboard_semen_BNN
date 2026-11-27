-- efektivitas.sql · Efektivitas Ongkos & Promo (PostgreSQL; kembaran docs/mssql/25_efektivitas.sql). Jalankan setelah logistik.sql.
begin;
create table if not exists sementrack.promo_do (
  id bigserial primary key, dist_code text not null, do_no text not null, do_date date not null, segmen text, cust_code text, cust_name text,
  cust_tiro text, product_code text, product_name text, baris_ke integer, jenis text not null, promo_type text, promo text,
  qty numeric, harga numeric, diskon numeric, nilai numeric, promo_amount numeric, net_amount numeric, ton numeric not null
);
create index if not exists promo_do_dist_tgl_idx on sementrack.promo_do (dist_code, do_date);

alter table sementrack.kelola_log drop constraint if exists kelola_log_dataset_check;
alter table sementrack.kelola_log add constraint kelola_log_dataset_check
  check (dataset in ('transaksi', 'sellin', 'dofas', 'erp', 'j073', 'target', 'outstanding', 'tabel', 'stock', 'ongkos', 'harga', 'logistik', 'promo'));

drop function if exists sementrack.promo_simpan(json, text, text);
create function sementrack.promo_simpan(p_rows json, p_user text, p_file text default null)
returns table(rows_saved integer, rows_deleted integer, date_from date, date_to date, dist_codes text[], jumlah_do integer, biaya numeric, ton numeric)
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare v_old integer; v_new integer; v_b integer;
begin
  if json_typeof(p_rows) <> 'array' or json_array_length(p_rows) = 0 then raise exception 'Tidak ada baris J078' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('promo_do'));
  create temp table _r on commit drop as
  select r.ord::int as baris, upper(btrim(r.v ->> 0)) as dist_code, btrim(r.v ->> 1) as do_no, nullif(r.v ->> 2, '')::date as do_date,
         nullif(upper(btrim(r.v ->> 3)), '') as segmen, nullif(btrim(r.v ->> 4), '') as cust_code, nullif(btrim(r.v ->> 5), '') as cust_name,
         nullif(btrim(r.v ->> 6), '') as cust_tiro, nullif(upper(btrim(r.v ->> 7)), '') as product_code, nullif(btrim(r.v ->> 8), '') as product_name,
         nullif(r.v ->> 9, '')::int as baris_ke, lower(btrim(r.v ->> 10)) as jenis, nullif(upper(btrim(r.v ->> 11)), '') as promo_type,
         nullif(btrim(r.v ->> 12), '') as promo, nullif(r.v ->> 13, '')::numeric as qty, nullif(r.v ->> 14, '')::numeric as harga,
         nullif(r.v ->> 15, '')::numeric as diskon, nullif(r.v ->> 16, '')::numeric as nilai, nullif(r.v ->> 17, '')::numeric as promo_amount,
         nullif(r.v ->> 18, '')::numeric as net_amount
  from json_array_elements(p_rows) with ordinality as r(v, ord);
  select min(baris) into v_b from _r where coalesce(dist_code, '') = '' or coalesce(do_no, '') = '' or do_date is null
                                        or jenis not in ('produk', 'potongan', 'voucher', 'pakai_voucher');
  if v_b is not null then raise exception 'Baris J078 tidak lengkap (baris %): distributor, No. DO, tanggal DO, dan jenis wajib', v_b using errcode = '22023'; end if;
  if exists (select 1 from _r where do_date < date '2026-01-01') then
    raise exception 'Promo dilacak mulai Januari 2026, baris sebelum itu tidak disimpan' using errcode = '22023';
  end if;
  create temp table _l on commit drop as
  select r.*, case when r.product_code is not null and (public.calc_tonase(r.product_code, 1) > 0
                     or exists (select 1 from sementrack.ongkos_kirim o where o.product_code = r.product_code and o.kategori in ('SEMEN', 'WHITE CEMENT')))
                   then coalesce(sementrack.j073_ton(r.product_code, r.product_name, coalesce(r.qty, 0)), 0) else 0 end as ton
  from _r r;
  with x as (delete from sementrack.promo_do p using (select dist_code, min(do_date) a, max(do_date) b from _l group by dist_code) r
             where p.dist_code = r.dist_code and p.do_date between r.a and r.b returning 1)
  select count(*) into v_old from x;
  insert into sementrack.promo_do (dist_code, do_no, do_date, segmen, cust_code, cust_name, cust_tiro, product_code, product_name, baris_ke, jenis, promo_type, promo,
                                   qty, harga, diskon, nilai, promo_amount, net_amount, ton)
  select dist_code, do_no, do_date, segmen, cust_code, cust_name, cust_tiro, product_code, product_name, baris_ke, jenis, promo_type, promo,
         qty, harga, diskon, nilai, promo_amount, net_amount, ton from _l;
  get diagnostics v_new = row_count;
  insert into sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes, rows_read, rows_saved, rows_deleted, status, finished_at)
  select 'promo', 'upload', p_user, 'file', p_file, min(do_date), max(do_date), array_agg(distinct dist_code order by dist_code), v_new, v_new, v_old, 'selesai', now() from _l;
  return query
  select v_new, v_old, min(l.do_date), max(l.do_date), array_agg(distinct l.dist_code order by l.dist_code), count(distinct l.do_no)::int,
         sum(l.nilai) filter (where l.jenis in ('potongan', 'voucher')), sum(l.ton) filter (where l.jenis = 'produk')
  from _l l;
end $$;

drop view if exists sementrack.v_promo_bulanan;
create view sementrack.v_promo_bulanan as
select p.dist_code, date_trunc('month', p.do_date)::date as periode, coalesce(p.segmen, 'RETAIL') as segmen, (p.ton > 0) as semen, p.jenis,
       case when p.jenis = 'produk' then '' when p.jenis = 'pakai_voucher' then 'Pemakaian voucher' else coalesce(p.promo, '(tanpa nama)') end as promo,
       max(p.promo_type) as promo_type, count(distinct p.do_no)::int as jumlah_do, count(distinct p.cust_code)::int as toko,
       sum(p.ton) as ton, sum(coalesce(p.nilai, 0)) as nilai, sum(coalesce(p.net_amount, 0)) as net
from sementrack.promo_do p
group by 1, 2, 3, 4, 5, 6;

drop view if exists sementrack.v_promo_efek;
create view sementrack.v_promo_efek as
with tp as (
  select p.dist_code, p.cust_code, date_trunc('month', p.do_date)::date as periode, p.jenis, coalesce(p.promo, '(tanpa nama)') as promo,
         sum(coalesce(p.nilai, 0)) as biaya, sum(p.ton) as ton_promo
  from sementrack.promo_do p
  where p.jenis in ('potongan', 'voucher') and p.ton > 0 and p.cust_code is not null
  group by 1, 2, 3, 4, 5
), rentang as (
  select dist_code, date_trunc('month', min(do_date))::date as a, max(do_date) as b from sementrack.promo_do group by dist_code
), tb as (
  select s.dist_code, s.customer_code as cust_code, date_trunc('month', s.do_date)::date as periode,
         sum(sementrack.j073_ton(s.product_code, s.product_name, s.order_qty)) as ton
  from sementrack.sellout_j073 s join rentang r on r.dist_code = s.dist_code and s.do_date between r.a and r.b
  group by 1, 2, 3
), x as (
  select k.dist_code, k.jenis, k.promo, b.cust_code, b.periode, b.ton, case when t.cust_code is not null then 1 else 0 end as saat
  from (select distinct dist_code, jenis, promo, cust_code from tp) k
  join tb b on b.dist_code = k.dist_code and b.cust_code = k.cust_code
  left join tp t on t.dist_code = k.dist_code and t.jenis = k.jenis and t.promo = k.promo and t.cust_code = b.cust_code and t.periode = b.periode
)
select a.dist_code, a.jenis, a.promo, a.toko, a.dari, a.sampai, a.biaya, a.ton_promo, e.toko_dibanding, e.bulan_saat, e.bulan_tanpa, e.ton_saat, e.ton_tanpa
from (select dist_code, jenis, promo, count(distinct cust_code)::int as toko, min(periode) as dari, max(periode) as sampai,
             sum(biaya) as biaya, sum(ton_promo) as ton_promo
      from tp group by 1, 2, 3) a
left join (
  select y.dist_code, y.jenis, y.promo, count(distinct y.cust_code)::int as toko_dibanding,
         sum(y.saat)::int as bulan_saat, sum(1 - y.saat)::int as bulan_tanpa,
         avg(y.ton) filter (where y.saat = 1) as ton_saat, avg(y.ton) filter (where y.saat = 0) as ton_tanpa
  from (select x.*, sum(x.saat) over (partition by x.dist_code, x.jenis, x.promo, x.cust_code) as n_saat,
               count(*) over (partition by x.dist_code, x.jenis, x.promo, x.cust_code) as n
        from x) y
  where y.n_saat > 0 and y.n_saat < y.n
  group by 1, 2, 3
) e on e.dist_code = a.dist_code and e.jenis = a.jenis and e.promo = a.promo;

drop view if exists sementrack.v_ongkos_zona;
create view sementrack.v_ongkos_zona as
select o.dist_code, o.periode, coalesce(nullif(o.zona_kirim, ''), o.zona, '(tanpa zona)') as zona, coalesce(o.tipe_kirim, '') as tipe_kirim,
       coalesce(o.jalur, '') as jalur, count(*)::int as jumlah_do, sum(o.ton_kirim) as ton,
       coalesce(sum(o.ton_kirim) filter (where o.trip_tanpa_biaya = 0), 0) as ton_lengkap,
       coalesce(sum(o.biaya) filter (where o.trip_tanpa_biaya = 0), 0) as biaya_lengkap,
       coalesce(sum(o.ton_kirim) filter (where o.tagih is not null), 0) as ton_tagih, sum(o.tagih) as tagih,
       coalesce(sum(o.ton_kirim) filter (where o.trip_tanpa_biaya = 0 and o.tagih is not null), 0) as ton_margin,
       coalesce(sum(o.tagih - o.biaya) filter (where o.trip_tanpa_biaya = 0 and o.tagih is not null), 0) as margin,
       coalesce(sum(o.ton_kirim) filter (where o.subsidi is not null), 0) as ton_subsidi, sum(o.subsidi) as subsidi
from sementrack.v_ongkos_do o
group by 1, 2, 3, 4, 5;

drop view if exists sementrack.v_isi_truk;
create view sementrack.v_isi_truk as
select t.dist_code, t.periode, coalesce(t.jalur, '') as jalur, coalesce(t.tipe_truk, '(tanpa tipe)') as tipe_truk, coalesce(t.transporter, '') as transporter,
       t.status_transporter,
       case when t.isi_truk < 0.5 then 'a_lt50' when t.isi_truk < 0.8 then 'b_50_80' when t.isi_truk < 0.95 then 'c_80_95'
            when t.isi_truk <= 1.05 then 'd_penuh' else 'e_lebih' end as kelompok,
       count(*)::int as trip, sum(t.ton) as ton, sum(t.berat_ton) as berat, sum(t.truk_max_ton) as kapasitas,
       count(*) filter (where t.biaya > 0)::int as trip_berbiaya, coalesce(sum(t.ton) filter (where t.biaya > 0), 0) as ton_berbiaya,
       coalesce(sum(t.biaya) filter (where t.biaya > 0), 0) as biaya
from sementrack.v_ongkos_trip t
where not t.ke_gudang and t.ton > 0 and t.isi_truk is not null and t.truk_max_ton > 0
group by 1, 2, 3, 4, 5, 6, 7;

-- status data + harga / logistik / promo (salinan ongkos_kirim.sql)
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
harga_up as (select l.created_at, l.created_by from sementrack.kelola_log l where l.dataset = 'harga' and l.status = 'selesai' order by l.id desc limit 1),
logistik_up as (select l.created_at, l.created_by from sementrack.kelola_log l where l.dataset = 'logistik' and l.status = 'selesai' order by l.id desc limit 1),
promo_up as (select l.created_at, l.created_by from sementrack.kelola_log l where l.dataset = 'promo' and l.status = 'selesai' order by l.id desc limit 1),
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
       (select 'Upload oleh ' || created_by from ongkos_up)
union all
select 'harga', 'Harga produk ERP (ORDB050/088)', 'mingguan',
       greatest((select max(diambil) from sementrack.harga_loco), (select max(diambil) from sementrack.harga_kirim)),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from harga_up),
       (select 'Upload oleh ' || created_by from harga_up)
union all
select 'logistik', 'Pengiriman & truk (J082 / rekap logistik)', 'mingguan',
       (select max(kirim_date) from sementrack.logistik_kirim),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from logistik_up),
       (select 'Upload oleh ' || created_by from logistik_up)
union all
select 'promo', 'Promo DO (J078)', 'mingguan',
       (select max(do_date) from sementrack.promo_do),
       (select to_char(created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI') from promo_up),
       (select 'Upload oleh ' || created_by from promo_up);

grant select on sementrack.v_data_status to public;
grant select on sementrack.v_promo_bulanan, sementrack.v_promo_efek, sementrack.v_ongkos_zona, sementrack.v_isi_truk to public;
commit;
