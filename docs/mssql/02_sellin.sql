/* =============================================================================
   SEMENTRACK di SQL Server 2022, tahap 3a: Sell In BNN dan Outstanding DO.
   Fungsi pembantu + view baca. Jalankan di database MARKETING_ANALIS setelah 01_tabel.sql dan data tersalin.
   Aman dijalankan ulang.

   SQL Server tidak punya regex, jadi fungsi yang di PostgreSQL memakai regex (sellin_kg, sellin_dist_nama)
   ditulis ulang dengan pembacaan per karakter. Hasilnya sudah dibandingkan dengan fungsi PostgreSQL.

   Kolom hasil hitung yang dipakai banyak view disimpan sebagai kolom terhitung (PERSISTED): dihitung sekali
   saat baris masuk, bukan setiap kali halaman dibuka.
     sellin_bnn: ton (dulu kolom generated di PostgreSQL), mortar
     sellin_po : kg, mortar, semen, jalur, dist_nama
============================================================================= */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------- 1. lepas kolom terhitung dulu supaya fungsinya bisa diganti ---------- */
IF COL_LENGTH(N'sementrack.sellin_bnn', N'ton') IS NOT NULL ALTER TABLE sementrack.sellin_bnn DROP COLUMN ton;
IF COL_LENGTH(N'sementrack.sellin_bnn', N'mortar') IS NOT NULL ALTER TABLE sementrack.sellin_bnn DROP COLUMN mortar;
IF COL_LENGTH(N'sementrack.sellin_po', N'kg') IS NOT NULL ALTER TABLE sementrack.sellin_po DROP COLUMN kg;
IF COL_LENGTH(N'sementrack.sellin_po', N'mortar') IS NOT NULL ALTER TABLE sementrack.sellin_po DROP COLUMN mortar;
IF COL_LENGTH(N'sementrack.sellin_po', N'semen') IS NOT NULL ALTER TABLE sementrack.sellin_po DROP COLUMN semen;
IF COL_LENGTH(N'sementrack.sellin_po', N'jalur') IS NOT NULL ALTER TABLE sementrack.sellin_po DROP COLUMN jalur;
IF COL_LENGTH(N'sementrack.sellin_po', N'dist_nama') IS NOT NULL ALTER TABLE sementrack.sellin_po DROP COLUMN dist_nama;
GO

/* ---------- 2. fungsi pembantu ---------- */

-- Berat per zak dari nama produk: angka sebelum "KG" ("PCC 50KG" = 50, "X 1.5 kg" = 1,5). Tanpa angka: 40.
-- PostgreSQL: (\d+(?:[.,]\d+)?)\s*KG
CREATE OR ALTER FUNCTION sementrack.sellin_kg (@p nvarchar(4000))
RETURNS decimal(12,4)
WITH SCHEMABINDING
AS
BEGIN
  DECLARE @s nvarchar(4000) = UPPER(ISNULL(@p, N'')), @mulai int = 1, @pos int, @j int, @e int, @k int;
  WHILE 1 = 1
  BEGIN
    SET @pos = CHARINDEX(N'KG', @s, @mulai);
    IF @pos = 0 RETURN 40;
    SET @j = @pos - 1;
    WHILE @j >= 1 AND UNICODE(SUBSTRING(@s, @j, 1)) IN (32, 9, 10, 13) SET @j -= 1;    -- spasi sebelum KG
    SET @e = @j;
    WHILE @j >= 1 AND UNICODE(SUBSTRING(@s, @j, 1)) BETWEEN 48 AND 57 SET @j -= 1;    -- angka
    IF @e - @j BETWEEN 1 AND 6
    BEGIN
      IF @j >= 2 AND UNICODE(SUBSTRING(@s, @j, 1)) IN (44, 46) AND UNICODE(SUBSTRING(@s, @j - 1, 1)) BETWEEN 48 AND 57
      BEGIN                                                                            -- pecahan: 1.5 / 1,5
        SET @k = @j - 1;
        WHILE @k >= 1 AND UNICODE(SUBSTRING(@s, @k, 1)) BETWEEN 48 AND 57 SET @k -= 1;
        IF @j - 1 - @k <= 6
          RETURN CAST(SUBSTRING(@s, @k + 1, @j - 1 - @k) + N'.' + LEFT(SUBSTRING(@s, @j + 1, @e - @j), 4) AS decimal(12,4));
      END
      RETURN CAST(SUBSTRING(@s, @j + 1, @e - @j) AS decimal(12,4));
    END
    SET @mulai = @pos + 1;
  END
  RETURN 40;
