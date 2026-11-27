/* ============================================================================
   25_efektivitas.sql · Halaman Efektivitas Ongkos & Promo
   1. sementrack.promo_do + promo_simpan: job ERP J078 (DO PROMO DETAIL), ditarik Nazam Auto Task per distributor per bulan.
      Satu baris J078 = baris produk DO, diikuti baris promonya:
        jenis produk        : baris produk (qty, harga, Promo Amount = jumlah potongan langsung, Net Amount)
        jenis potongan      : Promo Type 01 / 01B / kosong: potongan langsung per zak (Diskon x Qty Diskon = Total Diskon)
        jenis voucher       : Promo Type CBV dengan nama voucher: cash back voucher yang diberikan (nilai = kolom Diskon)
        jenis pakai_voucher : Promo Type CBV dengan nomor VOxxxx: voucher lama yang dipakai di DO ini (bukan biaya baru)
      nilai = biaya promo dalam Rp; ton = ton semen baris produk yang mendapat promo itu (0 untuk non-semen).
   2. View:
      v_promo_bulanan : distributor x bulan x segmen x promo: DO, toko, ton, biaya
      v_promo_efek    : distributor x promo: rata-rata ton per toko per bulan saat dapat promo vs bulan tanpa promo itu
                        (toko yang sama, dari J073), biaya, biaya per ton tambahan
      v_ongkos_zona   : distributor x bulan x zona kirim: ton, ongkir dibayar toko, bayar truk, subsidi ongkir (tarif ERP)
      v_isi_truk      : distributor x bulan x jalur x tipe truk x transporter x kelompok isi truk (J082): trip, ton, biaya
   Jalankan di SSMS, database MARKETING_ANALIS, setelah 22_logistik.sql. Aman dijalankan ulang.
============================================================================ */

IF OBJECT_ID(N'sementrack.promo_do', N'U') IS NULL
CREATE TABLE sementrack.promo_do (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_promo_do PRIMARY KEY,
  dist_code nvarchar(50) NOT NULL,
  do_no nvarchar(50) NOT NULL,
  do_date date NOT NULL,
  segmen nvarchar(20) NULL,                  -- RETAIL / PROYEK
  cust_code nvarchar(50) NULL,               -- Parent Code (= Customer Code J073)
  cust_name nvarchar(200) NULL,
  cust_tiro nvarchar(50) NULL,
  product_code nvarchar(50) NULL,            -- produk baris DO (baris promo ikut produk di atasnya)
  product_name nvarchar(200) NULL,
  baris_ke int NULL,
  jenis nvarchar(20) NOT NULL,               -- produk / potongan / voucher / pakai_voucher
  promo_type nvarchar(20) NULL,
  promo nvarchar(200) NULL,                  -- Keterangan Promo
  qty decimal(20,4) NULL,                    -- produk: Product Qty; promo: Qty Diskon (atau qty produknya)
  harga decimal(20,2) NULL,                  -- Product Price per zak
  diskon decimal(20,2) NULL,                 -- potongan per zak, atau nilai voucher
  nilai decimal(20,2) NULL,                  -- produk: qty x harga; promo: biaya promo (Rp)
  promo_amount decimal(20,2) NULL,
  net_amount decimal(20,2) NULL,
  ton decimal(20,6) NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'promo_do_dist_tgl_idx' AND object_id = OBJECT_ID(N'sementrack.promo_do'))
  CREATE INDEX promo_do_dist_tgl_idx ON sementrack.promo_do (dist_code, do_date) INCLUDE (jenis, promo, cust_code, ton, nilai);
GO

ALTER TABLE sementrack.kelola_log DROP CONSTRAINT IF EXISTS CK_kelola_log_dataset_check;
ALTER TABLE sementrack.kelola_log ADD CONSTRAINT CK_kelola_log_dataset_check
  CHECK (dataset IN (N'transaksi', N'sellin', N'dofas', N'erp', N'j073', N'target', N'outstanding', N'tabel', N'stock', N'ongkos', N'harga', N'logistik', N'promo'));
GO

/* Baris: [dist_code, do_no, do_date, segmen, cust_code, cust_name, cust_tiro, product_code, product_name, baris_ke, jenis, promo_type, promo,
           qty, harga, diskon, nilai, promo_amount, net_amount]. Per distributor, data di rentang tanggal DO file diganti. */
