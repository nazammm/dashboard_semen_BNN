/* =====================================================================
   SQL Server: Stock Semen (sama dengan docs/sql/stock_semen.sql).
   Jalankan di MARKETING_ANALIS SETELAH 10_kode_erp.sql. Aman dijalankan ulang.
   - sementrack.stock_daerah : daerah di file stok -> region (bisa diedit di Kelola Data -> Tabel)
   - sementrack.stock_semen  : zak dan ton per tanggal x daerah x produk
   - sementrack.stock_simpan : upload mengganti seluruh isi tanggal yang ada di file
   - v_stock_semen, v_stock_harian, v_stock_info, v_data_status (+ baris stock)
   ===================================================================== */
IF OBJECT_ID(N'sementrack.stock_daerah', N'U') IS NULL
  CREATE TABLE sementrack.stock_daerah (
    daerah nvarchar(200) NOT NULL CONSTRAINT PK_stock_daerah PRIMARY KEY,
    region nvarchar(200) NOT NULL,
    urutan int NULL
  );
GO

MERGE sementrack.stock_daerah AS t
USING (VALUES
  (N'NC SELAT PANJANG', N'Riau', 1), (N'NC TJ BALAI KARIMUN 01', N'Riau Island', 2), (N'NC TJ BALAI KARIMUN 02', N'Riau Island', 3),
  (N'BANGKA', N'Babel', 4), (N'BATAM', N'Riau Island', 5), (N'BENGKULU', N'Bengkulu', 6),
  (N'BMM CILEGON', N'Lampung', 7), (N'BMM TARAHAN', N'Lampung', 8), (N'BMM WAYLUNIK', N'Lampung', 9),
  (N'JAMBI', N'Jambi', 10), (N'JAMBI - BUNGO', N'Jambi', 11), (N'JAMBI - MUARA SABAK', N'Jambi', 12),
  (N'KETAPANG', N'West Kal', 13), (N'MEDAN KOTA BANGUN', N'North Sum', 14), (N'MEDAN KIM 2', N'North Sum', 15),
  (N'MEDAN KIM 2 (2)', N'North Sum', 16), (N'MEDAN KIM 3', N'North Sum', 17), (N'MEDAN KIM 3 (3)', N'North Sum', 18),
  (N'PADANG', N'West Sum', 19), (N'PEKANBARU', N'Riau', 20), (N'PEKANBARU - DUMAI', N'Riau', 21),
  (N'PEKANBARU - BENGKALIS', N'Riau', 22), (N'PM BATURAJA', N'South Sum', 23), (N'PM GD. GANDUS', N'South Sum', 24),
  (N'PM GD. PERINTIS', N'South Sum', 25), (N'PM SUKAJAYA', N'South Sum', 26), (N'PTK BUMI RAYA', N'West Kal', 27),
  (N'PTK WAJOK', N'West Kal', 28)
) AS s (daerah, region, urutan) ON t.daerah = s.daerah
WHEN NOT MATCHED THEN INSERT (daerah, region, urutan) VALUES (s.daerah, s.region, s.urutan);
GO

IF OBJECT_ID(N'sementrack.stock_semen', N'U') IS NULL
BEGIN
  CREATE TABLE sementrack.stock_semen (
    tanggal date NOT NULL,
    daerah nvarchar(200) NOT NULL,
    produk nvarchar(100) NOT NULL,
    jenis nvarchar(10) NOT NULL CONSTRAINT CK_stock_semen_jenis CHECK (jenis IN (N'STR', N'RJW', N'CWC')),
    kg decimal(10, 3) NOT NULL CONSTRAINT CK_stock_semen_kg CHECK (kg > 0),
    zak decimal(20, 3) NOT NULL,
    ton decimal(20, 3) NOT NULL,
    CONSTRAINT PK_stock_semen PRIMARY KEY (tanggal, daerah, produk)
  );
  CREATE INDEX IX_stock_semen_tanggal ON sementrack.stock_semen (tanggal);
END
GO

