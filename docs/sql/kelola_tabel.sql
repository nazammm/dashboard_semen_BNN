-- =====================================================================
-- Kelola Data → Tabel: edit langsung tabel master kecil dari web (seperti table editor Supabase).
-- Hanya tabel yang terdaftar di sementrack.tabel_edit yang bisa dibuka; data besar (transaksi, sell in,
-- outstanding) tidak didaftarkan. Tabel target ditampilkan per jenis dalam bentuk lebar
-- (satu baris = tahun x bulan x kunci, kolom target/realisasi berdampingan) lewat view + trigger.
--
-- Menambah tabel baru cukup insert satu baris ke sementrack.tabel_edit (lihat bagian 4).
-- Jalankan SETELAH target_tahunan.sql dan outstanding_do.sql, sebagai pemilik tabel. Aman dijalankan ulang.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Target per jenis dalam bentuk lebar (view yang bisa diedit)
-- ---------------------------------------------------------------------
/** Trigger INSTEAD OF untuk view target: tulis/hapus baris sementrack.target per metrik.
    TG_ARGV: 0 jenis, 1 kolom metrik (dipisah koma), 2..5 kolom view untuk region/area/tipe/kode ('-' = tidak ada),
             6..7 kolom view untuk nama/status ('-' = tidak ada). */
create or replace function sementrack.target_edit_trg() returns trigger
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare
  j text := TG_ARGV[0];
  ms text[] := string_to_array(TG_ARGV[1], ',');
  kc text[] := array[TG_ARGV[2], TG_ARGV[3], TG_ARGV[4], TG_ARGV[5]];
  kn text := TG_ARGV[6]; ks text := TG_ARGV[7];
  o jsonb; n jsonb; m text; k text[];
  v_tahun int; v_bulan int;
begin
  if TG_OP in ('UPDATE', 'DELETE') then
    o := to_jsonb(OLD);
    k := array(select coalesce(case when c = '-' then '' else o ->> c end, '') from unnest(kc) c);
    delete from sementrack.target t
     where t.jenis = j and t.metrik = any(ms) and t.tahun = (o ->> 'tahun')::int and t.bulan = (o ->> 'bulan')::int
       and t.region = k[1] and t.area = k[2] and t.tipe = k[3] and t.kode = k[4];
  end if;
  if TG_OP in ('INSERT', 'UPDATE') then
    n := to_jsonb(NEW);
    v_tahun := (n ->> 'tahun')::int; v_bulan := (n ->> 'bulan')::int;
    if v_tahun is null or v_tahun < 2000 or v_tahun > 2100 then raise exception 'tahun tidak valid' using errcode = '22023'; end if;
    if v_bulan is null or v_bulan < 1 or v_bulan > 12 then raise exception 'bulan harus 1–12' using errcode = '22023'; end if;
    k := array(select coalesce(nullif(btrim(case when c = '-' then '' else n ->> c end), ''), '') from unnest(kc) c);
    foreach m in array ms loop
      if n ->> m is not null and btrim(n ->> m) <> '' then
        insert into sementrack.target (jenis, metrik, tahun, bulan, region, area, tipe, kode, nama, status, nilai, diperbarui)
        values (j, m, v_tahun, v_bulan, k[1], k[2], k[3], k[4],
                case when kn = '-' then null else nullif(btrim(n ->> kn), '') end,
                case when ks = '-' then null else nullif(btrim(n ->> ks), '') end,
                (n ->> m)::numeric, now())
        on conflict (jenis, metrik, tahun, bulan, region, area, tipe, kode) do update
          set nilai = excluded.nilai, nama = excluded.nama, status = excluded.status, diperbarui = now();
      end if;
    end loop;
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end $$;

create or replace view sementrack.v_edit_target_sell_out as
select tahun, bulan, region, area as distributor, tipe,
       max(nilai) filter (where metrik = 'target_ton') as target_ton,
       max(nilai) filter (where metrik = 'target_ta') as target_ta,
       max(nilai) filter (where metrik = 'realisasi_ton') as realisasi_ton,
       max(nilai) filter (where metrik = 'realisasi_ta') as realisasi_ta
