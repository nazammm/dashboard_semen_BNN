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
   jalankan file ini lagi sesudahnya. Aman dijalankan ulang.
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

/* ---------- 3. view ---------- */
CREATE OR ALTER VIEW sementrack.v_ongkos_trip AS
SELECT t.*, ISNULL(ot.status,
         CASE WHEN t.transporter LIKE N'%LINTAS ABADI MAKMUR%' THEN N'armada_sendiri'
              WHEN t.transporter LIKE N'%EKS%TOKO%' THEN N'truk_toko' ELSE N'normal' END) AS status_transporter
FROM (
  SELECT k.dist_code, k.periode, k.foad, MIN(k.kirim_date) AS kirim_date,
         MAX(k.transporter) AS transporter, MAX(k.truk) AS truk, MAX(k.asal) AS asal, MAX(k.zona) AS zona, MAX(k.tujuan) AS tujuan,
         MAX(k.segmen) AS segmen, MAX(k.harga_ritase) AS harga_ritase, SUM(k.total) AS biaya, SUM(k.ton) AS ton,
         COUNT(DISTINCT k.do_no) AS jumlah_do,
         CAST(MIN(CASE WHEN ISNULL(TRIM(k.do_no), N'') IN (N'-', N'') THEN 1 ELSE 0 END) AS bit) AS ke_gudang,
         LEFT(MAX(k.transporter), CHARINDEX(N' - ', MAX(k.transporter) + N' - ') - 1) AS transporter_kode
  FROM sementrack.ongkos_kirim k
  GROUP BY k.dist_code, k.periode, k.foad
) t
LEFT JOIN sementrack.ongkos_transporter ot ON ot.kode = t.transporter_kode;
GO

-- Satu baris per DO ke toko (tanpa angkutan ke gudang). tagih = ongkir + bongkar yang dibayar toko (di atas harga ambil sendiri),
-- tagih_sumber, urut dipakai:
--   rincian = Delivery Price - Delivery Discount + Delivery Add + Handling Cost dari J073 (yang benar-benar tertulis di DO itu);
--   lg      = ambil sendiri (LG, atau kode yang di harga_tipe_map dipasangkan ke tipe LOCO ...) = 0;
--   tarif   = tarif resmi di harga_kirim (18_harga_loco.sql): tipe kirim (harga_tipe_map) + zona J073 + gudang + tanggal DO;
--   harga   = Product Price - harga Loco kolom Price, gudang sama;
--   kosong  = belum bisa dihitung (NULL).
-- Diskon / promo / cash back tidak dihitung: itu potongan harga semen per toko, bukan potongan ongkir.
-- tagih_dari_harga / tagih_dari_tarif = hasil cara itu untuk semua DO (untuk cek silang).
CREATE OR ALTER VIEW sementrack.v_ongkos_do AS
SELECT k.dist_code, k.periode, k.do_no, k.biaya, k.ton_kirim, k.trip, k.trip_tanpa_biaya, k.trip_luar_erp, k.trip_truk_toko, k.truk, k.transporter, k.zona, k.segmen, k.tujuan,
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
  SELECT o.dist_code, o.periode, o.do_no, SUM(o.total) AS biaya, SUM(o.ton) AS ton_kirim, COUNT(DISTINCT o.foad) AS trip,
         COUNT(DISTINCT CASE WHEN f.biaya = 0 AND f.status_transporter <> N'truk_toko' THEN o.foad END) AS trip_tanpa_biaya,
         COUNT(DISTINCT CASE WHEN f.biaya = 0 AND f.status_transporter = N'armada_sendiri' THEN o.foad END) AS trip_luar_erp,
         COUNT(DISTINCT CASE WHEN f.status_transporter = N'truk_toko' THEN o.foad END) AS trip_truk_toko,
         MAX(o.truk) AS truk, MAX(o.transporter) AS transporter, MAX(o.zona) AS zona, MAX(o.segmen) AS segmen, MAX(o.tujuan) AS tujuan
  FROM sementrack.ongkos_kirim o
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

-- Bulan x distributor: muatan ke toko, angkutan ke gudang, dan ringkasan DO yang biayanya lengkap (untuk grafik margin per bulan)
CREATE OR ALTER VIEW sementrack.v_ongkos_info AS
SELECT t.dist_code, d.kode, d.nama, t.periode,
       SUM(CASE WHEN t.ke_gudang = 0 THEN 1 ELSE 0 END) AS trip,
       SUM(CASE WHEN t.ke_gudang = 0 THEN t.ton ELSE 0 END) AS ton,
       SUM(CASE WHEN t.ke_gudang = 0 AND t.biaya > 0 THEN t.ton ELSE 0 END) AS ton_berbiaya,
       SUM(CASE WHEN t.ke_gudang = 0 THEN t.biaya ELSE 0 END) AS biaya,
       SUM(CASE WHEN t.ke_gudang = 1 THEN 1 ELSE 0 END) AS trip_gudang,
       SUM(CASE WHEN t.ke_gudang = 1 THEN t.ton ELSE 0 END) AS ton_gudang,
       SUM(CASE WHEN t.ke_gudang = 1 THEN t.biaya ELSE 0 END) AS biaya_gudang,
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
