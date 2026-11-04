import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, ApiError } from '../lib/api';
import { forgetData } from '../lib/data';
import { useDocTitle } from '../lib/hooks';
import { MONTHS_ID, fmt } from '../lib/format';
import { dayCount, fmtDate, fmtRange } from '../lib/dates';
import type { SellinParseResult, SellinRow } from '../lib/sellin';
import type { SellinWorkerIn, SellinWorkerOut } from '../lib/sellin.worker';
import type { Row } from '../lib/types';
import { Badge, Breadcrumb, ErrorBox, PageHeader, TableWrap, cx } from '../components/ui';

type Source = 'file' | 'tempel';
type Phase =
  | { kind: 'idle' }
  | { kind: 'reading'; name: string; size: number; progress: number }
  | { kind: 'preview'; res: SellinParseResult; source: Source; name: string }
  | { kind: 'saving'; sent: number; total: number; step: 'kirim' | 'simpan' }
  | { kind: 'done'; result: Row; name: string };

const MAX_FILE_MB = 150;
const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 ? 1 : 0);
const fmtSize = (b: number) => (b >= 1e6 ? (b / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' MB' : Math.ceil(b / 1e3) + ' KB');
const Ic = ({ d, className = 'w-4 h-4' }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}><path d={d} /></svg>
);

/** Kirim baris per paket ke server lalu commit. Paket otomatis diperkecil kalau server menolak ukurannya (413). */
async function uploadRows(rows: SellinRow[], meta: Record<string, unknown>, onSent: (n: number) => void, onCommit: () => void) {
  const { id } = await adminApi<{ id: number }>('POST', 'admin/sellin/begin', meta);
  try {
    let size = 4000, i = 0;
    while (i < rows.length) {
      const pkg = rows.slice(i, i + size);
      try {
        await adminApi('POST', 'admin/sellin/stage', { upload_id: id, rows: pkg });
        i += pkg.length; onSent(i);
      } catch (e) {
        if (e instanceof ApiError && e.status === 413 && size > 200) { size = Math.floor(size / 2); continue; }
        throw e;
      }
    }
    onCommit();
    return await adminApi<Row>('POST', 'admin/sellin/commit', { upload_id: id });
  } catch (e) {
    void adminApi('POST', 'admin/sellin/abort', { upload_id: id }).catch(() => {});
    throw e;
  }
}

