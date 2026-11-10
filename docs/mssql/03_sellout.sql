/* =============================================================================
   SEMENTRACK di SQL Server 2022, tahap 3b: Sell Out BNN (peta daerah, J028, DO FAS, Sub ERP, J073) dan target.
   Jalankan di MARKETING_ANALIS setelah 02_sellin.sql (memakai sementrack.sellin_kg). Aman dijalankan ulang.

   Kolom array PostgreSQL (text[]) disimpan sebagai teks JSON, misalnya ["CB","KB"]:
     sellout_bnn_peta.j028_customers, sellout_bnn_peta.dofas_kode, dan kolom bulan di v_target_ringkas.
   "x = ANY(array)" menjadi EXISTS (... OPENJSON ...). Backend (tahap 5) mengubah teks JSON ini kembali
   menjadi array sebelum dikirim ke halaman, jadi halaman tidak perlu diubah.

   Fungsi sellout_bnn_monthly() / sellout_bnn_ta() di PostgreSQL hanya pembungkus untuk mematikan JIT;
   di SQL Server tidak perlu, jadi v_sellout_bnn_monthly / v_sellout_bnn_ta langsung membaca view dasarnya.
============================================================================= */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------- indeks bantu: cari DO J028 per nomor DO (aturan "DO di J028" di J073) ---------- */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_transaksi_do_no' AND object_id = OBJECT_ID(N'dbo.transaksi'))
  CREATE INDEX idx_transaksi_do_no ON dbo.transaksi (do_no, dist_code) INCLUDE (do_date);
GO

/* ---------- fungsi ---------- */

-- Tonase J028 dari kode produk dan jumlah zak (PostgreSQL: public.calc_tonase).
CREATE OR ALTER FUNCTION dbo.calc_tonase (@product_code nvarchar(4000), @order_qty decimal(20,6))
RETURNS decimal(24,8)
WITH SCHEMABINDING
AS
BEGIN
  RETURN CASE
    WHEN @product_code IN (N'RJW003', N'CMT002') THEN @order_qty / 20.0
    WHEN @product_code IN (N'RJW004', N'CMT001', N'CWC001') THEN @order_qty / 25.0
    ELSE 0 END;
END
GO

-- Tonase J073: pakai calc_tonase; kalau 0, dari berat di nama produk.
CREATE OR ALTER FUNCTION sementrack.j073_ton (@code nvarchar(4000), @name nvarchar(4000), @qty decimal(20,6))
RETURNS decimal(24,8)
WITH SCHEMABINDING
AS
BEGIN
  RETURN COALESCE(NULLIF(dbo.calc_tonase(@code, @qty), 0), @qty * sementrack.sellin_kg(@name) / 1000);
END
GO

-- Nomor bulan dari teks: "Jan", "Mei", "Agu", "12" (dipakai saat tempel target dan ERP).
CREATE OR ALTER FUNCTION sementrack.bulan_dari_teks (@p nvarchar(4000))
RETURNS int
WITH SCHEMABINDING
AS
BEGIN
  RETURN CASE LOWER(LEFT(TRIM(@p), 3))
    WHEN N'jan' THEN 1 WHEN N'feb' THEN 2 WHEN N'mar' THEN 3 WHEN N'apr' THEN 4 WHEN N'may' THEN 5 WHEN N'mei' THEN 5
    WHEN N'jun' THEN 6 WHEN N'jul' THEN 7 WHEN N'aug' THEN 8 WHEN N'agu' THEN 8 WHEN N'ags' THEN 8 WHEN N'sep' THEN 9
    WHEN N'oct' THEN 10 WHEN N'okt' THEN 10 WHEN N'nov' THEN 11 WHEN N'dec' THEN 12 WHEN N'des' THEN 12
    ELSE CASE WHEN LEN(TRIM(@p)) BETWEEN 1 AND 2 AND TRIM(@p) NOT LIKE N'%[^0-9]%' THEN CAST(TRIM(@p) AS int) END END;
