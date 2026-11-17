/* ============================================================================
   13_tanya_data.sql · Halaman Tanya Data
   Tidak ada tabel atau view baru: halaman ini memakai ringkasan yang sudah ada.
   Skrip ini hanya memberi halaman "tanya-data" ke role yang hak halamannya diatur manual
   (ikut role yang sudah punya Penjualan Toko). Admin dan Management otomatis dapat.
   Jalankan di SSMS, database MARKETING_ANALIS.
============================================================================ */
IF OBJECT_ID(N'auth_local.role_pages', N'U') IS NOT NULL
  INSERT INTO auth_local.role_pages (role, page_id, can_view_detail, can_download)
  SELECT r.role, N'tanya-data', r.can_view_detail, r.can_download
  FROM auth_local.role_pages r
  WHERE r.page_id = N'beranda'
    AND NOT EXISTS (SELECT 1 FROM auth_local.role_pages t WHERE t.role = r.role AND t.page_id = N'tanya-data');
GO
SELECT role, page_id FROM auth_local.role_pages WHERE page_id = N'tanya-data';
