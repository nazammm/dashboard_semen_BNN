/* =============================================================================
   SEMENTRACK di SQL Server 2022, tahap 4b: upload Sell In BNN, upload Outstanding DO, peta region customer.
   Prosedur: sellin_bnn_begin/stage/impact/commit/abort, sellin_po_begin/stage/impact/commit/abort,
   sellin_region_set, trigger stamp di sellin_region_map.
   Jalankan di MARKETING_ANALIS setelah 02_sellin.sql. Aman dijalankan ulang. Pola: lihat 06_upload_transaksi.sql.

   Perbedaan dari PostgreSQL:
   - sellin_rule dengan 4 argumen = sementrack.sellin_rule_produk (02_sellin.sql).
   - INSERT ... ON CONFLICT DO UPDATE (sellin_po, sellin_region_map) = UPDATE yang sudah ada lalu INSERT yang baru.
   - Kolom ton di sellin_bnn dihitung otomatis (kolom terhitung), tidak diisi saat INSERT.
============================================================================= */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ============================ Sell In BNN ============================ */

CREATE OR ALTER PROCEDURE sementrack.sellin_bnn_begin
  @p_user nvarchar(200), @p_source nvarchar(50), @p_file nvarchar(4000), @p_from date, @p_to date, @p_rows_read int
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @p_from IS NULL OR @p_to IS NULL OR @p_from > @p_to THROW 52023, N'rentang tanggal tidak valid', 1;
  IF DATEDIFF(day, @p_from, @p_to) > 800 THROW 52023, N'rentang tanggal terlalu panjang (maks 800 hari)', 1;
  DECLARE @stale TABLE (id bigint);
  DECLARE @id bigint;
  BEGIN TRAN;
    -- upload yang macet > 6 jam dianggap batal (bersih-bersih tabel sementara)
    UPDATE sementrack.sellin_bnn_upload SET status = N'batal', finished_at = SYSDATETIMEOFFSET()
    OUTPUT inserted.id INTO @stale
    WHERE status = N'proses' AND created_at < DATEADD(hour, -6, SYSDATETIMEOFFSET());
    DELETE s FROM sementrack.sellin_bnn_staging s JOIN @stale x ON x.id = s.upload_id;

    INSERT INTO sementrack.sellin_bnn_upload (created_by, source, file_name, date_from, date_to, rows_read)
    VALUES (@p_user, CASE WHEN @p_source = N'tempel' THEN N'tempel' ELSE N'file' END, LEFT(@p_file, 200), @p_from, @p_to,
            CASE WHEN ISNULL(@p_rows_read, 0) < 0 THEN 0 ELSE ISNULL(@p_rows_read, 0) END);
    SET @id = SCOPE_IDENTITY();
  COMMIT;
  SELECT @id AS id;
END
GO