END
GO

/* ---------- peta daerah sell out ---------- */
CREATE OR ALTER VIEW sementrack.v_sellout_bnn_peta AS
SELECT p.id, p.urutan, p.region, p.nama, p.target_region, p.target_key, p.dofas_kode, p.dofas_tipe, p.erp_kode, p.j073,
       CONCAT_WS(N' + ',
         CASE p.j028_mode
           WHEN N'penuh' THEN N'J028 ' + p.j028_dist
           WHEN N'tanpa' THEN N'J028 ' + p.j028_dist + N' tanpa ' + jc.daftar
           WHEN N'hanya' THEN N'J028 ' + p.j028_dist + N' cust ' + jc.daftar END,
         CASE WHEN p.dofas_kode IS NOT NULL THEN N'DO FAS ' + ISNULL(dk.daftar, N'') + ISNULL(N' (' + p.dofas_tipe + N')', N'') END,
         CASE WHEN p.erp_kode IS NOT NULL THEN N'Sub ERP ' + p.erp_kode END,
         CASE WHEN p.j073 = 1 THEN ISNULL(ja.daftar, N'J073') END
       ) AS sumber,
       CASE WHEN EXISTS (SELECT 1 FROM sementrack.subdist_customer s WHERE s.subdist = p.nama) THEN N'subdist'
            WHEN p.j073 = 1 OR p.j028_mode IN (N'penuh', N'tanpa') THEN N'dist'
            ELSE N'subdist' END AS jenis
FROM sementrack.sellout_bnn_peta p
OUTER APPLY (SELECT STRING_AGG(CAST(j.[value] AS nvarchar(200)), N', ') WITHIN GROUP (ORDER BY CAST(j.[key] AS int)) AS daftar
             FROM OPENJSON(p.j028_customers) j) jc
OUTER APPLY (SELECT STRING_AGG(CAST(j.[value] AS nvarchar(200)), N', ') WITHIN GROUP (ORDER BY CAST(j.[key] AS int)) AS daftar
             FROM OPENJSON(p.dofas_kode) j) dk
OUTER APPLY (SELECT N'J073 ' + STRING_AGG(
                      a.dist_code + ISNULL(N' gudang ' + a.gudang, N'') + ISNULL(N' cust ' + a.customer_code, N'')
                      + ISNULL(N' DO di J028 ' + a.do_j028, N'')
                      + CASE WHEN a.gudang IS NULL AND a.customer_code IS NULL AND a.do_j028 IS NULL THEN N' sisanya' ELSE N'' END,
                      N', ') WITHIN GROUP (ORDER BY a.urutan) AS daftar
             FROM sementrack.sellout_j073_aturan a WHERE a.peta_id = p.id) ja;
GO

