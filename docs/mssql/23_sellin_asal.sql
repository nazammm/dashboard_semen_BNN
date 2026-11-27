/* ============================================================================
   23_sellin_asal.sql · Sell In BNN: asal kirim (gudang / terminal) di v_sellin_bnn_daily
   Halaman Sell In BNN membagi realisasi per tipe pesanan (Gudang / Toko / Project) dan asal kirim
   (Terminal Palembang, CCY Citeureup, ...), mis. Sumsel yang juga ambil pesanan toko & project dari Terminal Palembang.
   Sama dengan definisi di 02_sellin.sql (sudah diperbarui), jadi tidak perlu menjalankan ulang 02.
   Jalankan di SSMS, database MARKETING_ANALIS. Aman dijalankan ulang.
============================================================================ */
-- Sell in harian per region, produk, tipe pesanan, loco/franco (halaman Sell In BNN dan Overview).
CREATE OR ALTER VIEW sementrack.v_sellin_bnn_daily AS
SELECT b.tanggal, r.region, b.tipe_produk AS produk, x.tipe_pesanan, x.loco_franco,
       CAST(ROUND(SUM(b.ton), 3) AS decimal(20,3)) AS ton,
       SUM(b.delivery_qty) AS zak,
       COUNT(*) AS pengiriman,
       x.asal   -- gudang / terminal asal (ITP-Palembang Terminal, CCY, ...)
FROM sementrack.sellin_bnn b
LEFT JOIN sementrack.sellin_region_map m ON m.kode_customer = b.kode_customer
CROSS APPLY (SELECT sementrack.sellin_region(m.region, b.tipe_pesanan, b.distributor) AS region) r
CROSS APPLY (SELECT UPPER(LEFT(b.tipe_pesanan, 1)) + LOWER(SUBSTRING(b.tipe_pesanan, 2, 4000)) AS tipe_pesanan,
                    ISNULL(NULLIF(UPPER(LEFT(b.loco_franco, 1)) + LOWER(SUBSTRING(b.loco_franco, 2, 4000)), N''), N'Tidak diisi') AS loco_franco,
                    ISNULL(NULLIF(TRIM(b.asal_pengiriman), N''), N'Tidak diisi') AS asal) x
WHERE b.mortar = 0
GROUP BY b.tanggal, r.region, b.tipe_produk, x.tipe_pesanan, x.loco_franco, x.asal;
GO
