/* ============================================================================
   Tanya Data: ketik pertanyaan sederhana ("bulan apa omzet tertinggi PKB"), dijawab dari data dashboard.
   Tanpa model AI: pertanyaan dikenali lewat kata kunci (lib/tanya.ts), angkanya dari view yang sama
   dengan halaman lain. Setiap jawaban menampilkan "Saya memahami: ..." supaya salah tangkap terlihat.
============================================================================ */
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { DataSource, topCustomersRange } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { COLORS, chartSRSummary, fmt, fmtCompact } from '../lib/format';
import { CONTOH, jawab, type Jawaban, type TanyaCtx } from '../lib/tanya';
import type { Row } from '../lib/types';
import { ChartBox, ErrorBox, PageHeader, PageSkeleton, cx } from '../components/ui';

interface Item { id: number; tanya: string; jawab: Jawaban | null; error?: string }
const opt = <T,>(p: Promise<T>) => p.catch(() => null);

export default function TanyaData() {
  useDocTitle('Tanya Data');
  const { pageAllowed } = useAuth();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const nomor = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const load = useAsync(async () => {
    const [trx, distM, allM, ta, dists, sellin, stok] = await Promise.all([
      DataSource.transaksiMonthly(), DataSource.distMonthlyTotals(), DataSource.monthlyTotals(), DataSource.tokoAktifBulanan(), DataSource.distributors(),
      pageAllowed('sell-in-bnn') ? opt(DataSource.sellinDaily()) : Promise.resolve(null),
      pageAllowed('stock') ? opt(DataSource.stockHarian()) : Promise.resolve(null),
    ]);
    const ctx: TanyaCtx = {
      trx, distM, allM, ta, sellin, stok,
      dists: dists.map((d: Row) => ({ code: String(d.dist_code), name: String(d.dist_name || ''), wilayah: String(d.wilayah || '') })),
      topToko: (dist, from, to, kode, limit) => topCustomersRange(dist, { from, to }, kode, limit),
    };
    return ctx;
  }, []);

  if (load.error) return <ErrorBox error={load.error} />;
  if (!load.data) return <PageSkeleton />;
  const ctx = load.data;

  const tanya = async (teks: string) => {
    const t = teks.trim();
    if (!t) return;
    const id = ++nomor.current;
    setItems(xs => [{ id, tanya: t, jawab: null }, ...xs]);
    setQ('');
    try {
      const j = await jawab(t, ctx);
      setItems(xs => xs.map(x => (x.id === id ? { ...x, jawab: j } : x)));
    } catch (e) {
      setItems(xs => xs.map(x => (x.id === id ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)));
    }
    input.current?.focus();
  };
  const kirim = (e: FormEvent) => { e.preventDefault(); void tanya(q); };

  return (
    <div className="max-w-[920px]">
      <PageHeader title="Tanya Data" desc="Ketik pertanyaan sederhana tentang omzet, tonase, toko aktif, DO, sell in, atau stok. Jawaban dihitung langsung dari data dashboard." />

      <form onSubmit={kirim} className="card flex gap-2 items-center !py-3" role="search">
        <label htmlFor="tanya-q" className="sr-only">Pertanyaan</label>
        <input id="tanya-q" ref={input} type="search" value={q} onChange={e => setQ(e.target.value)} autoFocus autoComplete="off"
          placeholder="Misalnya: bulan apa omzet tertinggi PKB?" className="!flex-1 !min-w-0 !text-[15px] !py-[10px]" />
        <button type="submit" className="btn btn-primary !py-[10px] !px-5" disabled={!q.trim()}>Tanya</button>
      </form>

      {items.length === 0 && (
        <div className="mt-5">
          <p className="text-soft text-[13.5px] mb-3">Coba salah satu contoh ini, atau ganti distributor, jenis semen, dan bulannya:</p>
          <Contoh onPilih={tanya} />
        </div>
      )}

      <div className="flex flex-col gap-4 mt-5" aria-live="polite">
        {items.map(it => <Kartu key={it.id} it={it} onPilih={tanya} />)}
      </div>

      {items.length > 0 && (
        <details className="mt-6">
          <summary className="text-soft text-[13px] cursor-pointer">Contoh pertanyaan lain</summary>
          <div className="mt-3"><Contoh onPilih={tanya} /></div>
        </details>
      )}
      <p className="text-faint text-[12px] mt-6">
        Halaman ini mengenali pertanyaan lewat kata kunci, bukan model AI. Kalau pertanyaan tidak dikenali, ia tidak akan menebak.
        Angka mengikuti hak akses akun Anda.
      </p>
    </div>
  );
}