END
GO

-- Mortar dan thinbed tidak dihitung sebagai semen.
CREATE OR ALTER FUNCTION sementrack.sellin_is_mortar (@p nvarchar(4000))
RETURNS bit
WITH SCHEMABINDING
AS
BEGIN
  RETURN CASE WHEN @p LIKE N'%MORTAR%' OR @p LIKE N'%THINBED%' THEN 1 ELSE 0 END;
END
GO

-- Jenis semen dari nama produk.
CREATE OR ALTER FUNCTION sementrack.sellin_semen (@p nvarchar(4000))
RETURNS nvarchar(3)
WITH SCHEMABINDING
AS
BEGIN
  RETURN CASE WHEN @p LIKE N'%RAJAWALI%' THEN N'RJW' WHEN @p LIKE N'%WHITE%' THEN N'CWC' ELSE N'STR' END;
END
GO

-- Jalur kirim dari asal pengiriman (FAS Kapal, FAS Container, Terminal, Pabrik, Lainnya).
CREATE OR ALTER FUNCTION sementrack.sellin_jalur (@p nvarchar(4000))
RETURNS nvarchar(20)
WITH SCHEMABINDING
AS
BEGIN
  RETURN CASE
    WHEN @p LIKE N'%SUNDA KELAPA%' OR @p LIKE N'%MARUNDA%' THEN N'FAS Kapal'
    WHEN @p LIKE N'%CONTAINER%' OR @p LIKE N'%CCY%' OR @p LIKE N'%PRIOK%' THEN N'FAS Container'
    WHEN @p LIKE N'%TERMINAL%' THEN N'Terminal'
    WHEN @p LIKE N'%CITEUREUP%' THEN N'Pabrik'
    ELSE N'Lainnya' END;
END
GO