CREATE OR ALTER PROCEDURE sementrack.promo_simpan @p_rows nvarchar(max), @p_user nvarchar(200), @p_file nvarchar(4000) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @old int, @new int, @from date, @to date, @dists nvarchar(max), @b int, @msg nvarchar(2048);
  IF ISJSON(@p_rows) = 0 OR LEFT(LTRIM(@p_rows), 1) <> N'[' OR NOT EXISTS (SELECT 1 FROM OPENJSON(@p_rows))
    THROW 52024, N'Tidak ada baris J078', 1;
  SELECT CAST(r.[key] AS int) + 1 AS baris,
         UPPER(TRIM(JSON_VALUE(r.[value], '$[0]'))) AS dist_code, TRIM(JSON_VALUE(r.[value], '$[1]')) AS do_no,
         TRY_CONVERT(date, JSON_VALUE(r.[value], '$[2]'), 23) AS do_date, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[3]'))), N'') AS segmen,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[4]')), N'') AS cust_code, NULLIF(TRIM(JSON_VALUE(r.[value], '$[5]')), N'') AS cust_name,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[6]')), N'') AS cust_tiro, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[7]'))), N'') AS product_code,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[8]')), N'') AS product_name, TRY_CONVERT(int, JSON_VALUE(r.[value], '$[9]')) AS baris_ke,
         LOWER(TRIM(JSON_VALUE(r.[value], '$[10]'))) AS jenis, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[11]'))), N'') AS promo_type,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[12]')), N'') AS promo, sementrack.angka(JSON_VALUE(r.[value], '$[13]')) AS qty,
         sementrack.angka(JSON_VALUE(r.[value], '$[14]')) AS harga, sementrack.angka(JSON_VALUE(r.[value], '$[15]')) AS diskon,
         sementrack.angka(JSON_VALUE(r.[value], '$[16]')) AS nilai, sementrack.angka(JSON_VALUE(r.[value], '$[17]')) AS promo_amount,
         sementrack.angka(JSON_VALUE(r.[value], '$[18]')) AS net_amount
  INTO #r FROM OPENJSON(@p_rows) r;
  SELECT @b = MIN(baris) FROM #r WHERE ISNULL(dist_code, N'') = N'' OR ISNULL(do_no, N'') = N'' OR do_date IS NULL
                                    OR jenis NOT IN (N'produk', N'potongan', N'voucher', N'pakai_voucher');
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Baris J078 tidak lengkap (baris ', @b, N'): distributor, No. DO, tanggal DO, dan jenis wajib'); THROW 52024, @msg, 1; END
  SELECT @b = MIN(baris) FROM #r WHERE LEN(dist_code) > 50 OR LEN(do_no) > 50 OR LEN(segmen) > 20 OR LEN(cust_code) > 50 OR LEN(cust_name) > 200
                                    OR LEN(cust_tiro) > 50 OR LEN(product_code) > 50 OR LEN(product_name) > 200 OR LEN(promo_type) > 20 OR LEN(promo) > 200;
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Teks terlalu panjang (baris ', @b, N')'); THROW 52024, @msg, 1; END
  IF EXISTS (SELECT 1 FROM #r WHERE do_date < DATEFROMPARTS(2026, 1, 1))
    THROW 52024, N'Promo dilacak mulai Januari 2026, baris sebelum itu tidak disimpan', 1;

  -- ton semen: kode semen yang dikenal calc_tonase, atau berkategori SEMEN / WHITE CEMENT di ORDB019
  SELECT r.*, CASE WHEN r.product_code IS NOT NULL AND (dbo.calc_tonase(r.product_code, 1) > 0
                     OR EXISTS (SELECT 1 FROM sementrack.ongkos_kirim o WHERE o.product_code = r.product_code AND o.kategori IN (N'SEMEN', N'WHITE CEMENT')))
                   THEN ISNULL(sementrack.j073_ton(r.product_code, r.product_name, ISNULL(r.qty, 0)), 0) ELSE 0 END AS ton
  INTO #l FROM #r r;

  BEGIN TRAN;
  EXEC sp_getapplock @Resource = N'promo_do', @LockMode = N'Exclusive', @LockOwner = N'Transaction';
  DELETE p FROM sementrack.promo_do p
  JOIN (SELECT dist_code, MIN(do_date) AS a, MAX(do_date) AS b FROM #l GROUP BY dist_code) r ON p.dist_code = r.dist_code AND p.do_date BETWEEN r.a AND r.b;
  SET @old = @@ROWCOUNT;
  INSERT INTO sementrack.promo_do (dist_code, do_no, do_date, segmen, cust_code, cust_name, cust_tiro, product_code, product_name, baris_ke, jenis, promo_type, promo,
                                   qty, harga, diskon, nilai, promo_amount, net_amount, ton)
  SELECT dist_code, do_no, do_date, segmen, cust_code, cust_name, cust_tiro, product_code, product_name, baris_ke, jenis, promo_type, promo,
         qty, harga, diskon, nilai, promo_amount, net_amount, ton
  FROM #l;
  SET @new = @@ROWCOUNT;
  SELECT @from = MIN(do_date), @to = MAX(do_date) FROM #l;
  SELECT @dists = N'[' + STRING_AGG(N'"' + STRING_ESCAPE(dist_code, 'json') + N'"', N',') WITHIN GROUP (ORDER BY dist_code) + N']'
  FROM (SELECT DISTINCT dist_code FROM #l) x;
  INSERT INTO sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes, rows_read, rows_saved, rows_deleted, status, finished_at)
  VALUES (N'promo', N'upload', @p_user, N'file', LEFT(@p_file, 200), @from, @to, @dists, @new, @new, @old, N'selesai', SYSDATETIMEOFFSET());
  COMMIT;

  SELECT @new AS rows_saved, @old AS rows_deleted, @from AS date_from, @to AS date_to, @dists AS dist_codes,
         (SELECT COUNT(DISTINCT do_no) FROM #l) AS jumlah_do,
         (SELECT SUM(nilai) FROM #l WHERE jenis IN (N'potongan', N'voucher')) AS biaya,
         (SELECT SUM(ton) FROM #l WHERE jenis = N'produk') AS ton;
END
GO

/* ---------- view ---------- */
CREATE OR ALTER VIEW sementrack.v_promo_bulanan AS
SELECT p.dist_code, DATEFROMPARTS(YEAR(p.do_date), MONTH(p.do_date), 1) AS periode, ISNULL(p.segmen, N'RETAIL') AS segmen,
       CAST(CASE WHEN p.ton > 0 THEN 1 ELSE 0 END AS bit) AS semen, p.jenis,
       CASE WHEN p.jenis = N'produk' THEN N'' WHEN p.jenis = N'pakai_voucher' THEN N'Pemakaian voucher' ELSE ISNULL(p.promo, N'(tanpa nama)') END AS promo,
       MAX(p.promo_type) AS promo_type, COUNT(DISTINCT p.do_no) AS jumlah_do, COUNT(DISTINCT p.cust_code) AS toko,
       SUM(p.ton) AS ton, SUM(ISNULL(p.nilai, 0)) AS nilai, SUM(ISNULL(p.net_amount, 0)) AS net
FROM sementrack.promo_do p
GROUP BY p.dist_code, DATEFROMPARTS(YEAR(p.do_date), MONTH(p.do_date), 1), ISNULL(p.segmen, N'RETAIL'), CASE WHEN p.ton > 0 THEN 1 ELSE 0 END, p.jenis,
         CASE WHEN p.jenis = N'produk' THEN N'' WHEN p.jenis = N'pakai_voucher' THEN N'Pemakaian voucher' ELSE ISNULL(p.promo, N'(tanpa nama)') END;
GO

-- Efek promo: toko yang pernah dapat promo P. Ton per bulan toko itu (J073, semen) di bulan dapat P dibanding bulan beli tanpa P.
-- Hanya bulan yang toko itu membeli (ada DO di J073), sejak bulan pertama data J078 distributor itu.
CREATE OR ALTER VIEW sementrack.v_promo_efek AS
WITH tp AS (
  SELECT p.dist_code, p.cust_code, DATEFROMPARTS(YEAR(p.do_date), MONTH(p.do_date), 1) AS periode, p.jenis, ISNULL(p.promo, N'(tanpa nama)') AS promo,
         SUM(ISNULL(p.nilai, 0)) AS biaya, SUM(p.ton) AS ton_promo
  FROM sementrack.promo_do p
  WHERE p.jenis IN (N'potongan', N'voucher') AND p.ton > 0 AND p.cust_code IS NOT NULL
  GROUP BY p.dist_code, p.cust_code, DATEFROMPARTS(YEAR(p.do_date), MONTH(p.do_date), 1), p.jenis, ISNULL(p.promo, N'(tanpa nama)')
), rentang AS (
  SELECT dist_code, DATEFROMPARTS(YEAR(MIN(do_date)), MONTH(MIN(do_date)), 1) AS a, MAX(do_date) AS b FROM sementrack.promo_do GROUP BY dist_code
), tb AS (
  SELECT s.dist_code, s.customer_code AS cust_code, DATEFROMPARTS(YEAR(s.do_date), MONTH(s.do_date), 1) AS periode,
         SUM(sementrack.j073_ton(s.product_code, s.product_name, s.order_qty)) AS ton
  FROM sementrack.sellout_j073 s JOIN rentang r ON r.dist_code = s.dist_code AND s.do_date BETWEEN r.a AND r.b
  GROUP BY s.dist_code, s.customer_code, DATEFROMPARTS(YEAR(s.do_date), MONTH(s.do_date), 1)
), x AS (
  SELECT k.dist_code, k.jenis, k.promo, b.cust_code, b.periode, b.ton, CASE WHEN t.cust_code IS NOT NULL THEN 1 ELSE 0 END AS saat
  FROM (SELECT DISTINCT dist_code, jenis, promo, cust_code FROM tp) k
  JOIN tb b ON b.dist_code = k.dist_code AND b.cust_code = k.cust_code
  LEFT JOIN tp t ON t.dist_code = k.dist_code AND t.jenis = k.jenis AND t.promo = k.promo AND t.cust_code = b.cust_code AND t.periode = b.periode
)
SELECT a.dist_code, a.jenis, a.promo, a.toko, a.dari, a.sampai, a.biaya, a.ton_promo, e.toko_dibanding, e.bulan_saat, e.bulan_tanpa, e.ton_saat, e.ton_tanpa
FROM (SELECT dist_code, jenis, promo, COUNT(DISTINCT cust_code) AS toko, MIN(periode) AS dari, MAX(periode) AS sampai,
             SUM(biaya) AS biaya, SUM(ton_promo) AS ton_promo
      FROM tp GROUP BY dist_code, jenis, promo) a
LEFT JOIN (
  -- pembanding hanya toko yang punya bulan beli dengan dan tanpa promo itu
  SELECT y.dist_code, y.jenis, y.promo, COUNT(DISTINCT y.cust_code) AS toko_dibanding,
         SUM(y.saat) AS bulan_saat, SUM(1 - y.saat) AS bulan_tanpa,
         AVG(CASE WHEN y.saat = 1 THEN y.ton END) AS ton_saat, AVG(CASE WHEN y.saat = 0 THEN y.ton END) AS ton_tanpa
  FROM (SELECT x.*, SUM(x.saat) OVER (PARTITION BY x.dist_code, x.jenis, x.promo, x.cust_code) AS n_saat,
               COUNT(*) OVER (PARTITION BY x.dist_code, x.jenis, x.promo, x.cust_code) AS n
        FROM x) y
  WHERE y.n_saat > 0 AND y.n_saat < y.n
  GROUP BY y.dist_code, y.jenis, y.promo
) e ON e.dist_code = a.dist_code AND e.jenis = a.jenis AND e.promo = a.promo;
GO

-- Ongkir per zona kirim (J073): ton, ongkir dibayar toko, bayar truk (DO yang biaya perjalanannya lengkap), subsidi ongkir di tarif ERP
CREATE OR ALTER VIEW sementrack.v_ongkos_zona AS
SELECT o.dist_code, o.periode, ISNULL(NULLIF(o.zona_kirim, N''), ISNULL(o.zona, N'(tanpa zona)')) AS zona, ISNULL(o.tipe_kirim, N'') AS tipe_kirim,
       ISNULL(o.jalur, N'') AS jalur, COUNT(*) AS jumlah_do, SUM(o.ton_kirim) AS ton,
       SUM(CASE WHEN o.trip_tanpa_biaya = 0 THEN o.ton_kirim ELSE 0 END) AS ton_lengkap,
       SUM(CASE WHEN o.trip_tanpa_biaya = 0 THEN o.biaya ELSE 0 END) AS biaya_lengkap,
       SUM(CASE WHEN o.tagih IS NOT NULL THEN o.ton_kirim ELSE 0 END) AS ton_tagih, SUM(o.tagih) AS tagih,
       SUM(CASE WHEN o.trip_tanpa_biaya = 0 AND o.tagih IS NOT NULL THEN o.ton_kirim ELSE 0 END) AS ton_margin,
       SUM(CASE WHEN o.trip_tanpa_biaya = 0 AND o.tagih IS NOT NULL THEN o.tagih - o.biaya ELSE 0 END) AS margin,
       SUM(CASE WHEN o.subsidi IS NOT NULL THEN o.ton_kirim ELSE 0 END) AS ton_subsidi, SUM(o.subsidi) AS subsidi
FROM sementrack.v_ongkos_do o
GROUP BY o.dist_code, o.periode, ISNULL(NULLIF(o.zona_kirim, N''), ISNULL(o.zona, N'(tanpa zona)')), ISNULL(o.tipe_kirim, N''), ISNULL(o.jalur, N'');
GO

-- Isi truk (berat muatan / kapasitas truk, dari J082) per kelompok, perjalanan ke toko
CREATE OR ALTER VIEW sementrack.v_isi_truk AS
SELECT t.dist_code, t.periode, ISNULL(t.jalur, N'') AS jalur, ISNULL(t.tipe_truk, N'(tanpa tipe)') AS tipe_truk, ISNULL(t.transporter, N'') AS transporter,
       t.status_transporter,
       CASE WHEN t.isi_truk < 0.5 THEN N'a_lt50' WHEN t.isi_truk < 0.8 THEN N'b_50_80' WHEN t.isi_truk < 0.95 THEN N'c_80_95'
            WHEN t.isi_truk <= 1.05 THEN N'd_penuh' ELSE N'e_lebih' END AS kelompok,
       COUNT(*) AS trip, SUM(t.ton) AS ton, SUM(t.berat_ton) AS berat, SUM(t.truk_max_ton) AS kapasitas,
       SUM(CASE WHEN t.biaya > 0 THEN 1 ELSE 0 END) AS trip_berbiaya, SUM(CASE WHEN t.biaya > 0 THEN t.ton ELSE 0 END) AS ton_berbiaya,
       SUM(CASE WHEN t.biaya > 0 THEN t.biaya ELSE 0 END) AS biaya
FROM sementrack.v_ongkos_trip t
WHERE t.ke_gudang = 0 AND t.ton > 0 AND t.isi_truk IS NOT NULL AND t.truk_max_ton > 0   -- perjalanan yang membawa semen
GROUP BY t.dist_code, t.periode, ISNULL(t.jalur, N''), ISNULL(t.tipe_truk, N'(tanpa tipe)'), ISNULL(t.transporter, N''), t.status_transporter,
         CASE WHEN t.isi_truk < 0.5 THEN N'a_lt50' WHEN t.isi_truk < 0.8 THEN N'b_50_80' WHEN t.isi_truk < 0.95 THEN N'c_80_95'
              WHEN t.isi_truk <= 1.05 THEN N'd_penuh' ELSE N'e_lebih' END;
GO
GRANT SELECT ON sementrack.v_promo_bulanan TO PUBLIC;
GRANT SELECT ON sementrack.v_promo_efek TO PUBLIC;
GRANT SELECT ON sementrack.v_ongkos_zona TO PUBLIC;
GRANT SELECT ON sementrack.v_isi_truk TO PUBLIC;
GO

-- Cek: promo per distributor x bulan
SELECT dist_code, periode, jenis, COUNT(*) AS promo, SUM(nilai) AS nilai, SUM(ton) AS ton
FROM sementrack.v_promo_bulanan GROUP BY dist_code, periode, jenis ORDER BY dist_code, periode, jenis;
