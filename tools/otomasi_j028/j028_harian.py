"""Ambil data dari ERP lalu masukkan ke SEMENTRACK. Sekali jalan, tanpa Excel.

Satu kali login ERP: job J028, J028B, dan J073 (per distributor) dikirim sekaligus; selagi job diproses
server ERP, tabel Sub ERP dibaca; setelah job selesai semua file diunduh. Lalu satu kali login SEMENTRACK:
Tempel Sub ERP, upload Transaksi (J028 + J028B), upload J073 (satu file per distributor).

    python j028_harian.py                      # J028 saja, tanggal 1 bulan ini s.d. kemarin
    python j028_harian.py --semua              # J028 + J073 + Sub ERP
    python j028_harian.py --j073               # J073 saja (INSA dan PKB)
    python j028_harian.py --subdist            # Sub ERP saja
    python j028_harian.py --dari 2026-11-01 --sampai 2026-11-12
    python j028_harian.py --subdist --bulan 2026-10 2026-11
    python j028_harian.py --hanya-unduh        # ambil dari ERP saja
    python j028_harian.py --tanpa-simpan       # di SEMENTRACK sampai pratinjau saja

TIRO (Sell In = laporan per Pengiriman, OS DO = per Tanggal Pemesanan, 1 Januari s.d. hari ini) SETENGAH
otomatis: email dan password diisi, captcha diketik sendiri di jendela yang terbuka; sesinya disimpan
(tiro_sesi.json) dan dipakai lagi sampai habis. Captcha tidak pernah dibaca oleh program.
    python j028_harian.py --login-tiro         # login TIRO saja (ketik captcha), simpan sesi
    python j028_harian.py --bagian SELLIN,OSDO # unduh dari TIRO lalu upload Sell In dan Outstanding DO

DO FAS: baca rekap DO harian (Excel di folder bersama, DOFAS_FILE; bawaan folder korin di b186),
lalu Tempel DO FAS (mengganti DO FAS setahun; tidak disimpan kalau ada angka yang turun, kecuali --paksa).
    python j028_harian.py --bagian DOFAS

Stock: file Stock Semen bulan berjalan (satu sheet per tanggal, folder bersama STOCK_FILE; bawaan b236) diunggah
ke Kelola Data → Stock. Tanggal yang ada di file diganti; sheet setelah hari ini dilewati oleh web. Tanggal 1–3 bulan
baru: file bulan lalu ikut diunggah supaya revisi hari terakhir bulan lalu terbawa.
    python j028_harian.py --bagian STOCK

Ongkos kirim (halaman Ongkos Kirim): per distributor di ONGKOS_DIST (13 distributor; INSA-E ikut INSA 4094):
- jadwal mingguan (--jadwal, ONGKOS_HARI): J073 bulan ini + 2 bulan sebelumnya (satu job), ORDB019 bulan ini dan bulan lalu,
  plus dua bulan lalu sekali lagi setelah bulan itu tutup.
- rentang pilihan (paling panjang 3 bulan): --ongkos-dari / --ongkos-sampai / --ongkos-dist.
- isi data lama: --isi-ulang 2025-01 [--ongkos-dist ...], per bulan untuk semua distributor bersamaan, dicatat di
  isi_ulang_ongkos.json; kalau terhenti jalankan lagi, yang sudah masuk dilewati.
Supaya tidak mengunduh berulang:
1. Salinan lokal (ONGKOS_FOLDER, bawaan D:\\Nazam\\Template\\Auto Task File\\J073|ORDB019\\<kode>\\...) yang masih segar
   dipakai langsung tanpa membuka ERP. Segar = diunduh hari ini, atau diunduh setelah bulannya tutup (mulai tanggal 1 dua
   bulan sesudahnya). Isi file diperiksa (distributor / periode) sebelum disimpan.
2. Sebelum meminta ORDB019, View Report (SYS_Report_View.aspx, sampai MAKS_HALAMAN_VIEW halaman) diperiksa: laporan dengan
   DIST + PERIODE yang sama, FINISHED, dan segar langsung diunduh.
3. Setiap submit (J073, J028, ORDB019) dikonfirmasi: View Job / View Report dicek tiap 15 detik sampai ID barunya muncul
   (paling lama KONFIRMASI_JOB_DETIK = 3 menit), baru kiriman berikutnya dikirim; ID langsung dipasangkan (laporan lewat
   DIST + PERIODE). Tidak muncul dalam 3 menit: 1 menit kemudian dicek sekali lagi (laporan: semua halaman); kalau ternyata
   cuma telat, ID itu dipakai dan tidak submit ulang. Baru kalau tetap tidak ada, submit ulang (COBA_KIRIM, 3 kali).
   Submit yang ditolak ERP (pop-up antrian penuh / gagal) juga dicoba lagi 1 menit kemudian.
Antrian ERP paling banyak MAKS_ANTRIAN (2) job + laporan sekaligus, termasuk yang belum muncul di View.
    python j028_harian.py --bagian ONGKOS
    python j028_harian.py --isi-ulang 2025-01
    python j028_harian.py --ongkos-dari 2025-08-01 --ongkos-sampai 2025-10-31 --ongkos-dist 9575,4403

Harga Loco (perkiraan nilai Outstanding DO): ERP Order Process -> Other Inquiry -> Price & Promo Simulation
(SLS_Price_Promo_Simulation.aspx), per PT (HARGA_DIST, bawaan 13 distributor) x produk CMT / RJW / CWC (HARGA_PRODUK).
Yang dipakai hanya baris LOCO GUDANG, kolom Net Price, berlaku Effective Date s.d. Expired Date. Tidak dicek per hari:
dari tanggal awal (HARGA_DARI, bawaan 1 Januari) harga dibaca, lalu lompat ke Expired Date + 1 hari, sampai Expired kosong
(= masih berlaku). Jalan berikutnya mulai dari masa berlaku terakhir yang sudah terunggah (harga_loco.json), jadi biasanya
satu kali Next per PT x produk. Hasil: HARGA_LOCO_<waktu>.csv di folder salinan, diupload ke Kelola Data -> Sell In BNN ->
Harga Loco. Dari jadwal: paling sering sekali seminggu (HARGA_HARI).
    python j028_harian.py --bagian HARGA
    python j028_harian.py --bagian HARGA --harga-dari 2025-01-01      # baca ulang dari tanggal ini

Satu bagian gagal tidak menghentikan bagian lain; semua kegagalan dilaporkan di akhir.
Sub ERP: hanya bulan yang diambil yang diganti; tidak disimpan kalau ada angka yang turun (kecuali --paksa).
J073: distributor diatur J073_DIST (bawaan 4094 = INSA, 9575 = PKB).

Jadwal otomatis (mis. tiap 4 jam): jadwal_pasang.bat mendaftarkan jalan_terjadwal.bat ke Task Scheduler.
Yang dijalankan: --semua --sampai-hari-ini --tanpa-layar --tanpa-jeda, hasilnya dicatat di unduhan/log.txt.

Password TIDAK ditulis di file ini. Urutan sumbernya: environment variable Windows, lalu file
akun_lokal.txt di folder yang sama dengan skrip / exe (baris NAMA=nilai, lihat akun_lokal.contoh.txt),
lalu ditanya saat jalan (ketikan tidak tampil):
    ERP_USER, ERP_PASS            akun ERP (bangunsukses.com)
    SEMENTRACK_URL                alamat web SEMENTRACK, mis. http://localhost:5173
    SEMENTRACK_USER, SEMENTRACK_PASS   akun admin SEMENTRACK

Kalau bagian ERP gagal, screenshot dan HTML halaman terakhir disimpan di folder unduhan
(login_gagal, menu_J028, sebelum_submit_J028, setelah_submit_J028, gagal) untuk dicari penyebabnya.
"""
import argparse
import csv
import getpass
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from playwright.sync_api import Error as PWError, Page, TimeoutError as PWTimeout, sync_playwright

VERSI = "2026.11.20.3"               # tampil di awal log dan di aplikasi, untuk memastikan exe yang dipakai sudah terbaru
ERP = os.environ.get("ERP_URL", "https://www.bangunsukses.com").rstrip("/")   # ERP_URL hanya untuk uji
MATRIX = "01"                    # pilihan di #ContentPlaceHolder1_ddMatrix, sama dengan rekaman
FORMAT_TANGGAL_ERP = "%d %b %Y"  # PERLU DICEK (1): format isi kolom tanggal ERP, mis. "01 Nov 2026"
SUBDIST_HALAMAN = "SLS_Inq_Monthly_Sales_Summary_SubDist_By_Distributor.aspx"
SUBDIST_GRUP = "01"              # Product Group SEMEN, sama dengan rekaman
TIRO = os.environ.get("TIRO_URL", "https://tiro.indocement.co.id").rstrip("/")   # TIRO_URL hanya untuk uji
TIRO_LAPORAN = "Pages/transaction_monitoring_report.aspx"
TIRO_TUNGGU_MENIT = 10           # batas menunggu captcha diketik saat login TIRO
TIRO_JENIS = {"SELLIN": ("Pengiriman", "SellIn"), "OSDO": ("Tanggal Pemesanan", "OSDO")}   # radio di laporan, nama file
RINGKAS_SUBDIST: list[str] = []   # ringkasan Sub ERP per bulan untuk riwayat
BULAN_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
BULAN_ID = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"]
TUNGGU_JOB_MENIT = 45            # batas menunggu semua job selesai di View Job
MAKS_ANTRIAN = int(os.environ.get("MAKS_ANTRIAN", "2"))   # ERP menerima paling banyak 2 job menunggu per user
JEDA_CEK_DETIK = int(os.environ.get("JEDA_CEK_DETIK", "180"))   # View Job dicek ulang tiap 3 menit
# J073: distributor yang diunduh (kode ERP). INSA = 4094, PKB = 9575. Bisa diubah lewat J073_DIST=4094,9575
JEDA_CEK_PENDEK = int(os.environ.get("JEDA_CEK_PENDEK", "60"))  # tanpa J028 di antrian: J073 / ORDB019 cepat selesai
# distributor ongkos kirim: kode ERP dan nama di dashboard. INSA-E (4094E) di ERP kosong: datanya ikut INSA (4094)
DAFTAR_DIST = [("4094", "INSA"), ("9575", "PKB"), ("6980", "BKP"), ("6984", "BMM"), ("4708", "CBS"), ("6983", "GMD"), ("9757", "JMB"),
               ("1001K", "KTP"), ("1001P", "PTK"), ("4403", "NC"), ("4403B", "NCB"), ("6987", "NSA"), ("6981", "PM")]
ONGKOS_DIST_BAWAAN = ",".join(k for k, _ in DAFTAR_DIST)
FOLDER_FILE_BAWAAN = r"D:\Nazam\Template\Auto Task File"     # salinan J073 / ORDB019 yang sudah diunduh (ONGKOS_FOLDER)
ONGKOS_HARI = int(os.environ.get("ONGKOS_HARI", "7"))          # dari jadwal: ongkos kirim diperbarui paling sering sekali seminggu
KELOMPOK_ISI_ULANG = int(os.environ.get("KELOMPOK_ISI_ULANG", "8"))
COBA_KIRIM = int(os.environ.get("COBA_KIRIM", "3"))            # submit gagal / ditolak ERP: dicoba lagi sampai sekian kali, jeda JEDA_COBA_DETIK
JEDA_COBA_DETIK = int(os.environ.get("JEDA_COBA_DETIK", "60"))
# cadangan kalau kiriman aktif kehilangan ID-nya: dicek tiap menit, setelah TUNGGU_MUNCUL_MENIT diperiksa ulang / submit ulang.
TUNGGU_MUNCUL_MENIT = int(os.environ.get("TUNGGU_MUNCUL_MENIT", "3"))
TUNGGU_MUNCUL_JOB_MENIT = int(os.environ.get("TUNGGU_MUNCUL_JOB_MENIT", "3"))
# Konfirmasi: setelah submit, View Job / View Report dicek (tiap 15 detik, paling lama KONFIRMASI_JOB_DETIK = 3 menit) sampai
# ID barunya muncul, baru kiriman berikutnya dikirim. Jadi tiap ID langsung dipasangkan ke kirimannya (laporan: DIST + PERIODE).
# Tidak muncul: dicoba lagi 1 menit kemudian, tapi sebelum submit ulang dicek dulu apakah ternyata cuma telat tercatat.
KONFIRMASI_JOB_DETIK = int(os.environ.get("KONFIRMASI_JOB_DETIK", "180"))
COBA_MUNCUL = int(os.environ.get("COBA_MUNCUL", "2"))          # paling banyak 2 kali submit untuk yang tidak pernah muncul   # isi ulang: sekian job/laporan per putaran unduh-upload
HARGA_HALAMAN = "SLS_Price_Promo_Simulation.aspx"
HARGA_HARI = int(os.environ.get("HARGA_HARI", "7"))            # dari jadwal: harga Loco dibaca paling sering sekali seminggu
HARGA_MAKS_LOMPAT = 60                                          # pengaman: paling banyak sekian Next per PT x produk
POLA_STATUS = re.compile(r"FINISH|PROCESS|QUEUE|WAIT|PENDING|RUNNING|ERROR|FAIL|CANCEL|DONE|SUCCESS", re.I)
POLA_KODE = re.compile(r"^(J028B?|J073|ORDB\d+)$", re.I)


def j073_dist() -> list[str]:
    return [k.strip() for k in os.environ.get("J073_DIST", "4094,9575").split(",") if k.strip()]


def ongkos_dist() -> list[str]:
    # 4094E (INSA-E) di ERP kosong: datanya ada di 4094
    return [k.strip().upper() for k in os.environ.get("ONGKOS_DIST", ONGKOS_DIST_BAWAAN).split(",") if k.strip() and k.strip().upper() != "4094E"]


def harga_dist() -> list[str]:
    return [k.strip().upper() for k in os.environ.get("HARGA_DIST", ONGKOS_DIST_BAWAAN).split(",") if k.strip() and k.strip().upper() != "4094E"]


def harga_produk() -> re.Pattern:
    """Produk yang dibaca: kode diawali CMT / RJW / CWC (bisa diganti lewat HARGA_PRODUK, pola regex)."""
    return re.compile(os.environ.get("HARGA_PRODUK", r"^(CMT|RJW|CWC)"), re.I)


J073_DIST = j073_dist()   # nilai awal (untuk tampilan); saat jalan selalu dibaca ulang lewat j073_dist()
# folder skrip, atau folder file .exe kalau dijalankan sebagai exe (PyInstaller)
DASAR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
FOLDER = DASAR / "unduhan"
KANAL = os.environ.get("BROWSER_KANAL", "msedge") or None   # browser yang dipakai Playwright; kosongkan untuk Chromium bawaan


AKUN_LOKAL = DASAR / "akun_lokal.txt"


