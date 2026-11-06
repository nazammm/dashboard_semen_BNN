-- =====================================================================
-- Target per tahun: satu tabel untuk semua target (dan realisasi pembanding dari sheet bulanan),
-- supaya tahun 2027 dst. cukup ditempel lewat Kelola Data → Target, tanpa membuat kolom/tabel baru.
--
--   jenis      : sell_in      (Sell In BNN, per region + sub region + tipe)
--                sell_out     (Sell Out BNN, per region + distributor sheet + tipe)
--                distributor  (Overview & Rekap Harian, per kode distributor)
--                salesman     (Tim Sales, per kode distributor + kode salesman)
--   metrik     : target_ton, realisasi_ton, target_ta, realisasi_ta
--   realisasi_*: angka closing dari sheet bulanan (pembanding tahun lalu), bukan data harian.
--
-- Tabel lama (public.cement_targets, public.delivery, public."Target Dist", public.salesman_status_target)
-- TIDAK diubah dan tidak dihapus (laporan PPT masih memakainya). Isinya disalin sekali ke tabel baru
-- (hanya kalau jenis itu masih kosong). "Target Dist" dan salesman_status_target tidak punya kolom tahun:
-- disalin sebagai tahun 2026.
--
-- Jalankan SETELAH toko_aktif_subdist.sql, sebagai pemilik tabel (nazamudin). Aman dijalankan ulang.
-- =====================================================================
begin;

create table if not exists sementrack.target (
  jenis      text    not null check (jenis in ('sell_in', 'sell_out', 'distributor', 'salesman')),
  metrik     text    not null check (metrik in ('target_ton', 'realisasi_ton', 'target_ta', 'realisasi_ta')),
  tahun      integer not null check (tahun between 2000 and 2100),
  bulan      integer not null check (bulan between 1 and 12),
  region     text    not null default '',
  area       text    not null default '',   -- sell_in: sub region · sell_out: distributor di sheet · salesman: kode distributor
  tipe       text    not null default '',   -- STR / RJW / WC ('' = semua)
  kode       text    not null default '',   -- distributor: kode distributor · salesman: kode salesman
  nama       text,                          -- salesman: nama
  status     text,                          -- salesman: status bulan itu (mis. Sales Real)
  nilai      numeric not null,
  diperbarui timestamptz not null default now(),
  primary key (jenis, metrik, tahun, bulan, region, area, tipe, kode)
);
create index if not exists target_tahun_idx on sementrack.target (jenis, tahun);

-- log Kelola Data ikut mencatat target
alter table sementrack.kelola_log drop constraint if exists kelola_log_dataset_check;
alter table sementrack.kelola_log add constraint kelola_log_dataset_check
  check (dataset in ('transaksi', 'sellin', 'dofas', 'erp', 'j073', 'target'));

-- ---------------------------------------------------------------------
-- 1. Salin data lama sekali (kolom bertahun dicari otomatis: target_do_YYYY, do_YYYY, target_YYYY, "YYYY", ...)
-- ---------------------------------------------------------------------
create or replace function sementrack.bulan_dari_teks(p text) returns integer language sql immutable as $$
  select case lower(left(btrim(p), 3))
    when 'jan' then 1 when 'feb' then 2 when 'mar' then 3 when 'apr' then 4 when 'may' then 5 when 'mei' then 5
    when 'jun' then 6 when 'jul' then 7 when 'aug' then 8 when 'agu' then 8 when 'ags' then 8 when 'sep' then 9
    when 'oct' then 10 when 'okt' then 10 when 'nov' then 11 when 'dec' then 12 when 'des' then 12
    else case when btrim(p) ~ '^\d{1,2}$' then btrim(p)::int end end
$$;