/* Paket baris: array JSON berisi array 18 nilai (urutan = sellin_bnn_staging tanpa upload_id). */
CREATE OR ALTER PROCEDURE sementrack.sellin_bnn_stage @p_upload bigint, @p_rows nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @from date, @to date, @n int, @bad int, @msg nvarchar(2048);
  SELECT @from = date_from, @to = date_to FROM sementrack.sellin_bnn_upload WHERE id = @p_upload AND status = N'proses';
  IF @@ROWCOUNT = 0
  BEGIN
    SET @msg = CONCAT(N'upload ', @p_upload, N' tidak ditemukan atau sudah selesai');
    THROW 52023, @msg, 1;
  END
  IF ISJSON(@p_rows) = 0 OR LEFT(LTRIM(@p_rows), 1) <> N'[' THROW 52023, N'format paket tidak valid', 1;

  SELECT NULLIF(c0, N'') AS tanggal_txt, NULLIF(c1, N'') AS tanggal_order_txt,
         TRIM(c2) AS distributor, TRIM(c3) AS kode_customer, NULLIF(TRIM(c4), N'') AS nama_customer,
         TRIM(c5) AS tipe_pesanan, TRIM(c6) AS tipe_produk,
         NULLIF(TRIM(c7), N'') AS asal_pengiriman, NULLIF(TRIM(c8), N'') AS kode_tujuan, NULLIF(TRIM(c9), N'') AS nama_tujuan,
         NULLIF(TRIM(c10), N'') AS kota_tujuan, NULLIF(TRIM(c11), N'') AS loco_franco, NULLIF(TRIM(c12), N'') AS order_no,
         NULLIF(TRIM(c13), N'') AS sdo, NULLIF(TRIM(c14), N'') AS nomor_truk, NULLIF(TRIM(c15), N'') AS zona_group,
         NULLIF(TRIM(c16), N'') AS status_order, c17 AS qty_txt
  INTO #pkg
  FROM OPENJSON(@p_rows) WITH (
    c0 nvarchar(100) '$[0]', c1 nvarchar(100) '$[1]', c2 nvarchar(4000) '$[2]', c3 nvarchar(4000) '$[3]',
    c4 nvarchar(4000) '$[4]', c5 nvarchar(4000) '$[5]', c6 nvarchar(4000) '$[6]', c7 nvarchar(4000) '$[7]',
    c8 nvarchar(4000) '$[8]', c9 nvarchar(4000) '$[9]', c10 nvarchar(4000) '$[10]', c11 nvarchar(4000) '$[11]',
    c12 nvarchar(4000) '$[12]', c13 nvarchar(4000) '$[13]', c14 nvarchar(4000) '$[14]', c15 nvarchar(4000) '$[15]',
    c16 nvarchar(4000) '$[16]', c17 nvarchar(100) '$[17]');
  SET @n = @@ROWCOUNT;

  SELECT @bad = COUNT(*) FROM #pkg
  WHERE (tanggal_txt IS NOT NULL AND TRY_CONVERT(date, tanggal_txt, 23) IS NULL)
     OR (tanggal_order_txt IS NOT NULL AND TRY_CONVERT(date, tanggal_order_txt, 23) IS NULL)
     OR (qty_txt IS NOT NULL AND COALESCE(TRY_CAST(qty_txt AS decimal(20,6)), TRY_CAST(TRY_CAST(qty_txt AS float) AS decimal(20,6))) IS NULL);
  IF @bad > 0
  BEGIN
    SET @msg = CONCAT(@bad, N' baris berisi tanggal atau angka yang tidak terbaca');
    THROW 52023, @msg, 1;
  END
  SELECT @bad = COUNT(*) FROM #pkg
  WHERE LEN(distributor) > 200 OR LEN(kode_customer) > 200 OR LEN(nama_customer) > 200 OR LEN(tipe_pesanan) > 200 OR LEN(tipe_produk) > 200
     OR LEN(asal_pengiriman) > 200 OR LEN(kode_tujuan) > 200 OR LEN(nama_tujuan) > 200 OR LEN(kota_tujuan) > 200 OR LEN(loco_franco) > 200
     OR LEN(order_no) > 200 OR LEN(sdo) > 200 OR LEN(nomor_truk) > 200 OR LEN(zona_group) > 200 OR LEN(status_order) > 200;
  IF @bad > 0
  BEGIN
    SET @msg = CONCAT(@bad, N' baris berisi teks terlalu panjang (maks 200 karakter)');
    THROW 52023, @msg, 1;
  END
  SELECT @bad = COUNT(*) FROM #pkg
  WHERE tanggal_txt IS NULL OR TRY_CONVERT(date, tanggal_txt, 23) < @from OR TRY_CONVERT(date, tanggal_txt, 23) > @to
     OR qty_txt IS NULL OR COALESCE(TRY_CAST(qty_txt AS decimal(20,6)), TRY_CAST(TRY_CAST(qty_txt AS float) AS decimal(20,6))) < 0
     OR ISNULL(distributor, N'') = N'' OR ISNULL(kode_customer, N'') = N'' OR ISNULL(tipe_pesanan, N'') = N'' OR ISNULL(tipe_produk, N'') = N'';
  IF @bad > 0
  BEGIN
    SET @msg = CONCAT(@bad, N' baris tidak valid (tanggal di luar rentang / kolom wajib kosong / qty negatif)');
    THROW 52023, @msg, 1;
  END

  BEGIN TRAN;
    INSERT INTO sementrack.sellin_bnn_staging (upload_id, tanggal, tanggal_order, distributor, kode_customer, nama_customer, tipe_pesanan,
      tipe_produk, asal_pengiriman, kode_tujuan, nama_tujuan, kota_tujuan, loco_franco, order_no, sdo, nomor_truk, zona_group, status_order, delivery_qty)
    SELECT @p_upload, TRY_CONVERT(date, tanggal_txt, 23), TRY_CONVERT(date, tanggal_order_txt, 23), distributor, kode_customer, nama_customer,
      tipe_pesanan, tipe_produk, asal_pengiriman, kode_tujuan, nama_tujuan, kota_tujuan, loco_franco, order_no, sdo, nomor_truk, zona_group,
      status_order, COALESCE(TRY_CAST(qty_txt AS decimal(20,6)), TRY_CAST(TRY_CAST(qty_txt AS float) AS decimal(20,6)))
    FROM #pkg;
    UPDATE sementrack.sellin_bnn_upload SET rows_staged = rows_staged + @n WHERE id = @p_upload;
  COMMIT;
  SELECT @n AS n;
