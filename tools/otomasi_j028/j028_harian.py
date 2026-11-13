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
import getpass
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from playwright.sync_api import Page, TimeoutError as PWTimeout, sync_playwright

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
def j073_dist() -> list[str]:
    return [k.strip() for k in os.environ.get("J073_DIST", "4094,9575").split(",") if k.strip()]


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


def daftar_job(page: Page) -> dict[str, tuple[str, str]]:
    """Isi View Job: {Job ID: (Job Code, Status)}."""
    page.goto(f"{ERP}/SYS_View_Job.aspx")
    try:
        page.wait_for_load_state("networkidle", timeout=60_000)
    except PWTimeout:
        pass
    baris = page.evaluate("() => [...document.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.innerText.trim()))")
    hasil = {}
    for b in baris:
        for i, c in enumerate(b):
            if re.fullmatch(r"J\d{5,}", c) and i + 1 < len(b):
                hasil[c] = (b[i + 1].upper(), (b[i - 1] if i else "").upper())
                break
    return hasil


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
    print(f"  {menu}: job dikirim" + (f" (pesan ERP: {' | '.join(PESAN_ERP)})" if PESAN_ERP else ""))


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
    page.locator("#ContentPlaceHolder1_ddDist").select_option(dist)
    try:
        page.wait_for_load_state("networkidle", timeout=30_000)
    except PWTimeout:
        pass
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
    if pilih != dist:
        raise SystemExit(f"J073: distributor {dist} tidak terpilih (terpilih: {pilih}).\nHalaman: {jejak(page, f'j073_{dist}')}")
    print(f"  J073 {dist}: periode '{a}' s.d. '{b}'")
    kirim_selesai(page, f"J073_{dist}")


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
        self.tiro: dict[str, Path] = {}
        self.dofas: dict[int, str] = {}
        self.subdist: dict[int, str] = {}
        self.gagal: dict[str, str] = {}
        self.berhasil: dict[str, str] = {}

    def catat_gagal(self, bagian: str, e: BaseException) -> None:
        self.gagal[bagian] = pesan(e)
        print(f"  {bagian} GAGAL: {self.gagal[bagian]}")


