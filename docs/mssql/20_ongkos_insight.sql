/* ============================================================================
   20_ongkos_insight.sql · Ongkos Kirim lebih tepat
   - J073 menyimpan Product Price (harga per zak di DO; DO kirim sudah termasuk ongkir). Upload ulang J073 sekali
     supaya terisi (Nazam Auto Task: --unggah-ulang-j073).
   - Angkutan ke gudang (baris ORDB019 tanpa No DO, "-": WAYLUNIK, SUKAJAYA, ...) dipisah dari ongkos ke toko.
   - Status transporter (sementrack.ongkos_transporter, bisa diubah di SSMS):
       normal         : ongkos seharusnya tercatat di ORDB019
       armada_sendiri : biaya di luar ERP (bawaan: nama berisi LINTAS ABADI MAKMUR, plus ISA001 truk INSA sendiri dan ISA066 mobil
                        internal BNN Group); perjalanan tanpa biaya bukan "tagihan belum masuk"
       truk_toko      : truk milik toko (bawaan: nama berisi EKS. TOKO); memang tanpa biaya, dihitung lengkap dengan biaya 0
   - Ongkir dibayar toko per DO: rincian Delivery di J073 kalau diisi; kalau kosong pada DO kirim, tarif resmi per tipe kirim x zona
     (harga_kirim, 18_harga_loco.sql); kalau belum ada, Product Price - harga Loco (kolom Price) pada tanggal DO, minimal 0.
   Jalankan di SSMS, database MARKETING_ANALIS, setelah 17, 18, dan 19 (18 versi 2026-11-23: tabel harga_kirim). Kalau 17_ongkos_kirim.sql dijalankan ulang,
   jalankan file ini lagi sesudahnya, lalu 22_logistik.sql (view Ongkos Kirim ada di 22). Aman dijalankan ulang.
============================================================================ */

/* ---------- 1. kolom dan tabel ---------- */
IF COL_LENGTH(N'sementrack.sellout_j073', N'harga_produk') IS NULL
  ALTER TABLE sementrack.sellout_j073 ADD harga_produk decimal(20,6) NULL; -- Product Price per zak
GO
IF COL_LENGTH(N'sementrack.sellout_j073', N'qty_sisa') IS NULL
  ALTER TABLE sementrack.sellout_j073 ADD qty_sisa decimal(20,6) NULL;     -- Qty Remains: zak DO yang belum dikirim (posisi saat diunduh)
GO
IF COL_LENGTH(N'sementrack.sellout_j073', N'data_per') IS NULL
  ALTER TABLE sementrack.sellout_j073 ADD data_per date NULL;              -- tanggal baris ini diupload (posisi Qty Remains)
GO
IF OBJECT_ID(N'sementrack.ongkos_transporter', N'U') IS NULL
CREATE TABLE sementrack.ongkos_transporter (
  kode nvarchar(50) NOT NULL CONSTRAINT PK_ongkos_transporter PRIMARY KEY,   -- kode di depan nama transporter ORDB019 (BMM055, ISA061, ...)
  status nvarchar(20) NOT NULL CONSTRAINT CK_ongkos_transporter_status CHECK (status IN (N'normal', N'armada_sendiri', N'truk_toko')),
  catatan nvarchar(400) NULL
);
GO
INSERT INTO sementrack.ongkos_transporter (kode, status, catatan)
SELECT v.kode, N'armada_sendiri', v.catatan FROM (VALUES (N'ISA001', N'truk INSA sendiri'), (N'ISA066', N'mobil internal BNN Group')) v (kode, catatan)
WHERE NOT EXISTS (SELECT 1 FROM sementrack.ongkos_transporter t WHERE t.kode = v.kode);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_harga_loco_produk' AND object_id = OBJECT_ID(N'sementrack.harga_loco'))
  CREATE INDEX IX_harga_loco_produk ON sementrack.harga_loco (dist_code, product_code, berlaku_dari) INCLUDE (berlaku_sampai, net_price, warehouse);
GO

