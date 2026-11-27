/* ============================================================================
   24_harga_produk.sql · Halaman Harga Produk
   v_harga_produk: riwayat harga dari Harga ERP (dibaca Nazam Auto Task) dalam satu bentuk:
     - LOCO GUDANG dari sementrack.harga_loco (harga ambil sendiri di gudang)
     - tipe kirim lain (FRANCO TRUK, FRANCO FLOOR, ...) dari sementrack.harga_kirim, per zona, dengan ongkir
   price = Price (sebelum promo), net_price = Net Price, harga_sebelum = harga sebelumnya untuk produk, gudang, tipe, zona yang sama.
   Riwayat yang berakhir sebelum 2025 tidak ditampilkan.
   Jalankan di SSMS, database MARKETING_ANALIS, setelah 18_harga_loco.sql. Aman dijalankan ulang.
============================================================================ */
CREATE OR ALTER VIEW sementrack.v_harga_produk AS
SELECT x.*, d.kode, d.nama
FROM (
  SELECT h.dist_code, N'LOCO GUDANG' AS delivery_type, N'' AS zone, h.product_code, h.product_name, h.semen, h.kg, h.warehouse,
         h.berlaku_dari, h.berlaku_sampai, h.price, CAST(NULL AS decimal(20,4)) AS discount, h.net_price, CAST(NULL AS decimal(20,4)) AS ongkir,
         LAG(h.price) OVER (PARTITION BY h.dist_code, h.product_code, h.warehouse ORDER BY h.berlaku_dari) AS harga_sebelum,
         LAG(h.net_price) OVER (PARTITION BY h.dist_code, h.product_code, h.warehouse ORDER BY h.berlaku_dari) AS net_sebelum,
         h.diambil
  FROM sementrack.harga_loco h
  UNION ALL
  SELECT k.dist_code, k.delivery_type, k.zone, k.product_code, k.product_name, l.semen, l.kg, k.warehouse,
         k.berlaku_dari, k.berlaku_sampai, k.price, k.discount, k.net_price, k.ongkir,
         LAG(k.price) OVER (PARTITION BY k.dist_code, k.product_code, k.delivery_type, k.zone, k.warehouse ORDER BY k.berlaku_dari),
         LAG(k.net_price) OVER (PARTITION BY k.dist_code, k.product_code, k.delivery_type, k.zone, k.warehouse ORDER BY k.berlaku_dari),
         k.diambil
  FROM sementrack.harga_kirim k
  OUTER APPLY (SELECT TOP (1) h.semen, h.kg FROM sementrack.harga_loco h WHERE h.dist_code = k.dist_code AND h.product_code = k.product_code ORDER BY h.berlaku_dari DESC) l
) x
OUTER APPLY (SELECT TOP (1) d.dist_code AS kode, d.dist_name AS nama FROM dbo.distributor d WHERE d.kode_erp = x.dist_code ORDER BY d.dist_code) d
WHERE x.berlaku_sampai IS NULL OR x.berlaku_sampai >= '20250101';
GO
GRANT SELECT ON sementrack.v_harga_produk TO PUBLIC;
GO

-- Cek: harga per distributor x tipe kirim
SELECT dist_code, delivery_type, COUNT(*) AS baris, COUNT(DISTINCT product_code) AS produk, COUNT(DISTINCT zone) AS zona, MAX(berlaku_dari) AS perubahan_terakhir
FROM sementrack.v_harga_produk GROUP BY dist_code, delivery_type ORDER BY dist_code, delivery_type;
