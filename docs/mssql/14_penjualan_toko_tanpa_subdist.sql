/* ============================================================================
   14_penjualan_toko_tanpa_subdist.sql · Halaman Penjualan Toko (dan Tanya Data) tanpa subdist
   Subdist bukan toko, jadi semua angka di Penjualan Toko (amount, tonase, DO, grafik, top customer,
   tren bulanan, ranking distributor) tidak lagi menghitung pembeli yang terdaftar di Kelola Data → Tabel → Subdist.
   Fungsi *_range di 04_transaksi.sql ditimpa dengan versi yang menyaring subdist; dua view bulanan baru.
   Halaman lain (Overview, Rekap Harian, Sell Out BNN, Tim Sales) tidak berubah.
   Jalankan di SSMS, database MARKETING_ANALIS, setelah 04_transaksi.sql. Aman dijalankan ulang.
============================================================================ */

-- Ringkasan bulanan Penjualan Toko tanpa subdist: per distributor x produk (tren tonase, pilihan filter)
CREATE OR ALTER VIEW sementrack.v_penjualan_toko_bulanan AS
SELECT YEAR(t.do_date) AS [year], MONTH(t.do_date) AS [month], t.dist_code, t.product_code,
       SUM(dbo.calc_tonase(t.product_code, t.order_qty)) AS total_qty,
       SUM(ISNULL(t.net_amount, 0)) AS net_amount,
       COUNT(DISTINCT t.do_no) AS num_do
FROM dbo.transaksi t
WHERE t.do_date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer s WHERE s.dist_code = t.dist_code AND s.customer_code = t.customer_code)
GROUP BY YEAR(t.do_date), MONTH(t.do_date), t.dist_code, t.product_code;
GO

-- ... dan per distributor (jumlah DO unik per distributor per bulan, ranking distributor)
CREATE OR ALTER VIEW sementrack.v_penjualan_toko_dist_bulanan AS
SELECT t.dist_code, YEAR(t.do_date) AS [year], MONTH(t.do_date) AS [month],
       SUM(dbo.calc_tonase(t.product_code, t.order_qty)) AS total_qty,
       SUM(ISNULL(t.net_amount, 0)) AS net_amount,
       COUNT(DISTINCT t.do_no) AS num_do
FROM dbo.transaksi t
WHERE t.do_date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer s WHERE s.dist_code = t.dist_code AND s.customer_code = t.customer_code)
GROUP BY t.dist_code, YEAR(t.do_date), MONTH(t.do_date);
GO

CREATE OR ALTER FUNCTION sementrack.dashboard_period_summary_range
  (@p_dist_code nvarchar(max), @p_start_date date, @p_end_date date, @p_product_codes nvarchar(max))
RETURNS TABLE AS RETURN
WITH base AS (
  SELECT * FROM dbo.transaksi t0
  WHERE NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer s WHERE s.dist_code = t0.dist_code AND s.customer_code = t0.customer_code)
    AND do_date BETWEEN @p_start_date AND @p_end_date
    AND (@p_dist_code IS NULL OR dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$')))
    AND (@p_product_codes IS NULL OR product_code IN (SELECT v FROM OPENJSON(@p_product_codes) WITH (v nvarchar(200) '$')))
), cust_month AS (
  SELECT b.customer_code, DATETRUNC(month, b.do_date) AS bulan, SUM(ISNULL(b.net_amount, 0)) AS net_amount
  FROM base b
  WHERE NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer s WHERE s.dist_code = b.dist_code AND s.customer_code = b.customer_code)
  GROUP BY b.customer_code, DATETRUNC(month, b.do_date)
)
SELECT ISNULL((SELECT SUM(dbo.calc_tonase(product_code, order_qty)) FROM base), 0) AS total_qty,
       ISNULL((SELECT SUM(order_qty) FROM base), 0) AS order_qty,
       ISNULL((SELECT SUM(bonus_qty) FROM base), 0) AS bonus_qty,
       ISNULL((SELECT COUNT(DISTINCT do_no) FROM base), 0) AS num_do,
       ISNULL((SELECT COUNT(DISTINCT customer_code) FROM cust_month WHERE net_amount >= 200000), 0) AS num_active_stores,
       ISNULL((SELECT COUNT(*) FROM base), 0) AS num_lines,
       ISNULL((SELECT SUM(ISNULL(net_amount, 0)) FROM base), 0) AS net_amount;
