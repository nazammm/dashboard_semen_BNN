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
BULAN_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
BULAN_ID = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"]
TUNGGU_JOB_MENIT = 30            # batas menunggu semua job selesai di View Job
JEDA_CEK_DETIK = int(os.environ.get("JEDA_CEK_DETIK", "180"))   # View Job dicek ulang tiap 3 menit
# J073: distributor yang diunduh (kode ERP). INSA = 4094, PKB = 9575. Bisa diubah lewat J073_DIST=4094,9575
J073_DIST = [k.strip() for k in os.environ.get("J073_DIST", "4094,9575").split(",") if k.strip()]
# folder skrip, atau folder file .exe kalau dijalankan sebagai exe (PyInstaller)
DASAR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
FOLDER = DASAR / "unduhan"
KANAL = os.environ.get("BROWSER_KANAL", "msedge") or None   # browser yang dipakai Playwright; kosongkan untuk Chromium bawaan


def baca_akun_lokal() -> None:
    """akun_lokal.txt (NAMA=nilai per baris, # = komentar). Environment variable yang sudah ada tidak ditimpa."""
    f = DASAR / "akun_lokal.txt"
    if not f.exists():
        return
    for baris in f.read_text(encoding="utf-8-sig").splitlines():
        baris = baris.strip()
        if not baris or baris.startswith("#") or "=" not in baris:
            continue
        k, v = baris.split("=", 1)
        if v.strip():
            os.environ.setdefault(k.strip(), v.strip())


def rahasia(nama: str, label: str, tersembunyi: bool = False) -> str:
    v = os.environ.get(nama, "").strip()
    if v:
        return v
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
    page.get_by_role("button", name="Submit").click()
    try:
        page.get_by_role("button", name="OK").click(timeout=15_000)
    except PWTimeout:
        print(f"  {menu}: tidak ada tombol OK setelah Submit, lanjut. Halaman: {jejak(page, f'setelah_submit_{menu}')}")
    print(f"  {menu}: job dikirim")


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


def buka_browser(pw, tampil: bool):
    browser = pw.chromium.launch(channel=KANAL, headless=not tampil)
    ctx = browser.new_context(accept_downloads=True)
    return browser, ctx, ctx.new_page()


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
        self.subdist: dict[int, str] = {}
        self.gagal: dict[str, str] = {}

    def catat_gagal(self, bagian: str, e: BaseException) -> None:
        self.gagal[bagian] = pesan(e)
        print(f"  {bagian} GAGAL: {self.gagal[bagian]}")


def ambil_erp(pw, bagian: set[str], dari: date, sampai: date, daftar_bulan: list[date], tampil: bool) -> Hasil:
    """Satu kali login ERP: kirim semua job, baca Sub ERP selagi job diproses, lalu unduh semua hasil job."""
    h = Hasil()
    user = rahasia("ERP_USER", "User ERP")
    pwd = rahasia("ERP_PASS", "Password ERP (tidak tampil)", tersembunyi=True)
    browser, ctx, page = buka_browser(pw, tampil)
    try:
        login_erp(page, user, pwd)
        lama = set(daftar_job(page))                 # job yang sudah ada sebelum kita mengirim
        harap = {"J028": 0, "J073": 0}               # jumlah job yang ditunggu per bagian
        if "J028" in bagian:
            try:
                kirim_job(page, "J028", dari, sampai)
                kirim_job(page, "J028B", dari, sampai)
                harap["J028"] = 2
            except (SystemExit, Exception) as e:  # noqa: BLE001
                h.catat_gagal("J028", e)
        if "J073" in bagian:
            for dist in J073_DIST:
                try:
                    kirim_j073(page, dist, dari, sampai)
                    harap["J073"] += 1
                except (SystemExit, Exception) as e:  # noqa: BLE001
                    h.catat_gagal(f"J073 {dist}", e)
        if "SUBDIST" in bagian:                       # dikerjakan sambil menunggu job di server ERP
            try:
                h.subdist = teks_subdist(page, daftar_bulan)
            except (SystemExit, Exception) as e:  # noqa: BLE001
                h.catat_gagal("Sub ERP", e)

        jumlah = sum(harap.values())
        if not jumlah:
            return h
        FOLDER.mkdir(exist_ok=True)
        terunduh: dict[str, str] = {}                 # Job ID -> Job Code
        batas = time.time() + TUNGGU_JOB_MENIT * 60
        while True:
            for job, (kode, status) in sorted(daftar_job(page).items()):
                if job in lama or job in terunduh or (status and status != "FINISHED"):
                    continue
                try:
                    with page.expect_download(timeout=60_000) as info:
                        page.get_by_role("link", name=job, exact=True).click()
                    d = info.value
                    tujuan = FOLDER / f"{job}-{kode}.TXT"
                    d.save_as(tujuan)
                    terunduh[job] = kode
                    (h.j073 if kode.startswith("J073") else h.j028).append(tujuan)
                    print(f"  terunduh: {tujuan.name}")
                except PWTimeout:
                    print(f"  {job} belum siap, dicoba lagi")
            if len(terunduh) >= jumlah or time.time() >= batas:
                break
            print(f"  {len(terunduh)}/{jumlah} job terunduh, cek lagi " + (f"{JEDA_CEK_DETIK // 60} menit" if JEDA_CEK_DETIK >= 60 else f"{JEDA_CEK_DETIK} detik") + " lagi")
            time.sleep(JEDA_CEK_DETIK)
        if len(h.j028) < harap["J028"]:
            h.catat_gagal("J028", SystemExit(f"Job J028/J028B belum selesai setelah {TUNGGU_JOB_MENIT} menit."))
            h.j028 = []
        if len(h.j073) < harap["J073"]:
            h.catat_gagal("J073", SystemExit(f"{len(h.j073)} dari {harap['J073']} job J073 selesai dalam {TUNGGU_JOB_MENIT} menit."))
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