/* ---------- J073 per baris: data J073 + DO J028 tahun lalu untuk bulan yang belum ada di J073 ---------- */
CREATE OR ALTER VIEW sementrack.v_sellout_j073_baris AS
WITH thn AS (SELECT YEAR(CAST(GETDATE() AS date)) AS y),
ada AS (SELECT DISTINCT j.dist_code, DATETRUNC(month, j.do_date) AS bln FROM sementrack.sellout_j073 j),
src AS (
  SELECT N'J073' AS asal, j.dist_code, j.do_date, j.do_no, j.customer_code, j.product_code, j.product_name, j.order_qty,
         j.net_amount, UPPER(TRIM(j.warehouse)) AS gudang
  FROM sementrack.sellout_j073 j
  UNION ALL
  SELECT N'J028', d.dist_code, t.do_date, t.do_no, t.customer_code, t.product_code, NULL, t.order_qty,
         ISNULL(t.net_amount, 0), NULL
  FROM sementrack.sellout_j073_dist d
  JOIN dbo.transaksi t ON t.dist_code = d.j028_dist
  CROSS JOIN thn
  WHERE t.do_date >= DATEFROMPARTS(thn.y - 1, 1, 1) AND t.do_date < DATEFROMPARTS(thn.y, 1, 1)
    AND t.customer_code IS NOT NULL AND TRIM(t.customer_code) <> N''
    AND NOT EXISTS (SELECT 1 FROM ada WHERE ada.dist_code = d.dist_code AND ada.bln = DATETRUNC(month, t.do_date))
)
SELECT s.asal, s.dist_code, s.do_date, YEAR(s.do_date) AS tahun, MONTH(s.do_date) AS bulan, s.do_no, s.customer_code, s.gudang,
       CASE WHEN s.product_code LIKE N'RJW%' THEN N'RJW' WHEN s.product_code LIKE N'CWC%' THEN N'CWC' ELSE N'STR' END AS tipe,
       sementrack.j073_ton(s.product_code, s.product_name, s.order_qty) AS ton,
       s.net_amount AS net,
       (SELECT TOP (1) a.peta_id
        FROM sementrack.sellout_j073_aturan a
        WHERE a.dist_code = s.dist_code
          AND (a.gudang IS NULL OR UPPER(a.gudang) = s.gudang)
          AND (a.customer_code IS NULL OR a.customer_code = s.customer_code)
          AND (a.do_j028 IS NULL OR EXISTS (SELECT 1 FROM dbo.transaksi t2 CROSS JOIN thn
                                            WHERE t2.do_no = s.do_no AND t2.dist_code = a.do_j028
                                              AND t2.do_date >= DATEFROMPARTS(thn.y - 1, 1, 1)))
        ORDER BY a.urutan) AS peta_id
FROM src s;
GO

/* ---------- sell out per daerah per bulan: J028, DO FAS, Sub ERP, J073 ---------- */
CREATE OR ALTER VIEW sementrack.v_sellout_bnn_monthly_dasar AS
WITH subc AS (   -- semua customer yang disebut di peta (mode tanpa / hanya)
  SELECT DISTINCT j.v AS cc
  FROM sementrack.sellout_bnn_peta p
  CROSS APPLY OPENJSON(p.j028_customers) WITH (v nvarchar(200) '$') j
), trx AS (
  SELECT YEAR(t.do_date) AS tahun, MONTH(t.do_date) AS bulan, t.dist_code, s.cc, k.tipe,
         SUM(dbo.calc_tonase(t.product_code, t.order_qty)) AS ton
  FROM dbo.transaksi t
  LEFT JOIN subc s ON s.cc = t.customer_code
  CROSS APPLY (SELECT CASE WHEN t.product_code LIKE N'RJW%' THEN N'RJW' WHEN t.product_code LIKE N'CWC%' THEN N'CWC' ELSE N'STR' END AS tipe) k
  WHERE t.do_date >= DATEFROMPARTS(YEAR(GETDATE()) - 1, 1, 1)
    AND t.dist_code IN (SELECT j028_dist FROM sementrack.sellout_bnn_peta WHERE j028_dist IS NOT NULL)
  GROUP BY YEAR(t.do_date), MONTH(t.do_date), t.dist_code, s.cc, k.tipe
)
SELECT p.id AS peta_id, x.tahun, x.bulan, x.tipe, SUM(x.ton) AS ton, N'J028' AS sumber
FROM sementrack.sellout_bnn_peta p
JOIN trx x ON x.dist_code = p.j028_dist
 AND (p.j028_mode = N'penuh'
   OR (p.j028_mode = N'tanpa' AND (x.cc IS NULL OR NOT EXISTS (SELECT 1 FROM OPENJSON(p.j028_customers) WITH (v nvarchar(200) '$') j WHERE j.v = x.cc)))
   OR (p.j028_mode = N'hanya' AND EXISTS (SELECT 1 FROM OPENJSON(p.j028_customers) WITH (v nvarchar(200) '$') j WHERE j.v = x.cc)))
