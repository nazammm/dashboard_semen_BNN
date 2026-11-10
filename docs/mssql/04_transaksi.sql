/* =============================================================================
   SEMENTRACK di SQL Server 2022, tahap 3c: halaman yang membaca transaksi J028
   (Penjualan Toko, Rekap Harian, Tim Sales, Peta/Daftar Toko, Transaksi Detail, Toko Detail).
   Jalankan di MARKETING_ANALIS setelah 03_sellout.sql (memakai dbo.calc_tonase). Aman dijalankan ulang.

   - Materialized view PostgreSQL (mv_*) menjadi view biasa: dihitung langsung saat dibaca,
     jadi tidak perlu "refresh" setelah upload. Nama yang dibaca halaman tetap v_*.
   - Fungsi dashboard_* menjadi inline table-valued function. Parameter array (p_dist_code,
     p_product_codes) dikirim sebagai teks JSON, misalnya ["BKP","KTP"]; NULL = semua.
     Argumen dikirim berurutan sesuai AccessRules.AllowedFunctions (tahap 5).
   - ORDER BY tidak boleh di dalam fungsi; urutan hasil ditambahkan backend saat memanggil
     (lihat CATATAN.md). TOP untuk "top customers" tetap di dalam fungsi.
============================================================================= */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* =========================== view (dbo) =========================== */

-- Status toko per bulan: aktif bila belanja sebulan >= 200.000.
CREATE OR ALTER VIEW dbo.v_toko_month_status AS
SELECT customer_code, dist_code, YEAR(do_date) AS [year], MONTH(do_date) AS [month],
       SUM(ISNULL(net_amount, 0)) AS net_amount,
       SUM(dbo.calc_tonase(product_code, order_qty)) AS tonase,
       COUNT(DISTINCT do_no) AS num_do,
       CAST(CASE WHEN SUM(ISNULL(net_amount, 0)) >= 200000 THEN 1 ELSE 0 END AS bit) AS is_active
FROM dbo.transaksi
WHERE do_date IS NOT NULL AND customer_code IS NOT NULL AND TRIM(customer_code) <> N''
GROUP BY customer_code, dist_code, YEAR(do_date), MONTH(do_date);
GO

CREATE OR ALTER VIEW dbo.v_transaksi_monthly AS
WITH active AS (
  SELECT dist_code, [year], [month], COUNT(DISTINCT customer_code) AS num_active_stores
  FROM dbo.v_toko_month_status WHERE is_active = 1
  GROUP BY dist_code, [year], [month]
)
SELECT YEAR(t.do_date) AS [year], MONTH(t.do_date) AS [month], t.dist_code,
       MAX(t.distributor_name) AS distributor_name, t.product_code, MAX(t.product_name) AS product_name,
       SUM(t.order_qty) AS order_qty, SUM(t.bonus_qty) AS bonus_qty,
       SUM(dbo.calc_tonase(t.product_code, t.order_qty)) AS total_qty,
       COUNT(DISTINCT t.do_no) AS num_do,
       ISNULL(MAX(a.num_active_stores), 0) AS num_active_stores,
       COUNT(*) AS num_lines,
       SUM(ISNULL(t.net_amount, 0)) AS net_amount
FROM dbo.transaksi t
LEFT JOIN active a ON a.dist_code = t.dist_code AND a.[year] = YEAR(t.do_date) AND a.[month] = MONTH(t.do_date)
WHERE t.do_date IS NOT NULL
GROUP BY YEAR(t.do_date), MONTH(t.do_date), t.dist_code, t.product_code;
GO

CREATE OR ALTER VIEW dbo.v_distributor_summary AS
SELECT d.dist_code, d.dist_name, d.wilayah, d.tag,
       ISNULL(agg.total_qty_all, 0) AS total_qty_all,
       ISNULL(agg.total_qty_ytd, 0) AS total_qty_ytd,
       ISNULL(agg.num_do_ytd, 0) AS num_do_ytd,
       ISNULL(ta.num_active_stores_ytd, 0) AS num_active_stores_ytd,
       agg.last_transaction,
       ISNULL(sm.num_salesman, 0) AS num_salesman,
       ISNULL(agg.net_amount_all, 0) AS net_amount_all,
       ISNULL(agg.net_amount_ytd, 0) AS net_amount_ytd