-- Nama distributor rapi: "9575 - PERMATA KARYA BUANA,PT." menjadi "Permata Karya Buana".
-- PostgreSQL: buang "^\s*\d+\s*-\s*", buang PT/UD/FA/CV sebagai kata, rapikan tepi, initcap.
CREATE OR ALTER FUNCTION sementrack.sellin_dist_nama (@p nvarchar(4000))
RETURNS nvarchar(200)
WITH SCHEMABINDING
AS
BEGIN
  DECLARE @s nvarchar(4000) = ISNULL(@p, N''), @n int, @i int = 1, @d int, @t int, @e int, @m int, @ke int,
          @o nvarchar(4000) = N'', @r nvarchar(4000) = N'', @c int, @a int, @b int, @alnum bit, @prev bit = 0;

  -- 1. kode di depan: "9575 - "
  SET @n = DATALENGTH(@s) / 2;
  WHILE @i <= @n AND UNICODE(SUBSTRING(@s, @i, 1)) IN (32, 9, 10, 13) SET @i += 1;
  SET @d = @i;
  WHILE @i <= @n AND UNICODE(SUBSTRING(@s, @i, 1)) BETWEEN 48 AND 57 SET @i += 1;
  IF @i > @d
  BEGIN
    WHILE @i <= @n AND UNICODE(SUBSTRING(@s, @i, 1)) IN (32, 9, 10, 13) SET @i += 1;
    IF @i <= @n AND UNICODE(SUBSTRING(@s, @i, 1)) = 45
    BEGIN
      SET @i += 1;
      WHILE @i <= @n AND UNICODE(SUBSTRING(@s, @i, 1)) IN (32, 9, 10, 13) SET @i += 1;
      SET @s = SUBSTRING(@s, @i, 4000);
    END
  END

  -- 2. PT / UD / FA / CV (boleh diikuti titik) yang berdiri sendiri diganti spasi
  SET @n = DATALENGTH(@s) / 2; SET @i = 1;
  WHILE @i <= @n
  BEGIN
    SET @m = 0; SET @ke = 0;
    WHILE @ke < 2 AND @m = 0
    BEGIN
      SET @t = NULL;
      IF @ke = 0 AND @i = 1 SET @t = 1;                                                     -- di awal teks
      IF @ke = 1 AND UNICODE(SUBSTRING(@s, @i, 1)) IN (32, 9, 10, 13, 44, 46) SET @t = @i + 1;  -- setelah pemisah
      IF @t IS NOT NULL AND @t + 1 <= @n AND UPPER(SUBSTRING(@s, @t, 2)) IN (N'PT', N'UD', N'FA', N'CV')
      BEGIN
        SET @e = @t + 2;
        IF @e <= @n AND UNICODE(SUBSTRING(@s, @e, 1)) = 46 AND (@e + 1 > @n OR UNICODE(SUBSTRING(@s, @e + 1, 1)) IN (32, 9, 10, 13, 44, 46))
          SET @m = @e + 1;
        ELSE IF @e > @n OR UNICODE(SUBSTRING(@s, @e, 1)) IN (32, 9, 10, 13, 44, 46)
          SET @m = @e;
      END
      SET @ke += 1;
    END
    IF @m > 0 BEGIN SET @o += N' '; SET @i = @m; END
    ELSE BEGIN SET @o += SUBSTRING(@s, @i, 1); SET @i += 1; END
  END

  -- 3. buang spasi, koma, titik di kedua tepi
  SET @a = 1; SET @b = DATALENGTH(@o) / 2;
  WHILE @a <= @b AND UNICODE(SUBSTRING(@o, @a, 1)) IN (32, 9, 10, 13, 44, 46) SET @a += 1;
  WHILE @b >= @a AND UNICODE(SUBSTRING(@o, @b, 1)) IN (32, 9, 10, 13, 44, 46) SET @b -= 1;
  SET @o = SUBSTRING(@o, @a, @b - @a + 1);

  -- 4. huruf pertama tiap kata besar, sisanya kecil
  SET @i = 1; SET @n = DATALENGTH(@o) / 2;
  WHILE @i <= @n
  BEGIN
    SET @c = UNICODE(SUBSTRING(@o, @i, 1));
    SET @alnum = CASE WHEN @c BETWEEN 48 AND 57 OR @c BETWEEN 65 AND 90 OR @c BETWEEN 97 AND 122 THEN 1 ELSE 0 END;
    SET @r += CASE WHEN @alnum = 0 THEN NCHAR(@c) WHEN @prev = 1 THEN LOWER(NCHAR(@c)) ELSE UPPER(NCHAR(@c)) END;
    SET @prev = @alnum;
    SET @i += 1;
  END
  RETURN LEFT(@r, 200);
END
GO

-- Aturan sell in: Gudang, ditambah Toko/Project PERMATA MULTI NIAGA dari ITP-Palembang Terminal.
CREATE OR ALTER FUNCTION sementrack.sellin_rule (@tipe nvarchar(4000), @distributor nvarchar(4000), @asal nvarchar(4000))
RETURNS bit
WITH SCHEMABINDING
AS
BEGIN
  RETURN CASE
    WHEN LOWER(TRIM(ISNULL(@tipe, N''))) = N'gudang' THEN 1
    WHEN ISNULL(@distributor, N'') LIKE N'%PERMATA MULTI NIAGA%'
     AND LOWER(TRIM(ISNULL(@tipe, N''))) IN (N'toko', N'project')
     AND LOWER(TRIM(ISNULL(@asal, N''))) = N'itp-palembang terminal' THEN 1
    ELSE 0 END;
END
GO