END
GO

CREATE OR ALTER PROCEDURE sementrack.sellin_bnn_impact @p_from date, @p_to date
AS
BEGIN
  SET NOCOUNT ON;
  SELECT COUNT_BIG(*) AS rows_existing, ISNULL(SUM(ton), 0) AS ton_existing, MIN(tanggal) AS first_date, MAX(tanggal) AS last_date
  FROM sementrack.sellin_bnn WHERE tanggal BETWEEN @p_from AND @p_to;
END
GO

/* Simpan: semua sell in di rentang tanggal file diganti dengan baris yang lolos aturan sell in. */
CREATE OR ALTER PROCEDURE sementrack.sellin_bnn_commit @p_upload bigint
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @from date, @to date, @saved int, @replaced int, @ton decimal(20,6), @msg nvarchar(2048);
  BEGIN TRAN;
  SELECT @from = u.date_from, @to = u.date_to FROM sementrack.sellin_bnn_upload u WITH (UPDLOCK, HOLDLOCK)
  WHERE u.id = @p_upload AND u.status = N'proses';
  IF @@ROWCOUNT = 0
  BEGIN
    SET @msg = CONCAT(N'upload ', @p_upload, N' tidak ditemukan atau sudah selesai');
    THROW 52023, @msg, 1;
  END
  IF NOT EXISTS (SELECT 1 FROM sementrack.sellin_bnn_staging s WHERE s.upload_id = @p_upload
                 AND sementrack.sellin_rule_produk(s.tipe_pesanan, s.distributor, s.asal_pengiriman, s.tipe_produk) = 1)
    THROW 52023, N'tidak ada baris yang lolos aturan (Gudang / PM toko-project dari ITP-Palembang, tanpa mortar)', 1;

  EXEC sp_getapplock @Resource = N'sementrack.sellin_bnn', @LockMode = N'Exclusive', @LockOwner = N'Transaction';

  DELETE FROM sementrack.sellin_bnn WHERE tanggal BETWEEN @from AND @to;
  SET @replaced = @@ROWCOUNT;

  INSERT INTO sementrack.sellin_bnn (upload_id, tanggal, tanggal_order, distributor, kode_customer, nama_customer, tipe_pesanan, tipe_produk,
    asal_pengiriman, kode_tujuan, nama_tujuan, kota_tujuan, loco_franco, order_no, sdo, nomor_truk, zona_group, status_order, delivery_qty)
  SELECT @p_upload, s.tanggal, s.tanggal_order, s.distributor, s.kode_customer, s.nama_customer, s.tipe_pesanan, s.tipe_produk,
    s.asal_pengiriman, s.kode_tujuan, s.nama_tujuan, s.kota_tujuan, s.loco_franco, s.order_no, s.sdo, s.nomor_truk, s.zona_group, s.status_order, s.delivery_qty
  FROM sementrack.sellin_bnn_staging s
  WHERE s.upload_id = @p_upload AND sementrack.sellin_rule_produk(s.tipe_pesanan, s.distributor, s.asal_pengiriman, s.tipe_produk) = 1;
  SET @saved = @@ROWCOUNT;

  SELECT @ton = ISNULL(SUM(b.ton), 0) FROM sementrack.sellin_bnn b WHERE b.upload_id = @p_upload;
  DELETE FROM sementrack.sellin_bnn_staging WHERE upload_id = @p_upload;
  UPDATE sementrack.sellin_bnn_upload
  SET status = N'selesai', finished_at = SYSDATETIMEOFFSET(), rows_saved = @saved, rows_replaced = @replaced, ton_saved = @ton
  WHERE id = @p_upload;
  COMMIT;
  SELECT @saved AS rows_saved, @replaced AS rows_replaced, @ton AS ton_saved, @from AS date_from, @to AS date_to;