do $$
declare c record; y int; m text;
begin
  -- Sell Out bulanan (public.cement_targets)
  if to_regclass('public.cement_targets') is not null
     and not exists (select 1 from sementrack.target where jenis = 'sell_out') then
    for c in select column_name from information_schema.columns
             where table_schema = 'public' and table_name = 'cement_targets'
               and column_name ~ '^(target_do|do|target_ta|ta_distinct)_\d{4}$' loop
      y := substring(c.column_name from '(\d{4})$')::int;
      m := case substring(c.column_name from '^(.*)_\d{4}$')
             when 'target_do' then 'target_ton' when 'do' then 'realisasi_ton'
             when 'target_ta' then 'target_ta' else 'realisasi_ta' end;
      execute format($f$
        insert into sementrack.target (jenis, metrik, tahun, bulan, region, area, tipe, nilai)
        select 'sell_out', %L, %s, sementrack.bulan_dari_teks(month), coalesce(btrim(region), ''), coalesce(btrim(distributor), ''),
               coalesce(upper(btrim(type_cement)), ''), sum(%I)
        from public.cement_targets
        where sementrack.bulan_dari_teks(month) is not null and %I is not null and %I <> 0
        group by 4, 5, 6, 7
        on conflict do nothing$f$, m, y, c.column_name, c.column_name, c.column_name);
    end loop;
  end if;

  -- Sell In bulanan (public.delivery): target_YYYY dan kolom "YYYY" (realisasi)
  if to_regclass('public.delivery') is not null
     and not exists (select 1 from sementrack.target where jenis = 'sell_in') then
    for c in select column_name from information_schema.columns
             where table_schema = 'public' and table_name = 'delivery'
               and column_name ~ '^(target_)?\d{4}$' loop
      y := substring(c.column_name from '(\d{4})$')::int;
      m := case when c.column_name like 'target_%' then 'target_ton' else 'realisasi_ton' end;
      execute format($f$
        insert into sementrack.target (jenis, metrik, tahun, bulan, region, area, tipe, nilai)
        select 'sell_in', %L, %s, sementrack.bulan_dari_teks(month), coalesce(btrim(region), ''), coalesce(btrim(sub_region), ''),
               coalesce(upper(btrim(type_cement)), ''), sum(%I)
        from public.delivery
        where sementrack.bulan_dari_teks(month) is not null and %I is not null and %I <> 0
        group by 4, 5, 6, 7
        on conflict do nothing$f$, m, y, c.column_name, c.column_name, c.column_name);
    end loop;
  end if;

  -- Target distributor (public."Target Dist"), tanpa kolom tahun -> 2026
  if to_regclass('public."Target Dist"') is not null
     and not exists (select 1 from sementrack.target where jenis = 'distributor') then
    insert into sementrack.target (jenis, metrik, tahun, bulan, kode, nilai)
    select 'distributor', 'target_ton', 2026, sementrack.bulan_dari_teks(month), btrim(dist_code), sum(target)
    from public."Target Dist" where sementrack.bulan_dari_teks(month) is not null and target is not null
    group by 4, 5 on conflict do nothing;
    insert into sementrack.target (jenis, metrik, tahun, bulan, kode, nilai)
    select 'distributor', 'target_ta', 2026, sementrack.bulan_dari_teks(month), btrim(dist_code), sum("Target TA")
    from public."Target Dist" where sementrack.bulan_dari_teks(month) is not null and "Target TA" is not null
    group by 4, 5 on conflict do nothing;
  end if;

  -- Target salesman (public.salesman_status_target), tanpa kolom tahun -> 2026
  if to_regclass('public.salesman_status_target') is not null
     and not exists (select 1 from sementrack.target where jenis = 'salesman') then
    insert into sementrack.target (jenis, metrik, tahun, bulan, area, kode, nama, status, nilai)
    select 'salesman', x.metrik, 2026, s."Month", btrim(s.dist_code), btrim(s.salesman_code),
           max(s.salesman_name), max(s.status), coalesce(sum(x.nilai), 0)
    from public.salesman_status_target s
    cross join lateral (values ('target_ta', s."Target TA"), ('target_ton', s."Target Tonase")) as x(metrik, nilai)
    where s."Month" between 1 and 12 and s.salesman_code is not null
    group by 2, 4, 5, 6 on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Simpan dari Kelola Data → Target.