-- Sama dengan sellin_rule, tanpa mortar/thinbed (di PostgreSQL: sellin_rule dengan 4 argumen).
CREATE OR ALTER FUNCTION sementrack.sellin_rule_produk (@tipe nvarchar(4000), @distributor nvarchar(4000), @asal nvarchar(4000), @produk nvarchar(4000))
RETURNS bit
WITH SCHEMABINDING
AS
BEGIN
  RETURN CASE WHEN sementrack.sellin_rule(@tipe, @distributor, @asal) = 1 AND sementrack.sellin_is_mortar(@produk) = 0 THEN 1 ELSE 0 END;
END
GO

-- Region sell in: dari peta customer; Toko/Project PERMATA MULTI NIAGA otomatis Sumsel.
CREATE OR ALTER FUNCTION sementrack.sellin_region (@map_region nvarchar(4000), @tipe nvarchar(4000), @distributor nvarchar(4000))
RETURNS nvarchar(200)
WITH SCHEMABINDING
AS
BEGIN
  RETURN COALESCE(
    @map_region,
    CASE WHEN LOWER(TRIM(ISNULL(@tipe, N''))) IN (N'toko', N'project') AND ISNULL(@distributor, N'') LIKE N'%PERMATA MULTI NIAGA%' THEN N'Sumsel' END,
    N'Belum dipetakan');
END
GO

/* ---------- 3. kolom terhitung ---------- */
ALTER TABLE sementrack.sellin_bnn ADD
  ton AS CAST(delivery_qty * sementrack.sellin_kg(tipe_produk) / 1000 AS decimal(20,6)) PERSISTED,
  mortar AS sementrack.sellin_is_mortar(tipe_produk) PERSISTED;
ALTER TABLE sementrack.sellin_po ADD
  kg AS sementrack.sellin_kg(tipe_produk) PERSISTED,
  mortar AS sementrack.sellin_is_mortar(tipe_produk) PERSISTED,
  semen AS sementrack.sellin_semen(tipe_produk) PERSISTED,
  jalur AS sementrack.sellin_jalur(asal_pengiriman) PERSISTED,
  dist_nama AS sementrack.sellin_dist_nama(distributor) PERSISTED;
GO

/* ---------- 4. view ---------- */

-- Sell in harian per region, produk, tipe pesanan, loco/franco (halaman Sell In BNN dan Overview).
CREATE OR ALTER VIEW sementrack.v_sellin_bnn_daily AS
SELECT b.tanggal, r.region, b.tipe_produk AS produk, x.tipe_pesanan, x.loco_franco,
       CAST(ROUND(SUM(b.ton), 3) AS decimal(20,3)) AS ton,
       SUM(b.delivery_qty) AS zak,
       COUNT(*) AS pengiriman
FROM sementrack.sellin_bnn b
LEFT JOIN sementrack.sellin_region_map m ON m.kode_customer = b.kode_customer
CROSS APPLY (SELECT sementrack.sellin_region(m.region, b.tipe_pesanan, b.distributor) AS region) r
CROSS APPLY (SELECT UPPER(LEFT(b.tipe_pesanan, 1)) + LOWER(SUBSTRING(b.tipe_pesanan, 2, 4000)) AS tipe_pesanan,
                    ISNULL(NULLIF(UPPER(LEFT(b.loco_franco, 1)) + LOWER(SUBSTRING(b.loco_franco, 2, 4000)), N''), N'Tidak diisi') AS loco_franco) x
WHERE b.mortar = 0
GROUP BY b.tanggal, r.region, b.tipe_produk, x.tipe_pesanan, x.loco_franco;
GO

CREATE OR ALTER VIEW sementrack.v_sellin_bnn_info AS
SELECT (SELECT MAX(tanggal) FROM sementrack.sellin_bnn) AS data_sampai,
       (SELECT MIN(tanggal) FROM sementrack.sellin_bnn) AS data_mulai,
       (SELECT COUNT(*) FROM sementrack.sellin_bnn) AS total_baris,
       u.created_at AS upload_terakhir,
       u.created_by AS upload_oleh
FROM (SELECT 1 AS satu) x
OUTER APPLY (SELECT TOP (1) created_at, created_by FROM sementrack.sellin_bnn_upload WHERE status = N'selesai' ORDER BY id DESC) u;
GO