FROM dbo.distributor d
LEFT JOIN (
  SELECT t.dist_code,
         SUM(dbo.calc_tonase(t.product_code, t.order_qty)) AS total_qty_all,
         SUM(CASE WHEN t.do_date >= y.awal THEN dbo.calc_tonase(t.product_code, t.order_qty) END) AS total_qty_ytd,
         COUNT(DISTINCT CASE WHEN t.do_date >= y.awal THEN t.do_no END) AS num_do_ytd,
         MAX(t.do_date) AS last_transaction,
         SUM(ISNULL(t.net_amount, 0)) AS net_amount_all,
         SUM(CASE WHEN t.do_date >= y.awal THEN ISNULL(t.net_amount, 0) END) AS net_amount_ytd
  FROM dbo.transaksi t
  CROSS JOIN (SELECT DATEFROMPARTS(YEAR(GETDATE()), 1, 1) AS awal) y
  GROUP BY t.dist_code
) agg ON agg.dist_code = d.dist_code
LEFT JOIN (
  SELECT dist_code, COUNT(DISTINCT customer_code) AS num_active_stores_ytd
  FROM dbo.v_toko_month_status
  WHERE is_active = 1 AND [year] = YEAR(GETDATE())
  GROUP BY dist_code
) ta ON ta.dist_code = d.dist_code
LEFT JOIN (
  SELECT dist_code, COUNT(DISTINCT salesman_code) AS num_salesman
  FROM dbo.salesman_status_target
  GROUP BY dist_code
) sm ON sm.dist_code = d.dist_code;
GO

CREATE OR ALTER VIEW dbo.v_yearly_totals AS
WITH y AS (
  SELECT YEAR(do_date) AS [year],
         SUM(dbo.calc_tonase(product_code, order_qty)) AS total_qty,
         SUM(order_qty) AS order_qty, SUM(bonus_qty) AS bonus_qty,
         COUNT(DISTINCT do_no) AS num_do, COUNT(DISTINCT dist_code) AS num_distributors,
         COUNT(*) AS num_lines, SUM(ISNULL(net_amount, 0)) AS net_amount
  FROM dbo.transaksi WHERE do_date IS NOT NULL
  GROUP BY YEAR(do_date)
), active AS (
  SELECT [year], COUNT(DISTINCT customer_code) AS num_active_stores
  FROM dbo.v_toko_month_status WHERE is_active = 1 GROUP BY [year]
)
SELECT y.[year], y.total_qty, y.order_qty, y.bonus_qty, y.num_do,
       ISNULL(a.num_active_stores, 0) AS num_active_stores,
       y.num_distributors, y.num_lines, y.net_amount
FROM y LEFT JOIN active a ON a.[year] = y.[year];
GO

CREATE OR ALTER VIEW dbo.v_monthly_totals AS
WITH m AS (
  SELECT YEAR(do_date) AS [year], MONTH(do_date) AS [month],
         SUM(dbo.calc_tonase(product_code, order_qty)) AS total_qty,
         SUM(order_qty) AS order_qty, SUM(bonus_qty) AS bonus_qty,
         COUNT(DISTINCT do_no) AS num_do, COUNT(*) AS num_lines, SUM(ISNULL(net_amount, 0)) AS net_amount
  FROM dbo.transaksi WHERE do_date IS NOT NULL
  GROUP BY YEAR(do_date), MONTH(do_date)
), active AS (
  SELECT [year], [month], COUNT(DISTINCT customer_code) AS num_active_stores
  FROM dbo.v_toko_month_status WHERE is_active = 1 GROUP BY [year], [month]
)
SELECT m.[year], m.[month], m.total_qty, m.order_qty, m.bonus_qty, m.num_do,
       ISNULL(a.num_active_stores, 0) AS num_active_stores, m.num_lines, m.net_amount
FROM m LEFT JOIN active a ON a.[year] = m.[year] AND a.[month] = m.[month];
GO

