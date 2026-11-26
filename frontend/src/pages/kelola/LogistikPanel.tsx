/* ============================================================================
   Kelola Data · Ongkos kirim · Upload rekap logistik distributor (format sama di semua distributor).
   Sumber kedua halaman Ongkos Kirim: biaya FOAD yang di ORDB019 masih 0 / belum diunduh, jalur (gudang / pelabuhan → toko),
   dan waktu kirim. Per distributor, data di rentang tanggal file diganti.
============================================================================ */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { fmt, fmtIDR, fmtIDRCompact, MONTHS_ID } from '../../lib/format';
import { JALUR_LABEL, type LogistikParseResult } from '../../lib/logistikImport';
import type { Row } from '../../lib/types';
import { DoneCard, ErrorLine, InvalidRows, Note, PreviewFrame, SourcePicker, Steps, Unusable, fmtTon, type ImportPhase, useImport } from './shared';

const MAX_JSON = 22e6;
const daftarDist = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  try { const x = JSON.parse(String(v ?? '[]')); return Array.isArray(x) ? x.map(String) : [String(x)]; } catch { return [String(v)]; }
};
const bulan = (p: string) => `${MONTHS_ID[Number(p.slice(5, 7))]} ${p.slice(0, 4)}`;
const tgl = (p: unknown) => { const s = String(p ?? '').slice(0, 10); return s ? `${Number(s.slice(8, 10))} ${MONTHS_ID[Number(s.slice(5, 7))]} ${s.slice(0, 4)}` : '–'; };

export function LogistikUpload({ onChanged }: { onChanged: () => void }) {
  const imp = useImport<LogistikParseResult>('logistik');
  const { phase } = imp;
  const [round, setRound] = useState(0);

  const save = async () => {
    if (phase.kind !== 'preview') return;
    const { res, name } = phase;
    const body = { rows: res.rows, file_name: phase.source === 'file' ? name.slice(0, 200) : null };
    if (JSON.stringify(body).length > MAX_JSON) { imp.setError(`Terlalu besar untuk sekali simpan (${fmt(res.rows.length)} baris). Upload satu distributor per kali, atau pecah per beberapa bulan.`); return; }
    const ok = await imp.saveWith(() => adminApi<Row>('POST', 'admin/data/logistik', body));
    if (ok) { setRound(r => r + 1); onChanged(); }
  };

  return (
    <div>
      <Steps phase={phase.kind} />
      <ErrorLine error={imp.error} />
      <div hidden={phase.kind !== 'idle' && phase.kind !== 'reading'}>
        <SourcePicker key={round} id="logistik" reading={phase.kind === 'reading' ? phase : null} onFile={imp.readFile} onFiles={f => imp.readFiles(f)} onText={imp.readText} onCancel={imp.cancelRead}
          accept=".xlsx,.xls"
          fileHint="Rekap pengiriman dari tim logistik distributor (.xlsx, sheet pertama), kolom Daerah, FOAD No., SOMType, DO No., SJ Date, Product Code, Jumlah, Jml Harga, … Boleh beberapa file sekaligus (satu per distributor). Per distributor, data di rentang tanggal file akan diganti."
          pastePlaceholder={'Daerah\tTANGGAL ORDER\tFOAD No.\tOrder Date\tSOMType\t…\tJml Harga\t…'} />
      </div>

      {(phase.kind === 'preview' || phase.kind === 'saving') && (
        phase.res.ok && phase.res.rows.length === 0
          ? <Unusable error="Tidak ada baris pengiriman yang bisa dipakai di file ini." hint="" onCancel={imp.reset}>
              <p className="text-soft text-[13px]">{fmt(phase.res.stats.rowsRead)} baris dibaca, {fmt(phase.res.stats.invalid)} dilewati.</p>
            </Unusable>
          : phase.res.ok
          ? <LogistikPreview phase={phase} onSave={save} onCancel={imp.reset} />
          : <Unusable error={phase.res.error} missing={phase.res.missing} onCancel={imp.reset}
              hint="Pakai rekap logistik apa adanya: baris pertama judul kolom (Daerah, FOAD No., SOMType, SJ Date, Product Code, Jumlah, Jml Harga, …)." />
      )}

      {phase.kind === 'done' && (
        <DoneCard actions={<><Link to="/ongkos-kirim" className="btn btn-primary no-underline">Lihat Ongkos Kirim</Link><button type="button" className="btn" onClick={imp.reset}>Upload lagi</button></>}>
          {fmt(phase.result.rows_saved)} baris rekap logistik ({fmt(phase.result.foad)} FOAD, {fmtTon(Number(phase.result.ton))} ton semen)
          {' '}untuk {daftarDist(phase.result.dist_codes).join(', ') || '–'} · {tgl(phase.result.date_from)} s.d. {tgl(phase.result.date_to)}.
          {Number(phase.result.foad_tanpa_ordb) > 0 ? ` ${fmt(phase.result.foad_tanpa_ordb)} FOAD belum ada di ORDB019, sekarang ikut dihitung dari rekap.` : ''}
          {Number(phase.result.foad_isi_biaya) > 0 ? ` ${fmt(phase.result.foad_isi_biaya)} FOAD yang di ORDB019 tanpa biaya sekarang memakai biaya rekap.` : ''}
          {Number(phase.result.rows_deleted) > 0 ? ` Menggantikan ${fmt(phase.result.rows_deleted)} baris lama.` : ''}
        </DoneCard>
      )}
    </div>
  );
}