GO

CREATE OR ALTER FUNCTION sementrack.dashboard_top_customers_range
  (@p_dist_code nvarchar(max), @p_start_date date, @p_end_date date, @p_product_codes nvarchar(max), @p_limit int)
RETURNS TABLE AS RETURN
WITH base AS (
  SELECT COALESCE(NULLIF(NULLIF(TRIM(t.parent_customer_code), N''), N'0'), t.customer_code) AS ck,
         t.parent_customer_name, t.customer_name, t.dist_code, t.distributor_name, t.product_code, t.order_qty,
         t.do_no, t.net_amount, d.dist_name,
         CASE WHEN s.customer_code IS NOT NULL THEN 1 ELSE 0 END AS subdist
  FROM dbo.transaksi t
  LEFT JOIN dbo.distributor d ON d.dist_code = t.dist_code
  LEFT JOIN sementrack.subdist_customer s ON s.dist_code = t.dist_code AND s.customer_code = t.customer_code
  WHERE t.do_date BETWEEN @p_start_date AND @p_end_date
    AND (@p_dist_code IS NULL OR t.dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$')))
    AND (@p_product_codes IS NULL OR t.product_code IN (SELECT v FROM OPENJSON(@p_product_codes) WITH (v nvarchar(200) '$')))
    AND NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer sx WHERE sx.dist_code = t.dist_code AND sx.customer_code = t.customer_code)
), top_ AS (
  SELECT TOP (CASE WHEN ISNULL(@p_limit, 10) < 1 THEN 1 WHEN ISNULL(@p_limit, 10) > 100 THEN 100 ELSE ISNULL(@p_limit, 10) END)
         ck,
         COALESCE(MAX(NULLIF(NULLIF(TRIM(parent_customer_name), N''), N'0')), MAX(customer_name)) AS cust_name,
         CASE WHEN COUNT(DISTINCT dist_code) = 1 THEN COALESCE(MAX(dist_name), MAX(distributor_name)) END AS dist_name,
         SUM(dbo.calc_tonase(product_code, order_qty)) AS total_qty,
         COUNT(DISTINCT do_no) AS num_do,
         SUM(ISNULL(net_amount, 0)) AS net_amount,
         CAST(MIN(subdist) AS bit) AS is_subdist
  FROM base
  GROUP BY ck
  ORDER BY total_qty DESC
)
SELECT x.ck AS customer_code, x.cust_name,
       (SELECT STRING_AGG(z.dist_code, N', ') WITHIN GROUP (ORDER BY z.dist_code)
        FROM (SELECT DISTINCT b.dist_code FROM base b WHERE b.ck = x.ck OR (b.ck IS NULL AND x.ck IS NULL)) z) AS dist_code,
       x.dist_name, x.total_qty, x.num_do, x.net_amount, x.is_subdist
FROM top_ x;
GO

CREATE OR ALTER FUNCTION sementrack.dashboard_channel_breakdown_range
  (@p_dist_code nvarchar(max), @p_start_date date, @p_end_date date, @p_product_codes nvarchar(max))
RETURNS TABLE AS RETURN
SELECT c.channel, COUNT(DISTINCT t.do_no) AS num_do, SUM(ISNULL(t.net_amount, 0)) AS net_amount
FROM dbo.transaksi t
CROSS APPLY (SELECT CASE WHEN t.mss_no_order IS NOT NULL AND TRIM(t.mss_no_order) NOT IN (N'', N'0') THEN N'Online' ELSE N'Offline' END AS channel) c
WHERE t.do_date BETWEEN @p_start_date AND @p_end_date
  AND (@p_dist_code IS NULL OR t.dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$')))
  AND (@p_product_codes IS NULL OR t.product_code IN (SELECT v FROM OPENJSON(@p_product_codes) WITH (v nvarchar(200) '$')))
    AND NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer sx WHERE sx.dist_code = t.dist_code AND sx.customer_code = t.customer_code)