from sementrack.target where jenis = 'sell_out'
group by tahun, bulan, region, area, tipe;

create or replace view sementrack.v_edit_target_sell_in as
select tahun, bulan, region, area as sub_region, tipe,
       max(nilai) filter (where metrik = 'target_ton') as target_ton,
       max(nilai) filter (where metrik = 'realisasi_ton') as realisasi_ton
from sementrack.target where jenis = 'sell_in'
group by tahun, bulan, region, area, tipe;

create or replace view sementrack.v_edit_target_distributor as
select tahun, bulan, kode as dist_code,
       max(nilai) filter (where metrik = 'target_ton') as target_ton,
       max(nilai) filter (where metrik = 'target_ta') as target_ta
from sementrack.target where jenis = 'distributor'
group by tahun, bulan, kode;

create or replace view sementrack.v_edit_target_salesman as
select tahun, bulan, area as dist_code, kode as salesman_code, max(nama) as salesman_name, max(status) as status,
       max(nilai) filter (where metrik = 'target_ta') as target_ta,
       max(nilai) filter (where metrik = 'target_ton') as target_ton
from sementrack.target where jenis = 'salesman'
group by tahun, bulan, area, kode;

drop trigger if exists edit_trg on sementrack.v_edit_target_sell_out;
create trigger edit_trg instead of insert or update or delete on sementrack.v_edit_target_sell_out
  for each row execute function sementrack.target_edit_trg('sell_out', 'target_ton,target_ta,realisasi_ton,realisasi_ta', 'region', 'distributor', 'tipe', '-', '-', '-');
drop trigger if exists edit_trg on sementrack.v_edit_target_sell_in;
create trigger edit_trg instead of insert or update or delete on sementrack.v_edit_target_sell_in
  for each row execute function sementrack.target_edit_trg('sell_in', 'target_ton,realisasi_ton', 'region', 'sub_region', 'tipe', '-', '-', '-');
drop trigger if exists edit_trg on sementrack.v_edit_target_distributor;
create trigger edit_trg instead of insert or update or delete on sementrack.v_edit_target_distributor
  for each row execute function sementrack.target_edit_trg('distributor', 'target_ton,target_ta', '-', '-', '-', 'dist_code', '-', '-');
drop trigger if exists edit_trg on sementrack.v_edit_target_salesman;
create trigger edit_trg instead of insert or update or delete on sementrack.v_edit_target_salesman
  for each row execute function sementrack.target_edit_trg('salesman', 'target_ta,target_ton', '-', 'dist_code', '-', 'salesman_code', 'salesman_name', 'status');

-- Target jumlah salesman: belum punya kunci; satu baris per distributor
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'sementrack.distributor_target_salesman'::regclass and contype = 'p')
     and not exists (select 1 from sementrack.distributor_target_salesman group by dist_code having count(*) > 1 or dist_code is null) then
    alter table sementrack.distributor_target_salesman add primary key (dist_code);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Daftar tabel yang boleh diedit
--    kolom: [{name, label, tipe: text|int|num, wajib, pilihan[]}]. Kolom kunci (pk) wajib diisi.
-- ---------------------------------------------------------------------
create table if not exists sementrack.tabel_edit (
  id          text primary key,
  urutan      int not null default 100,
  grup        text not null,
  label       text not null,
  keterangan  text,
  objek       text not null,          -- tabel / view (schema.nama)
  pk          text[] not null,
  kolom       jsonb not null,
  filter      text[] not null default '{}',
  urut        text not null,          -- ORDER BY
  aktif       boolean not null default true
);

