/* ============================================================================
   21_os_do_toko.sql · OS DO toko (J073) dan selisih terhadap harga sekarang (SQL Server)
   - OS DO toko = DO distributor ke toko / proyek yang belum dikirim: kolom Qty Remains J073 (Order Qty - Qty Delivery - retur).
     Bukan OS pesanan ke pabrik (TIRO, halaman Outstanding DO).
   - Posisi Qty Remains = saat file J073 diunduh (kolom data_per). DO yang tanggalnya tidak ikut unduhan terbaru tidak
     diperbarui; halaman menandai posisi yang sudah lama.
   - Harga sekarang = harga ERP yang berlaku hari ini untuk distributor, produk, tipe kirim, zona, dan gudang yang sama:
     LOCO GUDANG -> Net Price harga_loco; tipe lain -> Price LOCO GUDANG hari ini - Discount + ongkir tarif (harga_kirim).
     Selisih = (Product Price di DO - harga sekarang) x sisa zak. Minus = DO lama lebih murah dari harga sekarang.
   Jalankan di SSMS, database MARKETING_ANALIS, setelah 18 dan 20 (20 versi 2026-11-23: kolom qty_sisa dan data_per).
   Aman dijalankan ulang.
============================================================================ */

CREATE OR ALTER VIEW sementrack.v_os_do_toko AS
SELECT s.dist_code, ISNULL(d.nama, s.dist_code) AS dist_nama, s.do_date, s.do_no, s.customer_code, s.customer_name,
       ISNULL(s.cust_group, N'RETAIL') AS cust_group, s.product_code, s.product_name, s.delivery_type,
       UPPER(LEFT(LTRIM(s.delivery_type), CHARINDEX(N' ', LTRIM(s.delivery_type) + N' ') - 1)) AS tipe_kode,
       s.zona_kirim, s.warehouse, s.order_qty, s.qty_sisa,
       sementrack.j073_ton(s.product_code, s.product_name, s.qty_sisa) AS ton_sisa,
       s.harga_produk AS harga_do, b.harga_baru, b.harga_dari, tm.delivery_type AS tipe_harga,
       s.harga_produk * s.qty_sisa AS nilai_sisa,
       (s.harga_produk - b.harga_baru) * s.qty_sisa AS selisih,
       s.data_per, DATEDIFF(day, s.do_date, ISNULL(s.data_per, CAST(GETDATE() AS date))) AS umur_hari
FROM sementrack.sellout_j073 s
LEFT JOIN sementrack.sellout_j073_dist d ON d.dist_code = s.dist_code
OUTER APPLY (SELECT TOP (1) m.delivery_type FROM sementrack.harga_tipe_map m
             WHERE m.kode = UPPER(LEFT(LTRIM(s.delivery_type), CHARINDEX(N' ', LTRIM(s.delivery_type) + N' ') - 1))) tm
OUTER APPLY (SELECT TOP (1) h.price, h.net_price, h.berlaku_dari FROM sementrack.harga_loco h
             WHERE h.dist_code = s.dist_code AND h.product_code = s.product_code
               AND CAST(GETDATE() AS date) >= h.berlaku_dari AND (h.berlaku_sampai IS NULL OR CAST(GETDATE() AS date) <= h.berlaku_sampai)
               AND (h.warehouse = ISNULL(s.warehouse, N'')
                    OR (h.warehouse <> N'' AND ISNULL(s.warehouse, N'') LIKE N'%' + h.warehouse + N'%')
                    OR (ISNULL(s.warehouse, N'') <> N'' AND h.warehouse LIKE N'%' + s.warehouse + N'%')
                    OR NOT EXISTS (SELECT 1 FROM sementrack.harga_loco h2
                                   WHERE h2.dist_code = h.dist_code AND h2.product_code = h.product_code AND h2.warehouse <> h.warehouse
                                     AND CAST(GETDATE() AS date) >= h2.berlaku_dari
                                     AND (h2.berlaku_sampai IS NULL OR CAST(GETDATE() AS date) <= h2.berlaku_sampai)))
             ORDER BY CASE WHEN h.warehouse = ISNULL(s.warehouse, N'') THEN 0 ELSE 1 END, h.berlaku_dari DESC) hl
OUTER APPLY (SELECT TOP (1) hk.ongkir, hk.discount, hk.berlaku_dari FROM sementrack.harga_kirim hk
             WHERE tm.delivery_type IS NOT NULL AND tm.delivery_type <> N'LOCO GUDANG'
               AND hk.dist_code = s.dist_code AND hk.product_code = s.product_code AND hk.delivery_type = tm.delivery_type
               AND (hk.zone = UPPER(TRIM(ISNULL(s.zona_kirim, N''))) OR hk.zone = N'')
               AND CAST(GETDATE() AS date) >= hk.berlaku_dari AND (hk.berlaku_sampai IS NULL OR CAST(GETDATE() AS date) <= hk.berlaku_sampai)
               AND (hk.warehouse = ISNULL(s.warehouse, N'')
                    OR (hk.warehouse <> N'' AND ISNULL(s.warehouse, N'') LIKE N'%' + hk.warehouse + N'%')
                    OR (ISNULL(s.warehouse, N'') <> N'' AND hk.warehouse LIKE N'%' + s.warehouse + N'%'))
             ORDER BY CASE WHEN hk.zone = N'' THEN 1 ELSE 0 END, CASE WHEN hk.warehouse = ISNULL(s.warehouse, N'') THEN 0 ELSE 1 END, hk.berlaku_dari DESC) hk
CROSS APPLY (SELECT CASE WHEN tm.delivery_type = N'LOCO GUDANG' OR (tm.delivery_type IS NULL AND s.delivery_type LIKE N'LG%') THEN hl.net_price
                         WHEN hk.ongkir IS NOT NULL AND hl.price IS NOT NULL THEN hl.price - ISNULL(hk.discount, 0) + hk.ongkir END AS harga_baru,
                    CASE WHEN hk.berlaku_dari IS NOT NULL AND hk.berlaku_dari > ISNULL(hl.berlaku_dari, '19000101') THEN hk.berlaku_dari
                         ELSE hl.berlaku_dari END AS harga_dari) b
WHERE s.qty_sisa > 0;
GO

GRANT SELECT ON sementrack.v_os_do_toko TO PUBLIC;
GO

-- Cek: OS DO toko per distributor
SELECT dist_code, COUNT(*) AS baris, CAST(SUM(ton_sisa) AS decimal(20,1)) AS ton_sisa, MAX(data_per) AS data_per,
       SUM(CASE WHEN harga_baru IS NULL THEN 1 ELSE 0 END) AS tanpa_harga_sekarang, CAST(SUM(selisih) AS decimal(20,0)) AS selisih
FROM sementrack.v_os_do_toko GROUP BY dist_code ORDER BY dist_code;
