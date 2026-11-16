/* ============================================================================
   12_toko_channel.sql · Penjualan Toko: toko per cara order (offline / online / keduanya)
   Satu baris per toko (tanpa subdist) yang punya DO di rentang tanggal & filter yang sama
   dengan halaman Penjualan Toko. Online = DO yang punya nomor order MSS (mss_no_order),
   sama dengan aturan dashboard_channel_breakdown_range.
   Jalankan di SSMS, database MARKETING_ANALIS, setelah 04_transaksi.sql.
============================================================================ */
CREATE OR ALTER FUNCTION sementrack.dashboard_toko_channel_range
  (@p_dist_code nvarchar(max), @p_start_date date, @p_end_date date, @p_product_codes nvarchar(max))
RETURNS TABLE AS RETURN
WITH base AS (
  SELECT t.customer_code, t.customer_name, t.dist_code, t.do_no, t.product_code, t.order_qty, t.net_amount,
         CASE WHEN t.mss_no_order IS NOT NULL AND TRIM(t.mss_no_order) NOT IN (N'', N'0') THEN 1 ELSE 0 END AS online
  FROM dbo.transaksi t
  WHERE t.do_date BETWEEN @p_start_date AND @p_end_date
    AND t.customer_code IS NOT NULL
    AND (@p_dist_code IS NULL OR t.dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$')))
    AND (@p_product_codes IS NULL OR t.product_code IN (SELECT v FROM OPENJSON(@p_product_codes) WITH (v nvarchar(200) '$')))
    AND NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer s WHERE s.dist_code = t.dist_code AND s.customer_code = t.customer_code)
)
SELECT b.customer_code,
       MAX(b.customer_name) AS cust_name,
       MIN(b.dist_code) AS dist_code,
       COUNT(DISTINCT CASE WHEN b.online = 1 THEN b.do_no END) AS do_online,
       COUNT(DISTINCT CASE WHEN b.online = 0 THEN b.do_no END) AS do_offline,
       SUM(dbo.calc_tonase(b.product_code, b.order_qty)) AS total_qty,
       SUM(ISNULL(b.net_amount, 0)) AS net_amount
FROM base b
GROUP BY b.customer_code;
GO

-- Cek: jumlah toko per cara order bulan ini
-- SELECT CASE WHEN do_online > 0 AND do_offline > 0 THEN 'Keduanya' WHEN do_online > 0 THEN 'Online' ELSE 'Offline' END AS cara, COUNT(*) AS toko
-- FROM sementrack.dashboard_toko_channel_range(NULL, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1), CAST(GETDATE() AS date), NULL)
-- GROUP BY CASE WHEN do_online > 0 AND do_offline > 0 THEN 'Keduanya' WHEN do_online > 0 THEN 'Online' ELSE 'Offline' END;