-- Customer sell in yang belum punya region.
CREATE OR ALTER VIEW sementrack.v_sellin_unmapped AS
SELECT b.kode_customer,
       MAX(b.nama_customer) AS nama_customer,
       MAX(b.distributor) AS distributor,
       COUNT(*) AS pengiriman,
       CAST(ROUND(SUM(b.ton), 1) AS decimal(20,1)) AS ton,
       MAX(b.tanggal) AS terakhir
FROM sementrack.sellin_bnn b
LEFT JOIN sementrack.sellin_region_map m ON m.kode_customer = b.kode_customer
WHERE m.kode_customer IS NULL AND sementrack.sellin_region(NULL, b.tipe_pesanan, b.distributor) = N'Belum dipetakan'
GROUP BY b.kode_customer;
GO

-- Order yang belum terkirim penuh (Verified, Partially Delivered, Not Verified).
CREATE OR ALTER VIEW sementrack.v_outstanding_do AS
SELECT p.upload_id,
       sementrack.sellin_region(m.region, p.tipe_pesanan, p.distributor) AS region,
       p.distributor,
       p.dist_nama,
       p.order_no,
       p.tipe_produk AS produk,
       p.semen,
       CASE LOWER(p.status_order) WHEN N'verified' THEN N'Belum dikirim' WHEN N'partially delivered' THEN N'Terkirim sebagian' ELSE N'Belum diverifikasi' END AS status,
       p.tanggal_order,
       p.estimasi_kirim,
       p.kirim_terakhir,
       u.posisi,
       DATEDIFF(day, p.tanggal_order, u.posisi) AS umur_hari,
       CASE WHEN p.estimasi_kirim IS NOT NULL AND p.estimasi_kirim < u.posisi THEN DATEDIFF(day, p.estimasi_kirim, u.posisi) ELSE 0 END AS lewat_hari,
       p.kode_customer,
       p.nama_customer,
       p.kode_tujuan,
       p.nama_tujuan,
       p.asal_pengiriman,
       p.jalur,
       UPPER(LEFT(p.tipe_pesanan, 1)) + LOWER(SUBSTRING(p.tipe_pesanan, 2, 4000)) AS tipe_pesanan,
       ISNULL(NULLIF(UPPER(LEFT(p.loco_franco, 1)) + LOWER(SUBSTRING(p.loco_franco, 2, 4000)), N''), N'Tidak diisi') AS loco_franco,
       p.order_qty,
       p.delivery_qty,
       GREATEST(p.order_qty - p.delivery_qty, 0) AS sisa_zak,
       CAST(ROUND(GREATEST(p.order_qty - p.delivery_qty, 0) * p.kg / 1000, 3) AS decimal(20,3)) AS sisa_ton,
       CAST(ROUND(p.order_qty * p.kg / 1000, 3) AS decimal(20,3)) AS order_ton
FROM sementrack.sellin_po p
JOIN sementrack.sellin_po_upload u ON u.id = p.upload_id
LEFT JOIN sementrack.sellin_region_map m ON m.kode_customer = p.kode_customer
WHERE LOWER(p.status_order) IN (N'verified', N'partially delivered', N'not verified')
  AND p.order_qty > p.delivery_qty
  AND p.mortar = 0;
GO

CREATE OR ALTER VIEW sementrack.v_outstanding_do_ringkas AS
SELECT region, distributor, dist_nama, semen, status, jalur, tanggal_order, estimasi_kirim, posisi,
       COUNT(*) AS orders,
       CAST(ROUND(SUM(sisa_ton), 3) AS decimal(20,3)) AS ton
FROM sementrack.v_outstanding_do
GROUP BY region, distributor, dist_nama, semen, status, jalur, tanggal_order, estimasi_kirim, posisi;
GO

