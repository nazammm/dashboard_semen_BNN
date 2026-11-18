/* ============================================================================
   17_ongkos_kirim.sql · Ongkos kirim ke toko (ORDB019) + J073 lengkap
   - sementrack.sellout_j073 dapat kolom pengiriman dari J073 (tipe kirim, zona, harga kirim per unit,
     diskon, tambahan, handling, qty terkirim, kecamatan, kabupaten). Upload J073 lama (10 kolom) tetap diterima.
   - Distributor J073 baru (kode ERP) otomatis terdaftar saat upload. Distributor tanpa aturan
     sellout_j073_aturan tidak masuk Sell Out BNN, hanya dipakai halaman Ongkos Kirim.
   - sementrack.ongkos_kirim: baris laporan ORDB019 (Monthly Delivery Cost), satu upload = satu distributor x satu bulan.
     Ongkos di sini adalah ongkos kirim dari gudang distributor ke toko.
   - View untuk halaman Ongkos Kirim: v_ongkos_trip (per perjalanan / No FOAD), v_ongkos_do (per DO, dengan tagihan
     ongkos dari J073), v_ongkos_info (bulan dan distributor yang tersedia).
   INSA-E tidak punya J073 / ORDB019 sendiri: datanya ikut INSA (4094).
   Jalankan di SSMS, database MARKETING_ANALIS, setelah 03_sellout.sql dan 11_stock.sql. Aman dijalankan ulang.
============================================================================ */

/* ---------- 1. J073: kolom pengiriman ---------- */
IF COL_LENGTH(N'sementrack.sellout_j073', N'delivery_type') IS NULL
  ALTER TABLE sementrack.sellout_j073 ADD
    delivery_type nvarchar(100) NULL,     -- "FF - KIRIM DIBONGKAR", "LG - AMBIL DI GUDANG", ...
    zona_kirim nvarchar(100) NULL,        -- Zone Pengiriman
    harga_kirim decimal(20,6) NULL,       -- Delivery Price per unit
    diskon_kirim decimal(20,6) NULL,      -- Delivery Discount Price per unit
    tambah_kirim decimal(20,6) NULL,      -- Delivery Add Price per unit
    handling decimal(20,6) NULL,          -- Handling Cost per unit
    qty_kirim decimal(20,6) NULL,         -- Qty Delivery
    kecamatan nvarchar(200) NULL,
    kabupaten nvarchar(200) NULL;
GO
IF COL_LENGTH(N'sementrack.sellout_j073', N'cust_group') IS NULL
  ALTER TABLE sementrack.sellout_j073 ADD cust_group nvarchar(100) NULL;   -- NULL = RETAIL (upload lama hanya berisi RETAIL)
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sellout_j073_dist_do_idx' AND object_id = OBJECT_ID(N'sementrack.sellout_j073'))
  CREATE INDEX sellout_j073_dist_do_idx ON sementrack.sellout_j073 (dist_code, do_no);
GO

/* ---------- 2. upload J073 ----------
   Baris: [dist_code, do_date, do_no, customer_code, customer_name, product_code, product_name, order_qty, net_amount, warehouse,
           delivery_type, zona_kirim, harga_kirim, diskon_kirim, tambah_kirim, handling, qty_kirim, kecamatan, kabupaten, cust_group]
   (10 kolom pertama wajib, sisanya boleh tidak ada). Cust group selain RETAIL (proyek) disimpan untuk Ongkos Kirim, tidak masuk Sell Out. Per distributor, data di rentang tanggal file diganti. */
