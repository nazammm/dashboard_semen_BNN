# Panduan IT — build & deploy (Windows Server + IIS, HTTPS bangunsukses.com)

## 0. Status verifikasi (baca dulu)
- Frontend: `npm run build` (typecheck + build) lolos; seluruh halaman dirender tanpa error JavaScript terhadap API tiruan (data kosong).
  **Belum** diuji dengan data database asli.
- Backend: logika akses/parser/throttle punya tes otomatis (75 lulus). Kode Npgsql + BCrypt **belum pernah dijalankan** terhadap paket asli
  & database asli (lingkungan pembuat tidak punya akses NuGet). **Langkah 1 di bawah wajib** dijalankan IT dan hasilnya dilaporkan.
- Beda perilaku vs versi Node lama: kolom bigint/numeric kini dikirim sebagai **angka JSON** (dulu string). Frontend memakai `Number()`, tapi cek tiap halaman.

## 1. Verifikasi backend (mesin yang bisa NuGet)
```
cd backend
dotnet new sln -n Sementrack; dotnet sln add Sementrack.Core Sementrack.Api Sementrack.Core.Tests   # sekali saja
dotnet run --project Sementrack.Core.Tests -- ../cases.json ../node_out.json   # harus: "Gagal: 0" (jalankan dari folder backend/)
dotnet build Sementrack.Api -c Release              # harus 0 error (memakai Npgsql & BCrypt.Net-Next asli)
```
`backend/stubs` hanya untuk pengecekan kompilasi tanpa NuGet (`-p:UseStubs=true`) — boleh dihapus.

## 2. Konfigurasi (environment variable di server; JANGAN di repo)
| Variabel | Contoh |
|---|---|
| `DB_HOST` / `DB_PORT` / `DB_NAME` | `10.10.20.8` / `61385` / `web_semen` |
| `DB_USER` / `DB_PASSWORD` | akun database (hak: baca `public`, `sementrack`; tulis `auth_local`) |
| `ALLOWED_ORIGIN` | kosongkan (satu origin) |
| `SESSION_HOURS` | `8` |
| `LOGIN_IP_LIMIT` | opsional, default `true`. Isi `false` HANYA bila semua pengguna terlihat berasal dari satu IP (mis. reverse proxy yang tidak meneruskan IP asli) |
| `DB_POOL_MAX` | opsional, default `10` (koneksi database maksimum yang dipakai aplikasi) |
| `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASSWORD` | hanya untuk start PERTAMA bila tabel akun kosong (min 12 karakter) — hapus setelahnya |

Akun lama (tabel `auth_local.users`, hash bcrypt) tetap bisa dipakai — hash dari versi Node kompatibel.
Tabel `auth_local.*` dibuat otomatis kalau belum ada. Skema `sementrack` (toko multi-distributor): jalankan `sql/ganda_01_migrasi.sql` bila belum.

## 3. Build paket
```
.\build.ps1        # menghasilkan folder .\publish (backend + wwwroot frontend)
```
Atau manual: `cd frontend && npm ci && npm run build`, lalu `dotnet publish backend/Sementrack.Api -c Release -o publish`
dan salin `frontend/dist/*` ke `publish/wwwroot/`.

## 3b. Hosting di SUB-FOLDER (mis. https://bangunsukses.com/Dashboard_semen/)
Base path ditentukan saat build frontend: `set VITE_BASE=/Dashboard_semen/` (PowerShell: `$env:VITE_BASE='/Dashboard_semen/'`) lalu `npm run build`.
API otomatis `/<base>/api/`. Ada 2 cara host:
- **A (disarankan) — semua lewat ASP.NET Core:** buat *IIS Application* `Dashboard_semen` (bukan sekadar folder) berisi hasil `dotnet publish`
  (+ frontend di `wwwroot`). Refresh di `/Dashboard_semen/beranda` aman karena ASP.NET yang menangani semua path.
- **B — frontend sebagai file statis di IIS:** WAJIB ada aturan rewrite ke `index.html` (modul *URL Rewrite*). `frontend/public/web.config`
  sudah menyediakannya dan ikut tersalin ke `dist/`. **Tanpa ini, refresh halaman = "404 - File or directory not found"** (halaman 404 bawaan IIS).
  Dalam mode B, `/Dashboard_semen/api/` harus diteruskan (reverse proxy/ARR) ke aplikasi ASP.NET API.