CREATE OR ALTER VIEW dbo.v_dist_monthly_totals AS
WITH m AS (
  SELECT dist_code, YEAR(do_date) AS [year], MONTH(do_date) AS [month],
         SUM(dbo.calc_tonase(product_code, order_qty)) AS total_qty,
         SUM(order_qty) AS order_qty, SUM(bonus_qty) AS bonus_qty,
         COUNT(DISTINCT do_no) AS num_do, COUNT(*) AS num_lines, SUM(ISNULL(net_amount, 0)) AS net_amount
  FROM dbo.transaksi WHERE do_date IS NOT NULL
  GROUP BY dist_code, YEAR(do_date), MONTH(do_date)
), active AS (
  SELECT dist_code, [year], [month], COUNT(DISTINCT customer_code) AS num_active_stores
  FROM dbo.v_toko_month_status WHERE is_active = 1 GROUP BY dist_code, [year], [month]
)
SELECT m.dist_code, m.[year], m.[month], m.total_qty, m.order_qty, m.bonus_qty, m.num_do,
       ISNULL(a.num_active_stores, 0) AS num_active_stores, m.num_lines, m.net_amount
FROM m LEFT JOIN active a ON a.dist_code = m.dist_code AND a.[year] = m.[year] AND a.[month] = m.[month];
GO

/* =========================== view (sementrack) =========================== */

-- Toko per distributor (satu toko bisa dilayani lebih dari satu distributor).
CREATE OR ALTER VIEW sementrack.v_toko_multi AS
SELECT tk.cust_code, tk.cust_name, td.dist_code, d.dist_name, tk.zona, tk.latitude, tk.longitude
FROM sementrack.toko_distributor td
JOIN dbo.toko tk ON tk.cust_code = td.cust_code
JOIN dbo.distributor d ON d.dist_code = td.dist_code;
GO

CREATE OR ALTER VIEW sementrack.v_toko_agg AS
SELECT tk.cust_code, tk.cust_name, tk.dist_code, tk.dist_name, tk.zona, tk.latitude, tk.longitude,
       ISNULL(a.total_qty, 0) AS total_qty,
       ISNULL(a.num_do, 0) AS num_do,
       a.last_transaction
FROM sementrack.v_toko_multi tk
LEFT JOIN (
  SELECT customer_code, dist_code,
         SUM(dbo.calc_tonase(product_code, order_qty)) AS total_qty,
         COUNT(DISTINCT do_no) AS num_do,
         MAX(do_date) AS last_transaction
  FROM dbo.transaksi
  GROUP BY customer_code, dist_code
) a ON a.customer_code = tk.cust_code AND a.dist_code = tk.dist_code;
GO

-- Target dan realisasi per salesman per bulan (Tim Sales). Toko subdist tidak dihitung.
CREATE OR ALTER VIEW sementrack.v_salesman_performance AS
WITH t AS (
  SELECT tahun, bulan, area AS dist_code, kode AS salesman_code,
         MAX(nama) AS salesman_name, MAX(status) AS status,
         SUM(CASE WHEN metrik = N'target_ta' THEN nilai END) AS target_ta,
         SUM(CASE WHEN metrik = N'target_ton' THEN nilai END) AS target_tonase
  FROM sementrack.target
  WHERE jenis = N'salesman'
  GROUP BY tahun, bulan, area, kode
), tr AS (
  SELECT x.salesman_code, YEAR(x.do_date) AS tahun, MONTH(x.do_date) AS bulan,
         x.customer_code, x.do_no, x.net_amount, dbo.calc_tonase(x.product_code, x.order_qty) AS ton
  FROM dbo.transaksi x
  WHERE x.do_date >= DATEFROMPARTS((SELECT MIN(t1.tahun) FROM t t1), 1, 1)
    AND NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer s WHERE s.dist_code = x.dist_code AND s.customer_code = x.customer_code)
), tot AS (
  SELECT salesman_code, tahun, bulan, SUM(ton) AS total_qty, SUM(ISNULL(net_amount, 0)) AS net_amount,
         COUNT(DISTINCT do_no) AS num_do
  FROM tr GROUP BY salesman_code, tahun, bulan
), act AS (
  SELECT c.salesman_code, c.tahun, c.bulan, COUNT(*) AS num_active_stores
  FROM (SELECT salesman_code, tahun, bulan, customer_code FROM tr
        GROUP BY salesman_code, tahun, bulan, customer_code
        HAVING SUM(ISNULL(net_amount, 0)) >= 200000) c
  GROUP BY c.salesman_code, c.tahun, c.bulan
)
SELECT t.tahun, t.dist_code, t.salesman_code, t.salesman_name, t.bulan AS [month],
       ISNULL(t.target_ta, 0) AS target_ta,
       ISNULL(t.target_tonase, 0) AS target_tonase,
       t.status,
       ISNULL(tot.total_qty, 0) AS actual_tonase,
       ISNULL(act.num_active_stores, 0) AS actual_ta,
       ISNULL(tot.num_do, 0) AS actual_num_do,
       ISNULL(tot.net_amount, 0) AS actual_omzet
