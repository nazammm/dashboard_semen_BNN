@echo off
REM Membuat "Nazam Auto Task.exe". Jalankan sekali di PC yang sudah ada Python.
REM Hasil: dist\Nazam Auto Task.exe. Browser yang dipakai Microsoft Edge bawaan Windows, jadi tidak ikut dibungkus.
cd /d "%~dp0"
python -c "import tkinter" || (echo Python ini belum punya tkinter. Pasang ulang Python dari python.org dengan opsi tcl/tk. & goto gagal)
python -m pip install --upgrade pyinstaller playwright || goto gagal
set PLAYWRIGHT_BROWSERS_PATH=0
python -m PyInstaller --noconfirm --onefile --windowed --name "Nazam Auto Task" --icon ikon.ico --add-data "ikon.ico;." nazam_auto_task.py || goto gagal
echo.
echo Selesai: %~dp0dist\Nazam Auto Task.exe
echo Pindahkan exe itu ke folder tetap (mis. Documents\Nazam Auto Task), lalu buka.
echo Pengaturan, riwayat, dan folder unduhan dibuat di folder yang sama dengan exe.
pause
exit /b 0
:gagal
echo.
echo Gagal membuat exe. Kirim pesan di atas.
pause
exit /b 1
