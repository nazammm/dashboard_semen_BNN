# Catatan pindah ke SQL Server

Urutan skrip (jalankan di SSMS, database MARKETING_ANALIS):

| File | Isi | Cek |
|---|---|---|
| 01_tabel.sql | 31 tabel, relasi, aturan isian | jumlah tabel per skema |
| (tools/salin_mssql) | salin data dari PostgreSQL | `node salin.cjs` |
| 02_sellin.sql | Sell In BNN, Outstanding DO | `node salin.cjs --banding sellin` |
| 03_sellout.sql | Sell Out BNN, J073, target | `node salin.cjs --banding sellout` |
| 04_transaksi.sql | Penjualan Toko, Rekap Harian, Tim Sales, toko | `node salin.cjs --banding transaksi` |
| 05_kelola_view.sql | status data, riwayat Kelola Data | `node salin.cjs --banding kelola` |
| 06_upload_transaksi.sql | upload transaksi J028 | `node salin.cjs --uji transaksi` |
| 07_upload_sellin.sql | upload Sell In BNN, Outstanding DO, peta region | `node salin.cjs --uji sellin` |
| 08_kelola_tulis.sql | hapus data, status sinkron, DO FAS, Sub ERP, J073, target | `node salin.cjs --uji kelola` |
| 09_kelola_tabel.sql | Kelola Data → Tabel (edit langsung) | `node salin.cjs --uji tabel` |
| 10_kode_erp.sql | kolom `distributor.kode_erp` untuk upload mentah J028 / J028B | daftar kode di akhir skrip |

## Untuk tahap 5 (backend)

- Kolom array PostgreSQL disimpan sebagai teks JSON. Backend harus mengubahnya kembali menjadi array
  sebelum dikirim ke halaman: `sellout_bnn_peta.j028_customers`, `sellout_bnn_peta.dofas_kode`
  (juga di `v_sellout_bnn_peta`), `v_target_ringkas.bulan`, `kelola_log.dist_codes`, `tabel_edit.pk/kolom/filter`.
- Fungsi bernama sama dengan argumen berbeda tidak ada di SQL Server:
  `sellin_rule(tipe, distributor, asal, produk)` menjadi `sellin_rule_produk`.
- `public.calc_tonase` menjadi `dbo.calc_tonase`.
- Kolom terhitung (PERSISTED) tidak boleh diisi saat INSERT: `sellin_bnn.ton/mortar`,
  `sellin_po.kg/mortar/semen/jalur/dist_nama`.
- Tanggal `CURRENT_DATE` menjadi tanggal server SQL Server (`GETDATE()`); pastikan jam server benar.
- Materialized view `mv_*` menjadi view biasa (dihitung saat dibaca); `refresh_mv_*` tidak diperlukan lagi.
- `v_cement_targets_ext` dan `v_delivery_ext` tidak dipindah (tabel sumbernya tidak dipakai); hapus dari `AllowedTables`.
- Fungsi `dashboard_*` adalah table-valued function: dipanggil `SELECT * FROM skema.fn(@p1, @p2, ...)` berurutan sesuai
  `AllowedFunctions`, array dikirim sebagai teks JSON. ORDER BY tidak bisa di dalam fungsi, jadi backend menambahkan:
  | Fungsi | Urutan |
  |---|---|
  | dashboard_top_customers_v2, dashboard_top_customers_range | total_qty DESC |
  | dashboard_delivery_type_breakdown(_range), dashboard_product_breakdown_range | total_qty DESC |
  | dashboard_channel_breakdown(_range) | num_do DESC |
  | dashboard_payment_breakdown(_range) | net_amount DESC |
  | dashboard_store_year | [month] |
- `public.transaksi` di query backend menjadi `dbo.transaksi`.
- Prosedur tulis dipanggil `EXEC skema.prosedur @p1, @p2, ...` (berurutan). Pesan untuk pengguna dilempar dengan
  nomor 52023 (PostgreSQL: errcode 22023): tampilkan apa adanya sebagai HTTP 400.
- Mode `--uji <grup>` menjalankan skenario tulis di kedua database di dalam transaksi yang dibatalkan (ROLLBACK).
- salin.cjs mematikan trigger selama menyalin (trigger stamp sellin_region_map tidak mengubah updated_at hasil salinan).
- status_sync_set: jam kosong disimpan 00:00 (PostgreSQL menolak karena kolom wajib terisi).
- tabel_baca / tabel_opsi mengembalikan satu kolom j berisi teks JSON (sama dengan ::text di PostgreSQL).
