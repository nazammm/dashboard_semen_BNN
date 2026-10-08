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
dotnet run --project Sementrack.Core.Tests          # harus: "Gagal: 0"
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
| `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASSWORD` | hanya untuk start PERTAMA bila tabel akun kosong (min 12 karakter) — hapus setelahnya |

Akun lama (tabel `auth_local.users`, hash bcrypt) tetap bisa dipakai — hash dari versi Node kompatibel.
Tabel `auth_local.*` dibuat otomatis kalau belum ada. Skema `sementrack` (toko multi-distributor): jalankan `sql/ganda_01_migrasi.sql` bila belum.

## 3. Build paket
```
.\build.ps1        # menghasilkan folder .\publish (backend + wwwroot frontend)
```
Atau manual: `cd frontend && npm ci && npm run build`, lalu `dotnet publish backend/Sementrack.Api -c Release -o publish`
dan salin `frontend/dist/*` ke `publish/wwwroot/`.

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
Sesi = token acak di `auth_local.sessions` (8 jam, idle-logout 10 menit di frontend), bcrypt, throttle login per username,
spv/sales dipaksa server ke distributornya, whitelist tabel/fungsi per role, header CSP/HSTS. Tidak ada kredensial bawaan di kode.
