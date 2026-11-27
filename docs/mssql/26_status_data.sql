/* =====================================================================
   26_status_data.sql · Status kesegaran data + 3 sumber baru
   - v_data_status: salinan 17_ongkos_kirim.sql + baris harga (ORDB050/088),
     logistik (J082 / rekap) dan promo (J078), supaya badge di halaman
     Harga Produk dan Efektivitas ikut menunjukkan data s.d. kapan.
   Jalankan setelah 22_logistik.sql dan 25_efektivitas.sql. Aman diulang.
   ===================================================================== */
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
), stock_up AS (
  SELECT TOP (1) created_at, created_by FROM sementrack.kelola_log WHERE dataset = N'stock' AND status = N'selesai' ORDER BY id DESC
), harga_up AS (
  SELECT TOP (1) created_at, created_by FROM sementrack.kelola_log WHERE dataset = N'harga' AND status = N'selesai' ORDER BY id DESC
), logistik_up AS (
  SELECT TOP (1) created_at, created_by FROM sementrack.kelola_log WHERE dataset = N'logistik' AND status = N'selesai' ORDER BY id DESC
), promo_up AS (
  SELECT TOP (1) created_at, created_by FROM sementrack.kelola_log WHERE dataset = N'promo' AND status = N'selesai' ORDER BY id DESC
), ongkos_up AS (
  SELECT TOP (1) created_at, created_by FROM sementrack.kelola_log WHERE dataset = N'ongkos' AND status = N'selesai' ORDER BY id DESC
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
SELECT N'j073', N'J073', N'harian',
       (SELECT MAX(do_date) FROM sementrack.sellout_j073),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM j073_up),
       (SELECT N'Upload oleh ' + created_by FROM j073_up)
UNION ALL
SELECT N'outstanding', N'Outstanding DO', N'harian',
       (SELECT posisi FROM po_up),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM po_up),
       (SELECT N'Upload oleh ' + created_by FROM po_up)
UNION ALL
SELECT N'stock', N'Stock semen', N'harian',
       (SELECT MAX(tanggal) FROM sementrack.stock_semen),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM stock_up),
       (SELECT N'Upload oleh ' + created_by FROM stock_up)
UNION ALL
SELECT N'ongkos', N'Ongkos kirim (ORDB019)', N'mingguan',
       (SELECT MAX(kirim_date) FROM sementrack.ongkos_kirim),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM ongkos_up),
       (SELECT N'Upload oleh ' + created_by FROM ongkos_up)
UNION ALL
SELECT N'harga', N'Harga produk ERP (ORDB050/088)', N'mingguan',
       (SELECT MAX(d) FROM (SELECT MAX(diambil) AS d FROM sementrack.harga_loco UNION ALL SELECT MAX(diambil) FROM sementrack.harga_kirim) x),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM harga_up),
       (SELECT N'Upload oleh ' + created_by FROM harga_up)
UNION ALL
SELECT N'logistik', N'Pengiriman & truk (J082 / rekap logistik)', N'mingguan',
       (SELECT MAX(kirim_date) FROM sementrack.logistik_kirim),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM logistik_up),
       (SELECT N'Upload oleh ' + created_by FROM logistik_up)
UNION ALL
SELECT N'promo', N'Promo DO (J078)', N'mingguan',
       (SELECT MAX(do_date) FROM sementrack.promo_do),
       (SELECT CONVERT(nvarchar(16), SWITCHOFFSET(created_at, '+07:00'), 126) FROM promo_up),
       (SELECT N'Upload oleh ' + created_by FROM promo_up);

GO
