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
| 11_stock.sql | Stock semen: tabel daerah stok + region, upload stok harian, view untuk halaman Stock dan Overview | `SELECT * FROM sementrack.v_stock_info` |
| 12_toko_channel.sql | Penjualan Toko: toko per cara order (offline / online / keduanya) | query cek di akhir skrip |
| 13_tanya_data.sql | Halaman Tanya Data: hak halaman untuk role yang diatur manual (tanpa tabel baru) | hasil SELECT di akhir skrip |
| 14_penjualan_toko_tanpa_subdist.sql | Penjualan Toko dan Tanya Data tanpa subdist: fungsi *_range menyaring subdist, dua view bulanan baru | query cek di akhir skrip |
| 15_salesman_tanpa_target.sql | Tim Sales: salesman yang ada di transaksi tapi belum punya target ikut tampil (status Tanpa target) | query cek di akhir skrip |
| 16_toko_sales_baru.sql | Kelola Data → Toko & sales baru: view toko yang baru order dan salesman baru / tanpa target | query cek di akhir skrip |
| 17_ongkos_kirim.sql | Ongkos Kirim: J073 dengan kolom pengiriman (semua distributor, retail + proyek), tabel ORDB019, view per perjalanan / DO, hak halaman | `SELECT * FROM sementrack.v_ongkos_info` |
| 18_harga_loco.sql | Harga ERP (Price & Promo Simulation) per PT x produk x masa berlaku: LOCO GUDANG di harga_loco, FRANCO dan tipe lain (tarif ongkir per zona) di harga_kirim, pasangan kode tipe J073 di harga_tipe_map; v_outstanding_do_harga + nilai di v_outstanding_do_ringkas. Jalankan lagi setiap kali 02_sellin.sql dijalankan ulang, lalu 20 | `SELECT * FROM sementrack.v_harga_loco_info` |
| 19_ongkos_mulai_2026.sql | Ongkos Kirim dilacak mulai 2026: hapus ORDB019 dan J073 khusus ongkos sebelum 2026 (J073 RETAIL INSA/PKB tetap), tolak upload ORDB019 sebelum 2026 | `SELECT MIN(periode) FROM sementrack.ongkos_kirim` |
| 20_ongkos_insight.sql | Ongkos Kirim: angkutan ke gudang dipisah, status transporter (armada sendiri / truk toko), J073 Product Price, ongkir dibayar toko: rincian J073, lalu tarif resmi per zona (harga_kirim), lalu Product Price − Loco; J073 menyimpan Product Price dan Qty Remains. Jalankan setelah 18; jalankan lagi kalau 17 atau 18 dijalankan ulang, lalu 22 (view Ongkos Kirim ada di 22) | `SELECT tagih_sumber, COUNT(*) FROM sementrack.v_ongkos_do GROUP BY tagih_sumber` |
| 21_os_do_toko.sql | OS DO toko: DO J073 yang belum dikirim (Qty Remains, kolom qty_sisa dari 20) + selisih harga DO vs harga ERP hari ini (harga_loco + harga_kirim) untuk halaman OS DO Toko. Jalankan setelah 18 dan 20 |
| 22_logistik.sql | Rekap logistik distributor (upload di Kelola Data → Ongkos kirim → Rekap logistik): tabel logistik_kirim + logistik_simpan; view Ongkos Kirim (v_ongkos_baris, v_ongkos_trip, v_ongkos_do, v_ongkos_info) pindah ke sini: biaya ORDB019 didahulukan, FOAD yang di ORDB 0 / belum diunduh memakai Jml Harga rekap; jalur (gudang / pelabuhan → toko) dan waktu kirim. Jalankan setelah 20 dan 21; jalankan lagi kalau 17, 18, 19, atau 20 dijalankan ulang | `SELECT sumber_biaya, COUNT(*) FROM sementrack.v_ongkos_trip GROUP BY sumber_biaya` |
| 23_sellin_asal.sql | v_sellin_bnn_daily dapat kolom asal (asal pengiriman): halaman Sell In BNN membagi realisasi per tipe pesanan (gudang / langsung ke toko / project) dan asal kirim (Terminal Palembang, CCY, ...). Definisi sama dengan 02 | `SELECT asal, SUM(ton) FROM sementrack.v_sellin_bnn_daily WHERE region = N'Sumsel' GROUP BY asal` |

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
