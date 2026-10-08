# SEMENTRACK API (ASP.NET Core 8) — port dari server.js v10

Folder: Sementrack.Core (aturan akses, parser query, throttle login — tanpa paket luar),
Sementrack.Core.Tests (uji), Sementrack.Api (Web API), stubs (HANYA untuk cek kompilasi tanpa NuGet).

## Jalankan (mesin yang bisa NuGet)
    dotnet test Sementrack.Core.Tests        # atau: dotnet run --project Sementrack.Core.Tests
    dotnet build Sementrack.Api
    # konfigurasi lewat environment variable / appsettings / user-secrets:
    DB_HOST=10.10.20.8 DB_PORT=61385 DB_NAME=web_semen DB_USER=... DB_PASSWORD=...
    ALLOWED_ORIGIN=https://bangunsukses.com   SESSION_HOURS=8
    BOOTSTRAP_ADMIN_USER / BOOTSTRAP_ADMIN_PASSWORD  (hanya dipakai kalau tabel users kosong; min 12 karakter)
    dotnet publish Sementrack.Api -c Release -o publish   # lalu host di IIS (in-process) + sertifikat HTTPS

## Kontrak API (identik dengan versi Node, prefix /api)
POST rpc/login · POST rpc/{fn} · GET data-freshness · POST activity/log · GET {table} (?eq./gte./lte./gt./lt./in., order, limit, offset, Prefer: count=exact)
GET/POST admin/users · PUT/DELETE admin/users/{u} · GET admin/distributor-list · GET/POST admin/role-pages · GET admin/activity

## Belum terverifikasi (dikompilasi hanya terhadap stub di lingkungan tanpa NuGet)
- Kode yang memakai Npgsql & BCrypt.Net-Next belum dijalankan terhadap paket aslinya / database asli.
- Perbedaan perilaku: bigint/numeric kini terkirim sebagai ANGKA JSON (Node: string). Frontend memakai Number(), tapi cek tiap halaman.
- Perlu uji end-to-end: login, tiap halaman, scope spv/sales, Kelola Akses.