CREATE OR ALTER VIEW sementrack.v_outstanding_do_info AS
SELECT (SELECT MAX(u1.posisi) FROM sementrack.sellin_po_upload u1
         WHERE u1.status = N'selesai' AND EXISTS (SELECT 1 FROM sementrack.sellin_po p WHERE p.upload_id = u1.id)) AS posisi,
       (SELECT MIN(u1.posisi) FROM sementrack.sellin_po_upload u1
         WHERE u1.status = N'selesai' AND EXISTS (SELECT 1 FROM sementrack.sellin_po p WHERE p.upload_id = u1.id)) AS posisi_terlama,
       (SELECT MIN(tanggal_order) FROM sementrack.sellin_po) AS order_mulai,
       (SELECT MAX(tanggal_order) FROM sementrack.sellin_po) AS order_sampai,
       (SELECT COUNT(*) FROM sementrack.sellin_po) AS total_order,
       u.created_at AS upload_terakhir,
       u.created_by AS upload_oleh
FROM (SELECT 1 AS satu) x
OUTER APPLY (SELECT TOP (1) created_at, created_by FROM sementrack.sellin_po_upload WHERE status = N'selesai' ORDER BY id DESC) u;
GO

-- Order per bulan order: dipesan, terkirim, outstanding, belum diverifikasi, ditolak.
CREATE OR ALTER VIEW sementrack.v_sellin_po_bulanan AS
SELECT YEAR(p.tanggal_order) AS tahun,
       MONTH(p.tanggal_order) AS bulan,
       r.region,
       p.distributor,
       p.semen,
       CAST(ROUND(SUM(CASE WHEN LOWER(p.status_order) <> N'reject' THEN p.order_qty * p.kg / 1000 END), 3) AS decimal(20,3)) AS order_ton,
       CAST(ROUND(SUM(CASE WHEN LOWER(p.status_order) <> N'reject' THEN LEAST(p.delivery_qty, p.order_qty) * p.kg / 1000 END), 3) AS decimal(20,3)) AS terkirim_ton,
       CAST(ROUND(SUM(CASE WHEN LOWER(p.status_order) IN (N'verified', N'partially delivered') THEN GREATEST(p.order_qty - p.delivery_qty, 0) * p.kg / 1000 END), 3) AS decimal(20,3)) AS outstanding_ton,
       CAST(ROUND(SUM(CASE WHEN LOWER(p.status_order) = N'not verified' THEN GREATEST(p.order_qty - p.delivery_qty, 0) * p.kg / 1000 END), 3) AS decimal(20,3)) AS belum_verifikasi_ton,
       CAST(ROUND(SUM(CASE WHEN LOWER(p.status_order) = N'reject' THEN p.order_qty * p.kg / 1000 END), 3) AS decimal(20,3)) AS reject_ton
FROM sementrack.sellin_po p
LEFT JOIN sementrack.sellin_region_map m ON m.kode_customer = p.kode_customer
CROSS APPLY (SELECT sementrack.sellin_region(m.region, p.tipe_pesanan, p.distributor) AS region) r
WHERE p.mortar = 0
GROUP BY YEAR(p.tanggal_order), MONTH(p.tanggal_order), r.region, p.distributor, p.semen;
GO

-- Target dan realisasi sell in per bulan (Kelola Data → Target).
CREATE OR ALTER VIEW sementrack.v_target_sell_in AS
SELECT tahun, bulan, region, area AS sub_region, tipe,
       SUM(CASE WHEN metrik = N'target_ton' THEN nilai END) AS target,
       SUM(CASE WHEN metrik = N'realisasi_ton' THEN nilai END) AS realisasi
FROM sementrack.target
WHERE jenis = N'sell_in'
GROUP BY tahun, bulan, region, area, tipe;
GO

/* ---------- 5. ringkasan untuk dicek ---------- */
SELECT N'sellin_bnn' AS tabel, COUNT(*) AS baris, CAST(SUM(ton) AS decimal(20,3)) AS ton FROM sementrack.sellin_bnn
UNION ALL SELECT N'v_sellin_bnn_daily', SUM(pengiriman), SUM(ton) FROM sementrack.v_sellin_bnn_daily
UNION ALL SELECT N'v_outstanding_do', COUNT(*), SUM(sisa_ton) FROM sementrack.v_outstanding_do
UNION ALL SELECT N'v_sellin_po_bulanan', NULL, SUM(order_ton) FROM sementrack.v_sellin_po_bulanan;
GO
