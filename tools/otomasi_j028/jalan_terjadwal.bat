@echo off
REM Dijalankan Task Scheduler. Sub ERP lalu J028, data sampai hari ini, tanpa jendela browser.
REM Semua keluaran dicatat di unduhan\log.txt (baris terbaru di bawah).
cd /d "%~dp0"
if not exist unduhan mkdir unduhan
echo.>> unduhan\log.txt
echo ==================== %date% %time% ====================>> unduhan\log.txt
if exist j028_harian.exe (
  j028_harian.exe --semua --sampai-hari-ini --tanpa-layar --tanpa-jeda >> unduhan\log.txt 2>&1
) else (
  python -u j028_harian.py --semua --sampai-hari-ini --tanpa-layar --tanpa-jeda >> unduhan\log.txt 2>&1
)
echo Kode keluar: %errorlevel%>> unduhan\log.txt
