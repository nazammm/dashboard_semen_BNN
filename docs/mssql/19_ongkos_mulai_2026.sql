/* ============================================================================
   19_ongkos_mulai_2026.sql · Ongkos kirim dilacak mulai Januari 2026
   - Hapus ORDB019 (sementrack.ongkos_kirim) dengan periode sebelum 2026.
   - Hapus J073 sebelum 2026 yang hanya dipakai halaman Ongkos Kirim: distributor tanpa aturan Sell Out
     (sellout_j073_aturan) dan baris non-RETAIL. J073 RETAIL INSA / PKB 2025 TIDAK dihapus (dipakai Sell Out BNN 2025).
   - ongkos_simpan menolak ORDB019 sebelum Januari 2026; v_ongkos_info hanya menampilkan bulan sejak 2026
     (definisi sama dengan 17_ongkos_kirim.sql yang sudah diperbarui).
   Jalankan di SSMS, database MARKETING_ANALIS, setelah 17_ongkos_kirim.sql. Aman dijalankan ulang.
============================================================================ */

/* ---------- 1. hapus data sebelum 2026 ---------- */
SET XACT_ABORT ON;
BEGIN TRAN;
DECLARE @ordb int, @j073 int, @dari date, @dists nvarchar(max);
SELECT @dari = MIN(periode) FROM sementrack.ongkos_kirim WHERE periode < '20260101';
SELECT @dists = N'[' + STRING_AGG(N'"' + STRING_ESCAPE(dist_code, 'json') + N'"', N',') WITHIN GROUP (ORDER BY dist_code) + N']'
FROM (SELECT DISTINCT dist_code FROM sementrack.ongkos_kirim WHERE periode < '20260101') x;
DELETE FROM sementrack.ongkos_kirim WHERE periode < '20260101';
SET @ordb = @@ROWCOUNT;
DELETE j FROM sementrack.sellout_j073 j
WHERE j.do_date < '20260101'
  AND (j.cust_group IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM sementrack.sellout_j073_aturan a WHERE a.dist_code = j.dist_code));
SET @j073 = @@ROWCOUNT;
IF @ordb > 0
  INSERT INTO sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes, rows_read, rows_saved, rows_deleted, status, finished_at)
  VALUES (N'ongkos', N'hapus', N'SSMS', N'19_ongkos_mulai_2026.sql', NULL, @dari, '20251231', @dists, 0, 0, @ordb, N'selesai', SYSDATETIMEOFFSET());
COMMIT;
SELECT @ordb AS ordb019_dihapus, @j073 AS j073_dihapus;
GO

