/* ============================================================================
   18_harga_loco.sql · Harga Loco Net untuk perkiraan nilai Outstanding DO
   - sementrack.harga_loco: harga baris "LOCO GUDANG" dari ERP (Order Process → Other Inquiry →
     Price & Promo Simulation), per distributor (kode ERP) x produk x masa berlaku
     (Effective Date s.d. Expired Date; Expired kosong = masih berlaku).
     Diisi Nazam Auto Task (bagian Harga Loco) lewat Kelola Data → Sell In BNN → Harga Loco.
   - sementrack.harga_dist_map: kode distributor di Outstanding DO -> kode ERP harga. Bawaan:
     1001 sub region KTP -> 1001K, 1001 lainnya -> 1001P. Distributor lain memakai kodenya sendiri.
     Tambah baris di sini kalau ada distributor OS yang harganya ikut distributor lain.
   - sementrack.harga_gudang_map: distributor dengan beberapa gudang LOCO (mis. INSA: INSA, KUALA TANJUNG, ACEH)
     -> gudang mana yang dipakai untuk tujuan OS tertentu. Urutan pemilihan gudang untuk satu baris OS:
       1. pola tujuan di harga_gudang_map (selain '%') yang cocok dengan Tujuan / sub region OS;
       2. nama gudang tertulis di Tujuan OS (mis. "Kuala Tanjung, Pelabuhan" -> KUALA TANJUNG);
       3. gudang utama distributor (baris '%' di harga_gudang_map, mis. 4094 -> INSA);
       4. kalau distributor itu hanya punya satu gudang LOCO, gudang itu. Selain itu: belum ada harga (tidak ditebak).
   - v_outstanding_do_harga: Outstanding DO + harga Loco Net yang berlaku pada tanggal order,
     nilai = sisa zak x Loco Net. v_outstanding_do_ringkas dapat kolom nilai dan ton_tanpa_harga.
   Produk dicocokkan lewat tipe semen (STR = CMT / Tiga Roda, RJW = Rajawali, CWC = white cement),
   berat per zak, dan OPC / bukan.
   Jalankan di SSMS, database MARKETING_ANALIS, setelah 02_sellin.sql dan 17_ongkos_kirim.sql.
   Kalau 02_sellin.sql dijalankan ulang, jalankan file ini lagi sesudahnya. Aman dijalankan ulang.
============================================================================ */

