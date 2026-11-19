"""Nazam Auto Task: aplikasi desktop untuk otomasi ERP -> SEMENTRACK (J028 + J028B, J073, Sub ERP).

Tanpa argumen: membuka aplikasi. Dengan argumen: mode baris perintah (sama dengan j028_harian.py),
dipakai oleh aplikasi sendiri dan oleh jadwal Windows (Task Scheduler).
"""
import json
import os
import queue
import re
import subprocess
import sys
import threading
import webbrowser
from datetime import date, datetime, timedelta
from pathlib import Path

import j028_harian as mesin

APP = "Nazam Auto Task"
VERSI = "1.0"
DASAR = mesin.DASAR
FOLDER = mesin.FOLDER
LOG = FOLDER / "log.txt"
SETELAN = DASAR / "pengaturan.json"
NAMA_TUGAS = "Nazam Auto Task"
BAGIAN = [("J028", "J028 + J028B", "Transaksi toko (Kelola Data → Transaksi)"),
          ("J073", "J073", "Gudang INSA & PKB (Sell Out BNN)"),
          ("SUBDIST", "Sub ERP", "Penjualan subdist (Sell Out BNN)"),
          ("SELLIN", "Sell In", "TIRO, per tanggal pengiriman"),
          ("OSDO", "Outstanding DO", "TIRO, per tanggal order"),
          ("DOFAS", "DO FAS", "Rekap DO harian (folder korin)"),
          ("STOCK", "Stock", "Stock semen bulan berjalan (folder b236)"),
          ("ONGKOS", "Ongkos kirim", "J073 + ORDB019 semua distributor, seminggu sekali")]
NAMA_RIWAYAT = {"J028": "J028", "J073": "J073", "SUBDIST": "Sub ERP", "SELLIN": "Sell In", "OSDO": "OS DO", "DOFAS": "DO FAS", "STOCK": "Stock", "ONGKOS": "Ongkos kirim"}
BAWAAN = {"jadwal_aktif": False, "tiap_jam": 4, "jam_mulai": "07:00", "bagian": ["J028", "J073", "SUBDIST"],
          "tampilkan_browser": False, "paksa_subdist": False}

# warna
C = {"bg": "#f3f5f4", "side": "#123a2f", "side_hi": "#1d5444", "side_txt": "#cfe3db", "gold": "#d4a72c",
     "card": "#ffffff", "line": "#dfe5e2", "txt": "#16231f", "muted": "#61716b", "pri": "#1e7a5c", "pri_hi": "#176249",
     "ok": "#15935f", "bad": "#cf3a2c", "warn": "#c98a12", "log_bg": "#0f1d19", "log_txt": "#d6e6df"}


def tanggal_id(d: date) -> str:
    return f"{d.day} {['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][d.month - 1]} {d.year}"


def rentang_teks(teks: str) -> str:
    """"2026-11-01 s.d. 2026-11-13" -> "1–13 Nov 2026"."""
    try:
        a, b = (date.fromisoformat(x.strip()) for x in teks.split("s.d."))
    except ValueError:
        return teks
    if (a.year, a.month) == (b.year, b.month):
        return f"{a.day}–{tanggal_id(b)}"
    return f"{tanggal_id(a)} – {tanggal_id(b)}"


def rentang_bawaan() -> tuple[date, date]:
    h = date.today()
    return ((h - timedelta(days=1)).replace(day=1) if h.day == 1 else h.replace(day=1)), h


def perintah_dasar() -> list[str]:
    """Cara memanggil mesin: exe ini sendiri (mode baris perintah) atau python + skrip."""
    if getattr(sys, "frozen", False):
        return [sys.executable]
    return [sys.executable, str(Path(__file__).resolve())]


def baca_setelan() -> dict:
    try:
        return {**BAWAAN, **json.loads(SETELAN.read_text(encoding="utf-8"))}
    except (OSError, ValueError):
        return dict(BAWAAN)


def simpan_setelan(s: dict) -> None:
    SETELAN.write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")


def simpan_akun(nilai: dict[str, str]) -> None:
    """akun_lokal.txt: password terenkripsi Windows (hanya bisa dibuka akun Windows ini)."""
    baris = ["# Ditulis oleh Nazam Auto Task. Password terenkripsi; ubah lewat Pengaturan di aplikasi."]
    for k in ("ERP_USER", "SEMENTRACK_URL", "SEMENTRACK_USER", "TIRO_USER", "J073_DIST", "ONGKOS_DIST", "ONGKOS_FOLDER", "DOFAS_FILE", "STOCK_FILE"):
        baris.append(f"{k}={nilai.get(k, '').strip()}")
    for k in ("ERP_PASS", "SEMENTRACK_PASS", "TIRO_PASS"):
        v = nilai.get(k, "")
        baris.append(f"{k}_ENC={mesin.sandi_kunci(v)}" if v else f"{k}=")
    mesin.AKUN_LOKAL.write_text("\n".join(baris) + "\n", encoding="utf-8")


