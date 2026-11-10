# Catatan pindah ke SQL Server

Urutan skrip (jalankan di SSMS, database MARKETING_ANALIS):

| File | Isi | Cek |
|---|---|---|
| 01_tabel.sql | 31 tabel, relasi, aturan isian | jumlah tabel per skema |
| (tools/salin_mssql) | salin data dari PostgreSQL | `node salin.cjs` |
| 02_sellin.sql | Sell In BNN, Outstanding DO | `node salin.cjs --banding sellin` |
| 03_sellout.sql | Sell Out BNN, J073, target | `node salin.cjs --banding sellout` |

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