/* ---------- 1. tabel ---------- */
IF OBJECT_ID(N'sementrack.harga_loco', N'U') IS NULL
CREATE TABLE sementrack.harga_loco (
  dist_code nvarchar(20) NOT NULL,          -- kode ERP (4094, 9575, 1001K, ...)
  product_code nvarchar(30) NOT NULL,       -- CMT002, ...
  product_name nvarchar(200) NULL,          -- PCC@50KG
  semen nvarchar(10) NOT NULL,              -- STR / RJW / CWC
  kg decimal(9,2) NULL,                     -- berat per zak
  opc bit NOT NULL CONSTRAINT DF_harga_loco_opc DEFAULT 0,
  warehouse nvarchar(50) NOT NULL CONSTRAINT DF_harga_loco_wh DEFAULT N'',
  berlaku_dari date NOT NULL,               -- Effective Date
  berlaku_sampai date NULL,                 -- Expired Date (NULL = masih berlaku)
  price decimal(18,2) NULL,
  net_price decimal(18,2) NOT NULL,         -- Net Price baris LOCO GUDANG, per zak
  diambil date NULL,                        -- tanggal harga dibaca dari ERP
  created_by nvarchar(200) NULL,
  created_at datetimeoffset NOT NULL CONSTRAINT DF_harga_loco_at DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT PK_harga_loco PRIMARY KEY (dist_code, product_code, warehouse, berlaku_dari)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_harga_loco_cari' AND object_id = OBJECT_ID(N'sementrack.harga_loco'))
  CREATE INDEX IX_harga_loco_cari ON sementrack.harga_loco (dist_code, semen, kg, berlaku_dari) INCLUDE (opc, berlaku_sampai, net_price, warehouse);
GO

IF OBJECT_ID(N'sementrack.harga_dist_map', N'U') IS NULL
CREATE TABLE sementrack.harga_dist_map (
  os_code nvarchar(20) NOT NULL,            -- kode di kolom distributor Outstanding DO ("1001 - PT. ..." -> 1001)
  region_like nvarchar(100) NOT NULL,       -- pola LIKE untuk sub region OS, '%' = semua
  erp_code nvarchar(20) NOT NULL,           -- kode ERP di harga_loco
  CONSTRAINT PK_harga_dist_map PRIMARY KEY (os_code, region_like)
);
GO
IF NOT EXISTS (SELECT 1 FROM sementrack.harga_dist_map WHERE os_code = N'1001')
  INSERT INTO sementrack.harga_dist_map (os_code, region_like, erp_code) VALUES (N'1001', N'%KTP%', N'1001K'), (N'1001', N'%', N'1001P');
GO

IF OBJECT_ID(N'sementrack.harga_gudang_map', N'U') IS NULL
CREATE TABLE sementrack.harga_gudang_map (
  dist_code nvarchar(20) NOT NULL,          -- kode ERP harga (4094, 1001K, ...)
  tujuan_like nvarchar(200) NOT NULL,       -- pola LIKE untuk "Tujuan | sub region" OS (huruf besar), '%' = gudang utama
  warehouse nvarchar(50) NOT NULL,          -- kolom Warehouse di ERP Price & Promo Simulation
  CONSTRAINT PK_harga_gudang_map PRIMARY KEY (dist_code, tujuan_like)
);
GO
IF NOT EXISTS (SELECT 1 FROM sementrack.harga_gudang_map WHERE dist_code = N'4094')
  INSERT INTO sementrack.harga_gudang_map (dist_code, tujuan_like, warehouse) VALUES
    (N'4094', N'%', N'INSA'),                       -- Belawan / Medan: gudang INSA
    (N'4094', N'%KUALA TANJUNG%', N'KUALA TANJUNG'),
    (N'4094', N'%ACEH%', N'ACEH'), (N'4094', N'%LHOKSEUMAWE%', N'ACEH'), (N'4094', N'%KRUENG GEUKUEH%', N'ACEH'),
    (N'4094', N'%MALAHAYATI%', N'ACEH'), (N'4094', N'%MEULABOH%', N'ACEH');
GO

ALTER TABLE sementrack.kelola_log DROP CONSTRAINT IF EXISTS CK_kelola_log_dataset_check;
ALTER TABLE sementrack.kelola_log ADD CONSTRAINT CK_kelola_log_dataset_check
  CHECK (dataset IN (N'transaksi', N'sellin', N'dofas', N'erp', N'j073', N'target', N'outstanding', N'tabel', N'stock', N'ongkos', N'harga'));
GO

/* ---------- 2. simpan ----------
   Baris: [dist_code, product_code, product_name, semen, kg, opc (0/1), warehouse, berlaku_dari, berlaku_sampai, price, net_price, diambil].
   Untuk tiap (distributor, produk) di file, masa berlaku yang mulai sejak berlaku_dari paling awal di file diganti seluruhnya. */
CREATE OR ALTER PROCEDURE sementrack.harga_loco_simpan @p_rows nvarchar(max), @p_user nvarchar(200), @p_file nvarchar(4000) = NULL
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @old int, @new int, @from date, @to date, @dists nvarchar(max), @b int, @msg nvarchar(2048);
  IF ISJSON(@p_rows) = 0 OR LEFT(LTRIM(@p_rows), 1) <> N'[' OR NOT EXISTS (SELECT 1 FROM OPENJSON(@p_rows))
    THROW 52024, N'Tidak ada baris harga', 1;

  SELECT CAST(r.[key] AS int) + 1 AS baris,
         UPPER(TRIM(JSON_VALUE(r.[value], '$[0]'))) AS dist_code, UPPER(TRIM(JSON_VALUE(r.[value], '$[1]'))) AS product_code,
         NULLIF(TRIM(JSON_VALUE(r.[value], '$[2]')), N'') AS product_name, UPPER(TRIM(JSON_VALUE(r.[value], '$[3]'))) AS semen,
         sementrack.angka(JSON_VALUE(r.[value], '$[4]')) AS kg, CASE WHEN JSON_VALUE(r.[value], '$[5]') IN (N'1', N'true') THEN 1 ELSE 0 END AS opc,
         ISNULL(UPPER(TRIM(JSON_VALUE(r.[value], '$[6]'))), N'') AS warehouse,
         TRY_CONVERT(date, JSON_VALUE(r.[value], '$[7]'), 23) AS berlaku_dari, TRY_CONVERT(date, NULLIF(JSON_VALUE(r.[value], '$[8]'), N''), 23) AS berlaku_sampai,
         sementrack.angka(JSON_VALUE(r.[value], '$[9]')) AS price, sementrack.angka(JSON_VALUE(r.[value], '$[10]')) AS net_price,
         TRY_CONVERT(date, NULLIF(JSON_VALUE(r.[value], '$[11]'), N''), 23) AS diambil
  INTO #h FROM OPENJSON(@p_rows) r;

  SELECT @b = MIN(baris) FROM #h
  WHERE ISNULL(dist_code, N'') = N'' OR ISNULL(product_code, N'') = N'' OR semen NOT IN (N'STR', N'RJW', N'CWC')
     OR berlaku_dari IS NULL OR net_price IS NULL OR net_price <= 0 OR (berlaku_sampai IS NOT NULL AND berlaku_sampai < berlaku_dari);
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Baris harga tidak lengkap (baris ', @b, N')'); THROW 52024, @msg, 1; END
  SELECT @b = MIN(baris) FROM #h WHERE LEN(dist_code) > 20 OR LEN(product_code) > 30 OR LEN(product_name) > 200 OR LEN(warehouse) > 50;
  IF @b IS NOT NULL BEGIN SET @msg = CONCAT(N'Teks terlalu panjang (baris ', @b, N')'); THROW 52024, @msg, 1; END

  -- baris kembar (masa berlaku sama dibaca dari beberapa tanggal simulasi): ambil yang paling baru dibaca
  ;WITH d AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY dist_code, product_code, warehouse, berlaku_dari ORDER BY diambil DESC, baris DESC) AS n FROM #h)
  DELETE FROM d WHERE n > 1;

  BEGIN TRAN;
  EXEC sp_getapplock @Resource = N'harga_loco', @LockMode = N'Exclusive', @LockOwner = N'Transaction';
  DELETE h FROM sementrack.harga_loco h
  JOIN (SELECT dist_code, product_code, MIN(berlaku_dari) AS mulai FROM #h GROUP BY dist_code, product_code) r
    ON h.dist_code = r.dist_code AND h.product_code = r.product_code AND h.berlaku_dari >= r.mulai;
  SET @old = @@ROWCOUNT;
  INSERT INTO sementrack.harga_loco (dist_code, product_code, product_name, semen, kg, opc, warehouse, berlaku_dari, berlaku_sampai, price, net_price, diambil, created_by)
  SELECT dist_code, product_code, product_name, semen, kg, opc, warehouse, berlaku_dari, berlaku_sampai, price, net_price, diambil, @p_user FROM #h;
  SET @new = @@ROWCOUNT;
  SELECT @from = MIN(berlaku_dari), @to = MAX(ISNULL(berlaku_sampai, diambil)) FROM #h;
  SELECT @dists = N'[' + STRING_AGG(N'"' + STRING_ESCAPE(dist_code, 'json') + N'"', N',') WITHIN GROUP (ORDER BY dist_code) + N']'
  FROM (SELECT DISTINCT dist_code FROM #h) x;
  INSERT INTO sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, dist_codes, rows_read, rows_saved, rows_deleted, status, finished_at)
  VALUES (N'harga', N'upload', @p_user, N'file', LEFT(@p_file, 200), @from, @to, @dists, @new, @new, @old, N'selesai', SYSDATETIMEOFFSET());
  COMMIT;
  SELECT @new AS rows_saved, @old AS rows_deleted, @from AS date_from, @to AS date_to, @dists AS dist_codes,
         (SELECT COUNT(DISTINCT CONCAT(dist_code, N'|', product_code)) FROM #h) AS kombinasi;
END
GO

/* ---------- 3. view ---------- */
-- Outstanding DO + harga Loco Net pada tanggal order
CREATE OR ALTER VIEW sementrack.v_outstanding_do_harga AS
SELECT o.*,
       e.erp_code AS harga_dist,
       h.product_code AS harga_produk,
       h.warehouse AS harga_gudang,
       h.net_price AS harga_loco,
       h.berlaku_dari AS harga_dari,
       h.berlaku_sampai AS harga_sampai,
       CAST(o.sisa_zak * h.net_price AS decimal(24,2)) AS nilai
FROM sementrack.v_outstanding_do o
CROSS APPLY (SELECT LEFT(o.distributor, CHARINDEX(N' ', o.distributor + N' ') - 1) AS os_code,
                    CAST(ROUND(o.sisa_ton * 1000 / NULLIF(o.sisa_zak, 0), 0) AS decimal(9,2)) AS kg,
                    CASE WHEN o.produk LIKE N'%OPC%' THEN 1 ELSE 0 END AS opc) k
OUTER APPLY (SELECT TOP (1) m.erp_code FROM sementrack.harga_dist_map m
             WHERE m.os_code = k.os_code AND ISNULL(o.region, N'') LIKE m.region_like
             ORDER BY CASE WHEN m.region_like = N'%' THEN 1 ELSE 0 END, LEN(m.region_like) DESC) mp
CROSS APPLY (SELECT ISNULL(mp.erp_code, k.os_code) AS erp_code) e
CROSS APPLY (SELECT UPPER(ISNULL(o.nama_tujuan, N'') + N' | ' + ISNULL(o.region, N'')) AS tujuan) t
OUTER APPLY (SELECT TOP (1) g.warehouse FROM sementrack.harga_gudang_map g
             WHERE g.dist_code = e.erp_code AND g.tujuan_like <> N'%' AND t.tujuan LIKE UPPER(g.tujuan_like)
             ORDER BY LEN(g.tujuan_like) DESC) gm
OUTER APPLY (SELECT TOP (1) g.warehouse FROM sementrack.harga_gudang_map g WHERE g.dist_code = e.erp_code AND g.tujuan_like = N'%') gd
OUTER APPLY (SELECT TOP (1) h.product_code, h.net_price, h.berlaku_dari, h.berlaku_sampai, h.warehouse
             FROM sementrack.harga_loco h
             CROSS APPLY (SELECT CASE WHEN h.warehouse = gm.warehouse THEN 0
                                      WHEN h.warehouse <> N'' AND CHARINDEX(h.warehouse, t.tujuan) > 0 THEN 1
                                      WHEN h.warehouse = gd.warehouse THEN 2 ELSE 3 END AS rk) r
             WHERE h.dist_code = e.erp_code AND h.semen = o.semen AND h.kg = k.kg AND h.opc = k.opc
               AND o.tanggal_order >= h.berlaku_dari AND (h.berlaku_sampai IS NULL OR o.tanggal_order <= h.berlaku_sampai)
               AND (r.rk < 3 OR NOT EXISTS (SELECT 1 FROM sementrack.harga_loco h2
                                            WHERE h2.dist_code = h.dist_code AND h2.semen = h.semen AND h2.kg = h.kg AND h2.opc = h.opc
                                              AND h2.warehouse <> h.warehouse AND o.tanggal_order >= h2.berlaku_dari
                                              AND (h2.berlaku_sampai IS NULL OR o.tanggal_order <= h2.berlaku_sampai)))
             ORDER BY r.rk, h.berlaku_dari DESC, h.product_code) h;
GO

-- Ringkasan halaman: sama dengan 02_sellin.sql + nilai dan ton yang belum ada harganya
CREATE OR ALTER VIEW sementrack.v_outstanding_do_ringkas AS
SELECT region, distributor, dist_nama, semen, status, jalur, tanggal_order, estimasi_kirim, posisi,
       COUNT(*) AS orders,
       CAST(ROUND(SUM(sisa_ton), 3) AS decimal(20,3)) AS ton,
       CAST(SUM(nilai) AS decimal(24,2)) AS nilai,
       CAST(ROUND(SUM(CASE WHEN harga_loco IS NULL THEN sisa_ton ELSE 0 END), 3) AS decimal(20,3)) AS ton_tanpa_harga
FROM sementrack.v_outstanding_do_harga
GROUP BY region, distributor, dist_nama, semen, status, jalur, tanggal_order, estimasi_kirim, posisi;
GO

-- Harga yang tersimpan per distributor x produk (Kelola Data dan keterangan halaman)
CREATE OR ALTER VIEW sementrack.v_harga_loco_info AS
SELECT h.dist_code, h.product_code, h.warehouse, MAX(h.product_name) AS product_name, h.semen, MAX(h.kg) AS kg,
       COUNT(*) AS masa_berlaku, MIN(h.berlaku_dari) AS dari, MAX(h.diambil) AS diambil,
       (SELECT TOP (1) x.net_price FROM sementrack.harga_loco x WHERE x.dist_code = h.dist_code AND x.product_code = h.product_code AND x.warehouse = h.warehouse
        ORDER BY x.berlaku_dari DESC) AS harga_terakhir,
       (SELECT TOP (1) x.berlaku_dari FROM sementrack.harga_loco x WHERE x.dist_code = h.dist_code AND x.product_code = h.product_code AND x.warehouse = h.warehouse
        ORDER BY x.berlaku_dari DESC) AS berlaku_terakhir,
       (SELECT TOP (1) x.berlaku_sampai FROM sementrack.harga_loco x WHERE x.dist_code = h.dist_code AND x.product_code = h.product_code AND x.warehouse = h.warehouse
        ORDER BY x.berlaku_dari DESC) AS sampai_terakhir
FROM sementrack.harga_loco h
GROUP BY h.dist_code, h.product_code, h.warehouse, h.semen;
GO

-- Cek: OS yang belum ketemu harganya, per distributor, tujuan, dan produk
SELECT harga_dist, nama_tujuan, produk, COUNT(*) AS orders, CAST(SUM(sisa_ton) AS decimal(20,1)) AS ton, MIN(tanggal_order) AS order_awal, MAX(tanggal_order) AS order_akhir
FROM sementrack.v_outstanding_do_harga WHERE harga_loco IS NULL AND status IN (N'Belum dikirim', N'Terkirim sebagian')
GROUP BY harga_dist, nama_tujuan, produk ORDER BY ton DESC;
-- Cek: gudang harga yang dipakai per distributor dan tujuan
SELECT harga_dist, nama_tujuan, harga_gudang, COUNT(*) AS orders, CAST(SUM(sisa_ton) AS decimal(20,1)) AS ton
FROM sementrack.v_outstanding_do_harga WHERE status IN (N'Belum dikirim', N'Terkirim sebagian')
GROUP BY harga_dist, nama_tujuan, harga_gudang ORDER BY harga_dist, ton DESC;