def baca_riwayat() -> list[dict]:
    try:
        return json.loads(mesin.RIWAYAT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []


def jalankan_aplikasi() -> None:
    import tkinter as tk
    from tkinter import messagebox, ttk
    from tkinter import font as tkfont

    class Toast:
        """Pemberitahuan kecil di pojok kanan bawah layar, hilang sendiri."""
        def __init__(self, root, judul: str, isi: str, warna: str):
            w = tk.Toplevel(root)
            w.overrideredirect(True)
            w.attributes("-topmost", True)
            f = tk.Frame(w, bg=C["card"], highlightthickness=1, highlightbackground=C["line"])
            f.pack()
            tk.Frame(f, bg=warna, width=6).pack(side="left", fill="y")
            isi_f = tk.Frame(f, bg=C["card"], padx=14, pady=10)
            isi_f.pack(side="left")
            tk.Label(isi_f, text=judul, bg=C["card"], fg=C["txt"], font=root.f_bold).pack(anchor="w")
            tk.Label(isi_f, text=isi, bg=C["card"], fg=C["muted"], font=root.f_kecil, justify="left", wraplength=320).pack(anchor="w")
            w.update_idletasks()
            x = w.winfo_screenwidth() - w.winfo_width() - 24
            y = w.winfo_screenheight() - w.winfo_height() - 72
            w.geometry(f"+{x}+{y}")
            w.after(7000, w.destroy)
            w.bind("<Button-1>", lambda e: (w.destroy(), root.deiconify(), root.lift()))

    class PilihDist(tk.Frame):
        """Centang distributor (kode ERP · nama), dengan tombol Semua / Kosongkan."""
        def __init__(self, induk, app, terpilih: list[str], kolom: int = 4):
            super().__init__(induk, bg=C["card"])
            self.saat_berubah = None
            terpilih = {x.strip().upper() for x in terpilih if x.strip()}
            self.v = {}
            grid = tk.Frame(self, bg=C["card"])
            grid.pack(anchor="w")
            for i, (kode, nama) in enumerate(mesin.DAFTAR_DIST):
                v = tk.BooleanVar(value=kode in terpilih)
                ttk.Checkbutton(grid, text=f"{nama} · {kode}", variable=v, command=self._ubah).grid(row=i // kolom, column=i % kolom, sticky="w", padx=(0, 12), pady=1)
                self.v[kode] = v
            b = tk.Frame(self, bg=C["card"])
            b.pack(anchor="w", pady=(4, 0))
            for teks, nilai in (("Semua", True), ("Kosongkan", False)):
                t = tk.Label(b, text=teks, bg=C["card"], fg=C["pri"], cursor="hand2", font=app.f_kecil)
                t.pack(side="left", padx=(0, 12))
                t.bind("<Button-1>", lambda _e, n=nilai: self.semua(n))

        def semua(self, nilai: bool):
            for v in self.v.values():
                v.set(nilai)
            self._ubah()

        def pilihan(self) -> list[str]:
            return [k for k, _ in mesin.DAFTAR_DIST if self.v[k].get()]

        def _ubah(self):
            if self.saat_berubah:
                self.saat_berubah(self.pilihan())

    class Kalender(tk.Toplevel):
        """Kalender kecil di bawah kolom tanggal: ‹ › ganti bulan, klik tanggal untuk memilih."""
        HARI = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]
        BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]

        def __init__(self, induk, nilai: date, saat_pilih, batas: date | None = None):
            super().__init__(induk)
            self.overrideredirect(True)
            self.attributes("-topmost", True)
            self.saat_pilih, self.batas, self.nilai = saat_pilih, batas, nilai
            self.tampil = nilai.replace(day=1)
            self.kotak = tk.Frame(self, bg=C["card"], highlightthickness=1, highlightbackground=C["line"], padx=8, pady=8)
            self.kotak.pack()
            x, y = induk.winfo_rootx(), induk.winfo_rooty() + induk.winfo_height() + 2
            self.geometry(f"+{x}+{y}")
            self.gambar()
            self.bind("<Escape>", lambda _e: self.destroy())
            self.bind("<FocusOut>", lambda _e: self.after(150, self._tutup_kalau_lepas))
            self.focus_force()

        def _tutup_kalau_lepas(self):
            try:
                if self.focus_get() is None:
                    self.destroy()
            except (KeyError, tk.TclError):
                self.destroy()

        def geser(self, n: int):
            k = self.tampil.year * 12 + self.tampil.month - 1 + n
            self.tampil = date(k // 12, k % 12 + 1, 1)
            self.gambar()

        def gambar(self):
            import calendar
            for w in self.kotak.winfo_children():
                w.destroy()
            atas = tk.Frame(self.kotak, bg=C["card"])
            atas.grid(row=0, column=0, columnspan=7, sticky="ew", pady=(0, 6))
            for teks, n, sisi in (("«", -12, "left"), ("‹", -1, "left"), ("»", 12, "right"), ("›", 1, "right")):
                t = tk.Label(atas, text=teks, bg=C["card"], fg=C["pri"], cursor="hand2", font=("Segoe UI", 12, "bold"), padx=4)
                t.pack(side=sisi)
                t.bind("<Button-1>", lambda _e, n=n: self.geser(n))
            tk.Label(atas, text=f"{self.BULAN[self.tampil.month - 1]} {self.tampil.year}", bg=C["card"], fg=C["txt"],
                     font=("Segoe UI", 10, "bold")).pack(side="left", expand=True)
            for i, h in enumerate(self.HARI):
                tk.Label(self.kotak, text=h, bg=C["card"], fg=C["muted"], width=4, font=("Segoe UI", 8)).grid(row=1, column=i)
            for r, minggu in enumerate(calendar.Calendar(firstweekday=0).monthdatescalendar(self.tampil.year, self.tampil.month)):
                for c, d in enumerate(minggu):
                    lain = d.month != self.tampil.month
                    mati = self.batas is not None and d > self.batas
                    pilih = d == self.nilai
                    t = tk.Label(self.kotak, text=str(d.day), width=4, pady=3, cursor="" if mati else "hand2",
                                 bg=C["pri"] if pilih else C["card"], fg="#ffffff" if pilih else (C["line"] if mati else (C["muted"] if lain else C["txt"])))
                    t.grid(row=r + 2, column=c, padx=1, pady=1)
                    if not mati:
                        t.bind("<Button-1>", lambda _e, d=d: (self.saat_pilih(d), self.destroy()))

    class KolomTanggal(tk.Frame):
        """Kolom tanggal yang dipilih lewat kalender (tidak diketik)."""
        def __init__(self, induk, nilai: date, saat_ubah=None, bulan_saja: bool = False, batas: date | None = None):
            super().__init__(induk, bg=C["card"], highlightthickness=1, highlightbackground=C["line"], cursor="hand2")
            self.nilai, self.saat_ubah, self.bulan_saja, self.batas = nilai, saat_ubah, bulan_saja, batas
            self.lbl = tk.Label(self, bg=C["card"], fg=C["txt"], padx=8, pady=4, width=13 if not bulan_saja else 15, anchor="w")
            self.lbl.pack(side="left")
            tombol = tk.Label(self, text="📅", bg=C["card"], fg=C["pri"], padx=6)
            tombol.pack(side="left")
            for w in (self, self.lbl, tombol):
                w.bind("<Button-1>", lambda _e: Kalender(self, self.nilai, self.set, self.batas))
            self.tulis()

        def tulis(self):
            self.lbl.config(text=f"{Kalender.BULAN[self.nilai.month - 1]} {self.nilai.year}" if self.bulan_saja else tanggal_id(self.nilai))

        def set(self, d: date):
            self.nilai = d.replace(day=1) if self.bulan_saja else d
            self.tulis()
            if self.saat_ubah:
                self.saat_ubah()

    class DialogOngkos(tk.Toplevel):
        """Ambil ongkos kirim: pilih distributor (centang), lalu rentang tanggal (maks 3 bulan) atau isi data lama sejak bulan tertentu."""
        def __init__(self, app):
            super().__init__(app)
            self.app = app
            self.title("Ambil ongkos kirim")
            self.configure(bg=C["bg"])
            self.resizable(False, False)
            self.transient(app)
            hari = date.today()
            st = app.setelan
            f = tk.Frame(self, bg=C["card"], padx=20, pady=16, highlightthickness=1, highlightbackground=C["line"])
            f.pack(padx=14, pady=14, fill="both")
            tk.Label(f, text="Ambil ongkos kirim (J073 + ORDB019)", bg=C["card"], fg=C["txt"], font=app.f_bold).grid(row=0, column=0, columnspan=4, sticky="w")

            tk.Label(f, text="Distributor", bg=C["card"], fg=C["muted"]).grid(row=1, column=0, sticky="nw", pady=(12, 0))
            awal = st.get("dialog_dist") or app.v_akun["ONGKOS_DIST"].get().split(",")
            self.dist = PilihDist(f, app, awal, kolom=4)
            self.dist.grid(row=1, column=1, columnspan=3, sticky="w", pady=(12, 0))
            self.dist.saat_berubah = lambda _p: self.hitung()

            self.mode = tk.StringVar(value=st.get("dialog_mode", "rentang"))
            tk.Label(f, text="Waktu", bg=C["card"], fg=C["muted"]).grid(row=2, column=0, sticky="nw", pady=(14, 0))
            w = tk.Frame(f, bg=C["card"])
            w.grid(row=2, column=1, columnspan=3, sticky="w", pady=(14, 0))
            ttk.Radiobutton(w, text="Rentang tanggal (paling panjang 3 bulan)", value="rentang", variable=self.mode, command=self.hitung).grid(row=0, column=0, columnspan=4, sticky="w")
            r = tk.Frame(w, bg=C["card"])
            r.grid(row=1, column=0, columnspan=4, sticky="w", padx=(24, 0), pady=(4, 8))
            def tgl(kunci, bawaan):
                try:
                    return date.fromisoformat(st.get(kunci, ""))
                except ValueError:
                    return bawaan
            self.dari = KolomTanggal(r, tgl("rentang_dari", hari.replace(day=1)), self.hitung, batas=hari)
            self.dari.pack(side="left")
            tk.Label(r, text="s.d.", bg=C["card"], fg=C["muted"], padx=8).pack(side="left")
            self.sampai = KolomTanggal(r, tgl("rentang_sampai", hari), self.hitung, batas=hari)
            self.sampai.pack(side="left")
            ttk.Radiobutton(w, text="Isi data lama sejak bulan ini sampai hari ini (per 3 bulan, bisa dilanjutkan)", value="isi_ulang",
                            variable=self.mode, command=self.hitung).grid(row=2, column=0, columnspan=4, sticky="w")
            r2 = tk.Frame(w, bg=C["card"])
            r2.grid(row=3, column=0, columnspan=4, sticky="w", padx=(24, 0), pady=(4, 0))
            self.mulai = KolomTanggal(r2, tgl("isi_ulang_dari", date(2025, 1, 1)), self.hitung, bulan_saja=True, batas=hari)
            self.mulai.pack(side="left")

            self.info = tk.Label(f, text="", bg=C["card"], fg=C["muted"], font=app.f_kecil, justify="left", wraplength=560)
            self.info.grid(row=3, column=0, columnspan=4, sticky="w", pady=(14, 0))
            b = tk.Frame(f, bg=C["card"])
            b.grid(row=4, column=0, columnspan=4, sticky="e", pady=(14, 0))
            app.tombol(b, "Batal", self.destroy).pack(side="right")
            self.b_jalan = app.tombol(b, "▶  Jalankan", self.jalan, utama=True)
            self.b_jalan.pack(side="right", padx=(0, 8))
            self.hitung()
            self.grab_set()

        def hitung(self):
            dists = self.dist.pilihan()
            self.galat = None
            if not dists:
                self.galat = "Centang minimal satu distributor."
            elif self.mode.get() == "rentang":
                try:
                    sampai, _ = mesin.cek_rentang_ongkos(self.dari.nilai, self.sampai.nilai, ",".join(dists))
                    k = mesin.kiriman_rentang(self.dari.nilai, sampai, dists)
                    bln = len({x["bulan"] for x in k if x["jenis"] == "ORDB"})
                    teks = (f"{len(dists)} distributor × (1 J073 + {bln} ORDB019) = {len(k)} job/laporan, "
                            f"{tanggal_id(self.dari.nilai)} – {tanggal_id(sampai)}.")
                except ValueError as e:
                    self.galat = str(e).replace("Ongkos kirim: ", "")
            else:
                k = mesin.kiriman_ongkos(date.today(), dists, self.mulai.nilai)
                sisa = [x for x in k if x["kunci"] not in mesin.baca_isi_ulang()]
                teks = (f"{len(dists)} distributor, sejak {Kalender.BULAN[self.mulai.nilai.month - 1]} {self.mulai.nilai.year}: "
                        f"{len(k)} job/laporan (J073 per 3 bulan, ORDB019 per bulan), {len(k) - len(sisa)} sudah masuk, {len(sisa)} dikerjakan.")
            if self.galat:
                self.info.config(text=self.galat, fg=C["bad"])
            else:
                self.info.config(fg=C["muted"], text=teks + "\nYang sudah ada di folder salinan atau di View Report tidak diunduh lagi. "
                                 "Antrian ERP paling banyak 2 sekaligus; laporan yang belum muncul ditunggu sampai 30 menit sebelum diminta ulang.")
            self.app.aktif(self.b_jalan, not self.galat)

        def jalan(self):
            self.hitung()
            if self.galat:
                return
            dists = self.dist.pilihan()
            self.app.setelan.update(dialog_dist=dists, dialog_mode=self.mode.get(), rentang_dari=f"{self.dari.nilai}",
                                    rentang_sampai=f"{self.sampai.nilai}", isi_ulang_dari=f"{self.mulai.nilai}")
            simpan_setelan(self.app.setelan)
            if self.mode.get() == "rentang":
                sampai, _ = mesin.cek_rentang_ongkos(self.dari.nilai, self.sampai.nilai, ",".join(dists))
                argumen = ["--ongkos-dari", f"{self.dari.nilai}", "--ongkos-sampai", f"{sampai}", "--ongkos-dist", ",".join(dists)]
            else:
                argumen = ["--isi-ulang", f"{self.mulai.nilai:%Y-%m}", "--ongkos-dist", ",".join(dists)]
            self.destroy()
            self.app.jalankan_ongkos(argumen)

    class Kartu(tk.Frame):
        def __init__(self, induk, judul: str, sub: str):
            super().__init__(induk, bg=C["card"], highlightthickness=1, highlightbackground=C["line"], padx=16, pady=14)
            atas = tk.Frame(self, bg=C["card"])
            atas.pack(fill="x")
            self.titik = tk.Label(atas, text="●", bg=C["card"], fg=C["line"], font=induk.winfo_toplevel().f_teks)
            self.titik.pack(side="left")
            tk.Label(atas, text=judul, bg=C["card"], fg=C["txt"], font=induk.winfo_toplevel().f_bold).pack(side="left", padx=(6, 0))
            tk.Label(self, text=sub, bg=C["card"], fg=C["muted"], font=induk.winfo_toplevel().f_kecil, anchor="w", justify="left",
                     wraplength=170).pack(anchor="w", fill="x", pady=(2, 8))
            self.status = tk.Label(self, text="Belum jalan", bg=C["card"], fg=C["txt"], font=induk.winfo_toplevel().f_besar)
            self.status.pack(anchor="w")
            self.waktu = tk.Label(self, text="", bg=C["card"], fg=C["muted"], font=induk.winfo_toplevel().f_kecil, anchor="w")
            self.waktu.pack(anchor="w", fill="x")
            self.pesan = tk.Label(self, text="", bg=C["card"], fg=C["muted"], font=induk.winfo_toplevel().f_kecil,
                                  justify="left", wraplength=180, anchor="w")
            self.pesan.pack(anchor="w", fill="x", pady=(6, 0))

        def isi(self, catatan: dict | None, bagian: dict | None):
            if not catatan or not bagian:
                self.titik.config(fg=C["line"])
                self.status.config(text="Belum jalan", fg=C["txt"])
                self.waktu.config(text="")
                self.pesan.config(text="")
                return
            ok = bagian.get("ok")
            pratinjau = catatan.get("pratinjau")
            self.titik.config(fg=C["ok"] if ok and not pratinjau else C["warn"] if ok else C["bad"])
            self.status.config(text=("Pratinjau saja" if pratinjau else "Berhasil") if ok else "Gagal", fg=C["txt"] if ok else C["bad"])
            t = datetime.fromisoformat(catatan["selesai"])
            self.waktu.config(text=f"{tanggal_id(t.date())}, {t:%H:%M}")
            self.pesan.config(text=(bagian.get("pesan") or "")[:220])

    class App(tk.Tk):
        def __init__(self):
            super().__init__()
            self.title(APP)
            self.geometry("1180x800")
            self.minsize(1040, 720)
            self.configure(bg=C["bg"])
            ikon = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)) / "ikon.ico"
            if ikon.exists() and os.name == "nt":
                self.iconbitmap(str(ikon))
            dasar = "Segoe UI" if os.name == "nt" else "DejaVu Sans"
            mono = "Consolas" if os.name == "nt" else "DejaVu Sans Mono"
            self.f_teks = tkfont.Font(family=dasar, size=10)
            self.f_kecil = tkfont.Font(family=dasar, size=9)
            self.f_bold = tkfont.Font(family=dasar, size=10, weight="bold")
            self.f_besar = tkfont.Font(family=dasar, size=15, weight="bold")
            self.f_judul = tkfont.Font(family=dasar, size=20, weight="bold")
            self.f_logo = tkfont.Font(family=dasar, size=14, weight="bold")
            self.f_mono = tkfont.Font(family=mono, size=9)
            self.option_add("*Font", self.f_teks)
            self.gaya()

            self.setelan = baca_setelan()
            self.proses: subprocess.Popen | None = None
            self.antrian: queue.Queue = queue.Queue()
            self.berikut: datetime | None = None
            self.mulai_proses: datetime | None = None
            self.halaman: dict[str, tk.Frame] = {}
            self.tombol_nav: dict[str, tk.Label] = {}

            self.bangun_sisi()
            self.isi = tk.Frame(self, bg=C["bg"])
            self.isi.pack(side="left", fill="both", expand=True)
            self.bangun_beranda()
            self.bangun_riwayat()
            self.bangun_pengaturan()
            self.tampil("beranda")
            self.hitung_jadwal()
            self.segarkan()
            self.protocol("WM_DELETE_WINDOW", self.tutup)
            self.after(300, self.tik)
            if not mesin.AKUN_LOKAL.exists():
                self.after(600, lambda: (self.tampil("pengaturan"),
                                         Toast(self, "Selamat datang", "Isi akun ERP dan SEMENTRACK dulu, lalu klik Simpan.", C["gold"])))

        # ---------- gaya ttk ----------
        def gaya(self):
            st = ttk.Style(self)
            st.theme_use("clam")
            st.configure(".", font=self.f_teks, background=C["bg"])
            st.configure("TCheckbutton", background=C["card"], foreground=C["txt"], indicatorbackground="#fff",
                         indicatorforeground=C["pri"], indicatormargin=(0, 0, 6, 0), focuscolor=C["card"])
            st.map("TCheckbutton", background=[("active", C["card"])], indicatorbackground=[("selected", C["pri"]), ("active", "#eef4f1")],
                   indicatorforeground=[("selected", "#fff")])
            st.map("Treeview", background=[("selected", "#d9ece4")], foreground=[("selected", C["txt"])])
            st.configure("TEntry", fieldbackground="#fff", bordercolor=C["line"], lightcolor=C["line"], darkcolor=C["line"], padding=6)
            st.configure("TSpinbox", fieldbackground="#fff", bordercolor=C["line"], padding=5, arrowsize=12)
            st.configure("Treeview", rowheight=28, fieldbackground="#fff", bordercolor=C["line"], font=self.f_teks)
            st.configure("Treeview.Heading", font=self.f_bold, background="#eef2f0", foreground=C["txt"], relief="flat", padding=6)
            st.configure("Horizontal.TProgressbar", troughcolor="#e6ece9", background=C["pri"], bordercolor="#e6ece9",
                         lightcolor=C["pri"], darkcolor=C["pri"], thickness=6)

        def tombol(self, induk, teks, perintah, utama=False, kecil=False, bg=None):
            warna = C["pri"] if utama else "#ffffff"
            b = tk.Label(induk, text=teks, bg=bg or warna, fg="#fff" if utama else C["txt"], cursor="hand2",
                         font=self.f_bold if utama else self.f_teks, padx=12 if kecil else 18, pady=5 if kecil else 9,
                         highlightthickness=0 if utama else 1, highlightbackground=C["line"])
            b.bind("<Button-1>", lambda e: b.cget("state") != "disabled" and perintah())
            b.bind("<Enter>", lambda e: b.cget("state") != "disabled" and b.config(bg=C["pri_hi"] if utama else "#f1f5f3"))
            b.bind("<Leave>", lambda e: b.config(bg=bg or warna))
            return b

        def aktif(self, b, nyala: bool):
            b.config(state="normal" if nyala else "disabled", cursor="hand2" if nyala else "arrow")

        # ---------- sisi ----------
        def bangun_sisi(self):
            s = tk.Frame(self, bg=C["side"], width=220)
            s.pack(side="left", fill="y")
            s.pack_propagate(False)
            logo = tk.Frame(s, bg=C["side"], padx=20, pady=22)
            logo.pack(fill="x")
            kotak = tk.Canvas(logo, width=34, height=34, bg=C["side"], highlightthickness=0)
            kotak.create_rectangle(0, 0, 34, 34, fill=C["gold"], outline="")
            kotak.create_text(17, 17, text="N", fill=C["side"], font=self.f_logo)
            kotak.pack(side="left")
            t = tk.Frame(logo, bg=C["side"])
            t.pack(side="left", padx=10)
            tk.Label(t, text="Nazam", bg=C["side"], fg="#fff", font=self.f_logo).pack(anchor="w")
            tk.Label(t, text="AUTO TASK", bg=C["side"], fg=C["gold"], font=self.f_kecil).pack(anchor="w")
            for kunci, teks in (("beranda", "Beranda"), ("riwayat", "Riwayat"), ("pengaturan", "Pengaturan")):
                b = tk.Label(s, text="   " + teks, bg=C["side"], fg=C["side_txt"], anchor="w", font=self.f_teks, padx=14, pady=11, cursor="hand2")
                b.pack(fill="x", padx=10, pady=1)
                b.bind("<Button-1>", lambda e, k=kunci: self.tampil(k))
                self.tombol_nav[kunci] = b
            bawah = tk.Frame(s, bg=C["side"], padx=20, pady=16)
            bawah.pack(side="bottom", fill="x")
            tiro = tk.Frame(s, bg=C["side_hi"], padx=14, pady=12)
            tiro.pack(side="bottom", fill="x", padx=10)
            tk.Label(tiro, text="Sesi TIRO", bg=C["side_hi"], fg="#fff", font=self.f_bold).pack(anchor="w")
            self.lbl_sesi = tk.Label(tiro, text="", bg=C["side_hi"], fg=C["side_txt"], font=self.f_kecil, justify="left", wraplength=170)
            self.lbl_sesi.pack(anchor="w", pady=(2, 8))
            self.b_tiro = self.tombol(tiro, "Login TIRO", self.login_tiro, kecil=True)
            self.b_tiro.pack(anchor="w")
            self.lbl_jadwal_sisi = tk.Label(bawah, text="", bg=C["side"], fg=C["side_txt"], font=self.f_kecil, justify="left", wraplength=180)
            self.lbl_jadwal_sisi.pack(anchor="w")
            tk.Label(bawah, text=f"Versi {VERSI}", bg=C["side"], fg="#7fa597", font=self.f_kecil).pack(anchor="w", pady=(8, 0))

        def tampil(self, kunci: str):
            for k, f in self.halaman.items():
                f.pack_forget()
            self.halaman[kunci].pack(fill="both", expand=True)
            for k, b in self.tombol_nav.items():
                b.config(bg=C["side_hi"] if k == kunci else C["side"], fg="#fff" if k == kunci else C["side_txt"])
            if kunci == "riwayat":
                self.isi_riwayat()

        def kepala(self, induk, judul: str, sub: str):
            k = tk.Frame(induk, bg=C["bg"])
            k.pack(fill="x", pady=(0, 14))
            tk.Label(k, text=judul, bg=C["bg"], fg=C["txt"], font=self.f_judul).pack(anchor="w")
            lbl = tk.Label(k, text=sub, bg=C["bg"], fg=C["muted"], font=self.f_teks)
            lbl.pack(anchor="w")
            return k, lbl

        # ---------- beranda ----------
        def bangun_beranda(self):
            h = tk.Frame(self.isi, bg=C["bg"], padx=28, pady=22)
            self.halaman["beranda"] = h
            k, self.lbl_rentang = self.kepala(h, "Beranda", "")
            kanan = tk.Frame(k, bg=C["bg"])
            kanan.place(relx=1, rely=0, anchor="ne")
            self.tombol(kanan, "Buka SEMENTRACK", self.buka_sementrack, kecil=True).pack(side="right", padx=(6, 0))
            self.tombol(kanan, "Folder unduhan", lambda: self.buka_path(FOLDER), kecil=True).pack(side="right")

            baris = tk.Frame(h, bg=C["bg"])
            baris.pack(fill="x")
            self.kartu = {}
            for i, (kode, judul, sub) in enumerate(BAGIAN):
                kt = Kartu(baris, judul, sub)
                kt.grid(row=i // 4, column=i % 4, sticky="nsew", padx=(0 if i % 4 == 0 else 12, 0), pady=(0 if i < 4 else 12, 0))
                baris.columnconfigure(i % 4, weight=1, uniform="k")
                self.kartu[kode] = kt

            jalan = tk.Frame(h, bg=C["card"], highlightthickness=1, highlightbackground=C["line"], padx=18, pady=14)
            jalan.pack(fill="x", pady=14)
            kiri = tk.Frame(jalan, bg=C["card"])
            kiri.pack(side="left", fill="x", expand=True)
            tk.Label(kiri, text="Jalankan sekarang", bg=C["card"], fg=C["txt"], font=self.f_bold).pack(anchor="w")
            pilih = tk.Frame(kiri, bg=C["card"])
            pilih.pack(anchor="w", pady=(6, 0))
            self.v_bagian = {}
            for i, (kode, judul, _) in enumerate(BAGIAN):
                v = tk.BooleanVar(value=kode in self.setelan["bagian"])
                ttk.Checkbutton(pilih, text=judul.replace("Outstanding DO", "OS DO"), variable=v, command=self.simpan_pilihan).grid(
                    row=i // 4, column=i % 4, sticky="w", padx=(0, 14), pady=1)
                self.v_bagian[kode] = v
            opsi = tk.Frame(kiri, bg=C["card"])
            opsi.pack(anchor="w", pady=(4, 0))
            self.v_pratinjau = tk.BooleanVar(value=False)
            ttk.Checkbutton(opsi, text="Hanya pratinjau (tidak disimpan)", variable=self.v_pratinjau).pack(side="left", padx=(0, 16))
            self.v_browser = tk.BooleanVar(value=self.setelan["tampilkan_browser"])
            ttk.Checkbutton(opsi, text="Tampilkan browser", variable=self.v_browser, command=self.simpan_pilihan).pack(side="left")
            ambil = tk.Label(kiri, text="Ambil ongkos kirim: pilih distributor dan tanggal…", bg=C["card"], fg=C["pri"], cursor="hand2")
            ambil.pack(anchor="w", pady=(6, 0))
            ambil.bind("<Button-1>", lambda _e: self.dialog_ongkos())

            tombol = tk.Frame(jalan, bg=C["card"])
            tombol.pack(side="right", before=kiri)
            self.b_jalan = self.tombol(tombol, "▶  Jalankan", lambda: self.jalankan(), utama=True)
            self.b_jalan.pack(side="left")
            self.b_henti = self.tombol(tombol, "Hentikan", self.hentikan)
            self.b_henti.pack(side="left", padx=(8, 0))
            self.aktif(self.b_henti, False)

            status = tk.Frame(h, bg=C["bg"])
            status.pack(fill="x")
            self.lbl_langkah = tk.Label(status, text="Siap.", bg=C["bg"], fg=C["muted"], font=self.f_teks, anchor="w")
            self.lbl_langkah.pack(side="left")
            self.lbl_jadwal = tk.Label(status, text="", bg=C["bg"], fg=C["muted"], font=self.f_teks, cursor="hand2")
            self.lbl_jadwal.pack(side="right")
            self.lbl_jadwal.bind("<Button-1>", lambda e: self.tampil("pengaturan"))
            self.progres = ttk.Progressbar(h, mode="determinate", value=0, style="Horizontal.TProgressbar")
            self.progres.pack(fill="x", pady=(6, 10))

            bingkai = tk.Frame(h, bg=C["log_bg"], padx=2, pady=2)
            bingkai.pack(fill="both", expand=True)
            self.log = tk.Text(bingkai, bg=C["log_bg"], fg=C["log_txt"], insertbackground=C["log_txt"], relief="flat", highlightthickness=0, bd=0,
                               font=self.f_mono, wrap="word", padx=12, pady=10, state="disabled", height=8)
            gulir = ttk.Scrollbar(bingkai, command=self.log.yview)
            self.log.configure(yscrollcommand=gulir.set)
            gulir.pack(side="right", fill="y")
            self.log.pack(fill="both", expand=True)
            self.log.tag_config("bad", foreground="#ff8a80")
            self.log.tag_config("ok", foreground="#7ee2b0")
            self.log.tag_config("head", foreground=C["gold"])

        def tulis_log(self, teks: str):
            tag = "bad" if ("GAGAL" in teks or "Gagal" in teks or "kegagalan" in teks) else \
                  "ok" if ("berhasil" in teks or "terunduh" in teks or "Selesai." in teks) else \
                  "head" if teks.startswith(("ERP:", "SEMENTRACK:", "Mulai", "▶")) else None
            self.log.config(state="normal")
            self.log.insert("end", teks + "\n", tag)
            self.log.see("end")
            self.log.config(state="disabled")

        # ---------- riwayat ----------
        def bangun_riwayat(self):
            h = tk.Frame(self.isi, bg=C["bg"], padx=28, pady=22)
            self.halaman["riwayat"] = h
            k, _ = self.kepala(h, "Riwayat", "Setiap kali jalan, dari aplikasi maupun dari jadwal Windows.")
            kanan = tk.Frame(k, bg=C["bg"])
            kanan.place(relx=1, rely=0, anchor="ne")
            self.tombol(kanan, "Buka log lengkap", lambda: self.buka_path(LOG), kecil=True).pack(side="right", padx=(6, 0))
            self.tombol(kanan, "Muat ulang", self.isi_riwayat, kecil=True).pack(side="right")
            kolom = ("waktu", "durasi", "rentang", "J028", "J073", "Sub ERP")
            bingkai = tk.Frame(h, bg=C["line"], padx=1, pady=1)
            bingkai.pack(fill="both", expand=True)
            self.tabel = ttk.Treeview(bingkai, columns=kolom, show="headings", selectmode="browse")
            for c, judul, lebar in zip(kolom, ("Waktu", "Durasi", "Rentang", "J028", "J073", "Sub ERP"), (140, 70, 180, 140, 150, 180)):
                self.tabel.heading(c, text=judul, anchor="w")
                self.tabel.column(c, width=lebar, anchor="w", stretch=c not in ("waktu", "durasi"))
            gulir = ttk.Scrollbar(bingkai, command=self.tabel.yview)
            self.tabel.configure(yscrollcommand=gulir.set)
            gulir.pack(side="right", fill="y")
            self.tabel.pack(fill="both", expand=True)
            self.tabel.tag_configure("bad", foreground=C["bad"])
            self.tabel.tag_configure("pre", foreground=C["warn"])
            self.lbl_detail = tk.Label(h, text="Pilih baris untuk melihat keterangan.", bg=C["bg"], fg=C["muted"],
                                       justify="left", anchor="w", wraplength=820, font=self.f_teks)
            self.lbl_detail.pack(fill="x", pady=(10, 0))
            self.tabel.bind("<<TreeviewSelect>>", self.detail_riwayat)
            self._riwayat: list[dict] = []

        def isi_riwayat(self):
            self.tabel.delete(*self.tabel.get_children())
            self._riwayat = list(reversed(baca_riwayat()))
            for i, r in enumerate(self._riwayat):
                m, s = datetime.fromisoformat(r["mulai"]), datetime.fromisoformat(r["selesai"])
                detik = int((s - m).total_seconds())
                sel = []
                for nama in ("J028", "J073", "Sub ERP"):
                    b = r["bagian"].get(nama)
                    sel.append("—" if not b else ("✓ " if b["ok"] else "✗ ") + (b.get("pesan") or "").replace(" (pratinjau)", "")[:40])
                gagal = any(not b["ok"] for b in r["bagian"].values())
                tag = "bad" if gagal else "pre" if r.get("pratinjau") else ""
                self.tabel.insert("", "end", iid=str(i), tags=(tag,),
                                  values=(f"{tanggal_id(m.date())} {m:%H:%M}", f"{detik // 60}m {detik % 60:02d}s",
                                          rentang_teks(r.get("rentang", "")) + ("  · pratinjau" if r.get("pratinjau") else ""), *sel))

        def detail_riwayat(self, _e=None):
            pilih = self.tabel.selection()
            if not pilih:
                return
            r = self._riwayat[int(pilih[0])]
            teks = [f"{k}: {'berhasil' if v['ok'] else 'GAGAL'} — {v.get('pesan') or ''}" for k, v in r["bagian"].items()]
            if r.get("pratinjau"):
                teks.append("(hanya pratinjau, tidak disimpan)")
            self.lbl_detail.config(text="\n".join(teks), fg=C["txt"])

        # ---------- pengaturan ----------
        def bangun_pengaturan(self):
            h = tk.Frame(self.isi, bg=C["bg"], padx=28, pady=22)
            self.halaman["pengaturan"] = h
            k, _ = self.kepala(h, "Pengaturan", "Akun, jadwal, dan pilihan lain. Password disimpan terenkripsi di PC ini.")
            atas = tk.Frame(k, bg=C["bg"])
            atas.place(relx=1, rely=0, anchor="ne")
            self.tombol(atas, "Simpan", self.simpan_pengaturan, utama=True).pack(side="right")
            self.tombol(atas, "Uji login", self.uji_login).pack(side="right", padx=(0, 8))
            self.lbl_simpan = tk.Label(k, text="", bg=C["bg"], fg=C["ok"])
            self.lbl_simpan.place(relx=1, rely=1, anchor="se")
            # isi pengaturan bisa digulir (layar laptop pendek)
            wadah = tk.Frame(h, bg=C["bg"])
            wadah.pack(fill="both", expand=True)
            kanvas = tk.Canvas(wadah, bg=C["bg"], highlightthickness=0, bd=0)
            gulir = ttk.Scrollbar(wadah, orient="vertical", command=kanvas.yview)
            kanvas.configure(yscrollcommand=gulir.set)
            gulir.pack(side="right", fill="y")
            kanvas.pack(side="left", fill="both", expand=True)
            kolom = tk.Frame(kanvas, bg=C["bg"])
            jendela = kanvas.create_window(0, 0, window=kolom, anchor="nw")
            kolom.bind("<Configure>", lambda _e: kanvas.configure(scrollregion=kanvas.bbox("all")))
            kanvas.bind("<Configure>", lambda e: kanvas.itemconfigure(jendela, width=e.width - 4))
            roda = lambda e: kanvas.yview_scroll(-1 if (e.delta > 0 or getattr(e, "num", 0) == 4) else 1, "units")
            kanvas.bind("<Enter>", lambda _e: (kanvas.bind_all("<MouseWheel>", roda), kanvas.bind_all("<Button-4>", roda), kanvas.bind_all("<Button-5>", roda)))
            kanvas.bind("<Leave>", lambda _e: (kanvas.unbind_all("<MouseWheel>"), kanvas.unbind_all("<Button-4>"), kanvas.unbind_all("<Button-5>")))
            kolom.columnconfigure(0, weight=1, uniform="p")
            kolom.columnconfigure(1, weight=1, uniform="p")
            kolom.rowconfigure(0, weight=1)
            kiri = tk.Frame(kolom, bg=C["bg"])
            kiri.grid(row=0, column=0, sticky="nsew")
            kanan = tk.Frame(kolom, bg=C["bg"])
            kanan.grid(row=0, column=1, sticky="nsew", padx=(14, 0))
            akun = mesin.baca_akun_file()
            self.v_akun: dict[str, tk.StringVar] = {}

            def bagian(induk, judul):
                f = tk.Frame(induk, bg=C["card"], highlightthickness=1, highlightbackground=C["line"], padx=18, pady=14)
                f.pack(fill="x", pady=(0, 12))
                tk.Label(f, text=judul, bg=C["card"], fg=C["txt"], font=self.f_bold).grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 8))
                f.columnconfigure(1, weight=1)
                return f

            def isian(f, baris, label, kunci, rahasia=False, nilai=None):
                tk.Label(f, text=label, bg=C["card"], fg=C["muted"]).grid(row=baris, column=0, sticky="w", padx=(0, 12), pady=4)
                v = tk.StringVar(value=akun.get(kunci, "") if nilai is None else nilai)
                e = ttk.Entry(f, textvariable=v, show="•" if rahasia else "")
                e.grid(row=baris, column=1, sticky="ew", pady=4)
                if rahasia:
                    lihat = tk.Label(f, text="Lihat", bg=C["card"], fg=C["pri"], cursor="hand2")
                    lihat.grid(row=baris, column=2, padx=(8, 0))
                    lihat.bind("<Button-1>", lambda _e: (e.config(show="" if e.cget("show") else "•"),
                                                          lihat.config(text="Sembunyikan" if not e.cget("show") else "Lihat")))
                self.v_akun[kunci] = v

            f = bagian(kiri, "Akun ERP (bangunsukses.com)")
            isian(f, 1, "Username", "ERP_USER")
            isian(f, 2, "Password", "ERP_PASS", rahasia=True)
            f = bagian(kiri, "Akun SEMENTRACK (admin)")
            isian(f, 1, "Alamat web", "SEMENTRACK_URL", nilai=akun.get("SEMENTRACK_URL", "http://localhost:5173"))
            isian(f, 2, "Username", "SEMENTRACK_USER")
            isian(f, 3, "Password", "SEMENTRACK_PASS", rahasia=True)
            f = bagian(kiri, "Akun TIRO (Sell In, Outstanding DO)")
            isian(f, 1, "Email", "TIRO_USER")
            isian(f, 2, "Password", "TIRO_PASS", rahasia=True)
            f = bagian(kanan, "Jadwal otomatis")
            self.v_jadwal = tk.BooleanVar(value=self.setelan["jadwal_aktif"])
            ttk.Checkbutton(f, text="Jalankan otomatis selama aplikasi terbuka", variable=self.v_jadwal).grid(row=1, column=0, columnspan=3, sticky="w")
            baris = tk.Frame(f, bg=C["card"])
            baris.grid(row=2, column=0, columnspan=3, sticky="w", pady=(8, 0))
            tk.Label(baris, text="Setiap", bg=C["card"], fg=C["muted"]).pack(side="left")
            self.v_tiap = tk.StringVar(value=str(self.setelan["tiap_jam"]))
            ttk.Spinbox(baris, from_=1, to=12, width=4, textvariable=self.v_tiap).pack(side="left", padx=6)
            tk.Label(baris, text="jam, mulai pukul", bg=C["card"], fg=C["muted"]).pack(side="left")
            self.v_mulai = tk.StringVar(value=self.setelan["jam_mulai"])
            ttk.Entry(baris, textvariable=self.v_mulai, width=7).pack(side="left", padx=6)
            tk.Label(f, text="Yang dijalankan: bagian yang dicentang di Beranda. Kalau Sell In / OS DO dicentang dan sesi TIRO "
                             "sudah habis, jendela login TIRO terbuka dan menunggu captcha 10 menit; bagian lain tetap jalan.",
                     bg=C["card"], fg=C["muted"], font=self.f_kecil, justify="left", wraplength=370).grid(row=3, column=0, columnspan=3, sticky="w", pady=(6, 0))

            f = bagian(kanan, "Tetap jalan walau aplikasi ditutup")
            tk.Label(f, text="Didaftarkan ke Task Scheduler Windows dengan jadwal di atas. PC harus menyala "
                             "dan akun Windows ini login. Jangan aktifkan bersamaan dengan jadwal di aplikasi.",
                     bg=C["card"], fg=C["muted"], font=self.f_kecil, justify="left", wraplength=370).grid(row=1, column=0, columnspan=3, sticky="w")
            bt = tk.Frame(f, bg=C["card"])
            bt.grid(row=2, column=0, columnspan=3, sticky="w", pady=(10, 0))
            self.tombol(bt, "Daftarkan ke Windows", self.pasang_tugas, kecil=True).pack(side="left")
            self.tombol(bt, "Hapus dari Windows", self.hapus_tugas, kecil=True).pack(side="left", padx=(8, 0))
            self.lbl_tugas = tk.Label(f, text="", bg=C["card"], fg=C["muted"], font=self.f_kecil)
            self.lbl_tugas.grid(row=3, column=0, columnspan=3, sticky="w")

            f = bagian(kanan, "Data")
            tk.Label(f, text="Distributor J073", bg=C["card"], fg=C["muted"]).grid(row=1, column=0, sticky="nw", padx=(0, 12), pady=4)
            self.v_akun["J073_DIST"] = tk.StringVar(value=akun.get("J073_DIST", ",".join(mesin.J073_DIST)) or ",".join(mesin.J073_DIST))
            kotak_j = PilihDist(f, self, self.v_akun["J073_DIST"].get().split(","), kolom=2)
            kotak_j.grid(row=1, column=1, columnspan=2, sticky="w", pady=4)
            kotak_j.saat_berubah = lambda pilihan: self.v_akun["J073_DIST"].set(",".join(pilihan))
            tk.Label(f, text="J073 harian untuk Sell Out BNN (bawaan INSA dan PKB).", bg=C["card"], fg=C["muted"],
                     font=self.f_kecil, wraplength=240, justify="left").grid(row=2, column=1, columnspan=2, sticky="w")
            isian(f, 4, "File DO FAS", "DOFAS_FILE", nilai=akun.get("DOFAS_FILE", mesin.DOFAS_FILE_BAWAAN))
            pilih = tk.Label(f, text="Pilih…", bg=C["card"], fg=C["pri"], cursor="hand2")
            pilih.grid(row=4, column=2, padx=(8, 0))
            pilih.bind("<Button-1>", lambda _e: self.pilih_dofas())
            self.lbl_dofas = tk.Label(f, text="", bg=C["card"], fg=C["muted"], font=self.f_kecil, justify="left", wraplength=240)
            self.lbl_dofas.grid(row=5, column=1, columnspan=2, sticky="w")
            self.v_akun["DOFAS_FILE"].trace_add("write", lambda *_: self.cek_dofas())
            self.cek_dofas()
            isian(f, 6, "File Stock", "STOCK_FILE", nilai=akun.get("STOCK_FILE", mesin.STOCK_FILE_BAWAAN))
            pilih = tk.Label(f, text="Pilih…", bg=C["card"], fg=C["pri"], cursor="hand2")
            pilih.grid(row=6, column=2, padx=(8, 0))
            pilih.bind("<Button-1>", lambda _e: self.pilih_stok())
            self.lbl_stok = tk.Label(f, text="", bg=C["card"], fg=C["muted"], font=self.f_kecil, justify="left", wraplength=240)
            self.lbl_stok.grid(row=7, column=1, columnspan=2, sticky="w")
            self.v_akun["STOCK_FILE"].trace_add("write", lambda *_: self.cek_stok())
            self.cek_stok()
            # distributor ongkos kirim (jadwal mingguan): dicentang, bukan diketik
            tk.Label(f, text="Distributor ongkos", bg=C["card"], fg=C["muted"]).grid(row=8, column=0, sticky="nw", padx=(0, 12), pady=(8, 0))
            self.v_akun["ONGKOS_DIST"] = tk.StringVar(value=akun.get("ONGKOS_DIST", mesin.ONGKOS_DIST_BAWAAN) or mesin.ONGKOS_DIST_BAWAAN)
            kotak = PilihDist(f, self, self.v_akun["ONGKOS_DIST"].get().split(","), kolom=2)
            kotak.grid(row=8, column=1, columnspan=2, sticky="w", pady=(8, 0))
            kotak.saat_berubah = lambda pilihan: self.v_akun["ONGKOS_DIST"].set(",".join(pilihan))
            tk.Label(f, text="Dipakai jadwal mingguan: J073 3 bulan terakhir dan ORDB019 bulan lalu + bulan ini. "
                             "INSA-E tidak perlu (datanya ikut INSA 4094).",
                     bg=C["card"], fg=C["muted"], font=self.f_kecil, wraplength=240, justify="left").grid(row=9, column=1, columnspan=2, sticky="w")
            isian(f, 10, "Folder salinan", "ONGKOS_FOLDER", nilai=akun.get("ONGKOS_FOLDER", mesin.FOLDER_FILE_BAWAAN) or mesin.FOLDER_FILE_BAWAAN)
            pilih = tk.Label(f, text="Pilih…", bg=C["card"], fg=C["pri"], cursor="hand2")
            pilih.grid(row=10, column=2, padx=(8, 0))
            pilih.bind("<Button-1>", lambda _e: self.pilih_folder())
            tk.Label(f, text="J073 dan ORDB019 yang sudah diunduh disimpan di sini; yang sudah ada tidak diunduh lagi.",
                     bg=C["card"], fg=C["muted"], font=self.f_kecil, wraplength=240, justify="left").grid(row=11, column=1, columnspan=2, sticky="w")
            self.tombol(f, "Ambil ongkos kirim…", self.dialog_ongkos, kecil=True).grid(row=12, column=0, columnspan=3, sticky="w", pady=(10, 0))

            f = bagian(kiri, "Lainnya")
            self.v_startup = tk.BooleanVar(value=self.startup_path().exists())
            ttk.Checkbutton(f, text="Buka aplikasi saat Windows menyala", variable=self.v_startup).grid(row=1, column=0, columnspan=3, sticky="w")
            self.v_paksa = tk.BooleanVar(value=self.setelan["paksa_subdist"])
            ttk.Checkbutton(f, text="Simpan Sub ERP / DO FAS walau ada angka yang turun", variable=self.v_paksa).grid(row=2, column=0, columnspan=3, sticky="w", pady=(4, 0))
            a, b = rentang_bawaan()
            tk.Label(f, text=f"Rentang ERP: tanggal 1 bulan ini s.d. hari ini ({tanggal_id(a)} – {tanggal_id(b)}); tanggal 1 ikut bulan lalu. "
                             "TIRO: 1 Januari s.d. hari ini. Di alamat file, {tahun} dan {bulan} (mis. 2026, NOV) otomatis diganti yang berjalan.",
                     bg=C["card"], fg=C["muted"], font=self.f_kecil, justify="left", wraplength=400).grid(row=3, column=0, columnspan=3, sticky="w", pady=(8, 0))


        # ---------- aksi ----------
        def simpan_pilihan(self):
            self.setelan["bagian"] = [k for k, v in self.v_bagian.items() if v.get()]
            self.setelan["tampilkan_browser"] = self.v_browser.get()
            simpan_setelan(self.setelan)

        def simpan_pengaturan(self, diam=False) -> bool:
            try:
                tiap = int(self.v_tiap.get())
                assert 1 <= tiap <= 12
                jm = datetime.strptime(self.v_mulai.get().strip(), "%H:%M").strftime("%H:%M")
            except (ValueError, AssertionError):
                messagebox.showerror(APP, "Jadwal: jarak 1–12 jam, jam mulai ditulis HH:MM (mis. 07:00).")
                return False
            nilai = {k: v.get() for k, v in self.v_akun.items()}
            kurang = [n for k, n in (("ERP_USER", "username ERP"), ("ERP_PASS", "password ERP"), ("SEMENTRACK_URL", "alamat SEMENTRACK"),
                                     ("SEMENTRACK_USER", "username SEMENTRACK"), ("SEMENTRACK_PASS", "password SEMENTRACK")) if not nilai.get(k, "").strip()]
            simpan_akun(nilai)
            self.setelan.update(jadwal_aktif=self.v_jadwal.get(), tiap_jam=tiap, jam_mulai=jm, paksa_subdist=self.v_paksa.get())
            simpan_setelan(self.setelan)
            self.atur_startup(self.v_startup.get())
            self.hitung_jadwal()
            self.segarkan()
            if not diam:
                self.lbl_simpan.config(text="Tersimpan." + (f"  Belum diisi: {', '.join(kurang)}." if kurang else ""),
                                       fg=C["warn"] if kurang else C["ok"])
                self.after(6000, lambda: self.lbl_simpan.config(text=""))
            return True

        def env_anak(self) -> dict:
            env = dict(os.environ, NAT_TANPA_TANYA="1", NAT_DARI_APP="1", PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
            env.update(mesin.baca_akun_file())                     # yang tersimpan
            env.update({k: v.get().strip() for k, v in self.v_akun.items() if v.get().strip()})   # isian layar
            return env

        def jalankan(self, terjadwal=False, argumen: list[str] | None = None):
            if self.proses:
                return
            if argumen is None:
                bagian = [k for k, v in self.v_bagian.items() if v.get()]
                if not bagian:
                    messagebox.showinfo(APP, "Centang minimal satu: J028, J073, atau Sub ERP.")
                    return
                argumen = ["--bagian", ",".join(bagian)]
                if self.v_pratinjau.get() and not terjadwal:
                    argumen.append("--tanpa-simpan")
                if self.setelan.get("paksa_subdist"):
                    argumen.append("--paksa")
            if not self.v_browser.get() or terjadwal:
                argumen.append("--tanpa-layar")
            if terjadwal:
                argumen.append("--jadwal")             # Ongkos kirim: seminggu sekali
            FOLDER.mkdir(exist_ok=True)
            perintah = perintah_dasar() + argumen + ["--tanpa-jeda", "--log", str(LOG)]
            self.tampil("beranda")
            self.log.config(state="normal")
            self.log.delete("1.0", "end")
            self.log.config(state="disabled")
            self.tulis_log(f"▶ {'Jadwal' if terjadwal else 'Dijalankan'} {datetime.now():%H:%M}")
            awal = LOG.stat().st_size if LOG.exists() else 0
            try:
                self.proses = subprocess.Popen(
                    perintah, cwd=str(DASAR), env=self.env_anak(), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, creationflags=0x08000000 if os.name == "nt" else 0)   # tanpa jendela konsol
            except OSError as e:
                self.proses = None
                self.tulis_log(f"Gagal memulai: {e}")
                return
            self.mulai_proses = datetime.now()
            self.mode_uji = "--uji-login" in argumen
            self.mode_tiro = "--login-tiro" in argumen
            self.baris_uji: list[str] = []
            threading.Thread(target=self.baca_keluaran, args=(self.proses, awal), daemon=True).start()
            self.aktif(self.b_jalan, False)
            self.aktif(self.b_henti, True)
            self.progres.config(mode="indeterminate")
            self.progres.start(12)
            self.lbl_langkah.config(text="Memulai…", fg=C["txt"])

        def baca_keluaran(self, p: subprocess.Popen, awal: int):
            """Ikuti log.txt (mesin menulis semua keluarannya ke sana) sampai proses selesai."""
            import time
            sisa, posisi, akhir = "", awal, False
            while True:
                selesai = p.poll() is not None
                try:
                    with open(LOG, "r", encoding="utf-8", errors="replace") as f:
                        f.seek(posisi)
                        data = f.read()
                        posisi = f.tell()
                except OSError:
                    data = ""
                sisa += data
                *lengkap, sisa = sisa.split("\n")
                for b in lengkap:
                    if not b.startswith("===================="):
                        self.antrian.put(b)
                if akhir:
                    break
                akhir = selesai          # satu putaran lagi setelah proses selesai, supaya baris terakhir terbaca
                time.sleep(0.4)
            if sisa:
                self.antrian.put(sisa)
            self.antrian.put(None)

        def hentikan(self):
            if not self.proses:
                return
            if not messagebox.askyesno(APP, "Hentikan proses yang sedang berjalan? Data yang belum tersimpan tidak masuk."):
                return
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(self.proses.pid), "/T", "/F"], capture_output=True, creationflags=0x08000000)
            else:
                self.proses.terminate()
            try:
                mesin.KUNCI.unlink()
            except OSError:
                pass
            self.tulis_log("Dihentikan.")

        def selesai(self):
            kode = self.proses.returncode if self.proses else None
            self.proses = None
            self.progres.stop()
            self.progres.config(mode="determinate", value=0)
            self.aktif(self.b_jalan, True)
            self.aktif(self.b_henti, False)
            if getattr(self, "mode_tiro", False):
                self.mode_tiro = False
                ok = kode == 0
                self.lbl_langkah.config(text="Login TIRO berhasil, sesi tersimpan." if ok else "Login TIRO gagal / dibatalkan. Lihat log.",
                                        fg=C["ok"] if ok else C["bad"])
                self.status_sesi()
                return
            if getattr(self, "mode_uji", False):
                ok = self.baris_uji and all("berhasil" in x for x in self.baris_uji)
                teks = "\n".join(self.baris_uji) or "Tidak ada hasil (lihat log)."
                self.lbl_langkah.config(text=teks.replace("\n", " · "), fg=C["ok"] if ok else C["bad"])
                Toast(self, "Login berhasil" if ok else "Login gagal", teks, C["ok"] if ok else C["bad"])
                self.mode_uji = False
                return
            r = baca_riwayat()
            terakhir = r[-1] if r and self.mulai_proses and datetime.fromisoformat(r[-1]["mulai"]) >= self.mulai_proses.replace(microsecond=0) else None
            self.segarkan()
            if terakhir:
                gagal = [k for k, v in terakhir["bagian"].items() if not v["ok"]]
                if gagal:
                    self.lbl_langkah.config(text=f"Selesai dengan kegagalan: {', '.join(gagal)}. Lihat log di bawah.", fg=C["bad"])
                    Toast(self, "Ada yang gagal", f"{', '.join(gagal)} gagal. Buka aplikasi untuk melihat sebabnya.", C["bad"])
                else:
                    ket = " · ".join(f"{k} {v.get('pesan', '')}" for k, v in terakhir["bagian"].items())
                    self.lbl_langkah.config(text=f"Selesai {datetime.now():%H:%M}. {ket}", fg=C["ok"])
                    Toast(self, "Data diperbarui" if not terakhir.get("pratinjau") else "Pratinjau selesai", ket, C["ok"])
            else:
                self.lbl_langkah.config(text=f"Berhenti (kode {kode}). Lihat log di bawah.", fg=C["bad" if kode else "muted"])

        def login_tiro(self):
            if self.proses:
                return
            if not self.simpan_pengaturan(diam=True):
                return
            self.jalankan(argumen=["--login-tiro"])

        def status_sesi(self):
            f = mesin.DASAR / "tiro_sesi.json"
            if f.exists():
                t = datetime.fromtimestamp(f.stat().st_mtime)
                self.lbl_sesi.config(text=f"Login terakhir {tanggal_id(t.date())}, {t:%H:%M}. Captcha diketik sendiri; "
                                          "kalau sesi habis, jendela login terbuka saat jalan.", fg=C["side_txt"])
            else:
                self.lbl_sesi.config(text="Belum login. Sell In dan OS DO butuh login TIRO (captcha diketik sendiri).", fg=C["gold"])

        def path_dofas(self) -> Path:
            t = str(date.today().year)
            return Path((self.v_akun["DOFAS_FILE"].get().strip() or mesin.DOFAS_FILE_BAWAAN).replace("{tahun}", t))

        def cek_dofas(self):
            p = self.path_dofas()
            try:
                ada = p.is_file()
            except OSError:
                ada = False
            self.lbl_dofas.config(text="✓ Ditemukan" if ada else "✗ Tidak ditemukan, cek jaringan ke folder bersama",
                                  fg=C["ok"] if ada else C["bad"])

        def pilih_dofas(self):
            from tkinter import filedialog
            awal = self.path_dofas().parent
            f = filedialog.askopenfilename(title="Pilih file rekap DO harian", initialdir=str(awal) if awal.exists() else None,
                                           filetypes=[("Excel", "*.xlsx *.xlsm"), ("Semua file", "*.*")])
            if not f:
                return
            t = str(date.today().year)
            # tahun di alamat diganti {tahun} supaya tahun depan otomatis ikut berganti
            self.v_akun["DOFAS_FILE"].set(str(Path(f)).replace(t, "{tahun}"))
            self.lbl_simpan.config(text="Klik Simpan untuk menyimpan alamat file.", fg=C["warn"])

        def cek_stok(self):
            hari = date.today()
            p = mesin.cari_stok(hari.replace(day=1), self.v_akun["STOCK_FILE"].get().strip())
            bln = f"{mesin.BULAN_STOK[hari.month - 1][0]} {hari.year}"
            self.lbl_stok.config(text=f"✓ {p.name}" if p else f"✗ {bln} tidak ditemukan, cek jaringan ke folder bersama",
                                 fg=C["ok"] if p else C["bad"])

        def pilih_stok(self):
            from tkinter import filedialog
            hari = date.today()
            awal = mesin.alamat_stok(hari.replace(day=1), self.v_akun["STOCK_FILE"].get().strip())[0].parent
            f = filedialog.askopenfilename(title="Pilih file Stock Semen bulan ini", initialdir=str(awal) if awal.exists() else None,
                                           filetypes=[("Excel", "*.xlsx"), ("Semua file", "*.*")])
            if not f:
                return
            # bulan dan tahun di alamat diganti {bulan} / {tahun} supaya bulan depan otomatis berganti
            t = str(hari.year)
            alamat = str(Path(f))
            for b in mesin.BULAN_STOK[hari.month - 1]:
                alamat = re.sub(rf"\b{b}\b", "{bulan}", alamat, flags=re.I)
            self.v_akun["STOCK_FILE"].set(alamat.replace(t, "{tahun}"))
            self.lbl_simpan.config(text="Klik Simpan untuk menyimpan alamat file.", fg=C["warn"])

        def pilih_folder(self):
            awal = self.v_akun["ONGKOS_FOLDER"].get().strip()
            from tkinter import filedialog
            d = filedialog.askdirectory(title="Folder salinan J073 / ORDB019", initialdir=awal if awal and Path(awal).exists() else None)
            if d:
                self.v_akun["ONGKOS_FOLDER"].set(str(Path(d)))

        def dialog_ongkos(self):
            if self.proses:
                messagebox.showinfo(APP, "Masih ada proses yang berjalan. Tunggu selesai atau Hentikan dulu.")
                return
            DialogOngkos(self)

        def jalankan_ongkos(self, argumen: list[str]):
            if not self.simpan_pengaturan(diam=True):
                return
            if self.v_pratinjau.get():
                argumen = argumen + ["--tanpa-simpan"]
            self.jalankan(argumen=argumen)

        def uji_login(self):
            if self.proses:
                return
            if not self.simpan_pengaturan(diam=True):
                return
            self.jalankan(argumen=["--uji-login"])

        # ---------- jadwal ----------
        def hitung_jadwal(self):
            if not self.setelan["jadwal_aktif"]:
                self.berikut = None
                return
            jam, menit = map(int, self.setelan["jam_mulai"].split(":"))
            sekarang = datetime.now()
            t = sekarang.replace(hour=jam, minute=menit, second=0, microsecond=0) - timedelta(days=1)
            while t <= sekarang:
                t += timedelta(hours=int(self.setelan["tiap_jam"]))
            self.berikut = t

        def tik(self):
            try:
                while True:
                    baris = self.antrian.get_nowait()
                    if baris is None:
                        self.selesai()
                        break
                    if baris.startswith("@@STATUS"):
                        continue
                    if baris.startswith("@@TIRO_LOGIN"):
                        self.bell()
                        Toast(self, "Ketik captcha TIRO", "Jendela login TIRO sudah terbuka. Ketik kodenya lalu klik Masuk.", C["gold"])
                        baris = "TIRO: " + baris.split(" ", 1)[1]
                    self.tulis_log(baris)
                    if baris.startswith(("ERP:", "SEMENTRACK:")) and ("berhasil" in baris or "GAGAL" in baris):
                        self.baris_uji.append(baris)
                    b = baris.strip()
                    if b and not b.startswith(("Call log", "-", "=")):
                        self.lbl_langkah.config(text=b[:110], fg=C["txt"])
            except queue.Empty:
                pass
            if self.berikut and datetime.now() >= self.berikut:
                if not self.proses:
                    self.jalankan(terjadwal=True)
                self.hitung_jadwal()
                self.segarkan_jadwal()
            if datetime.now().second == 0:
                self.segarkan_jadwal()
            self.after(300, self.tik)

        def segarkan_jadwal(self):
            if self.berikut:
                teks = f"Jadwal: tiap {self.setelan['tiap_jam']} jam · berikutnya {self.berikut:%H:%M}"
            else:
                teks = "Jadwal di aplikasi: mati"
            self.lbl_jadwal.config(text=teks)
            self.lbl_jadwal_sisi.config(text=teks)

        def segarkan(self):
            a, b = rentang_bawaan()
            self.lbl_rentang.config(text=f"Data ERP ke SEMENTRACK · rentang {tanggal_id(a)} – {tanggal_id(b)}")
            r = baca_riwayat()
            for kode, nama in NAMA_RIWAYAT.items():
                terakhir = next((c for c in reversed(r) if nama in c["bagian"]), None)
                self.kartu[kode].isi(terakhir, terakhir["bagian"][nama] if terakhir else None)
            self.segarkan_jadwal()
            self.cek_tugas()
            self.status_sesi()


        # ---------- Windows ----------
        def perintah_tugas(self) -> str:
            bagian = ",".join(self.setelan["bagian"]) or "J028,J073,SUBDIST"
            argumen = f'--bagian {bagian} --jadwal --tanpa-layar --tanpa-jeda --log "{LOG}"' + (" --paksa" if self.setelan.get("paksa_subdist") else "")
            return " ".join(f'"{x}"' for x in perintah_dasar()) + " " + argumen

        def pasang_tugas(self):
            if os.name != "nt":
                messagebox.showinfo(APP, "Hanya bisa di Windows.")
                return
            if not self.simpan_pengaturan(diam=True):
                return
            if self.setelan["jadwal_aktif"] and messagebox.askyesno(APP, "Jadwal di aplikasi sedang aktif. Matikan supaya tidak jalan dua kali?"):
                self.v_jadwal.set(False)
                self.simpan_pengaturan(diam=True)
            r = subprocess.run(["schtasks", "/Create", "/F", "/TN", NAMA_TUGAS, "/SC", "HOURLY", "/MO", str(self.setelan["tiap_jam"]),
                                "/ST", self.setelan["jam_mulai"], "/TR", self.perintah_tugas()],
                               capture_output=True, text=True, creationflags=0x08000000)
            if r.returncode == 0:
                messagebox.showinfo(APP, f"Terdaftar di Windows: tiap {self.setelan['tiap_jam']} jam mulai {self.setelan['jam_mulai']}.\n"
                                         "Hasilnya tetap muncul di Riwayat.")
            else:
                messagebox.showerror(APP, "Gagal mendaftarkan jadwal:\n" + (r.stderr or r.stdout))
            self.cek_tugas()

        def hapus_tugas(self):
            if os.name != "nt":
                return
            r = subprocess.run(["schtasks", "/Delete", "/F", "/TN", NAMA_TUGAS], capture_output=True, text=True, creationflags=0x08000000)
            messagebox.showinfo(APP, "Jadwal Windows dihapus." if r.returncode == 0 else "Tidak ada jadwal Windows yang terdaftar.")
            self.cek_tugas()

        def cek_tugas(self):
            if os.name != "nt":
                self.lbl_tugas.config(text="")
                return
            r = subprocess.run(["schtasks", "/Query", "/TN", NAMA_TUGAS], capture_output=True, text=True, creationflags=0x08000000)
            self.lbl_tugas.config(text="Status: terdaftar di Windows." if r.returncode == 0 else "Status: belum terdaftar.",
                                  fg=C["ok"] if r.returncode == 0 else C["muted"])

        def startup_path(self) -> Path:
            return Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs/Startup" / f"{APP}.cmd"

        def atur_startup(self, nyala: bool):
            if os.name != "nt":
                return
            p = self.startup_path()
            try:
                if nyala:
                    jalan = " ".join(f'"{x}"' for x in perintah_dasar())
                    p.write_text(f'@echo off\r\nstart "" {jalan}\r\n', encoding="utf-8")
                elif p.exists():
                    p.unlink()
            except OSError as e:
                messagebox.showerror(APP, f"Gagal mengatur buka otomatis: {e}")

        def buka_path(self, p: Path):
            p.parent.mkdir(parents=True, exist_ok=True)
            if not p.exists():
                p.mkdir() if p.suffix == "" else p.touch()
            if os.name == "nt":
                os.startfile(str(p))   # noqa: S606
            else:
                webbrowser.open(p.as_uri())

        def buka_sementrack(self):
            url = self.v_akun["SEMENTRACK_URL"].get().strip()
            if url:
                webbrowser.open(url)
            else:
                self.tampil("pengaturan")

        def tutup(self):
            if self.proses and not messagebox.askyesno(APP, "Masih ada proses berjalan. Tutup dan hentikan prosesnya?"):
                return
            if self.proses:
                self.hentikan_paksa()
            if self.setelan["jadwal_aktif"] and not self.proses:
                jawab = messagebox.askyesnocancel(APP, "Jadwal di aplikasi hanya jalan selama aplikasi terbuka.\n\n"
                                                       "Ya = kecilkan ke taskbar (jadwal tetap jalan)\nTidak = tutup aplikasi")
                if jawab is None:
                    return
                if jawab:
                    self.iconify()
                    return
            self.destroy()

        def hentikan_paksa(self):
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(self.proses.pid), "/T", "/F"], capture_output=True, creationflags=0x08000000)
            else:
                self.proses.terminate()
            try:
                mesin.KUNCI.unlink()
            except OSError:
                pass

    App().mainloop()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        mesin.jalankan_cli()        # mode baris perintah: dari aplikasi ini sendiri atau Task Scheduler
    else:
        jalankan_aplikasi()
