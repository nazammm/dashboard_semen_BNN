/* ============================================================================
   13_tanya_data.sql · Halaman Tanya Data
   - View sementrack.v_toko_aktif_bulanan: toko aktif per bulan TANPA subdist (aturan sama dengan
     KPI Toko aktif di Penjualan Toko). dist_code = '*' berarti semua distributor (toko unik).
   - Memberi halaman "tanya-data" ke role yang hak halamannya diatur manual
     (ikut role yang sudah punya Penjualan Toko). Admin dan Management otomatis dapat.
   Jalankan di SSMS, database MARKETING_ANALIS.
============================================================================ */
CREATE OR ALTER VIEW sementrack.v_toko_aktif_bulanan AS
WITH b AS (
  SELECT t.customer_code, t.dist_code, YEAR(t.do_date) AS [year], MONTH(t.do_date) AS [month], ISNULL(t.net_amount, 0) AS net_amount
  FROM dbo.transaksi t
  WHERE t.do_date IS NOT NULL AND t.customer_code IS NOT NULL AND TRIM(t.customer_code) <> N''
    AND NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer s WHERE s.dist_code = t.dist_code AND s.customer_code = t.customer_code)
), per_dist AS (
  SELECT dist_code, [year], [month], customer_code FROM b
  GROUP BY dist_code, [year], [month], customer_code HAVING SUM(net_amount) >= 200000
), semua AS (
  SELECT [year], [month], customer_code FROM b
  GROUP BY [year], [month], customer_code HAVING SUM(net_amount) >= 200000
)
SELECT dist_code, [year], [month], COUNT(*) AS num_active_stores FROM per_dist GROUP BY dist_code, [year], [month]
UNION ALL
SELECT N'*', [year], [month], COUNT(*) FROM semua GROUP BY [year], [month];
GO

IF OBJECT_ID(N'auth_local.role_pages', N'U') IS NOT NULL
  INSERT INTO auth_local.role_pages (role, page_id, can_view_detail, can_download)
  SELECT r.role, N'tanya-data', r.can_view_detail, r.can_download
  FROM auth_local.role_pages r
  WHERE r.page_id = N'beranda'
    AND NOT EXISTS (SELECT 1 FROM auth_local.role_pages t WHERE t.role = r.role AND t.page_id = N'tanya-data');
GO
SELECT role, page_id FROM auth_local.role_pages WHERE page_id = N'tanya-data';
SELECT TOP 12 * FROM sementrack.v_toko_aktif_bulanan WHERE dist_code = N'*' ORDER BY [year] DESC, [month] DESC;
