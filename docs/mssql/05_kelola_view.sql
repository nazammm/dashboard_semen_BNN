/* =============================================================================
   SEMENTRACK di SQL Server 2022, tahap 3d: view Kelola Data (status kesegaran data, riwayat).
   Jalankan di MARKETING_ANALIS setelah 04_transaksi.sql. Aman dijalankan ulang.

   - Waktu ditampilkan dalam WIB: SWITCHOFFSET(..., '+07:00') (PostgreSQL: AT TIME ZONE 'Asia/Jakarta').
   - Baris 'sellout_bulanan' dan 'sellin_bulanan' tidak ada lagi: sumbernya (cement_targets, delivery)
     tidak dipindah dan halaman bulanannya sudah dihapus.
============================================================================= */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER VIEW sementrack.v_data_status AS
WITH sync AS (
  SELECT DATEADD(second, DATEDIFF(second, CAST('00:00:00' AS time(0)), ISNULL(s.jam_update, CAST('00:00:00' AS time(0)))),
                 CAST(s.tanggal_update AS datetime2(0))) AS ts,
         s.keterangan
  FROM dbo.status_sync s WHERE s.id = 1
), sellin_up AS (
  SELECT TOP (1) created_at, created_by FROM sementrack.sellin_bnn_upload WHERE status = N'selesai' ORDER BY id DESC
), dofas_up AS (
  SELECT TOP (1) created_at, created_by, date_from FROM sementrack.kelola_log WHERE dataset = N'dofas' AND status = N'selesai' ORDER BY id DESC
), erp_up AS (
  SELECT TOP (1) created_at, created_by, date_from FROM sementrack.kelola_log WHERE dataset = N'erp' AND status = N'selesai' ORDER BY id DESC
), j073_up AS (
  SELECT TOP (1) created_at, created_by FROM sementrack.kelola_log WHERE dataset = N'j073' AND status = N'selesai' ORDER BY id DESC
), po_up AS (
  SELECT TOP (1) created_at, created_by, posisi FROM sementrack.sellin_po_upload WHERE status = N'selesai' ORDER BY id DESC
)
SELECT N'transaksi' AS sumber, N'Transaksi distributor' AS nama, N'harian' AS frekuensi,
       (SELECT MAX(do_date) FROM dbo.transaksi) AS data_sampai,
       (SELECT CONVERT(nvarchar(16), ts, 126) FROM sync) AS diperbarui,
       (SELECT keterangan FROM sync) AS keterangan
UNION ALL
SELECT N'sellin', N'Sell In BNN', N'harian',
       (SELECT MAX(tanggal) FROM sementrack.sellin_bnn WHERE mortar = 0),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM sellin_up),
       (SELECT N'Upload oleh ' + created_by FROM sellin_up)
UNION ALL
SELECT N'dofas', N'DO FAS', N'harian',
       (SELECT CAST(SWITCHOFFSET(created_at, '+07:00') AS date) FROM dofas_up),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM dofas_up),
       (SELECT N'Tempel data ' + CAST(YEAR(date_from) AS nvarchar(4)) + N' oleh ' + created_by FROM dofas_up)
UNION ALL
SELECT N'erp', N'Sub ERP', N'harian',
       (SELECT CAST(SWITCHOFFSET(created_at, '+07:00') AS date) FROM erp_up),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM erp_up),
       (SELECT N'Tempel data ' + CAST(YEAR(date_from) AS nvarchar(4)) + N' oleh ' + created_by FROM erp_up)
UNION ALL
SELECT N'j073', N'J073 (INSA, PKB)', N'harian',
       (SELECT MAX(do_date) FROM sementrack.sellout_j073),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM j073_up),
       (SELECT N'Upload oleh ' + created_by FROM j073_up)
UNION ALL
SELECT N'outstanding', N'Outstanding DO', N'harian',
       (SELECT posisi FROM po_up),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM po_up),
       (SELECT N'Upload oleh ' + created_by FROM po_up);
GO

-- Riwayat upload / hapus / ubah (Kelola Data → Riwayat). dist_codes = array JSON.
CREATE OR ALTER VIEW sementrack.v_kelola_riwayat AS
SELECT N'sellin' AS dataset, N'upload' AS aksi, u.created_at, u.created_by, u.source, u.file_name, u.date_from, u.date_to,
       CAST(NULL AS nvarchar(max)) AS dist_codes, u.rows_read, u.rows_saved, u.rows_replaced AS rows_deleted, u.status
FROM sementrack.sellin_bnn_upload u
UNION ALL
SELECT l.dataset, l.aksi, l.created_at, l.created_by, l.source, l.file_name, l.date_from, l.date_to,
       l.dist_codes, l.rows_read, l.rows_saved, l.rows_deleted, l.status
FROM sementrack.kelola_log l
UNION ALL
SELECT N'outstanding', N'upload', u.created_at, u.created_by, u.source, u.file_name, u.date_from, u.date_to,
       CAST(NULL AS nvarchar(max)), u.rows_read, u.rows_saved, u.rows_replaced, u.status
FROM sementrack.sellin_po_upload u;
GO

SELECT sumber, data_sampai, diperbarui, keterangan FROM sementrack.v_data_status;
GO
