/* ============================================================================
   Bagian bersama halaman Kelola Data: alur impor (pilih → periksa → simpan),
   pengiriman baris per paket, dan potongan UI kecil.
============================================================================ */
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { adminApi, ApiError } from '../../lib/api';
import { forgetAllData } from '../../lib/data';
import { fmt } from '../../lib/format';
import type { Dataset, ImportResult, ImportWorkerIn, ImportWorkerOut } from '../../lib/importer.worker';
import type { Row } from '../../lib/types';
import { notifyDataStatusChanged } from '../../components/DataStatus';
import { ErrorBox, cx } from '../../components/ui';

export type Source = 'file' | 'tempel';
export type ImportPhase<R extends ImportResult> =
  | { kind: 'idle' }
  | { kind: 'reading'; name: string; size: number; progress: number }
  | { kind: 'preview'; res: R; source: Source; name: string }
  | { kind: 'saving'; res: R; source: Source; name: string; sent: number; total: number; step: 'kirim' | 'simpan' }
  | { kind: 'done'; result: Row; name: string };

export const MAX_FILE_MB = 150;
export const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 ? 1 : 0);
export const fmtSize = (b: number) => (b >= 1e6 ? (b / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' MB' : Math.ceil(b / 1e3) + ' KB');
export const fmtWhen = (v: unknown) => new Date(String(v)).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const Ic = ({ d, className = 'w-4 h-4' }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}><path d={d} /></svg>
);
export const ICON = {
  file: 'M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5L14 3Zm0 0v4.5h4.5',
  paste: 'M9 4h6v3H9zM8 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H16M9 12h6M9 15.5h4',
  upload: 'M12 15V4m-4.5 4.5L12 4l4.5 4.5M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14',
  warn: 'M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.7L13.7 3.9a2 2 0 0 0-3.4 0Z',
  info: 'M12 11v6M12 7.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  bad: 'M12 8v5M12 16.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  check: 'M5 12.5 10 17 19 7.5',
  pin: 'M12 21s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12ZM12 11.5v.01',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l.8 12.2A1.5 1.5 0 0 0 8.8 20.6h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v6M14 11v6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
};

