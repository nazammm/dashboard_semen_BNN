/* =============================================================================
   SEMENTRACK di SQL Server 2022, tahap 4a: upload transaksi J028 (Kelola Data → Transaksi).
   Prosedur: transaksi_begin, transaksi_stage, transaksi_impact, transaksi_commit, transaksi_abort.
   Jalankan di MARKETING_ANALIS. Aman dijalankan ulang.

   Pola yang sama dipakai semua prosedur tulis di tahap 4:
   - Pesan untuk pengguna dilempar dengan nomor 52023 (di PostgreSQL: errcode 22023). Backend
     menampilkan pesan bernomor 52023 apa adanya (HTTP 400); kesalahan lain hanya dicatat di log server.
   - Array dikirim sebagai teks JSON, misalnya ["BKP","KTP"].
   - Satu prosedur = satu transaksi (SET XACT_ABORT ON): kalau gagal di tengah, semuanya dibatalkan.
   - Hasil dikembalikan sebagai SELECT dengan nama kolom yang sama dengan fungsi PostgreSQL.

   Perbedaan dari PostgreSQL:
   - Trigger ensure_transaksi_customer (toko baru otomatis masuk tabel toko) dipindah ke dalam
     transaksi_commit, tepat sebelum baris transaksi disimpan.
   - Trigger refresh materialized view tidak perlu lagi (view dihitung langsung, lihat 04_transaksi.sql).
============================================================================= */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- Trigger PostgreSQL tidak ada padanannya di sini; pastikan tidak ada sisa trigger dengan nama sama.
IF OBJECT_ID(N'dbo.transaksi_ensure_customer', N'TR') IS NOT NULL DROP TRIGGER dbo.transaksi_ensure_customer;
GO

/* Mulai upload: catat di kelola_log, kembalikan id. Upload "proses" yang menggantung > 6 jam dibatalkan. */
CREATE OR ALTER PROCEDURE sementrack.transaksi_begin
  @p_user nvarchar(200), @p_source nvarchar(50), @p_file nvarchar(4000), @p_from date, @p_to date,
  @p_dists nvarchar(max), @p_rows_read int
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @p_from IS NULL OR @p_to IS NULL OR @p_from > @p_to THROW 52023, N'rentang tanggal tidak valid', 1;

  DECLARE @dists nvarchar(max) = (
    SELECT N'[' + STRING_AGG(N'"' + STRING_ESCAPE(d, 'json') + N'"', N',') WITHIN GROUP (ORDER BY d) + N']'
    FROM (SELECT DISTINCT TRIM(v) AS d FROM OPENJSON(ISNULL(@p_dists, N'[]')) WITH (v nvarchar(200) '$') WHERE v IS NOT NULL) x);
  IF @dists IS NULL THROW 52023, N'distributor di file tidak terbaca', 1;

  DECLARE @stale TABLE (id bigint);
  DECLARE @id bigint;
  BEGIN TRAN;
    UPDATE sementrack.kelola_log SET status = N'batal', finished_at = SYSDATETIMEOFFSET()
    OUTPUT inserted.id INTO @stale
    WHERE dataset = N'transaksi' AND aksi = N'upload' AND status = N'proses' AND created_at < DATEADD(hour, -6, SYSDATETIMEOFFSET());
    DELETE s FROM sementrack.transaksi_staging s JOIN @stale x ON x.id = s.log_id;

    INSERT INTO sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes, rows_read)
    VALUES (N'transaksi', N'upload', @p_user, CASE WHEN @p_source = N'tempel' THEN N'tempel' ELSE N'file' END, LEFT(@p_file, 200),
            @p_from, @p_to, @dists, CASE WHEN ISNULL(@p_rows_read, 0) < 0 THEN 0 ELSE ISNULL(@p_rows_read, 0) END);
    SET @id = SCOPE_IDENTITY();
  COMMIT;
  SELECT @id AS id;
END
GO

