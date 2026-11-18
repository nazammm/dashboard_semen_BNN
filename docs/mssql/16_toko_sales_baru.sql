/* ============================================================================
   16_toko_sales_baru.sql · Kelola Data → Toko & sales baru
   - sementrack.v_toko_baru     : satu baris per toko x distributor dengan tanggal DO pertama dan terakhir,
                                  data master (zona, koordinat), dan tanda subdist. Dipakai untuk melihat toko
                                  yang baru pertama kali order pada bulan tertentu.
   - sementrack.v_salesman_baru : satu baris per kode salesman dengan tanggal DO pertama dan terakhir serta
                                  bulan target terakhir. Dipakai untuk melihat salesman yang baru muncul.
   Tidak ada tabel baru. Jalankan di SSMS, database MARKETING_ANALIS. Aman dijalankan ulang.
============================================================================ */
CREATE OR ALTER VIEW sementrack.v_toko_baru AS
WITH a AS (
  SELECT t.customer_code, t.dist_code, MAX(t.customer_name) AS customer_name,
         MIN(t.do_date) AS first_do, MAX(t.do_date) AS last_do, COUNT(DISTINCT t.do_no) AS num_do,
         SUM(dbo.calc_tonase(t.product_code, t.order_qty)) AS total_qty, SUM(ISNULL(t.net_amount, 0)) AS net_amount
  FROM dbo.transaksi t
  WHERE t.do_date IS NOT NULL AND t.customer_code IS NOT NULL AND TRIM(t.customer_code) <> N''
  GROUP BY t.customer_code, t.dist_code
)
SELECT a.customer_code AS cust_code, COALESCE(k.cust_name, a.customer_name) AS cust_name, a.dist_code,
       k.zona, k.latitude, k.longitude,
       CAST(CASE WHEN k.cust_code IS NULL THEN 0 ELSE 1 END AS bit) AS ada_master,
       CAST(CASE WHEN s.customer_code IS NULL THEN 0 ELSE 1 END AS bit) AS is_subdist,
       a.first_do, MIN(a.first_do) OVER (PARTITION BY a.customer_code) AS first_do_toko,
       a.last_do, a.num_do, a.total_qty, a.net_amount
FROM a
LEFT JOIN dbo.toko k ON k.cust_code = a.customer_code
LEFT JOIN sementrack.subdist_customer s ON s.dist_code = a.dist_code AND s.customer_code = a.customer_code;
GO

CREATE OR ALTER VIEW sementrack.v_salesman_baru AS
WITH a AS (
  SELECT t.salesman_code, MAX(t.dist_code) AS dist_code, MIN(t.do_date) AS first_do, MAX(t.do_date) AS last_do,
         COUNT(DISTINCT t.do_no) AS num_do
  FROM dbo.transaksi t
  WHERE t.do_date IS NOT NULL AND t.salesman_code IS NOT NULL AND TRIM(t.salesman_code) <> N''
  GROUP BY t.salesman_code
), tg AS (
  SELECT kode AS salesman_code, MAX(tahun * 100 + bulan) AS target_terakhir
  FROM sementrack.target WHERE jenis = N'salesman' GROUP BY kode
)
SELECT a.salesman_code, a.dist_code,
       COALESCE((SELECT TOP 1 g.nama FROM sementrack.target g WHERE g.jenis = N'salesman' AND g.kode = a.salesman_code ORDER BY g.tahun DESC, g.bulan DESC),
                (SELECT MAX(st.salesman_name) FROM dbo.salesman_status_target st WHERE st.salesman_code = a.salesman_code),
                a.salesman_code) AS salesman_name,
       a.first_do, a.last_do, a.num_do, tg.target_terakhir
FROM a LEFT JOIN tg ON tg.salesman_code = a.salesman_code;
GO

-- Cek: toko dan salesman yang pertama kali muncul bulan ini
SELECT COUNT(*) AS toko_baru FROM sementrack.v_toko_baru WHERE first_do >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);
SELECT COUNT(*) AS salesman_baru FROM sementrack.v_salesman_baru WHERE first_do >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1);