GROUP BY p.id, x.tahun, x.bulan, x.tipe
UNION ALL
SELECT p.id, d.tahun, d.bulan, d.tipe, SUM(d.ton), N'DO FAS'
FROM sementrack.sellout_bnn_peta p
JOIN sementrack.sellout_dofas d
  ON EXISTS (SELECT 1 FROM OPENJSON(p.dofas_kode) WITH (v nvarchar(200) '$') j WHERE j.v = UPPER(TRIM(d.distributor)))
 AND (p.dofas_tipe IS NULL OR d.tipe = p.dofas_tipe)
GROUP BY p.id, d.tahun, d.bulan, d.tipe
UNION ALL
SELECT p.id, e.tahun, e.bulan, e.tipe, SUM(e.ton), N'Sub ERP'
FROM sementrack.sellout_bnn_peta p
JOIN sementrack.sellout_erp e ON e.kode = p.erp_kode
GROUP BY p.id, e.tahun, e.bulan, e.tipe
UNION ALL
SELECT b.peta_id, b.tahun, b.bulan, b.tipe, SUM(b.ton), N'J073'
FROM sementrack.v_sellout_j073_baris b
WHERE b.asal = N'J073' AND b.peta_id IS NOT NULL
GROUP BY b.peta_id, b.tahun, b.bulan, b.tipe;
GO

CREATE OR ALTER VIEW sementrack.v_sellout_bnn_monthly AS
SELECT peta_id, tahun, bulan, tipe, ton, sumber FROM sementrack.v_sellout_bnn_monthly_dasar;
GO

/* ---------- toko aktif (TA) per daerah: customer dengan belanja >= 200.000 sebulan ----------
   ta = sebulan penuh, ta_sd = sampai tanggal yang sama dengan data transaksi terakhir.
   tipe 'ALL' = semua jenis semen digabung (satu toko dihitung sekali). */
CREATE OR ALTER VIEW sementrack.v_sellout_bnn_ta_dasar AS
WITH cut AS (SELECT DAY(MAX(do_date)) AS hari FROM dbo.transaksi),
dist_ids AS (SELECT id FROM sementrack.v_sellout_bnn_peta WHERE jenis = N'dist'),
base AS (
  SELECT p.id AS peta_id, YEAR(t.do_date) AS tahun, MONTH(t.do_date) AS bulan, t.customer_code,
         CASE WHEN t.product_code LIKE N'RJW%' THEN N'RJW' WHEN t.product_code LIKE N'CWC%' THEN N'CWC' ELSE N'STR' END AS tipe,
         ISNULL(t.net_amount, 0) AS net,
         CASE WHEN DAY(t.do_date) <= (SELECT hari FROM cut) THEN 1 ELSE 0 END AS sd
  FROM sementrack.sellout_bnn_peta p
  JOIN dbo.transaksi t ON t.dist_code = p.j028_dist
  WHERE p.j028_mode IN (N'penuh', N'tanpa')
    AND t.do_date >= DATEFROMPARTS(YEAR(GETDATE()) - 1, 1, 1)
    AND t.customer_code IS NOT NULL AND TRIM(t.customer_code) <> N''
    AND NOT EXISTS (SELECT 1 FROM OPENJSON(ISNULL(p.j028_customers, N'[]')) WITH (v nvarchar(200) '$') j WHERE j.v = t.customer_code)
    AND NOT EXISTS (SELECT 1 FROM sementrack.subdist_customer s WHERE s.dist_code = t.dist_code AND s.customer_code = t.customer_code)
  UNION ALL
  SELECT b.peta_id, b.tahun, b.bulan, b.customer_code, b.tipe, b.net,
         CASE WHEN DAY(b.do_date) <= (SELECT hari FROM cut) THEN 1 ELSE 0 END
  FROM sementrack.v_sellout_j073_baris b
  JOIN dist_ids pv ON pv.id = b.peta_id
  WHERE b.peta_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM sementrack.sellout_j073_dist d
                    JOIN sementrack.subdist_customer s ON s.dist_code = d.j028_dist
                    WHERE d.dist_code = b.dist_code AND s.customer_code = b.customer_code)
),
per AS (
  SELECT peta_id, tahun, bulan, customer_code, ISNULL(tipe, N'ALL') AS tipe,
         SUM(net) AS net, SUM(CASE WHEN sd = 1 THEN net END) AS net_sd
  FROM base
  GROUP BY GROUPING SETS ((peta_id, tahun, bulan, customer_code, tipe), (peta_id, tahun, bulan, customer_code))
)
SELECT peta_id, tahun, bulan, tipe,
       SUM(CASE WHEN net >= 200000 THEN 1 ELSE 0 END) AS ta,
       SUM(CASE WHEN ISNULL(net_sd, 0) >= 200000 THEN 1 ELSE 0 END) AS ta_sd
