@echo off
REM Mendaftarkan jalan_terjadwal.bat ke Task Scheduler: tiap 4 jam mulai jam 07:00 (07, 11, 15, 19, 23, 03).
REM Jalan hanya saat akun Windows ini sedang login. Ubah jam / jarak di bawah kalau perlu.
set JAM_MULAI=07:00
set TIAP_JAM=4
cd /d "%~dp0"
schtasks /Create /F /TN "SEMENTRACK otomasi ERP" /SC HOURLY /MO %TIAP_JAM% /ST %JAM_MULAI% /TR "\"%~dp0jalan_terjadwal.bat\"" || goto gagal
echo.
echo Terpasang: "SEMENTRACK otomasi ERP" tiap %TIAP_JAM% jam mulai %JAM_MULAI%.
echo Hasil tiap jalan: %~dp0unduhan\log.txt
echo Menghapus jadwal: schtasks /Delete /TN "SEMENTRACK otomasi ERP" /F
pause
exit /b 0
:gagal
echo Gagal memasang jadwal. Kirim pesan di atas.
pause
exit /b 1
