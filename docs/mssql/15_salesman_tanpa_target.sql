/* ============================================================================
   15_salesman_tanpa_target.sql · Tim Sales: salesman baru otomatis tampil
   Salesman yang muncul di transaksi tetapi belum punya target salesman pada bulan itu ikut tampil
   dengan status 'Tanpa target' (target 0, capaian kosong). Nama diambil dari target bulan lain,
   lalu dari tabel salesman_status_target, kalau tidak ada dipakai kodenya.
   Jalankan di SSMS, database MARKETING_ANALIS, setelah 04_transaksi.sql. Aman dijalankan ulang.
============================================================================ */

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
  SELECT x.salesman_code, x.dist_code, YEAR(x.do_date) AS tahun, MONTH(x.do_date) AS bulan,
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
), baru AS (
  -- salesman yang muncul di transaksi tapi belum punya target bulan itu
  SELECT tr.tahun, tr.bulan, MAX(tr.dist_code) AS dist_code, tr.salesman_code
  FROM tr
  WHERE tr.salesman_code IS NOT NULL AND TRIM(tr.salesman_code) <> N''
    AND NOT EXISTS (SELECT 1 FROM t WHERE t.salesman_code = tr.salesman_code AND t.tahun = tr.tahun AND t.bulan = tr.bulan)
  GROUP BY tr.tahun, tr.bulan, tr.salesman_code
), semua AS (
  SELECT tahun, bulan, dist_code, salesman_code, salesman_name, status, target_ta, target_tonase FROM t
  UNION ALL
  SELECT b.tahun, b.bulan, b.dist_code, b.salesman_code,
         COALESCE((SELECT TOP 1 t2.salesman_name FROM t t2 WHERE t2.salesman_code = b.salesman_code ORDER BY t2.tahun DESC, t2.bulan DESC),
                  (SELECT MAX(st.salesman_name) FROM dbo.salesman_status_target st WHERE st.salesman_code = b.salesman_code),
                  b.salesman_code),
         N'Tanpa target', NULL, NULL
  FROM baru b
)
SELECT t.tahun, t.dist_code, t.salesman_code, t.salesman_name, t.bulan AS [month],
       ISNULL(t.target_ta, 0) AS target_ta,
       ISNULL(t.target_tonase, 0) AS target_tonase,
       t.status,
       ISNULL(tot.total_qty, 0) AS actual_tonase,
       ISNULL(act.num_active_stores, 0) AS actual_ta,
       ISNULL(tot.num_do, 0) AS actual_num_do,
       ISNULL(tot.net_amount, 0) AS actual_omzet
FROM semua t
LEFT JOIN tot ON tot.salesman_code = t.salesman_code AND tot.tahun = t.tahun AND tot.bulan = t.bulan
LEFT JOIN act ON act.salesman_code = t.salesman_code AND act.tahun = t.tahun AND act.bulan = t.bulan;
GO

-- Cek: salesman tanpa target per bulan tahun ini
SELECT tahun, [month], COUNT(*) AS salesman_tanpa_target, SUM(actual_tonase) AS ton
FROM sementrack.v_salesman_performance
WHERE status = N'Tanpa target' AND tahun = YEAR(GETDATE())
GROUP BY tahun, [month] ORDER BY [month];