END
GO

CREATE OR ALTER PROCEDURE sementrack.sellin_bnn_abort @p_upload bigint
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRAN;
    DELETE FROM sementrack.sellin_bnn_staging WHERE upload_id = @p_upload;
    UPDATE sementrack.sellin_bnn_upload SET status = N'batal', finished_at = SYSDATETIMEOFFSET() WHERE id = @p_upload AND status = N'proses';
  COMMIT;
END
GO

/* ============================ Outstanding DO (raw sell in per tanggal order) ============================ */

CREATE OR ALTER PROCEDURE sementrack.sellin_po_begin
  @p_user nvarchar(200), @p_source nvarchar(50), @p_file nvarchar(4000), @p_from date, @p_to date, @p_rows_read int
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @p_from IS NULL OR @p_to IS NULL OR @p_from > @p_to THROW 52023, N'rentang tanggal order tidak valid', 1;
  IF DATEDIFF(day, @p_from, @p_to) > 800 THROW 52023, N'rentang tanggal order terlalu panjang (maks 800 hari)', 1;
  DECLARE @stale TABLE (id bigint);
  DECLARE @id bigint;
  BEGIN TRAN;
    UPDATE sementrack.sellin_po_upload SET status = N'batal', finished_at = SYSDATETIMEOFFSET()
    OUTPUT inserted.id INTO @stale
    WHERE status = N'proses' AND created_at < DATEADD(hour, -6, SYSDATETIMEOFFSET());
    DELETE s FROM sementrack.sellin_po_staging s JOIN @stale x ON x.id = s.upload_id;

    INSERT INTO sementrack.sellin_po_upload (created_by, source, file_name, date_from, date_to, rows_read)
    VALUES (@p_user, CASE WHEN @p_source = N'tempel' THEN N'tempel' ELSE N'file' END, LEFT(@p_file, 200), @p_from, @p_to,
            CASE WHEN ISNULL(@p_rows_read, 0) < 0 THEN 0 ELSE ISNULL(@p_rows_read, 0) END);
    SET @id = SCOPE_IDENTITY();
  COMMIT;
  SELECT @id AS id;
END
GO