function LogistikPreview({ phase, onSave, onCancel }: {
  phase: Extract<ImportPhase<LogistikParseResult>, { kind: 'preview' } | { kind: 'saving' }>; onSave: () => void; onCancel: () => void;
}) {
  const st = phase.res.stats;
  return (
    <PreviewFrame phase={phase} title={phase.source === 'tempel' ? 'Data tempelan' : phase.name} onSave={onSave} onCancel={onCancel}
      canSave={phase.res.rows.length > 0} readyText={`${fmt(st.foad)} FOAD (${st.daerah.join(', ')}) siap disimpan.`}>
      <div className="upl-facts">
        <div>
          <div className="card-title">Perjalanan (FOAD)</div>
          <div className="upl-fact">{fmt(st.foad)}</div>
          <div className="upl-sub">{fmt(st.rowsUsed)} baris dari {fmt(st.rowsRead)}</div>
        </div>
        <div>
          <div className="card-title">Semen terkirim</div>
          <div className="upl-fact">{fmtTon(st.ton)} <span className="upl-of">ton</span></div>
          <div className="upl-sub">Perkiraan (kode semen yang dikenal)</div>
        </div>
        <div>
          <div className="card-title">Biaya di rekap</div>
          <div className="upl-fact">{fmtIDRCompact(st.biaya)}</div>
          <div className="upl-sub">{fmt(st.foadBiaya)} FOAD ada biayanya</div>
        </div>
        <div>
          <div className="card-title">Lewat estimasi kirim</div>
          <div className="upl-fact">{st.telat.tonEst ? fmt(st.telat.ton / st.telat.tonEst * 100, 1) + '%' : '–'}</div>
          <div className="upl-sub">{fmtTon(st.telat.ton)} ton dikirim setelah Est. Delv. Date</div>
        </div>
      </div>

      <div className="px-[22px] pb-5 grid gap-5 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] max-[960px]:grid-cols-1">
        <div className="flex flex-col gap-5">
          <div>
            <div className="card-title mb-2">Per jalur</div>
            <div className="border border-line rounded overflow-x-auto">
              <table className="!min-w-0 tbl-dense">
                <thead><tr><th>Jalur</th><th className="num">FOAD</th><th className="num">Ton semen</th><th className="num">Biaya</th><th className="num" title="Biaya FOAD yang membawa semen dibagi ton semen">Per ton semen</th></tr></thead>
                <tbody>
                  {st.jalur.map(j => (
                    <tr key={j.jalur}>
                      <td className="text-[12px]">{JALUR_LABEL[j.jalur] || j.jalur}</td>
                      <td className="num font-mono">{fmt(j.foad)}</td>
                      <td className="num font-mono">{fmtTon(j.ton)}</td>
                      <td className="num font-mono">{fmtIDRCompact(j.biaya)}</td>
                      <td className="num font-mono">{j.ton > 0 ? fmtIDR(j.biayaSemen / j.ton) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="card-title mb-2">Per bulan muat</div>
            <div className="border border-line rounded overflow-x-auto">
              <table className="!min-w-0 tbl-dense">
                <thead><tr><th>Bulan</th><th className="num">FOAD</th><th className="num">Ton semen</th><th className="num">Biaya</th></tr></thead>
                <tbody>
                  {st.bulan.map(b => (
                    <tr key={b.bulan}><td className="whitespace-nowrap">{bulan(b.bulan)}</td><td className="num font-mono">{fmt(b.foad)}</td><td className="num font-mono">{fmtTon(b.ton)}</td><td className="num font-mono">{fmtIDRCompact(b.biaya)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Note tone="warn">
            Rekap logistik {st.daerah.join(', ')} tanggal {tgl(st.dari)} s.d. {tgl(st.sampai)} akan <b>diganti</b> dengan isi file ini. Distributor dan tanggal lain tidak berubah.
          </Note>
          <Note tone="info">
            Di halaman Ongkos Kirim, biaya ORDB019 tetap dipakai kalau ada. Rekap ini mengisi FOAD yang di ORDB019 biayanya 0 atau bulannya belum diunduh,
            dan menambah filter jalur (gudang / pelabuhan → toko) serta waktu kirim. Kode Daerah dicocokkan ke kode ERP di master distributor.
          </Note>
          <InvalidRows invalid={st.invalid} issues={st.issues} what="baris dilewati" />
        </div>
      </div>
    </PreviewFrame>
  );
}