CREATE OR ALTER PROCEDURE sementrack.sellout_j073_simpan @p_rows nvarchar(max), @p_user nvarchar(200), @p_file nvarchar(4000) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @old int, @new int, @ton decimal(24,8), @from date, @to date, @dists nvarchar(max), @b int, @msg nvarchar(2048);
  IF ISJSON(@p_rows) = 0 OR LEFT(LTRIM(@p_rows), 1) <> N'[' OR NOT EXISTS (SELECT 1 FROM OPENJSON(@p_rows))
    THROW 52023, N'Tidak ada baris J073', 1;

  SELECT CAST(r.[key] AS int) + 1 AS baris,
         TRIM(JSON_VALUE(r.[value], '$[0]')) AS dist_code, JSON_VALUE(r.[value], '$[1]') AS do_date_txt,
         TRIM(JSON_VALUE(r.[value], '$[2]')) AS do_no, TRIM(JSON_VALUE(r.[value], '$[3]')) AS customer_code,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[4]')), N'') AS customer_name, UPPER(TRIM(JSON_VALUE(r.[value], '$[5]'))) AS product_code,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[6]')), N'') AS product_name, JSON_VALUE(r.[value], '$[7]') AS qty_txt,
         JSON_VALUE(r.[value], '$[8]') AS net_txt, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[9]'))), N'') AS warehouse,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[10]')), N'') AS delivery_type, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[11]'))), N'') AS zona_kirim,
         JSON_VALUE(r.[value], '$[12]') AS harga_txt, JSON_VALUE(r.[value], '$[13]') AS diskon_txt, JSON_VALUE(r.[value], '$[14]') AS tambah_txt,
         JSON_VALUE(r.[value], '$[15]') AS handling_txt, JSON_VALUE(r.[value], '$[16]') AS qtykirim_txt,
         NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[17]'))), N'') AS kecamatan, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[18]'))), N'') AS kabupaten,
         NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[19]'))), N'') AS cust_group
  INTO #raw FROM OPENJSON(@p_rows) r;

  SELECT @b = MIN(baris) FROM #raw
  WHERE (do_date_txt IS NOT NULL AND TRY_CONVERT(date, do_date_txt, 23) IS NULL)
     OR (qty_txt IS NOT NULL AND sementrack.angka(qty_txt) IS NULL) OR (net_txt IS NOT NULL AND sementrack.angka(net_txt) IS NULL);
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Tanggal atau angka tidak terbaca (baris ', @b, N')'); THROW 52023, @msg, 1; END

  SELECT baris, dist_code, TRY_CONVERT(date, do_date_txt, 23) AS do_date, do_no, customer_code, customer_name, product_code, product_name,
         sementrack.angka(qty_txt) AS order_qty, ISNULL(sementrack.angka(net_txt), 0) AS net_amount, warehouse,
         delivery_type, zona_kirim, sementrack.angka(harga_txt) AS harga_kirim, sementrack.angka(diskon_txt) AS diskon_kirim,
         sementrack.angka(tambah_txt) AS tambah_kirim, sementrack.angka(handling_txt) AS handling, sementrack.angka(qtykirim_txt) AS qty_kirim,
         kecamatan, kabupaten, cust_group
  INTO #j FROM #raw;

  SELECT @b = MIN(baris) FROM #j
  WHERE ISNULL(dist_code, N'') = N'' OR do_date IS NULL OR ISNULL(do_no, N'') = N''
     OR ISNULL(customer_code, N'') = N'' OR ISNULL(product_code, N'') = N'' OR order_qty IS NULL;
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Baris J073 tidak lengkap (baris ', @b, N')'); THROW 52023, @msg, 1; END
  SELECT @b = MIN(baris) FROM #j
  WHERE LEN(dist_code) > 50 OR LEN(do_no) > 200 OR LEN(customer_code) > 200 OR LEN(customer_name) > 200
     OR LEN(product_code) > 200 OR LEN(product_name) > 200 OR LEN(warehouse) > 200
     OR LEN(delivery_type) > 100 OR LEN(zona_kirim) > 100 OR LEN(kecamatan) > 200 OR LEN(kabupaten) > 200 OR LEN(cust_group) > 100;
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Teks terlalu panjang (baris ', @b, N')'); THROW 52023, @msg, 1; END

  BEGIN TRAN;
  EXEC sp_getapplock @Resource = N'sellout_j073', @LockMode = N'Exclusive', @LockOwner = N'Transaction';
  -- distributor baru: didaftarkan tanpa aturan Sell Out (nama dari master distributor kalau kode ERP-nya terdaftar)
  INSERT INTO sementrack.sellout_j073_dist (dist_code, nama, j028_dist)
  SELECT x.dist_code, ISNULL((SELECT TOP (1) d.dist_code FROM dbo.distributor d WHERE d.kode_erp = x.dist_code), x.dist_code), NULL
  FROM (SELECT DISTINCT dist_code FROM #j) x
  WHERE NOT EXISTS (SELECT 1 FROM sementrack.sellout_j073_dist d WHERE d.dist_code = x.dist_code);

  DELETE j FROM sementrack.sellout_j073 j
  JOIN (SELECT dist_code, MIN(do_date) AS a, MAX(do_date) AS b FROM #j GROUP BY dist_code) r
    ON j.dist_code = r.dist_code AND j.do_date BETWEEN r.a AND r.b;
  SET @old = @@ROWCOUNT;

  INSERT INTO sementrack.sellout_j073 (dist_code, do_date, do_no, customer_code, customer_name, product_code, product_name, order_qty, net_amount, warehouse,
                                       delivery_type, zona_kirim, harga_kirim, diskon_kirim, tambah_kirim, handling, qty_kirim, kecamatan, kabupaten, cust_group)
  SELECT dist_code, do_date, do_no, customer_code, customer_name, product_code, product_name, order_qty, net_amount, warehouse,
         delivery_type, zona_kirim, harga_kirim, diskon_kirim, tambah_kirim, handling, qty_kirim, kecamatan, kabupaten,
         CASE WHEN cust_group = N'RETAIL' THEN NULL ELSE cust_group END FROM #j;

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

/* ---------- 3. ORDB019 ---------- */
IF OBJECT_ID(N'sementrack.ongkos_kirim', N'U') IS NULL
CREATE TABLE sementrack.ongkos_kirim (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_ongkos_kirim PRIMARY KEY,
  dist_code nvarchar(50) NOT NULL,          -- kode ERP distributor (4094, 9575, 1001K, ...)
  periode date NOT NULL,                    -- tanggal 1 bulan laporan
  kirim_date date NULL,                     -- kolom Date di ORDB019
  do_no nvarchar(50) NOT NULL,
  foad nvarchar(50) NOT NULL,               -- No Foad = satu perjalanan truk
  segmen nvarchar(50) NULL,                 -- RETAIL / PROJECT
  transporter nvarchar(200) NULL,
  truk nvarchar(100) NULL,
  asal nvarchar(200) NULL,                  -- gudang asal distributor
  tujuan nvarchar(200) NULL,                -- kecamatan toko
  zona nvarchar(100) NULL,                  -- Zone DO
  harga_ritase decimal(20,2) NULL,          -- tarif kontrak per perjalanan
  kategori nvarchar(100) NULL,
  product_code nvarchar(50) NULL,
  product_name nvarchar(200) NULL,
  delivery nvarchar(50) NULL,               -- LOCO / FRANCO
  qty decimal(20,4) NOT NULL,
  harga_uom decimal(20,4) NULL,
  total decimal(20,2) NOT NULL,             -- ongkos tercatat untuk baris ini
  ton decimal(20,6) NOT NULL                -- semen & semen putih saja, lainnya 0
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ongkos_kirim_dist_periode_idx' AND object_id = OBJECT_ID(N'sementrack.ongkos_kirim'))
  CREATE INDEX ongkos_kirim_dist_periode_idx ON sementrack.ongkos_kirim (dist_code, periode) INCLUDE (do_no, foad, total, ton);
GO

ALTER TABLE sementrack.kelola_log DROP CONSTRAINT IF EXISTS CK_kelola_log_dataset_check;
ALTER TABLE sementrack.kelola_log ADD CONSTRAINT CK_kelola_log_dataset_check
  CHECK (dataset IN (N'transaksi', N'sellin', N'dofas', N'erp', N'j073', N'target', N'outstanding', N'tabel', N'stock', N'ongkos'));
GO

/* Baris: [dist_code, periode (YYYY-MM-01), kirim_date, do_no, foad, segmen, transporter, truk, asal, tujuan, zona, harga_ritase,
           kategori, product_code, product_name, delivery, qty, harga_uom, total].
   Untuk tiap (distributor, bulan) di file, isi lama diganti seluruhnya. */
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

/* ---------- 4. view halaman Ongkos Kirim ---------- */
-- Nama distributor dashboard untuk kode ERP (INSA-E ikut INSA)
CREATE OR ALTER VIEW sementrack.v_ongkos_dist AS
SELECT x.dist_code, ISNULL(d.dist_code, x.dist_code) AS kode, ISNULL(d.dist_name, x.dist_code) AS nama
FROM (SELECT DISTINCT dist_code FROM sementrack.ongkos_kirim) x
OUTER APPLY (SELECT TOP (1) d.dist_code, d.dist_name FROM dbo.distributor d WHERE d.kode_erp = x.dist_code ORDER BY d.dist_code) d;
GO

-- Satu baris per perjalanan (No FOAD): biaya = semua baris perjalanan itu, ton = semen & semen putih
CREATE OR ALTER VIEW sementrack.v_ongkos_trip AS
SELECT k.dist_code, k.periode, k.foad, MIN(k.kirim_date) AS kirim_date,
       MAX(k.transporter) AS transporter, MAX(k.truk) AS truk, MAX(k.asal) AS asal, MAX(k.zona) AS zona, MAX(k.tujuan) AS tujuan,
       MAX(k.segmen) AS segmen, MAX(k.harga_ritase) AS harga_ritase, SUM(k.total) AS biaya, SUM(k.ton) AS ton,
       COUNT(DISTINCT k.do_no) AS jumlah_do
FROM sementrack.ongkos_kirim k
GROUP BY k.dist_code, k.periode, k.foad;
GO

-- Satu baris per DO yang dikirim pada bulan itu (semen & semen putih), dengan data J073 DO tersebut:
-- toko, tipe kirim, zona kirim, omzet DO, tagihan ongkos ke toko = (harga kirim - diskon + tambahan) x qty, handling x qty.
-- DO yang terkirim sebagian di bulan ini: omzet, tagihan, dan handling dibagi menurut ton terkirim.
CREATE OR ALTER VIEW sementrack.v_ongkos_do AS
SELECT k.dist_code, k.periode, k.do_no, k.biaya, k.ton_kirim, k.trip, k.trip_tanpa_biaya, k.truk, k.transporter, k.zona, k.segmen, k.tujuan,
       j.do_date, j.customer_code, j.customer_name, j.delivery_type,
       LEFT(j.delivery_type, CHARINDEX(N' ', j.delivery_type + N' ') - 1) AS tipe_kirim,
       j.zona_kirim, j.kecamatan, j.kabupaten, j.ton_do,
       CASE WHEN j.ton_do > 0 THEN j.net * k.ton_kirim / j.ton_do END AS omzet,
       CASE WHEN j.ton_do > 0 AND j.delivery_type IS NOT NULL THEN j.tagih * k.ton_kirim / j.ton_do END AS tagih,
       CASE WHEN j.ton_do > 0 AND j.delivery_type IS NOT NULL THEN j.handling * k.ton_kirim / j.ton_do END AS handling
FROM (
  SELECT o.dist_code, o.periode, o.do_no, SUM(o.total) AS biaya, SUM(o.ton) AS ton_kirim, COUNT(DISTINCT o.foad) AS trip,
         COUNT(DISTINCT CASE WHEN f.biaya = 0 THEN o.foad END) AS trip_tanpa_biaya,   -- perjalanan yang tagihan transporternya belum masuk
         MAX(o.truk) AS truk, MAX(o.transporter) AS transporter, MAX(o.zona) AS zona, MAX(o.segmen) AS segmen, MAX(o.tujuan) AS tujuan
  FROM sementrack.ongkos_kirim o
  JOIN (SELECT dist_code, periode, foad, SUM(total) AS biaya FROM sementrack.ongkos_kirim GROUP BY dist_code, periode, foad) f
    ON f.dist_code = o.dist_code AND f.periode = o.periode AND f.foad = o.foad
  WHERE o.ton > 0
  GROUP BY o.dist_code, o.periode, o.do_no
) k
OUTER APPLY (
  SELECT MIN(s.do_date) AS do_date, MAX(s.customer_code) AS customer_code, MAX(s.customer_name) AS customer_name,
         MAX(s.delivery_type) AS delivery_type, MAX(s.zona_kirim) AS zona_kirim, MAX(s.kecamatan) AS kecamatan, MAX(s.kabupaten) AS kabupaten,
         SUM(sementrack.j073_ton(s.product_code, s.product_name, s.order_qty)) AS ton_do, SUM(s.net_amount) AS net,
         SUM((ISNULL(s.harga_kirim, 0) - ISNULL(s.diskon_kirim, 0) + ISNULL(s.tambah_kirim, 0)) * s.order_qty) AS tagih,
         SUM(ISNULL(s.handling, 0) * s.order_qty) AS handling
  FROM sementrack.sellout_j073 s
  WHERE s.dist_code = k.dist_code AND s.do_no = k.do_no
) j;
GO

-- Bulan dan distributor yang tersedia + kelengkapan biaya
CREATE OR ALTER VIEW sementrack.v_ongkos_info AS
SELECT t.dist_code, d.kode, d.nama, t.periode, COUNT(*) AS trip, SUM(t.ton) AS ton,
       SUM(CASE WHEN t.biaya > 0 THEN t.ton ELSE 0 END) AS ton_berbiaya, SUM(t.biaya) AS biaya,
       (SELECT MAX(do_date) FROM sementrack.sellout_j073 j WHERE j.dist_code = t.dist_code) AS j073_sampai
FROM sementrack.v_ongkos_trip t JOIN sementrack.v_ongkos_dist d ON d.dist_code = t.dist_code
WHERE t.ton > 0
GROUP BY t.dist_code, d.kode, d.nama, t.periode;
GO

/* ---------- 4b. Sell Out: J073 per baris (salinan 03_sellout.sql; hanya distributor yang punya aturan): data J073 + DO J028 tahun lalu untuk bulan yang belum ada di J073 ---------- */
CREATE OR ALTER VIEW sementrack.v_sellout_j073_baris AS
WITH thn AS (SELECT YEAR(CAST(GETDATE() AS date)) AS y),
ada AS (SELECT DISTINCT j.dist_code, DATETRUNC(month, j.do_date) AS bln FROM sementrack.sellout_j073 j
        WHERE EXISTS (SELECT 1 FROM sementrack.sellout_j073_dist d WHERE d.dist_code = j.dist_code AND d.j028_dist IS NOT NULL)),
src AS (
  SELECT N'J073' AS asal, j.dist_code, j.do_date, j.do_no, j.customer_code, j.product_code, j.product_name, j.order_qty,
         j.net_amount, UPPER(TRIM(j.warehouse)) AS gudang
  FROM sementrack.sellout_j073 j
  WHERE j.cust_group IS NULL                                                                        -- RETAIL saja
    AND EXISTS (SELECT 1 FROM sementrack.sellout_j073_aturan a WHERE a.dist_code = j.dist_code)    -- J073 untuk Ongkos Kirim saja tidak dibaca
  UNION ALL
  SELECT N'J028', d.dist_code, t.do_date, t.do_no, t.customer_code, t.product_code, NULL, t.order_qty,
         ISNULL(t.net_amount, 0), NULL
  FROM sementrack.sellout_j073_dist d
  JOIN dbo.transaksi t ON t.dist_code = d.j028_dist
  CROSS JOIN thn
  WHERE t.do_date >= DATEFROMPARTS(thn.y - 1, 1, 1) AND t.do_date < DATEFROMPARTS(thn.y, 1, 1)
    AND t.customer_code IS NOT NULL AND TRIM(t.customer_code) <> N''
    AND NOT EXISTS (SELECT 1 FROM ada WHERE ada.dist_code = d.dist_code AND ada.bln = DATETRUNC(month, t.do_date))
)
SELECT s.asal, s.dist_code, s.do_date, YEAR(s.do_date) AS tahun, MONTH(s.do_date) AS bulan, s.do_no, s.customer_code, s.gudang,
       CASE WHEN s.product_code LIKE N'RJW%' THEN N'RJW' WHEN s.product_code LIKE N'CWC%' THEN N'CWC' ELSE N'STR' END AS tipe,
       sementrack.j073_ton(s.product_code, s.product_name, s.order_qty) AS ton,
       s.net_amount AS net,
       (SELECT TOP (1) a.peta_id
        FROM sementrack.sellout_j073_aturan a
        WHERE a.dist_code = s.dist_code
          AND (a.gudang IS NULL OR UPPER(a.gudang) = s.gudang)
          AND (a.customer_code IS NULL OR a.customer_code = s.customer_code)
          AND (a.do_j028 IS NULL OR EXISTS (SELECT 1 FROM dbo.transaksi t2 CROSS JOIN thn
                                            WHERE t2.do_no = s.do_no AND t2.dist_code = a.do_j028
                                              AND t2.do_date >= DATEFROMPARTS(thn.y - 1, 1, 1)))
        ORDER BY a.urutan) AS peta_id
FROM src s;
GO

/* ---------- 5. status data (salinan 11_stock.sql + ongkos) ---------- */
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
), ongkos_up AS (
  SELECT TOP (1) created_at, created_by FROM sementrack.kelola_log WHERE dataset = N'ongkos' AND status = N'selesai' ORDER BY id DESC
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
SELECT N'j073', N'J073', N'harian',
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
       (SELECT N'Upload oleh ' + created_by FROM stock_up)
UNION ALL
SELECT N'ongkos', N'Ongkos kirim (ORDB019)', N'mingguan',
       (SELECT MAX(kirim_date) FROM sementrack.ongkos_kirim),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM ongkos_up),
       (SELECT N'Upload oleh ' + created_by FROM ongkos_up);
GO

/* ---------- 6. halaman Ongkos Kirim ikut akses Sell Out BNN untuk role yang diatur manual ---------- */
IF OBJECT_ID(N'auth_local.role_pages', N'U') IS NOT NULL
  INSERT INTO auth_local.role_pages (role, page_id, can_view_detail, can_download)
  SELECT r.role, N'ongkos-kirim', r.can_view_detail, r.can_download
  FROM auth_local.role_pages r
  WHERE r.page_id = N'sell-out-bnn'
    AND NOT EXISTS (SELECT 1 FROM auth_local.role_pages t WHERE t.role = r.role AND t.page_id = N'ongkos-kirim');
GO

-- Cek
SELECT dist_code, kode, nama, periode, trip, ton, ton_berbiaya, biaya FROM sementrack.v_ongkos_info ORDER BY periode DESC, dist_code;
