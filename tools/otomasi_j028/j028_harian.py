"""Unduh J028 dan J028B dari ERP, lalu unggah keduanya ke SEMENTRACK. Sekali jalan, tanpa Excel.

Pakai:
    python j028_harian.py                      # tanggal 1 bulan ini s.d. kemarin
    python j028_harian.py --dari 2026-11-01 --sampai 2026-11-12
    python j028_harian.py --hanya-unduh        # berhenti setelah file terunduh
    python j028_harian.py --tanpa-simpan       # unggah sampai pratinjau saja, tidak menyimpan

Password TIDAK ditulis di file ini. Diambil dari environment variable; kalau kosong, ditanya saat
jalan (ketikan tidak tampil):
    ERP_USER, ERP_PASS            akun ERP (bangunsukses.com)
    SEMENTRACK_URL                alamat web SEMENTRACK, mis. http://localhost:5173
    SEMENTRACK_USER, SEMENTRACK_PASS   akun admin SEMENTRACK

Bagian ERP ditulis dari rekaman Playwright dan BELUM pernah dijalankan terhadap situs aslinya.
Tiga hal yang ditandai PERLU DICEK di bawah harus disesuaikan saat percobaan pertama.
"""
import argparse
import getpass
import os
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from playwright.sync_api import Page, TimeoutError as PWTimeout, sync_playwright

ERP = "https://www.bangunsukses.com"
MATRIX = "01"                    # pilihan di #ContentPlaceHolder1_ddMatrix, sama dengan rekaman
FORMAT_TANGGAL_ERP = "%d %b %Y"  # PERLU DICEK (1): format isi kolom tanggal ERP, mis. "01 Nov 2026"
TUNGGU_JOB_MENIT = 20            # batas menunggu job selesai di View Job
FOLDER = Path(__file__).resolve().parent / "unduhan"
KANAL = os.environ.get("BROWSER_KANAL", "msedge") or None   # browser yang dipakai Playwright; kosongkan untuk Chromium bawaan


def rahasia(nama: str, label: str, tersembunyi: bool = False) -> str:
    v = os.environ.get(nama, "").strip()
    if v:
        return v
    return (getpass.getpass(f"{label}: ") if tersembunyi else input(f"{label}: ")).strip()


def tanggal_erp(d: date) -> str:
    # nama bulan Inggris tiga huruf, tidak tergantung bahasa Windows
    bulan = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.month - 1]
    return d.strftime(FORMAT_TANGGAL_ERP.replace("%b", bulan))


def isi_tanggal(page: Page, selector: str, d: date) -> None:
    """PERLU DICEK (2): di rekaman kolom tanggal hanya diklik (kemungkinan muncul kalender).
    Di sini nilainya diisi langsung lalu Tab. Kalau ERP menolak ketikan, ganti dengan klik kalender."""
    f = page.locator(selector)
    f.click()
    f.fill(tanggal_erp(d))
    f.press("Tab")


def daftar_job(page: Page) -> set[str]:
    page.goto(f"{ERP}/SYS_View_Job.aspx")
    return {t.strip() for t in page.get_by_role("link").all_text_contents() if re.fullmatch(r"J\d+", t.strip())}


def kirim_job(page: Page, menu: str, dari: date, sampai: date) -> None:
    page.locator("#mmlink7").click()
    page.get_by_role("link", name=menu, exact=True).click()
    isi_tanggal(page, "#ContentPlaceHolder1_txtDODate", dari)
    isi_tanggal(page, "#ContentPlaceHolder1_txtEndDODate", sampai)
    page.locator("#ContentPlaceHolder1_ddMatrix").select_option(MATRIX)
    page.get_by_role("button", name="Submit").click()
    page.get_by_role("button", name="OK").click()


def unduh_erp(pw, dari: date, sampai: date, tampil: bool) -> list[Path]:
    user = rahasia("ERP_USER", "User ERP")
    pwd = rahasia("ERP_PASS", "Password ERP (tidak tampil)", tersembunyi=True)
    browser = pw.chromium.launch(channel=KANAL, headless=not tampil)
    ctx = browser.new_context(accept_downloads=True)
    page = ctx.new_page()
    try:
        page.goto(f"{ERP}/index.aspx?redir=SYS_Job_J028.aspx")
        page.locator("#username").fill(user)
        page.locator("#password").fill(pwd)
        page.get_by_role("button", name="Log in").click()
        page.locator("#mmlink7").wait_for(timeout=30_000)

        lama = daftar_job(page)                      # job yang sudah ada sebelum kita mengirim
        kirim_job(page, "J028", dari, sampai)
        kirim_job(page, "J028B", dari, sampai)

        # PERLU DICEK (3): job baru dikenali sebagai tautan "J<angka>" yang belum ada sebelumnya.
        # Kalau View Job menampilkan job yang belum selesai tanpa tautan, cara ini sudah benar;
        # kalau tautannya muncul sebelum file siap, unduhan pertama bisa gagal dan akan dicoba lagi.
        FOLDER.mkdir(exist_ok=True)
        hasil: dict[str, Path] = {}
        batas = time.time() + TUNGGU_JOB_MENIT * 60
        while time.time() < batas and len(hasil) < 2:
            baru = sorted(daftar_job(page) - lama)
            for job in baru:
                if job in hasil:
                    continue
                try:
                    with page.expect_download(timeout=60_000) as info:
                        page.get_by_role("link", name=job, exact=True).click()
                    d = info.value
                    tujuan = FOLDER / d.suggested_filename
                    d.save_as(tujuan)
                    hasil[job] = tujuan
                    print(f"  terunduh: {tujuan.name}")
                except PWTimeout:
                    print(f"  {job} belum siap, dicoba lagi")
            if len(hasil) < 2:
                time.sleep(15)
        if len(hasil) < 2:
            raise SystemExit(f"Job belum selesai setelah {TUNGGU_JOB_MENIT} menit. Yang terunduh: {[p.name for p in hasil.values()]}")
        return list(hasil.values())
    finally:
        ctx.close()
        browser.close()