/* Paket baris: array JSON berisi array 18 nilai (urutan = sellin_po_staging tanpa upload_id). */
CREATE OR ALTER PROCEDURE sementrack.sellin_po_stage @p_upload bigint, @p_rows nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @from date, @to date, @n int, @bad int, @msg nvarchar(2048);
  SELECT @from = date_from, @to = date_to FROM sementrack.sellin_po_upload WHERE id = @p_upload AND status = N'proses';
  IF @@ROWCOUNT = 0
  BEGIN
    SET @msg = CONCAT(N'upload ', @p_upload, N' tidak ditemukan atau sudah selesai');
    THROW 52023, @msg, 1;
  END
  IF ISJSON(@p_rows) = 0 OR LEFT(LTRIM(@p_rows), 1) <> N'[' THROW 52023, N'format paket tidak valid', 1;

  SELECT NULLIF(c0, N'') AS tanggal_order_txt, TRIM(c1) AS distributor, TRIM(c2) AS order_no, TRIM(c3) AS tipe_produk,
         TRIM(c4) AS status_order, NULLIF(c5, N'') AS estimasi_kirim_txt, NULLIF(c6, N'') AS tanggal_kirim_txt,
         NULLIF(TRIM(c7), N'') AS alasan_reject, TRIM(c8) AS kode_customer, NULLIF(TRIM(c9), N'') AS nama_customer,
         TRIM(c10) AS tipe_pesanan, NULLIF(TRIM(c11), N'') AS asal_pengiriman, NULLIF(TRIM(c12), N'') AS kode_tujuan,
         NULLIF(TRIM(c13), N'') AS nama_tujuan, NULLIF(TRIM(c14), N'') AS kota_tujuan, NULLIF(TRIM(c15), N'') AS loco_franco,
         c16 AS order_qty_txt, NULLIF(c17, N'') AS delivery_qty_txt
  INTO #pkg
  FROM OPENJSON(@p_rows) WITH (
    c0 nvarchar(100) '$[0]', c1 nvarchar(4000) '$[1]', c2 nvarchar(4000) '$[2]', c3 nvarchar(4000) '$[3]',
    c4 nvarchar(4000) '$[4]', c5 nvarchar(100) '$[5]', c6 nvarchar(100) '$[6]', c7 nvarchar(4000) '$[7]',
    c8 nvarchar(4000) '$[8]', c9 nvarchar(4000) '$[9]', c10 nvarchar(4000) '$[10]', c11 nvarchar(4000) '$[11]',
    c12 nvarchar(4000) '$[12]', c13 nvarchar(4000) '$[13]', c14 nvarchar(4000) '$[14]', c15 nvarchar(4000) '$[15]',
    c16 nvarchar(100) '$[16]', c17 nvarchar(100) '$[17]');
  SET @n = @@ROWCOUNT;

  SELECT @bad = COUNT(*) FROM #pkg
  WHERE (tanggal_order_txt IS NOT NULL AND TRY_CONVERT(date, tanggal_order_txt, 23) IS NULL)
     OR (estimasi_kirim_txt IS NOT NULL AND TRY_CONVERT(date, estimasi_kirim_txt, 23) IS NULL)
     OR (tanggal_kirim_txt IS NOT NULL AND TRY_CONVERT(date, tanggal_kirim_txt, 23) IS NULL)
     OR (order_qty_txt IS NOT NULL AND COALESCE(TRY_CAST(order_qty_txt AS decimal(20,6)), TRY_CAST(TRY_CAST(order_qty_txt AS float) AS decimal(20,6))) IS NULL)
     OR (delivery_qty_txt IS NOT NULL AND COALESCE(TRY_CAST(delivery_qty_txt AS decimal(20,6)), TRY_CAST(TRY_CAST(delivery_qty_txt AS float) AS decimal(20,6))) IS NULL);
  IF @bad > 0
  BEGIN
    SET @msg = CONCAT(@bad, N' baris berisi tanggal atau angka yang tidak terbaca');
    THROW 52023, @msg, 1;
  END
  -- kunci order (distributor, nomor order, produk) dibatasi panjangnya oleh indeks SQL Server
  SELECT @bad = COUNT(*) FROM #pkg
  WHERE LEN(distributor) > 100 OR LEN(order_no) > 50 OR LEN(tipe_produk) > 50 OR LEN(status_order) > 50
     OR LEN(alasan_reject) > 200 OR LEN(kode_customer) > 200 OR LEN(nama_customer) > 200 OR LEN(tipe_pesanan) > 200
     OR LEN(asal_pengiriman) > 200 OR LEN(kode_tujuan) > 200 OR LEN(nama_tujuan) > 200 OR LEN(kota_tujuan) > 200 OR LEN(loco_franco) > 200;
  IF @bad > 0
  BEGIN
    SET @msg = CONCAT(@bad, N' baris berisi teks terlalu panjang (distributor maks 100, nomor order / produk / status maks 50, lainnya maks 200 karakter)');
    THROW 52023, @msg, 1;
  END
  SELECT @bad = COUNT(*) FROM #pkg
  WHERE tanggal_order_txt IS NULL OR TRY_CONVERT(date, tanggal_order_txt, 23) < @from OR TRY_CONVERT(date, tanggal_order_txt, 23) > @to
     OR ISNULL(COALESCE(TRY_CAST(order_qty_txt AS decimal(20,6)), TRY_CAST(TRY_CAST(order_qty_txt AS float) AS decimal(20,6))), 0) < 0
     OR ISNULL(COALESCE(TRY_CAST(delivery_qty_txt AS decimal(20,6)), TRY_CAST(TRY_CAST(delivery_qty_txt AS float) AS decimal(20,6))), 0) < 0
     OR ISNULL(distributor, N'') = N'' OR ISNULL(order_no, N'') = N'' OR ISNULL(tipe_produk, N'') = N''
     OR ISNULL(status_order, N'') = N'' OR ISNULL(kode_customer, N'') = N'' OR ISNULL(tipe_pesanan, N'') = N'';
  IF @bad > 0
  BEGIN
    SET @msg = CONCAT(@bad, N' baris tidak valid (tanggal order di luar rentang / kolom wajib kosong / qty negatif)');
    THROW 52023, @msg, 1;
  END

  BEGIN TRAN;
    INSERT INTO sementrack.sellin_po_staging (upload_id, tanggal_order, distributor, order_no, tipe_produk, status_order, estimasi_kirim,
      tanggal_kirim, alasan_reject, kode_customer, nama_customer, tipe_pesanan, asal_pengiriman, kode_tujuan, nama_tujuan, kota_tujuan,
      loco_franco, order_qty, delivery_qty)
    SELECT @p_upload, TRY_CONVERT(date, tanggal_order_txt, 23), distributor, order_no, tipe_produk, status_order,
      TRY_CONVERT(date, estimasi_kirim_txt, 23), TRY_CONVERT(date, tanggal_kirim_txt, 23), alasan_reject, kode_customer, nama_customer,
      tipe_pesanan, asal_pengiriman, kode_tujuan, nama_tujuan, kota_tujuan, loco_franco,
      COALESCE(TRY_CAST(order_qty_txt AS decimal(20,6)), TRY_CAST(TRY_CAST(order_qty_txt AS float) AS decimal(20,6))),
      COALESCE(TRY_CAST(delivery_qty_txt AS decimal(20,6)), TRY_CAST(TRY_CAST(delivery_qty_txt AS float) AS decimal(20,6)))
    FROM #pkg;
    UPDATE sementrack.sellin_po_upload SET rows_staged = rows_staged + @n WHERE id = @p_upload;
  COMMIT;
  SELECT @n AS n;
