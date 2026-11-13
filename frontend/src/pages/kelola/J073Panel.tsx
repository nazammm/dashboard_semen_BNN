/* ============================================================================
   Kelola Data · Sell Out BNN · Upload J073 (transaksi warehouse INSA & PKB).
   Disaring semen + white cement, retail saja. Data lama per distributor pada rentang
   tanggal file diganti. Pembagian ke baris Sell Out BNN mengikuti peta di database.
============================================================================ */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { DataSource } from '../../lib/data';
import { fmt, MONTHS_ID } from '../../lib/format';
import { dayCount, fmtRange } from '../../lib/dates';
import type { J073ParseResult } from '../../lib/j073Import';
import type { DateOrder } from '../../lib/sellin';
import type { Row } from '../../lib/types';
import {
  DateOrderNote, DoneCard, ErrorLine, InvalidRows, Note, PreviewFrame, SourcePicker, Steps, Unusable, fmtTon, type ImportPhase, useImport,
} from './shared';

const MAX_JSON = 11e6;   // batas aman di bawah 12 MB per permintaan

export function J073Upload({ onChanged }: { onChanged: () => void }) {
  const imp = useImport<J073ParseResult>('j073');
  const { phase } = imp;
  const [round, setRound] = useState(0);
  const [peta, setPeta] = useState<Row[] | null>(null);
  useEffect(() => { DataSource.selloutPeta().then(r => setPeta(r.filter(p => p.j073))).catch(() => setPeta(null)); }, []);

  const save = async () => {
    if (phase.kind !== 'preview') return;
    const { res, name } = phase;
    const body = { dataset: 'j073', rows: res.rows, file_name: phase.source === 'file' ? name : null };
    if (JSON.stringify(body).length > MAX_JSON) {
      imp.setError(`File terlalu besar untuk sekali simpan (${fmt(res.rows.length)} baris). Pecah per beberapa bulan lalu upload bergantian.`);
      return;
    }
    const ok = await imp.saveWith(() => adminApi<Row>('POST', 'admin/data/sellout', body));
    if (ok) { setRound(r => r + 1); onChanged(); }
  };

  return (
    <div>
      <Steps phase={phase.kind} />
      <ErrorLine error={imp.error} />
      <div hidden={phase.kind !== 'idle' && phase.kind !== 'reading'}>
        <SourcePicker key={round} id="j073" reading={phase.kind === 'reading' ? phase : null} onFile={imp.readFile} onText={imp.readText} onCancel={imp.cancelRead}
          fileHint="Export J073 INSA / PKB (.TXT langsung dari ERP, .xlsx, atau .csv). Yang dipakai hanya semen & white cement, cust group RETAIL. Data distributor yang ada di file, pada rentang tanggal di file, akan diganti."
          pastePlaceholder={'Distributor Code\tDistributor Name\tNo. DO\t…\tDO Date\t…\tWarehouse\t…\n4094\tPT. INTINIAGA SUKSES ABADI\t2517332\t…'} />
      </div>

      {(phase.kind === 'preview' || phase.kind === 'saving') && (
        phase.res.ok && phase.res.stats.rowsUsed === 0
          ? <Unusable error="Tidak ada baris semen / white cement retail di file ini." hint="" onCancel={imp.reset}>
              <p className="text-soft text-[13px]">
                {fmt(phase.res.stats.rowsRead)} baris dibaca: {fmt(phase.res.stats.skippedProduk)} bukan semen, {fmt(phase.res.stats.skippedRetail)} bukan retail
                {phase.res.stats.invalid > 0 && `, ${fmt(phase.res.stats.invalid)} tidak terbaca`}.
              </p>
            </Unusable>
          : phase.res.ok
          ? <J073Preview phase={phase} peta={peta} onSave={save} onCancel={imp.reset} onDateOrder={imp.rereadDates} />
          : <Unusable error={phase.res.error} missing={phase.res.missing} onCancel={imp.reset}
              hint="Baris pertama harus berisi judul kolom export J073 (Distributor Code, No. DO, DO Date, Customer Code, Product Code, Product Category, Order Qty, Net Amount, Warehouse, Cust Group, …)." />
      )}

      {phase.kind === 'done' && (
        <DoneCard actions={<><Link to="/sell-out-bnn" className="btn btn-primary no-underline">Lihat Sell Out BNN</Link><button type="button" className="btn" onClick={imp.reset}>Upload lagi</button></>}>
          {fmt(phase.result.rows_saved)} baris J073 ({fmtTon(Number(phase.result.ton))} ton) untuk {fmtRange({ from: String(phase.result.date_from).slice(0, 10), to: String(phase.result.date_to).slice(0, 10) })}.
          {Number(phase.result.rows_deleted) > 0 ? ` Menggantikan ${fmt(phase.result.rows_deleted)} baris lama.` : ' Belum ada data sebelumnya pada rentang itu.'}
        </DoneCard>
      )}
    </div>
  );
}

