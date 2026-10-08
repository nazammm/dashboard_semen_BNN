# Build satu paket siap deploy: frontend (React) + backend (ASP.NET Core) -> .\publish
# Syarat: Node 20+, .NET SDK 8
$ErrorActionPreference = 'Stop'
Push-Location frontend;  npm ci;  npm run build;  Pop-Location
if (Test-Path publish) { Remove-Item publish -Recurse -Force }
dotnet publish backend\Sementrack.Api -c Release -o publish
Copy-Item frontend\dist\* publish\wwwroot -Recurse -Force -ErrorAction SilentlyContinue
if (-not (Test-Path publish\wwwroot)) { New-Item publish\wwwroot -ItemType Directory | Out-Null; Copy-Item frontend\dist\* publish\wwwroot -Recurse -Force }
Write-Host "Selesai. Isi folder 'publish' = aplikasi lengkap. Lihat docs\PANDUAN_IT.md untuk hosting IIS + HTTPS."