def tempel_subdist(page: Page, url: str, per_tahun: dict[int, str], simpan: bool, paksa: bool) -> None:
    for tahun, teks in sorted(per_tahun.items()):
        page.goto(url + "/kelola-data?data=sellout&menu=erp")
        pilih = page.locator("#so-erp-th")
        pilih.wait_for(timeout=30_000)
        if pilih.locator(f"option[value='{tahun}']").count() == 0:
            raise SystemExit(f"Tahun {tahun} tidak bisa dipilih di Tempel Sub ERP (hanya tahun ini dan tahun lalu).")
        pilih.select_option(str(tahun))
        page.locator("#so-erp-paste").fill(teks)
        page.get_by_role("button", name="Periksa data").click()
        tombol = page.get_by_role("button", name=f"Simpan Sub ERP {tahun}")
        page.locator(f"[role=alert], button:has-text('Simpan Sub ERP {tahun}')").first.wait_for(timeout=60_000)
        if not tombol.count():
            page.screenshot(path=str(FOLDER / "subdist_ditolak.png"), full_page=True)
            raise SystemExit("SEMENTRACK menolak tempelan Sub ERP: " + page.locator("[role=alert]").first.inner_text() + "\nLihat unduhan/subdist_ditolak.png")
        page.screenshot(path=str(FOLDER / f"pratinjau_subdist_{tahun}.png"), full_page=True)
        if page.get_by_text("baris dilewati").count():
            raise SystemExit(f"Ada baris Sub ERP yang tidak terbaca. Tidak disimpan otomatis. Lihat unduhan/pratinjau_subdist_{tahun}.png")
        if page.get_by_text("Lebih kecil dari yang tersimpan").count() and not paksa:
            raise SystemExit(f"Ada angka Sub ERP yang lebih kecil dari yang sudah tersimpan. Tidak disimpan otomatis; cek unduhan/pratinjau_subdist_{tahun}.png, "
                             "lalu jalankan lagi dengan --paksa kalau memang koreksi.")
        print("  " + page.get_by_text(re.compile(r"akan diganti; bulan lain tetap")).first.inner_text())
        if not simpan:
            print("  --tanpa-simpan: berhenti di pratinjau.")
            continue
        tombol.click()
        page.get_by_text(f"Sub ERP {tahun} tersimpan").wait_for(timeout=120_000)
        print("  " + page.get_by_text(re.compile(r"baris \(.* ton\) menggantikan")).first.inner_text())


def unggah_berkas(page: Page, url: str, alamat: str, files: list[Path], nama: str, simpan: bool, tolak_baris_rusak: bool) -> None:
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
    print("  pratinjau:", page.locator("text=siap disimpan").first.text_content())
    if not simpan:
        print("  --tanpa-simpan: berhenti di pratinjau.")
        return
    page.locator("button", has_text="Simpan ke database").click()
    page.wait_for_selector("text=Data tersimpan", timeout=600_000)
    print("  " + " ".join(page.locator("[role=status]").first.inner_text().split())[:200])