--    p_rows = [[metrik, tahun, bulan, region, area, tipe, kode, nama, status, nilai], ...]
--    Yang diganti: setiap (metrik, tahun, bulan) yang ada di p_rows. Bulan/tahun/metrik lain tidak berubah.
-- ---------------------------------------------------------------------
create or replace function sementrack.target_simpan(p_jenis text, p_rows json, p_user text, p_file text default null)
returns table(rows_saved integer, rows_deleted integer, tahun_list integer[], metrik_list text[])
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare v_old integer; v_new integer; v_tahun integer[]; v_metrik text[]; v_from date; v_to date;
begin
  if p_jenis not in ('sell_in', 'sell_out', 'distributor', 'salesman') then
    raise exception 'Jenis target tidak dikenal: %', p_jenis using errcode = '22023';
  end if;
  if json_typeof(p_rows) <> 'array' or json_array_length(p_rows) = 0 then
    raise exception 'Tidak ada baris target' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('target'), hashtext(p_jenis));

  create temp table _t on commit drop as
  select btrim(r.val ->> 0) as metrik, (r.val ->> 1)::int as tahun, (r.val ->> 2)::int as bulan,
         coalesce(btrim(r.val ->> 3), '') as region, coalesce(btrim(r.val ->> 4), '') as area,
         coalesce(upper(btrim(r.val ->> 5)), '') as tipe, coalesce(btrim(r.val ->> 6), '') as kode,
         nullif(btrim(r.val ->> 7), '') as nama, nullif(btrim(r.val ->> 8), '') as status,
         (r.val ->> 9)::numeric as nilai
  from json_array_elements(p_rows) as r(val);

  if exists (select 1 from _t where metrik not in ('target_ton', 'realisasi_ton', 'target_ta', 'realisasi_ta')) then
    raise exception 'Metrik tidak dikenal' using errcode = '22023';
  end if;
  if exists (select 1 from _t where tahun is null or tahun not between 2000 and 2100) then
    raise exception 'Tahun tidak valid' using errcode = '22023';
  end if;
  if exists (select 1 from _t where bulan is null or bulan not between 1 and 12) then
    raise exception 'Bulan harus 1 sampai 12' using errcode = '22023';
  end if;
  if exists (select 1 from _t where nilai is null) then
    raise exception 'Ada angka target yang kosong' using errcode = '22023';
  end if;
  if p_jenis in ('distributor', 'salesman') and exists (select 1 from _t where kode = '') then
    raise exception 'Kode kosong' using errcode = '22023';
  end if;
  if p_jenis in ('sell_in', 'sell_out') and exists (select 1 from _t where region = '' or area = '') then
    raise exception 'Region / area kosong' using errcode = '22023';
  end if;
  if exists (select 1 from _t group by metrik, tahun, bulan, region, area, tipe, kode having count(*) > 1) then
    raise exception 'Ada baris dobel: % %', (select area || ' ' || kode from _t group by metrik, tahun, bulan, region, area, tipe, kode having count(*) > 1 limit 1),
      (select tahun || '-' || bulan from _t group by metrik, tahun, bulan, region, area, tipe, kode having count(*) > 1 limit 1) using errcode = '22023';
  end if;

  with d as (
    delete from sementrack.target t
    using (select distinct metrik, tahun, bulan from _t) k
    where t.jenis = p_jenis and t.metrik = k.metrik and t.tahun = k.tahun and t.bulan = k.bulan
    returning 1)
  select count(*) into v_old from d;

  insert into sementrack.target (jenis, metrik, tahun, bulan, region, area, tipe, kode, nama, status, nilai)
  select p_jenis, metrik, tahun, bulan, region, area, tipe, kode, nama, status, nilai from _t;
  get diagnostics v_new = row_count;

  select array_agg(distinct x.tahun order by x.tahun), array_agg(distinct x.metrik order by x.metrik),
         min(make_date(x.tahun, x.bulan, 1)), (max(make_date(x.tahun, x.bulan, 1)) + interval '1 month - 1 day')::date
    into v_tahun, v_metrik, v_from, v_to from _t x;

  insert into sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes,
                                     rows_read, rows_saved, rows_deleted, status, finished_at)
  values ('target', 'upload', p_user, case when p_file is null then 'tempel' else 'file' end, p_file, v_from, v_to,
          array[p_jenis], v_new, v_new, v_old, 'selesai', now());
  return query select v_new, v_old, v_tahun, v_metrik;
end $$;

-- ---------------------------------------------------------------------
-- 3. View per halaman (format panjang: satu baris per tahun x bulan, tanpa nama kolom bertahun)
-- ---------------------------------------------------------------------
create or replace view sementrack.v_target_sell_in as
select tahun, bulan, region, area as sub_region, tipe,
       sum(nilai) filter (where metrik = 'target_ton') as target,
       sum(nilai) filter (where metrik = 'realisasi_ton') as realisasi
from sementrack.target where jenis = 'sell_in'
group by tahun, bulan, region, area, tipe;

create or replace view sementrack.v_target_sell_out as
select tahun, bulan, region, area as distributor, tipe,
       sum(nilai) filter (where metrik = 'target_ton') as target_ton,
       sum(nilai) filter (where metrik = 'realisasi_ton') as realisasi_ton,
       sum(nilai) filter (where metrik = 'target_ta') as target_ta,
       sum(nilai) filter (where metrik = 'realisasi_ta') as realisasi_ta
from sementrack.target where jenis = 'sell_out'
group by tahun, bulan, region, area, tipe;