function J073Preview({ phase, peta, onSave, onCancel, onDateOrder }: {
  phase: Extract<ImportPhase<J073ParseResult>, { kind: 'preview' } | { kind: 'saving' }>;
  peta: Row[] | null; onSave: () => void; onCancel: () => void; onDateOrder: (o: DateOrder) => void;
}) {
  const st = phase.res.stats;
  const range = st.dateFrom ? fmtRange({ from: st.dateFrom, to: st.dateTo! }) : '–';
  const days = st.dateFrom && st.dateTo ? dayCount({ from: st.dateFrom, to: st.dateTo }) : 0;
  const dists = [...new Set(st.groups.map(g => g.dist))];
  const months = Object.entries(st.byMonth).sort(([a], [b]) => a.localeCompare(b));
  const distLabel = (d: string) => (st.distNames[d] ? `${d} · ${st.distNames[d]}` : d);

  return (
    <PreviewFrame phase={phase} title={phase.source === 'tempel' ? 'Data tempelan' : phase.name} onSave={onSave} onCancel={onCancel}
      canSave={st.rowsUsed > 0} readyText={`${fmt(st.rowsUsed)} baris semen retail siap disimpan.`}>
      <div className="upl-facts">
        <div>
          <div className="card-title">Periode di file</div>
          <div className="upl-fact">{range}</div>
          <div className="upl-sub">{days ? `${fmt(days)} hari, menurut DO Date` : 'Tidak ada tanggal'}</div>
        </div>
        <div>
          <div className="card-title">Baris dipakai</div>
          <div className="upl-fact">{fmt(st.rowsUsed)} <span className="upl-of">dari {fmt(st.rowsRead)}</span></div>
          <div className="upl-sub">Semen & white cement, retail</div>
        </div>
        <div>
          <div className="card-title">Tonase</div>
          <div className="upl-fact">{fmtTon(st.ton)} <span className="upl-of">ton</span></div>
          <div className="upl-sub">Order Qty × berat per zak</div>
        </div>
        <div>
          <div className="card-title">Tidak dipakai</div>
          <div className="upl-fact">{fmt(st.skippedProduk + st.skippedRetail)}</div>
          <div className="upl-sub">{fmt(st.skippedProduk)} bukan semen · {fmt(st.skippedRetail)} bukan retail</div>
        </div>
      </div>

      <div className="px-[22px] pb-5 grid gap-5 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] max-[960px]:grid-cols-1">
        <div className="flex flex-col gap-5">
          <div>
            <div className="card-title mb-2">Per distributor & gudang</div>
            <div className="border border-line rounded overflow-x-auto">
              <table className="!min-w-0 tbl-dense">
                <thead><tr><th>Distributor</th><th>Gudang</th><th className="num">Baris</th><th className="num">Ton</th></tr></thead>
                <tbody>
                  {st.groups.map(g => (
                    <tr key={g.dist + g.gudang}>
                      <td className="text-[12px]">{distLabel(g.dist)}</td>
                      <td className="font-mono text-[12px]">{g.gudang}</td>
                      <td className="num font-mono">{fmt(g.rows)}</td>
                      <td className="num font-mono">{fmtTon(g.ton)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="card-title mb-2">Per bulan</div>
            <div className="border border-line rounded overflow-hidden">
              <table className="!min-w-0 tbl-dense">
                <thead><tr><th>Bulan</th><th className="num">Baris</th><th className="num">Ton</th></tr></thead>
                <tbody>
                  {months.map(([k, v]) => (
                    <tr key={k}><td>{MONTHS_ID[Number(k.slice(5))]} {k.slice(0, 4)}</td><td className="num font-mono">{fmt(v.rows)}</td><td className="num font-mono">{fmtTon(v.ton)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <DateOrderNote info={st.dateOrder} onSwitch={onDateOrder} disabled={phase.kind === 'saving'} />
          <Note tone="warn">
            Data J073 {dists.map(distLabel).join(' dan ')} pada <b>{range}</b> akan <b>diganti</b> dengan isi file ini. Tanggal di luar rentang itu tidak berubah.
          </Note>
          {peta && peta.length > 0 && (
            <Note tone="info">
              <b>Dibagi ke baris Sell Out BNN</b> (aturan pertama yang cocok):
              <ul className="mt-1.5 text-[12.5px] list-none p-0 m-0 flex flex-col gap-0.5">
                {peta.map(p => <li key={String(p.id)}><b className="font-semibold">{String(p.nama)}</b> <span className="text-soft">· {String(p.sumber)}</span>{p.jenis === 'subdist' && <span className="text-faint"> (subdist)</span>}</li>)}
              </ul>
              <div className="text-[12px] text-soft mt-1.5">INSA-E dipisah dari nomor DO yang tercatat di transaksi J028 INSA-E, jadi pastikan transaksi J028 sudah terbaru.</div>
            </Note>
          )}
          <InvalidRows invalid={st.invalid} issues={st.issues} what="baris dilewati" />
        </div>
      </div>
    </PreviewFrame>
  );
}