function Contoh({ onPilih }: { onPilih: (t: string) => void }) {
  return (
    <div className="grid grid-cols-3 max-[860px]:grid-cols-1 gap-4">
      {CONTOH.map(g => (
        <div key={g.grup}>
          <div className="card-title !mb-2">{g.grup}</div>
          <div className="flex flex-col gap-1.5">
            {g.items.map(t => (
              <button key={t} type="button" onClick={() => onPilih(t)}
                className="text-left text-[13px] rounded border border-line bg-surface px-3 py-2 hover:border-accent hover:text-accent-ink transition-colors">{t}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** **tebal** -> <strong> */
const tebal = (s: string) => s.split(/\*\*(.+?)\*\*/g).map((x, i) => (i % 2 ? <strong key={i} className="font-semibold text-ink">{x}</strong> : x));

function Kartu({ it, onPilih }: { it: Item; onPilih: (t: string) => void }) {
  const j = it.jawab;
  return (
    <article className="card">
      <div className="text-[12px] text-faint uppercase tracking-[.04em] font-medium">Pertanyaan</div>
      <h2 className="text-[15px] font-semibold mt-0.5">{it.tanya}</h2>

      {it.error ? <p className="text-red text-[13.5px] mt-3">Gagal menghitung: {it.error}</p>
        : !j ? <div className="skel h-[56px] mt-3" />
        : !j.ok ? (
          <div className="mt-3">
            <p className="text-[14px] text-soft">{j.teks}</p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {CONTOH.flatMap(g => g.items.slice(0, 1)).map(t => (
                <button key={t} type="button" className="text-[12.5px] rounded-full border border-line px-3 py-1 hover:border-accent" onClick={() => onPilih(t)}>{t}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <p className="text-[15.5px] leading-relaxed mt-3 text-soft">{tebal(j.teks)}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              <span className="text-faint text-[12px]">Saya memahami:</span>
              {j.paham.map(p => <span key={p} className="text-[12px] rounded-full bg-surface3 text-soft px-2.5 py-0.5">{p}</span>)}
            </div>

            {j.chart && j.chart.labels.length > 1 && (
              <ChartBox className={cx('mt-4', j.chart.garis ? 'h-[220px]' : undefined)} label={chartSRSummary(j.chart.labels, j.chart.values, j.chart.satuan)}
                deps={[it.id]}
                build={() => {
                  const c = j.chart!, garis = !!c.garis, datar = !garis && c.labels.length > 6;
                  return {
                    type: garis ? 'line' : 'bar',
                    data: { labels: c.labels, datasets: [{ label: c.satuan, data: c.values, borderColor: COLORS.accent, backgroundColor: garis ? COLORS.accent : COLORS.accent,
                      borderWidth: garis ? 2.2 : 0, pointRadius: garis ? 3 : 0, tension: 0.25, borderRadius: 3, maxBarThickness: 34 }] },
                    options: {
                      responsive: true, maintainAspectRatio: false, indexAxis: datar ? 'y' : 'x',
                      scales: {
                        [datar ? 'x' : 'y']: { beginAtZero: true, grid: { color: COLORS.line }, border: { display: false }, ticks: { callback: (x: any) => fmtCompact(x) } },
                        [datar ? 'y' : 'x']: { grid: { display: false }, ticks: { autoSkip: false } },
                      },
                      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (t: any) => ` ${fmt(datar ? t.parsed.x : t.parsed.y)} ${c.satuan === 'Rp' ? '' : c.satuan}` } } },
                    },
                  } as any;
                }} />
            )}

            {j.tabel && (
              <div className="table-wrap mt-4">
                <table className="tbl-dense !min-w-0">
                  <caption className="sr-only">Rincian jawaban: {it.tanya}</caption>
                  <thead><tr>{j.tabel.header.map((h, i) => <th key={h} className={cx(typeof j.tabel!.rows[0]?.[i] === 'number' || h === 'Perubahan' ? 'num' : undefined)}>{h}</th>)}</tr></thead>
                  <tbody>
                    {j.tabel.rows.map((r, ri) => (
                      <tr key={ri} className={cx(r[0] === 'Total' && 'font-semibold')}>
                        {r.map((c, ci) => (
                          <td key={ci} className={cx(typeof c === 'number' || j.tabel!.header[ci] === 'Perubahan' ? 'num font-mono' : undefined,
                            j.tabel!.header[ci] === 'Perubahan' && typeof c === 'string' && (c.startsWith('+') ? 'text-green' : c.startsWith('-') ? 'text-red' : ''))}>
                            {typeof c === 'number' ? fmt(c, c % 1 ? 1 : 0) : c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(j.catatan.length > 0 || j.link) && (
              <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
                <ul className="text-faint text-[12px] list-none p-0 m-0 flex flex-col gap-0.5">{j.catatan.map(c => <li key={c}>{c}</li>)}</ul>
                {j.link && <Link to={j.link.to} className="text-[12.5px] whitespace-nowrap">{j.link.label} →</Link>}
              </div>
            )}
          </>
        )}
    </article>
  );
}
