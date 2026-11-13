-- =====================================================================
-- Kode ERP distributor (bangunsukses.com) untuk upload mentah J028 / J028B.
-- Jalankan di web_semen SETELAH kelola_tabel.sql, sebagai pemilik tabel. Aman dijalankan ulang.
--
-- File J028 memakai kode ERP (6987, 4094, 1001K, ...), bukan dist_code SEMENTRACK (NSA, INSA, KTP, ...).
-- Dengan kolom ini upload dicocokkan lewat kode, tidak tergantung penulisan nama PT.
-- Baris clone di J028B memakai kolom "Distributor Code Clone" (mis. 4094E) dan dicocokkan ke INSA-E.
-- Isi awal diambil dari J028 / J028B 1-12 Nov 2026 (kode dan nama distributor di file).
-- =====================================================================
alter table public.distributor add column if not exists kode_erp text;

-- satu kode ERP hanya untuk satu distributor
create unique index if not exists distributor_kode_erp_uq on public.distributor (upper(trim(kode_erp)))
  where kode_erp is not null and trim(kode_erp) <> '';

update public.distributor d set kode_erp = v.kode_erp
from (values
  ('NSA', '6987'), ('GMD', '6983'), ('BMM', '6984'), ('PTK', '1001P'), ('KTP', '1001K'),
  ('INSA', '4094'), ('INSA-E', '4094E'), ('PM', '6981'), ('NC', '4403'), ('NCB', '4403B'),
  ('CBS', '4708'), ('JMB', '9757'), ('BKP', '6980'), ('PKB', '9575')
) as v(dist_code, kode_erp)
where d.dist_code = v.dist_code and d.kode_erp is null;

-- bisa diisi / diubah di Kelola Data -> Tabel -> Distributor
update sementrack.tabel_edit set
  keterangan = 'Daftar distributor: nama, wilayah, jenis (tag), dan kode ERP (dipakai mencocokkan file mentah J028 / J028B).',
  kolom = '[{"name":"dist_code","label":"Kode","tipe":"text","wajib":true},{"name":"dist_name","label":"Nama","tipe":"text"},{"name":"kode_erp","label":"Kode ERP","tipe":"text"},{"name":"wilayah","label":"Wilayah","tipe":"text"},{"name":"tag","label":"Tag","tipe":"text"},{"name":"source","label":"Sumber","tipe":"text"}]'
where id = 'distributor';