/* Terima satu paket baris (array JSON berisi array 22 nilai, urutan kolom sama dengan transaksi_staging). */
CREATE OR ALTER PROCEDURE sementrack.transaksi_stage @p_log bigint, @p_rows nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @from date, @to date, @dists nvarchar(max), @n int, @bad int, @msg nvarchar(2048);

  SELECT @from = date_from, @to = date_to, @dists = dist_codes
  FROM sementrack.kelola_log WHERE id = @p_log AND dataset = N'transaksi' AND aksi = N'upload' AND status = N'proses';
  IF @@ROWCOUNT = 0
  BEGIN
    SET @msg = CONCAT(N'upload ', @p_log, N' tidak ditemukan atau sudah selesai');
    THROW 52023, @msg, 1;
  END
  IF ISJSON(@p_rows) = 0 OR LEFT(LTRIM(@p_rows), 1) <> N'[' THROW 52023, N'format paket tidak valid', 1;

  SELECT * INTO #raw FROM OPENJSON(@p_rows) WITH (
    c0 nvarchar(4000) '$[0]', c1 nvarchar(4000) '$[1]', c2 nvarchar(4000) '$[2]', c3 nvarchar(4000) '$[3]',
    c4 nvarchar(4000) '$[4]', c5 nvarchar(4000) '$[5]', c6 nvarchar(4000) '$[6]', c7 nvarchar(4000) '$[7]',
    c8 nvarchar(4000) '$[8]', c9 nvarchar(4000) '$[9]', c10 nvarchar(4000) '$[10]', c11 nvarchar(4000) '$[11]',
    c12 nvarchar(4000) '$[12]', c13 nvarchar(4000) '$[13]', c14 nvarchar(4000) '$[14]',
    c15 nvarchar(100) '$[15]', c16 nvarchar(100) '$[16]', c17 nvarchar(100) '$[17]', c18 nvarchar(100) '$[18]',
    c19 nvarchar(4000) '$[19]', c20 nvarchar(4000) '$[20]', c21 nvarchar(100) '$[21]');

  -- teks: trim, kosong = NULL; angka: boleh notasi ilmiah (1e3)
  SELECT NULLIF(TRIM(c0), N'') AS dist_code, NULLIF(TRIM(c1), N'') AS distributor_name, NULLIF(c2, N'') AS do_date_txt,
         NULLIF(TRIM(c3), N'') AS do_no, NULLIF(TRIM(c4), N'') AS mss_no_order, NULLIF(TRIM(c5), N'') AS payment,
         NULLIF(TRIM(c6), N'') AS customer_code, NULLIF(TRIM(c7), N'') AS customer_name,
         NULLIF(TRIM(c8), N'') AS parent_customer_code, NULLIF(TRIM(c9), N'') AS parent_customer_name,
         NULLIF(TRIM(c10), N'') AS cust_group, NULLIF(TRIM(c11), N'') AS delivery_type,
         NULLIF(TRIM(c12), N'') AS product_code, NULLIF(TRIM(c13), N'') AS product_name, NULLIF(TRIM(c14), N'') AS destination,
         c15, c16, c17, c18, NULLIF(TRIM(c19), N'') AS salesman_code, NULLIF(TRIM(c20), N'') AS sales_tim, c21
  INTO #pkg FROM #raw;
  SET @n = @@ROWCOUNT;

  -- angka dan tanggal yang tidak terbaca
  SELECT @bad = COUNT(*) FROM #pkg
  WHERE (do_date_txt IS NOT NULL AND TRY_CONVERT(date, do_date_txt, 23) IS NULL)
     OR (c15 IS NOT NULL AND COALESCE(TRY_CAST(c15 AS decimal(20,6)), TRY_CAST(TRY_CAST(c15 AS float) AS decimal(20,6))) IS NULL)
     OR (c16 IS NOT NULL AND COALESCE(TRY_CAST(c16 AS decimal(20,6)), TRY_CAST(TRY_CAST(c16 AS float) AS decimal(20,6))) IS NULL)
     OR (c17 IS NOT NULL AND COALESCE(TRY_CAST(c17 AS decimal(20,6)), TRY_CAST(TRY_CAST(c17 AS float) AS decimal(20,6))) IS NULL)
     OR (c18 IS NOT NULL AND COALESCE(TRY_CAST(c18 AS decimal(20,6)), TRY_CAST(TRY_CAST(c18 AS float) AS decimal(20,6))) IS NULL)
     OR (c21 IS NOT NULL AND COALESCE(TRY_CAST(c21 AS decimal(20,6)), TRY_CAST(TRY_CAST(c21 AS float) AS decimal(20,6))) IS NULL);
  IF @bad > 0
  BEGIN
    SET @msg = CONCAT(@bad, N' baris berisi tanggal atau angka yang tidak terbaca');
    THROW 52023, @msg, 1;
  END

  -- isi terlalu panjang untuk kolom tabel transaksi
  SELECT @bad = COUNT(*) FROM #pkg
  WHERE LEN(dist_code) > 50 OR LEN(customer_code) > 50 OR LEN(product_code) > 50 OR LEN(salesman_code) > 50 OR LEN(parent_customer_code) > 50
     OR LEN(distributor_name) > 200 OR LEN(do_no) > 200 OR LEN(mss_no_order) > 200 OR LEN(payment) > 200 OR LEN(customer_name) > 200
     OR LEN(parent_customer_name) > 200 OR LEN(cust_group) > 200 OR LEN(delivery_type) > 200 OR LEN(product_name) > 200
     OR LEN(destination) > 200 OR LEN(sales_tim) > 200;
  IF @bad > 0
  BEGIN
    SET @msg = CONCAT(@bad, N' baris berisi teks terlalu panjang (kode maks 50 karakter, teks lain maks 200)');
    THROW 52023, @msg, 1;
  END

  SELECT @bad = COUNT(*) FROM #pkg p
  WHERE p.do_date_txt IS NULL OR TRY_CONVERT(date, p.do_date_txt, 23) < @from OR TRY_CONVERT(date, p.do_date_txt, 23) > @to
     OR p.do_no IS NULL OR p.dist_code IS NULL
     OR NOT EXISTS (SELECT 1 FROM OPENJSON(@dists) WITH (v nvarchar(200) '$') d WHERE d.v = p.dist_code)
     OR p.customer_code IS NULL OR p.product_code IS NULL;
  IF @bad > 0
  BEGIN
    SET @msg = CONCAT(@bad, N' baris tidak valid (tanggal di luar rentang / do_no, dist_code, customer_code, product_code kosong)');
    THROW 52023, @msg, 1;
  END

  BEGIN TRAN;
    INSERT INTO sementrack.transaksi_staging (log_id, dist_code, distributor_name, do_date, do_no, mss_no_order, payment,
      customer_code, customer_name, parent_customer_code, parent_customer_name, cust_group, delivery_type, product_code,
      product_name, destination, order_qty, bonus_qty, total_qty, net_amount, salesman_code, sales_tim, pelunasan_hari)
    SELECT @p_log, dist_code, distributor_name, TRY_CONVERT(date, do_date_txt, 23), do_no, mss_no_order, payment,
      customer_code, customer_name, parent_customer_code, parent_customer_name, cust_group, delivery_type, product_code,
      product_name, destination,
      COALESCE(TRY_CAST(c15 AS decimal(20,6)), TRY_CAST(TRY_CAST(c15 AS float) AS decimal(20,6))),
      COALESCE(TRY_CAST(c16 AS decimal(20,6)), TRY_CAST(TRY_CAST(c16 AS float) AS decimal(20,6))),
      COALESCE(TRY_CAST(c17 AS decimal(20,6)), TRY_CAST(TRY_CAST(c17 AS float) AS decimal(20,6))),
      COALESCE(TRY_CAST(c18 AS decimal(20,6)), TRY_CAST(TRY_CAST(c18 AS float) AS decimal(20,6))),
      salesman_code, sales_tim,
      COALESCE(TRY_CAST(c21 AS decimal(20,6)), TRY_CAST(TRY_CAST(c21 AS float) AS decimal(20,6)))
    FROM #pkg;
    UPDATE sementrack.kelola_log SET rows_staged = rows_staged + @n WHERE id = @p_log;
  COMMIT;
  SELECT @n AS n;