GROUP BY c.channel;
GO

CREATE OR ALTER FUNCTION sementrack.dashboard_payment_breakdown_range
  (@p_dist_code nvarchar(max), @p_start_date date, @p_end_date date, @p_product_codes nvarchar(max))
RETURNS TABLE AS RETURN
SELECT ISNULL(t.payment, N'Tidak diketahui') AS payment, COUNT(DISTINCT t.do_no) AS num_do, SUM(ISNULL(t.net_amount, 0)) AS net_amount
FROM dbo.transaksi t
WHERE t.do_date BETWEEN @p_start_date AND @p_end_date
  AND (@p_dist_code IS NULL OR t.dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$')))
  AND (@p_product_codes IS NULL OR t.product_code IN (SELECT v FROM OPENJSON(@p_product_codes) WITH (v nvarchar(200) '$')))
    AND NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer sx WHERE sx.dist_code = t.dist_code AND sx.customer_code = t.customer_code)
GROUP BY ISNULL(t.payment, N'Tidak diketahui');
GO

CREATE OR ALTER FUNCTION sementrack.dashboard_delivery_type_breakdown_range
  (@p_dist_code nvarchar(max), @p_start_date date, @p_end_date date, @p_product_codes nvarchar(max))
RETURNS TABLE AS RETURN
SELECT ISNULL(t.delivery_type, N'Tidak diketahui') AS delivery_type,
       SUM(dbo.calc_tonase(t.product_code, t.order_qty)) AS total_qty
FROM dbo.transaksi t
WHERE t.do_date BETWEEN @p_start_date AND @p_end_date
  AND (@p_dist_code IS NULL OR t.dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$')))
  AND (@p_product_codes IS NULL OR t.product_code IN (SELECT v FROM OPENJSON(@p_product_codes) WITH (v nvarchar(200) '$')))
    AND NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer sx WHERE sx.dist_code = t.dist_code AND sx.customer_code = t.customer_code)
GROUP BY ISNULL(t.delivery_type, N'Tidak diketahui');
GO

CREATE OR ALTER FUNCTION sementrack.dashboard_product_breakdown_range
  (@p_dist_code nvarchar(max), @p_start_date date, @p_end_date date, @p_product_codes nvarchar(max))
RETURNS TABLE AS RETURN
SELECT COALESCE(t.product_name, t.product_code, N'Tidak diketahui') AS product_name,
       SUM(dbo.calc_tonase(t.product_code, t.order_qty)) AS total_qty
FROM dbo.transaksi t
WHERE t.do_date BETWEEN @p_start_date AND @p_end_date
  AND (@p_dist_code IS NULL OR t.dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$')))
  AND (@p_product_codes IS NULL OR t.product_code IN (SELECT v FROM OPENJSON(@p_product_codes) WITH (v nvarchar(200) '$')))
    AND NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer sx WHERE sx.dist_code = t.dist_code AND sx.customer_code = t.customer_code)
GROUP BY COALESCE(t.product_name, t.product_code, N'Tidak diketahui')
HAVING SUM(dbo.calc_tonase(t.product_code, t.order_qty)) > 0;
GO

/* ---------- cek: selisih bulan ini dengan dan tanpa subdist ---------- */
SELECT m.dist_code, m.total_qty AS ton_semua, ISNULL(p.total_qty, 0) AS ton_tanpa_subdist
FROM dbo.v_dist_monthly_totals m
LEFT JOIN sementrack.v_penjualan_toko_dist_bulanan p ON p.dist_code = m.dist_code AND p.[year] = m.[year] AND p.[month] = m.[month]
WHERE m.[year] = YEAR(GETDATE()) AND m.[month] = MONTH(GETDATE())
ORDER BY m.dist_code;