def ambil_erp(pw, bagian: set[str], dari: date, sampai: date, daftar_bulan: list[date], tampil: bool) -> Hasil:
    """Satu kali login ERP. Job dikirim bergiliran karena antrian ERP paling banyak MAKS_ANTRIAN job per user:
    J028 + J028B dulu, lalu J073 per distributor begitu ada tempat kosong. Sub ERP dibaca sambil menunggu."""
    h = Hasil()
    user = rahasia("ERP_USER", "User ERP")
    pwd = rahasia("ERP_PASS", "Password ERP (tidak tampil)", tersembunyi=True)
    browser, ctx, page = buka_browser(pw, tampil)
    try:
        login_erp(page, user, pwd)
        lama = set(daftar_job(page))                 # job yang sudah ada sebelum kita mengirim
        # antrean kiriman: (bagian, label, kode di View Job, fungsi kirim)
        antre: list[tuple[str, str, str, object]] = []
        if "J028" in bagian:
            antre += [("J028", "J028", "J028", lambda: kirim_job(page, "J028", dari, sampai)),
                      ("J028", "J028B", "J028B", lambda: kirim_job(page, "J028B", dari, sampai))]
        if "J073" in bagian:
            antre += [("J073", f"J073 {d}", "J073", (lambda d=d: kirim_j073(page, d, dari, sampai))) for d in j073_dist()]
        perlu_j028 = 2 if "J028" in bagian else 0
        subdist_selesai = "SUBDIST" not in bagian
        aktif: list[dict] = []                        # sudah dikirim, belum terunduh
        dikenal: set[str] = set()                     # Job ID yang sudah dipasangkan ke kiriman
        FOLDER.mkdir(exist_ok=True)
        batas = time.time() + TUNGGU_JOB_MENIT * 60

        while True:
            # 1. isi antrian ERP sampai penuh
            while antre and len(aktif) < MAKS_ANTRIAN:
                b, label, kode, kirim = antre.pop(0)
                try:
                    kirim()
                    aktif.append({"bagian": b, "label": label, "kode": kode, "waktu": time.time(), "job": None})
                except (SystemExit, Exception) as e:  # noqa: BLE001
                    h.catat_gagal(label, e)
            # 2. Sub ERP selagi job diproses
            if not subdist_selesai:
                subdist_selesai = True
                try:
                    h.subdist = teks_subdist(page, daftar_bulan)
                except (SystemExit, Exception) as e:  # noqa: BLE001
                    h.catat_gagal("Sub ERP", e)
            if not aktif and not antre:
                break
            # 3. cocokkan job baru di View Job dengan kiriman, unduh yang sudah selesai
            daftar = {j: v for j, v in daftar_job(page).items() if j not in lama}
            if daftar:
                print("  View Job: " + ", ".join(f"{j} {k} {st or '?'}" for j, (k, st) in sorted(daftar.items())))
            for j, (kode, _) in sorted(daftar.items()):
                if j in dikenal:
                    continue
                k = next((a for a in aktif if a["job"] is None and a["kode"] == kode), None)
                if k:
                    k["job"] = j
                    dikenal.add(j)
            ada_kemajuan = False
            for a in list(aktif):
                if a["job"] is None:
                    if time.time() - a["waktu"] > 5 * 60:      # tidak pernah muncul: ditolak ERP
                        h.catat_gagal(a["label"], SystemExit(f"Job {a['label']} tidak muncul di View Job setelah dikirim (antrian ERP penuh "
                                                             f"atau form menolak isian). Lihat unduhan/sebelum_submit_{a['label'].replace(' ', '_')}.png."))
                        aktif.remove(a)
                        ada_kemajuan = True
                    continue
                status = daftar.get(a["job"], ("", ""))[1]
                if status and status != "FINISHED":
                    continue
                try:
                    with page.expect_download(timeout=60_000) as info:
                        page.get_by_role("link", name=a["job"], exact=True).click()
                    tujuan = FOLDER / f"{a['job']}-{a['label'].replace(' ', '_')}.TXT"
                    info.value.save_as(tujuan)
                    (h.j073 if a["bagian"] == "J073" else h.j028).append(tujuan)
                    aktif.remove(a)
                    ada_kemajuan = True
                    print(f"  terunduh: {tujuan.name}")
                except PWTimeout:
                    print(f"  {a['job']} belum siap, dicoba lagi")
            if not aktif and not antre:
                break
            if time.time() >= batas:
                for a in aktif:
                    h.catat_gagal(a["label"], SystemExit(f"Job {a['label']} belum selesai setelah {TUNGGU_JOB_MENIT} menit."))
                for _, label, _, _ in antre:
                    h.catat_gagal(label, SystemExit(f"Job {label} belum sempat dikirim dalam {TUNGGU_JOB_MENIT} menit."))
                break
            if ada_kemajuan and antre:
                continue                                 # ada tempat kosong: langsung kirim job berikutnya
            sisa = len(aktif) + len(antre)
            print(f"  {sisa} job belum selesai, cek lagi " + (f"{JEDA_CEK_DETIK // 60} menit" if JEDA_CEK_DETIK >= 60 else f"{JEDA_CEK_DETIK} detik") + " lagi")
            time.sleep(JEDA_CEK_DETIK)

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
                  hentikan_bila: tuple[tuple[str, str], ...] = ()) -> str:
    """Upload lewat Kelola Data (Transaksi / J073): pratinjau, berhenti kalau ditolak, lalu simpan."""
    page.goto(url + alamat)
    page.locator("input[type=file]").first.set_input_files([str(f) for f in files])
    page.wait_for_selector("text=/siap disimpan|tidak bisa dipakai|Tidak ada baris/", timeout=180_000)
    if page.locator("text=siap disimpan").count() == 0:
        page.screenshot(path=str(FOLDER / f"ditolak_{nama}.png"), full_page=True)
        raise SystemExit(f"SEMENTRACK menolak file {nama}. Lihat unduhan/ditolak_{nama}.png")
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
    print("  " + " ".join(page.locator("[role=status]").first.inner_text().split())[:200])
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
    if not kunci_ambil():
        sys.exit("Masih ada proses otomasi lain yang berjalan (dari aplikasi atau jadwal Windows). Coba lagi nanti.")
    mulai = datetime.now()
    print(f"Mulai {mulai:%Y-%m-%d %H:%M} | {', '.join(sorted(bagian))} | {a.dari} s.d. {a.sampai}")
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
        dari_erp = (bagian & {"J028", "J073", "SUBDIST"}) - ({"J028"} if a.berkas else set())
        if dari_erp:
            h2 = ambil_erp(pw, dari_erp, a.dari, a.sampai, daftar_bulan, tampil=not a.tanpa_layar)
            h.j028, h.j073, h.subdist = h2.j028, h2.j073, h2.subdist
            h.gagal.update(h2.gagal)
        if a.berkas:
            h.j028 = list(a.berkas)
        if h.j028:
            try:
                periksa_j028(h.j028)
            except SystemExit as e:
                h.catat_gagal("J028", e)
                h.j028 = []

        ada = h.subdist or h.j028 or h.j073 or h.tiro or h.dofas
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
            for nama, isi in (("Sub ERP", h.subdist), ("DO FAS", h.dofas), ("J028", h.j028), ("J073", h.j073), ("Sell In", h.tiro.get("SELLIN")), ("OS DO", h.tiro.get("OSDO"))):
                if isi:
                    h.berhasil[nama] = "terunduh"


SEMUA_BAGIAN = {"J028", "J073", "SUBDIST", "SELLIN", "OSDO", "DOFAS"}
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


def kunci_lepas() -> None:
    try:
        KUNCI.unlink()
    except OSError:
        pass
NAMA_BAGIAN = {"J028": "J028", "J073": "J073", "SUBDIST": "Sub ERP", "SELLIN": "Sell In", "OSDO": "OS DO", "DOFAS": "DO FAS"}


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