export default function UploadSellIn() {
  useDocTitle('Upload Sell In');
  const [source, setSource] = useState<Source>('file');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [drag, setDrag] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // data pendukung
  const [regionMap, setRegionMap] = useState<Row[] | null>(null);
  const [uploads, setUploads] = useState<Row[] | null>(null);
  const [unmapped, setUnmapped] = useState<Row[] | null>(null);
  const [supportError, setSupportError] = useState<string | null>(null);
  const reloadSupport = useCallback(() => {
    Promise.all([
      adminApi<Row[]>('GET', 'admin/sellin/region-map'),
      adminApi<Row[]>('GET', 'admin/sellin/uploads'),
      adminApi<Row[]>('GET', 'admin/sellin/unmapped'),
    ]).then(([m, u, x]) => { setRegionMap(m); setUploads(u); setUnmapped(x); setSupportError(null); })
      .catch(e => setSupportError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { reloadSupport(); }, [reloadSupport]);
  useEffect(() => () => workerRef.current?.terminate(), []);

  // cegah tab tertutup saat menyimpan
  const saving = phase.kind === 'saving';
  useEffect(() => {
    if (!saving) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [saving]);

  const parse = (msg: SellinWorkerIn, name: string, size: number) => {
    setError(null);
    workerRef.current?.terminate();
    const w = new Worker(new URL('../lib/sellin.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    setPhase({ kind: 'reading', name, size, progress: 0 });
    w.onmessage = (e: MessageEvent<SellinWorkerOut>) => {
      const d = e.data;
      if (d.type === 'progress') setPhase(p => (p.kind === 'reading' ? { ...p, progress: d.p } : p));
      else if (d.type === 'done') { w.terminate(); workerRef.current = null; setPhase({ kind: 'preview', res: d.res, source: msg.kind === 'text' ? 'tempel' : 'file', name }); }
      else { w.terminate(); workerRef.current = null; setError(d.message); setPhase({ kind: 'idle' }); }
    };
    w.onerror = e => { w.terminate(); workerRef.current = null; setError(e.message || 'Gagal membaca file.'); setPhase({ kind: 'idle' }); };
    w.postMessage(msg);
  };

  const onFile = (f: File | undefined | null) => {
    if (!f) return;
    if (!/\.(xlsx|csv|tsv|txt|xls)$/i.test(f.name)) { setError('Pilih file .xlsx atau .csv.'); return; }
    if (f.size > MAX_FILE_MB * 1e6) { setError(`File terlalu besar (${fmtSize(f.size)}). Maksimal ${MAX_FILE_MB} MB.`); return; }
    parse({ kind: 'file', file: f }, f.name, f.size);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); };
  const cancelRead = () => { workerRef.current?.terminate(); workerRef.current = null; setPhase({ kind: 'idle' }); };
  const reset = () => { setPhase({ kind: 'idle' }); setError(null); if (fileInput.current) fileInput.current.value = ''; };

  const save = async () => {
    if (phase.kind !== 'preview') return;
    const { res, source: src, name } = phase;
    setError(null);
    const total = res.rows.length;
    setPhase({ kind: 'saving', sent: 0, total, step: 'kirim' });
    try {
      const result = await uploadRows(res.rows,
        { source: src, file_name: src === 'file' ? name : null, date_from: res.stats.dateFrom, date_to: res.stats.dateTo, rows_read: res.stats.rowsRead },
        n => setPhase({ kind: 'saving', sent: n, total, step: 'kirim' }),
        () => setPhase({ kind: 'saving', sent: total, total, step: 'simpan' }));
      forgetData('sellin:');
      setPhase({ kind: 'done', result, name });
      setPasted('');
      reloadSupport();
    } catch (e) {
      setError('Gagal menyimpan: ' + (e instanceof Error ? e.message : String(e)) + ' Data lama tidak berubah.');
      setPhase({ kind: 'preview', res, source: src, name });
    }
  };

  const pasteRows = useMemo(() => (pasted ? pasted.split('\n').filter(l => l.trim()).length : 0), [pasted]);

  return (
    <div>
      <Breadcrumb items={['Administrasi', 'Upload Sell In']} />
      <PageHeader title="Upload Sell In"
        desc="Data untuk halaman Sell In BNN, dari file export raw sell in. Semua data pada rentang tanggal yang ada di file akan diganti dengan isi file." />

      <ol className="upl-steps" aria-label="Langkah">
        <li className={cx(phase.kind === 'idle' || phase.kind === 'reading' ? 'is-current' : 'is-done')}><span>1</span>Pilih data</li>
        <li className={cx(phase.kind === 'preview' ? 'is-current' : (phase.kind === 'saving' || phase.kind === 'done') && 'is-done')}><span>2</span>Periksa</li>
        <li className={cx(phase.kind === 'saving' ? 'is-current' : phase.kind === 'done' && 'is-done')}><span>3</span>Simpan</li>
      </ol>

      {error && <div className="mb-4"><ErrorBox error={error} /></div>}

      {/* ---------------- 1. Sumber data ---------------- */}
      {(phase.kind === 'idle' || phase.kind === 'reading') && (
        <section className="card !p-0" aria-label="Sumber data">
          <div className="seg" role="tablist" aria-label="Cara memasukkan data">
            <button type="button" role="tab" aria-selected={source === 'file'} className={cx('seg-btn', source === 'file' && 'is-active')} onClick={() => setSource('file')} disabled={phase.kind === 'reading'}>
              <Ic d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5L14 3Zm0 0v4.5h4.5" />Upload file
            </button>
            <button type="button" role="tab" aria-selected={source === 'tempel'} className={cx('seg-btn', source === 'tempel' && 'is-active')} onClick={() => setSource('tempel')} disabled={phase.kind === 'reading'}>
              <Ic d="M9 4h6v3H9zM8 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H16M9 12h6M9 15.5h4" />Tempel dari Excel
            </button>
          </div>

          <div className="p-5">
            {phase.kind === 'reading' ? (
              <div className="py-6 max-w-[560px] mx-auto text-center" role="status">
                <div className="font-semibold text-ink text-[14px] truncate">{phase.name}</div>
                <div className="text-faint text-[12.5px] mt-0.5">{phase.size ? fmtSize(phase.size) + ' · ' : ''}membaca dan memilah baris…</div>
                <div className="upl-bar mt-4" aria-hidden="true"><i style={{ width: `${Math.round(phase.progress * 100)}%` }} /></div>
                <div className="font-mono text-[11.5px] text-soft mt-2">{Math.round(phase.progress * 100)}%</div>
                <button type="button" className="btn btn-sm mt-4" onClick={cancelRead}>Batalkan</button>
              </div>
            ) : source === 'file' ? (
              <div className={cx('upl-drop', drag && 'is-drag')}
                onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
                <Ic d="M12 15V4m-4.5 4.5L12 4l4.5 4.5M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14" className="w-7 h-7 text-faint" />
                <div className="text-[14px] text-ink font-semibold mt-3">Tarik file ke sini</div>
                <div className="text-[12.5px] text-soft mt-1">atau</div>
                <button type="button" className="btn btn-primary mt-2.5" onClick={() => fileInput.current?.click()}>Pilih file</button>
                <div className="text-[12px] text-faint mt-3">.xlsx atau .csv, kolom sama dengan export raw sell in. Maks {MAX_FILE_MB} MB.</div>
                <input ref={fileInput} type="file" accept=".xlsx,.csv,.tsv,.txt" className="sr-only" tabIndex={-1} aria-hidden="true"
                  onChange={e => onFile(e.target.files?.[0])} />
              </div>
            ) : (
              <div>
                <label htmlFor="uplPaste" className="block text-[13px] text-soft mb-2">
                  Blok seluruh tabel di Excel <b className="text-ink font-semibold">termasuk baris judul</b>, salin (Ctrl+C), lalu tempel di sini (Ctrl+V).
                </label>
                <textarea id="uplPaste" className="upl-paste" value={pasted} onChange={e => setPasted(e.target.value)} spellCheck={false}
                  placeholder={'Distributor\tKode Customer\tNama Customer\t…\n6984 - BANGUN MITRA MAKMUR, PT\t3300000006\tGudang Way Lunik\t…'} />
                <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
                  <span className="font-mono text-[11.5px] text-faint">{pasteRows ? `${fmt(Math.max(pasteRows - 1, 0))} baris data` : 'Belum ada data'}</span>
                  <div className="flex gap-2">
                    {pasted && <button type="button" className="btn btn-sm" onClick={() => setPasted('')}>Kosongkan</button>}
                    <button type="button" className="btn btn-sm btn-primary" disabled={pasteRows < 2} onClick={() => parse({ kind: 'text', text: pasted }, 'Data tempelan', pasted.length)}>Periksa data</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---------------- 2. Pratinjau ---------------- */}
      {(phase.kind === 'preview' || phase.kind === 'saving') && (
        <Preview phase={phase} regionMap={regionMap} onRegionSaved={reloadSupport} onSave={save} onCancel={reset} />
      )}

      {/* ---------------- 3. Selesai ---------------- */}
      {phase.kind === 'done' && (
        <section className="card upl-done" role="status">
          <div className="flex items-start gap-3.5">
            <span className="upl-check" aria-hidden="true"><Ic d="M5 12.5 10 17 19 7.5" className="w-4 h-4" /></span>
            <div className="min-w-0">
              <h2 className="!text-[22px]">Data tersimpan</h2>
              <p className="text-soft text-[13.5px] mt-1.5 leading-relaxed">
                {fmt(phase.result.rows_saved)} pengiriman ({fmtTon(Number(phase.result.ton_saved))} ton) untuk {fmtRange({ from: String(phase.result.date_from), to: String(phase.result.date_to) })}.
                {Number(phase.result.rows_replaced) > 0 ? ` Menggantikan ${fmt(phase.result.rows_replaced)} baris lama pada rentang itu.` : ' Belum ada data sebelumnya pada rentang itu.'}
              </p>
              <div className="flex gap-2 mt-4 flex-wrap">
                <Link to="/sell-in-bnn" className="btn btn-primary no-underline">Lihat Sell In BNN</Link>
                <button type="button" className="btn" onClick={reset}>Upload lagi</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {supportError && <div className="mt-6"><ErrorBox error={supportError} /></div>}

      {/* ---------------- Kode tanpa region (dari data tersimpan) ---------------- */}
      {unmapped && unmapped.length > 0 && (
        <>
          <h2 className="section-title">Gudang Belum Punya Region <span className="n">{unmapped.length} kode</span></h2>
          <p className="text-soft text-[13px] -mt-1.5 mb-3 max-w-[680px]">Pengiriman ke kode ini tampil sebagai "Belum dipetakan" di Sell In BNN. Pilih region-nya; berlaku langsung untuk semua data.</p>
          <RegionAssign codes={unmapped.map(u => ({ kode: String(u.kode_customer), nama: String(u.nama_customer || ''), extra: `${fmt(u.pengiriman)} pengiriman · ${fmtTon(Number(u.ton))} ton` }))}
            regions={regionList(regionMap)} onSaved={reloadSupport} />
        </>
      )}

      {/* ---------------- Riwayat ---------------- */}
      <h2 className="section-title">Riwayat Upload</h2>
      <TableWrap>
        <table>
          <caption className="sr-only">30 upload terakhir</caption>
          <thead><tr><th>Waktu</th><th>Oleh</th><th>Sumber</th><th>Periode data</th><th className="num">Tersimpan</th><th className="num">Ton</th><th className="num">Diganti</th><th>Status</th></tr></thead>
          <tbody>
            {!uploads && <tr><td colSpan={8} className="!text-center !text-faint !p-5">Memuat…</td></tr>}
            {uploads && uploads.length === 0 && <tr><td colSpan={8} className="!text-center !text-faint !p-5">Belum ada upload.</td></tr>}
            {uploads?.map(u => (
              <tr key={u.id}>
                <td className="font-mono text-[12px] whitespace-nowrap">{new Date(u.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{u.created_by}</td>
                <td className="max-w-[240px] truncate" title={u.file_name || ''}>{u.source === 'tempel' ? 'Tempel dari Excel' : u.file_name || 'File'}</td>
                <td className="whitespace-nowrap">{fmtRange({ from: String(u.date_from), to: String(u.date_to) })}</td>
                <td className="num font-mono">{u.rows_saved == null ? '–' : fmt(u.rows_saved)}</td>
                <td className="num font-mono">{u.ton_saved == null ? '–' : fmtTon(Number(u.ton_saved))}</td>
                <td className="num font-mono">{u.rows_replaced == null ? '–' : fmt(u.rows_replaced)}</td>
                <td>{u.status === 'selesai' ? <Badge variant="good">Selesai</Badge> : u.status === 'batal' ? <Badge variant="neutral">Batal</Badge> : <Badge variant="warn">Proses</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      {/* ---------------- Peta region ---------------- */}
      <RegionMapSection regionMap={regionMap} onSaved={reloadSupport} />
    </div>
  );
}

const regionList = (m: Row[] | null) => [...new Set((m || []).map(r => String(r.region)))].sort((a, b) => a.localeCompare(b));

/* ============================================================================
   Pratinjau hasil baca file
============================================================================ */
function Preview({ phase, regionMap, onRegionSaved, onSave, onCancel }: {
  phase: Extract<Phase, { kind: 'preview' } | { kind: 'saving' }>; regionMap: Row[] | null;
  onRegionSaved: () => void; onSave: () => void; onCancel: () => void;
}) {
  // simpan pratinjau terakhir supaya tetap tampil saat proses simpan berjalan
  const last = useRef<Extract<Phase, { kind: 'preview' }> | null>(null);
  if (phase.kind === 'preview') last.current = phase;
  const pv = last.current;
  const res = pv?.res;
  const st = res?.stats;

  const [impact, setImpact] = useState<Row | null>(null);
  useEffect(() => {
    setImpact(null);
    if (!st?.dateFrom || !st.dateTo) return;
    adminApi<Row>('GET', `admin/sellin/impact?from=${st.dateFrom}&to=${st.dateTo}`).then(setImpact).catch(() => setImpact(null));
  }, [st?.dateFrom, st?.dateTo]);

  if (!pv || !res || !st) return null;
  const savingNow = phase.kind === 'saving';

  if (!res.ok) {
    return (
      <section className="card">
        <h2 className="!text-[20px]">File tidak bisa dipakai</h2>
        <p className="text-soft text-[13.5px] mt-2">{res.error}</p>
        {res.missing && res.missing.length > 0 && (
          <div className="mt-3 text-[13px]">
            <div className="text-soft mb-1.5">Kolom yang tidak ditemukan:</div>
            <div className="flex gap-1.5 flex-wrap">{res.missing.map(m => <span key={m} className="tag-code !text-red !bg-red-soft">{m}</span>)}</div>
            <p className="text-faint text-[12.5px] mt-3">Pastikan baris pertama berisi judul kolom persis seperti export raw sell in, dan baris judul ikut tersalin.</p>
          </div>
        )}
        <button type="button" className="btn mt-4" onClick={onCancel}>Pilih data lain</button>
      </section>
    );
  }

  const known = new Set((regionMap || []).map(r => String(r.kode_customer)));
  const unknownCodes = regionMap ? Object.entries(st.customers).filter(([k]) => !known.has(k)) : [];
  const months = Object.entries(st.byMonth).sort(([a], [b]) => a.localeCompare(b));
  const days = st.dateFrom && st.dateTo ? dayCount({ from: st.dateFrom, to: st.dateTo }) : 0;
  const existing = impact ? Number(impact.rows_existing) : null;
  const canSave = st.rowsUsed > 0 && !savingNow;
  const pctSent = phase.kind === 'saving' ? Math.round(phase.sent / Math.max(phase.total, 1) * 100) : 0;

  return (
    <section className="card !p-0" aria-label="Pratinjau data">
      <div className="px-[22px] pt-5 pb-4 border-b border-line flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="card-title">Pratinjau</div>
          <div className="font-sans text-[17px] font-semibold text-ink truncate mt-0.5" title={pv.name}>{pv.source === 'tempel' ? 'Data tempelan' : pv.name}</div>
        </div>
        {!savingNow && <button type="button" className="btn btn-sm" onClick={onCancel}>Ganti data</button>}
      </div>

      <div className="upl-facts">
        <div>
          <div className="card-title">Periode di file</div>
          <div className="upl-fact">{st.dateFrom ? fmtRange({ from: st.dateFrom, to: st.dateTo! }) : '–'}</div>
          <div className="upl-sub">{days ? `${fmt(days)} hari, menurut Tanggal Pengiriman` : 'Tidak ada tanggal'}</div>
        </div>
        <div>
          <div className="card-title">Baris dipakai</div>
          <div className="upl-fact">{fmt(st.rowsUsed)} <span className="upl-of">dari {fmt(st.rowsRead)}</span></div>
          <div className="upl-sub">{fmt(st.usedGudang)} Gudang · {fmt(st.usedPmTokoProject)} Toko/Project PM</div>
        </div>
        <div>
          <div className="card-title">Tonase</div>
          <div className="upl-fact">{fmtTon(st.ton)} <span className="upl-of">ton</span></div>
          <div className="upl-sub">Delivery Quantity × berat per zak</div>
        </div>
        <div>
          <div className="card-title">Tidak dipakai</div>
          <div className="upl-fact">{fmt(st.skippedTokoProject + st.skippedOther)}</div>
          <div className="upl-sub">Toko/Project selain PM dari ITP-Palembang{st.skippedOther ? ` · ${fmt(st.skippedOther)} tipe lain` : ''}</div>
        </div>
      </div>

      <div className="px-[22px] pb-5 grid gap-5 grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] max-[960px]:grid-cols-1">
        {/* per bulan */}
        <div>
          <div className="card-title mb-2">Per bulan</div>
          <div className="border border-line rounded overflow-hidden">
            <table className="!min-w-0 tbl-dense">
              <thead><tr><th>Bulan</th><th className="num">Pengiriman</th><th className="num">Ton</th></tr></thead>
              <tbody>
                {months.map(([k, v]) => (
                  <tr key={k}><td>{MONTHS_ID[Number(k.slice(5))]} {k.slice(0, 4)}</td><td className="num font-mono">{fmt(v.rows)}</td><td className="num font-mono">{fmtTon(v.ton)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* dampak + peringatan */}
        <div className="flex flex-col gap-3">
          <div className={cx('upl-note', existing ? 'is-warn' : 'is-info')}>
            <Ic d={existing ? 'M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.7L13.7 3.9a2 2 0 0 0-3.4 0Z' : 'M12 11v6M12 7.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z'} className="w-[18px] h-[18px] shrink-0 mt-px" />
            <div>
              {impact == null ? 'Memeriksa data yang sudah ada…'
                : existing
                  ? <>Data lama pada {fmtRange({ from: st.dateFrom!, to: st.dateTo! })} (<b>{fmt(existing)} pengiriman, {fmtTon(Number(impact.ton_existing))} ton</b>) akan <b>diganti</b> dengan isi file ini.</>
                  : <>Belum ada data pada {fmtRange({ from: st.dateFrom!, to: st.dateTo! })}. Isi file akan ditambahkan.</>}
            </div>
          </div>

          {st.invalid > 0 && (
            <div className="upl-note is-bad">
              <Ic d="M12 8v5M12 16.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" className="w-[18px] h-[18px] shrink-0 mt-px" />
              <div className="min-w-0">
                <b>{fmt(st.invalid)} baris dilewati</b> karena isinya tidak terbaca:
                <ul className="mt-1.5 text-[12.5px] list-none p-0 m-0 flex flex-col gap-0.5">
                  {st.issues.slice(0, 6).map(i => <li key={i.row} className="truncate"><span className="font-mono text-faint">Baris {i.row}</span> · {i.reason}</li>)}
                  {st.invalid > 6 && <li className="text-faint">dan {fmt(st.invalid - 6)} lainnya</li>}
                </ul>
              </div>
            </div>
          )}

          {unknownCodes.length > 0 && (
            <div className="upl-note is-warn">
              <Ic d="M12 21s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12ZM12 11.5v.01" className="w-[18px] h-[18px] shrink-0 mt-px" />
              <div className="min-w-0 flex-1">
                <b>{unknownCodes.length} kode Gudang belum punya region.</b> Atur sekarang supaya langsung masuk region yang benar (bisa juga setelah upload).
                <div className="mt-2.5">
                  <RegionAssign compact codes={unknownCodes.map(([kode, nama]) => ({ kode, nama }))} regions={regionList(regionMap)} onSaved={onRegionSaved} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="px-[22px] py-4 border-t border-line flex items-center justify-between gap-4 flex-wrap bg-surface2/60">
        {phase.kind === 'saving' ? (
          <div className="flex-1 min-w-[240px]" role="status">
            <div className="flex justify-between text-[12.5px] text-soft mb-1.5">
              <span>{phase.step === 'kirim' ? `Mengirim ${fmt(phase.sent)} dari ${fmt(phase.total)} baris` : 'Menyimpan ke database…'}</span>
              <span className="font-mono">{phase.step === 'kirim' ? pctSent + '%' : ''}</span>
            </div>
            <div className={cx('upl-bar', phase.step === 'simpan' && 'is-busy')}><i style={{ width: phase.step === 'kirim' ? `${pctSent}%` : '100%' }} /></div>
            <div className="text-faint text-[11.5px] mt-1.5">Jangan tutup halaman ini. Kalau gagal di tengah, data lama tetap utuh.</div>
          </div>
        ) : (
          <>
            <span className="text-[12.5px] text-soft">{st.rowsUsed ? `${fmt(st.rowsUsed)} pengiriman siap disimpan.` : 'Tidak ada baris yang memenuhi aturan.'}</span>
            <div className="flex gap-2">
              <button type="button" className="btn" onClick={onCancel}>Batal</button>
              <button type="button" className="btn btn-primary" disabled={!canSave} onClick={onSave}>Simpan ke database</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ============================================================================
   Pilih region untuk kode customer
============================================================================ */
function RegionAssign({ codes, regions, onSaved, compact }: { codes: { kode: string; nama: string; extra?: string }[]; regions: string[]; onSaved: () => void; compact?: boolean }) {
  const [val, setVal] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const listId = useMemo(() => 'rg-' + Math.random().toString(36).slice(2, 8), []);
  const save = async (kode: string, nama: string) => {
    const region = (val[kode] || '').trim();
    if (!region) return;
    setBusy(kode); setMsg(null);
    try { await adminApi('POST', 'admin/sellin/region-map', { kode_customer: kode, region, nama_customer: nama }); forgetData('sellin:'); onSaved(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  return (
    <div className={cx('flex flex-col', compact ? 'gap-2' : 'gap-0 card !p-0 overflow-hidden')}>
      <datalist id={listId}>{regions.map(r => <option key={r} value={r} />)}</datalist>
      {codes.map(c => (
        <div key={c.kode} className={cx('flex items-center gap-3 flex-wrap', !compact && 'px-4 py-3 border-b border-line last:border-b-0')}>
          <div className="min-w-0 flex-1 basis-[220px]">
            <span className="font-mono text-[12px] text-soft mr-2">{c.kode}</span>
            <span className="text-[13px] text-ink">{c.nama || '–'}</span>
            {c.extra && <div className="text-faint text-[11.5px] mt-0.5">{c.extra}</div>}
          </div>
          <input type="text" list={listId} aria-label={`Region untuk ${c.kode}`} placeholder="Region" value={val[c.kode] || ''}
            onChange={e => setVal(v => ({ ...v, [c.kode]: e.target.value }))} className="!min-w-0 w-[150px] !py-1.5"
            onKeyDown={e => { if (e.key === 'Enter') void save(c.kode, c.nama); }} />
          <button type="button" className="btn btn-sm" disabled={!val[c.kode]?.trim() || busy === c.kode} onClick={() => save(c.kode, c.nama)}>
            {busy === c.kode ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      ))}
      {msg && <div className="text-red text-[12.5px] px-1">{msg}</div>}
    </div>
  );
}

/* ============================================================================
   Peta region lengkap (lihat + tambah/ubah)
============================================================================ */
function RegionMapSection({ regionMap, onSaved }: { regionMap: Row[] | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ kode: '', region: '', nama: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const regions = regionList(regionMap);
  const rows = (regionMap || []).filter(r => !q || `${r.kode_customer} ${r.nama_customer} ${r.region}`.toLowerCase().includes(q.toLowerCase()));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.kode.trim() || !form.region.trim()) return;
    setBusy(true); setMsg(null);
    try {
      await adminApi('POST', 'admin/sellin/region-map', { kode_customer: form.kode.trim(), region: form.region.trim(), nama_customer: form.nama.trim() || null });
      forgetData('sellin:');
      setMsg({ ok: true, text: `Region untuk ${form.kode.trim()} disimpan.` });
      setForm({ kode: '', region: '', nama: '' });
      onSaved();
    } catch (err) { setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) }); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mt-[38px] mb-3.5">
        <h2 className="section-title !m-0">Peta Region <span className="n">{regionMap ? `${regionMap.length} kode customer · ${regions.length} region` : ''}</span></h2>
        <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Sembunyikan' : 'Lihat & ubah'}</button>
      </div>
      {open && (
        <div className="grid gap-4 grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)] max-[960px]:grid-cols-1 items-start">
          <div>
            <input type="search" placeholder="Cari kode, nama, atau region…" value={q} onChange={e => setQ(e.target.value)} className="w-full mb-2.5" aria-label="Cari di peta region" />
            <TableWrap className="max-h-[420px] overflow-y-auto">
              <table className="!min-w-0">
                <thead><tr><th>Region</th><th>Kode</th><th>Nama customer</th><th>Diubah</th></tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.kode_customer} className="cursor-pointer" onClick={() => setForm({ kode: String(r.kode_customer), region: String(r.region), nama: String(r.nama_customer || '') })}>
                      <td className="font-semibold">{r.region}</td>
                      <td className="font-mono text-[12px]">{r.kode_customer}</td>
                      <td>{r.nama_customer || '–'}</td>
                      <td className="text-faint text-[12px] whitespace-nowrap">{r.updated_by}{r.updated_at ? ' · ' + fmtDate(String(r.updated_at).slice(0, 10)) : ''}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={4} className="!text-center !text-faint !p-5">Tidak ditemukan.</td></tr>}
                </tbody>
              </table>
            </TableWrap>
          </div>
          <form className="card" onSubmit={submit}>
            <div className="card-title">Tambah atau ubah</div>
            <p className="text-faint text-[12px] mb-3">Klik baris di tabel untuk mengubahnya.</p>
            <div className="flex flex-col gap-3">
              <div className="control"><label htmlFor="rmKode">Kode customer</label><input id="rmKode" type="text" value={form.kode} onChange={e => setForm(f => ({ ...f, kode: e.target.value }))} placeholder="mis. 3300000006" /></div>
              <div className="control"><label htmlFor="rmRegion">Region</label>
                <input id="rmRegion" type="text" list="rm-regions" value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} placeholder="Pilih atau ketik region baru" />
                <datalist id="rm-regions">{regions.map(r => <option key={r} value={r} />)}</datalist>
              </div>
              <div className="control"><label htmlFor="rmNama">Nama customer (opsional)</label><input id="rmNama" type="text" value={form.nama} onChange={e => setForm(f => ({ ...f, nama: e.target.value }))} /></div>
              <button type="submit" className="btn btn-primary justify-center" disabled={busy || !form.kode.trim() || !form.region.trim()}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
              {msg && <div className={cx('text-[12.5px]', msg.ok ? 'text-green' : 'text-red')} role="status">{msg.text}</div>}
            </div>
          </form>
        </div>
      )}
    </>
  );
}
