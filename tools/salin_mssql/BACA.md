# Salin data PostgreSQL ke SQL Server

Menyalin isi 27 tabel SEMENTRACK dari PostgreSQL (web yang sekarang) ke database SQL Server MARKETING_ANALIS.
Tabel tujuan harus sudah dibuat dengan `docs/mssql/01_tabel.sql`.

Tidak ikut disalin: tabel staging upload (`transaksi_staging`, `sellin_bnn_staging`, `sellin_po_staging`) karena isinya hanya sementara,
dan `auth_local.sessions` (sesi login; pengguna cukup login ulang).

## Langkah (Windows, pakai Command Prompt, bukan PowerShell)

1. Ekstrak folder ini, misalnya ke `C:\salin_mssql`.
2. Buka Command Prompt, lalu:
   ```
   cd C:\salin_mssql
   npm install
   ```
3. Pemeriksaan dulu, tidak menulis apa pun:
   ```
   node salin.mjs --cek
   ```
   Isi pertanyaannya. Tekan Enter untuk memakai nilai di dalam kurung siku.
   Password tidak tampil saat diketik dan tidak disimpan di mana pun.
4. Kalau hasilnya "Tidak ada temuan", jalankan penyalinan:
   ```
   node salin.mjs
   ```
   Ketik `y` saat ditanya. Isi tabel tujuan diganti dengan data PostgreSQL, jadi skrip ini aman dijalankan ulang.

Mengulang tabel tertentu saja: `node salin.mjs --tabel transaksi,target`

## Yang diperiksa

Sebelum menyalin:
- teks yang lebih panjang dari kolom tujuan;
- nilai kunci yang di PostgreSQL berbeda tetapi di SQL Server dianggap sama (huruf besar/kecil, spasi di akhir, lebih dari satu NULL).

Sesudah menyalin:
- jumlah baris tiap tabel dibandingkan dengan PostgreSQL;
- semua relasi dan aturan isian diperiksa ulang terhadap data.

Satu tabel = satu transaksi: kalau satu tabel gagal, tabel itu kembali seperti semula dan tabel lain tetap jalan.
