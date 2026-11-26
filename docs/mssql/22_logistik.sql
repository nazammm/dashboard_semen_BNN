/* ============================================================================
   22_logistik.sql · Rekap logistik distributor (sumber kedua halaman Ongkos Kirim)
   - sementrack.logistik_kirim: baris rekap tim logistik (format sama di semua distributor: Daerah, FOAD No., SOMType, DO No.,
     DO Date, Est. Delv. Date, SJ Date, Kirim, Product Code, Jumlah, Transporter Name, Zone Trans., Gudang Asal/Tujuan,
     Harga Perzak, Jml Harga, Tgl Terima SJ Toko / DoPlanner, KET DALAM/LUAR KOTA, ...).
     Daerah = kode distributor (CBS, ...) -> kode ERP lewat dbo.distributor.kode_erp. Per distributor, data di rentang
     tanggal file diganti.
   - Jalur dari SOMType: gudang_toko (04), pelabuhan_toko (06), gudang_gudang (02), pabrik_gudang (01), pabrik_toko (03).
   - Biaya per FOAD dari rekap = jumlah Jml Harga baris semen kalau > 0, kalau tidak jumlah semua baris FOAD itu.
   - View Ongkos Kirim didefinisikan ulang di sini (sebelumnya di 20):
       v_ongkos_baris : baris ORDB019 + baris rekap logistik yang FOAD-nya tidak ada di ORDB019 (mis. bulan ORDB yang belum diunduh)
       v_ongkos_trip  : per FOAD; biaya = ORDB019 kalau > 0, kalau ORDB 0 / tidak ada pakai rekap logistik (sumber_biaya erp / logistik);
                        jalur dan waktu kirim dari rekap
       v_ongkos_do    : per DO; biaya rekap dibagi ke DO menurut ton
       v_ongkos_info  : per distributor x bulan, plus ton yang biayanya dari rekap
   Jalankan di SSMS, database MARKETING_ANALIS, setelah 20 dan 21. Kalau 17, 18, 19, atau 20 dijalankan ulang, jalankan file ini
   lagi sesudahnya. Aman dijalankan ulang.
============================================================================ */

/* ---------- 1. tabel ---------- */
IF OBJECT_ID(N'sementrack.logistik_kirim', N'U') IS NULL
CREATE TABLE sementrack.logistik_kirim (
  id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_logistik_kirim PRIMARY KEY,
  dist_code nvarchar(50) NOT NULL,          -- kode ERP distributor (4708, ...)
  daerah nvarchar(50) NULL,                 -- kolom Daerah di file (CBS, ...)
  foad nvarchar(50) NOT NULL,
  periode date NOT NULL,                    -- tanggal 1 bulan muat FOAD (tanggal muat paling awal di FOAD itu)
  tgl date NOT NULL,                        -- tanggal muat: SJ Date, kalau kosong Tgl. SJ Terminal / SOM Date / Tanggal Order
  som_type nvarchar(100) NULL,
  jalur nvarchar(20) NOT NULL,
  do_no nvarchar(50) NULL,
  do_date date NULL,
  est_kirim date NULL,                      -- Est. Delv. Date
  sj_no nvarchar(50) NULL,
  kirim_date date NULL,                     -- Kirim (kalau kosong SJ Date)
  salesman nvarchar(200) NULL,
  status_sj nvarchar(50) NULL,
  cust_code nvarchar(50) NULL,
  cust_name nvarchar(200) NULL,
  product_code nvarchar(50) NULL,
  product_name nvarchar(200) NULL,
  qty decimal(20,4) NOT NULL,
  ton decimal(20,6) NOT NULL,               -- semen & semen putih saja, lainnya 0
  transporter nvarchar(200) NULL,
  zona_kode nvarchar(50) NULL,
  zona nvarchar(200) NULL,
  plat nvarchar(50) NULL,
  gudang_asal nvarchar(200) NULL,
  gudang_tujuan nvarchar(200) NULL,
  harga_perzak decimal(20,4) NULL,
  jml_harga decimal(20,2) NULL,
  terima_toko date NULL,
  terima_planner date NULL,
  dalam_luar nvarchar(50) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'logistik_kirim_foad_idx' AND object_id = OBJECT_ID(N'sementrack.logistik_kirim'))
  CREATE INDEX logistik_kirim_foad_idx ON sementrack.logistik_kirim (dist_code, foad) INCLUDE (ton, jml_harga, jalur, periode);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'logistik_kirim_tgl_idx' AND object_id = OBJECT_ID(N'sementrack.logistik_kirim'))
  CREATE INDEX logistik_kirim_tgl_idx ON sementrack.logistik_kirim (dist_code, tgl);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ongkos_kirim_foad_idx' AND object_id = OBJECT_ID(N'sementrack.ongkos_kirim'))
  CREATE INDEX ongkos_kirim_foad_idx ON sementrack.ongkos_kirim (dist_code, foad);
GO