/* ---------- 2. simpan ORDB019: tolak periode sebelum 2026 ---------- */
CREATE OR ALTER PROCEDURE sementrack.ongkos_simpan @p_rows nvarchar(max), @p_user nvarchar(200), @p_file nvarchar(4000) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @old int, @new int, @biaya decimal(24,2), @ton decimal(24,6), @from date, @to date, @dists nvarchar(max), @b int, @msg nvarchar(2048);
  IF ISJSON(@p_rows) = 0 OR LEFT(LTRIM(@p_rows), 1) <> N'[' OR NOT EXISTS (SELECT 1 FROM OPENJSON(@p_rows))
    THROW 52023, N'Tidak ada baris ORDB019', 1;

  SELECT CAST(r.[key] AS int) + 1 AS baris,
         TRIM(JSON_VALUE(r.[value], '$[0]')) AS dist_code, TRY_CONVERT(date, JSON_VALUE(r.[value], '$[1]'), 23) AS periode,
         TRY_CONVERT(date, JSON_VALUE(r.[value], '$[2]'), 23) AS kirim_date, TRIM(JSON_VALUE(r.[value], '$[3]')) AS do_no,
         TRIM(JSON_VALUE(r.[value], '$[4]')) AS foad, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[5]'))), N'') AS segmen,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[6]')), N'') AS transporter, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[7]'))), N'') AS truk,
         NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[8]'))), N'') AS asal, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[9]'))), N'') AS tujuan,
         NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[10]'))), N'') AS zona, sementrack.angka(JSON_VALUE(r.[value], '$[11]')) AS harga_ritase,
         NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[12]'))), N'') AS kategori, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[13]'))), N'') AS product_code,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[14]')), N'') AS product_name, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[15]'))), N'') AS delivery,
         sementrack.angka(JSON_VALUE(r.[value], '$[16]')) AS qty, sementrack.angka(JSON_VALUE(r.[value], '$[17]')) AS harga_uom,
         ISNULL(sementrack.angka(JSON_VALUE(r.[value], '$[18]')), 0) AS total
  INTO #o FROM OPENJSON(@p_rows) r;

  SELECT @b = MIN(baris) FROM #o
  WHERE ISNULL(dist_code, N'') = N'' OR periode IS NULL OR DAY(periode) <> 1 OR ISNULL(do_no, N'') = N'' OR ISNULL(foad, N'') = N'' OR qty IS NULL;
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Baris ORDB019 tidak lengkap (baris ', @b, N')'); THROW 52023, @msg, 1; END
  SELECT @b = MIN(baris) FROM #o
  WHERE LEN(dist_code) > 50 OR LEN(do_no) > 50 OR LEN(foad) > 50 OR LEN(transporter) > 200 OR LEN(truk) > 100 OR LEN(asal) > 200
     OR LEN(tujuan) > 200 OR LEN(zona) > 100 OR LEN(kategori) > 100 OR LEN(product_code) > 50 OR LEN(product_name) > 200;
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Teks terlalu panjang (baris ', @b, N')'); THROW 52023, @msg, 1; END
  IF EXISTS (SELECT 1 FROM #o WHERE periode > DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
    THROW 52023, N'Periode ORDB019 setelah bulan ini', 1;
  IF EXISTS (SELECT 1 FROM #o WHERE periode < DATEFROMPARTS(2026, 1, 1))
    THROW 52023, N'Ongkos kirim dilacak mulai Januari 2026, ORDB019 sebelum itu tidak disimpan', 1;

  BEGIN TRAN;
  EXEC sp_getapplock @Resource = N'ongkos_kirim', @LockMode = N'Exclusive', @LockOwner = N'Transaction';
  DELETE k FROM sementrack.ongkos_kirim k JOIN (SELECT DISTINCT dist_code, periode FROM #o) r ON k.dist_code = r.dist_code AND k.periode = r.periode;
  SET @old = @@ROWCOUNT;
  INSERT INTO sementrack.ongkos_kirim (dist_code, periode, kirim_date, do_no, foad, segmen, transporter, truk, asal, tujuan, zona, harga_ritase,
                                       kategori, product_code, product_name, delivery, qty, harga_uom, total, ton)
  SELECT dist_code, periode, kirim_date, do_no, foad, segmen, transporter, truk, asal, tujuan, zona, harga_ritase,
         kategori, product_code, product_name, delivery, qty, harga_uom, total,
         CASE WHEN kategori IN (N'SEMEN', N'WHITE CEMENT') THEN ISNULL(sementrack.j073_ton(product_code, product_name, qty), 0) ELSE 0 END
  FROM #o
  WHERE kategori IN (N'SEMEN', N'WHITE CEMENT') OR total <> 0;          -- barang lain tanpa ongkos tidak disimpan
  SET @new = @@ROWCOUNT;
  SELECT @biaya = SUM(total), @from = MIN(periode), @to = MAX(periode) FROM #o;
  SELECT @ton = SUM(ton) FROM sementrack.ongkos_kirim k WHERE EXISTS (SELECT 1 FROM #o r WHERE r.dist_code = k.dist_code AND r.periode = k.periode);
  SELECT @dists = N'[' + STRING_AGG(N'"' + STRING_ESCAPE(dist_code, 'json') + N'"', N',') WITHIN GROUP (ORDER BY dist_code) + N']'
  FROM (SELECT DISTINCT dist_code FROM #o) x;
  INSERT INTO sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes, rows_read, rows_saved, rows_deleted, status, finished_at)
  VALUES (N'ongkos', N'upload', @p_user, N'file', LEFT(@p_file, 200), @from, EOMONTH(@to), @dists, (SELECT COUNT(*) FROM #o), @new, @old, N'selesai', SYSDATETIMEOFFSET());
  COMMIT;
  SELECT @new AS rows_saved, @old AS rows_deleted, ISNULL(@biaya, 0) AS biaya, ISNULL(@ton, 0) AS ton, @from AS periode_dari, @to AS periode_sampai, @dists AS dist_codes;
END
GO

/* ---------- 3. bulan yang tampil di halaman Ongkos Kirim: sejak 2026 ---------- */
CREATE OR ALTER VIEW sementrack.v_ongkos_info AS
SELECT t.dist_code, d.kode, d.nama, t.periode, COUNT(*) AS trip, SUM(t.ton) AS ton,
       SUM(CASE WHEN t.biaya > 0 THEN t.ton ELSE 0 END) AS ton_berbiaya, SUM(t.biaya) AS biaya,
       (SELECT MAX(do_date) FROM sementrack.sellout_j073 j WHERE j.dist_code = t.dist_code) AS j073_sampai
FROM sementrack.v_ongkos_trip t JOIN sementrack.v_ongkos_dist d ON d.dist_code = t.dist_code
WHERE t.ton > 0 AND t.periode >= '20260101'          -- ongkos kirim dilacak mulai 2026 (19_ongkos_mulai_2026.sql)
GROUP BY t.dist_code, d.kode, d.nama, t.periode;
GO

-- Cek
SELECT MIN(periode) AS ordb_awal, MAX(periode) AS ordb_akhir, COUNT(*) AS baris FROM sementrack.ongkos_kirim;
