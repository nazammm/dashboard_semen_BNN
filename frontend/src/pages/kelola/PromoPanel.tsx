/* ============================================================================
   Kelola Data · Ongkos kirim · Upload J078 (DO PROMO DETAIL): potongan langsung dan cash back voucher per DO,
   untuk halaman Efektivitas Ongkos & Promo. Per distributor, data di rentang tanggal DO file diganti.
============================================================================ */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { fmt, fmtIDRCompact, MONTHS_ID } from '../../lib/format';
import { JENIS_PROMO, type PromoParseResult } from '../../lib/promoImport';
import type { Row } from '../../lib/types';
import { DoneCard, ErrorLine, InvalidRows, Note, PreviewFrame, SourcePicker, Steps, Unusable, type ImportPhase, useImport } from './shared';

const MAX_JSON = 22e6;
const daftar = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  try { const x = JSON.parse(String(v ?? '[]')); return Array.isArray(x) ? x.map(String) : [String(x)]; } catch { return [String(v)]; }
};
const tgl = (p: unknown) => { const s = String(p ?? '').slice(0, 10); return s ? `${Number(s.slice(8, 10))} ${MONTHS_ID[Number(s.slice(5, 7))]} ${s.slice(0, 4)}` : '–'; };

export function PromoUpload({ onChanged }: { onChanged: () => void }) {
  const imp = useImport<PromoParseResult>('promo');
  const { phase } = imp;
  const [round, setRound] = useState(0);
  const save = async () => {
    if (phase.kind !== 'preview') return;
    const { res, name } = phase;
    const body = { rows: res.rows, file_name: phase.source === 'file' ? name.slice(0, 200) : null };
    if (JSON.stringify(body).length > MAX_JSON) { imp.setError(`Terlalu besar untuk sekali simpan (${fmt(res.rows.length)} baris). Upload per bulan.`); return; }
    const ok = await imp.saveWith(() => adminApi<Row>('POST', 'admin/data/promo', body));
    if (ok) { setRound(r => r + 1); onChanged(); }
  };
  return (
    <div>
      <Steps phase={phase.kind} />
      <ErrorLine error={imp.error} />
      <div hidden={phase.kind !== 'idle' && phase.kind !== 'reading'}>
        <SourcePicker key={round} id="promo" reading={phase.kind === 'reading' ? phase : null} onFile={imp.readFile} onFiles={f => imp.readFiles(f)} onText={imp.readText} onCancel={imp.cancelRead}
          accept=".txt"
          fileHint="File job ERP J078 DO PROMO DETAIL (.TXT dipisah |), biasanya ditarik Nazam Auto Task per distributor per bulan. Boleh beberapa file sekaligus. Per distributor, data di rentang tanggal DO file diganti."
          pastePlaceholder={'Distributor|DO No.|Customer|Retail/Proyek|DO Date|Product|…|Promo Type|Keterangan Promo|…'} />
      </div>
      {(phase.kind === 'preview' || phase.kind === 'saving') && (
        phase.res.ok && phase.res.rows.length === 0
          ? <Unusable error="Tidak ada baris J078 yang bisa dipakai." hint="" onCancel={imp.reset}><p className="text-soft text-[13px]">{fmt(phase.res.stats.rowsRead)} baris dibaca.</p></Unusable>
          : phase.res.ok
          ? <PromoPreview phase={phase} onSave={save} onCancel={imp.reset} />
          : <Unusable error={phase.res.error} missing={phase.res.missing} onCancel={imp.reset} hint="Pakai file J078 apa adanya (baris pertama judul kolom)." />
      )}
      {phase.kind === 'done' && (
        <DoneCard actions={<><Link to="/efektivitas" className="btn btn-primary no-underline">Lihat Efektivitas</Link><button type="button" className="btn" onClick={imp.reset}>Upload lagi</button></>}>
          {fmt(phase.result.rows_saved)} baris J078 ({fmt(phase.result.jumlah_do)} DO, biaya promo {fmtIDRCompact(Number(phase.result.biaya || 0))}) untuk {daftar(phase.result.dist_codes).join(', ') || '–'}
          {' '}· {tgl(phase.result.date_from)} s.d. {tgl(phase.result.date_to)}.{Number(phase.result.rows_deleted) > 0 ? ` Menggantikan ${fmt(phase.result.rows_deleted)} baris lama.` : ''}
        </DoneCard>
      )}
    </div>
  );
}