Kestrel tanpa IIS: set `PATH_BASE=/Dashboard_semen` pada backend.

## 4. Hosting IIS (in-process) + HTTPS
1. Pasang **.NET 8 Hosting Bundle** (ASP.NET Core Runtime + IIS module), restart IIS.
2. Buat site `bangunsukses.com` → physical path = folder `publish`; Application Pool: **No Managed Code**.
3. Binding HTTPS 443 dengan sertifikat bangunsukses.com; HTTP 80 otomatis diarahkan (aplikasi memakai `UseHttpsRedirection` + HSTS).
4. Set environment variable di Application Pool (Configuration Editor → `system.webServer/aspNetCore/environmentVariables`).
5. Pastikan server IIS bisa menjangkau `10.10.20.8:61385` (firewall).
6. Cek: `https://bangunsukses.com/api/` → `{"ok":true,...}`; lalu login.

## 5. Pengembangan lokal
```
dotnet run --project backend/Sementrack.Api --urls http://127.0.0.1:5080     # API
cd frontend && npm install && npm run dev                                     # http://localhost:5173 (proxy /api -> 5080)
```

## 6. Keamanan (ringkas)
Sesi = token acak di `auth_local.sessions` (8 jam, idle-logout 10 menit di frontend), bcrypt, throttle login per akun+IP (plus batas
longgar per IP), spv/sales dipaksa server ke distributornya, whitelist tabel/fungsi per role, header CSP/HSTS. Tidak ada kredensial bawaan di kode.

Hasil audit keamanan (v1.2) yang sekarang berlaku:
- **Logout sungguhan**: tombol Keluar memanggil `POST /api/auth/logout` (sesi dihapus di server); sesi kedaluwarsa dibersihkan otomatis.
- **Batas baris**: `GET /api/{tabel}` tanpa `limit` = 1000 baris, maksimum 10.000 per request (mencegah satu request menghabiskan memori).
- **Body request maks 256 KB**; JSON/Content-Type rusak = 401/400, bukan 500. Pesan error database tidak dikirim ke browser (hanya di log server).
- **Cache hasil 45 detik** di server untuk bacaan data (kunci = SQL + parameter, filter distributor sudah termasuk) — view berat tidak dihitung ulang
  untuk tiap pengguna. Setelah import data, angka bisa tertinggal maksimal 45 detik.
- **Kompresi respons** (gzip/brotli), `index.html` tidak di-cache, file `/assets/` di-cache lama (nama file ber-hash).
- Tabel `distributor_target_salesman` hanya terbaca role `admin` dan `mo` (`AccessRules.RoleOnlyTables`).
- Menyimpan hak akses sebuah role TANPA halaman sekarang benar-benar tanpa halaman (sebelumnya otomatis kembali ke default).
- Akun spv/sales hanya boleh dibuat/diubah ke kode distributor yang ada di tabel `distributor`.

## 7. Update Nov 2026: filter rentang tanggal di Overview
Urutan pasang (keduanya wajib, kalau tidak Overview menampilkan pesan "Filter rentang tanggal belum aktif di server"):
1. Jalankan `docs/sql/overview_rentang_tanggal.sql` di database `web_semen` (membuat 6 fungsi `sementrack.*_range`; fungsi lama tidak diubah).
2. Build ulang dan deploy backend + frontend dari branch ini. Backend menambah 6 fungsi itu ke whitelist (`AccessRules.AllowedFunctions`, schema `sementrack`).

## 8. Update Nov 2026: Sell In BNN + Upload Sell In
1. Jalankan `docs/sql/sell_in_bnn.sql` di `web_semen` (tabel `sementrack.sellin_bnn*`, peta region, fungsi upload, view). Aman dijalankan ulang.
   Fungsi upload memakai SECURITY DEFINER: jalankan skrip sebagai pemilik tabel (nazamudin) supaya backend bisa menulis lewat fungsi itu.