END
GO

/* Berapa baris yang akan terganti oleh upload ini (ditampilkan sebelum pengguna menyetujui). */
CREATE OR ALTER PROCEDURE sementrack.transaksi_impact @p_from date, @p_to date, @p_dists nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT t.dist_code, COUNT_BIG(*) AS baris, COUNT_BIG(DISTINCT t.do_no) AS jumlah_do
  FROM dbo.transaksi t
  WHERE t.do_date BETWEEN @p_from AND @p_to
    AND t.dist_code IN (SELECT v FROM OPENJSON(ISNULL(@p_dists, N'[]')) WITH (v nvarchar(200) '$'))
  GROUP BY t.dist_code
  ORDER BY t.dist_code;
END
GO

/* Simpan: hapus transaksi distributor-distributor itu di rentang tanggal file, lalu isi dari staging. */
CREATE OR ALTER PROCEDURE sementrack.transaksi_commit @p_log bigint
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @from date, @to date, @dists nvarchar(max), @user nvarchar(200), @saved int, @deleted int,
          @dup nvarchar(max), @dup_n int, @msg nvarchar(2048), @wib datetimeoffset(3) = SWITCHOFFSET(SYSDATETIMEOFFSET(), '+07:00');

  BEGIN TRAN;
  SELECT @from = l.date_from, @to = l.date_to, @dists = l.dist_codes, @user = l.created_by
  FROM sementrack.kelola_log l WITH (UPDLOCK, HOLDLOCK)
  WHERE l.id = @p_log AND l.dataset = N'transaksi' AND l.aksi = N'upload' AND l.status = N'proses';
  IF @@ROWCOUNT = 0
  BEGIN
    SET @msg = CONCAT(N'upload ', @p_log, N' tidak ditemukan atau sudah selesai');
    THROW 52023, @msg, 1;
  END
  IF NOT EXISTS (SELECT 1 FROM sementrack.transaksi_staging s WHERE s.log_id = @p_log)
    THROW 52023, N'tidak ada baris untuk disimpan', 1;

  -- Nomor DO unik per distributor. DO distributor yang sama yang sudah ada di LUAR rentang tanggal file
  -- = kemungkinan data dobel / tanggal salah: tolak.
  SELECT @dup_n = COUNT(*),
         @dup = STRING_AGG(CASE WHEN rn <= 5 THEN dist_code + N' ' + do_no END, N', ') WITHIN GROUP (ORDER BY rn)
  FROM (SELECT s.dist_code, s.do_no, ROW_NUMBER() OVER (ORDER BY s.dist_code, s.do_no) AS rn
        FROM (SELECT DISTINCT dist_code, do_no FROM sementrack.transaksi_staging WHERE log_id = @p_log) s
        WHERE EXISTS (SELECT 1 FROM dbo.transaksi t WHERE t.dist_code = s.dist_code AND t.do_no = s.do_no
                      AND NOT (t.do_date BETWEEN @from AND @to))) x;
  IF @dup_n > 0
  BEGIN
    SET @msg = CONCAT(@dup_n, N' nomor DO di file sudah ada di tanggal lain untuk distributor yang sama, mis. ', @dup, N'. Periksa file agar tidak dobel.');
    THROW 52023, @msg, 1;
  END

  -- Kode produk / distributor harus sudah ada di master.
  SELECT @dup = STRING_AGG(x, N', ') WITHIN GROUP (ORDER BY x)
  FROM (SELECT TOP (10) x FROM (SELECT DISTINCT s.product_code AS x FROM sementrack.transaksi_staging s
        WHERE s.log_id = @p_log AND NOT EXISTS (SELECT 1 FROM dbo.produk p WHERE p.kode = s.product_code)) d ORDER BY x) z;
  IF @dup IS NOT NULL
  BEGIN
    SET @msg = CONCAT(N'Kode produk belum terdaftar di master produk: ', @dup, N'. Tambahkan dulu ke tabel produk.');
    THROW 52023, @msg, 1;
  END
  SELECT @dup = STRING_AGG(x, N', ') WITHIN GROUP (ORDER BY x)
  FROM (SELECT TOP (10) x FROM (SELECT DISTINCT s.dist_code AS x FROM sementrack.transaksi_staging s
        WHERE s.log_id = @p_log AND NOT EXISTS (SELECT 1 FROM dbo.distributor d WHERE d.dist_code = s.dist_code)) d ORDER BY x) z;
  IF @dup IS NOT NULL
  BEGIN
    SET @msg = CONCAT(N'Kode distributor belum terdaftar di master distributor: ', @dup, N'.');
    THROW 52023, @msg, 1;
  END

  -- satu simpan transaksi dalam satu waktu (PostgreSQL: LOCK TABLE ... SHARE ROW EXCLUSIVE)
  EXEC sp_getapplock @Resource = N'sementrack.transaksi', @LockMode = N'Exclusive', @LockOwner = N'Transaction';

  DELETE FROM dbo.transaksi
  WHERE do_date BETWEEN @from AND @to
    AND dist_code IN (SELECT v FROM OPENJSON(@dists) WITH (v nvarchar(200) '$'));
  SET @deleted = @@ROWCOUNT;

  -- toko baru otomatis masuk master toko (PostgreSQL: trigger ensure_transaksi_customer)
  INSERT INTO dbo.toko (cust_code, cust_name, dist_code, dist_name, latitude, longitude, zona)
  SELECT s.customer_code, MAX(NULLIF(TRIM(s.customer_name), N'')), MAX(NULLIF(TRIM(s.dist_code), N'')),
         MAX(NULLIF(TRIM(s.distributor_name), N'')), 0, 0, N'0'
  FROM sementrack.transaksi_staging s
  WHERE s.log_id = @p_log AND s.customer_code IS NOT NULL AND TRIM(s.customer_code) <> N''
    AND NOT EXISTS (SELECT 1 FROM dbo.toko t WHERE t.cust_code = s.customer_code)
  GROUP BY s.customer_code;

  INSERT INTO dbo.transaksi (dist_code, distributor_name, do_date, do_no, mss_no_order, payment, customer_code, customer_name,
    parent_customer_code, parent_customer_name, cust_group, delivery_type, product_code, product_name, destination,
    order_qty, bonus_qty, total_qty, net_amount, salesman_code, sales_tim, pelunasan_hari)
  SELECT dist_code, distributor_name, do_date, do_no, mss_no_order, payment, customer_code, customer_name,
    parent_customer_code, parent_customer_name, cust_group, delivery_type, product_code, product_name, destination,
    order_qty, bonus_qty, total_qty, net_amount, salesman_code, sales_tim, pelunasan_hari
  FROM sementrack.transaksi_staging WHERE log_id = @p_log;
  SET @saved = @@ROWCOUNT;

  DELETE FROM sementrack.transaksi_staging WHERE log_id = @p_log;
  UPDATE sementrack.kelola_log SET status = N'selesai', finished_at = SYSDATETIMEOFFSET(), rows_saved = @saved, rows_deleted = @deleted
  WHERE id = @p_log;

  -- status sinkronisasi (info "diperbarui" di web), jam WIB dibulatkan ke menit
  UPDATE dbo.status_sync
  SET tanggal_update = CAST(@wib AS date),
      jam_update = TIMEFROMPARTS(DATEPART(hour, @wib), DATEPART(minute, @wib), 0, 0, 0),
      keterangan = LEFT(N'Upload transaksi lewat web oleh ' + @user, 200)
  WHERE id = 1;
  COMMIT;

  SELECT @saved AS rows_saved, @deleted AS rows_deleted, @from AS date_from, @to AS date_to, @dists AS dist_codes;
END
GO

CREATE OR ALTER PROCEDURE sementrack.transaksi_abort @p_log bigint
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  BEGIN TRAN;
    DELETE FROM sementrack.transaksi_staging WHERE log_id = @p_log;
    UPDATE sementrack.kelola_log SET status = N'batal', finished_at = SYSDATETIMEOFFSET()
    WHERE id = @p_log AND dataset = N'transaksi' AND status = N'proses';
  COMMIT;
END
GO