function PromoPreview({ phase, onSave, onCancel }: {
  phase: Extract<ImportPhase<PromoParseResult>, { kind: 'preview' } | { kind: 'saving' }>; onSave: () => void; onCancel: () => void;
}) {
  const st = phase.res.stats;
  const biaya = st.jenis.filter(j => j.jenis === 'potongan' || j.jenis === 'voucher').reduce((a, j) => a + j.nilai, 0);
  return (
    <PreviewFrame phase={phase} title={phase.source === 'tempel' ? 'Data tempelan' : phase.name} onSave={onSave} onCancel={onCancel}
      canSave={phase.res.rows.length > 0} readyText={`${fmt(st.jumlahDo)} DO (${st.dist.join(', ')}) siap disimpan.`}>
      <div className="upl-facts">
        <div><div className="card-title">DO</div><div className="upl-fact">{fmt(st.jumlahDo)}</div><div className="upl-sub">{fmt(st.rowsUsed)} baris dari {fmt(st.rowsRead)}</div></div>
        <div><div className="card-title">Nilai DO (kotor)</div><div className="upl-fact">{fmtIDRCompact(st.nilaiProduk)}</div><div className="upl-sub">{tgl(st.dari)} s.d. {tgl(st.sampai)}</div></div>
        <div><div className="card-title">Biaya promo</div><div className="upl-fact">{fmtIDRCompact(biaya)}</div><div className="upl-sub">{st.nilaiProduk ? fmt(biaya / st.nilaiProduk * 100, 1) + '% dari nilai DO' : ''}</div></div>
        <div><div className="card-title">Jenis promo</div><div className="upl-fact">{fmt(st.promo.length)}</div><div className="upl-sub">nama potongan / voucher berbeda</div></div>
      </div>
      <div className="px-[22px] pb-5 grid gap-5 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] max-[960px]:grid-cols-1">
        <div>
          <div className="card-title mb-2">Promo terbesar</div>
          <div className="border border-line rounded overflow-x-auto">
            <table className="!min-w-0 tbl-dense">
              <thead><tr><th>Promo</th><th>Jenis</th><th className="num">DO</th><th className="num">Biaya</th></tr></thead>
              <tbody>{st.promo.slice(0, 12).map(p => (
                <tr key={p.jenis + p.promo}><td className="text-[12px]">{p.promo}</td><td className="text-[12px]">{JENIS_PROMO[p.jenis]}</td><td className="num font-mono">{fmt(p.doN)}</td><td className="num font-mono">{fmtIDRCompact(p.nilai)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Note tone="warn">J078 {st.dist.join(', ')} tanggal DO {tgl(st.dari)} s.d. {tgl(st.sampai)} akan <b>diganti</b> dengan isi file ini.</Note>
          <Note tone="info">
            {st.jenis.map(j => `${JENIS_PROMO[j.jenis] || j.jenis}: ${fmt(j.baris)} baris${j.jenis !== 'produk' ? ` (${fmtIDRCompact(j.nilai)})` : ''}`).join(' · ')}.
            {' '}Pemakaian voucher (VOxxxx) bukan biaya baru: vouchernya sudah dihitung saat diberikan. Ton semen dihitung saat disimpan.
          </Note>
          <InvalidRows invalid={st.invalid} issues={st.issues} what="baris dilewati" />
        </div>
      </div>
    </PreviewFrame>
  );
}