/* ---------- 2. upload J073 dengan Product Price dan Qty Remains (menggantikan versi di 17_ongkos_kirim.sql) ---------- */
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
         NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[19]'))), N'') AS cust_group, JSON_VALUE(r.[value], '$[20]') AS hargaproduk_txt,
         JSON_VALUE(r.[value], '$[21]') AS sisa_txt
  INTO #raw FROM OPENJSON(@p_rows) r;

  SELECT @b = MIN(baris) FROM #raw
  WHERE (do_date_txt IS NOT NULL AND TRY_CONVERT(date, do_date_txt, 23) IS NULL)
     OR (qty_txt IS NOT NULL AND sementrack.angka(qty_txt) IS NULL) OR (net_txt IS NOT NULL AND sementrack.angka(net_txt) IS NULL);
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Tanggal atau angka tidak terbaca (baris ', @b, N')'); THROW 52023, @msg, 1; END

  SELECT baris, dist_code, TRY_CONVERT(date, do_date_txt, 23) AS do_date, do_no, customer_code, customer_name, product_code, product_name,
         sementrack.angka(qty_txt) AS order_qty, ISNULL(sementrack.angka(net_txt), 0) AS net_amount, warehouse,
         delivery_type, zona_kirim, sementrack.angka(harga_txt) AS harga_kirim, sementrack.angka(diskon_txt) AS diskon_kirim,
         sementrack.angka(tambah_txt) AS tambah_kirim, sementrack.angka(handling_txt) AS handling, sementrack.angka(qtykirim_txt) AS qty_kirim,
         kecamatan, kabupaten, cust_group, sementrack.angka(hargaproduk_txt) AS harga_produk, sementrack.angka(sisa_txt) AS qty_sisa
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
                                       delivery_type, zona_kirim, harga_kirim, diskon_kirim, tambah_kirim, handling, qty_kirim, kecamatan, kabupaten, cust_group, harga_produk,
                                       qty_sisa, data_per)
  SELECT dist_code, do_date, do_no, customer_code, customer_name, product_code, product_name, order_qty, net_amount, warehouse,
         delivery_type, zona_kirim, harga_kirim, diskon_kirim, tambah_kirim, handling, qty_kirim, kecamatan, kabupaten,
         CASE WHEN cust_group = N'RETAIL' THEN NULL ELSE cust_group END, harga_produk, qty_sisa, CAST(SYSDATETIMEOFFSET() AS date) FROM #j;

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

/* ---------- 3. view ----------
   v_ongkos_trip, v_ongkos_do, dan v_ongkos_info sekarang ada di 22_logistik.sql (ditambah rekap logistik sebagai sumber biaya kedua).
   Jalankan 22 setelah file ini. Cek di bawah butuh view itu sudah ada. */

-- Cek: ongkir dibayar toko per sumber, dan transporter yang statusnya bukan normal
SELECT tagih_sumber, COUNT(*) AS do_count, CAST(SUM(ton_kirim) AS decimal(20,1)) AS ton FROM sementrack.v_ongkos_do GROUP BY tagih_sumber;
-- Cek silang: DO yang kolom Delivery-nya diisi, dibanding cara harga (Product Price - Loco). Kalau harga Loco benar, "sama" mendekati 100%.
SELECT dist_code, COUNT(*) AS do_count,
       SUM(CASE WHEN ABS(tagih - tagih_dari_harga) <= ton_kirim * 200 THEN 1 ELSE 0 END) AS sama,
       CAST(SUM(tagih) / NULLIF(SUM(ton_kirim), 0) / 20 AS decimal(12,0)) AS rincian_per_zak50,
       CAST(SUM(tagih_dari_harga) / NULLIF(SUM(ton_kirim), 0) / 20 AS decimal(12,0)) AS harga_per_zak50
FROM sementrack.v_ongkos_do WHERE tagih_sumber = N'rincian' AND tagih_dari_harga IS NOT NULL GROUP BY dist_code ORDER BY dist_code;
-- Cek silang tarif resmi (harga_kirim) vs rincian J073 pada DO yang sama. "sama" mendekati jumlah DO = pasangan tipe kirim dan zona sudah benar.
SELECT dist_code, COUNT(*) AS do_count,
       SUM(CASE WHEN ABS(tagih - tagih_dari_tarif) <= ton_kirim * 200 THEN 1 ELSE 0 END) AS sama,
       CAST(SUM(tagih) / NULLIF(SUM(ton_kirim), 0) / 20 AS decimal(12,0)) AS rincian_per_zak50,
       CAST(SUM(tagih_dari_tarif) / NULLIF(SUM(ton_kirim), 0) / 20 AS decimal(12,0)) AS tarif_per_zak50
FROM sementrack.v_ongkos_do WHERE tagih_sumber = N'rincian' AND tagih_dari_tarif IS NOT NULL GROUP BY dist_code ORDER BY dist_code;
-- Kode tipe kirim J073 yang belum punya pasangan di harga_tipe_map (tambahkan kalau sudah pasti)
SELECT UPPER(LEFT(LTRIM(delivery_type), CHARINDEX(N' ', LTRIM(delivery_type) + N' ') - 1)) AS kode, MAX(delivery_type) AS contoh, COUNT(*) AS baris
FROM sementrack.sellout_j073 s
WHERE delivery_type IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sementrack.harga_tipe_map m
                                                WHERE m.kode = UPPER(LEFT(LTRIM(s.delivery_type), CHARINDEX(N' ', LTRIM(s.delivery_type) + N' ') - 1)))
GROUP BY UPPER(LEFT(LTRIM(delivery_type), CHARINDEX(N' ', LTRIM(delivery_type) + N' ') - 1)) ORDER BY baris DESC;
SELECT transporter_kode, MAX(transporter) AS transporter, status_transporter, COUNT(*) AS trip, SUM(CASE WHEN biaya = 0 THEN 1 ELSE 0 END) AS trip_tanpa_biaya
FROM sementrack.v_ongkos_trip WHERE status_transporter <> N'normal' GROUP BY transporter_kode, status_transporter ORDER BY transporter_kode;