FROM t
LEFT JOIN tot ON tot.salesman_code = t.salesman_code AND tot.tahun = t.tahun AND tot.bulan = t.bulan
LEFT JOIN act ON act.salesman_code = t.salesman_code AND act.tahun = t.tahun AND act.bulan = t.bulan;
GO

-- Baris transaksi + nama salesman terbaru dari tabel target + tanda subdist.
CREATE OR ALTER VIEW sementrack.v_transaksi_detail AS
SELECT t.do_date, t.dist_code, t.distributor_name, t.customer_code, t.customer_name,
       t.parent_customer_code, t.parent_customer_name, t.product_code, t.product_name,
       t.order_qty, t.bonus_qty,
       dbo.calc_tonase(t.product_code, t.order_qty) AS tonase,
       t.do_no, t.mss_no_order,
       ISNULL(t.net_amount, 0) AS net_amount,
       t.salesman_code, sm.salesman_name, t.payment,
       CAST(CASE WHEN EXISTS (SELECT 1 FROM sementrack.subdist_customer s
                              WHERE s.dist_code = t.dist_code AND s.customer_code = t.customer_code) THEN 1 ELSE 0 END AS bit) AS is_subdist
FROM dbo.transaksi t
LEFT JOIN (
  SELECT kode AS salesman_code, nama AS salesman_name
  FROM (SELECT g.kode, g.nama, ROW_NUMBER() OVER (PARTITION BY g.kode ORDER BY g.tahun DESC, g.bulan DESC) AS rn
        FROM sementrack.target g
        WHERE g.jenis = N'salesman' AND g.nama IS NOT NULL) z
  WHERE rn = 1
) sm ON sm.salesman_code = t.salesman_code;
GO

-- Toko pegangan salesman, dengan belanja tahun transaksi terakhir.
CREATE OR ALTER VIEW sementrack.v_toko_pegangan_sales AS
SELECT tp.salesman_code, TRY_CAST(tp.[month] AS int) AS [month], tp.dist_code, tp.dist_name, tp.cust_code, tp.cust_name,
       ISNULL(a.total_qty, 0) AS omset,
       ISNULL(a.num_do, 0) AS num_do,
       ISNULL(a.net_amount, 0) AS net_amount,
       CAST(CASE WHEN ISNULL(a.net_amount, 0) >= 200000 AND s.customer_code IS NULL THEN 1 ELSE 0 END AS bit) AS is_active,
       CAST(CASE WHEN s.customer_code IS NOT NULL THEN 1 ELSE 0 END AS bit) AS is_subdist
FROM dbo.toko_pegangan_sales tp
LEFT JOIN sementrack.subdist_customer s ON s.dist_code = tp.dist_code AND s.customer_code = tp.cust_code
LEFT JOIN (
  SELECT tr.customer_code, tr.salesman_code, MONTH(tr.do_date) AS [month],
         SUM(dbo.calc_tonase(tr.product_code, tr.order_qty)) AS total_qty,
         COUNT(DISTINCT tr.do_no) AS num_do,
         SUM(ISNULL(tr.net_amount, 0)) AS net_amount
  FROM dbo.transaksi tr
  WHERE YEAR(tr.do_date) = (SELECT MAX(YEAR(t1.do_date)) FROM dbo.transaksi t1)
  GROUP BY tr.customer_code, tr.salesman_code, MONTH(tr.do_date)
) a ON a.customer_code = tp.cust_code AND a.salesman_code = tp.salesman_code AND a.[month] = TRY_CAST(tp.[month] AS int);
GO