-- Pengganti public.v_target_dist (Overview, Rekap Harian) + kolom tahun & target TA
create or replace view sementrack.v_target_dist as
select tahun, kode as dist_code,
       (array['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[bulan] as month,
       bulan as month_num,
       sum(nilai) filter (where metrik = 'target_ton') as target,
       sum(nilai) filter (where metrik = 'target_ta') as target_ta
from sementrack.target where jenis = 'distributor'
group by tahun, kode, bulan;

-- Tim Sales: target per tahun dari tabel target, aktual dari transaksi tahun & bulan yang sama.
-- Transaksi ke subdist tidak dihitung ke salesman (lihat toko_aktif_subdist.sql).
-- Kolom sama dengan versi lama + kolom tahun di depan.
drop view if exists sementrack.v_salesman_performance;
create view sementrack.v_salesman_performance as
with t as (
  select tahun, bulan, area as dist_code, kode as salesman_code, max(nama) as salesman_name, max(status) as status,
         sum(nilai) filter (where metrik = 'target_ta') as target_ta,
         sum(nilai) filter (where metrik = 'target_ton') as target_tonase
  from sementrack.target where jenis = 'salesman'
  group by tahun, bulan, area, kode
),
tr as (
  select x.salesman_code, extract(year from x.do_date)::int as tahun, extract(month from x.do_date)::int as bulan,
         x.customer_code, x.do_no, x.net_amount, public.calc_tonase(x.product_code, x.order_qty) as ton
  from public.transaksi x
  where x.do_date >= make_date((select min(tahun) from t), 1, 1)
    and not exists (select 1 from sementrack.subdist_customer s
                    where s.dist_code = x.dist_code and s.customer_code = x.customer_code)
),
tot as (
  select salesman_code, tahun, bulan, sum(ton) as total_qty, sum(coalesce(net_amount, 0)) as net_amount, count(distinct do_no) as num_do
  from tr group by 1, 2, 3
),
act as (
  select salesman_code, tahun, bulan, count(*) as num_active_stores
  from (select salesman_code, tahun, bulan, customer_code from tr group by 1, 2, 3, 4
        having sum(coalesce(net_amount, 0)) >= 200000) c
  group by 1, 2, 3
)
select t.tahun, t.dist_code, t.salesman_code, t.salesman_name, t.bulan as month,
       coalesce(t.target_ta, 0) as target_ta, coalesce(t.target_tonase, 0) as target_tonase, t.status,
       coalesce(tot.total_qty, 0) as actual_tonase, coalesce(act.num_active_stores, 0) as actual_ta,
       coalesce(tot.num_do, 0) as actual_num_do, coalesce(tot.net_amount, 0) as actual_omzet
from t
left join tot on tot.salesman_code = t.salesman_code and tot.tahun = t.tahun and tot.bulan = t.bulan
left join act on act.salesman_code = t.salesman_code and act.tahun = t.tahun and act.bulan = t.bulan;

-- Nama salesman di detail transaksi: dari tabel target (nama terbaru per kode)
create or replace view sementrack.v_transaksi_detail as
 SELECT t.do_date,
    t.dist_code,
    t.distributor_name,
    t.customer_code,
    t.customer_name,
    t.parent_customer_code,
    t.parent_customer_name,
    t.product_code,
    t.product_name,
    t.order_qty,
    t.bonus_qty,
    public.calc_tonase(t.product_code, t.order_qty) AS tonase,
    t.do_no,
    t.mss_no_order,
    COALESCE(t.net_amount, 0::numeric) AS net_amount,
    t.salesman_code,
    sm.salesman_name,
    t.payment,
    EXISTS (SELECT 1 FROM sementrack.subdist_customer s
            WHERE s.dist_code = t.dist_code AND s.customer_code = t.customer_code) AS is_subdist
   FROM public.transaksi t
     LEFT JOIN ( SELECT g.kode AS salesman_code,
            (array_agg(g.nama ORDER BY g.tahun DESC, g.bulan DESC))[1] AS salesman_name
           FROM sementrack.target g
          WHERE g.jenis = 'salesman' AND g.nama IS NOT NULL
          GROUP BY g.kode) sm ON sm.salesman_code = t.salesman_code;

-- Ringkasan untuk Kelola Data: tahun & bulan yang sudah terisi per jenis x metrik
create or replace view sementrack.v_target_ringkas as
select jenis, metrik, tahun, array_agg(distinct bulan order by bulan) as bulan, count(*) as baris, sum(nilai) as total,
       max(diperbarui) as diperbarui
from sementrack.target group by jenis, metrik, tahun;

grant select on sementrack.target, sementrack.v_target_sell_in, sementrack.v_target_sell_out, sementrack.v_target_dist,
  sementrack.v_salesman_performance, sementrack.v_transaksi_detail, sementrack.v_target_ringkas to public;

commit;