insert into sementrack.tabel_edit (id, urutan, grup, label, keterangan, objek, pk, kolom, filter, urut) values
('target_salesman', 10, 'Target', 'Target salesman',
 'Target toko aktif dan tonase per salesman per bulan, juga nama dan status salesman. Dipakai Tim Sales dan Detail Transaksi.',
 'sementrack.v_edit_target_salesman', '{tahun,bulan,dist_code,salesman_code}',
 '[{"name":"tahun","label":"Tahun","tipe":"int","wajib":true},{"name":"bulan","label":"Bulan","tipe":"int","wajib":true,"pilihan":["1","2","3","4","5","6","7","8","9","10","11","12"]},
   {"name":"dist_code","label":"Distributor","tipe":"text","wajib":true},{"name":"salesman_code","label":"Kode salesman","tipe":"text","wajib":true},
   {"name":"salesman_name","label":"Nama salesman","tipe":"text"},{"name":"status","label":"Status","tipe":"text"},
   {"name":"target_ta","label":"Target TA","tipe":"num"},{"name":"target_ton","label":"Target tonase","tipe":"num"}]',
 '{tahun,dist_code,bulan}', 'tahun desc, dist_code, salesman_code, bulan'),
('target_distributor', 20, 'Target', 'Target distributor',
 'Target tonase dan toko aktif per distributor per bulan (Penjualan Toko, Rekap Harian).',
 'sementrack.v_edit_target_distributor', '{tahun,bulan,dist_code}',
 '[{"name":"tahun","label":"Tahun","tipe":"int","wajib":true},{"name":"bulan","label":"Bulan","tipe":"int","wajib":true,"pilihan":["1","2","3","4","5","6","7","8","9","10","11","12"]},
   {"name":"dist_code","label":"Distributor","tipe":"text","wajib":true},{"name":"target_ton","label":"Target tonase","tipe":"num"},{"name":"target_ta","label":"Target TA","tipe":"num"}]',
 '{tahun,dist_code}', 'tahun desc, dist_code, bulan'),
('target_sell_out', 30, 'Target', 'Target Sell Out BNN',
 'Target dan realisasi pembanding per region, distributor/subdist, tipe semen, per bulan. Realisasi tahun lalu ada di baris tahun lalu.',
 'sementrack.v_edit_target_sell_out', '{tahun,bulan,region,distributor,tipe}',
 '[{"name":"tahun","label":"Tahun","tipe":"int","wajib":true},{"name":"bulan","label":"Bulan","tipe":"int","wajib":true,"pilihan":["1","2","3","4","5","6","7","8","9","10","11","12"]},
   {"name":"region","label":"Region","tipe":"text","wajib":true},{"name":"distributor","label":"Distributor","tipe":"text","wajib":true},{"name":"tipe","label":"Tipe","tipe":"text","wajib":true},
   {"name":"target_ton","label":"Target ton","tipe":"num"},{"name":"target_ta","label":"Target TA","tipe":"num"},
   {"name":"realisasi_ton","label":"Realisasi ton","tipe":"num"},{"name":"realisasi_ta","label":"Realisasi TA","tipe":"num"}]',
 '{tahun,region,tipe}', 'tahun desc, region, distributor, tipe, bulan'),
('target_sell_in', 40, 'Target', 'Target Sell In BNN',
 'Target dan realisasi pembanding per region, sub region, tipe semen, per bulan. Realisasi tahun lalu ada di baris tahun lalu.',
 'sementrack.v_edit_target_sell_in', '{tahun,bulan,region,sub_region,tipe}',
 '[{"name":"tahun","label":"Tahun","tipe":"int","wajib":true},{"name":"bulan","label":"Bulan","tipe":"int","wajib":true,"pilihan":["1","2","3","4","5","6","7","8","9","10","11","12"]},
   {"name":"region","label":"Region","tipe":"text","wajib":true},{"name":"sub_region","label":"Sub region","tipe":"text","wajib":true},{"name":"tipe","label":"Tipe","tipe":"text","wajib":true},
   {"name":"target_ton","label":"Target ton","tipe":"num"},{"name":"realisasi_ton","label":"Realisasi ton","tipe":"num"}]',
 '{tahun,region,tipe}', 'tahun desc, region, sub_region, tipe, bulan'),
