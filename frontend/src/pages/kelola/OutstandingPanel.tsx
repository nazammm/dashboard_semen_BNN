/* ============================================================================
   Kelola Data · Sell In · Outstanding DO: upload export raw sell in menurut tanggal order.
   Order dengan tanggal order di rentang file diganti dengan isi file (status terbaru).
============================================================================ */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { fmt, MONTHS_ID } from '../../lib/format';
import { fmtDate, fmtRange } from '../../lib/dates';
import type { DateOrder } from '../../lib/sellin';
import { PO_STATUS_ORDER, type PoParseResult } from '../../lib/outstandingImport';
import type { Row } from '../../lib/types';
import {
  DateOrderNote, DoneCard, ErrorLine, InvalidRows, Note, PreviewFrame, SourcePicker, Steps, Unusable, fmtTon, type ImportPhase, useImport,
} from './shared';

export function OutstandingUpload({ onChanged }: { onChanged: () => void }) {
  const imp = useImport<PoParseResult>('outstanding');
  const { phase } = imp;
  const [round, setRound] = useState(0);

  const save = async () => {
    if (phase.kind !== 'preview') return;
    const { res, source, name } = phase;
    const ok = await imp.save('admin/outstanding', res.rows,
      { source, file_name: source === 'file' ? name : null, date_from: res.stats.dateFrom, date_to: res.stats.dateTo, rows_read: res.stats.rowsRead });
    if (ok) { setRound(r => r + 1); onChanged(); }
  };

  return (
    <div>
      <Steps phase={phase.kind} />
      <ErrorLine error={imp.error} />
      <div hidden={phase.kind !== 'idle' && phase.kind !== 'reading'}>
        <SourcePicker key={round} id="po" reading={phase.kind === 'reading' ? phase : null} onFile={imp.readFile} onText={imp.readText} onCancel={imp.cancelRead}
          fileHint="Export raw sell in menurut Tanggal Order (semua status: Verified, Not Verified, Reject, Delivered). Order dengan tanggal order di rentang file diganti dengan isi file."
          pastePlaceholder={'Distributor\tKode Customer\tNama Customer\t…\tOrder No\tTanggal Order\tStatus Order\t…\n6984 - BANGUN MITRA MAKMUR, PT\t3300000006\tGudang Way Lunik\t…'} />
      </div>

      {(phase.kind === 'preview' || phase.kind === 'saving') && (
        phase.res.ok
          ? <OutstandingPreview phase={phase} onSave={save} onCancel={imp.reset} onDateOrder={imp.rereadDates} />
          : <Unusable error={phase.res.error} missing={phase.res.missing} onCancel={imp.reset}
              hint="Baris pertama harus judul kolom export raw sell in (Distributor, Order No, Tanggal Order, Status Order, Tipe Produk, Order Quantity, Delivery Quantity, Tipe Pesanan, …)." />
      )}

      {phase.kind === 'done' && (
        <DoneCard actions={<><Link to="/outstanding-do" className="btn btn-primary no-underline">Lihat Outstanding DO</Link><button type="button" className="btn" onClick={imp.reset}>Upload lagi</button></>}>
          {fmt(phase.result.rows_saved)} order untuk tanggal order {fmtRange({ from: String(phase.result.date_from).slice(0, 10), to: String(phase.result.date_to).slice(0, 10) })},
          {' '}posisi {fmtDate(String(phase.result.posisi).slice(0, 10))}. Outstanding {fmtTon(Number(phase.result.ton_outstanding))} ton.
          {Number(phase.result.rows_replaced) > 0 ? ` Menggantikan ${fmt(phase.result.rows_replaced)} order lama.` : ''}
        </DoneCard>
      )}
    </div>
  );
}

