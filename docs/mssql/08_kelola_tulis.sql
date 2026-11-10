/* =============================================================================
   SEMENTRACK di SQL Server 2022, tahap 4c: Kelola Data lainnya.
   Prosedur: kelola_hapus_pratinjau, kelola_hapus, status_sync_set, sellout_dofas_simpan,
   sellout_erp_simpan, sellout_j073_simpan, target_simpan.
   Jalankan di MARKETING_ANALIS setelah 03_sellout.sql (memakai dbo.calc_tonase, sementrack.j073_ton).
   Aman dijalankan ulang. Pola: lihat 06_upload_transaksi.sql.

   - pg_advisory_xact_lock menjadi sp_getapplock (kunci bernama selama transaksi).
   - Angka di tempelan boleh notasi ilmiah; angka yang tidak terbaca ditolak dengan pesan (PostgreSQL: galat cast).
   - Hasil berupa array (dist_codes, tahun_list, metrik_list) dikirim sebagai teks JSON.
============================================================================= */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- angka dari teks tempelan: desimal biasa atau notasi ilmiah; NULL bila kosong / tidak terbaca
CREATE OR ALTER FUNCTION sementrack.angka (@t nvarchar(4000))
RETURNS decimal(20,6)
WITH SCHEMABINDING
AS
BEGIN
  RETURN COALESCE(TRY_CAST(@t AS decimal(20,6)), TRY_CAST(TRY_CAST(@t AS float) AS decimal(20,6)));
END
GO

/* ============================ hapus data ============================ */

CREATE OR ALTER PROCEDURE sementrack.kelola_hapus_pratinjau
  @p_dataset nvarchar(50), @p_from date, @p_to date, @p_dists nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  IF @p_dataset IS NULL OR @p_dataset NOT IN (N'transaksi', N'sellin') THROW 52023, N'dataset tidak dikenal', 1;
  IF @p_dataset = N'transaksi'
    SELECT COUNT_BIG(*) AS baris, ISNULL(ROUND(SUM(dbo.calc_tonase(t.product_code, t.order_qty)), 1), 0) AS ton,
           MIN(t.do_date) AS tanggal_pertama, MAX(t.do_date) AS tanggal_terakhir
    FROM dbo.transaksi t
    WHERE t.do_date BETWEEN @p_from AND @p_to
      AND (@p_dists IS NULL OR NOT EXISTS (SELECT 1 FROM OPENJSON(@p_dists))
           OR t.dist_code IN (SELECT v FROM OPENJSON(@p_dists) WITH (v nvarchar(200) '$')));
  ELSE
    SELECT COUNT_BIG(*) AS baris, ISNULL(ROUND(SUM(b.ton), 1), 0) AS ton, MIN(b.tanggal) AS tanggal_pertama, MAX(b.tanggal) AS tanggal_terakhir
    FROM sementrack.sellin_bnn b WHERE b.tanggal BETWEEN @p_from AND @p_to;
END
GO

CREATE OR ALTER PROCEDURE sementrack.kelola_hapus
  @p_dataset nvarchar(50), @p_from date, @p_to date, @p_dists nvarchar(max), @p_user nvarchar(200)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @n int, @dists nvarchar(max);
  IF @p_from IS NULL OR @p_to IS NULL OR @p_from > @p_to THROW 52023, N'rentang tanggal tidak valid', 1;
  IF @p_dataset IS NULL OR @p_dataset NOT IN (N'transaksi', N'sellin') THROW 52023, N'dataset tidak dikenal', 1;
  -- array kosong = semua distributor
  SET @dists = CASE WHEN @p_dists IS NULL OR NOT EXISTS (SELECT 1 FROM OPENJSON(@p_dists)) THEN NULL ELSE @p_dists END;

  BEGIN TRAN;
  IF @p_dataset = N'transaksi'
  BEGIN
    DELETE FROM dbo.transaksi
    WHERE do_date BETWEEN @p_from AND @p_to
      AND (@dists IS NULL OR dist_code IN (SELECT v FROM OPENJSON(@dists) WITH (v nvarchar(200) '$')));
    SET @n = @@ROWCOUNT;
  END
  ELSE
  BEGIN
    SET @dists = NULL;
    DELETE FROM sementrack.sellin_bnn WHERE tanggal BETWEEN @p_from AND @p_to;
    SET @n = @@ROWCOUNT;
  END
  INSERT INTO sementrack.kelola_log (dataset, aksi, created_by, date_from, date_to, dist_codes, rows_deleted, status, finished_at)
  VALUES (@p_dataset, N'hapus', @p_user, @p_from, @p_to, @dists, @n, N'selesai', SYSDATETIMEOFFSET());
  COMMIT;
  SELECT @n AS n;
