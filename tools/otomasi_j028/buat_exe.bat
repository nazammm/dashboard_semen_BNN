@echo off
REM Membuat j028_harian.exe dari j028_harian.py. Jalankan sekali di PC yang sudah ada Python + Playwright.
REM Hasil: dist\j028_harian.exe. Browser yang dipakai Microsoft Edge bawaan Windows, jadi tidak ikut dibungkus.
cd /d "%~dp0"
python -m pip install --upgrade pyinstaller playwright || goto gagal
set PLAYWRIGHT_BROWSERS_PATH=0
python -m PyInstaller --noconfirm --onefile --console --name j028_harian j028_harian.py || goto gagal
echo.
echo Selesai: %~dp0dist\j028_harian.exe
echo Pindahkan exe itu ke folder mana saja. Taruh akun_lokal.txt di folder yang sama kalau tidak mau ditanya password.
pause
exit /b 0
:gagal
echo.
echo Gagal membuat exe. Kirim pesan di atas.
pause
exit /b 1