END
GO

CREATE OR ALTER PROCEDURE sementrack.sellin_po_impact @p_from date, @p_to date
AS
BEGIN
  SET NOCOUNT ON;
  SELECT COUNT_BIG(*) AS rows_existing, MIN(p.tanggal_order) AS first_date, MAX(p.tanggal_order) AS last_date, MAX(u.posisi) AS posisi
  FROM sementrack.sellin_po p JOIN sementrack.sellin_po_upload u ON u.id = p.upload_id
  WHERE p.tanggal_order BETWEEN @p_from AND @p_to;
END
GO

/* Simpan: order di rentang tanggal order file diganti. Satu order = distributor + nomor order + produk;
   baris pengiriman bertahap digabung (status terlengkap menang: Delivered > Partially Delivered > lainnya). */
CREATE OR ALTER PROCEDURE sementrack.sellin_po_commit @p_upload bigint
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @from date, @to date, @saved int, @replaced int, @ton decimal(20,6), @posisi date, @msg nvarchar(2048);
  BEGIN TRAN;
  SELECT @from = u.date_from, @to = u.date_to FROM sementrack.sellin_po_upload u WITH (UPDLOCK, HOLDLOCK)
  WHERE u.id = @p_upload AND u.status = N'proses';
  IF @@ROWCOUNT = 0
  BEGIN
    SET @msg = CONCAT(N'upload ', @p_upload, N' tidak ditemukan atau sudah selesai');
    THROW 52023, @msg, 1;
  END
  IF NOT EXISTS (SELECT 1 FROM sementrack.sellin_po_staging s WHERE s.upload_id = @p_upload
                 AND sementrack.sellin_rule_produk(s.tipe_pesanan, s.distributor, s.asal_pengiriman, s.tipe_produk) = 1)
    THROW 52023, N'tidak ada baris yang lolos aturan sell in (Gudang / PM toko-project dari ITP-Palembang, tanpa mortar)', 1;

  EXEC sp_getapplock @Resource = N'sementrack.sellin_po', @LockMode = N'Exclusive', @LockOwner = N'Transaction';

  SELECT @posisi = GREATEST(MAX(s.tanggal_kirim), MAX(s.tanggal_order))
  FROM sementrack.sellin_po_staging s WHERE s.upload_id = @p_upload;

  DELETE FROM sementrack.sellin_po WHERE tanggal_order BETWEEN @from AND @to;
  SET @replaced = @@ROWCOUNT;

  -- baris yang lolos aturan disaring sekali, lalu status terlengkap per order dipilih dengan ROW_NUMBER
  -- (subquery per order terlalu lambat untuk file ratusan ribu baris)
  SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.distributor, s.order_no, s.tipe_produk
           ORDER BY CASE LOWER(s.status_order) WHEN N'delivered' THEN 0 WHEN N'partially delivered' THEN 1 ELSE 2 END) AS rn
  INTO #lolos
  FROM sementrack.sellin_po_staging s
  WHERE s.upload_id = @p_upload AND sementrack.sellin_rule_produk(s.tipe_pesanan, s.distributor, s.asal_pengiriman, s.tipe_produk) = 1;

  SELECT s.distributor, s.order_no, s.tipe_produk,
         MIN(s.tanggal_order) AS tanggal_order, MAX(s.estimasi_kirim) AS estimasi_kirim, MAX(s.tanggal_kirim) AS kirim_terakhir,
         MAX(CASE WHEN s.rn = 1 THEN s.status_order END) AS status_order,
         MAX(s.alasan_reject) AS alasan_reject, MAX(s.kode_customer) AS kode_customer, MAX(s.nama_customer) AS nama_customer,
         MAX(s.tipe_pesanan) AS tipe_pesanan, MAX(s.asal_pengiriman) AS asal_pengiriman, MAX(s.kode_tujuan) AS kode_tujuan,
         MAX(s.nama_tujuan) AS nama_tujuan, MAX(s.kota_tujuan) AS kota_tujuan, MAX(s.loco_franco) AS loco_franco,
         ISNULL(MAX(s.order_qty), 0) AS order_qty, ISNULL(SUM(s.delivery_qty), 0) AS delivery_qty,
         SUM(CASE WHEN ISNULL(s.delivery_qty, 0) > 0 THEN 1 ELSE 0 END) AS pengiriman
  INTO #agg
  FROM #lolos s
  GROUP BY s.distributor, s.order_no, s.tipe_produk;
  SET @saved = @@ROWCOUNT;

  -- order yang tanggal ordernya di luar rentang lama tetapi muncul lagi: data file ini yang dipakai
  UPDATE p SET upload_id = @p_upload, tanggal_order = a.tanggal_order, estimasi_kirim = a.estimasi_kirim,
    kirim_terakhir = a.kirim_terakhir, status_order = a.status_order, alasan_reject = a.alasan_reject,
    kode_customer = a.kode_customer, nama_customer = a.nama_customer, tipe_pesanan = a.tipe_pesanan,
    asal_pengiriman = a.asal_pengiriman, kode_tujuan = a.kode_tujuan, nama_tujuan = a.nama_tujuan,
    kota_tujuan = a.kota_tujuan, loco_franco = a.loco_franco, order_qty = a.order_qty,
    delivery_qty = a.delivery_qty, pengiriman = a.pengiriman
  FROM sementrack.sellin_po p
  JOIN #agg a ON a.distributor = p.distributor AND a.order_no = p.order_no AND a.tipe_produk = p.tipe_produk;

  INSERT INTO sementrack.sellin_po (upload_id, distributor, order_no, tipe_produk, tanggal_order, estimasi_kirim, kirim_terakhir,
    status_order, alasan_reject, kode_customer, nama_customer, tipe_pesanan, asal_pengiriman, kode_tujuan, nama_tujuan, kota_tujuan,
    loco_franco, order_qty, delivery_qty, pengiriman)
  SELECT @p_upload, a.distributor, a.order_no, a.tipe_produk, a.tanggal_order, a.estimasi_kirim, a.kirim_terakhir,
    a.status_order, a.alasan_reject, a.kode_customer, a.nama_customer, a.tipe_pesanan, a.asal_pengiriman, a.kode_tujuan, a.nama_tujuan,
    a.kota_tujuan, a.loco_franco, a.order_qty, a.delivery_qty, a.pengiriman
  FROM #agg a
  WHERE NOT EXISTS (SELECT 1 FROM sementrack.sellin_po p
                    WHERE p.distributor = a.distributor AND p.order_no = a.order_no AND p.tipe_produk = a.tipe_produk);

  DELETE FROM sementrack.sellin_po_staging WHERE upload_id = @p_upload;
  UPDATE sementrack.sellin_po_upload
  SET status = N'selesai', finished_at = SYSDATETIMEOFFSET(), rows_saved = @saved, rows_replaced = @replaced, posisi = @posisi
  WHERE id = @p_upload;

  SELECT @ton = ISNULL(SUM(o.sisa_ton), 0) FROM sementrack.v_outstanding_do o
  WHERE o.upload_id = @p_upload AND o.status IN (N'Belum dikirim', N'Terkirim sebagian');
  COMMIT;
  SELECT @saved AS rows_saved, @replaced AS rows_replaced, CAST(ROUND(@ton, 1) AS decimal(20,1)) AS ton_outstanding,
         @from AS date_from, @to AS date_to, @posisi AS posisi;