('target_jumlah_salesman', 50, 'Target', 'Target jumlah salesman',
 'Jumlah salesman aktif yang ditargetkan per distributor (Tim Sales).',
 'sementrack.distributor_target_salesman', '{dist_code}',
 '[{"name":"dist_code","label":"Distributor","tipe":"text","wajib":true},{"name":"dist_name","label":"Nama distributor","tipe":"text"},{"name":"target_salesman","label":"Target salesman","tipe":"int"}]',
 '{}', 'dist_code'),
('subdist', 60, 'Master', 'Subdist',
 'Customer yang sebenarnya subdist: tidak dihitung toko aktif dan tidak dihitung ke salesman.',
 'sementrack.subdist_customer', '{dist_code,customer_code}',
 '[{"name":"dist_code","label":"Distributor","tipe":"text","wajib":true},{"name":"customer_code","label":"Kode customer","tipe":"text","wajib":true},{"name":"subdist","label":"Nama subdist","tipe":"text","wajib":true}]',
 '{}', 'dist_code, customer_code'),
('region_sellin', 70, 'Master', 'Region gudang sell in',
 'Kode customer gudang/pelabuhan di raw sell in dan region-nya (Sell In BNN, Outstanding DO).',
 'sementrack.sellin_region_map', '{kode_customer}',
 '[{"name":"kode_customer","label":"Kode customer","tipe":"text","wajib":true},{"name":"region","label":"Region","tipe":"text","wajib":true},{"name":"nama_customer","label":"Nama","tipe":"text"}]',
 '{region}', 'region, kode_customer'),
('distributor', 80, 'Master', 'Distributor',
 'Daftar distributor: nama, wilayah, jenis (tag).',
 'public.distributor', '{dist_code}',
 '[{"name":"dist_code","label":"Kode","tipe":"text","wajib":true},{"name":"dist_name","label":"Nama","tipe":"text"},{"name":"wilayah","label":"Wilayah","tipe":"text"},{"name":"tag","label":"Tag","tipe":"text"},{"name":"source","label":"Sumber","tipe":"text"}]',
 '{}', 'dist_code'),
('produk', 90, 'Master', 'Produk',
 'Kode produk transaksi dan jenisnya (STR, RJW, CWC).',
 'public.produk', '{kode}',
 '[{"name":"kode","label":"Kode","tipe":"text","wajib":true},{"name":"nama","label":"Nama","tipe":"text"},{"name":"jenis","label":"Jenis","tipe":"text","pilihan":["STR","RJW","CWC"]}]',
 '{}', 'kode')
on conflict (id) do update set urutan = excluded.urutan, grup = excluded.grup, label = excluded.label, keterangan = excluded.keterangan,
  objek = excluded.objek, pk = excluded.pk, kolom = excluded.kolom, filter = excluded.filter, urut = excluded.urut;

-- ---------------------------------------------------------------------
-- 3. Simpan perubahan (dipanggil backend, khusus admin)
--    p_upsert / p_delete = JSON array of object {kolom: nilai}. Satu transaksi: gagal satu, batal semua.
-- ---------------------------------------------------------------------
alter table sementrack.kelola_log drop constraint if exists kelola_log_dataset_check;
alter table sementrack.kelola_log add constraint kelola_log_dataset_check
  check (dataset in ('transaksi', 'sellin', 'dofas', 'erp', 'j073', 'target', 'outstanding', 'tabel'));
alter table sementrack.kelola_log drop constraint if exists kelola_log_aksi_check;
alter table sementrack.kelola_log add constraint kelola_log_aksi_check check (aksi in ('upload', 'hapus', 'ubah'));