export function Note({ tone, icon, children }: { tone: 'info' | 'warn' | 'bad'; icon?: string; children: ReactNode }) {
  return (
    <div className={cx('upl-note', `is-${tone}`)}>
      <Ic d={icon || (tone === 'info' ? ICON.info : tone === 'warn' ? ICON.warn : ICON.bad)} className="w-[18px] h-[18px] shrink-0 mt-px" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Kirim baris per paket ke server lalu commit. Paket otomatis diperkecil kalau server menolak ukurannya (413). */
export async function uploadRows(base: string, rows: unknown[], meta: Record<string, unknown>, onSent: (n: number) => void, onCommit: () => void) {
  const { id } = await adminApi<{ id: number }>('POST', `${base}/begin`, meta);
  try {
    let size = 4000, i = 0;
    while (i < rows.length) {
      const pkg = rows.slice(i, i + size);
      try {
        await adminApi('POST', `${base}/stage`, { upload_id: id, rows: pkg });
        i += pkg.length; onSent(i);
      } catch (e) {
        if (e instanceof ApiError && e.status === 413 && size > 200) { size = Math.floor(size / 2); continue; }
        throw e;
      }
    }
    onCommit();
    return await adminApi<Row>('POST', `${base}/commit`, { upload_id: id });
  } catch (e) {
    void adminApi('POST', `${base}/abort`, { upload_id: id }).catch(() => {});
    throw e;
  }
}

/** Setelah data berubah: buang cache halaman lain dan segarkan badge status data. */
export function afterDataChanged() {
  forgetAllData();
  notifyDataStatusChanged();
}

/* ---------------------------------------------------------------------------
   Alur impor (state + worker). Dipakai panel Transaksi dan Sell In BNN.
--------------------------------------------------------------------------- */
export function useImport<R extends ImportResult>(dataset: Dataset) {
  const [phase, setPhase] = useState<ImportPhase<R>>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => () => workerRef.current?.terminate(), []);

  // cegah tab tertutup saat menyimpan
  const saving = phase.kind === 'saving';
  useEffect(() => {
    if (!saving) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [saving]);

  const read = (msg: ImportWorkerIn, name: string, size: number) => {
    setError(null);
    workerRef.current?.terminate();
    const w = new Worker(new URL('../../lib/importer.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    const done = () => { w.terminate(); workerRef.current = null; };
    setPhase({ kind: 'reading', name, size, progress: 0 });
    w.onmessage = (e: MessageEvent<ImportWorkerOut>) => {
      const d = e.data;
      if (d.type === 'progress') setPhase(p => (p.kind === 'reading' ? { ...p, progress: d.p } : p));
      else if (d.type === 'done') { done(); setPhase({ kind: 'preview', res: d.res as R, source: msg.kind === 'text' ? 'tempel' : 'file', name }); }
      else { done(); setError(d.message); setPhase({ kind: 'idle' }); }
    };
    w.onerror = e => { done(); setError(e.message || 'Gagal membaca file.'); setPhase({ kind: 'idle' }); };
    w.postMessage(msg);
  };

  const readFile = (f: File | undefined | null) => {
    if (!f) return;
    if (!/\.(xlsx|csv|tsv|txt|xls)$/i.test(f.name)) { setError('Pilih file .xlsx atau .csv.'); return; }
    if (f.size > MAX_FILE_MB * 1e6) { setError(`File terlalu besar (${fmtSize(f.size)}). Maksimal ${MAX_FILE_MB} MB.`); return; }
    read({ dataset, kind: 'file', file: f }, f.name, f.size);
  };
  const readText = (text: string) => read({ dataset, kind: 'text', text }, 'Data tempelan', text.length);
  const cancelRead = () => { workerRef.current?.terminate(); workerRef.current = null; setPhase({ kind: 'idle' }); };
  const reset = () => { setPhase({ kind: 'idle' }); setError(null); };

  /** Simpan pratinjau saat ini. `meta` = isi permintaan begin. */
  const save = async (base: string, rows: unknown[], meta: Record<string, unknown>) => {
    if (phase.kind !== 'preview') return false;
    const { res, source, name } = phase;
    const total = rows.length;
    setError(null);
    setPhase({ kind: 'saving', res, source, name, sent: 0, total, step: 'kirim' });
    try {
      const result = await uploadRows(base, rows, meta,
        n => setPhase({ kind: 'saving', res, source, name, sent: n, total, step: 'kirim' }),
        () => setPhase({ kind: 'saving', res, source, name, sent: total, total, step: 'simpan' }));
      afterDataChanged();
      setPhase({ kind: 'done', result, name });
      return true;
    } catch (e) {
      setError('Gagal menyimpan: ' + errText(e) + ' Data lama tidak berubah.');
      setPhase({ kind: 'preview', res, source, name });
      return false;
    }
  };

  return { phase, error, setError, readFile, readText, cancelRead, reset, save };
}

/* ---------------------------------------------------------------------------
   Langkah 1: pilih file atau tempel dari Excel
--------------------------------------------------------------------------- */
export function SourcePicker({ reading, onFile, onText, onCancel, fileHint, pastePlaceholder, id }: {
  reading: { name: string; size: number; progress: number } | null;
  onFile: (f: File | undefined | null) => void; onText: (t: string) => void; onCancel: () => void;
  fileHint: string; pastePlaceholder: string; id: string;
}) {
  const [source, setSource] = useState<Source>('file');
  const [pasted, setPasted] = useState('');
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pasteRows = useMemo(() => (pasted ? pasted.split('\n').filter(l => l.trim()).length : 0), [pasted]);
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); };

  return (
    <section className="card !p-0" aria-label="Sumber data">
      <div className="seg" role="tablist" aria-label="Cara memasukkan data">
        <button type="button" role="tab" aria-selected={source === 'file'} className={cx('seg-btn', source === 'file' && 'is-active')} onClick={() => setSource('file')} disabled={!!reading}>
          <Ic d={ICON.file} />Upload file
        </button>
        <button type="button" role="tab" aria-selected={source === 'tempel'} className={cx('seg-btn', source === 'tempel' && 'is-active')} onClick={() => setSource('tempel')} disabled={!!reading}>
          <Ic d={ICON.paste} />Tempel dari Excel
        </button>
      </div>

      <div className="p-5">
        {reading ? (
          <div className="py-6 max-w-[560px] mx-auto text-center" role="status">
            <div className="font-semibold text-ink text-[14px] truncate">{reading.name}</div>
            <div className="text-faint text-[12.5px] mt-0.5">{reading.size ? fmtSize(reading.size) + ' · ' : ''}membaca dan memeriksa baris…</div>
            <div className="upl-bar mt-4" aria-hidden="true"><i style={{ width: `${Math.round(reading.progress * 100)}%` }} /></div>
            <div className="font-mono text-[11.5px] text-soft mt-2">{Math.round(reading.progress * 100)}%</div>
            <button type="button" className="btn btn-sm mt-4" onClick={onCancel}>Batalkan</button>
          </div>
        ) : source === 'file' ? (
          <div className={cx('upl-drop', drag && 'is-drag')}
            onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
            <Ic d={ICON.upload} className="w-7 h-7 text-faint" />
            <div className="text-[14px] text-ink font-semibold mt-3">Tarik file ke sini</div>
            <div className="text-[12.5px] text-soft mt-1">atau</div>
            <button type="button" className="btn btn-primary mt-2.5" onClick={() => fileInput.current?.click()}>Pilih file</button>
            <div className="text-[12px] text-faint mt-3 max-w-[460px]">{fileHint} Maks {MAX_FILE_MB} MB.</div>
            <input ref={fileInput} type="file" accept=".xlsx,.csv,.tsv,.txt" className="sr-only" tabIndex={-1} aria-hidden="true"
              onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        ) : (
          <div>
            <label htmlFor={id + '-paste'} className="block text-[13px] text-soft mb-2">
              Blok seluruh tabel di Excel <b className="text-ink font-semibold">termasuk baris judul</b>, salin (Ctrl+C), lalu tempel di sini (Ctrl+V).
            </label>
            <textarea id={id + '-paste'} className="upl-paste" value={pasted} onChange={e => setPasted(e.target.value)} spellCheck={false} placeholder={pastePlaceholder} />
            <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
              <span className="font-mono text-[11.5px] text-faint">{pasteRows ? `${fmt(Math.max(pasteRows - 1, 0))} baris data` : 'Belum ada data'}</span>
              <div className="flex gap-2">
                {pasted && <button type="button" className="btn btn-sm" onClick={() => setPasted('')}>Kosongkan</button>}
                <button type="button" className="btn btn-sm btn-primary" disabled={pasteRows < 2} onClick={() => onText(pasted)}>Periksa data</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Langkah 1-2-3 di atas panel impor. */
export function Steps({ phase }: { phase: ImportPhase<ImportResult>['kind'] }) {
  return (
    <ol className="upl-steps" aria-label="Langkah">
      <li className={cx(phase === 'idle' || phase === 'reading' ? 'is-current' : 'is-done')}><span>1</span>Pilih data</li>
      <li className={cx(phase === 'preview' ? 'is-current' : (phase === 'saving' || phase === 'done') && 'is-done')}><span>2</span>Periksa</li>
      <li className={cx(phase === 'saving' ? 'is-current' : phase === 'done' && 'is-done')}><span>3</span>Simpan</li>
    </ol>
  );
}

/** Kerangka kartu pratinjau: judul, isi, dan bilah simpan / progres. */
export function PreviewFrame({ phase, title, children, readyText, canSave, onSave, onCancel, savingHint, saveLabel = 'Simpan ke database' }: {
  phase: Extract<ImportPhase<ImportResult>, { kind: 'preview' } | { kind: 'saving' }>;
  title: string; children: ReactNode; readyText: string; canSave: boolean;
  onSave: () => void; onCancel: () => void; savingHint?: string; saveLabel?: string;
}) {
  const saving = phase.kind === 'saving';
  const pctSent = saving ? Math.round(phase.sent / Math.max(phase.total, 1) * 100) : 0;
  return (
    <section className="card !p-0" aria-label="Pratinjau data">
      <div className="px-[22px] pt-5 pb-4 border-b border-line flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="card-title">Pratinjau</div>
          <div className="font-sans text-[17px] font-semibold text-ink truncate mt-0.5" title={title}>{title}</div>
        </div>
        {!saving && <button type="button" className="btn btn-sm" onClick={onCancel}>Ganti data</button>}
      </div>
      {children}
      <div className="px-[22px] py-4 border-t border-line flex items-center justify-between gap-4 flex-wrap bg-surface2/60">
        {phase.kind === 'saving' ? (
          <div className="flex-1 min-w-[240px]" role="status">
            <div className="flex justify-between text-[12.5px] text-soft mb-1.5">
              <span>{phase.step === 'kirim' ? `Mengirim ${fmt(phase.sent)} dari ${fmt(phase.total)} baris` : 'Menyimpan ke database…'}</span>
              <span className="font-mono">{phase.step === 'kirim' ? pctSent + '%' : ''}</span>
            </div>
            <div className={cx('upl-bar', phase.step === 'simpan' && 'is-busy')}><i style={{ width: phase.step === 'kirim' ? `${pctSent}%` : '100%' }} /></div>
            <div className="text-faint text-[11.5px] mt-1.5">{savingHint || 'Jangan tutup halaman ini. Kalau gagal di tengah, data lama tetap utuh.'}</div>
          </div>
        ) : (
          <>
            <span className="text-[12.5px] text-soft">{readyText}</span>
            <div className="flex gap-2">
              <button type="button" className="btn" onClick={onCancel}>Batal</button>
              <button type="button" className="btn btn-primary" disabled={!canSave} onClick={onSave}>{saveLabel}</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/** Kartu "file tidak bisa dipakai" (kolom wajib tidak ada, dsb.). */
export function Unusable({ error, missing, hint, onCancel, children }: { error?: string; missing?: string[]; hint: string; onCancel: () => void; children?: ReactNode }) {
  return (
    <section className="card">
      <h2 className="!text-[20px]">File tidak bisa dipakai</h2>
      <p className="text-soft text-[13.5px] mt-2">{error}</p>
      {missing && missing.length > 0 && (
        <div className="mt-3 text-[13px]">
          <div className="text-soft mb-1.5">Kolom yang tidak ditemukan:</div>
          <div className="flex gap-1.5 flex-wrap">{missing.map(m => <span key={m} className="tag-code !text-red !bg-red-soft">{m}</span>)}</div>
          <p className="text-faint text-[12.5px] mt-3">{hint}</p>
        </div>
      )}
      {children && <div className="mt-3">{children}</div>}
      <button type="button" className="btn mt-4" onClick={onCancel}>Pilih data lain</button>
    </section>
  );
}

/** Daftar baris yang dilewati karena isinya tidak terbaca. */
export function InvalidRows({ invalid, issues, what = 'baris dilewati' }: { invalid: number; issues: { row: number; reason: string }[]; what?: string }) {
  if (!invalid) return null;
  return (
    <Note tone="bad">
      <b>{fmt(invalid)} {what}</b> karena isinya tidak terbaca:
      <ul className="mt-1.5 text-[12.5px] list-none p-0 m-0 flex flex-col gap-0.5">
        {issues.slice(0, 6).map(i => <li key={i.row} className="truncate"><span className="font-mono text-faint">Baris {i.row}</span> · {i.reason}</li>)}
        {invalid > 6 && <li className="text-faint">dan {fmt(invalid - 6)} lainnya</li>}
      </ul>
    </Note>
  );
}

/** Kartu selesai. */
export function DoneCard({ title = 'Data tersimpan', children, actions }: { title?: string; children: ReactNode; actions: ReactNode }) {
  return (
    <section className="card upl-done" role="status">
      <div className="flex items-start gap-3.5">
        <span className="upl-check" aria-hidden="true"><Ic d={ICON.check} className="w-4 h-4" /></span>
        <div className="min-w-0">
          <h2 className="!text-[22px]">{title}</h2>
          <div className="text-soft text-[13.5px] mt-1.5 leading-relaxed">{children}</div>
          <div className="flex gap-2 mt-4 flex-wrap">{actions}</div>
        </div>
      </div>
    </section>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? <div className="mb-4"><ErrorBox error={error} /></div> : null;
}