ALTER TABLE sementrack.kelola_log DROP CONSTRAINT IF EXISTS CK_kelola_log_dataset_check;
ALTER TABLE sementrack.kelola_log ADD CONSTRAINT CK_kelola_log_dataset_check
  CHECK (dataset IN (N'transaksi', N'sellin', N'dofas', N'erp', N'j073', N'target', N'outstanding', N'tabel', N'stock'));
GO

/* Baris: [tanggal, daerah, produk, jenis, kg, zak]. Tanggal yang ada di file diganti seluruhnya. */
CREATE OR ALTER PROCEDURE sementrack.stock_simpan @p_rows nvarchar(max), @p_user nvarchar(200), @p_file nvarchar(4000) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @old int, @new int, @dari date, @sampai date, @n int, @ton decimal(20, 3), @msg nvarchar(2048);
  DECLARE @hari_ini date = CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '+07:00') AS date);
  IF ISJSON(@p_rows) = 0 OR LEFT(LTRIM(@p_rows), 1) <> N'[' OR NOT EXISTS (SELECT 1 FROM OPENJSON(@p_rows))
    THROW 52023, N'Tidak ada baris stok', 1;

  SELECT TRY_CONVERT(date, JSON_VALUE(r.[value], '$[0]'), 23) AS tanggal,
         TRIM(JSON_VALUE(r.[value], '$[1]')) AS daerah,
         UPPER(TRIM(JSON_VALUE(r.[value], '$[2]'))) AS produk,
         UPPER(TRIM(JSON_VALUE(r.[value], '$[3]'))) AS jenis,
         sementrack.angka(JSON_VALUE(r.[value], '$[4]')) AS kg,
         ISNULL(sementrack.angka(JSON_VALUE(r.[value], '$[5]')), 0) AS zak
  INTO #stock
  FROM OPENJSON(@p_rows) r;

  IF EXISTS (SELECT 1 FROM #stock WHERE tanggal IS NULL OR ISNULL(daerah, N'') = N'' OR ISNULL(produk, N'') = N'')
    THROW 52023, N'Tanggal, daerah, dan produk wajib diisi', 1;
  IF EXISTS (SELECT 1 FROM #stock WHERE jenis NOT IN (N'STR', N'RJW', N'CWC')) THROW 52023, N'Jenis harus STR, RJW, atau CWC', 1;
  IF EXISTS (SELECT 1 FROM #stock WHERE kg IS NULL OR kg <= 0) THROW 52023, N'Kg per zak tidak valid', 1;
  IF EXISTS (SELECT 1 FROM #stock WHERE LEN(daerah) > 200 OR LEN(produk) > 100) THROW 52023, N'Daerah maks 200 karakter, produk maks 100', 1;
  IF EXISTS (SELECT 1 FROM #stock WHERE tanggal > @hari_ini) THROW 52023, N'Ada tanggal stok setelah hari ini', 1;
  IF EXISTS (SELECT 1 FROM #stock GROUP BY tanggal, daerah, produk HAVING COUNT(*) > 1)
  BEGIN
    SET @msg = CONCAT(N'Daerah ', (SELECT TOP (1) daerah FROM #stock GROUP BY tanggal, daerah, produk HAVING COUNT(*) > 1),
                      N' muncul lebih dari sekali di tanggal yang sama');
    THROW 52023, @msg, 1;
  END

  BEGIN TRAN;
  EXEC sp_getapplock @Resource = N'stock_semen', @LockMode = N'Exclusive', @LockOwner = N'Transaction';
  DELETE FROM sementrack.stock_semen WHERE tanggal IN (SELECT DISTINCT tanggal FROM #stock);
  SET @old = @@ROWCOUNT;
  INSERT INTO sementrack.stock_semen (tanggal, daerah, produk, jenis, kg, zak, ton)
  SELECT tanggal, daerah, produk, jenis, kg, zak, ROUND(zak * kg / 1000.0, 3) FROM #stock;
  SET @new = @@ROWCOUNT;
  SELECT @dari = MIN(tanggal), @sampai = MAX(tanggal), @n = COUNT(DISTINCT tanggal) FROM #stock;
  SELECT @ton = ISNULL(SUM(ROUND(zak * kg / 1000.0, 3)), 0) FROM #stock WHERE tanggal = @sampai;
  INSERT INTO sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, rows_read, rows_saved, rows_deleted, status, finished_at)
  VALUES (N'stock', N'upload', @p_user, N'upload', LEFT(@p_file, 200), @dari, @sampai, @new, @new, @old, N'selesai', SYSDATETIMEOFFSET());
  COMMIT;
  SELECT @new AS rows_saved, @old AS rows_deleted, @dari AS tanggal_dari, @sampai AS tanggal_sampai, @n AS jumlah_tanggal, @ton AS ton_terakhir;
END
GO

CREATE OR ALTER VIEW sementrack.v_stock_semen AS
SELECT s.tanggal, ISNULL(d.region, N'Tanpa region') AS region, s.daerah, s.produk, s.jenis, s.kg, s.zak, s.ton,
       ISNULL(d.urutan, 999) AS urutan
FROM sementrack.stock_semen s
LEFT JOIN sementrack.stock_daerah d ON d.daerah = TRIM(s.daerah);
GO

CREATE OR ALTER VIEW sementrack.v_stock_harian AS
SELECT tanggal, region, jenis, SUM(zak) AS zak, SUM(ton) AS ton
FROM sementrack.v_stock_semen
GROUP BY tanggal, region, jenis;
GO

CREATE OR ALTER VIEW sementrack.v_stock_info AS
SELECT MAX(tanggal) AS tanggal_terakhir, MIN(tanggal) AS tanggal_awal, COUNT(DISTINCT tanggal) AS jumlah_tanggal,
       (SELECT COUNT(*) FROM sementrack.stock_semen s
        WHERE s.tanggal = (SELECT MAX(tanggal) FROM sementrack.stock_semen)
          AND NOT EXISTS (SELECT 1 FROM sementrack.stock_daerah d WHERE d.daerah = TRIM(s.daerah))) AS tanpa_region
FROM sementrack.stock_semen;
GO

/* Salinan v_data_status dari 05_kelola_view.sql + baris stock */
CREATE OR ALTER VIEW sementrack.v_data_status AS
WITH sync AS (
  SELECT DATEADD(second, DATEDIFF(second, CAST('00:00:00' AS time(0)), ISNULL(s.jam_update, CAST('00:00:00' AS time(0)))),
                 CAST(s.tanggal_update AS datetime2(0))) AS ts,
         s.keterangan
  FROM dbo.status_sync s WHERE s.id = 1
), sellin_up AS (
  SELECT TOP (1) created_at, created_by FROM sementrack.sellin_bnn_upload WHERE status = N'selesai' ORDER BY id DESC
), dofas_up AS (
  SELECT TOP (1) created_at, created_by, date_from FROM sementrack.kelola_log WHERE dataset = N'dofas' AND status = N'selesai' ORDER BY id DESC
), erp_up AS (
  SELECT TOP (1) created_at, created_by, date_from FROM sementrack.kelola_log WHERE dataset = N'erp' AND status = N'selesai' ORDER BY id DESC
), j073_up AS (
  SELECT TOP (1) created_at, created_by FROM sementrack.kelola_log WHERE dataset = N'j073' AND status = N'selesai' ORDER BY id DESC
), po_up AS (
  SELECT TOP (1) created_at, created_by, posisi FROM sementrack.sellin_po_upload WHERE status = N'selesai' ORDER BY id DESC
), stock_up AS (
  SELECT TOP (1) created_at, created_by FROM sementrack.kelola_log WHERE dataset = N'stock' AND status = N'selesai' ORDER BY id DESC
)
SELECT N'transaksi' AS sumber, N'Transaksi distributor' AS nama, N'harian' AS frekuensi,
       (SELECT MAX(do_date) FROM dbo.transaksi) AS data_sampai,
       (SELECT CONVERT(nvarchar(16), ts, 126) FROM sync) AS diperbarui,
       (SELECT keterangan FROM sync) AS keterangan
UNION ALL
SELECT N'sellin', N'Sell In BNN', N'harian',
       (SELECT MAX(tanggal) FROM sementrack.sellin_bnn WHERE mortar = 0),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM sellin_up),
       (SELECT N'Upload oleh ' + created_by FROM sellin_up)
UNION ALL
SELECT N'dofas', N'DO FAS', N'harian',
       (SELECT CAST(SWITCHOFFSET(created_at, '+07:00') AS date) FROM dofas_up),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM dofas_up),
       (SELECT N'Tempel data ' + CAST(YEAR(date_from) AS nvarchar(4)) + N' oleh ' + created_by FROM dofas_up)
UNION ALL
SELECT N'erp', N'Sub ERP', N'harian',
       (SELECT CAST(SWITCHOFFSET(created_at, '+07:00') AS date) FROM erp_up),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM erp_up),
       (SELECT N'Tempel data ' + CAST(YEAR(date_from) AS nvarchar(4)) + N' oleh ' + created_by FROM erp_up)
UNION ALL
SELECT N'j073', N'J073 (INSA, PKB)', N'harian',
       (SELECT MAX(do_date) FROM sementrack.sellout_j073),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM j073_up),
       (SELECT N'Upload oleh ' + created_by FROM j073_up)
UNION ALL
SELECT N'outstanding', N'Outstanding DO', N'harian',
       (SELECT posisi FROM po_up),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM po_up),
       (SELECT N'Upload oleh ' + created_by FROM po_up)
UNION ALL
SELECT N'stock', N'Stock semen', N'harian',
       (SELECT MAX(tanggal) FROM sementrack.stock_semen),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM stock_up),
       (SELECT N'Upload oleh ' + created_by FROM stock_up);
GO

/* Kelola Data -> Tabel: daerah stok */
MERGE sementrack.tabel_edit AS t
USING (SELECT N'stock_daerah' AS id, 75 AS urutan, N'Master' AS grup, N'Daerah stok' AS label,
              N'Daerah/gudang di file Stock Semen dan region-nya (halaman Stock). Daerah baru di file harus ditambahkan di sini.' AS keterangan,
              N'sementrack.stock_daerah' AS objek, N'["daerah"]' AS pk,
              N'[{"name":"daerah","label":"Daerah","tipe":"text","wajib":true},{"name":"region","label":"Region","tipe":"text","wajib":true},{"name":"urutan","label":"Urutan","tipe":"int"}]' AS kolom,
              N'["region"]' AS filter, N'region, urutan, daerah' AS urut) AS s
ON t.id = s.id
WHEN MATCHED THEN UPDATE SET urutan = s.urutan, grup = s.grup, label = s.label, keterangan = s.keterangan, objek = s.objek,
  pk = s.pk, kolom = s.kolom, filter = s.filter, urut = s.urut
WHEN NOT MATCHED THEN INSERT (id, urutan, grup, label, keterangan, objek, pk, kolom, filter, urut)
  VALUES (s.id, s.urutan, s.grup, s.label, s.keterangan, s.objek, s.pk, s.kolom, s.filter, s.urut);
GO

/* Halaman Stock ikut akses Sell Out BNN untuk role yang hak halamannya diatur manual */
IF OBJECT_ID(N'auth_local.role_pages', N'U') IS NOT NULL
  INSERT INTO auth_local.role_pages (role, page_id, can_view_detail, can_download)
  SELECT r.role, N'stock', r.can_view_detail, r.can_download
  FROM auth_local.role_pages r
  WHERE r.page_id = N'sell-out-bnn'
    AND NOT EXISTS (SELECT 1 FROM auth_local.role_pages t WHERE t.role = r.role AND t.page_id = N'stock');
GO

SELECT * FROM sementrack.v_stock_info;
SELECT region, COUNT(*) AS daerah FROM sementrack.stock_daerah GROUP BY region ORDER BY region;