END
GO

CREATE OR ALTER PROCEDURE sementrack.sellin_po_abort @p_upload bigint
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRAN;
    DELETE FROM sementrack.sellin_po_staging WHERE upload_id = @p_upload;
    UPDATE sementrack.sellin_po_upload SET status = N'batal', finished_at = SYSDATETIMEOFFSET() WHERE id = @p_upload AND status = N'proses';
  COMMIT;
END
GO

/* ============================ peta region customer sell in ============================ */

-- updated_at selalu diperbarui saat baris diubah dari mana pun (PostgreSQL: trigger sellin_region_map_stamp)
CREATE OR ALTER TRIGGER sementrack.sellin_region_map_stamp ON sementrack.sellin_region_map
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE m SET updated_at = SYSDATETIMEOFFSET()
  FROM sementrack.sellin_region_map m JOIN inserted i ON i.kode_customer = m.kode_customer;
END
GO

CREATE OR ALTER PROCEDURE sementrack.sellin_region_set
  @p_kode nvarchar(4000), @p_region nvarchar(4000), @p_nama nvarchar(4000), @p_user nvarchar(200)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @kode nvarchar(4000) = TRIM(@p_kode), @region nvarchar(4000) = TRIM(@p_region), @nama nvarchar(4000) = NULLIF(TRIM(@p_nama), N'');
  IF ISNULL(@kode, N'') = N'' OR ISNULL(@region, N'') = N'' THROW 52023, N'kode customer dan region wajib diisi', 1;
  IF LEN(@kode) > 50 OR LEN(@region) > 200 OR LEN(@nama) > 200 THROW 52023, N'kode customer maks 50 karakter, region dan nama maks 200', 1;
  BEGIN TRAN;
    UPDATE sementrack.sellin_region_map WITH (UPDLOCK, HOLDLOCK)
    SET region = @region, nama_customer = COALESCE(@nama, nama_customer), updated_at = SYSDATETIMEOFFSET(), updated_by = @p_user
    WHERE kode_customer = @kode;
    IF @@ROWCOUNT = 0
      INSERT INTO sementrack.sellin_region_map (kode_customer, region, nama_customer, updated_at, updated_by)
      VALUES (@kode, @region, @nama, SYSDATETIMEOFFSET(), @p_user);
  COMMIT;
END
GO