def main() -> None:
    hari_ini = date.today()
    kemarin = hari_ini - timedelta(days=1)
    ap = argparse.ArgumentParser(description="Ambil J028 + J028B, J073, dan Sub ERP dari ERP lalu masukkan ke SEMENTRACK")
    ap.add_argument("--dari", type=date.fromisoformat, default=kemarin.replace(day=1), help="YYYY-MM-DD, bawaan: tanggal 1 bulan dari kemarin")
    ap.add_argument("--sampai", type=date.fromisoformat, default=kemarin, help="YYYY-MM-DD, bawaan: kemarin")
    ap.add_argument("--sampai-hari-ini", action="store_true", help="data sampai hari ini (untuk jadwal beberapa jam sekali)")
    ap.add_argument("--subdist", action="store_true", help="Sub ERP saja")
    ap.add_argument("--j073", action="store_true", help="J073 saja")
    ap.add_argument("--semua", action="store_true", help="J028, J073, dan Sub ERP sekaligus")
    ap.add_argument("--bulan", nargs="+", metavar="YYYY-MM", help="bulan Sub ERP, bawaan: bulan-bulan dari --dari s.d. --sampai")
    ap.add_argument("--hanya-unduh", action="store_true", help="ambil dari ERP saja, tidak masuk SEMENTRACK")
    ap.add_argument("--tanpa-simpan", action="store_true", help="di SEMENTRACK berhenti di pratinjau")
    ap.add_argument("--berkas", nargs=2, type=Path, metavar="FILE", help="J028: lewati ERP, pakai dua file yang sudah ada")
    ap.add_argument("--paksa", action="store_true", help="Sub ERP tetap disimpan walau ada angka yang turun")
    ap.add_argument("--tanpa-layar", action="store_true", help="browser tidak ditampilkan")
    ap.add_argument("--tanpa-jeda", action="store_true", help="exe langsung tertutup setelah selesai (untuk jadwal)")
    a = ap.parse_args()
    if a.sampai_hari_ini:
        a.sampai = hari_ini
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

    bagian = {"J028", "J073", "SUBDIST"} if a.semua else {"SUBDIST"} if a.subdist else {"J073"} if a.j073 else {"J028"}
    print(f"Mulai {datetime.now():%Y-%m-%d %H:%M} | {', '.join(sorted(bagian))} | {a.dari} s.d. {a.sampai}")

    with sync_playwright() as pw:
        dari_erp = bagian - ({"J028"} if a.berkas else set())
        h = ambil_erp(pw, dari_erp, a.dari, a.sampai, daftar_bulan, tampil=not a.tanpa_layar) if dari_erp else Hasil()
        if a.berkas:
            h.j028 = list(a.berkas)
        if h.j028:
            try:
                periksa_j028(h.j028)
            except SystemExit as e:
                h.catat_gagal("J028", e)
                h.j028 = []

        ada = h.subdist or h.j028 or h.j073
        if ada and not a.hanya_unduh:
            browser, page, url = masuk_sementrack(pw, not a.tanpa_layar)
            try:
                langkah = [
                    ("Sub ERP", h.subdist, lambda: tempel_subdist(page, url, h.subdist, not a.tanpa_simpan, a.paksa)),
                    ("J028", h.j028, lambda: unggah_berkas(page, url, "/kelola-data?data=transaksi&menu=upload", h.j028, "J028", not a.tanpa_simpan, True)),
                    # J073: satu file per distributor; tiap file mengganti data distributor itu pada rentang tanggalnya
                    ("J073", h.j073, lambda: [unggah_berkas(page, url, "/kelola-data?data=sellout&menu=j073", [f], f.stem, not a.tanpa_simpan, True) for f in h.j073]),
                ]
                for nama, isi, kerja in langkah:
                    if not isi:
                        continue
                    print(f"SEMENTRACK: {nama}")
                    try:
                        kerja()
                    except (SystemExit, Exception) as e:  # noqa: BLE001 - bagian lain tetap jalan
                        h.catat_gagal(nama, e)
            finally:
                browser.close()

    if h.gagal:
        raise SystemExit("Selesai dengan kegagalan:\n" + "\n".join(f"- {k}: {v}" for k, v in h.gagal.items()))
    print("Semua bagian berhasil.")


if __name__ == "__main__":
    baca_akun_lokal()
    if getattr(sys, "frozen", False):
        # dijalankan dari exe (biasanya diklik dua kali): jendela jangan langsung tertutup
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
        if "--tanpa-jeda" not in sys.argv:
            input("\nTekan Enter untuk menutup...")
        sys.exit(kode)
    main()