2. Deploy ulang backend + frontend. Endpoint baru: `/api/admin/sellin/*` (khusus admin). Endpoint `stage` menerima body s.d. 12 MB
   (diatur per endpoint di kode). Kalau IIS `requestFiltering/maxAllowedContentLength` diset < 12 MB, frontend otomatis memperkecil paket.
3. Halaman baru: `sell-in-bnn` (admin & Management) dan `upload-sell-in` (admin; sejak bagian 9 menjadi `kelola-data`). Kalau hak akses role Management pernah diubah di
   Kelola Akses, centang "Sell In BNN" untuk role itu. Akun yang sedang login perlu login ulang agar menu baru muncul.

## 9. Update Nov 2026: Kelola Data, status data, Sell In BNN tanpa mortar
1. Jalankan `docs/sql/kelola_data.sql` di `web_semen` SETELAH `sell_in_bnn.sql`, sebagai pemilik tabel (nazamudin). Aman dijalankan ulang.
   Isinya:
   - fungsi upload transaksi `sementrack.transaksi_*` (ganti data per rentang tanggal × distributor yang ada di file);
   - fungsi hapus `sementrack.kelola_hapus*`, log `sementrack.kelola_log`, view riwayat `sementrack.v_kelola_riwayat`;
   - view `sementrack.v_data_status` untuk badge "Data s.d." dan panel Status Data di sidebar;
   - aturan Sell In BNN: WHITE MORTAR dan TR-15 THINBED tidak dihitung lagi (data lama ikut tersaring lewat view).
2. Deploy ulang backend + frontend.
   - Endpoint baru (khusus admin): `/api/admin/transaksi/*` dan `/api/admin/data/*`.
   - Simpan transaksi memicu refresh materialized view (±10 detik di uji lokal, bisa lebih lama di server).
     Backend memberi batas 300 detik untuk query simpan/hapus. Hosting in-process (bagian 4) tidak punya batas waktu IIS;
     kalau memakai out-of-process, naikkan `requestTimeout` di `web.config` (aspNetCore) ke minimal `00:05:00`.
3. Menu `Upload Sell In` berganti menjadi `Kelola Data` (`/kelola-data`, khusus admin). Akun admin yang sedang login perlu login ulang.
4. Fitur unduh PPT di Overview dihapus (paket `pptxgenjs` ikut dibuang dari frontend).
5. Halaman `Sell In` (`delivery`) dihapus; isinya sudah tercakup di `Sell In BNN`. View `v_delivery_ext` tetap dipakai Sell In BNN
   (target & realisasi tahun lalu), jadi jangan dihapus. Id halaman lama di `auth_local.role_pages` otomatis diabaikan.
   Di Kelola Akses, centang "Sell In BNN" untuk role Management kalau hak aksesnya pernah diubah manual.

## 10. Update Nov 2026: Sell Out BNN
1. Jalankan `docs/sql/sell_out_bnn.sql` di `web_semen` SETELAH `kelola_data.sql`, sebagai pemilik tabel (nazamudin). Aman dijalankan ulang.
   Isinya: peta `sementrack.sellout_bnn_peta` (baris distributor/subdist dan sumbernya), tabel tempelan
   `sementrack.sellout_dofas` / `sementrack.sellout_erp`, fungsi simpan, view `v_sellout_bnn_monthly` / `v_sellout_bnn_peta`,
   daftar `sementrack.subdist_customer`, dan `v_data_status` (tambah DO FAS & Sub ERP).
2. Deploy ulang backend + frontend. Endpoint baru (admin): `POST /api/admin/data/sellout`. Halaman baru: `sell-out-bnn`.
3. Role selain admin: centang "Sell Out BNN" di Kelola Akses kalau hak aksesnya pernah diubah manual.
4. File SQL juga mengisi DO FAS & Sub ERP 2026 awal (tempelan 5 Nov 2026), HANYA kalau 2026 masih kosong.
   Setelah itu data diganti lewat Kelola Data → Sell Out BNN (tempel harian). `v_sellout_bnn_peta` punya kolom `jenis`
   (`dist` / `subdist`) untuk grafik bertumpuk dan baris total di halaman. Kolom Area di DO FAS tidak dipakai.