/* =========================== fungsi dashboard (tahun + rentang bulan) =========================== */

CREATE OR ALTER FUNCTION dbo.dashboard_period_summary_v2
  (@p_dist_code nvarchar(max), @p_year int, @p_start_month int, @p_end_month int, @p_product_codes nvarchar(max))
RETURNS TABLE AS RETURN
WITH base AS (
  SELECT * FROM dbo.transaksi
  WHERE do_date IS NOT NULL
    AND YEAR(do_date) = @p_year AND MONTH(do_date) BETWEEN @p_start_month AND @p_end_month
    AND (@p_dist_code IS NULL OR dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$')))
    AND (@p_product_codes IS NULL OR product_code IN (SELECT v FROM OPENJSON(@p_product_codes) WITH (v nvarchar(200) '$')))
), cust_month AS (
  SELECT customer_code, MONTH(do_date) AS [month], SUM(ISNULL(net_amount, 0)) AS net_amount
  FROM base GROUP BY customer_code, MONTH(do_date)
)
SELECT ISNULL((SELECT SUM(dbo.calc_tonase(product_code, order_qty)) FROM base), 0) AS total_qty,
       ISNULL((SELECT SUM(order_qty) FROM base), 0) AS order_qty,
       ISNULL((SELECT SUM(bonus_qty) FROM base), 0) AS bonus_qty,
       ISNULL((SELECT COUNT(DISTINCT do_no) FROM base), 0) AS num_do,
       ISNULL((SELECT COUNT(DISTINCT customer_code) FROM cust_month WHERE net_amount >= 200000), 0) AS num_active_stores,
       ISNULL((SELECT COUNT(*) FROM base), 0) AS num_lines,
       ISNULL((SELECT SUM(ISNULL(net_amount, 0)) FROM base), 0) AS net_amount;
GO

CREATE OR ALTER FUNCTION sementrack.dashboard_top_customers_v2
  (@p_dist_code nvarchar(max), @p_year int, @p_start_month int, @p_end_month int, @p_product_codes nvarchar(max), @p_limit int)
RETURNS TABLE AS RETURN
SELECT TOP (ISNULL(@p_limit, 2147483647))
       k.customer_code,
       COALESCE(MAX(NULLIF(NULLIF(TRIM(t.parent_customer_name), N''), N'0')), MAX(t.customer_name)) AS cust_name,
       t.dist_code,
       COALESCE(MAX(d.dist_name), MAX(t.distributor_name)) AS dist_name,
       SUM(dbo.calc_tonase(t.product_code, t.order_qty)) AS total_qty,
       COUNT(DISTINCT t.do_no) AS num_do,
       SUM(ISNULL(t.net_amount, 0)) AS net_amount
FROM dbo.transaksi t
LEFT JOIN dbo.distributor d ON d.dist_code = t.dist_code
CROSS APPLY (SELECT COALESCE(NULLIF(NULLIF(TRIM(t.parent_customer_code), N''), N'0'), t.customer_code) AS customer_code) k
WHERE t.do_date IS NOT NULL
  AND YEAR(t.do_date) = @p_year AND MONTH(t.do_date) BETWEEN @p_start_month AND @p_end_month
  AND (@p_dist_code IS NULL OR t.dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$')))
  AND (@p_product_codes IS NULL OR t.product_code IN (SELECT v FROM OPENJSON(@p_product_codes) WITH (v nvarchar(200) '$')))
GROUP BY k.customer_code, t.dist_code
ORDER BY total_qty DESC;
GO

CREATE OR ALTER FUNCTION dbo.dashboard_delivery_type_breakdown
  (@p_dist_code nvarchar(max), @p_year int, @p_start_month int, @p_end_month int, @p_product_codes nvarchar(max))
RETURNS TABLE AS RETURN
SELECT ISNULL(t.delivery_type, N'Tidak diketahui') AS delivery_type,
       SUM(dbo.calc_tonase(t.product_code, t.order_qty)) AS total_qty
FROM dbo.transaksi t
WHERE t.do_date IS NOT NULL
  AND YEAR(t.do_date) = @p_year AND MONTH(t.do_date) BETWEEN @p_start_month AND @p_end_month
  AND (@p_dist_code IS NULL OR t.dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$')))
  AND (@p_product_codes IS NULL OR t.product_code IN (SELECT v FROM OPENJSON(@p_product_codes) WITH (v nvarchar(200) '$')))
GROUP BY t.delivery_type;
GO

CREATE OR ALTER FUNCTION dbo.dashboard_channel_breakdown
  (@p_dist_code nvarchar(max), @p_year int, @p_start_month int, @p_end_month int, @p_product_codes nvarchar(max))
RETURNS TABLE AS RETURN
SELECT c.channel, COUNT(DISTINCT t.do_no) AS num_do, SUM(ISNULL(t.net_amount, 0)) AS net_amount
FROM dbo.transaksi t
CROSS APPLY (SELECT CASE WHEN t.mss_no_order IS NOT NULL AND TRIM(t.mss_no_order) NOT IN (N'', N'0') THEN N'Online' ELSE N'Offline' END AS channel) c
WHERE t.do_date IS NOT NULL
  AND YEAR(t.do_date) = @p_year AND MONTH(t.do_date) BETWEEN @p_start_month AND @p_end_month
  AND (@p_dist_code IS NULL OR t.dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$')))
  AND (@p_product_codes IS NULL OR t.product_code IN (SELECT v FROM OPENJSON(@p_product_codes) WITH (v nvarchar(200) '$')))
GROUP BY c.channel;
GO

CREATE OR ALTER FUNCTION dbo.dashboard_payment_breakdown
  (@p_dist_code nvarchar(max), @p_year int, @p_start_month int, @p_end_month int, @p_product_codes nvarchar(max))
RETURNS TABLE AS RETURN
SELECT ISNULL(t.payment, N'Tidak diketahui') AS payment, COUNT(DISTINCT t.do_no) AS num_do, SUM(ISNULL(t.net_amount, 0)) AS net_amount
FROM dbo.transaksi t
WHERE t.do_date IS NOT NULL
  AND YEAR(t.do_date) = @p_year AND MONTH(t.do_date) BETWEEN @p_start_month AND @p_end_month
  AND (@p_dist_code IS NULL OR t.dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$')))
  AND (@p_product_codes IS NULL OR t.product_code IN (SELECT v FROM OPENJSON(@p_product_codes) WITH (v nvarchar(200) '$')))
GROUP BY ISNULL(t.payment, N'Tidak diketahui');
GO

-- Tonase harian per distributor dalam satu bulan (Rekap Harian).
CREATE OR ALTER FUNCTION dbo.dashboard_daily_matrix
  (@p_year int, @p_month int, @p_product_codes nvarchar(max), @p_dist_code nvarchar(max))
RETURNS TABLE AS RETURN
SELECT t.do_date, t.dist_code, SUM(dbo.calc_tonase(t.product_code, t.order_qty)) AS total_qty
FROM dbo.transaksi t
WHERE t.do_date IS NOT NULL
  AND YEAR(t.do_date) = @p_year AND MONTH(t.do_date) = @p_month
  AND (@p_product_codes IS NULL OR t.product_code IN (SELECT v FROM OPENJSON(@p_product_codes) WITH (v nvarchar(200) '$')))
  AND (@p_dist_code IS NULL OR t.dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$')))
GROUP BY t.do_date, t.dist_code;
GO

-- Semua toko dengan belanja satu bulan (Peta Toko, Daftar Toko).
CREATE OR ALTER FUNCTION sementrack.dashboard_toko_monthly_v2 (@p_year int, @p_month int, @p_dist_code nvarchar(max))
RETURNS TABLE AS RETURN
SELECT tk.cust_code, tk.cust_name, tk.dist_code, tk.dist_name, tk.zona, tk.latitude, tk.longitude,
       ISNULL(m.total_qty, 0) AS total_qty,
       ISNULL(m.num_do, 0) AS num_do,
       ISNULL(m.net_amount, 0) AS net_amount,
       CAST(CASE WHEN ISNULL(m.net_amount, 0) >= 200000 AND s.customer_code IS NULL THEN 1 ELSE 0 END AS bit) AS is_active,
       o.last_transaction,
       CAST(CASE WHEN s.customer_code IS NOT NULL THEN 1 ELSE 0 END AS bit) AS is_subdist
FROM sementrack.v_toko_multi tk
LEFT JOIN sementrack.subdist_customer s ON s.dist_code = tk.dist_code AND s.customer_code = tk.cust_code
LEFT JOIN (
  SELECT customer_code, dist_code,
         SUM(dbo.calc_tonase(product_code, order_qty)) AS total_qty,
         COUNT(DISTINCT do_no) AS num_do,
         SUM(ISNULL(net_amount, 0)) AS net_amount
  FROM dbo.transaksi
  WHERE YEAR(do_date) = @p_year AND MONTH(do_date) = @p_month
  GROUP BY customer_code, dist_code
) m ON m.customer_code = tk.cust_code AND m.dist_code = tk.dist_code
LEFT JOIN (
  SELECT customer_code, dist_code, MAX(do_date) AS last_transaction
  FROM dbo.transaksi GROUP BY customer_code, dist_code
) o ON o.customer_code = tk.cust_code AND o.dist_code = tk.dist_code
WHERE @p_dist_code IS NULL OR tk.dist_code IN (SELECT v FROM OPENJSON(@p_dist_code) WITH (v nvarchar(200) '$'));
GO

-- Satu toko, 12 bulan (Toko Detail). Belanja subdist tidak membuat toko aktif.
CREATE OR ALTER FUNCTION sementrack.dashboard_store_year (@p_customer_code nvarchar(200), @p_year int)
RETURNS TABLE AS RETURN
SELECT MONTH(t.do_date) AS [month],
       SUM(dbo.calc_tonase(t.product_code, t.order_qty)) AS total_qty,
       SUM(ISNULL(t.net_amount, 0)) AS net_amount,
       COUNT(DISTINCT t.do_no) AS num_do,
       CAST(CASE WHEN ISNULL(SUM(CASE WHEN s.customer_code IS NULL THEN ISNULL(t.net_amount, 0) END), 0) >= 200000 THEN 1 ELSE 0 END AS bit) AS is_active,
       CAST(MIN(CASE WHEN s.customer_code IS NOT NULL THEN 1 ELSE 0 END) AS bit) AS is_subdist
FROM dbo.transaksi t
LEFT JOIN sementrack.subdist_customer s ON s.dist_code = t.dist_code AND s.customer_code = t.customer_code
WHERE t.customer_code = @p_customer_code AND YEAR(t.do_date) = @p_year
GROUP BY MONTH(t.do_date);
GO

/* =========================== fungsi dashboard (rentang tanggal) =========================== */

CREATE OR ALTER FUNCTION sementrack.dashboard_period_summary_range
  (@p_dist_code nvarchar(max), @p_start_date date, @p_end_date date, @p_product_codes nvarchar(max))
RETURNS TABLE AS RETURN
WITH base AS (
  SELECT * FROM dbo.transaksi
  WHERE do_date BETWEEN @p_start_date AND @p_end_date
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

-- Pelanggan teratas (gabung per induk pelanggan); dist_code = daftar distributor yang melayani.
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
GROUP BY COALESCE(t.product_name, t.product_code, N'Tidak diketahui')
HAVING SUM(dbo.calc_tonase(t.product_code, t.order_qty)) > 0;
GO

/* ---------- ringkasan untuk dicek ---------- */
SELECT [year], CAST(total_qty AS decimal(20,3)) AS ton, num_do, num_active_stores, net_amount
FROM dbo.v_yearly_totals ORDER BY [year];
GO