ALTER TABLE sementrack.kelola_log DROP CONSTRAINT IF EXISTS CK_kelola_log_dataset_check;
ALTER TABLE sementrack.kelola_log ADD CONSTRAINT CK_kelola_log_dataset_check
  CHECK (dataset IN (N'transaksi', N'sellin', N'dofas', N'erp', N'j073', N'target', N'outstanding', N'tabel', N'stock', N'ongkos', N'harga', N'logistik'));
GO

/* ---------- 2. upload ----------
   Baris: [daerah, foad, som_type, tgl, do_no, do_date, est_kirim, sj_no, kirim_date, salesman, status_sj, cust_code, cust_name,
           product_code, product_name, qty, transporter, zona_kode, zona, plat, gudang_asal, gudang_tujuan, harga_perzak, jml_harga,
           terima_toko, terima_planner, dalam_luar]   (tanggal YYYY-MM-DD) */
CREATE OR ALTER PROCEDURE sementrack.logistik_simpan @p_rows nvarchar(max), @p_user nvarchar(200), @p_file nvarchar(4000) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @old int, @new int, @ton decimal(24,6), @biaya decimal(24,2), @from date, @to date, @dists nvarchar(max), @b int, @msg nvarchar(2048), @x nvarchar(400);
  IF ISJSON(@p_rows) = 0 OR LEFT(LTRIM(@p_rows), 1) <> N'[' OR NOT EXISTS (SELECT 1 FROM OPENJSON(@p_rows))
    THROW 52023, N'Tidak ada baris rekap logistik', 1;

  SELECT CAST(r.[key] AS int) + 1 AS baris,
         UPPER(TRIM(JSON_VALUE(r.[value], '$[0]'))) AS daerah, TRIM(JSON_VALUE(r.[value], '$[1]')) AS foad,
         NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[2]'))), N'') AS som_type, TRY_CONVERT(date, JSON_VALUE(r.[value], '$[3]'), 23) AS tgl,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[4]')), N'') AS do_no, TRY_CONVERT(date, JSON_VALUE(r.[value], '$[5]'), 23) AS do_date,
         TRY_CONVERT(date, JSON_VALUE(r.[value], '$[6]'), 23) AS est_kirim, NULLIF(TRIM(JSON_VALUE(r.[value], '$[7]')), N'') AS sj_no,
         TRY_CONVERT(date, JSON_VALUE(r.[value], '$[8]'), 23) AS kirim_date, NULLIF(TRIM(JSON_VALUE(r.[value], '$[9]')), N'') AS salesman,
         NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[10]'))), N'') AS status_sj, NULLIF(TRIM(JSON_VALUE(r.[value], '$[11]')), N'') AS cust_code,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[12]')), N'') AS cust_name, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[13]'))), N'') AS product_code,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[14]')), N'') AS product_name, sementrack.angka(JSON_VALUE(r.[value], '$[15]')) AS qty,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[16]')), N'') AS transporter, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[17]'))), N'') AS zona_kode,
         NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[18]'))), N'') AS zona, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[19]'))), N'') AS plat,
         NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[20]'))), N'') AS gudang_asal, NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[21]'))), N'') AS gudang_tujuan,
         sementrack.angka(JSON_VALUE(r.[value], '$[22]')) AS harga_perzak, sementrack.angka(JSON_VALUE(r.[value], '$[23]')) AS jml_harga,
         TRY_CONVERT(date, JSON_VALUE(r.[value], '$[24]'), 23) AS terima_toko, TRY_CONVERT(date, JSON_VALUE(r.[value], '$[25]'), 23) AS terima_planner,
         NULLIF(UPPER(TRIM(JSON_VALUE(r.[value], '$[26]'))), N'') AS dalam_luar
  INTO #r FROM OPENJSON(@p_rows) r;

  SELECT @b = MIN(baris) FROM #r WHERE ISNULL(daerah, N'') = N'' OR ISNULL(foad, N'') = N'' OR tgl IS NULL OR qty IS NULL;
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Baris rekap logistik tidak lengkap (baris ', @b, N'): Daerah, FOAD No., tanggal, dan Jumlah wajib'); THROW 52023, @msg, 1; END
  SELECT @b = MIN(baris) FROM #r
  WHERE LEN(daerah) > 50 OR LEN(foad) > 50 OR LEN(som_type) > 100 OR LEN(do_no) > 50 OR LEN(sj_no) > 50 OR LEN(salesman) > 200 OR LEN(status_sj) > 50
     OR LEN(cust_code) > 50 OR LEN(cust_name) > 200 OR LEN(product_code) > 50 OR LEN(product_name) > 200 OR LEN(transporter) > 200
     OR LEN(zona_kode) > 50 OR LEN(zona) > 200 OR LEN(plat) > 50 OR LEN(gudang_asal) > 200 OR LEN(gudang_tujuan) > 200 OR LEN(dalam_luar) > 50;
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Teks terlalu panjang (baris ', @b, N')'); THROW 52023, @msg, 1; END
  IF EXISTS (SELECT 1 FROM #r WHERE tgl < DATEFROMPARTS(2026, 1, 1))
    THROW 52023, N'Ongkos kirim dilacak mulai Januari 2026, baris rekap sebelum itu tidak disimpan', 1;

  -- Daerah -> kode ERP: kode distributor di dbo.distributor (CBS -> 4708), atau sudah berupa kode ERP
  SELECT x.daerah, COALESCE((SELECT TOP (1) d.kode_erp FROM dbo.distributor d WHERE UPPER(d.dist_code) = x.daerah AND ISNULL(d.kode_erp, N'') <> N'' ORDER BY d.dist_code),
                            (SELECT TOP (1) d.kode_erp FROM dbo.distributor d WHERE UPPER(d.kode_erp) = x.daerah ORDER BY d.dist_code),
                            (SELECT TOP (1) j.dist_code FROM sementrack.sellout_j073_dist j WHERE UPPER(j.dist_code) = x.daerah)) AS dist_code
  INTO #d FROM (SELECT DISTINCT daerah FROM #r) x;
  SELECT @x = STRING_AGG(daerah, N', ') FROM #d WHERE dist_code IS NULL;
  IF @x IS NOT NULL BEGIN SET @msg = CONCAT(N'Daerah belum punya kode ERP di master distributor: ', @x); THROW 52023, @msg, 1; END

  -- semen: kode yang di ORDB019 berkategori SEMEN / WHITE CEMENT, atau kode semen yang dikenal calc_tonase
  SELECT r.baris, d.dist_code, r.daerah, r.foad, r.tgl, r.som_type,
         CASE WHEN r.som_type LIKE N'GUDANG%-%TOKO%' THEN N'gudang_toko' WHEN r.som_type LIKE N'PELABUHAN%-%TOKO%' THEN N'pelabuhan_toko'
              WHEN r.som_type LIKE N'GUDANG%-%GUDANG%' THEN N'gudang_gudang' WHEN r.som_type LIKE N'PABRIK%-%GUDANG%' THEN N'pabrik_gudang'
              WHEN r.som_type LIKE N'PABRIK%-%TOKO%' THEN N'pabrik_toko' ELSE N'lain' END AS jalur,
         r.do_no, r.do_date, r.est_kirim, r.sj_no, r.kirim_date, r.salesman, r.status_sj, r.cust_code, r.cust_name, r.product_code, r.product_name, r.qty,
         CASE WHEN dbo.calc_tonase(r.product_code, 1) > 0
                OR EXISTS (SELECT 1 FROM sementrack.ongkos_kirim o WHERE o.product_code = r.product_code AND o.kategori IN (N'SEMEN', N'WHITE CEMENT'))
              THEN ISNULL(sementrack.j073_ton(r.product_code, r.product_name, r.qty), 0) ELSE 0 END AS ton,
         r.transporter, r.zona_kode, r.zona, r.plat, r.gudang_asal, r.gudang_tujuan, r.harga_perzak, r.jml_harga, r.terima_toko, r.terima_planner, r.dalam_luar
  INTO #l FROM #r r JOIN #d d ON d.daerah = r.daerah;

  BEGIN TRAN;
  EXEC sp_getapplock @Resource = N'logistik_kirim', @LockMode = N'Exclusive', @LockOwner = N'Transaction';
  DELETE k FROM sementrack.logistik_kirim k
  JOIN (SELECT dist_code, MIN(tgl) AS a, MAX(tgl) AS b FROM #l GROUP BY dist_code) r ON k.dist_code = r.dist_code AND k.tgl BETWEEN r.a AND r.b;
  SET @old = @@ROWCOUNT;
  -- FOAD yang sebagian barisnya di luar rentang file: baris lama FOAD itu ikut diganti
  DELETE k FROM sementrack.logistik_kirim k WHERE EXISTS (SELECT 1 FROM #l l WHERE l.dist_code = k.dist_code AND l.foad = k.foad);
  SET @old += @@ROWCOUNT;
  INSERT INTO sementrack.logistik_kirim (dist_code, daerah, foad, periode, tgl, som_type, jalur, do_no, do_date, est_kirim, sj_no, kirim_date, salesman, status_sj,
                                         cust_code, cust_name, product_code, product_name, qty, ton, transporter, zona_kode, zona, plat, gudang_asal, gudang_tujuan,
                                         harga_perzak, jml_harga, terima_toko, terima_planner, dalam_luar)
  SELECT l.dist_code, l.daerah, l.foad, DATEFROMPARTS(YEAR(f.a), MONTH(f.a), 1), l.tgl, l.som_type, l.jalur, l.do_no, l.do_date, l.est_kirim, l.sj_no, l.kirim_date,
         l.salesman, l.status_sj, l.cust_code, l.cust_name, l.product_code, l.product_name, l.qty, l.ton, l.transporter, l.zona_kode, l.zona, l.plat,
         l.gudang_asal, l.gudang_tujuan, l.harga_perzak, l.jml_harga, l.terima_toko, l.terima_planner, l.dalam_luar
  FROM #l l JOIN (SELECT dist_code, foad, MIN(tgl) AS a FROM #l GROUP BY dist_code, foad) f ON f.dist_code = l.dist_code AND f.foad = l.foad;
  SET @new = @@ROWCOUNT;

  SELECT @ton = SUM(ton), @biaya = SUM(ISNULL(jml_harga, 0)), @from = MIN(tgl), @to = MAX(tgl) FROM #l;
  SELECT @dists = N'[' + STRING_AGG(N'"' + STRING_ESCAPE(dist_code, 'json') + N'"', N',') WITHIN GROUP (ORDER BY dist_code) + N']'
  FROM (SELECT DISTINCT dist_code FROM #l) x;
  INSERT INTO sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes, rows_read, rows_saved, rows_deleted, status, finished_at)
  VALUES (N'logistik', N'upload', @p_user, N'file', LEFT(@p_file, 200), @from, @to, @dists, @new, @new, @old, N'selesai', SYSDATETIMEOFFSET());
  COMMIT;

  -- ringkasan: FOAD semen yang belum ada di ORDB019, dan FOAD semen yang di ORDB019 biayanya 0 tapi di rekap ada
  SELECT @new AS rows_saved, @old AS rows_deleted, ISNULL(@ton, 0) AS ton, ISNULL(@biaya, 0) AS biaya, @from AS date_from, @to AS date_to, @dists AS dist_codes,
         (SELECT COUNT(DISTINCT foad) FROM #l) AS foad,
         (SELECT COUNT(*) FROM (SELECT dist_code, foad FROM #l GROUP BY dist_code, foad HAVING SUM(ton) > 0) f
           WHERE NOT EXISTS (SELECT 1 FROM sementrack.ongkos_kirim o WHERE o.dist_code = f.dist_code AND o.foad = f.foad)) AS foad_tanpa_ordb,
         (SELECT COUNT(*) FROM (SELECT dist_code, foad FROM #l GROUP BY dist_code, foad HAVING SUM(ton) > 0 AND SUM(ISNULL(jml_harga, 0)) > 0) f
           WHERE EXISTS (SELECT 1 FROM sementrack.ongkos_kirim o WHERE o.dist_code = f.dist_code AND o.foad = f.foad)
             AND NOT EXISTS (SELECT 1 FROM sementrack.ongkos_kirim o WHERE o.dist_code = f.dist_code AND o.foad = f.foad AND o.total <> 0)) AS foad_isi_biaya;
END
GO

/* ---------- 3. view ---------- */
-- Per FOAD dari rekap: jalur, biaya, dan waktu kirim (ton-tertimbang)
CREATE OR ALTER VIEW sementrack.v_logistik_foad AS
SELECT l.dist_code, l.foad, MIN(l.periode) AS periode, MIN(l.tgl) AS tgl, MAX(l.jalur) AS jalur,
       SUM(l.ton) AS ton, COUNT(DISTINCT l.do_no) AS jumlah_do,
       CASE WHEN SUM(CASE WHEN l.ton > 0 THEN ISNULL(l.jml_harga, 0) ELSE 0 END) > 0
            THEN SUM(CASE WHEN l.ton > 0 THEN ISNULL(l.jml_harga, 0) ELSE 0 END) ELSE SUM(ISNULL(l.jml_harga, 0)) END AS biaya,
       MAX(l.transporter) AS transporter, MAX(l.plat) AS plat, MAX(l.gudang_asal) AS gudang_asal, MAX(l.gudang_tujuan) AS gudang_tujuan,
       MAX(l.zona) AS zona, MAX(l.dalam_luar) AS dalam_luar,
       SUM(CASE WHEN l.ton > 0 AND l.do_date IS NOT NULL AND l.kirim_date IS NOT NULL THEN l.ton END) AS ton_waktu,
       SUM(CASE WHEN l.ton > 0 AND l.do_date IS NOT NULL AND l.kirim_date IS NOT NULL THEN l.ton * DATEDIFF(day, l.do_date, l.kirim_date) END)
         / NULLIF(SUM(CASE WHEN l.ton > 0 AND l.do_date IS NOT NULL AND l.kirim_date IS NOT NULL THEN l.ton END), 0) AS hari_kirim,   -- DO -> kirim
       SUM(CASE WHEN l.ton > 0 AND l.est_kirim IS NOT NULL AND l.kirim_date IS NOT NULL THEN l.ton END) AS ton_est,
       SUM(CASE WHEN l.ton > 0 AND l.est_kirim IS NOT NULL AND l.kirim_date > l.est_kirim THEN l.ton ELSE 0 END) AS ton_telat,      -- kirim lewat Est. Delv. Date
       DATEDIFF(day, MIN(l.kirim_date), MAX(l.terima_planner)) AS hari_sj                                                         -- SJ kembali ke DO planner
FROM sementrack.logistik_kirim l
GROUP BY l.dist_code, l.foad;
GO

CREATE OR ALTER VIEW sementrack.v_ongkos_dist AS
SELECT x.dist_code, ISNULL(d.dist_code, x.dist_code) AS kode, ISNULL(d.dist_name, x.dist_code) AS nama
FROM (SELECT dist_code FROM sementrack.ongkos_kirim UNION SELECT dist_code FROM sementrack.logistik_kirim) x
OUTER APPLY (SELECT TOP (1) d.dist_code, d.dist_name FROM dbo.distributor d WHERE d.kode_erp = x.dist_code ORDER BY d.dist_code) d;
GO

-- Baris pengiriman: ORDB019, ditambah rekap logistik untuk FOAD yang tidak ada di ORDB019. Angkutan ke gudang tanpa No DO ("-").
CREATE OR ALTER VIEW sementrack.v_ongkos_baris AS
SELECT N'erp' AS sumber_baris, k.dist_code, k.periode, k.kirim_date, k.do_no, k.foad, k.segmen, k.transporter, k.truk, k.asal, k.tujuan, k.zona,
       k.harga_ritase, k.total, k.ton
FROM sementrack.ongkos_kirim k
UNION ALL
SELECT N'logistik', l.dist_code, l.periode, ISNULL(l.kirim_date, l.tgl),
       CASE WHEN l.jalur IN (N'gudang_gudang', N'pabrik_gudang') OR ISNULL(l.do_no, N'') = N'' THEN N'-' ELSE l.do_no END,
       l.foad, NULL, l.transporter, NULL, l.gudang_asal, ISNULL(l.zona, l.gudang_tujuan), l.zona, NULL, ISNULL(l.jml_harga, 0), l.ton
FROM sementrack.logistik_kirim l
WHERE NOT EXISTS (SELECT 1 FROM sementrack.ongkos_kirim k WHERE k.dist_code = l.dist_code AND k.foad = l.foad);
GO

CREATE OR ALTER VIEW sementrack.v_ongkos_trip AS
SELECT t.dist_code, t.periode, t.foad, t.kirim_date, t.transporter, t.truk, t.asal, t.zona, t.tujuan, t.segmen, t.harga_ritase, t.ton, t.jumlah_do,
       t.ke_gudang, t.transporter_kode,
       CASE WHEN t.dari_erp = 1 AND t.biaya_baris > 0 THEN t.biaya_baris WHEN lf.biaya > 0 THEN lf.biaya ELSE 0 END AS biaya,
       CASE WHEN t.dari_erp = 1 AND t.biaya_baris > 0 THEN N'erp' WHEN lf.biaya > 0 THEN N'logistik' END AS sumber_biaya,
       CASE WHEN t.dari_erp = 1 THEN t.biaya_baris END AS biaya_erp, lf.biaya AS biaya_logistik, t.dari_erp,
       ISNULL(ot.status,
         CASE WHEN t.transporter LIKE N'%LINTAS ABADI MAKMUR%' THEN N'armada_sendiri'
              WHEN t.transporter LIKE N'%EKS%TOKO%' THEN N'truk_toko' ELSE N'normal' END) AS status_transporter,
       lf.jalur, lf.dalam_luar, lf.gudang_asal AS gudang_asal_rekap, lf.ton_waktu, lf.hari_kirim, lf.ton_est, lf.ton_telat, lf.hari_sj
FROM (
  SELECT k.dist_code, k.periode, k.foad, MIN(k.kirim_date) AS kirim_date,
         MAX(k.transporter) AS transporter, MAX(k.truk) AS truk, MAX(k.asal) AS asal, MAX(k.zona) AS zona, MAX(k.tujuan) AS tujuan,
         MAX(k.segmen) AS segmen, MAX(k.harga_ritase) AS harga_ritase, SUM(k.total) AS biaya_baris, SUM(k.ton) AS ton,
         COUNT(DISTINCT k.do_no) AS jumlah_do,
         CAST(MIN(CASE WHEN ISNULL(TRIM(k.do_no), N'') IN (N'-', N'') THEN 1 ELSE 0 END) AS bit) AS ke_gudang,
         LEFT(MAX(k.transporter), CHARINDEX(N' - ', MAX(k.transporter) + N' - ') - 1) AS transporter_kode,
         MAX(CASE WHEN k.sumber_baris = N'erp' THEN 1 ELSE 0 END) AS dari_erp
  FROM sementrack.v_ongkos_baris k
  GROUP BY k.dist_code, k.periode, k.foad
) t
LEFT JOIN sementrack.ongkos_transporter ot ON ot.kode = t.transporter_kode
LEFT JOIN sementrack.v_logistik_foad lf ON lf.dist_code = t.dist_code AND lf.foad = t.foad;
GO

-- Satu baris per DO ke toko (tanpa angkutan ke gudang). Biaya: baris ORDB019; perjalanan yang biayanya dari rekap logistik dibagi ke DO
-- menurut ton. tagih = ongkir + bongkar yang dibayar toko (di atas harga ambil sendiri), tagih_sumber, urut dipakai:
--   rincian = Delivery Price - Delivery Discount + Delivery Add + Handling Cost dari J073 (yang benar-benar tertulis di DO itu);
--   lg      = ambil sendiri (LG, atau kode yang di harga_tipe_map dipasangkan ke tipe LOCO ...) = 0;
--   tarif   = tarif resmi di harga_kirim (18_harga_loco.sql): tipe kirim (harga_tipe_map) + zona J073 + gudang + tanggal DO;
--   harga   = Product Price - harga Loco kolom Price, gudang sama;
--   kosong  = belum bisa dihitung (NULL).
-- Diskon / promo / cash back tidak dihitung: itu potongan harga semen per toko, bukan potongan ongkir.
-- tagih_dari_harga / tagih_dari_tarif = hasil cara itu untuk semua DO (untuk cek silang).
CREATE OR ALTER VIEW sementrack.v_ongkos_do AS
SELECT k.dist_code, k.periode, k.do_no, k.biaya, k.biaya_logistik, k.ton_kirim, k.trip, k.trip_tanpa_biaya, k.trip_luar_erp, k.trip_truk_toko, k.truk, k.transporter, k.zona, k.segmen, k.tujuan,
       k.jalur,
       j.do_date, j.customer_code, j.customer_name, j.delivery_type,
       LEFT(j.delivery_type, CHARINDEX(N' ', j.delivery_type + N' ') - 1) AS tipe_kirim,
       j.zona_kirim, j.kecamatan, j.kabupaten, j.ton_do,
       CASE WHEN j.ton_do > 0 THEN j.net * k.ton_kirim / j.ton_do END AS omzet,
       CASE WHEN j.ton_do > 0 AND j.delivery_type IS NOT NULL THEN
         (CASE WHEN j.ada_rincian = 1 THEN j.tagih_rincian WHEN j.delivery_type LIKE N'LG%' OR j.tipe_loco = 1 THEN 0
               WHEN j.baris_tanpa_tarif = 0 THEN j.tagih_tarif
               WHEN j.tagih_harga IS NOT NULL THEN j.tagih_harga END) * k.ton_kirim / j.ton_do END AS tagih,   -- kosong = belum bisa dihitung (NULL), bukan 0
       CASE WHEN j.delivery_type IS NULL THEN NULL WHEN j.ada_rincian = 1 THEN N'rincian' WHEN j.delivery_type LIKE N'LG%' OR j.tipe_loco = 1 THEN N'lg'
            WHEN j.baris_tanpa_tarif = 0 THEN N'tarif' WHEN j.tagih_harga IS NOT NULL THEN N'harga' ELSE N'kosong' END AS tagih_sumber,
       CASE WHEN j.ton_do > 0 AND j.delivery_type IS NOT NULL THEN j.handling * k.ton_kirim / j.ton_do END AS handling,
       CASE WHEN j.ton_do > 0 AND j.delivery_type IS NOT NULL THEN j.tagih_harga * k.ton_kirim / j.ton_do END AS tagih_dari_harga,
       CASE WHEN j.ton_do > 0 AND j.delivery_type IS NOT NULL AND j.baris_tanpa_tarif = 0 THEN j.tagih_tarif * k.ton_kirim / j.ton_do END AS tagih_dari_tarif,
       CASE WHEN j.ton_loco > 0 THEN j.nilai_loco / j.ton_loco END AS loco_per_ton,
       CASE WHEN j.ton_harga > 0 THEN j.nilai_harga / j.ton_harga END AS harga_per_ton
FROM (
  SELECT o.dist_code, o.periode, o.do_no,
         SUM(CASE WHEN f.sumber_biaya = N'logistik' THEN CASE WHEN f.ton > 0 THEN f.biaya * o.ton / f.ton ELSE 0 END ELSE o.total END) AS biaya,
         SUM(CASE WHEN f.sumber_biaya = N'logistik' AND f.ton > 0 THEN f.biaya * o.ton / f.ton END) AS biaya_logistik,
         SUM(o.ton) AS ton_kirim, COUNT(DISTINCT o.foad) AS trip,
         COUNT(DISTINCT CASE WHEN f.biaya = 0 AND f.status_transporter <> N'truk_toko' THEN o.foad END) AS trip_tanpa_biaya,
         COUNT(DISTINCT CASE WHEN f.biaya = 0 AND f.status_transporter = N'armada_sendiri' THEN o.foad END) AS trip_luar_erp,
         COUNT(DISTINCT CASE WHEN f.status_transporter = N'truk_toko' THEN o.foad END) AS trip_truk_toko,
         MAX(o.truk) AS truk, MAX(o.transporter) AS transporter, MAX(o.zona) AS zona, MAX(o.segmen) AS segmen, MAX(o.tujuan) AS tujuan, MAX(f.jalur) AS jalur
  FROM sementrack.v_ongkos_baris o
  JOIN sementrack.v_ongkos_trip f ON f.dist_code = o.dist_code AND f.periode = o.periode AND f.foad = o.foad
  WHERE o.ton > 0 AND ISNULL(TRIM(o.do_no), N'') NOT IN (N'-', N'')
  GROUP BY o.dist_code, o.periode, o.do_no
) k
OUTER APPLY (
  SELECT MIN(s.do_date) AS do_date, MAX(s.customer_code) AS customer_code, MAX(s.customer_name) AS customer_name,
         MAX(s.delivery_type) AS delivery_type, MAX(s.zona_kirim) AS zona_kirim, MAX(s.kecamatan) AS kecamatan, MAX(s.kabupaten) AS kabupaten,
         SUM(x.ton) AS ton_do, SUM(s.net_amount) AS net,
         MAX(CASE WHEN ISNULL(s.harga_kirim, 0) <> 0 OR ISNULL(s.diskon_kirim, 0) <> 0 OR ISNULL(s.tambah_kirim, 0) <> 0 THEN 1 ELSE 0 END) AS ada_rincian,
         SUM((ISNULL(s.harga_kirim, 0) - ISNULL(s.diskon_kirim, 0) + ISNULL(s.tambah_kirim, 0) + ISNULL(s.handling, 0)) * s.order_qty) AS tagih_rincian,   -- ongkir + bongkar
         SUM(CASE WHEN s.harga_produk IS NOT NULL AND hl.loco IS NOT NULL
                  THEN (CASE WHEN s.harga_produk > hl.loco THEN s.harga_produk - hl.loco ELSE 0 END) * s.order_qty END) AS tagih_harga,
         SUM(ISNULL(s.handling, 0) * s.order_qty) AS handling,
         SUM(tk.ongkir * s.order_qty) AS tagih_tarif,
         SUM(CASE WHEN tk.ongkir IS NULL THEN 1 ELSE 0 END) AS baris_tanpa_tarif,
         MAX(CASE WHEN tm.delivery_type LIKE N'LOCO%' THEN 1 ELSE 0 END) AS tipe_loco,
         SUM(CASE WHEN hl.loco IS NOT NULL THEN hl.loco * s.order_qty END) AS nilai_loco,
         SUM(CASE WHEN hl.loco IS NOT NULL THEN x.ton END) AS ton_loco,
         SUM(CASE WHEN s.harga_produk IS NOT NULL THEN s.harga_produk * s.order_qty END) AS nilai_harga,
         SUM(CASE WHEN s.harga_produk IS NOT NULL THEN x.ton END) AS ton_harga
  FROM sementrack.sellout_j073 s
  CROSS APPLY (SELECT sementrack.j073_ton(s.product_code, s.product_name, s.order_qty) AS ton) x
  -- Harga Loco pembanding: kolom Price (sebelum promo), karena Product Price J073 juga sebelum diskon.
  -- Gudang harus sama (nama gudang J073 mengandung / dikandung gudang harga); gudang lain hanya boleh kalau distributor itu
  -- cuma punya satu gudang harga untuk produk dan tanggal tsb. Tanpa pembanding yang cocok: ongkir belum bisa dihitung.
  OUTER APPLY (SELECT TOP (1) ISNULL(h.price, h.net_price) AS loco FROM sementrack.harga_loco h
               WHERE h.dist_code = s.dist_code AND h.product_code = s.product_code
                 AND s.do_date >= h.berlaku_dari AND (h.berlaku_sampai IS NULL OR s.do_date <= h.berlaku_sampai)
                 AND (h.warehouse = ISNULL(s.warehouse, N'')
                      OR (h.warehouse <> N'' AND ISNULL(s.warehouse, N'') LIKE N'%' + h.warehouse + N'%')
                      OR (ISNULL(s.warehouse, N'') <> N'' AND h.warehouse LIKE N'%' + s.warehouse + N'%')
                      OR NOT EXISTS (SELECT 1 FROM sementrack.harga_loco h2
                                     WHERE h2.dist_code = h.dist_code AND h2.product_code = h.product_code AND h2.warehouse <> h.warehouse
                                       AND s.do_date >= h2.berlaku_dari AND (h2.berlaku_sampai IS NULL OR s.do_date <= h2.berlaku_sampai)))
               ORDER BY CASE WHEN h.warehouse = ISNULL(s.warehouse, N'') THEN 0 ELSE 1 END, h.berlaku_dari DESC) hl
  -- tarif resmi: kode tipe J073 (kata pertama Delivery Type) -> tipe di tabel harga, zona J073 = Zone harga, gudang seperti harga Loco
  OUTER APPLY (SELECT TOP (1) m.delivery_type FROM sementrack.harga_tipe_map m
               WHERE m.kode = UPPER(LEFT(LTRIM(s.delivery_type), CHARINDEX(N' ', LTRIM(s.delivery_type) + N' ') - 1))) tm
  OUTER APPLY (SELECT TOP (1) hk.ongkir FROM sementrack.harga_kirim hk
               WHERE tm.delivery_type NOT LIKE N'LOCO%' AND hk.dist_code = s.dist_code AND hk.product_code = s.product_code
                 AND hk.delivery_type = tm.delivery_type AND hk.zone = UPPER(TRIM(ISNULL(s.zona_kirim, N'')))
                 AND s.do_date >= hk.berlaku_dari AND (hk.berlaku_sampai IS NULL OR s.do_date <= hk.berlaku_sampai)
                 AND (hk.warehouse = ISNULL(s.warehouse, N'')
                      OR (hk.warehouse <> N'' AND ISNULL(s.warehouse, N'') LIKE N'%' + hk.warehouse + N'%')
                      OR (ISNULL(s.warehouse, N'') <> N'' AND hk.warehouse LIKE N'%' + s.warehouse + N'%')
                      OR NOT EXISTS (SELECT 1 FROM sementrack.harga_kirim k2
                                     WHERE k2.dist_code = hk.dist_code AND k2.product_code = hk.product_code AND k2.delivery_type = hk.delivery_type
                                       AND k2.zone = hk.zone AND k2.warehouse <> hk.warehouse
                                       AND s.do_date >= k2.berlaku_dari AND (k2.berlaku_sampai IS NULL OR s.do_date <= k2.berlaku_sampai)))
               ORDER BY CASE WHEN hk.warehouse = ISNULL(s.warehouse, N'') THEN 0 ELSE 1 END, hk.berlaku_dari DESC) tk
  WHERE s.dist_code = k.dist_code AND s.do_no = k.do_no
) j;
GO

-- Bulan x distributor: muatan ke toko, angkutan ke gudang, ringkasan DO yang biayanya lengkap (grafik margin per bulan),
-- dan ton yang biayanya dari rekap logistik / yang ada di rekap
CREATE OR ALTER VIEW sementrack.v_ongkos_info AS
SELECT t.dist_code, d.kode, d.nama, t.periode,
       SUM(CASE WHEN t.ke_gudang = 0 THEN 1 ELSE 0 END) AS trip,
       SUM(CASE WHEN t.ke_gudang = 0 THEN t.ton ELSE 0 END) AS ton,
       SUM(CASE WHEN t.ke_gudang = 0 AND t.biaya > 0 THEN t.ton ELSE 0 END) AS ton_berbiaya,
       SUM(CASE WHEN t.ke_gudang = 0 THEN t.biaya ELSE 0 END) AS biaya,
       SUM(CASE WHEN t.ke_gudang = 1 THEN 1 ELSE 0 END) AS trip_gudang,
       SUM(CASE WHEN t.ke_gudang = 1 THEN t.ton ELSE 0 END) AS ton_gudang,
       SUM(CASE WHEN t.ke_gudang = 1 THEN t.biaya ELSE 0 END) AS biaya_gudang,
       SUM(CASE WHEN t.ke_gudang = 0 AND t.sumber_biaya = N'logistik' THEN t.ton ELSE 0 END) AS ton_biaya_rekap,
       SUM(CASE WHEN t.ke_gudang = 0 AND t.jalur IS NOT NULL THEN t.ton ELSE 0 END) AS ton_rekap,
       SUM(CASE WHEN t.ke_gudang = 0 AND t.dari_erp = 0 THEN t.ton ELSE 0 END) AS ton_tanpa_ordb,
       (SELECT MAX(do_date) FROM sementrack.sellout_j073 j WHERE j.dist_code = t.dist_code) AS j073_sampai,
       MAX(l.real_lengkap) AS real_lengkap, MAX(l.ton_lengkap) AS ton_lengkap, MAX(l.tagih_lengkap) AS tagih_lengkap, MAX(l.ton_tagih) AS ton_tagih
FROM sementrack.v_ongkos_trip t
JOIN sementrack.v_ongkos_dist d ON d.dist_code = t.dist_code
OUTER APPLY (
  SELECT SUM(o.biaya) AS real_lengkap, SUM(o.ton_kirim) AS ton_lengkap,
         SUM(CASE WHEN o.tagih IS NOT NULL THEN o.tagih END) AS tagih_lengkap, SUM(CASE WHEN o.tagih IS NOT NULL THEN o.ton_kirim END) AS ton_tagih
  FROM sementrack.v_ongkos_do o
  WHERE o.dist_code = t.dist_code AND o.periode = t.periode AND o.trip_tanpa_biaya = 0
) l
WHERE t.ton > 0 AND t.periode >= '20260101'
GROUP BY t.dist_code, d.kode, d.nama, t.periode;
GO

-- Cek: per distributor x bulan, FOAD ke toko di ORDB019 dan di rekap, dan biaya dari mana
SELECT t.dist_code, t.periode, COUNT(*) AS foad, SUM(t.dari_erp) AS di_ordb, SUM(CASE WHEN t.jalur IS NOT NULL THEN 1 ELSE 0 END) AS di_rekap,
       SUM(CASE WHEN t.sumber_biaya = N'erp' THEN 1 ELSE 0 END) AS biaya_ordb, SUM(CASE WHEN t.sumber_biaya = N'logistik' THEN 1 ELSE 0 END) AS biaya_rekap,
       SUM(CASE WHEN t.biaya = 0 THEN 1 ELSE 0 END) AS tanpa_biaya
FROM sementrack.v_ongkos_trip t WHERE t.ke_gudang = 0
GROUP BY t.dist_code, t.periode ORDER BY t.dist_code, t.periode;
-- Cek silang FOAD yang biayanya ada di keduanya: sama kalau selisih <= 1%
SELECT t.dist_code, COUNT(*) AS foad, SUM(CASE WHEN ABS(t.biaya_erp - t.biaya_logistik) <= 0.01 * t.biaya_erp THEN 1 ELSE 0 END) AS sama,
       CAST(SUM(t.biaya_erp) AS decimal(20,0)) AS biaya_ordb, CAST(SUM(t.biaya_logistik) AS decimal(20,0)) AS biaya_rekap
FROM sementrack.v_ongkos_trip t WHERE t.biaya_erp > 0 AND t.biaya_logistik > 0 GROUP BY t.dist_code ORDER BY t.dist_code;
