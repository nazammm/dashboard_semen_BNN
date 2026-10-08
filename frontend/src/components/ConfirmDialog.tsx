import { useEffect, useRef, type ReactNode } from 'react';

/** Dialog konfirmasi sederhana (pengganti window.confirm). Esc / klik latar = batal. */
export default function ConfirmDialog({ title, children, confirmLabel = 'Hapus', busy, error, onConfirm, onCancel }: {
  title: string; children: ReactNode; confirmLabel?: string; busy?: boolean; error?: string | null;
  onConfirm: () => void; onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/45"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cd-title" className="card !m-0 w-full max-w-[420px]">
        <h2 id="cd-title" className="card-title !text-[13px] mb-2.5">{title}</h2>
        <div className="text-[13.5px] text-soft leading-relaxed">{children}</div>
        {error && <div className="mt-3 text-[13px] text-red" role="alert">{error}</div>}
        <div className="flex gap-2 justify-end mt-4">
          <button type="button" ref={cancelRef} className="btn" disabled={busy} onClick={onCancel}>Batal</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