END
GO

/* ============================ status sinkron ============================ */

CREATE OR ALTER PROCEDURE sementrack.status_sync_set @p_tanggal date, @p_jam time(0), @p_keterangan nvarchar(4000)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @p_tanggal IS NULL THROW 52023, N'tanggal wajib diisi', 1;
  DECLARE @ket nvarchar(200) = LEFT(NULLIF(TRIM(@p_keterangan), N''), 200);
  BEGIN TRAN;
    -- PostgreSQL mengizinkan jam kosong; kolom di sini wajib terisi, jadi jam kosong = 00:00
    UPDATE dbo.status_sync SET tanggal_update = @p_tanggal, jam_update = ISNULL(@p_jam, CAST('00:00' AS time(0))), keterangan = @ket WHERE id = 1;
    IF @@ROWCOUNT = 0
      INSERT INTO dbo.status_sync (id, tanggal_update, jam_update, keterangan) VALUES (1, @p_tanggal, ISNULL(@p_jam, CAST('00:00' AS time(0))), @ket);
  COMMIT;
END
GO

/* ============================ tempel DO FAS (ganti satu tahun) ============================
   Baris: [tipe, area, distributor, keterangan, Jan, Feb, ..., Des] */
CREATE OR ALTER PROCEDURE sementrack.sellout_dofas_simpan @p_tahun int, @p_rows nvarchar(max), @p_user nvarchar(200)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @old int, @new int, @ton decimal(20,6), @baris int, @b int, @msg nvarchar(2048), @kunci nvarchar(100);
  IF @p_tahun IS NULL OR @p_tahun NOT BETWEEN 2020 AND 2100 THROW 52023, N'Tahun tidak valid', 1;
  IF ISJSON(@p_rows) = 0 OR LEFT(LTRIM(@p_rows), 1) <> N'[' OR NOT EXISTS (SELECT 1 FROM OPENJSON(@p_rows))
    THROW 52023, N'Tidak ada baris DO FAS', 1;

  SELECT CAST(r.[key] AS int) + 1 AS baris,
         UPPER(TRIM(JSON_VALUE(r.[value], '$[0]'))) AS tipe, NULLIF(TRIM(JSON_VALUE(r.[value], '$[1]')), N'') AS area,
         TRIM(JSON_VALUE(r.[value], '$[2]')) AS distributor, NULLIF(TRIM(JSON_VALUE(r.[value], '$[3]')), N'') AS keterangan,
         m.bulan, JSON_VALUE(r.[value], CONCAT('$[', 3 + m.bulan, ']')) AS ton_txt
  INTO #dofas
  FROM OPENJSON(@p_rows) r
  CROSS JOIN (VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10), (11), (12)) m(bulan);

  SELECT @b = MIN(baris) FROM #dofas WHERE tipe IS NULL OR tipe NOT IN (N'STR', N'RJW', N'CWC');
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Tipe harus STR, RJW, atau CWC (baris ', @b, N')'); THROW 52023, @msg, 1; END
  SELECT @b = MIN(baris) FROM #dofas WHERE ISNULL(distributor, N'') = N'';
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Kolom Distributor kosong (baris ', @b, N')'); THROW 52023, @msg, 1; END
  SELECT @b = MIN(baris) FROM #dofas WHERE ton_txt IS NOT NULL AND sementrack.angka(ton_txt) IS NULL;
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Angka tidak terbaca (baris ', @b, N')'); THROW 52023, @msg, 1; END
  SELECT @b = MIN(baris) FROM #dofas WHERE LEN(area) > 200 OR LEN(distributor) > 200 OR LEN(keterangan) > 200;
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Teks terlalu panjang, maks 200 karakter (baris ', @b, N')'); THROW 52023, @msg, 1; END

  SET @kunci = CONCAT(N'sellout_dofas_', @p_tahun);
  BEGIN TRAN;
  EXEC sp_getapplock @Resource = @kunci, @LockMode = N'Exclusive', @LockOwner = N'Transaction';
  DELETE FROM sementrack.sellout_dofas WHERE tahun = @p_tahun;
  SET @old = @@ROWCOUNT;
  INSERT INTO sementrack.sellout_dofas (tahun, baris, tipe, area, distributor, keterangan, bulan, ton)
  SELECT @p_tahun, baris, tipe, area, distributor, keterangan, bulan, ISNULL(sementrack.angka(ton_txt), 0) FROM #dofas;
  SELECT @new = COUNT(DISTINCT baris), @ton = ISNULL(SUM(sementrack.angka(ton_txt)), 0) FROM #dofas;
  SELECT @baris = COUNT(DISTINCT baris) FROM sementrack.sellout_dofas WHERE tahun = @p_tahun;

  INSERT INTO sementrack.kelola_log (dataset, aksi, created_by, source, date_from, date_to, rows_read, rows_saved, rows_deleted, status, finished_at)
  VALUES (N'dofas', N'upload', @p_user, N'tempel', DATEFROMPARTS(@p_tahun, 1, 1), DATEFROMPARTS(@p_tahun, 12, 31), @new, @baris, @old / 12, N'selesai', SYSDATETIMEOFFSET());
  COMMIT;
  SELECT @baris AS rows_saved, @old / 12 AS rows_deleted, @ton AS ton;