function OutstandingPreview({ phase, onSave, onCancel, onDateOrder }: {
  phase: Extract<ImportPhase<PoParseResult>, { kind: 'preview' } | { kind: 'saving' }>;
  onSave: () => void; onCancel: () => void; onDateOrder: (o: DateOrder) => void;
}) {
  const st = phase.res.stats;
  const [impact, setImpact] = useState<Row | null>(null);
  useEffect(() => {
    setImpact(null);
    if (!st.dateFrom || !st.dateTo) return;
    adminApi<Row>('GET', `admin/outstanding/impact?from=${st.dateFrom}&to=${st.dateTo}`).then(setImpact).catch(() => setImpact(null));
  }, [st.dateFrom, st.dateTo]);
  const months = Object.entries(st.byMonth).sort(([a], [b]) => a.localeCompare(b));
  const statuses = PO_STATUS_ORDER.filter(s => st.byStatus[s]);
  const existing = impact ? Number(impact.rows_existing) : null;
  const skipped = st.skippedTokoProject + st.skippedOther + st.skippedMortar;
  const isOpen = (s: string) => s === 'Belum dikirim' || s === 'Terkirim sebagian' || s === 'Belum diverifikasi';

  return (
    <PreviewFrame phase={phase} title={phase.source === 'tempel' ? 'Data tempelan' : phase.name} onSave={onSave} onCancel={onCancel}
      canSave={st.rowsUsed > 0} readyText={st.rowsUsed ? `${fmt(st.orders)} order siap disimpan.` : 'Tidak ada baris yang memenuhi aturan.'}>
      <div className="upl-facts">
        <div>
          <div className="card-title">Tanggal order di file</div>
          <div className="upl-fact">{st.dateFrom ? fmtRange({ from: st.dateFrom, to: st.dateTo! }) : '–'}</div>
          <div className="upl-sub">Posisi {st.posisi ? fmtDate(st.posisi) : '–'} (pengiriman terakhir)</div>
        </div>
        <div>
          <div className="card-title">Order sell in</div>
          <div className="upl-fact">{fmt(st.orders)}</div>
          <div className="upl-sub">{fmt(st.rowsUsed)} dari {fmt(st.rowsRead)} baris: Gudang + PM dari ITP-Palembang</div>
        </div>
        <div>
          <div className="card-title">Outstanding</div>
          <div className="upl-fact">{fmtTon(st.outstandingTon)} <span className="upl-of">ton</span></div>
          <div className="upl-sub">Sisa order belum dikirim & terkirim sebagian</div>
        </div>
        <div>
          <div className="card-title">Tidak dipakai</div>
          <div className="upl-fact">{fmt(skipped)}</div>
          <div className="upl-sub">
            {[st.skippedTokoProject && `${fmt(st.skippedTokoProject)} toko/project`, st.skippedMortar && `${fmt(st.skippedMortar)} mortar/thinbed`, st.skippedOther && `${fmt(st.skippedOther)} tipe lain`].filter(Boolean).join(' · ') || 'Semua baris memenuhi aturan'}
          </div>
        </div>
      </div>

      <div className="px-[22px] pb-5 grid gap-5 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-[960px]:grid-cols-1">
        <div className="flex flex-col gap-5">
          <div>
            <div className="card-title mb-2">Per status</div>
            <div className="border border-line rounded overflow-hidden">
              <table className="!min-w-0 tbl-dense">
                <thead><tr><th>Status</th><th className="num">Order</th><th className="num">Ton</th></tr></thead>
                <tbody>
                  {statuses.map(s => (
                    <tr key={s}>
                      <td>{s}{isOpen(s) && <span className="text-faint text-[11.5px]"> · sisa</span>}</td>
                      <td className="num font-mono">{fmt(st.byStatus[s].orders)}</td>
                      <td className="num font-mono">{fmtTon(st.byStatus[s].ton)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="card-title mb-2">Per bulan order</div>
            <div className="border border-line rounded overflow-hidden">
              <table className="!min-w-0 tbl-dense">
                <thead><tr><th>Bulan</th><th className="num">Order</th><th className="num">Outstanding (ton)</th></tr></thead>
                <tbody>
                  {months.map(([k, v]) => (
                    <tr key={k}><td>{MONTHS_ID[Number(k.slice(5))]} {k.slice(0, 4)}</td><td className="num font-mono">{fmt(v.orders)}</td><td className="num font-mono">{fmtTon(v.outstanding)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {st.looksDelivered && (
            <Note tone="bad">
              File ini sepertinya export <b>menurut tanggal pengiriman</b>: tidak ada order Verified, Not Verified, atau Reject.
              Untuk Outstanding DO, export ulang dengan filter Tanggal Order. File ini cocok untuk menu Upload / ganti Sell In BNN.
            </Note>
          )}
          <DateOrderNote info={st.dateOrder} onSwitch={onDateOrder} disabled={phase.kind === 'saving'} />
          <Note tone={existing ? 'warn' : 'info'}>
            {impact == null ? 'Memeriksa data yang sudah ada…'
              : existing
                ? <>Order dengan tanggal order {fmtRange({ from: st.dateFrom!, to: st.dateTo! })} (<b>{fmt(existing)} order</b>, posisi {impact.posisi ? fmtDate(String(impact.posisi).slice(0, 10)) : '–'}) akan <b>diganti</b> dengan status di file ini.</>
                : <>Belum ada order pada {fmtRange({ from: st.dateFrom!, to: st.dateTo! })}. Isi file akan ditambahkan.</>}
          </Note>
          <Note tone="info">Data Sell In BNN (pengiriman) tidak berubah. Halaman Outstanding DO memakai posisi file ini.</Note>
          <InvalidRows invalid={st.invalid} issues={st.issues} />
        </div>
      </div>
    </PreviewFrame>
  );
}