def _dpapi(data: bytes, enkripsi: bool) -> bytes:
    """Enkripsi Windows (DPAPI): hanya bisa dibuka oleh akun Windows yang sama di PC yang sama."""
    import ctypes
    from ctypes import wintypes

    class BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    buf = ctypes.create_string_buffer(data, len(data))
    masuk, keluar = BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), BLOB()
    fn = ctypes.windll.crypt32.CryptProtectData if enkripsi else ctypes.windll.crypt32.CryptUnprotectData
    if not fn(ctypes.byref(masuk), None, None, None, None, 0x01, ctypes.byref(keluar)):   # 0x01 = tanpa dialog
        raise OSError("DPAPI gagal")
    try:
        return ctypes.string_at(keluar.pbData, keluar.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(ctypes.cast(keluar.pbData, ctypes.c_void_p))


def sandi_kunci(teks: str) -> str:
    import base64
    if os.name == "nt":
        return "dpapi:" + base64.b64encode(_dpapi(teks.encode("utf-8"), True)).decode()
    return "b64:" + base64.b64encode(teks.encode("utf-8")).decode()     # bukan Windows (uji): hanya disamarkan


def sandi_buka(nilai: str) -> str:
    import base64
    jenis, _, isi = nilai.partition(":")
    if jenis == "dpapi":
        return _dpapi(base64.b64decode(isi), False).decode("utf-8")
    if jenis == "b64":
        return base64.b64decode(isi).decode("utf-8")
    return nilai


def baca_akun_file() -> dict[str, str]:
    """akun_lokal.txt (NAMA=nilai per baris, # = komentar). NAMA_ENC = nilai terenkripsi (ditulis aplikasi)."""
    hasil: dict[str, str] = {}
    if not AKUN_LOKAL.exists():
        return hasil
    for baris in AKUN_LOKAL.read_text(encoding="utf-8-sig").splitlines():
        baris = baris.strip()
        if not baris or baris.startswith("#") or "=" not in baris:
            continue
        k, v = (x.strip() for x in baris.split("=", 1))
        if not v:
            continue
        if k.endswith("_ENC"):
            try:
                hasil[k[:-4]] = sandi_buka(v)
            except Exception:  # noqa: BLE001 - mis. file disalin dari PC / akun Windows lain
                print(f"  {k[:-4]} di akun_lokal.txt tidak bisa dibuka di akun Windows ini; isi ulang di Pengaturan.")
        else:
            hasil.setdefault(k, v)
    return hasil


def baca_akun_lokal() -> None:
    """Isi akun_lokal.txt menimpa environment variable lama, supaya perubahan di Pengaturan selalu dipakai."""
    os.environ.update(baca_akun_file())


def rahasia(nama: str, label: str, tersembunyi: bool = False) -> str:
    v = os.environ.get(nama, "").strip()
    if v:
        return v
    if os.environ.get("NAT_TANPA_TANYA") or not sys.stdin or not sys.stdin.isatty():
        raise SystemExit(f"{label.split(' (')[0]} belum diisi. Isi di Pengaturan aplikasi (atau akun_lokal.txt).")
    return (getpass.getpass(f"{label}: ") if tersembunyi else input(f"{label}: ")).strip()


def tanggal_erp(d: date) -> str:
    # nama bulan Inggris tiga huruf, tidak tergantung bahasa Windows
    bulan = BULAN_EN[d.month - 1]
    return d.strftime(FORMAT_TANGGAL_ERP.replace("%b", bulan))


def isi_tanggal(page: Page, selector: str, d: date) -> None:
    """PERLU DICEK (2): di rekaman kolom tanggal hanya diklik (kemungkinan muncul kalender).
    Di sini nilainya diisi langsung lalu Tab. Kalau ERP menolak ketikan, ganti dengan klik kalender."""
    f = page.locator(selector)
    f.click()
    f.fill(tanggal_erp(d))
    f.press("Tab")


def jejak(page: Page, nama: str) -> str:
    """Simpan screenshot dan HTML halaman saat ini ke folder unduhan, untuk mencari tahu kenapa gagal."""
    FOLDER.mkdir(exist_ok=True)
    try:
        page.screenshot(path=str(FOLDER / f"{nama}.png"), full_page=True)
        (FOLDER / f"{nama}.html").write_text(page.content(), encoding="utf-8")
    except Exception:  # noqa: BLE001 - jejak tidak boleh menutupi galat aslinya
        pass
    return f"{page.url}  (lihat unduhan/{nama}.png)"


def login_erp(page: Page, user: str, pwd: str) -> None:
    page.goto(f"{ERP}/index.aspx")
    page.locator("#username").fill(user)
    page.locator("#password").fill(pwd)
    page.get_by_role("button", name="Log in").click()
    try:
        page.wait_for_load_state("networkidle", timeout=60_000)
    except PWTimeout:
        pass
    # kotak username masih ada = login ditolak (password salah, akun terkunci, atau sesi lama masih aktif)
    if page.locator("#username").count() and page.locator("#username").first.is_visible():
        teks = page.locator("body").inner_text()
        pesan = " ".join(b.strip() for b in teks.splitlines() if b.strip())[:300]
        raise SystemExit(f"Login ERP gagal. Teks di halaman: {pesan}\nHalaman: {jejak(page, 'login_gagal')}")
    print("  login ERP berhasil")


def buka_form(page: Page, menu: str, penanda: str) -> None:
    """Buka halaman kirim job (J028, J028B, J073). Coba alamat langsung dulu, baru lewat menu."""
    tanda = page.locator(penanda)
    page.goto(f"{ERP}/SYS_Job_{menu}.aspx")
    try:
        tanda.wait_for(timeout=15_000)
        return
    except PWTimeout:
        pass
    # lewat menu: arahkan kursor dulu (menu bisa hanya terbuka saat di-hover), lalu klik
    try:
        page.locator("#mmlink7").hover(timeout=15_000)
        page.locator("#mmlink7").click()
        page.locator("a").filter(has_text=re.compile(rf"^\s*{re.escape(menu)}\s*$")).first.click(timeout=15_000)
        tanda.wait_for(timeout=15_000)
    except PWTimeout:
        raise SystemExit(f"Halaman {menu} tidak bisa dibuka.\nHalaman: {jejak(page, f'menu_{menu}')}")


LAPORAN_META: dict[str, dict] = {}   # Report ID -> {dist, bulan, mulai, status} dari kolom Parameters / Start Run


def _meta_laporan(sel: list[str]) -> dict:
    """Kolom Parameters View Report: DIST="4094" ,TRANSPORTER="0" ,PERIODE="JUN 2025"; Start Run: 19 Nov 2026-13:44:27."""
    teks = " ".join(sel)
    meta: dict = {}
    # tanda kutip di ERP bisa " atau '' atau kutip miring: semua yang bukan huruf/angka di antara = dan nilainya dilewati
    m = re.search(r'DIST(?:RIBUTOR)?(?:[ _]?CODE)?\s*[=:][^0-9A-Za-z]*([0-9A-Z]+)', teks, re.I)
    if m:
        meta["dist"] = m.group(1).upper()
    m = re.search(r'PERIODE\s*[=:][^0-9A-Za-z]*([A-Za-z]{3})[A-Za-z]*[^0-9A-Za-z]*(\d{4})', teks, re.I)
    if m and m.group(1).capitalize() in BULAN_EN:
        meta["bulan"] = date(int(m.group(2)), BULAN_EN.index(m.group(1).capitalize()) + 1, 1)
    m = re.search(r"(\d{1,2}) ([A-Za-z]{3}) (\d{4})[- ](\d{2}):(\d{2})", teks)
    if m and m.group(2).capitalize() in BULAN_EN:
        meta["mulai"] = datetime(int(m.group(3)), BULAN_EN.index(m.group(2).capitalize()) + 1, int(m.group(1)), int(m.group(4)), int(m.group(5)))
    return meta


def baca_antrian(page: Page, pola: str) -> dict[str, tuple[str, str]]:
    """Tabel View Job / View Report: {ID: (kode, status)}. Sel bisa dua baris ("R2671055 / BNN241", "ORDB019 / MONTHLY
    DELIVERY COST", "FINISHED (11.4 SEC) / 19 Nov 2026-13:44:38"): yang dibaca baris pertamanya. ID = cocok `pola`;
    kode = J028 / J028B / J073 / ORDBnnn; status = FINISHED / PROCESSING / ... . Untuk laporan, distributor dan periode dari
    kolom Parameters disimpan di LAPORAN_META."""
    for coba in range(3):                       # halaman yang sedang berpindah (postback) dibaca ulang
        try:
            baris = page.evaluate("() => [...document.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.innerText.trim()))")
            break
        except PWError:
            page.wait_for_load_state("load", timeout=60_000)
    else:
        baris = []
    hasil = {}
    for b in baris:
        pertama = [(c.split("\n")[0] if c else "").strip() for c in b]
        i = next((k for k, c in enumerate(pertama) if re.match(pola + r"\b", c)), None)
        if i is None:
            continue
        jid = re.match(pola, pertama[i]).group(0)
        kode = next((c for c in pertama if POLA_KODE.match(c)), pertama[i + 1] if i + 1 < len(pertama) else "")
        status = next((c for k, c in enumerate(pertama) if k != i and POLA_STATUS.search(c)), pertama[i - 1] if i else "")
        hasil[jid] = (kode.upper(), status.upper())
        LAPORAN_META[jid] = {**_meta_laporan(b), "status": status.upper()}      # job dan laporan: DIST, PERIODE, Start Run
    return hasil


def daftar_job(page: Page) -> dict[str, tuple[str, str]]:
    """Isi View Job: {Job ID: (Job Code, Status)}."""
    page.goto(f"{ERP}/SYS_View_Job.aspx")
    try:
        page.wait_for_load_state("networkidle", timeout=60_000)
    except PWTimeout:
        pass
    return baca_antrian(page, r"J\d{5,}")


VIEW_REPORT_JEJAK: list[bool] = []


def _buka_menu(page: Page, induk: str, teks: str) -> bool:
    """Menu ERP: arahkan kursor ke induk (#mmlink6) lalu klik submenu bertuliskan `teks`."""
    try:
        page.locator(induk).hover(timeout=10_000)
        page.locator(induk).click(timeout=10_000)
        page.locator("a").filter(has_text=re.compile(teks, re.I)).first.click(timeout=10_000)
        page.wait_for_load_state("domcontentloaded", timeout=30_000)
        return True
    except PWTimeout:
        return False


VIEW_REPORT_CARA: list[str] = []     # "menu" kalau menu Report → View Report berhasil, selain itu alamat halamannya


def daftar_laporan(page: Page) -> dict[str, tuple[str, str]]:
    """Isi View Report (halaman 1, laporan terbaru di atas): {Report ID: (kode laporan, Status)}.
    Selalu dibuka dengan MENGKLIK tautan View Report di menu ERP (seperti manual, bukan refresh / F5). Kalau tautannya
    tidak ada di halaman ini, lewat menu Report (#mmlink6), terakhir alamatnya (SYS_Report_View.aspx)."""
    def baca() -> dict[str, tuple[str, str]]:
        try:
            page.wait_for_load_state("networkidle", timeout=60_000)
        except PWTimeout:
            pass
        hasil = baca_antrian(page, r"R\d{5,}")
        if hasil and not VIEW_REPORT_JEJAK:              # sekali per jalan: contoh baris yang terbaca, untuk dicek di log
            VIEW_REPORT_JEJAK.append(True)
            jejak(page, "view_report")
            j = max(hasil)
            m = LAPORAN_META.get(j, {})
            print(f"  View Report terbaca: {len(hasil)} laporan; terbaru {j} {hasil[j][0]} {hasil[j][1]} · "
                  f"DIST {m.get('dist', '?')} · PERIODE {m['bulan']:%b %Y}" if "bulan" in m else
                  f"  View Report terbaca: {len(hasil)} laporan; terbaru {j}, tapi DIST / PERIODE tidak terbaca (lihat unduhan/view_report.html)")
        return hasil

    def ada_tabel() -> bool:
        try:
            page.wait_for_load_state("domcontentloaded", timeout=30_000)
            return page.locator("th, td").filter(has_text=re.compile(r"Report\s*ID", re.I)).count() > 0
        except PWError:
            return False

    cari_js = """() => [...document.querySelectorAll('a')].find(a => /Report_View|View_Report/i.test(a.getAttribute('href') || '')
                  || /^\\s*(View\\s*Report|Report\\s*View)\\s*$/i.test(a.textContent || ''))"""

    def klik() -> bool:
        """Klik tautan View Report yang ada di halaman (juga yang tersembunyi di menu)."""
        try:
            if not page.evaluate(f"() => !!({cari_js})()"):
                return False
            with page.expect_navigation(timeout=30_000):
                page.evaluate(f"() => ({cari_js})().click()")
        except (PWTimeout, PWError):
            return False
        return ada_tabel()

    menu = lambda: _buka_menu(page, "#mmlink6", r"^\s*(View\s*Report|Report\s*View)\s*$") and ada_tabel()

    def alamat(u: str) -> bool:
        try:
            page.goto(u)
        except PWError:
            return False
        return ada_tabel()

    if klik():
        return baca()
    if VIEW_REPORT_CARA and VIEW_REPORT_CARA[0] != "menu" and alamat(VIEW_REPORT_CARA[0]):
        # dari halaman tanpa menu (mis. form laporan): buka sekali lewat alamat, lalu klik tautan View Report di sana
        return baca() if not klik() else baca()
    if menu():
        VIEW_REPORT_CARA[:] = ["menu"]
        return baca()
    for u in (f"{ERP}/SYS_Report_View.aspx", f"{ERP}/SYS_View_Report.aspx"):
        if alamat(u):
            VIEW_REPORT_CARA[:] = [page.url]
            klik()                                       # muat ulang lewat klik, bukan dari alamat
            print(f"  View Report: {page.url}")
            return baca()
    raise SystemExit(f"Halaman View Report tidak ketemu (tautan View Report, menu Report, maupun SYS_Report_View.aspx).\nHalaman: {jejak(page, 'view_report_gagal')}")


MAKS_HALAMAN_VIEW = int(os.environ.get("MAKS_HALAMAN_VIEW", "20"))   # pindai View Report paling banyak sekian halaman


def ke_halaman_view(page: Page, n: int) -> bool:
    """Pindah ke halaman n tabel View Report (pager "Page [1] of 4"): pilih nomor di dropdown, cadangannya tombol berikutnya."""
    jumlah = page.evaluate("""() => {
      const s = [...document.querySelectorAll('select')].find(s => s.options.length > 0 && [...s.options].every(o => /^\\d+$/.test(o.text.trim())));
      if (!s) return 0; s.setAttribute('data-nat-pager', '1'); return s.options.length; }""")
    if jumlah and n > jumlah:
        return False
    maju = page.locator("a[title*='Next' i], input[title*='Next' i], a:has(img[alt*='Next' i]), input[type=image][src*='next' i], a:has(img[src*='next' i])")
    if not jumlah and not maju.count():
        return False
    try:
        try:
            with page.expect_navigation(timeout=20_000):          # pager ASP.NET: postback memuat ulang halaman
                if jumlah:
                    page.locator("select[data-nat-pager]").select_option(str(n))
                else:
                    maju.first.click()
        except PWTimeout:
            pass                                                   # pager tanpa muat ulang (AJAX)
        page.wait_for_load_state("networkidle", timeout=60_000)
    except PWTimeout:
        return False
    return bool(baca_antrian(page, r"R\d{5,}"))


def bulan_tambah(d: date, n: int) -> date:
    k = d.year * 12 + d.month - 1 + n
    return date(k // 12, k % 12 + 1, 1)


def segar(bulan_akhir: date, waktu: datetime | None, hari: date) -> bool:
    """Data bulan `bulan_akhir` yang diambil pada `waktu` masih boleh dipakai: diambil hari ini, atau diambil setelah bulan itu
    tutup (mulai tanggal 1 dua bulan sesudahnya, saat tagihan transporter bulan itu sudah masuk). Contoh: Sep 2026 final kalau
    diambil mulai 1 Nov 2026; Okt dan Nov 2026 pada 19 Nov 2026 hanya kalau diambil hari ini."""
    if waktu is None:
        return False
    return waktu.date() == hari or waktu >= datetime.combine(bulan_tambah(bulan_akhir, 2), datetime.min.time())


def laporan_boleh_dipakai(meta: dict, hari: date) -> bool:
    """Laporan yang sudah ada di View Report dipakai (tidak diminta lagi) kalau FINISHED dan masih segar (lihat segar())."""
    if "FINISH" not in meta.get("status", "") or "bulan" not in meta:
        return False
    return segar(meta["bulan"], meta.get("mulai"), hari)


def kirim_selesai(page: Page, menu: str) -> None:
    jejak(page, f"sebelum_submit_{menu}")
    PESAN_ERP.clear()
    page.get_by_role("button", name="Submit").click()
    page.wait_for_timeout(1500)
    try:
        page.get_by_role("button", name="OK").click(timeout=15_000)
    except PWTimeout:
        print(f"  {menu}: tidak ada tombol OK setelah Submit, lanjut. Halaman: {jejak(page, f'setelah_submit_{menu}')}")
    if PESAN_ERP:
        jejak(page, f"setelah_submit_{menu}")
    pesan_erp = " | ".join(PESAN_ERP)
    # pesan pop-up yang jelas menolak (antrian penuh, gagal, ...): dianggap submit gagal → dicoba lagi 1 menit kemudian
    if pesan_erp and not re.search(r"berhasil|sukses|success|submitted|telah di", pesan_erp, re.I) and \
            re.search(r"penuh|full|maks|max|limit|gagal|fail|error|tidak dapat|tidak bisa|cannot|invalid|wajib|harus", pesan_erp, re.I):
        raise SystemExit(f"ERP menolak: {pesan_erp}")
    print(f"  {menu}: job dikirim" + (f" (pesan ERP: {pesan_erp})" if pesan_erp else ""))


def kirim_job(page: Page, menu: str, dari: date, sampai: date) -> None:
    buka_form(page, menu, "#ContentPlaceHolder1_txtDODate")
    isi_tanggal(page, "#ContentPlaceHolder1_txtDODate", dari)
    isi_tanggal(page, "#ContentPlaceHolder1_txtEndDODate", sampai)
    a = page.locator("#ContentPlaceHolder1_txtDODate").input_value()
    b = page.locator("#ContentPlaceHolder1_txtEndDODate").input_value()
    print(f"  {menu}: tanggal terisi '{a}' s.d. '{b}'")
    page.locator("#ContentPlaceHolder1_ddMatrix").select_option(MATRIX)
    kirim_selesai(page, menu)


def kirim_j073(page: Page, dist: str, dari: date, sampai: date) -> None:
    """J073 per distributor, format TXT. Distributor dipilih dulu (pilihan ini bisa memuat ulang halaman)."""
    buka_form(page, "J073", "#ContentPlaceHolder1_ddDist")
    nilai = pilih_dist(page, "#ContentPlaceHolder1_ddDist", dist)
    # format file TXT (di rekaman: klik sel "TXT")
    radio = page.locator("input[type=radio][value*='TXT' i]")
    if radio.count():
        radio.first.check()
    elif page.get_by_label("TXT", exact=True).count():
        page.get_by_label("TXT", exact=True).first.check()
    else:
        page.get_by_role("cell", name="TXT", exact=True).first.click()
    isi_tanggal(page, "#ContentPlaceHolder1_txtPeriodeFrom", dari)
    akhir = page.locator("#ContentPlaceHolder1_txtPeriodeTo")
    if akhir.count():
        isi_tanggal(page, "#ContentPlaceHolder1_txtPeriodeTo", sampai)
    a = page.locator("#ContentPlaceHolder1_txtPeriodeFrom").input_value()
    b = akhir.input_value() if akhir.count() else "(tidak ada kolom akhir)"
    pilih = page.locator("#ContentPlaceHolder1_ddDist").input_value()
    if pilih != nilai:
        raise SystemExit(f"J073: distributor {dist} tidak terpilih (terpilih: {pilih}).\nHalaman: {jejak(page, f'j073_{dist}')}")
    print(f"  J073 {dist}: periode '{a}' s.d. '{b}'")
    kirim_selesai(page, f"J073_{dist}")


def pilih_dist(page: Page, selector: str, dist: str) -> str:
    """Pilih distributor di dropdown ERP: nilai pilihan sama dengan kode (4094, 1001K), atau kode tertulis utuh di teksnya
    (4403 tidak tertukar dengan 4403B). Pilihan ini bisa memuat ulang halaman."""
    el = page.locator(selector)
    el.wait_for(timeout=15_000)
    opsi = el.evaluate("s => [...s.options].map(o => [o.value, o.text])")
    kode = dist.strip().upper()
    nilai = next((v for v, _ in opsi if v.strip().upper() == kode), None)
    if nilai is None:
        nilai = next((v for v, t in opsi if re.search(rf"(?<![0-9A-Z]){re.escape(kode)}(?![0-9A-Z])", t.upper())), None)
    if nilai is None:
        raise SystemExit(f"Distributor {dist} tidak ada di pilihan ERP.\nHalaman: {jejak(page, f'dist_{dist}')}")
    el.select_option(nilai)
    try:
        page.wait_for_load_state("networkidle", timeout=30_000)
    except PWTimeout:
        pass
    return nilai


def jendela_3bulan(dari: date, sampai: date) -> list[tuple[date, date]]:
    """Rentang J073 paling panjang 3 bulan kalender: 2025-01-01..2025-03-31, 2025-04-01..2025-06-30, ..."""
    hasil, a = [], dari
    while a <= sampai:
        y, m = a.year + (a.month + 1) // 12, (a.month + 1) % 12 + 1      # bulan ketiga dari a
        akhir = date(y, m, 1) + timedelta(days=32)
        b = min(sampai, akhir.replace(day=1) - timedelta(days=1))
        hasil.append((a, b))
        a = b + timedelta(days=1)
    return hasil


def awal_bulan(d: date, mundur: int = 0) -> date:
    k = d.year * 12 + d.month - 1 - mundur
    return date(k // 12, k % 12 + 1, 1)


def format_periode(contoh: str, bulan: date) -> str:
    """Isi kolom Periode ORDB019 mengikuti bentuk isian bawaan ERP (mis. "NOV2026", "Nov 2026", "11/2026", "01 Nov 2026")."""
    s = (contoh or "").strip()
    en = BULAN_EN[bulan.month - 1]
    besar = not s or s[:1].isdigit() or s[:3].isupper()
    nama = en.upper() if besar else en
    y = bulan.year
    if re.fullmatch(r"[A-Za-z]{3}\d{4}", s) or not s:
        return f"{nama}{y}"
    m = re.fullmatch(r"[A-Za-z]{3}([ -])\d{4}", s)
    if m:
        return f"{nama}{m.group(1)}{y}"
    if re.fullmatch(r"[A-Za-z]{4,}\s\d{4}", s):
        import calendar
        n = calendar.month_name[bulan.month]
        return f"{n.upper() if s.isupper() else n} {y}"
    if re.fullmatch(r"\d{1,2}/\d{4}", s):
        return f"{bulan.month:02d}/{y}"
    if re.fullmatch(r"\d{4}-\d{2}", s):
        return f"{y}-{bulan.month:02d}"
    if re.fullmatch(r"\d{4}\d{2}", s):
        return f"{y}{bulan.month:02d}"
    if re.fullmatch(r"\d{2}/\d{2}/\d{4}", s):
        return f"01/{bulan.month:02d}/{y}"
    if re.fullmatch(r"\d{1,2} [A-Za-z]{3} \d{4}", s):
        return tanggal_erp(bulan)
    return f"{nama}{y}"


def kirim_ordb(page: Page, dist: str, bulan: date) -> None:
    """Laporan ORDB019 satu distributor satu bulan: Submit Report → ORDB019 → distributor → Periode → Submit → OK."""
    page.goto(f"{ERP}/SYS_Submit_Report.aspx")
    try:
        page.wait_for_load_state("networkidle", timeout=30_000)
    except PWTimeout:
        pass
    dd = page.locator("#ContentPlaceHolder1_ddDist")
    if not dd.count():
        tautan = page.get_by_role("link", name=re.compile(r"ORDB019", re.I))
        if not tautan.count():
            tautan = page.locator("a").filter(has_text=re.compile(r"ORDB019", re.I))
        try:
            tautan.first.click(timeout=15_000)
            dd.wait_for(timeout=20_000)
        except PWTimeout:
            page.goto(f"{ERP}/SYS_Report_ORDB019.aspx")
            try:
                dd.wait_for(timeout=15_000)
            except PWTimeout:
                raise SystemExit(f"Halaman ORDB019 tidak bisa dibuka.\nHalaman: {jejak(page, 'menu_ORDB019')}")
    nilai = pilih_dist(page, "#ContentPlaceHolder1_ddDist", dist)
    per = page.locator("#ContentPlaceHolder1_txtPeriode")
    try:
        per.wait_for(timeout=10_000)
    except PWTimeout:
        page.goto(f"{ERP}/SYS_Report_ORDB019.aspx")       # seperti rekaman: setelah memilih distributor, buka halaman laporannya
        try:
            per.wait_for(timeout=15_000)
        except PWTimeout:
            raise SystemExit(f"Kolom Periode ORDB019 tidak ada.\nHalaman: {jejak(page, f'ORDB019_{dist}')}")
        if dd.count() and dd.input_value() != nilai:
            pilih_dist(page, "#ContentPlaceHolder1_ddDist", dist)
    isi = format_periode(per.input_value(), bulan)
    per.click()
    per.fill(isi)
    per.press("Tab")
    if dd.count() and dd.input_value() != nilai:
        raise SystemExit(f"ORDB019: distributor {dist} tidak terpilih (terpilih: {dd.input_value()}).\nHalaman: {jejak(page, f'ORDB019_{dist}')}")
    print(f"  ORDB019 {dist}: periode '{per.input_value()}'")
    kirim_selesai(page, f"ORDB019_{dist}_{bulan:%Y%m}")


PESAN_ERP: list[str] = []          # pesan pop-up (alert) dari ERP; tanpa ini Playwright menutupnya diam-diam


def _dialog(d) -> None:
    PESAN_ERP.append(d.message.strip())
    print(f"  pesan ERP: {d.message.strip()}")
    try:
        d.accept()
    except Exception:  # noqa: BLE001
        pass


def buka_browser(pw, tampil: bool):
    browser = pw.chromium.launch(channel=KANAL, headless=not tampil)
    ctx = browser.new_context(accept_downloads=True)
    page = ctx.new_page()
    page.on("dialog", _dialog)
    try:
        # tanpa cache browser: View Job / View Report selalu diambil baru dari server
        ctx.new_cdp_session(page).send("Network.setCacheDisabled", {"cacheDisabled": True})
    except Exception:  # noqa: BLE001 - bukan Chromium / Edge
        pass
    return browser, ctx, page


def ambil_subdist(page: Page, bulan: date) -> list[list[str]]:
    """Baris tabel Sub Distributor Monthly Sales Summary: [distributor "S006 - Nama", sub kategori, ton]."""
    target = f"{BULAN_EN[bulan.month - 1]} {bulan.year}"
    page.goto(f"{ERP}/{SUBDIST_HALAMAN}")
    grup = page.locator("#ContentPlaceHolder1_ddProductGroup")
    try:
        grup.wait_for(timeout=30_000)
    except PWTimeout:
        raise SystemExit(f"Halaman Sub Distributor tidak bisa dibuka.\nHalaman: {jejak(page, 'subdist_halaman')}")

    # kolom Periode: isinya "Nov 2026"; diganti hanya kalau bulannya berbeda
    periode = None
    for f in page.locator("input[type=text]").all():
        if re.fullmatch(r"[A-Za-z]{3} \d{4}", (f.input_value() or "").strip()):
            periode = f
            break
    if periode is None:
        raise SystemExit(f"Kolom Periode tidak ditemukan.\nHalaman: {jejak(page, 'subdist_periode')}")
    if periode.input_value().strip() != target:
        periode.click()
        periode.fill(target)
        periode.press("Tab")
    grup.select_option(SUBDIST_GRUP)
    tampilan = page.locator("select").filter(has=page.locator("option", has_text=re.compile(r"^\s*TON\s*$")))
    if tampilan.count():
        tampilan.first.select_option(label="TON")
    page.get_by_role("button", name="Search").click()
    try:
        page.wait_for_load_state("networkidle", timeout=60_000)
    except PWTimeout:
        pass

    # pastikan hasil yang tampil memang untuk bulan yang diminta (baris "Criteria --> Periode: 'Nov 2026'")
    teks = page.locator("body").inner_text()
    if f"Periode: '{target}'" not in teks:
        raise SystemExit(f"Hasil ERP bukan untuk periode {target} (isian Periode mungkin ditolak).\nHalaman: {jejak(page, 'subdist_periode')}")
    if "'TON'" not in teks:
        raise SystemExit(f"Hasil ERP tidak dalam TON.\nHalaman: {jejak(page, 'subdist_view')}")

    # tabel bisa terbagi beberapa halaman ("Page 1 of 2"): baca semua halaman
    data = baris_subdist(page)
    jumlah = halaman_subdist(page)
    for i in range(2, jumlah + 1):
        pertama = data_pertama(page)
        pager(page).select_option(str(i))
        batas = time.time() + 60
        while time.time() < batas:          # tunggu halaman benar-benar berganti
            time.sleep(1)
            try:
                if pager(page).input_value() == str(i) and data_pertama(page) != pertama:
                    break
            except Exception:  # noqa: BLE001 - halaman sedang dimuat ulang
                pass
        else:
            raise SystemExit(f"Halaman {i} tabel Sub Distributor tidak terbuka.\nHalaman: {jejak(page, 'subdist_halaman_' + str(i))}")
        try:
            page.wait_for_load_state("networkidle", timeout=30_000)
        except PWTimeout:
            pass
        data += baris_subdist(page)

    # cocokkan dengan Grand Total ERP supaya tidak ada baris yang tertinggal atau terbaca dua kali
    gt = re.search(r"Grand Total\s*:?\s*([\d.,]+)", page.locator("body").inner_text())
    total = sum(float(r[2].replace(",", "")) for r in data if re.fullmatch(r"-?[\d,]+(\.\d+)?", r[2]))
    if gt:
        grand = float(gt.group(1).replace(",", ""))
        if abs(grand - total) > 0.05:
            raise SystemExit(f"{target}: jumlah baris terbaca {total:,.2f} tidak sama dengan Grand Total ERP {grand:,.2f}.\nHalaman: {jejak(page, 'subdist_total')}")
    print(f"  {target}: {len(data)} baris dari {jumlah} halaman, total {total:,.2f} ton")
    RINGKAS_SUBDIST.append(f"{BULAN_EN[bulan.month - 1]} {total:,.2f} ton")
    return data


def baris_subdist(page: Page) -> list[list[str]]:
    baris = page.evaluate("() => [...document.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.innerText.trim()))")
    return [[re.sub(r"\s+", " ", b[0]), b[1], b[-1]] for b in baris if len(b) >= 3 and re.match(r"^[A-Za-z]{1,3}\d{2,5}\s*-", b[0])]


def data_pertama(page: Page) -> str:
    b = baris_subdist(page)
    return "|".join(b[0]) if b else ""


def pager(page: Page):
    """Pilihan halaman tabel: select yang isinya 1, 2, ..., N."""
    for sel in page.locator("select").all():
        nilai = [o.strip() for o in sel.locator("option").all_inner_texts()]
        if nilai and nilai == [str(k) for k in range(1, len(nilai) + 1)]:
            return sel
    return None


def halaman_subdist(page: Page) -> int:
    p = pager(page)
    return p.locator("option").count() if p is not None else 1


def tiro_sesi() -> Path:
    return DASAR / "tiro_sesi.json"


def tiro_sudah_masuk(page: Page) -> bool:
    """Login berhasil kalau tidak di halaman login lagi DAN kotak email sudah tidak ada."""
    try:
        if "login.aspx" in page.url.lower():
            return False
        return page.get_by_role("textbox", name="Email Address").count() == 0
    except Exception:  # noqa: BLE001 - halaman mungkin sedang pindah
        return False


def tiro_login(pw, user: str, pwd: str):
    """Login TIRO setengah otomatis: email dan password diisi, captcha DIKETIK PENGGUNA, lalu sesi disimpan.
    Jendela browser selalu tampil karena butuh orang. Mengembalikan (browser, context, page) yang sudah login."""
    browser = pw.chromium.launch(channel=KANAL, headless=False)
    ctx = browser.new_context(accept_downloads=True)
    page = ctx.new_page()
    page.on("dialog", _dialog)
    page.goto(f"{TIRO}/Pages/login.aspx")
    page.get_by_role("textbox", name="Email Address").fill(user)
    page.get_by_role("textbox", name="Password").fill(pwd)
    page.locator("#txtVerify").click()
    page.bring_to_front()
    print(f"@@TIRO_LOGIN Ketik kode captcha di jendela TIRO lalu klik Masuk (ditunggu {TIRO_TUNGGU_MENIT} menit).")
    # tunggu sampai benar-benar masuk; tidak bergantung pada perubahan alamat saja (lebih tahan)
    batas = time.time() + TIRO_TUNGGU_MENIT * 60
    while time.time() < batas:
        if tiro_sudah_masuk(page):
            ctx.storage_state(path=str(tiro_sesi()))
            print("  login TIRO berhasil, sesi disimpan")
            return browser, ctx, page
        page.wait_for_timeout(1000)
    teks = ""
    try:
        teks = " ".join(b.strip() for b in page.locator("body").inner_text().splitlines() if b.strip())[:300]
    except Exception:  # noqa: BLE001
        pass
    alamat = jejak(page, "tiro_login_gagal")
    browser.close()
    raise SystemExit(f"Login TIRO belum berhasil dalam {TIRO_TUNGGU_MENIT} menit. Kalau captcha sudah diketik tapi tetap begini, "
                     f"TIRO mungkin menolak. Pesan di halaman: {teks or '(tidak ada)'}\nHalaman: {alamat}")


def tiro_buka(pw, tampil: bool):
    """Pakai sesi TIRO yang tersimpan; kalau sudah habis, minta login (captcha diketik pengguna)."""
    if tiro_sesi().exists():
        browser = pw.chromium.launch(channel=KANAL, headless=not tampil)
        ctx = browser.new_context(accept_downloads=True, storage_state=str(tiro_sesi()))
        page = ctx.new_page()
        page.on("dialog", _dialog)
        page.goto(f"{TIRO}/{TIRO_LAPORAN}")
        if tiro_sudah_masuk(page):
            print("  sesi TIRO masih aktif")
            return browser, ctx, page
        browser.close()
        print("  sesi TIRO sudah habis, perlu login lagi")
    user = rahasia("TIRO_USER", "Email TIRO")
    pwd = rahasia("TIRO_PASS", "Password TIRO (tidak tampil)", tersembunyi=True)
    browser, ctx, page = tiro_login(pw, user, pwd)
    page.goto(f"{TIRO}/{TIRO_LAPORAN}")
    return browser, ctx, page


def isi_date_start(page: Page, d: date) -> str:
    """Kolom Date Start: diketik dengan format yang sama dengan isinya sekarang; kalau ditolak, lewat kalender."""
    kotak = page.get_by_role("textbox", name="Date Start")
    lama = (kotak.input_value() or "").strip()
    pola = [(r"\d{2}/\d{2}/\d{4}", "%d/%m/%Y"), (r"\d{4}-\d{2}-\d{2}", "%Y-%m-%d"), (r"\d{2}-\d{2}-\d{4}", "%d-%m-%Y"),
            (r"\d{2} [A-Za-z]{3} \d{4}", "%d %b %Y"), (r"\d{2}-[A-Za-z]{3}-\d{4}", "%d-%b-%Y")]
    fmt = next((f for r, f in pola if re.fullmatch(r, lama)), None)
    if fmt:
        teks = d.strftime(fmt.replace("%b", BULAN_EN[d.month - 1]))
        kotak.fill(teks)
        kotak.press("Tab")
        page.keyboard.press("Escape")
        if (kotak.input_value() or "").strip() == teks:
            return teks
    # lewat kalender seperti di rekaman: judul bulan -> pilih bulan -> tanggal
    kotak.click()
    page.get_by_role("columnheader", name=re.compile("Toggle")).first.click()
    page.get_by_text(BULAN_EN[d.month - 1], exact=True).first.click()
    hari = page.locator("td:not(.old):not(.new):not(.disabled)").filter(has_text=re.compile(rf"^\s*{d.day}\s*$"))
    hari.first.click()
    return (kotak.input_value() or "").strip()


def tiro_unduh(page: Page, jenis: list[str], dari: date) -> dict[str, Path]:
    """Laporan Transaksi TIRO, Generate Excel per jenis (Pengiriman = Sell In, Tanggal Pemesanan = OS DO)."""
    hasil: dict[str, Path] = {}
    FOLDER.mkdir(exist_ok=True)
    for kode in jenis:
        radio, nama = TIRO_JENIS[kode]
        if TIRO_LAPORAN not in page.url:
            page.goto(f"{TIRO}/{TIRO_LAPORAN}")
        page.get_by_role("radio", name=radio).check()
        awal = isi_date_start(page, dari)
        akhir = page.get_by_role("textbox", name="Date End")
        print(f"  {nama}: {radio}, Date Start '{awal}'" + (f" s.d. '{akhir.input_value()}'" if akhir.count() else ""))
        jejak(page, f"tiro_sebelum_{nama}")
        with page.expect_download(timeout=15 * 60_000) as info:
            page.get_by_role("button", name="Generate Excel").click()
        d = info.value
        tujuan = FOLDER / f"TIRO_{nama}_{date.today():%Y%m%d}{Path(d.suggested_filename).suffix or '.xlsx'}"
        d.save_as(tujuan)
        hasil[kode] = tujuan
        print(f"  terunduh: {tujuan.name}")
    return hasil


DOFAS_FILE_BAWAAN = r"\\b186\korin\TAHUN {tahun}\1. REKAP DO HARIAN {tahun}.xlsx"


def teks_dofas(tahun: int) -> str:
    """Rekap DO harian (Excel di folder bersama) -> teks tempelan DO FAS: Tipe | Area | Distributor | Keterangan | 1..12.
    Baris judul yang terulang dan baris total (distributor kosong) dibuang."""
    import shutil
    import tempfile

    import openpyxl
    sumber = Path((os.environ.get("DOFAS_FILE", "").strip() or DOFAS_FILE_BAWAAN).replace("{tahun}", str(tahun)))
    if not sumber.exists():
        raise SystemExit(f"File DO FAS tidak ditemukan: {sumber}. Cek jaringan ke folder bersama atau alamat file di Pengaturan.")
    # salin dulu: file yang sedang dibuka orang lain di Excel tetap bisa dibaca
    salinan = Path(tempfile.gettempdir()) / f"nat_dofas_{os.getpid()}.xlsx"
    shutil.copyfile(sumber, salinan)
    try:
        wb = openpyxl.load_workbook(salinan, read_only=True, data_only=True)
        nilai = lambda v: "" if v is None else (f"{v:g}" if isinstance(v, float) else str(v)).strip()   # noqa: E731
        for ws in wb.worksheets:
            baris = [[nilai(v) for v in r] for r in ws.iter_rows(values_only=True)]
            judul = next((i for i, r in enumerate(baris[:40])
                          if {"distributor", "keterangan"} <= {c.lower() for c in r} and all(str(k) in r for k in range(1, 13))), None)
            if judul is None:
                continue
            kepala = [c.lower() for c in baris[judul]]
            i_dist = kepala.index("distributor")
            i_bulan = [baris[judul].index(str(k)) for k in range(1, 13)]
            keluar = ["\t".join(baris[judul])]
            for r in baris[judul + 1:]:
                r = r + [""] * (len(baris[judul]) - len(r))
                dist = r[i_dist]
                ada_angka = any(r[j] not in ("", "-", "0") for j in i_bulan)
                if dist.lower() == "distributor":           # judul kolom yang terulang (mis. di atas bagian RJW)
                    continue
                if not dist and ada_angka:                  # baris total
                    continue
                if any(r):
                    keluar.append("\t".join(r[:len(baris[judul])]))
            print(f"  DO FAS: {sumber.name}, sheet '{ws.title}', {len(keluar) - 1} baris")
            return "\n".join(keluar) + "\n"
        raise SystemExit(f"Tabel DO FAS (judul Distributor, Keterangan, 1..12) tidak ditemukan di {sumber.name}.")
    finally:
        try:
            salinan.unlink()
        except OSError:
            pass


STOCK_FILE_BAWAAN = r"\\b236\File {tahun}\Stock\{bulan} {tahun}\Stock Semen {bulan} {tahun}.xlsx"
# nama bulan di folder stok: singkatan Indonesia; ejaan lain ikut dicoba
BULAN_STOK = [["JAN"], ["FEB", "PEB"], ["MAR"], ["APR"], ["MEI", "MAY"], ["JUN"], ["JUL"], ["AGU", "AGS", "AGT", "AUG"],
              ["SEP"], ["OKT", "OCT"], ["NOV", "NOP"], ["DES", "DEC"]]


def alamat_stok(bulan: date, pola: str = "") -> list[Path]:
    """Calon alamat file stok satu bulan ({tahun} dan {bulan} diganti), ejaan bulan utama lebih dulu."""
    pola = pola or os.environ.get("STOCK_FILE", "").strip() or STOCK_FILE_BAWAAN
    return [Path(pola.replace("{tahun}", str(bulan.year)).replace("{bulan}", b)) for b in BULAN_STOK[bulan.month - 1]]


def cari_stok(bulan: date, pola: str = "") -> Path | None:
    """File stok satu bulan. Kalau nama file persis tidak ada tetapi foldernya ada, pakai file .xlsx berisi kata 'stock'."""
    calon = alamat_stok(bulan, pola)
    for p in calon:
        try:
            if p.is_file():
                return p
        except OSError:
            pass
    for p in calon:
        try:
            if p.parent.is_dir():
                ada = sorted((f for f in p.parent.glob("*.xlsx") if "stock" in f.name.lower() and not f.name.startswith("~$")),
                             key=lambda f: f.stat().st_mtime, reverse=True)
                if ada:
                    return ada[0]
        except OSError:
            pass
    return None


def berkas_stok(hari: date) -> list[Path]:
    """Salinan lokal file stok bulan berjalan (dan bulan lalu pada tanggal 1-3). Nama file asli dipertahankan
    karena web memakai nama bulan di nama file kalau judul sheet tidak memuat tanggal."""
    import shutil
    import tempfile
    bulan = [hari.replace(day=1)]
    if hari.day <= 3:
        bulan.insert(0, (hari.replace(day=1) - timedelta(days=1)).replace(day=1))
    keluar: list[Path] = []
    tmp = Path(tempfile.gettempdir()) / f"nat_stock_{os.getpid()}"
    tmp.mkdir(exist_ok=True)
    for b in bulan:
        sumber = cari_stok(b)
        if sumber is None:
            if b.month == hari.month:
                raise SystemExit(f"File stok {BULAN_STOK[b.month - 1][0]} {b.year} tidak ditemukan: {alamat_stok(b)[0]}. "
                                 "Cek jaringan ke folder bersama atau alamat file di Pengaturan.")
            print(f"  file stok {BULAN_STOK[b.month - 1][0]} {b.year} tidak ditemukan, dilewati")
            continue
        salinan = tmp / sumber.name                 # disalin: file yang sedang dibuka di Excel tetap bisa dibaca
        shutil.copyfile(sumber, salinan)
        print(f"  Stock: {sumber}")
        keluar.append(salinan)
    return keluar


def teks_subdist(page: Page, daftar_bulan: list[date]) -> dict[int, str]:
    """Teks tempelan Sub ERP per tahun: blok "NOVEMBER" lalu baris distributor | sub kategori | ton."""
    per_tahun: dict[int, list[str]] = {}
    for b in daftar_bulan:
        data = ambil_subdist(page, b)
        if not data:
            print(f"  {BULAN_ID[b.month - 1]} {b.year}: belum ada data, dilewati")
            continue
        per_tahun.setdefault(b.year, []).append("\n".join([BULAN_ID[b.month - 1]] + ["\t".join(r) for r in data]))
    hasil = {th: "\n".join(blok) + "\n" for th, blok in per_tahun.items()}
    FOLDER.mkdir(exist_ok=True)
    for th, teks in hasil.items():
        (FOLDER / f"subdist_{th}.txt").write_text(teks, encoding="utf-8")   # salinan untuk dicek
    return hasil


def pesan(e: BaseException) -> str:
    return str(getattr(e, "code", None) or e).strip()


class Hasil:
    """Hasil dari ERP, dan bagian yang gagal (bagian lain tetap jalan)."""
    def __init__(self) -> None:
        self.j028: list[Path] = []
        self.j073: list[Path] = []
        self.ongkos: list[tuple[Path, dict]] = []     # (file, kiriman) J073 / ORDB019 untuk Ongkos Kirim
        self.tiro: dict[str, Path] = {}
        self.dofas: dict[int, str] = {}
        self.stock: list[Path] = []
        self.harga: Path | None = None               # CSV harga Loco
        self.harga_status: dict[str, str] = {}
        self.harga_ringkas = ""       # masa berlaku terakhir per PT|produk (disimpan setelah upload berhasil)
        self.subdist: dict[int, str] = {}
        self.gagal: dict[str, str] = {}
        self.berhasil: dict[str, str] = {}

    def catat_gagal(self, bagian: str, e: BaseException) -> None:
        self.gagal[bagian] = pesan(e)
        print(f"  {bagian} GAGAL: {self.gagal[bagian]}")


def kiriman_ongkos(hari: date, dists: list[str], mulai: date | None = None) -> list[dict]:
    """Daftar job / laporan Ongkos Kirim. Bawaan: J073 bulan ini + 2 bulan sebelumnya (satu job, batas 3 bulan ERP) dan
    ORDB019 bulan lalu + bulan ini. Isi ulang (mulai): J073 per 3 bulan dan ORDB019 per bulan sejak `mulai`."""
    hasil = []
    for d in dists:
        jendela = jendela_3bulan(mulai, hari) if mulai else [(awal_bulan(hari, 2), hari)]
        for a, b in jendela:
            hasil.append({"jenis": "J073", "dist": d, "dari": a, "sampai": b, "kunci": f"J073|{d}|{a}|{b if mulai is None or b < awal_bulan(hari) else 'kini'}"})
        bulan = []
        if mulai:
            m = mulai.replace(day=1)
            while m <= hari:
                bulan.append(m)
                m = awal_bulan(m + timedelta(days=32))
        else:
            # bulan ini dan bulan lalu (masih berubah) + dua bulan lalu sekali lagi setelah tutup, kalau salinan finalnya belum ada
            bulan = [awal_bulan(hari, 1), awal_bulan(hari)]
            if not file_ordb_lokal(d, awal_bulan(hari, 2), hari):
                bulan.insert(0, awal_bulan(hari, 2))
        for m in bulan:
            hasil.append({"jenis": "ORDB", "dist": d, "bulan": m, "kunci": f"ORDB|{d}|{m:%Y-%m}"})
    # urut per bulan lalu per distributor: semua distributor maju bersama, bukan satu distributor sampai habis dulu
    urut = {d: i for i, d in enumerate(dists)}
    return sorted(hasil, key=lambda k: (k.get("dari") or k["bulan"], k["jenis"] != "J073", urut[k["dist"]]))


def cek_rentang_ongkos(dari: date, sampai: date | None, dist: str | None) -> tuple[date, list[str]]:
    """Rentang pilihan Ongkos kirim: paling panjang 3 bulan kalender (batas J073 di ERP), tidak lewat hari ini."""
    hari = date.today()
    batas = jendela_3bulan(dari, dari.replace(year=dari.year + 1, day=1))[0][1]   # akhir bulan ketiga dari bulan awal
    sampai = sampai or min(batas, hari)
    if sampai < dari:
        raise ValueError("Ongkos kirim: tanggal akhir sebelum tanggal awal.")
    if sampai > batas:
        raise ValueError(f"Ongkos kirim: paling panjang 3 bulan (dari {dari} paling jauh s.d. {batas}).")
    if dari > hari:
        raise ValueError("Ongkos kirim: tanggal awal setelah hari ini.")
    dists = [k.strip().upper() for k in (dist or "").split(",") if k.strip()] or ongkos_dist()
    return min(sampai, hari), [d for d in dists if d != "4094E"] or ["4094"]


def kiriman_rentang(dari: date, sampai: date, dists: list[str]) -> list[dict]:
    """Rentang pilihan: satu J073 per distributor untuk dari..sampai, ORDB019 tiap bulan di rentang itu."""
    hasil = []
    for d in dists:
        hasil.append({"jenis": "J073", "dist": d, "dari": dari, "sampai": sampai, "kunci": f"J073|{d}|{dari}|{sampai}"})
        m = dari.replace(day=1)
        while m <= sampai:
            hasil.append({"jenis": "ORDB", "dist": d, "bulan": m, "kunci": f"ORDB|{d}|{m:%Y-%m}"})
            m = awal_bulan(m + timedelta(days=32))
    return hasil


# ---------- salinan lokal J073 / ORDB019 (ONGKOS_FOLDER) ----------
def folder_file() -> Path:
    """Folder salinan J073 / ORDB019 (bawaan FOLDER_FILE_BAWAAN). Kalau tidak bisa dibuat (mis. tidak ada drive
    D:), dipakai folder unduhan\\Auto Task File."""
    p = Path(os.environ.get("ONGKOS_FOLDER") or FOLDER_FILE_BAWAAN)
    try:
        p.mkdir(parents=True, exist_ok=True)
        return p
    except OSError:
        q = FOLDER / "Auto Task File"
        q.mkdir(parents=True, exist_ok=True)
        if not getattr(folder_file, "_diberitahu", False):
            print(f"  Folder {p} tidak bisa dibuat; salinan file disimpan di {q}")
            folder_file._diberitahu = True
        return q


def path_ordb(dist: str, bulan: date) -> Path:
    return folder_file() / "ORDB019" / dist / f"ORDB019_{dist}_{bulan:%Y-%m}.XLS"


def path_j073(dist: str, a: date, b: date) -> Path:
    return folder_file() / "J073" / dist / f"J073_{dist}_{a:%Y%m%d}_{b:%Y%m%d}.TXT"


def waktu_file(p: Path) -> datetime:
    return datetime.fromtimestamp(p.stat().st_mtime)


def isi_ordb(p: Path) -> tuple[str, date] | None:
    """Distributor dan periode dari isi file ORDB019 (judul "DISTRIBUTOR : ... - 4094" dan "Periode : OCT2026")."""
    try:
        b = p.read_bytes()
    except OSError:
        return None
    for teks in (b, b.replace(b"\x00", b"")):          # teks biasa (BIFF8 ringkas) atau UTF-16
        d = re.search(rb"DISTRIBUTOR\s*:[^\r\n\x00-\x08]{0,120}-\s*([0-9A-Z]{3,8})(?![0-9A-Za-z])", teks)
        m = re.search(rb"Periode\s*:\s*([A-Za-z]{3})[A-Za-z]*\s*-?\s*(\d{4})", teks)
        if d and m and m.group(1).decode().capitalize() in BULAN_EN:
            return d.group(1).decode().upper(), date(int(m.group(2)), BULAN_EN.index(m.group(1).decode().capitalize()) + 1, 1)
    return None


def isi_j073(p: Path) -> str | None:
    """Kode distributor dari baris data pertama file J073 (.TXT, dipisah |). None kalau kosong / tidak terbaca."""
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            judul = f.readline().rstrip("\r\n").split("|")
            data = f.readline().rstrip("\r\n").split("|")
    except OSError:
        return None
    if "Distributor Code" not in judul or len(data) < len(judul) // 2:
        return None
    return data[judul.index("Distributor Code")].strip().upper() or None


def file_ordb_lokal(dist: str, bulan: date, hari: date) -> Path | None:
    p = path_ordb(dist, bulan)
    return p if p.exists() and segar(bulan, waktu_file(p), hari) else None


def file_j073_lokal(dist: str, a: date, b: date, hari: date) -> Path | None:
    """Salinan J073 yang mencakup a..b dan masih segar (bulan terakhirnya sudah tutup saat diunduh, atau diunduh hari ini)."""
    pilihan = []
    for p in (folder_file() / "J073" / dist).glob(f"J073_{dist}_*_*.TXT"):
        m = re.fullmatch(rf"J073_{re.escape(dist)}_(\d{{8}})_(\d{{8}})\.TXT", p.name, re.I)
        if not m:
            continue
        fa, fb = (datetime.strptime(x, "%Y%m%d").date() for x in m.groups())
        if fa <= a and fb >= b and segar(fb.replace(day=1), waktu_file(p), hari):
            pilihan.append(((fb - fa).days, p))
    return min(pilihan)[1] if pilihan else None


def cari_lokal(k: dict, hari: date) -> Path | None:
    return file_ordb_lokal(k["dist"], k["bulan"], hari) if k["jenis"] == "ORDB" else file_j073_lokal(k["dist"], k["dari"], k["sampai"], hari)


def simpan_lokal(f: Path, k: dict) -> tuple[Path, dict, str | None]:
    """Salin unduhan ke folder salinan dengan nama baku. Isi file diperiksa: kalau ternyata distributor / bulan lain,
    disimpan sesuai isinya dan dikembalikan sebagai kiriman itu, plus pesan."""
    import shutil
    pesan_salah = None
    if k["jenis"] == "ORDB":
        isi = isi_ordb(f)
        if isi and isi != (k["dist"].upper(), k["bulan"]):
            pesan_salah = f"isi laporan ternyata {isi[0]} {isi[1]:%Y-%m}, bukan {k['dist']} {k['bulan']:%Y-%m}"
            k = {**k, "dist": isi[0], "bulan": isi[1], "kunci": f"ORDB|{isi[0]}|{isi[1]:%Y-%m}"}
        tujuan = path_ordb(k["dist"], k["bulan"])
    else:
        isi = isi_j073(f)
        if isi and isi != k["dist"].upper():
            pesan_salah = f"isi J073 ternyata distributor {isi}, bukan {k['dist']}"
            k = {**k, "dist": isi, "kunci": f"J073|{isi}|{k['dari']}|{k['sampai']}"}
        tujuan = path_j073(k["dist"], k["dari"], k["sampai"])
    tujuan.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(f, tujuan)                  # waktu file = waktu unduh
    return tujuan, k, pesan_salah


def migrasi_unduhan() -> int:
    """Unduhan lama di folder unduhan (R…-ORDB019_4094_2025-06.XLS, J…-J073_4094_2025-01-2025-03.txt) disalin ke folder
    salinan supaya tidak diunduh lagi. ORDB019 dikenali dari isinya; waktu file aslinya dipertahankan."""
    import shutil
    n = 0
    if not FOLDER.exists():
        return 0
    for f in FOLDER.glob("R*-ORDB019_*.XLS"):
        isi = isi_ordb(f)
        if not isi:
            continue
        t = path_ordb(*isi)
        if not t.exists() or t.stat().st_mtime < f.stat().st_mtime:
            t.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, t)
            n += 1
    for f in FOLDER.glob("J*-J073_*.txt"):
        m = re.fullmatch(r"J\d+-J073_([0-9A-Z]+)_(\d{4})-(\d{2})-(\d{4})-(\d{2})\.txt", f.name, re.I)
        if not m or isi_j073(f) not in (None, m.group(1).upper()):
            continue
        a = date(int(m.group(2)), int(m.group(3)), 1)
        b = min(bulan_tambah(date(int(m.group(4)), int(m.group(5)), 1), 1) - timedelta(days=1), waktu_file(f).date())
        t = path_j073(m.group(1).upper(), a, b)
        if not t.exists():
            t.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, t)
            n += 1
    return n


def label_kiriman(k: dict) -> str:
    if k["jenis"] == "J073":
        return f"Ongkos kirim J073 {k['dist']} {k['dari']:%Y-%m}..{k['sampai']:%Y-%m}"
    return f"Ongkos kirim ORDB019 {k['dist']} {k['bulan']:%Y-%m}"


def ambil_erp(pw, bagian: set[str], dari: date, sampai: date, daftar_bulan: list[date], tampil: bool,
              ongkos: list[dict] | None = None) -> Hasil:
    """Satu kali login ERP. Job (View Job) dan laporan (View Report, ORDB019) dikirim bergiliran karena antrian ERP paling
    banyak MAKS_ANTRIAN sekaligus: J028 + J028B dulu, lalu J073 per distributor, lalu kiriman Ongkos Kirim, begitu ada tempat
    kosong. Sub ERP dibaca sambil menunggu."""
    h = Hasil()
    semua_ongkos = list(ongkos or [])
    # salinan lokal yang masih segar dipakai langsung: tidak diminta ke ERP, tidak diunduh lagi
    ongkos = []
    for k in semua_ongkos:
        p = cari_lokal(k, date.today())
        if p:
            h.ongkos.append((p, k))
        else:
            ongkos.append(k)
    if len(ongkos) < len(semua_ongkos):
        print(f"  Salinan lokal dipakai, tidak diunduh lagi: {len(semua_ongkos) - len(ongkos)} file ({folder_file()})")
    if not (bagian & {"J028", "J073", "SUBDIST"}) and not ongkos:
        return h
    user = rahasia("ERP_USER", "User ERP")
    pwd = rahasia("ERP_PASS", "Password ERP (tidak tampil)", tersembunyi=True)
    browser, ctx, page = buka_browser(pw, tampil)
    try:
        login_erp(page, user, pwd)
        lama = set(daftar_job(page))                 # job yang sudah ada sebelum kita mengirim
        lama_r: set[str] | None = None               # laporan lama: dibaca saat laporan pertama akan dikirim
        # antrean kiriman: dict(bagian, label, kode, jenis: job/laporan, kirim, ongkos)
        antre: list[dict] = []
        if "J028" in bagian:
            antre += [dict(bagian="J028", label="J028", kode="J028", jenis="job", kirim=lambda: kirim_job(page, "J028", dari, sampai)),
                      dict(bagian="J028", label="J028B", kode="J028B", jenis="job", kirim=lambda: kirim_job(page, "J028B", dari, sampai))]
        if "J073" in bagian:
            # distributor yang juga ada di Ongkos kirim tidak dikirim dua kali: J073 3 bulan ongkos sudah mencakup bulan ini
            dobel = {k["dist"].upper() for k in semua_ongkos if k["jenis"] == "J073" and k["sampai"] >= sampai and k["dari"] <= dari}
            antre += [dict(bagian="J073", label=f"J073 {d}", kode="J073", jenis="job", dist=d.upper(), kirim=(lambda d=d: kirim_j073(page, d, dari, sampai)))
                      for d in j073_dist() if d.upper() not in dobel]
        for k in ongkos:
            if k["jenis"] == "J073":
                antre.append(dict(bagian="ONGKOS", label=label_kiriman(k), kode="J073", jenis="job", ongkos=k, dist=k["dist"].upper(),
                                  kirim=(lambda k=k: kirim_j073(page, k["dist"], k["dari"], k["sampai"]))))
            else:
                antre.append(dict(bagian="ONGKOS", label=label_kiriman(k), kode="ORDB019", jenis="laporan", ongkos=k,
                                  kirim=(lambda k=k: kirim_ordb(page, k["dist"], k["bulan"]))))
        perlu_j028 = 2 if "J028" in bagian else 0
        subdist_selesai = "SUBDIST" not in bagian
        aktif: list[dict] = []                        # sudah dikirim, belum terunduh
        dikenal: set[str] = set()                     # ID yang sudah dipasangkan ke kiriman
        FOLDER.mkdir(exist_ok=True)
        batas = time.time() + TUNGGU_JOB_MENIT * 60   # diperpanjang setiap ada kemajuan

        def unduh(a: dict) -> dict | None:
            """Unduh file ID a["job"]. Mengembalikan kiriman yang selesai (biasanya a sendiri; untuk J073 bisa kiriman
            distributor lain kalau isi file ternyata miliknya, lalu a kembali menunggu job-nya sendiri). None = belum siap."""
            try:
                with page.expect_download(timeout=90_000) as info:
                    tautan = page.get_by_role("link", name=a["job"], exact=True)
                    if not tautan.count():
                        tautan = page.locator("a").filter(has_text=re.compile(rf"\b{a['job']}\b"))
                    tautan.first.click()
                d = info.value
                akhiran = Path(d.suggested_filename or "").suffix or (".XLS" if a["jenis"] == "laporan" else ".TXT")
                nama = a["label"].replace("Ongkos kirim ", "").replace(" ", "_").replace("..", "-")
                tujuan = FOLDER / f"{a['job']}-{nama}{akhiran}"
                d.save_as(tujuan)
            except PWTimeout:
                print(f"  {a['job']} belum siap, dicoba lagi")
                return None
            if a.get("kode") == "J073" and a.get("dist"):
                # View Job tidak selalu menyebut distributor: job dipasangkan menurut urutan kirim. Isi file yang menentukan.
                isi = isi_j073(tujuan)
                if isi and isi != a["dist"]:
                    pemilik = next((x for x in aktif if x is not a and x.get("kode") == "J073" and x.get("dist") == isi), None)
                    if pemilik:
                        print(f"  {a['job']} ternyata J073 {isi}, dipakai untuk kiriman {isi}; J073 {a['dist']} tetap ditunggu")
                        a["job"], pemilik["job"] = pemilik["job"], a["job"]
                        if a["job"] is None:
                            a["waktu"] = max(a["waktu"], time.time() - 60)
                        a = pemilik
            if a["bagian"] == "ONGKOS":
                # salinan bernama baku di folder salinan; isi file diperiksa (distributor / bulan)
                salinan, k, salah = simpan_lokal(tujuan, a["ongkos"])
                if salah:
                    h.catat_gagal(a["label"], SystemExit(f"{a['job']}: {salah}. File tetap disimpan dan diupload sesuai isinya."))
                h.ongkos.append((salinan, k))
                print(f"  terunduh: {tujuan.name} → {salinan}")
                return a
            else:
                (h.j073 if a["bagian"] == "J073" else h.j028).append(tujuan)
            print(f"  terunduh: {tujuan.name}")
            return a

        def cocok_laporan(a: dict, j: str) -> bool:
            """Laporan ORDB019 dicocokkan dengan distributor + periode di kolom Parameters; tanpa Parameters: urutan kirim."""
            m = LAPORAN_META.get(j, {})
            if "dist" in m and "bulan" in m:
                return m["dist"] == a["ongkos"]["dist"].upper() and m["bulan"] == a["ongkos"]["bulan"]
            return a["kode"] == daftar_kode.get(j, "") or not daftar_kode.get(j, "").startswith("ORDB")

        daftar_kode: dict[str, str] = {}

        def periksa(jenis: str, daftar: dict[str, tuple[str, str]]) -> bool:
            """Pasangkan ID baru dengan kiriman, unduh yang sudah selesai. Job: kode + urutan kirim; laporan: distributor + periode."""
            maju = False
            daftar_kode.update({j: k for j, (k, _) in daftar.items()})
            for j, (kode, _) in sorted(daftar.items()):
                if j in dikenal:
                    continue
                if jenis == "laporan":
                    k = next((a for a in aktif if a["jenis"] == "laporan" and a["job"] is None and cocok_laporan(a, j)), None)
                else:
                    m = LAPORAN_META.get(j, {})
                    calon = [a for a in aktif if a["jenis"] == jenis and a["job"] is None and a["kode"] == kode]
                    dikenal_dist = {d for d, _ in DAFTAR_DIST} | {d.upper() for d in j073_dist()}
                    if m.get("dist") and any(a.get("dist") for a in calon):
                        if m["dist"] in dikenal_dist:              # job distributor lain (mis. dikirim manual): bukan milik kiriman ini
                            calon = [a for a in calon if a.get("dist") == m["dist"]]
                    k = calon[0] if calon else None
                if k:
                    k["job"] = j
                    dikenal.add(j)
            for a in [x for x in aktif if x["jenis"] == jenis]:
                if a not in aktif:                       # sudah selesai lewat pertukaran file J073 di putaran ini
                    continue
                if a["job"] is None:
                    # sudah submit tapi belum muncul: View dicek tiap menit; setelah TUNGGU_MUNCUL_MENIT dianggap tidak
                    # diterima ERP, lalu submit ulang (paling banyak COBA_KIRIM kali)
                    batas_muncul = TUNGGU_MUNCUL_JOB_MENIT if jenis == "job" else TUNGGU_MUNCUL_MENIT
                    if time.time() - a["waktu"] > batas_muncul * 60:
                        tempat = "View Job" if jenis == "job" else "View Report"
                        if jenis == "laporan" and cari_semua_halaman(a):
                            maju = True                          # ketemu di halaman lain (dan sudah diunduh kalau selesai)
                            continue
                        aktif.remove(a)
                        maju = True
                        if a.get("muncul", 1) < COBA_MUNCUL:
                            print(f"  {a['label']}: {batas_muncul} menit belum muncul di {tempat}" + (" (semua halaman sudah diperiksa)" if jenis == "laporan" else "") + ", submit ulang sekali")
                            antre.insert(0, {k: v for k, v in a.items() if k not in ("waktu", "job")} | {"muncul": a.get("muncul", 1) + 1, "coba": 1, "siap": time.time()})
                        else:
                            h.catat_gagal(a["label"], SystemExit(f"{a['label']} tidak muncul di {tempat} setelah {COBA_MUNCUL} kali submit dan "
                                                                 f"{batas_muncul} menit menunggu. Lihat screenshot sebelum_submit di folder unduhan."))
                    continue
                if jenis == "laporan" and a["job"] not in daftar:
                    # sudah tergeser ke halaman berikutnya View Report: cari di sana
                    if cari_semua_halaman(a, a["job"]) and a not in aktif:
                        maju = True
                    continue
                status = daftar.get(a["job"], ("", ""))[1]
                if re.search(r"ERROR|FAIL|CANCEL", status):
                    h.catat_gagal(a["label"], SystemExit(f"{a['job']} berstatus {status} di ERP."))
                    aktif.remove(a)
                    maju = True
                    continue
                if status and "FINISH" not in status and "DONE" not in status and "SUCCESS" not in status:
                    continue
                selesai = unduh(a)
                if selesai:
                    aktif.remove(selesai)
                    maju = True
            return maju

        def job_baru(kode: str) -> str | None:
            """Job ID baru (bukan job lama sebelum mulai, belum dipasangkan) dengan kode ini; yang terkecil dulu."""
            daftar = daftar_job(page)
            baru = sorted(j for j, (kd, _) in daftar.items() if j not in lama and j not in dikenal and kd == kode)
            return baru[0] if baru else None

        def laporan_baru(k: dict, semua_halaman: bool = False) -> str | None:
            """Report ID baru (bukan laporan lama, belum dipasangkan) dengan DIST + PERIODE kiriman k; terlama dulu."""
            kunci_k = (k["ongkos"]["dist"].upper(), k["ongkos"]["bulan"])
            daftar, hal = daftar_laporan(page), 1
            while True:
                baru = sorted(j for j in daftar if j not in (lama_r or set()) and j not in dikenal
                              and (LAPORAN_META.get(j, {}).get("dist"), LAPORAN_META.get(j, {}).get("bulan")) == kunci_k)
                if baru:
                    return baru[0]
                if not semua_halaman or hal >= MAKS_HALAMAN_VIEW or not ke_halaman_view(page, hal + 1):
                    return None
                hal += 1
                daftar = baca_antrian(page, r"R\d{5,}")

        def konfirmasi(k: dict) -> str | None:
            """Tunggu ID baru untuk kiriman yang barusan disubmit muncul di View Job / View Report (tiap 15 detik)."""
            batas_k = time.time() + KONFIRMASI_JOB_DETIK
            while True:
                jid = job_baru(k["kode"]) if k["jenis"] == "job" else laporan_baru(k)
                if jid:
                    print(f"  tercatat di {'View Job' if k['jenis'] == 'job' else 'View Report'}: {jid}")
                    return jid
                if time.time() >= batas_k:
                    return None
                time.sleep(15)

        def cari_semua_halaman(a: dict, jid: str | None = None) -> bool:
            """Cari di semua halaman View Report: laporan dengan ID `jid`, atau (kalau jid kosong) laporan baru dengan
            distributor + periode kiriman `a`. Kalau ketemu dan sudah FINISHED, langsung diunduh di halaman itu."""
            kunci_cari = (a["ongkos"]["dist"].upper(), a["ongkos"]["bulan"])
            daftar, hal = daftar_laporan(page), 1
            while True:
                for j in sorted(daftar, reverse=True):
                    m = LAPORAN_META.get(j, {})
                    cocok = j == jid if jid else (j not in dikenal and j not in (lama_r or set()) and (m.get("dist"), m.get("bulan")) == kunci_cari)
                    if cocok:
                        if not jid:
                            a["job"] = j
                            dikenal.add(j)
                            print(f"  {a['label']}: ketemu di halaman {hal} View Report ({j})")
                        if "FINISH" in m.get("status", "") and unduh(a):
                            aktif.remove(a)                     # laporan: dicocokkan dari Parameters, tidak ditukar
                        elif re.search(r"ERROR|FAIL|CANCEL", m.get("status", "")):
                            h.catat_gagal(a["label"], SystemExit(f"{j} berstatus {m['status']} di ERP."))
                            aktif.remove(a)
                        return True
                if hal >= MAKS_HALAMAN_VIEW or not ke_halaman_view(page, hal + 1):
                    return False
                hal += 1
                daftar = baca_antrian(page, r"R\d{5,}")

        # 0. laporan ORDB019 yang sudah ada di View Report (dari jalan sebelumnya) langsung diunduh, tidak diminta lagi
        if any(k["jenis"] == "laporan" for k in antre):
            lama_r = set()
            butuh = {(k["ongkos"]["dist"].upper(), k["ongkos"]["bulan"]): k for k in antre if k["jenis"] == "laporan"}
            daftar = daftar_laporan(page)
            hal, dipakai = 1, 0
            while True:
                lama_r |= set(daftar)
                for j in sorted(daftar, reverse=True):          # yang terbaru dulu
                    m = LAPORAN_META.get(j, {})
                    k = butuh.get((m.get("dist"), m.get("bulan")))
                    if k and laporan_boleh_dipakai(m, date.today()) and unduh({**k, "job": j}):
                        butuh.pop((m["dist"], m["bulan"]))
                        antre.remove(k)
                        dipakai += 1
                if not butuh or hal >= MAKS_HALAMAN_VIEW or not ke_halaman_view(page, hal + 1):
                    break
                hal += 1
                daftar = baca_antrian(page, r"R\d{5,}")
            print(f"  View Report: {hal} halaman diperiksa, {dipakai} laporan ORDB019 sudah ada dan diunduh, {len(butuh)} diminta baru")

        while True:
            kunci_segarkan()
            # 1. isi antrian ERP sampai penuh (job dan laporan berbagi batas yang sama)
            dikirim = False
            while len(aktif) < MAKS_ANTRIAN:
                k = next((x for x in antre if x.get("siap", 0) <= time.time()), None)   # yang sedang menunggu coba ulang dilewati dulu
                if k is None:
                    break
                antre.remove(k)
                if k["jenis"] == "laporan" and lama_r is None:
                    lama_r = set(daftar_laporan(page))
                try:
                    if k.get("coba", 1) > 1 or k.get("muncul", 1) > 1:
                        # sebelum submit ulang: mungkin kiriman sebelumnya cuma telat tercatat (laporan: semua halaman dicari)
                        telat = job_baru(k["kode"]) if k["jenis"] == "job" else laporan_baru(k, semua_halaman=True)
                        if telat:
                            print(f"  {k['label']}: kiriman sebelumnya ternyata tercatat ({telat}), tidak submit ulang")
                            dikenal.add(telat)
                            aktif.append({**k, "waktu": time.time(), "job": telat})
                            dikirim = True
                            continue
                    k["kirim"]()
                    tempat = "View Job" if k["jenis"] == "job" else "View Report"
                    jid = konfirmasi(k)
                    if not jid:
                        raise SystemExit(f"tidak tercatat di {tempat} " + (f"{KONFIRMASI_JOB_DETIK // 60} menit" if KONFIRMASI_JOB_DETIK >= 120 else f"{KONFIRMASI_JOB_DETIK} detik") + " setelah submit")
                    dikenal.add(jid)
                    aktif.append({**k, "waktu": time.time(), "job": jid})
                    dikirim = True
                except (SystemExit, Exception) as e:  # noqa: BLE001
                    coba = k.get("coba", 1)
                    if coba < COBA_KIRIM:
                        print(f"  {k['label']}: submit gagal ({pesan(e).splitlines()[0][:120]}), dicoba lagi {JEDA_COBA_DETIK} detik lagi")
                        antre.insert(0, {**k, "coba": coba + 1, "siap": time.time() + JEDA_COBA_DETIK})
                    else:
                        h.catat_gagal(k["label"], e)
            if dikirim:
                batas = time.time() + TUNGGU_JOB_MENIT * 60
            # 2. Sub ERP selagi job diproses
            if not subdist_selesai:
                subdist_selesai = True
                try:
                    h.subdist = teks_subdist(page, daftar_bulan)
                except (SystemExit, Exception) as e:  # noqa: BLE001
                    h.catat_gagal("Sub ERP", e)
            if not aktif and not antre:
                break
            # 3. cek View Job / View Report, unduh yang sudah selesai
            ada_kemajuan = False
            if any(a["jenis"] == "job" for a in aktif):
                daftar = {j: v for j, v in daftar_job(page).items() if j not in lama}
                if daftar:
                    print("  View Job: " + ", ".join(f"{j} {k} {st or '?'}" for j, (k, st) in sorted(daftar.items())[-8:]))
                ada_kemajuan |= periksa("job", daftar)
            if any(a["jenis"] == "laporan" for a in aktif):
                daftar = {j: v for j, v in daftar_laporan(page).items() if j not in (lama_r or set())}
                if daftar:
                    print("  View Report: " + ", ".join(f"{j} {k} {st or '?'}" for j, (k, st) in sorted(daftar.items())[-8:]))
                ada_kemajuan |= periksa("laporan", daftar)
            if not aktif and not antre:
                break
            if ada_kemajuan:
                batas = time.time() + TUNGGU_JOB_MENIT * 60
            if time.time() >= batas:
                for a in aktif:
                    h.catat_gagal(a["label"], SystemExit(f"{a['label']} belum selesai setelah {TUNGGU_JOB_MENIT} menit tanpa kemajuan."))
                for k in antre:
                    h.catat_gagal(k["label"], SystemExit(f"{k['label']} belum sempat dikirim karena antrian ERP macet."))
                break
            if ada_kemajuan and any(x.get("siap", 0) <= time.time() for x in antre):
                continue                                 # ada tempat kosong: langsung kirim berikutnya
            jeda = JEDA_CEK_DETIK if any(a["bagian"] == "J028" for a in aktif) else min(JEDA_CEK_PENDEK, JEDA_CEK_DETIK)
            if any(a["job"] is None for a in aktif):
                jeda = min(jeda, 60)                     # belum muncul di View: cek tiap menit
            if antre and len(aktif) < MAKS_ANTRIAN:      # ada yang menunggu coba ulang
                jeda = max(1, min(jeda, int(min(x.get("siap", 0) for x in antre) - time.time()) + 1))
            sisa = len(aktif) + len(antre)
            print(f"  {sisa} job/laporan belum selesai, cek lagi " + (f"{jeda // 60} menit" if jeda >= 60 and jeda % 60 == 0 else f"{jeda} detik") + " lagi")
            for a in aktif:                              # yang ditunggu, supaya jelas di log
                menit = int((time.time() - a["waktu"]) // 60)
                print(f"    menunggu: {a['label'].replace('Ongkos kirim ', '')} · " + (f"{a['job']} belum FINISHED" if a["job"] else
                      f"belum ada {'Job' if a['jenis'] == 'job' else 'Report'} ID ({menit} menit sejak submit; "
                      f"submit ulang setelah {TUNGGU_MUNCUL_JOB_MENIT if a['jenis'] == 'job' else TUNGGU_MUNCUL_MENIT} menit)"))
            time.sleep(jeda)

        if perlu_j028 and len(h.j028) < perlu_j028:
            if "J028" not in h.gagal and "J028B" not in h.gagal:
                h.catat_gagal("J028", SystemExit("J028 dan J028B tidak lengkap terunduh."))
            h.j028 = []
        return h
    except PWTimeout as e:
        raise SystemExit(f"ERP tidak merespons seperti yang diharapkan: {str(e).splitlines()[0]}\nHalaman: {jejak(page, 'gagal')}")
    finally:
        ctx.close()
        browser.close()


# ---------------------------------------------------------------------------
# Harga Loco (Price & Promo Simulation) untuk perkiraan nilai Outstanding DO
# ---------------------------------------------------------------------------
HARGA_PAKAI_BACK = True
HARGA_STATUS = DASAR / "harga_loco.json"      # masa berlaku terakhir yang sudah terunggah per "PT|produk"
KOLOM_HARGA = ["dist_code", "product_code", "product_name", "warehouse", "delivery_type", "price", "net_price",
               "effective_date", "expired_date", "diambil"]


def baca_harga_status() -> dict[str, str]:
    try:
        return json.loads(HARGA_STATUS.read_text(encoding="utf-8")).get("terakhir", {})
    except (OSError, ValueError):
        return {}


def simpan_harga_status(baru: dict[str, str]) -> None:
    st = baca_harga_status()
    st.update(baru)
    HARGA_STATUS.write_text(json.dumps({"diperbarui": datetime.now().isoformat(timespec="seconds"), "terakhir": st},
                                       ensure_ascii=False, indent=1), encoding="utf-8")


def harga_terakhir() -> datetime | None:
    """Waktu terakhir bagian Harga Loco berhasil (dari riwayat.json)."""
    try:
        r = json.loads(RIWAYAT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    for c in reversed(r):
        b = c.get("bagian", {}).get("Harga Loco")
        if b and b.get("ok") and not c.get("pratinjau"):
            return datetime.fromisoformat(c["mulai"])
    return None


def tanggal_teks(t: str) -> date | None:
    """"03 Jul 2026" / "3-Jul-2026" / "2026-07-03" / "03/07/2026" -> date. Kosong -> None."""
    t = (t or "").strip()
    if not t:
        return None
    m = re.match(r"(\d{1,2})[\s\-/]+([A-Za-z]{3})[A-Za-z]*[\s\-/]+(\d{4})", t)
    if m:
        nama = {b.lower(): i + 1 for i, b in enumerate(BULAN_EN)} | {"mei": 5, "agu": 8, "agt": 8, "okt": 10, "des": 12}
        bln = nama.get(m.group(2).lower())
        return date(int(m.group(3)), bln, int(m.group(1))) if bln else None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", t)
    if m:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    return None


def angka_teks(t: str) -> float | None:
    t = (t or "").strip().replace(" ", "")
    if not t:
        return None
    neg = t.startswith("(") and t.endswith(")")
    t = t.strip("()").replace(",", "")
    try:
        v = float(t)
    except ValueError:
        return None
    return -v if neg else v


JS_TABEL_HARGA = """() => {
  const sel = t => (t.innerText || '').replace(/\\s+/g, ' ').trim();
  for (const tb of document.querySelectorAll('table')) {
    const rows = [...tb.rows];
    const hi = rows.findIndex(r => { const x = [...r.cells].map(sel).join('|').toLowerCase();
      return x.includes('delivery type') && x.includes('net price') && x.includes('expired date') && !x.includes('promo'); });
    if (hi < 0) continue;
    // tabel paling dalam saja (bukan tabel tata letak yang membungkusnya)
    if (tb.querySelector('table')) continue;
    return { header: [...rows[hi].cells].map(sel), rows: rows.slice(hi + 1).map(r => [...r.cells].map(sel)) };
  }
  return null;
}"""


def buka_form_harga(page: Page, dist: str) -> None:
    """Halaman Price & Promo Simulation dengan distributor terpilih (memilih distributor memuat ulang halaman)."""
    dd = page.locator("#ContentPlaceHolder1_ddDist")
    if not dd.count() or not page.locator("#ContentPlaceHolder1_ddProductName").count():
        page.goto(f"{ERP}/{HARGA_HALAMAN}")
        try:
            dd.wait_for(timeout=30_000)
        except PWTimeout:
            raise SystemExit(f"Halaman Price & Promo Simulation tidak bisa dibuka.\nHalaman: {jejak(page, 'harga_halaman')}")
    nilai = dd.evaluate("s => s.value")
    if (nilai or "").strip().upper() != dist.upper():
        pilih_dist(page, "#ContentPlaceHolder1_ddDist", dist)
        page.locator("#ContentPlaceHolder1_ddProductName").wait_for(timeout=30_000)


def produk_harga(page: Page, dist: str) -> list[tuple[str, str]]:
    buka_form_harga(page, dist)
    opsi = page.locator("#ContentPlaceHolder1_ddProductName").evaluate("s => [...s.options].map(o => [o.value, o.text])")
    pola = harga_produk()
    hasil = []
    for v, t in opsi:
        kode = (v or "").strip().upper()
        if not kode or not pola.search(kode):
            continue
        nama = re.sub(rf"^\s*{re.escape(kode)}\s*-\s*", "", t or "", flags=re.I).strip() or kode
        hasil.append((kode, nama))
    return hasil


def baca_harga(page: Page, dist: str, kode: str, d: date) -> list[dict]:
    """Satu kali Next: baris LOCO di tabel Basic and Additional Price pada tanggal simulasi d."""
    buka_form_harga(page, dist)
    prod = page.locator("#ContentPlaceHolder1_ddProductName")
    if (prod.evaluate("s => s.value") or "").strip().upper() != kode:
        prod.select_option(kode)
        try:
            page.wait_for_load_state("networkidle", timeout=30_000)
        except PWTimeout:
            pass
    teks = tanggal_erp(d)
    # kolom tanggal memakai kalender: isi nilainya langsung (juga kalau readonly), lalu picu change
    page.locator("#ContentPlaceHolder1_txtPeriode").evaluate(
        "(el, v) => { el.removeAttribute('readonly'); el.value = v; el.dispatchEvent(new Event('change', {bubbles: true})); }", teks)
    tombol = page.locator("input[type=submit][value='Next'], input[type=button][value='Next'], button:has-text('Next')").first
    n_pesan = len(PESAN_ERP)
    try:
        with page.expect_navigation(timeout=60_000):
            tombol.click()
    except PWTimeout:
        baru = " ".join(PESAN_ERP[n_pesan:])
        raise SystemExit(f"Next tidak membuka hasil simulasi {dist} {kode} {d}" + (f" (pesan ERP: {baru})" if baru else "")
                         + f".\nHalaman: {jejak(page, 'harga_next')}")
    data = page.evaluate(JS_TABEL_HARGA)
    isi = page.locator("body").inner_text()
    if not data:
        if re.search(r"Basic and Additional Price", isi, re.I):
            return []                                  # tabel ada tapi kosong
        raise SystemExit(f"Hasil Price & Promo Simulation {dist} {kode} {d} tidak terbaca.\nHalaman: {jejak(page, 'harga_hasil')}")
    m = re.search(r"Tanggal\s+Simulasi\s*:?\s*([0-9]{1,2}[\s\-/][A-Za-z0-9]{2,9}[\s\-/][0-9]{4})", isi, re.I)
    tgl = tanggal_teks(m.group(1)) if m else None
    if tgl != d:
        raise SystemExit(f"Tanggal simulasi di ERP ({m.group(1) if m else 'tidak terbaca'}) tidak sama dengan {d}: format tanggal "
                         f"kolom Periode berbeda.\nHalaman: {jejak(page, 'harga_tanggal')}")
    if not re.search(rf"(?<![0-9A-Z]){re.escape(dist)}(?![0-9A-Z])", isi.upper()) or kode not in isi.upper():
        raise SystemExit(f"Hasil simulasi bukan untuk {dist} {kode}.\nHalaman: {jejak(page, 'harga_salah')}")
    h = [x.lower() for x in data["header"]]
    def kol(nama: str) -> int:
        return h.index(nama) if nama in h else -1
    i_tipe, i_wh, i_price, i_net, i_eff, i_exp = (kol("delivery type"), kol("warehouse"), kol("price"), kol("net price"),
                                                  kol("effective date"), kol("expired date"))
    if min(i_tipe, i_net, i_eff, i_exp) < 0:
        raise SystemExit(f"Kolom tabel harga berbeda dari yang dikenal: {data['header']}\nHalaman: {jejak(page, 'harga_kolom')}")
    hasil = []
    for r in data["rows"]:
        if len(r) <= max(i_tipe, i_net, i_eff, i_exp) or "LOCO" not in r[i_tipe].upper():
            continue
        net, eff = angka_teks(r[i_net]), tanggal_teks(r[i_eff])
        if net is None or eff is None:
            continue
        hasil.append({"warehouse": r[i_wh] if i_wh >= 0 else "", "delivery_type": r[i_tipe], "price": angka_teks(r[i_price]) if i_price >= 0 else None,
                      "net_price": net, "effective_date": eff, "expired_date": tanggal_teks(r[i_exp])})
    # kembali ke formulir lewat tombol Back (distributor biasanya tetap terpilih); kalau tidak berhasil, berikutnya buka ulang halaman
    global HARGA_PAKAI_BACK
    if HARGA_PAKAI_BACK:
        try:
            kembali = page.locator("input[type=submit][value='Back'], input[type=button][value='Back'], button:has-text('Back')").first
            if kembali.count():
                with page.expect_navigation(timeout=15_000):
                    kembali.click()
            else:
                HARGA_PAKAI_BACK = False
        except (PWTimeout, PWError):
            HARGA_PAKAI_BACK = False
    return hasil


def lompat_harga(page: Page, dist: str, kode: str, nama: str, mulai: date, sampai: date) -> list[dict]:
    """Masa berlaku harga Loco dari tanggal mulai: baca, lompat ke Expired + 1 hari, berhenti saat Expired kosong
    (masih berlaku) atau sudah lewat tanggal sampai. Tanggal tanpa harga: lompat ke awal bulan berikutnya."""
    d, hasil, n = mulai, [], 0
    while d <= sampai and n < HARGA_MAKS_LOMPAT:
        n += 1
        baris = baca_harga(page, dist, kode, d)
        if not baris:
            d = bulan_tambah(d.replace(day=1), 1)
            continue
        for b in baris:
            b.update(dist_code=dist, product_code=kode, product_name=nama, diambil=date.today())
        hasil += baris
        exp = [b["expired_date"] for b in baris]
        if any(e is None for e in exp):
            break
        d = max(min(exp) + timedelta(days=1), d + timedelta(days=1))
    return hasil


def ambil_harga(pw, tampil: bool, dists: list[str], dari: date | None) -> tuple[Path | None, dict[str, str], str, list[str]]:
    """Baca harga Loco semua PT x produk, tulis CSV. Kembali: (file, masa berlaku terakhir per PT|produk, ringkasan,
    PT / produk yang gagal dibaca). Satu PT / produk gagal tidak menghentikan yang lain."""
    status = {} if dari else baca_harga_status()
    awal = dari or date(date.today().year, 1, 1)
    user = rahasia("ERP_USER", "User ERP")
    pwd = rahasia("ERP_PASS", "Password ERP (tidak tampil)", tersembunyi=True)
    browser, ctx, page = buka_browser(pw, tampil)
    semua, terakhir, gagal = [], {}, []
    try:
        login_erp(page, user, pwd)
        for dist in dists:
            try:
                produk = produk_harga(page, dist)
            except (SystemExit, PWTimeout, PWError) as e:
                gagal.append(f"{dist}: {pesan(e).splitlines()[0]}")
                continue
            if not produk:
                print(f"  {dist}: tidak ada produk CMT / RJW / CWC di pilihan")
                continue
            for kode, nama in produk:
                k = f"{dist}|{kode}"
                mulai = date.fromisoformat(status[k]) if k in status else awal
                try:
                    baris = lompat_harga(page, dist, kode, nama, mulai, date.today())
                except (SystemExit, PWTimeout, PWError) as e:
                    gagal.append(f"{dist} {kode}: {pesan(e).splitlines()[0]}")
                    print(f"  {dist} {kode} GAGAL: {pesan(e).splitlines()[0]}")
                    try:
                        page.goto(f"{ERP}/{HARGA_HALAMAN}")
                    except (PWTimeout, PWError):
                        pass
                    continue
                kunci_segarkan()
                if not baris:
                    print(f"  {dist} {kode} {nama}: tidak ada harga LOCO sejak {mulai}")
                    continue
                semua += baris
                akhir = max(b["effective_date"] for b in baris)
                terakhir[k] = akhir.isoformat()
                # harga terakhir per gudang (INSA punya beberapa gudang LOCO: INSA, KUALA TANJUNG, ACEH)
                per_gudang: dict[str, dict] = {}
                for x in sorted(baris, key=lambda x: x["effective_date"]):
                    per_gudang[x["warehouse"] or "-"] = x
                teks = ", ".join(f"{g} {x['net_price']:,.0f} sejak {x['effective_date']}" + (f" s.d. {x['expired_date']}" if x["expired_date"] else "")
                                 for g, x in per_gudang.items())
                print(f"  {dist} {kode} {nama}: {len({(b['warehouse'], b['effective_date']) for b in baris})} masa berlaku; Loco Net terakhir {teks}")
    finally:
        browser.close()
    if gagal and not semua:
        raise SystemExit("Harga Loco tidak terbaca: " + "; ".join(gagal[:5]))
    for g in gagal:
        print(f"  Harga Loco GAGAL sebagian: {g}")
    if not semua:
        return None, {}, "tidak ada harga baru", gagal
    folder = folder_file() / "HARGA"
    folder.mkdir(parents=True, exist_ok=True)
    f = folder / f"HARGA_LOCO_{datetime.now():%Y%m%d_%H%M}.csv"
    with f.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(KOLOM_HARGA)
        for b in semua:
            w.writerow([b["dist_code"], b["product_code"], b["product_name"], b["warehouse"], b["delivery_type"],
                        "" if b["price"] is None else f"{b['price']:.2f}", f"{b['net_price']:.2f}", b["effective_date"].isoformat(),
                        b["expired_date"].isoformat() if b["expired_date"] else "", b["diambil"].isoformat()])
    ringkas = f"{len(terakhir)} PT x produk, {len(semua)} baris harga"
    print(f"  Harga Loco: {ringkas} -> {f}")
    return f, terakhir, ringkas, gagal


def judul_berkas(f: Path) -> str:
    return f.read_text(encoding="utf-8", errors="replace").splitlines()[0]


def periksa_j028(files: list[Path]) -> None:
    """Harus tepat satu J028 dan satu J028B, dilihat dari baris judulnya."""
    jenis = []
    for f in files:
        judul = judul_berkas(f)
        if "Distributor Code" not in judul:
            raise SystemExit(f"{f.name} bukan unduhan J028 / J028B (baris judul tidak dikenal).")
        jenis.append("J028B" if "Distributor Code Clone" in judul else "J028")
    if sorted(jenis) != ["J028", "J028B"]:
        raise SystemExit(f"Butuh satu J028 dan satu J028B, yang ada: {jenis}")


def masuk_sementrack(pw, tampil: bool):
    url = rahasia("SEMENTRACK_URL", "Alamat SEMENTRACK (mis. http://localhost:5173)").rstrip("/")
    user = rahasia("SEMENTRACK_USER", "User SEMENTRACK (admin)")
    pwd = rahasia("SEMENTRACK_PASS", "Password SEMENTRACK (tidak tampil)", tersembunyi=True)
    browser = pw.chromium.launch(channel=KANAL, headless=not tampil)
    page = browser.new_context().new_page()
    page.goto(url + "/")
    page.locator("input[type=text], input[name=username]").first.fill(user)
    page.locator("input[type=password]").fill(pwd)
    page.keyboard.press("Enter")
    try:
        page.wait_for_url("**/overview", timeout=30_000)
    except PWTimeout:
        browser.close()
        raise SystemExit("Login SEMENTRACK gagal (user / password / alamat salah?).")
    return browser, page, url


def tempel_subdist(page: Page, url: str, per_tahun: dict[int, str], simpan: bool, paksa: bool) -> str:
    return tempel_sellout(page, url, "erp", "Sub ERP", per_tahun, simpan, paksa)


def tempel_sellout(page: Page, url: str, dataset: str, label: str, per_tahun: dict[int, str], simpan: bool, paksa: bool) -> str:
    """Kelola Data -> Sell Out BNN -> Tempel Sub ERP / Tempel DO FAS."""
    ringkas = []
    for tahun, teks in sorted(per_tahun.items()):
        page.goto(url + f"/kelola-data?data=sellout&menu={dataset}")
        pilih = page.locator(f"#so-{dataset}-th")
        pilih.wait_for(timeout=30_000)
        if pilih.locator(f"option[value='{tahun}']").count() == 0:
            raise SystemExit(f"Tahun {tahun} tidak bisa dipilih di Tempel {label} (hanya tahun ini dan tahun lalu).")
        pilih.select_option(str(tahun))
        page.locator(f"#so-{dataset}-paste").fill(teks)
        page.get_by_role("button", name="Periksa data").click()
        tombol = page.get_by_role("button", name=f"Simpan {label} {tahun}")
        page.locator(f"[role=alert], button:has-text('Simpan {label} {tahun}')").first.wait_for(timeout=60_000)
        nama = f"{dataset}_{tahun}"
        if not tombol.count():
            page.screenshot(path=str(FOLDER / f"ditolak_{nama}.png"), full_page=True)
            raise SystemExit(f"SEMENTRACK menolak tempelan {label}: " + page.locator("[role=alert]").first.inner_text() + f"\nLihat unduhan/ditolak_{nama}.png")
        page.screenshot(path=str(FOLDER / f"pratinjau_{nama}.png"), full_page=True)
        if page.get_by_text("baris dilewati").count():
            raise SystemExit(f"Ada baris {label} yang tidak terbaca. Tidak disimpan otomatis. Lihat unduhan/pratinjau_{nama}.png")
        if page.get_by_text("Lebih kecil dari yang tersimpan").count() and not paksa:
            raise SystemExit(f"Ada angka {label} yang lebih kecil dari yang sudah tersimpan. Tidak disimpan otomatis; cek unduhan/pratinjau_{nama}.png, "
                             "lalu jalankan lagi dengan --paksa kalau memang koreksi.")
        if dataset == "dofas" and page.get_by_text("Tidak ditemukan di tempelan").count() and not paksa:
            raise SystemExit("Ada baris Sell Out BNN yang tidak ada di file DO FAS (akan menjadi 0). Tidak disimpan otomatis; cek "
                             f"unduhan/pratinjau_{nama}.png, lalu jalankan lagi dengan --paksa kalau memang benar.")
        print("  " + page.get_by_text(re.compile(r"akan diganti")).last.inner_text())
        if not simpan:
            print("  --tanpa-simpan: berhenti di pratinjau.")
            ringkas.append("pratinjau")
            continue
        tombol.click()
        page.get_by_text(f"{label} {tahun} tersimpan").wait_for(timeout=120_000)
        hasil = page.get_by_text(re.compile(r"baris \(.* ton\) menggantikan")).first.inner_text()
        print("  " + hasil)
        t = re.search(r"\(([\d.,]+) ton\)", hasil)
        ringkas.append(f"{t.group(1)} ton" if t else "tersimpan")
    if dataset == "erp":
        return ", ".join(RINGKAS_SUBDIST) + ("" if simpan else " (pratinjau)")
    tahun_teks = ", ".join(str(t) for t in sorted(per_tahun))
    return f"{tahun_teks} (pratinjau)" if not simpan else f"{', '.join(ringkas)} ({tahun_teks})"


def unggah_berkas(page: Page, url: str, alamat: str, files: list[Path], nama: str, simpan: bool, tolak_baris_rusak: bool,
                  hentikan_bila: tuple[tuple[str, str], ...] = (), kosong_boleh: bool = False) -> str:
    """Upload lewat Kelola Data (Transaksi / J073 / ORDB019): pratinjau, berhenti kalau ditolak, lalu simpan.
    kosong_boleh: file tanpa baris semen (distributor tidak berjualan / tidak mengirim) bukan kegagalan."""
    page.goto(url + alamat)
    page.locator("input[type=file]").first.set_input_files([str(f) for f in files])
    page.wait_for_selector("text=/siap disimpan|tidak bisa dipakai|Tidak ada baris/", timeout=180_000)
    if kosong_boleh and page.locator("text=siap disimpan").count() == 0 and page.locator("text=/Tidak ada baris/").count():
        print(f"  {nama}: tidak ada baris semen, dilewati")
        return "kosong"
    if page.locator("text=siap disimpan").count() == 0:
        page.screenshot(path=str(FOLDER / f"ditolak_{nama}.png"), full_page=True)
        kurang = ""
        if page.get_by_text("Kolom yang tidak ditemukan").count() and files[0].suffix.lower() not in (".xlsx", ".xlsm"):   # baris judul kolom (nama kolom saja, bukan data)
            judul = files[0].read_text(encoding="utf-8", errors="replace").splitlines()
            judul = next((b for b in judul if b.strip()), "")
            kurang = f"\n  Baris judul file: {judul[:300]}"
        raise SystemExit(f"SEMENTRACK menolak file {nama}. Lihat unduhan/ditolak_{nama}.png{kurang}")
    page.screenshot(path=str(FOLDER / f"pratinjau_{nama}.png"), full_page=True)
    if tolak_baris_rusak and (page.locator("input[type=checkbox]").count() or page.get_by_text("isinya tidak terbaca").count()):
        raise SystemExit(f"Ada baris {nama} yang tidak terbaca. Tidak disimpan otomatis. Lihat unduhan/pratinjau_{nama}.png")
    for pemilih, alasan in hentikan_bila:
        if page.locator(pemilih).count():
            raise SystemExit(f"{alasan} Tidak disimpan otomatis. Lihat unduhan/pratinjau_{nama}.png")
    siap = (page.locator("text=siap disimpan").first.text_content() or "").strip()
    print("  pratinjau:", siap)
    baris = re.match(r"([\d.]+)\s+(\w+)", siap)
    ringkas = f"{baris.group(1)} {baris.group(2)}" if baris else siap
    if not simpan:
        print("  --tanpa-simpan: berhenti di pratinjau.")
        return ringkas + " (pratinjau)"
    page.locator("button", has_text="Simpan ke database").click()
    page.wait_for_selector("text=Data tersimpan", timeout=600_000)
    print("  " + " ".join(page.locator(".upl-done").first.inner_text().split())[:200])
    return ringkas


def main() -> None:
    hari_ini = date.today()
    # bawaan: tanggal 1 bulan ini s.d. hari ini (hampir real time). Pada tanggal 1, bulan lalu ikut
    # diambil supaya transaksi hari terakhir bulan lalu yang masuk setelah tengah malam tetap terbawa.
    awal = (hari_ini - timedelta(days=1)).replace(day=1) if hari_ini.day == 1 else hari_ini.replace(day=1)
    ap = argparse.ArgumentParser(description="Ambil J028 + J028B, J073, dan Sub ERP dari ERP lalu masukkan ke SEMENTRACK")
    ap.add_argument("--dari", type=date.fromisoformat, default=awal, help="YYYY-MM-DD, bawaan: tanggal 1 bulan ini")
    ap.add_argument("--sampai", type=date.fromisoformat, default=hari_ini, help="YYYY-MM-DD, bawaan: hari ini")
    ap.add_argument("--sampai-hari-ini", action="store_true", help=argparse.SUPPRESS)   # sudah bawaan, tetap diterima
    ap.add_argument("--uji-login", action="store_true", help="hanya coba login ERP dan SEMENTRACK")
    ap.add_argument("--login-tiro", action="store_true", help="login TIRO (ketik captcha) dan simpan sesinya, lalu keluar")
    ap.add_argument("--log", type=Path, help="tulis semua keluaran ke file ini juga")
    ap.add_argument("--subdist", action="store_true", help="Sub ERP saja")
    ap.add_argument("--j073", action="store_true", help="J073 saja")
    ap.add_argument("--semua", action="store_true", help="J028, J073, dan Sub ERP sekaligus (TIRO tidak, karena butuh captcha)")
    ap.add_argument("--bagian", help="gabungan bagian, mis. J028,J073 atau J028,SUBDIST")
    ap.add_argument("--bulan", nargs="+", metavar="YYYY-MM", help="bulan Sub ERP, bawaan: bulan-bulan dari --dari s.d. --sampai")
    ap.add_argument("--hanya-unduh", action="store_true", help="ambil dari ERP saja, tidak masuk SEMENTRACK")
    ap.add_argument("--tanpa-simpan", action="store_true", help="di SEMENTRACK berhenti di pratinjau")
    ap.add_argument("--berkas", nargs=2, type=Path, metavar="FILE", help="J028: lewati ERP, pakai dua file yang sudah ada")
    ap.add_argument("--paksa", action="store_true", help="Sub ERP tetap disimpan walau ada angka yang turun")
    ap.add_argument("--tanpa-layar", action="store_true", help="browser tidak ditampilkan")
    ap.add_argument("--tanpa-jeda", action="store_true", help="exe langsung tertutup setelah selesai (untuk jadwal)")
    ap.add_argument("--jadwal", action="store_true", help="dijalankan jadwal: Ongkos kirim hanya kalau sudah ONGKOS_HARI hari sejak terakhir berhasil")
    ap.add_argument("--ongkos-dari", type=date.fromisoformat, metavar="YYYY-MM-DD", help="Ongkos kirim rentang pilihan (paling panjang 3 bulan): awal")
    ap.add_argument("--ongkos-sampai", type=date.fromisoformat, metavar="YYYY-MM-DD", help="Ongkos kirim rentang pilihan: akhir (bawaan: akhir bulan ketiga / hari ini)")
    ap.add_argument("--ongkos-dist", metavar="KODE,KODE", help="Ongkos kirim rentang pilihan: distributor tertentu saja (bawaan: ONGKOS_DIST)")
    ap.add_argument("--harga-dari", type=date.fromisoformat, metavar="YYYY-MM-DD", help="Harga Loco: baca ulang semua masa berlaku sejak tanggal ini")
    ap.add_argument("--harga-dist", metavar="KODE,KODE", help="Harga Loco: PT tertentu saja (bawaan: HARGA_DIST)")
    ap.add_argument("--isi-ulang", metavar="YYYY-MM", help="Ongkos kirim: isi data lama sejak bulan ini (J073 per 3 bulan, ORDB019 per bulan); bisa dilanjutkan")
    a = ap.parse_args()
    if a.log:
        tulis_log_ke(a.log)
    if a.uji_login:
        uji_login(not a.tanpa_layar)
        return
    if a.login_tiro:
        with sync_playwright() as pw:
            browser, _, _ = tiro_buka(pw, True)
            browser.close()
        return
    if a.dari > a.sampai:
        sys.exit("--dari harus sebelum atau sama dengan --sampai")
    try:
        if a.bulan:
            daftar_bulan = sorted({date.fromisoformat(b + "-01") for b in a.bulan})
        else:
            # semua bulan dari --dari s.d. --sampai (tanggal 1 bulan baru: bulan lalu ikut dirampungkan)
            daftar_bulan, b = [], a.dari.replace(day=1)
            while b <= a.sampai:
                daftar_bulan.append(b)
                b = (b + timedelta(days=32)).replace(day=1)
    except ValueError:
        sys.exit("--bulan ditulis YYYY-MM, mis. 2026-11")

    if a.bagian:
        bagian = {x.strip().upper().replace("SUBERP", "SUBDIST") for x in a.bagian.split(",") if x.strip()}
        if not bagian or bagian - SEMUA_BAGIAN:
            sys.exit("--bagian hanya boleh " + ", ".join(sorted(SEMUA_BAGIAN)))
    else:
        bagian = {"J028", "J073", "SUBDIST"} if a.semua else {"SUBDIST"} if a.subdist else {"J073"} if a.j073 else {"J028"}
    if a.isi_ulang:
        try:
            a.isi_ulang = date.fromisoformat(a.isi_ulang[:7] + "-01")
        except ValueError:
            sys.exit("--isi-ulang ditulis YYYY-MM, mis. 2025-01")
        a.ongkos_dist = [d for d in (k.strip().upper() for k in (a.ongkos_dist or "").split(",")) if d and d != "4094E"] or ongkos_dist()
        bagian = {"ONGKOS"}
    elif a.ongkos_dari:
        try:
            a.ongkos_sampai, a.ongkos_dist = cek_rentang_ongkos(a.ongkos_dari, a.ongkos_sampai, a.ongkos_dist)
        except ValueError as e:
            sys.exit(str(e))
        a.dari, a.sampai = a.ongkos_dari, a.ongkos_sampai
        bagian = {"ONGKOS"}
    elif "ONGKOS" in bagian and a.jadwal:
        t = ongkos_terakhir()
        if t and datetime.now() - t < timedelta(days=ONGKOS_HARI) - timedelta(hours=2):
            print(f"Ongkos kirim terakhir diperbarui {t:%Y-%m-%d %H:%M}; jadwal berikutnya {(t + timedelta(days=ONGKOS_HARI)):%Y-%m-%d}.")
            bagian.discard("ONGKOS")
            if not bagian:
                return
    if a.harga_dari or a.harga_dist:
        bagian.add("HARGA")
    if "HARGA" in bagian and a.jadwal and not a.harga_dari:
        t = harga_terakhir()
        if t and datetime.now() - t < timedelta(days=HARGA_HARI) - timedelta(hours=2):
            print(f"Harga Loco terakhir diperbarui {t:%Y-%m-%d %H:%M}; jadwal berikutnya {(t + timedelta(days=HARGA_HARI)):%Y-%m-%d}.")
            bagian.discard("HARGA")
            if not bagian:
                return
    if not kunci_ambil():
        sys.exit("Masih ada proses otomasi lain yang berjalan (dari aplikasi atau jadwal Windows). Coba lagi nanti.")
    mulai = datetime.now()
    print(f"Mulai {mulai:%Y-%m-%d %H:%M} | versi {VERSI} | {', '.join(sorted(bagian))} | {a.dari} s.d. {a.sampai}")
    h = Hasil()
    try:
        jalankan(a, bagian, daftar_bulan, h)
    except (SystemExit, Exception) as e:  # noqa: BLE001 - galat umum (mis. login gagal) tetap dicatat
        if not isinstance(e, SystemExit) or e.code not in (None, 0):
            h.gagal.setdefault("Umum", pesan(e))
    finally:
        catat_riwayat(mulai, bagian, a, h)
        kunci_lepas()
    if h.gagal:
        raise SystemExit("Selesai dengan kegagalan:\n" + "\n".join(f"- {k}: {v}" for k, v in h.gagal.items()))
    print("Semua bagian berhasil.")


def jalankan(a, bagian: set[str], daftar_bulan: list[date], h: "Hasil") -> None:

    with sync_playwright() as pw:
        jenis_tiro = [b for b in ("SELLIN", "OSDO") if b in bagian]
        if jenis_tiro:
            # TIRO dulu: kalau perlu login, captcha diketik di awal, sesudah itu semuanya jalan sendiri
            print("TIRO: " + ", ".join(TIRO_JENIS[b][1] for b in jenis_tiro) + f", dari {date(a.sampai.year, 1, 1)}")
            try:
                browser, _, page = tiro_buka(pw, not a.tanpa_layar)
                try:
                    h.tiro = tiro_unduh(page, jenis_tiro, date(a.sampai.year, 1, 1))
                finally:
                    browser.close()
            except (SystemExit, Exception) as e:  # noqa: BLE001
                for b in jenis_tiro:
                    h.catat_gagal(NAMA_BAGIAN[b], e)
        if "DOFAS" in bagian:
            print("DO FAS: baca rekap DO harian")
            try:
                h.dofas = {a.sampai.year: teks_dofas(a.sampai.year)}
            except (SystemExit, Exception) as e:  # noqa: BLE001
                h.catat_gagal("DO FAS", e)
        if "STOCK" in bagian:
            print("Stock: baca file stok semen")
            try:
                h.stock = berkas_stok(a.sampai)
            except (SystemExit, Exception) as e:  # noqa: BLE001
                h.catat_gagal("Stock", e)
        if "ONGKOS" in bagian:
            n = migrasi_unduhan()
            if n:
                print(f"Ongkos kirim: {n} unduhan lama disalin ke {folder_file()}")
        if a.isi_ulang:
            isi_ulang_ongkos(pw, a, h)
            return
        dari_erp = (bagian & {"J028", "J073", "SUBDIST"}) - ({"J028"} if a.berkas else set())
        if "ONGKOS" not in bagian:
            ongkos = []
        elif a.ongkos_dari:
            ongkos = kiriman_rentang(a.ongkos_dari, a.ongkos_sampai, a.ongkos_dist)
            print("Ongkos kirim rentang pilihan: " + f"{a.ongkos_dari} s.d. {a.ongkos_sampai}, " + ", ".join(a.ongkos_dist))
        else:
            ongkos = kiriman_ongkos(a.sampai, ongkos_dist())
        if dari_erp or ongkos:
            h2 = ambil_erp(pw, dari_erp, a.dari, a.sampai, daftar_bulan, tampil=not a.tanpa_layar, ongkos=ongkos)
            h.j028, h.j073, h.subdist, h.ongkos = h2.j028, h2.j073, h2.subdist, h2.ongkos
            h.gagal.update(h2.gagal)
            if "J073" in bagian and not h.j073 and any(k["jenis"] == "J073" for k in ongkos):
                h.berhasil["J073"] = "ikut file J073 Ongkos kirim"
        if "HARGA" in bagian:
            dists = [d.strip().upper() for d in (a.harga_dist or "").split(",") if d.strip()] or harga_dist()
            print("Harga Loco: " + ", ".join(dists) + (f", baca ulang sejak {a.harga_dari}" if a.harga_dari else ""))
            try:
                h.harga, h.harga_status, ringkas, gagal = ambil_harga(pw, not a.tanpa_layar, dists, a.harga_dari)
                h.harga_ringkas = ringkas
                if not h.harga:
                    h.berhasil["Harga Loco"] = ringkas
                if gagal:
                    h.gagal["Harga Loco sebagian"] = f"{len(gagal)} PT / produk gagal dibaca: " + "; ".join(gagal[:3])
            except (SystemExit, Exception) as e:  # noqa: BLE001
                h.catat_gagal("Harga Loco", e)
        if a.berkas:
            h.j028 = list(a.berkas)
        if h.j028:
            try:
                periksa_j028(h.j028)
            except SystemExit as e:
                h.catat_gagal("J028", e)
                h.j028 = []

        ada = h.subdist or h.j028 or h.j073 or h.tiro or h.dofas or h.stock or h.ongkos or h.harga
        if ada and not a.hanya_unduh:
            browser, page, url = masuk_sementrack(pw, not a.tanpa_layar)
            try:
                langkah = [
                    ("Sub ERP", h.subdist, lambda: tempel_subdist(page, url, h.subdist, not a.tanpa_simpan, a.paksa)),
                    ("DO FAS", h.dofas, lambda: tempel_sellout(page, url, "dofas", "DO FAS", h.dofas, not a.tanpa_simpan, a.paksa)),
                    ("J028", h.j028, lambda: unggah_berkas(page, url, "/kelola-data?data=transaksi&menu=upload", h.j028, "J028", not a.tanpa_simpan, True)),
                    # J073: satu file per distributor; tiap file mengganti data distributor itu pada rentang tanggalnya
                    ("J073", h.j073, lambda: " + ".join(unggah_berkas(page, url, "/kelola-data?data=sellout&menu=j073", [f], f.stem, not a.tanpa_simpan, True) for f in h.j073)),
                    ("Sell In", h.tiro.get("SELLIN"), lambda: unggah_berkas(
                        page, url, "/kelola-data?data=sellin&menu=upload", [h.tiro["SELLIN"]], "SellIn", not a.tanpa_simpan, True,
                        (("input[aria-label^='Region untuk']", "Ada kode gudang baru yang belum punya region; isi dulu di Kelola Data → Sell In BNN."),))),
                    ("OS DO", h.tiro.get("OSDO"), lambda: unggah_berkas(
                        page, url, "/kelola-data?data=sellin&menu=outstanding", [h.tiro["OSDO"]], "OSDO", not a.tanpa_simpan, True,
                        (("text=menurut tanggal pengiriman", "File OS DO ternyata export per tanggal pengiriman, bukan tanggal order."),))),
                    # Stock: satu file per bulan; tanggal yang ada di file diganti
                    ("Stock", h.stock, lambda: " + ".join(unggah_berkas(page, url, "/kelola-data?data=stock&menu=upload", [f], "Stock_" + f.stem.replace(" ", "_"), not a.tanpa_simpan, True) for f in h.stock)),
                    # Ongkos kirim: J073 dulu (DO, toko, tagihan), lalu ORDB019 per distributor per bulan
                    ("Ongkos kirim", h.ongkos, lambda: unggah_ongkos(page, url, h, not a.tanpa_simpan)),
                    # Harga Loco: masa berlaku yang dibaca diganti; status lompatan baru disimpan setelah upload berhasil
                    ("Harga Loco", h.harga, lambda: unggah_harga(page, url, h, not a.tanpa_simpan)),
                ]
                for nama, isi, kerja in langkah:
                    if not isi:
                        continue
                    print(f"SEMENTRACK: {nama}")
                    try:
                        h.berhasil[nama] = kerja() or "ok"
                    except (SystemExit, Exception) as e:  # noqa: BLE001 - bagian lain tetap jalan
                        h.catat_gagal(nama, e)
            finally:
                browser.close()
        if a.hanya_unduh:
            for nama, isi in (("Sub ERP", h.subdist), ("DO FAS", h.dofas), ("J028", h.j028), ("J073", h.j073), ("Sell In", h.tiro.get("SELLIN")), ("OS DO", h.tiro.get("OSDO")), ("Stock", h.stock), ("Ongkos kirim", h.ongkos), ("Harga Loco", h.harga)):
                if isi:
                    h.berhasil[nama] = "terunduh"


def unggah_harga(page: Page, url: str, h: Hasil, simpan: bool) -> str:
    hasil = unggah_berkas(page, url, "/kelola-data?data=sellin&menu=harga", [h.harga], h.harga.stem, simpan, True)
    if not simpan:
        return hasil
    simpan_harga_status(h.harga_status)
    return h.harga_ringkas or hasil


def unggah_ongkos(page: Page, url: str, h: Hasil, simpan: bool, tandai: bool = False) -> str:
    """Upload hasil Ongkos kirim satu per satu (J073 dulu). Satu file gagal tidak menghentikan yang lain."""
    urut = sorted(h.ongkos, key=lambda x: (x[1]["jenis"] != "J073", x[1]["dist"], str(x[1].get("dari") or x[1].get("bulan"))))
    n = {"J073": 0, "ORDB": 0, "kosong": 0}
    for f, k in urut:
        alamat = "/kelola-data?data=ongkos&menu=j073" if k["jenis"] == "J073" else "/kelola-data?data=ongkos&menu=ordb"
        try:
            hasil = unggah_berkas(page, url, alamat, [f], f.stem, simpan, k["jenis"] == "J073", kosong_boleh=True)
            n["kosong" if hasil == "kosong" else k["jenis"]] += 1
            if tandai and simpan:
                tandai_isi_ulang(k["kunci"])
        except (SystemExit, Exception) as e:  # noqa: BLE001
            h.catat_gagal(label_kiriman(k), e)
        kunci_segarkan()
    teks = f"J073 {n['J073']} file, ORDB019 {n['ORDB']} laporan" + (f", {n['kosong']} kosong" if n["kosong"] else "")
    print("  Ongkos kirim: " + teks)
    return teks


def isi_ulang_ongkos(pw, a, h: Hasil) -> None:
    """Isi data Ongkos kirim lama sejak a.isi_ulang: per kelompok kecil unduh lalu upload, dicatat di isi_ulang_ongkos.json."""
    semua = kiriman_ongkos(a.sampai, a.ongkos_dist, a.isi_ulang)
    sudah = baca_isi_ulang()
    sisa = [k for k in semua if k["kunci"] not in sudah]
    # yang sudah ada salinan lokalnya diupload sekaligus dulu, sisanya diminta ke ERP per kelompok kecil
    lokal = [k for k in sisa if cari_lokal(k, date.today())]
    erp = [k for k in sisa if k not in lokal]
    kelompok_semua = ([lokal] if lokal else []) + [erp[i:i + KELOMPOK_ISI_ULANG] for i in range(0, len(erp), KELOMPOK_ISI_ULANG)]
    print(f"Isi ulang ongkos kirim sejak {a.isi_ulang:%Y-%m} ({len(a.ongkos_dist)} distributor): {len(semua)} job/laporan, "
          f"{len(semua) - len(sisa)} sudah masuk, {len(lokal)} dari salinan lokal, {len(erp)} diminta ke ERP")
    total = {"J073": 0, "ORDB": 0, "kosong": 0}
    for i, kelompok in enumerate(kelompok_semua):
        print(f"Kelompok {i + 1} dari {len(kelompok_semua)}"
              + (" (salinan lokal)" if lokal and i == 0 else ": " + ", ".join(label_kiriman(k).replace("Ongkos kirim ", "") for k in kelompok)))
        try:
            h2 = ambil_erp(pw, set(), a.dari, a.sampai, [], tampil=not a.tanpa_layar, ongkos=kelompok)
        except (SystemExit, Exception) as e:  # noqa: BLE001
            h.catat_gagal("Ongkos kirim ERP", e)
            continue
        h.gagal.update(h2.gagal)
        if not h2.ongkos or a.hanya_unduh:
            continue
        try:
            browser, page, url = masuk_sementrack(pw, not a.tanpa_layar)
        except (SystemExit, Exception) as e:  # noqa: BLE001
            h.catat_gagal("Ongkos kirim SEMENTRACK", e)
            break
        try:
            teks = unggah_ongkos(page, url, h2, not a.tanpa_simpan, tandai=True)
            for kk in total:
                m = re.search(rf"{'ORDB019' if kk == 'ORDB' else kk} (\d+)", teks) if kk != "kosong" else re.search(r"(\d+) kosong", teks)
                total[kk] += int(m.group(1)) if m else 0
            h.gagal.update(h2.gagal)
        finally:
            browser.close()
    sisa_akhir = len([k for k in semua if k["kunci"] not in baca_isi_ulang()])
    h.berhasil["Ongkos kirim"] = (f"isi ulang: J073 {total['J073']} file, ORDB019 {total['ORDB']} laporan"
                                  + (f", {total['kosong']} kosong" if total["kosong"] else "") + (f"; {sisa_akhir} belum masuk" if sisa_akhir else "; lengkap"))
    print("Selesai " + h.berhasil["Ongkos kirim"])


SEMUA_BAGIAN = {"J028", "J073", "SUBDIST", "SELLIN", "OSDO", "DOFAS", "STOCK", "ONGKOS", "HARGA"}
ISI_ULANG = DASAR / "isi_ulang_ongkos.json"
RIWAYAT = DASAR / "riwayat.json"
KUNCI = DASAR / "sedang_jalan.lock"


def kunci_ambil() -> bool:
    """Satu proses saja dalam satu waktu. Kunci yang lebih tua dari 90 menit dianggap sisa proses yang macet."""
    try:
        if KUNCI.exists() and time.time() - KUNCI.stat().st_mtime < 90 * 60:
            return False
        KUNCI.write_text(f"{os.getpid()} {datetime.now():%Y-%m-%d %H:%M:%S}", encoding="utf-8")
        return True
    except OSError:
        return True


def kunci_segarkan() -> None:
    """Proses panjang (isi ulang) memperbarui kuncinya supaya tidak dianggap macet setelah 90 menit."""
    try:
        if KUNCI.exists():
            os.utime(KUNCI)
    except OSError:
        pass


def kunci_lepas() -> None:
    try:
        KUNCI.unlink()
    except OSError:
        pass
NAMA_BAGIAN = {"J028": "J028", "J073": "J073", "SUBDIST": "Sub ERP", "SELLIN": "Sell In", "OSDO": "OS DO", "DOFAS": "DO FAS", "STOCK": "Stock",
               "ONGKOS": "Ongkos kirim", "HARGA": "Harga Loco"}


def ongkos_terakhir() -> datetime | None:
    """Waktu terakhir bagian Ongkos kirim berhasil (dari riwayat.json)."""
    try:
        r = json.loads(RIWAYAT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    for c in reversed(r):
        b = c.get("bagian", {}).get("Ongkos kirim")
        if b and b.get("ok") and not c.get("pratinjau") and not c.get("ongkos_pilihan"):
            return datetime.fromisoformat(c["mulai"])
    return None


def baca_isi_ulang() -> set[str]:
    try:
        return set(json.loads(ISI_ULANG.read_text(encoding="utf-8")).get("selesai", []))
    except (OSError, ValueError):
        return set()


def tandai_isi_ulang(kunci: str) -> None:
    sudah = baca_isi_ulang() | {kunci}
    ISI_ULANG.write_text(json.dumps({"diperbarui": datetime.now().isoformat(timespec="seconds"), "selesai": sorted(sudah)},
                                    ensure_ascii=False, indent=1), encoding="utf-8")


def catat_riwayat(mulai: datetime, bagian: set[str], a, h: "Hasil") -> None:
    """Satu baris per jalan di riwayat.json (dibaca aplikasi Nazam Auto Task). Paling banyak 500 baris."""
    status = {}
    for b in sorted(bagian):
        n = NAMA_BAGIAN[b]
        gagal = next((v for k, v in h.gagal.items() if k == n or k.startswith(n + " ") or (n == "J028" and k == "J028B")), None)
        status[n] = {"ok": False, "pesan": gagal} if gagal else {"ok": True, "pesan": h.berhasil.get(n, "tidak ada data baru")}
    if "Umum" in h.gagal:
        for v in status.values():
            if v["ok"]:
                v.update(ok=False, pesan=h.gagal["Umum"])
    catatan = {"mulai": mulai.isoformat(timespec="seconds"), "selesai": datetime.now().isoformat(timespec="seconds"),
               "rentang": f"{a.dari} s.d. {a.sampai}", "pratinjau": bool(a.tanpa_simpan or a.hanya_unduh), "bagian": status}
    if getattr(a, "ongkos_dari", None) or getattr(a, "isi_ulang", None):
        catatan["ongkos_pilihan"] = True        # rentang pilihan: tidak menggantikan pembaruan mingguan
    print("@@STATUS " + json.dumps(catatan, ensure_ascii=False))
    try:
        lama = json.loads(RIWAYAT.read_text(encoding="utf-8")) if RIWAYAT.exists() else []
    except ValueError:
        lama = []
    RIWAYAT.write_text(json.dumps((lama + [catatan])[-500:], ensure_ascii=False, indent=1), encoding="utf-8")


class _Tee:
    """Keluaran ke layar (kalau ada) dan ke file log sekaligus."""
    def __init__(self, asli, f):
        self.asli, self.f = asli, f

    def write(self, s):
        for t in (self.asli, self.f):
            if t:
                try:
                    t.write(s)
                    t.flush()
                except Exception:  # noqa: BLE001
                    pass
        return len(s)

    def flush(self):
        pass


def tulis_log_ke(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    f = open(path, "a", encoding="utf-8", buffering=1)
    f.write(f"\n==================== {datetime.now():%Y-%m-%d %H:%M:%S} ====================\n")
    sys.stdout = _Tee(sys.stdout, f)
    sys.stderr = _Tee(sys.stderr, f)


def uji_login(tampil: bool) -> None:
    """Coba login ERP dan SEMENTRACK dengan akun yang tersimpan, lalu keluar."""
    hasil = []
    with sync_playwright() as pw:
        try:
            user = rahasia("ERP_USER", "User ERP")
            pwd = rahasia("ERP_PASS", "Password ERP (tidak tampil)", tersembunyi=True)
            browser, ctx, page = buka_browser(pw, tampil)
            try:
                login_erp(page, user, pwd)
                hasil.append("ERP: berhasil")
            finally:
                browser.close()
        except (SystemExit, Exception) as e:  # noqa: BLE001
            hasil.append("ERP: GAGAL - " + pesan(e).splitlines()[0])
        try:
            browser, page, url = masuk_sementrack(pw, tampil)
            browser.close()
            hasil.append("SEMENTRACK: berhasil")
        except (SystemExit, Exception) as e:  # noqa: BLE001
            hasil.append("SEMENTRACK: GAGAL - " + pesan(e).splitlines()[0])
    print("\n".join(hasil))
    if any("GAGAL" in x for x in hasil):
        raise SystemExit(1)


def jalankan_cli() -> None:
    """Mode baris perintah (dipakai juga oleh aplikasi dan Task Scheduler)."""
    if not os.environ.get("NAT_DARI_APP"):      # dari aplikasi: akun sudah dikirim lewat environment
        baca_akun_lokal()
    if getattr(sys, "frozen", False):
        if sys.stdout is None:            # exe jendela (tanpa konsol): keluaran hanya ke --log
            sys.stdout = sys.stderr = open(os.devnull, "w", encoding="utf-8")
        kode = 0
        try:
            main()
            print("\nSelesai.")
        except SystemExit as e:
            if e.code not in (None, 0):
                print(f"\n{e.code}")
                kode = 1
        except Exception as e:  # noqa: BLE001
            print(f"\nGagal: {type(e).__name__}: {e}")
            kode = 1
        if "--tanpa-jeda" not in sys.argv and sys.stdin and sys.stdin.isatty():
            input("\nTekan Enter untuk menutup...")
        sys.exit(kode)
    main()


if __name__ == "__main__":
    jalankan_cli()