END
GO

/* ============================ tempel Sub ERP (ganti bulan yang berisi angka) ============================
   Baris: [kode, nama, tipe, Jan, Feb, ..., Des]. Bulan tanpa angka di seluruh tempelan tidak disentuh. */
CREATE OR ALTER PROCEDURE sementrack.sellout_erp_simpan @p_tahun int, @p_rows nvarchar(max), @p_user nvarchar(200)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @old int, @new int, @ton decimal(20,6), @b1 int, @b2 int, @msg nvarchar(2048), @kunci nvarchar(100);
  DECLARE @hapus TABLE (kode nvarchar(50), tipe nvarchar(200));
  IF @p_tahun IS NULL OR @p_tahun NOT BETWEEN 2020 AND 2100 THROW 52023, N'Tahun tidak valid', 1;
  IF ISJSON(@p_rows) = 0 OR LEFT(LTRIM(@p_rows), 1) <> N'[' OR NOT EXISTS (SELECT 1 FROM OPENJSON(@p_rows))
    THROW 52023, N'Tidak ada baris Sub ERP', 1;

  SELECT UPPER(TRIM(JSON_VALUE(r.[value], '$[0]'))) AS kode, NULLIF(TRIM(JSON_VALUE(r.[value], '$[1]')), N'') AS nama,
         NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[2]'))), N'') AS tipe,
         m.bulan, JSON_VALUE(r.[value], CONCAT('$[', 2 + m.bulan, ']')) AS ton_txt
  INTO #erp
  FROM OPENJSON(@p_rows) r
  CROSS JOIN (VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10), (11), (12)) m(bulan);

  IF EXISTS (SELECT 1 FROM #erp WHERE ISNULL(kode, N'') = N'') THROW 52023, N'Kode distributor kosong', 1;
  IF EXISTS (SELECT 1 FROM #erp WHERE tipe IS NOT NULL AND tipe NOT IN (N'STR', N'RJW', N'CWC')) THROW 52023, N'Tipe harus STR, RJW, atau CWC', 1;
  IF EXISTS (SELECT 1 FROM #erp WHERE ton_txt IS NOT NULL AND sementrack.angka(ton_txt) IS NULL) THROW 52023, N'Ada angka Sub ERP yang tidak terbaca', 1;
  IF EXISTS (SELECT 1 FROM #erp WHERE LEN(kode) > 50 OR LEN(nama) > 200) THROW 52023, N'Kode maks 50 karakter, nama maks 200', 1;
  IF EXISTS (SELECT 1 FROM #erp GROUP BY kode, tipe, bulan HAVING COUNT(*) > 1)
  BEGIN
    SET @msg = CONCAT(N'Kode ', (SELECT TOP (1) kode FROM #erp GROUP BY kode, tipe, bulan HAVING COUNT(*) > 1), N' muncul lebih dari sekali');
    THROW 52023, @msg, 1;
  END

  -- bulan yang ikut ditempel = bulan yang punya angka
  SELECT @b1 = MIN(bulan), @b2 = MAX(bulan) FROM #erp WHERE ton_txt IS NOT NULL;
  IF @b1 IS NULL THROW 52023, N'Tidak ada angka Sub ERP', 1;

  SET @kunci = CONCAT(N'sellout_erp_', @p_tahun);
  BEGIN TRAN;
  EXEC sp_getapplock @Resource = @kunci, @LockMode = N'Exclusive', @LockOwner = N'Transaction';
  DELETE FROM sementrack.sellout_erp
  OUTPUT deleted.kode, deleted.tipe INTO @hapus
  WHERE tahun = @p_tahun AND bulan IN (SELECT DISTINCT bulan FROM #erp WHERE ton_txt IS NOT NULL);
  SELECT @old = COUNT(*) FROM (SELECT DISTINCT kode, tipe FROM @hapus) x;

  INSERT INTO sementrack.sellout_erp (tahun, kode, nama, tipe, bulan, ton)
  SELECT @p_tahun, kode, nama, tipe, bulan, sementrack.angka(ton_txt) FROM #erp WHERE ton_txt IS NOT NULL;
  SELECT @new = COUNT(*) FROM (SELECT DISTINCT kode, tipe FROM #erp WHERE ton_txt IS NOT NULL) x;
  SELECT @ton = ISNULL(SUM(sementrack.angka(ton_txt)), 0) FROM #erp WHERE ton_txt IS NOT NULL;

  INSERT INTO sementrack.kelola_log (dataset, aksi, created_by, source, date_from, date_to, rows_read, rows_saved, rows_deleted, status, finished_at)
  VALUES (N'erp', N'upload', @p_user, N'tempel', DATEFROMPARTS(@p_tahun, @b1, 1), EOMONTH(DATEFROMPARTS(@p_tahun, @b2, 1)),
          @new, @new, @old, N'selesai', SYSDATETIMEOFFSET());
  COMMIT;
  SELECT @new AS rows_saved, @old AS rows_deleted, @ton AS ton;
END
GO

/* ============================ upload J073 (INSA, PKB) ============================
   Baris: [dist_code, do_date, do_no, customer_code, customer_name, product_code, product_name, order_qty, net_amount, warehouse].
   Per distributor, data di rentang tanggal file diganti. */
CREATE OR ALTER PROCEDURE sementrack.sellout_j073_simpan @p_rows nvarchar(max), @p_user nvarchar(200), @p_file nvarchar(4000) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @old int, @new int, @ton decimal(24,8), @from date, @to date, @dists nvarchar(max), @b int, @d nvarchar(200), @msg nvarchar(2048);
  IF ISJSON(@p_rows) = 0 OR LEFT(LTRIM(@p_rows), 1) <> N'[' OR NOT EXISTS (SELECT 1 FROM OPENJSON(@p_rows))
    THROW 52023, N'Tidak ada baris J073', 1;

  SELECT CAST(r.[key] AS int) + 1 AS baris,
         TRIM(JSON_VALUE(r.[value], '$[0]')) AS dist_code, JSON_VALUE(r.[value], '$[1]') AS do_date_txt,
         TRIM(JSON_VALUE(r.[value], '$[2]')) AS do_no, TRIM(JSON_VALUE(r.[value], '$[3]')) AS customer_code,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[4]')), N'') AS customer_name, UPPER(TRIM(JSON_VALUE(r.[value], '$[5]'))) AS product_code,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[6]')), N'') AS product_name, JSON_VALUE(r.[value], '$[7]') AS qty_txt,
         JSON_VALUE(r.[value], '$[8]') AS net_txt, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[9]'))), N'') AS warehouse
  INTO #raw FROM OPENJSON(@p_rows) r;

  SELECT @b = MIN(baris) FROM #raw
  WHERE (do_date_txt IS NOT NULL AND TRY_CONVERT(date, do_date_txt, 23) IS NULL)
     OR (qty_txt IS NOT NULL AND sementrack.angka(qty_txt) IS NULL) OR (net_txt IS NOT NULL AND sementrack.angka(net_txt) IS NULL);
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Tanggal atau angka tidak terbaca (baris ', @b, N')'); THROW 52023, @msg, 1; END

  SELECT baris, dist_code, TRY_CONVERT(date, do_date_txt, 23) AS do_date, do_no, customer_code, customer_name, product_code, product_name,
         sementrack.angka(qty_txt) AS order_qty, ISNULL(sementrack.angka(net_txt), 0) AS net_amount, warehouse
  INTO #j FROM #raw;

  SELECT @b = MIN(baris) FROM #j
  WHERE ISNULL(dist_code, N'') = N'' OR do_date IS NULL OR ISNULL(do_no, N'') = N''
     OR ISNULL(customer_code, N'') = N'' OR ISNULL(product_code, N'') = N'' OR order_qty IS NULL;
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Baris J073 tidak lengkap (baris ', @b, N')'); THROW 52023, @msg, 1; END
  SELECT @d = MIN(x.dist_code) FROM #j x WHERE NOT EXISTS (SELECT 1 FROM sementrack.sellout_j073_dist d WHERE d.dist_code = x.dist_code);
  IF @d IS NOT NULL BEGIN SET @msg = CONCAT(N'Kode distributor ', @d, N' belum dikenal untuk J073'); THROW 52023, @msg, 1; END
  SELECT @b = MIN(baris) FROM #j
  WHERE LEN(dist_code) > 50 OR LEN(do_no) > 200 OR LEN(customer_code) > 200 OR LEN(customer_name) > 200
     OR LEN(product_code) > 200 OR LEN(product_name) > 200 OR LEN(warehouse) > 200;
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Teks terlalu panjang (baris ', @b, N')'); THROW 52023, @msg, 1; END

  BEGIN TRAN;
  EXEC sp_getapplock @Resource = N'sellout_j073', @LockMode = N'Exclusive', @LockOwner = N'Transaction';
  DELETE j FROM sementrack.sellout_j073 j
  JOIN (SELECT dist_code, MIN(do_date) AS a, MAX(do_date) AS b FROM #j GROUP BY dist_code) r
    ON j.dist_code = r.dist_code AND j.do_date BETWEEN r.a AND r.b;
  SET @old = @@ROWCOUNT;

  INSERT INTO sementrack.sellout_j073 (dist_code, do_date, do_no, customer_code, customer_name, product_code, product_name, order_qty, net_amount, warehouse)
  SELECT dist_code, do_date, do_no, customer_code, customer_name, product_code, product_name, order_qty, net_amount, warehouse FROM #j;

  SELECT @new = COUNT(*), @ton = ISNULL(SUM(sementrack.j073_ton(product_code, product_name, order_qty)), 0),
         @from = MIN(do_date), @to = MAX(do_date)
  FROM #j;
  SELECT @dists = N'[' + STRING_AGG(N'"' + STRING_ESCAPE(dist_code, 'json') + N'"', N',') WITHIN GROUP (ORDER BY dist_code) + N']'
  FROM (SELECT DISTINCT dist_code FROM #j) x;

  INSERT INTO sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes, rows_read, rows_saved, rows_deleted, status, finished_at)
  VALUES (N'j073', N'upload', @p_user, N'file', LEFT(@p_file, 200), @from, @to, @dists, @new, @new, @old, N'selesai', SYSDATETIMEOFFSET());
  COMMIT;
  SELECT @new AS rows_saved, @old AS rows_deleted, @ton AS ton, @from AS date_from, @to AS date_to, @dists AS dist_codes;
END
GO

/* ============================ simpan target (tempel / file) ============================
   Baris: [metrik, tahun, bulan, region, area, tipe, kode, nama, status, nilai].
   Untuk tiap (metrik, tahun, bulan) yang ada di tempelan, seluruh target jenis itu diganti. */
CREATE OR ALTER PROCEDURE sementrack.target_simpan @p_jenis nvarchar(50), @p_rows nvarchar(max), @p_user nvarchar(200), @p_file nvarchar(4000) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @old int, @new int, @tahun nvarchar(max), @metrik nvarchar(max), @from date, @to date, @msg nvarchar(2048), @kunci nvarchar(100);
  IF @p_jenis IS NULL OR @p_jenis NOT IN (N'sell_in', N'sell_out', N'distributor', N'salesman')
  BEGIN
    SET @msg = CONCAT(N'Jenis target tidak dikenal: ', @p_jenis);
    THROW 52023, @msg, 1;
  END
  IF ISJSON(@p_rows) = 0 OR LEFT(LTRIM(@p_rows), 1) <> N'[' OR NOT EXISTS (SELECT 1 FROM OPENJSON(@p_rows))
    THROW 52023, N'Tidak ada baris target', 1;

  SELECT TRIM(JSON_VALUE(r.[value], '$[0]')) AS metrik, JSON_VALUE(r.[value], '$[1]') AS tahun_txt, JSON_VALUE(r.[value], '$[2]') AS bulan_txt,
         ISNULL(TRIM(JSON_VALUE(r.[value], '$[3]')), N'') AS region, ISNULL(TRIM(JSON_VALUE(r.[value], '$[4]')), N'') AS area,
         ISNULL(UPPER(TRIM(JSON_VALUE(r.[value], '$[5]'))), N'') AS tipe, ISNULL(TRIM(JSON_VALUE(r.[value], '$[6]')), N'') AS kode,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[7]')), N'') AS nama, NULLIF(TRIM(JSON_VALUE(r.[value], '$[8]')), N'') AS status,
         JSON_VALUE(r.[value], '$[9]') AS nilai_txt
  INTO #raw FROM OPENJSON(@p_rows) r;

  IF EXISTS (SELECT 1 FROM #raw WHERE (tahun_txt IS NOT NULL AND TRY_CAST(tahun_txt AS int) IS NULL)
                                   OR (bulan_txt IS NOT NULL AND TRY_CAST(bulan_txt AS int) IS NULL)
                                   OR (nilai_txt IS NOT NULL AND sementrack.angka(nilai_txt) IS NULL))
    THROW 52023, N'Ada tahun, bulan, atau angka target yang tidak terbaca', 1;

  SELECT metrik, TRY_CAST(tahun_txt AS int) AS tahun, TRY_CAST(bulan_txt AS int) AS bulan, region, area, tipe, kode, nama, status,
         sementrack.angka(nilai_txt) AS nilai
  INTO #t FROM #raw;

  IF EXISTS (SELECT 1 FROM #t WHERE metrik IS NULL OR metrik NOT IN (N'target_ton', N'realisasi_ton', N'target_ta', N'realisasi_ta'))
    THROW 52023, N'Metrik tidak dikenal', 1;
  IF EXISTS (SELECT 1 FROM #t WHERE tahun IS NULL OR tahun NOT BETWEEN 2000 AND 2100) THROW 52023, N'Tahun tidak valid', 1;
  IF EXISTS (SELECT 1 FROM #t WHERE bulan IS NULL OR bulan NOT BETWEEN 1 AND 12) THROW 52023, N'Bulan harus 1 sampai 12', 1;
  IF EXISTS (SELECT 1 FROM #t WHERE nilai IS NULL) THROW 52023, N'Ada angka target yang kosong', 1;
  IF @p_jenis IN (N'distributor', N'salesman') AND EXISTS (SELECT 1 FROM #t WHERE kode = N'') THROW 52023, N'Kode kosong', 1;
  IF @p_jenis IN (N'sell_in', N'sell_out') AND EXISTS (SELECT 1 FROM #t WHERE region = N'' OR area = N'') THROW 52023, N'Region / area kosong', 1;
  IF EXISTS (SELECT 1 FROM #t WHERE LEN(region) > 50 OR LEN(area) > 50 OR LEN(tipe) > 50 OR LEN(kode) > 50 OR LEN(nama) > 200 OR LEN(status) > 200)
    THROW 52023, N'Region, area, tipe, kode maks 50 karakter; nama dan status maks 200', 1;
  IF EXISTS (SELECT 1 FROM #t GROUP BY metrik, tahun, bulan, region, area, tipe, kode HAVING COUNT(*) > 1)
  BEGIN
    SELECT TOP (1) @msg = CONCAT(N'Ada baris dobel: ', area, N' ', kode, N' ', tahun, N'-', bulan)
    FROM #t GROUP BY metrik, tahun, bulan, region, area, tipe, kode HAVING COUNT(*) > 1;
    THROW 52023, @msg, 1;
  END

  SET @kunci = CONCAT(N'target_', @p_jenis);
  BEGIN TRAN;
  EXEC sp_getapplock @Resource = @kunci, @LockMode = N'Exclusive', @LockOwner = N'Transaction';
  DELETE t FROM sementrack.target t
  JOIN (SELECT DISTINCT metrik, tahun, bulan FROM #t) k ON t.metrik = k.metrik AND t.tahun = k.tahun AND t.bulan = k.bulan
  WHERE t.jenis = @p_jenis;
  SET @old = @@ROWCOUNT;

  INSERT INTO sementrack.target (jenis, metrik, tahun, bulan, region, area, tipe, kode, nama, status, nilai)
  SELECT @p_jenis, metrik, tahun, bulan, region, area, tipe, kode, nama, status, nilai FROM #t;
  SET @new = @@ROWCOUNT;

  SELECT @tahun = N'[' + STRING_AGG(CAST(tahun AS nvarchar(4)), N',') WITHIN GROUP (ORDER BY tahun) + N']' FROM (SELECT DISTINCT tahun FROM #t) x;
  SELECT @metrik = N'[' + STRING_AGG(N'"' + metrik + N'"', N',') WITHIN GROUP (ORDER BY metrik) + N']' FROM (SELECT DISTINCT metrik FROM #t) x;
  SELECT @from = MIN(DATEFROMPARTS(tahun, bulan, 1)), @to = EOMONTH(MAX(DATEFROMPARTS(tahun, bulan, 1))) FROM #t;

  INSERT INTO sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes,
                                     rows_read, rows_saved, rows_deleted, status, finished_at)
  VALUES (N'target', N'upload', @p_user, CASE WHEN @p_file IS NULL THEN N'tempel' ELSE N'file' END, LEFT(@p_file, 200), @from, @to,
          N'["' + @p_jenis + N'"]', @new, @new, @old, N'selesai', SYSDATETIMEOFFSET());
  COMMIT;
  SELECT @new AS rows_saved, @old AS rows_deleted, @tahun AS tahun_list, @metrik AS metrik_list;
END
GO