FROM per
GROUP BY peta_id, tahun, bulan, tipe;
GO

CREATE OR ALTER VIEW sementrack.v_sellout_bnn_ta AS
SELECT peta_id, tahun, bulan, tipe, ta, ta_sd FROM sementrack.v_sellout_bnn_ta_dasar;
GO

/* ---------- target ---------- */
CREATE OR ALTER VIEW sementrack.v_target_sell_out AS
SELECT tahun, bulan, region, area AS distributor, tipe,
       SUM(CASE WHEN metrik = N'target_ton' THEN nilai END) AS target_ton,
       SUM(CASE WHEN metrik = N'realisasi_ton' THEN nilai END) AS realisasi_ton,
       SUM(CASE WHEN metrik = N'target_ta' THEN nilai END) AS target_ta,
       SUM(CASE WHEN metrik = N'realisasi_ta' THEN nilai END) AS realisasi_ta
FROM sementrack.target
WHERE jenis = N'sell_out'
GROUP BY tahun, bulan, region, area, tipe;
GO

CREATE OR ALTER VIEW sementrack.v_target_dist AS
SELECT tahun, kode AS dist_code,
       CHOOSE(bulan, N'Jan', N'Feb', N'Mar', N'Apr', N'May', N'Jun', N'Jul', N'Aug', N'Sep', N'Oct', N'Nov', N'Dec') AS [month],
       bulan AS month_num,
       SUM(CASE WHEN metrik = N'target_ton' THEN nilai END) AS target,
       SUM(CASE WHEN metrik = N'target_ta' THEN nilai END) AS target_ta
FROM sementrack.target
WHERE jenis = N'distributor'
GROUP BY tahun, kode, bulan;
GO

-- Ringkasan isi tabel target (Kelola Data → Target). bulan = array JSON, misalnya [1,2,3].
CREATE OR ALTER VIEW sementrack.v_target_ringkas AS
SELECT g.jenis, g.metrik, g.tahun,
       (SELECT N'[' + STRING_AGG(CAST(b.bulan AS nvarchar(2)), N',') WITHIN GROUP (ORDER BY b.bulan) + N']'
        FROM (SELECT DISTINCT t2.bulan FROM sementrack.target t2
              WHERE t2.jenis = g.jenis AND t2.metrik = g.metrik AND t2.tahun = g.tahun) b) AS bulan,
       g.baris, g.total, g.diperbarui
FROM (SELECT jenis, metrik, tahun, COUNT(*) AS baris, SUM(nilai) AS total, MAX(diperbarui) AS diperbarui
      FROM sementrack.target GROUP BY jenis, metrik, tahun) g;
GO

/* ---------- ringkasan untuk dicek ---------- */
SELECT sumber, COUNT(*) AS baris, CAST(SUM(ton) AS decimal(20,3)) AS ton
FROM sementrack.v_sellout_bnn_monthly
WHERE tahun = YEAR(GETDATE())
GROUP BY sumber
ORDER BY sumber;
GO
