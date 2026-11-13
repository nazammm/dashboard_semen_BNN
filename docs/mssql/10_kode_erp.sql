-- =====================================================================
-- SQL Server: kode ERP distributor untuk upload mentah J028 / J028B (sama dengan docs/sql/kode_erp_distributor.sql).
-- Jalankan di MARKETING_ANALIS SETELAH 09_kelola_tabel.sql. Aman dijalankan ulang.
-- Upload J028 mencocokkan distributor lewat kolom ini, tidak tergantung penulisan nama PT.
-- =====================================================================
IF COL_LENGTH(N'dbo.distributor', N'kode_erp') IS NULL
  ALTER TABLE dbo.distributor ADD kode_erp nvarchar(50) NULL;
GO

-- satu kode ERP hanya untuk satu distributor (collation CI: huruf besar/kecil dianggap sama)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UQ_distributor_kode_erp' AND object_id = OBJECT_ID(N'dbo.distributor'))
  CREATE UNIQUE INDEX UQ_distributor_kode_erp ON dbo.distributor (kode_erp) WHERE kode_erp IS NOT NULL AND kode_erp <> N'';
GO

UPDATE d SET kode_erp = v.kode_erp
FROM dbo.distributor d
JOIN (VALUES
  (N'NSA', N'6987'), (N'GMD', N'6983'), (N'BMM', N'6984'), (N'PTK', N'1001P'), (N'KTP', N'1001K'),
  (N'INSA', N'4094'), (N'INSA-E', N'4094E'), (N'PM', N'6981'), (N'NC', N'4403'), (N'NCB', N'4403B'),
  (N'CBS', N'4708'), (N'JMB', N'9757'), (N'BKP', N'6980'), (N'PKB', N'9575')
) v (dist_code, kode_erp) ON d.dist_code = v.dist_code
WHERE d.kode_erp IS NULL;

-- bisa diisi / diubah di Kelola Data -> Tabel -> Distributor
UPDATE sementrack.tabel_edit SET
  keterangan = N'Daftar distributor: nama, wilayah, jenis (tag), dan kode ERP (dipakai mencocokkan file mentah J028 / J028B).',
  kolom = N'[{"name":"dist_code","label":"Kode","tipe":"text","wajib":true},{"name":"dist_name","label":"Nama","tipe":"text"},{"name":"kode_erp","label":"Kode ERP","tipe":"text"},{"name":"wilayah","label":"Wilayah","tipe":"text"},{"name":"tag","label":"Tag","tipe":"text"},{"name":"source","label":"Sumber","tipe":"text"}]'
WHERE id = N'distributor';
GO

SELECT dist_code, dist_name, kode_erp FROM dbo.distributor ORDER BY CASE WHEN kode_erp IS NULL THEN 1 ELSE 0 END, dist_code;
