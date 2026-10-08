# SEMENTRACK — Dashboard Distribusi Semen (v0.7, React + ASP.NET Core)

| Lapisan | Teknologi |
|---|---|
| Frontend | React 18 + TypeScript + Tailwind CSS (Vite) — folder `frontend/` |
| Backend | ASP.NET Core 8 Web API (minimal API) + Npgsql — folder `backend/` |
| Database | PostgreSQL `web_semen` (10.10.20.8:61385), schema `public`, `sementrack`, `auth_local` |

Satu aplikasi: backend menyajikan API di `/api/*` dan hasil build frontend dari `wwwroot` (tanpa CORS).

- Cara build & deploy: [`docs/PANDUAN_IT.md`](docs/PANDUAN_IT.md)
- Catatan backend & kontrak API: [`backend/README.md`](backend/README.md)
- SQL (skema toko multi-distributor): `sql/`

Rahasia (password database, sertifikat) TIDAK ada di repo — diisi lewat environment variable di server.