create or replace function sementrack.tabel_simpan(p_id text, p_user text, p_upsert json, p_delete json)
returns table(diubah integer, ditambah integer, dihapus integer)
language plpgsql security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare
  c sementrack.tabel_edit;
  obj regclass; r jsonb; col jsonb; v text;
  pkcond text; setlist text; cols text;
  n int; v_upd int := 0; v_ins int := 0; v_del int := 0; i int := 0;
begin
  select * into c from sementrack.tabel_edit t where t.id = p_id and t.aktif;
  if not found then raise exception 'tabel % tidak bisa diedit', p_id using errcode = '22023'; end if;
  obj := c.objek::regclass;
  if coalesce(json_array_length(p_upsert), 0) + coalesce(json_array_length(p_delete), 0) = 0 then
    raise exception 'tidak ada perubahan' using errcode = '22023';
  end if;
  if coalesce(json_array_length(p_upsert), 0) + coalesce(json_array_length(p_delete), 0) > 20000 then
    raise exception 'terlalu banyak perubahan sekaligus (maks 20.000 baris)' using errcode = '22023';
  end if;

  -- kunci dibandingkan sebagai teks: aman untuk kolom teks maupun angka
  select string_agg(format('(t.%I)::text is not distinct from nullif(btrim($1 ->> %L), %L)', k, k, ''), ' and ') into pkcond from unnest(c.pk) k;
  select string_agg(format('%I = x.%I', e ->> 'name', e ->> 'name'), ', ') into setlist
    from jsonb_array_elements(c.kolom) e where not (e ->> 'name' = any(c.pk));
  select string_agg(format('%I', e ->> 'name'), ', ') into cols from jsonb_array_elements(c.kolom) e;

  for r in select value::jsonb from json_array_elements(coalesce(p_delete, '[]')) loop
    execute format('delete from %s as t where %s', obj, pkcond) using r;
    get diagnostics n = row_count; v_del := v_del + n;
  end loop;

  for r in select value::jsonb from json_array_elements(coalesce(p_upsert, '[]')) loop
    i := i + 1;
    -- teks dirapikan, kosong = null
    r := (select jsonb_object_agg(key, case when jsonb_typeof(value) = 'string' then coalesce(to_jsonb(nullif(btrim(value #>> '{}'), '')), 'null'::jsonb) else value end) from jsonb_each(r));
    for col in select * from jsonb_array_elements(c.kolom) loop
      v := r ->> (col ->> 'name');
      if (coalesce((col ->> 'wajib')::boolean, false) or (col ->> 'name') = any(c.pk)) and v is null then
        raise exception 'baris %: kolom "%" wajib diisi', i, col ->> 'label' using errcode = '22023';
      end if;
      if v is not null and col ->> 'tipe' = 'int' and v !~ '^-?\d+$' then
        raise exception 'baris %: "%" harus bilangan bulat (isi: %)', i, col ->> 'label', v using errcode = '22023';
      end if;
      if v is not null and col ->> 'tipe' = 'num' and v !~ '^-?\d+(\.\d+)?$' then
        raise exception 'baris %: "%" harus angka (isi: %)', i, col ->> 'label', v using errcode = '22023';
      end if;
      if v is not null and col ? 'pilihan' and not (v = any(array(select jsonb_array_elements_text(col -> 'pilihan')))) then
        raise exception 'baris %: "%" harus salah satu dari %', i, col ->> 'label', (select string_agg(x, ', ') from jsonb_array_elements_text(col -> 'pilihan') x) using errcode = '22023';
      end if;
    end loop;
    n := 0;
    if setlist is not null then
      execute format('update %s as t set %s from (select * from jsonb_populate_record(null::%s, $1)) x where %s', obj, setlist, obj, pkcond) using r;
      get diagnostics n = row_count;
    else   -- semua kolom adalah kunci: cukup cek sudah ada atau belum
      execute format('select count(*) from %s as t where %s', obj, pkcond) using r into n;
    end if;
    if n > 0 then v_upd := v_upd + 1;
    else
      execute format('insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1)', obj, cols, cols, obj) using r;
      v_ins := v_ins + 1;
    end if;
  end loop;

  insert into sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, rows_saved, rows_deleted, status, finished_at)
  values ('tabel', 'ubah', p_user, 'edit', c.label, current_date, current_date, v_upd + v_ins, v_del, 'selesai', now());
  return query select v_upd, v_ins, v_del;
end $$;

/** Baca isi satu tabel (kolom terdaftar saja), disaring kolom filter. Maks 20.000 baris. */
create or replace function sementrack.tabel_baca(p_id text, p_filter json)
returns json
language plpgsql stable security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare c sementrack.tabel_edit; cols text; cond text := 'true'; k text; v text; res json; n int;
begin
  select * into c from sementrack.tabel_edit t where t.id = p_id and t.aktif;
  if not found then raise exception 'tabel % tidak bisa dibuka', p_id using errcode = '22023'; end if;
  select string_agg(format('t.%I', e ->> 'name'), ', ') into cols from jsonb_array_elements(c.kolom) e;
  for k, v in select key, value from json_each_text(coalesce(p_filter, '{}')) loop
    if not (k = any(c.filter)) then raise exception 'filter % tidak dikenal', k using errcode = '22023'; end if;
    if v is not null and v <> '' then cond := cond || format(' and (t.%I)::text = %L', k, v); end if;
  end loop;
  execute format('select count(*) from %s t where %s', c.objek::regclass, cond) into n;
  if n > 20000 then raise exception '% baris: terlalu banyak, pilih filter dulu', n using errcode = '22023'; end if;
  execute format('select coalesce(json_agg(x), %L) from (select %s from %s t where %s order by %s) x', '[]', cols, c.objek::regclass, cond, c.urut) into res;
  return res;
end $$;

/** Pilihan filter dan saran isian: nilai unik per kolom teks/int (maks 300 per kolom). */
create or replace function sementrack.tabel_opsi(p_id text)
returns json
language plpgsql stable security definer
set search_path to 'sementrack', 'public', 'pg_temp'
as $$
declare c sementrack.tabel_edit; e jsonb; res jsonb := '{}'; vals json;
begin
  select * into c from sementrack.tabel_edit t where t.id = p_id and t.aktif;
  if not found then raise exception 'tabel % tidak bisa dibuka', p_id using errcode = '22023'; end if;
  for e in select * from jsonb_array_elements(c.kolom) loop
    if e ->> 'tipe' in ('text', 'int') then
      execute format('select coalesce(json_agg(v order by v), %L) from (select distinct (%I)::text v from %s where %I is not null limit 300) x',
                     '[]', e ->> 'name', c.objek::regclass, e ->> 'name') into vals;
      res := res || jsonb_build_object(e ->> 'name', vals);
    end if;
  end loop;
  return res;
end $$;

-- Pembaruan peta region juga mencatat siapa & kapan (kolom updated_by/updated_at)
create or replace function sementrack.sellin_region_map_stamp() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists stamp on sementrack.sellin_region_map;
create trigger stamp before insert or update on sementrack.sellin_region_map for each row execute function sementrack.sellin_region_map_stamp();

commit;

-- ---------------------------------------------------------------------
-- 4. Menambah tabel lain ke Kelola Data → Tabel (contoh, jangan dijalankan apa adanya):
--   insert into sementrack.tabel_edit (id, urutan, grup, label, keterangan, objek, pk, kolom, filter, urut) values
--   ('nama_id', 100, 'Master', 'Label di web', 'Penjelasan singkat', 'schema.tabel', '{kolom_kunci}',
--    '[{"name":"kolom_kunci","label":"Kode","tipe":"text","wajib":true},{"name":"nilai","label":"Nilai","tipe":"num"}]',
--    '{}', 'kolom_kunci');
--   Tabel harus punya kunci unik (pk). Hanya kolom di "kolom" yang ditampilkan dan bisa diubah.
-- ---------------------------------------------------------------------