def periksa_berkas(files: list[Path]) -> None:
    """Harus tepat satu J028 dan satu J028B, dilihat dari baris judulnya."""
    jenis = []
    for f in files:
        judul = f.read_text(encoding="utf-8", errors="replace").splitlines()[0]
        if "Distributor Code" not in judul:
            raise SystemExit(f"{f.name} bukan unduhan J028 / J028B (baris judul tidak dikenal).")
        jenis.append("J028B" if "Distributor Code Clone" in judul else "J028")
    if sorted(jenis) != ["J028", "J028B"]:
        raise SystemExit(f"Butuh satu J028 dan satu J028B, yang ada: {jenis}")


def unggah_sementrack(pw, files: list[Path], simpan: bool, tampil: bool) -> None:
    url = rahasia("SEMENTRACK_URL", "Alamat SEMENTRACK (mis. http://localhost:5173)").rstrip("/")
    user = rahasia("SEMENTRACK_USER", "User SEMENTRACK (admin)")
    pwd = rahasia("SEMENTRACK_PASS", "Password SEMENTRACK (tidak tampil)", tersembunyi=True)
    browser = pw.chromium.launch(channel=KANAL, headless=not tampil)
    page = browser.new_context().new_page()
    try:
        page.goto(url + "/")
        page.locator("input[type=text], input[name=username]").first.fill(user)
        page.locator("input[type=password]").fill(pwd)
        page.keyboard.press("Enter")
        page.wait_for_url("**/overview", timeout=30_000)

        page.goto(url + "/kelola-data")
        page.locator("button", has_text=re.compile(r"^Transaksi")).first.click()
        page.locator("input[type=file]").first.set_input_files([str(f) for f in files])

        # pratinjau: berhenti kalau web menolak file
        page.wait_for_selector("text=/siap disimpan|tidak bisa dipakai|Tidak ada baris/", timeout=120_000)
        if page.locator("text=siap disimpan").count() == 0:
            page.screenshot(path=str(FOLDER / "ditolak.png"), full_page=True)
            raise SystemExit("SEMENTRACK menolak file. Lihat unduhan/ditolak.png")
        if page.locator("input[type=checkbox]").count() > 0:
            page.screenshot(path=str(FOLDER / "ada_baris_tidak_terbaca.png"), full_page=True)
            raise SystemExit("Ada baris yang tidak terbaca. Tidak disimpan otomatis. Lihat unduhan/ada_baris_tidak_terbaca.png")
        print("  pratinjau:", page.locator("text=siap disimpan").first.text_content())
        page.screenshot(path=str(FOLDER / "pratinjau.png"), full_page=True)
        if not simpan:
            print("  --tanpa-simpan: berhenti di pratinjau.")
            return
        page.locator("button", has_text="Simpan ke database").click()
        page.wait_for_selector("text=Data tersimpan", timeout=600_000)
        print("  " + (page.locator("text=baris transaksi untuk").first.text_content() or "").strip())
    finally:
        browser.close()


def main() -> None:
    hari_ini = date.today()
    kemarin = hari_ini - timedelta(days=1)
    ap = argparse.ArgumentParser(description="Unduh J028 + J028B dari ERP lalu unggah ke SEMENTRACK")
    ap.add_argument("--dari", type=date.fromisoformat, default=kemarin.replace(day=1), help="YYYY-MM-DD, bawaan: tanggal 1 bulan dari kemarin")
    ap.add_argument("--sampai", type=date.fromisoformat, default=kemarin, help="YYYY-MM-DD, bawaan: kemarin")
    ap.add_argument("--hanya-unduh", action="store_true")
    ap.add_argument("--tanpa-simpan", action="store_true")
    ap.add_argument("--berkas", nargs=2, type=Path, metavar="FILE", help="lewati ERP, pakai dua file yang sudah ada")
    ap.add_argument("--tanpa-layar", action="store_true", help="browser tidak ditampilkan")
    a = ap.parse_args()
    if a.dari > a.sampai:
        sys.exit("--dari harus sebelum atau sama dengan --sampai")

    with sync_playwright() as pw:
        if a.berkas:
            files = a.berkas
        else:
            print(f"ERP: J028 dan J028B, {a.dari} s.d. {a.sampai}")
            files = unduh_erp(pw, a.dari, a.sampai, tampil=not a.tanpa_layar)
        periksa_berkas(files)
        if a.hanya_unduh:
            return
        print("SEMENTRACK: unggah")
        unggah_sementrack(pw, files, simpan=not a.tanpa_simpan, tampil=not a.tanpa_layar)


if __name__ == "__main__":
    main()
