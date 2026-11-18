/* ============================================================================
   Kelola Data · Ongkos kirim · Upload laporan ORDB019 (Monthly Delivery Cost).
   Satu file = satu distributor x satu bulan kirim; boleh beberapa file sekaligus.
   Isi distributor x bulan yang ada di file diganti seluruhnya. INSA-E ikut INSA (4094).
============================================================================ */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { fmt, fmtIDR, fmtIDRCompact, MONTHS_ID } from '../../lib/format';
import type { OrdbParseResult } from '../../lib/ordbImport';
import type { Row } from '../../lib/types';
import { DoneCard, ErrorLine, InvalidRows, Note, PreviewFrame, SourcePicker, Steps, Unusable, fmtTon, type ImportPhase, useImport } from './shared';
import { cx } from '../../components/ui';

const MAX_JSON = 11e6;
/** dist_codes: array (PostgreSQL) atau teks JSON (SQL Server). */
const daftarDist = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  try { const x = JSON.parse(String(v ?? '[]')); return Array.isArray(x) ? x.map(String) : [String(x)]; } catch { return [String(v)]; }
};
const bulan = (p: string) => `${MONTHS_ID[Number(p.slice(5, 7))]} ${p.slice(0, 4)}`;

export function OngkosUpload({ onChanged }: { onChanged: () => void }) {
  const imp = useImport<OrdbParseResult>('ongkos');
  const { phase } = imp;
  const [round, setRound] = useState(0);

  const save = async () => {
    if (phase.kind !== 'preview') return;
    const { res, name } = phase;
    const body = { rows: res.rows, file_name: phase.source === 'file' ? name.slice(0, 200) : null };
    if (JSON.stringify(body).length > MAX_JSON) { imp.setError(`Terlalu besar untuk sekali simpan (${fmt(res.rows.length)} baris). Upload lebih sedikit file sekaligus.`); return; }
    const ok = await imp.saveWith(() => adminApi<Row>('POST', 'admin/data/ongkos', body));
    if (ok) { setRound(r => r + 1); onChanged(); }
  };

  return (
    <div>
      <Steps phase={phase.kind} />
      <ErrorLine error={imp.error} />
      <div hidden={phase.kind !== 'idle' && phase.kind !== 'reading'}>
        <SourcePicker key={round} id="ongkos" reading={phase.kind === 'reading' ? phase : null} onFile={imp.readFile} onFiles={f => imp.readFiles(f)} onText={imp.readText} onCancel={imp.cancelRead}
          accept=".xls,.xlsx"
          fileHint="Laporan ORDB019 dari ERP (.XLS, mis. R2670814-ORDB019-….XLS), satu file per distributor per bulan. Boleh pilih beberapa file sekaligus. Isi distributor dan bulan yang ada di file akan diganti. INSA-E memakai laporan INSA (4094)."
          pastePlaceholder={'MONTHLY DELIVERY COST (ORDB019)\nDISTRIBUTOR : PT. … - 4094\nPeriode : OCT2026\n\nNo\tDist\tDate\tNo Do\t\tNo Foad\t…'} />
      </div>

      {(phase.kind === 'preview' || phase.kind === 'saving') && (
        phase.res.ok && phase.res.rows.length === 0
          ? <Unusable error="Tidak ada baris semen / white cement di laporan ini." hint="" onCancel={imp.reset}>
              <p className="text-soft text-[13px]">{fmt(phase.res.stats.rowsRead)} baris dibaca, {fmt(phase.res.stats.skipped)} barang lain tanpa ongkos.</p>
            </Unusable>
          : phase.res.ok
          ? <OngkosPreview phase={phase} onSave={save} onCancel={imp.reset} />
          : <Unusable error={phase.res.error} missing={phase.res.missing} onCancel={imp.reset}
              hint="Pakai file ORDB019 dari ERP apa adanya: judul DISTRIBUTOR dan Periode di atas, lalu tabel dengan kolom No Do, No Foad, Tipe Truck, Category, Qty, Total." />
      )}

      {phase.kind === 'done' && (
        <DoneCard actions={<><Link to="/ongkos-kirim" className="btn btn-primary no-underline">Lihat Ongkos Kirim</Link><button type="button" className="btn" onClick={imp.reset}>Upload lagi</button></>}>
          {fmt(phase.result.rows_saved)} baris ORDB019 ({fmtTon(Number(phase.result.ton))} ton semen, ongkos {fmtIDR(phase.result.biaya)})
          {' '}untuk {daftarDist(phase.result.dist_codes).join(', ') || '–'} · {bulan(String(phase.result.periode_dari).slice(0, 10))}
          {String(phase.result.periode_sampai).slice(0, 10) !== String(phase.result.periode_dari).slice(0, 10) ? ` s.d. ${bulan(String(phase.result.periode_sampai).slice(0, 10))}` : ''}.
          {Number(phase.result.rows_deleted) > 0 ? ` Menggantikan ${fmt(phase.result.rows_deleted)} baris lama.` : ''}
        </DoneCard>
      )}
    </div>
  );
}

function OngkosPreview({ phase, onSave, onCancel }: {
  phase: Extract<ImportPhase<OrdbParseResult>, { kind: 'preview' } | { kind: 'saving' }>; onSave: () => void; onCancel: () => void;
}) {
  const st = phase.res.stats;
  const cov = st.ton ? st.tonBerbiaya / st.ton : 0;
  return (
    <PreviewFrame phase={phase} title={phase.source === 'tempel' ? 'Data tempelan' : phase.name} onSave={onSave} onCancel={onCancel}
      canSave={phase.res.rows.length > 0} readyText={`${fmt(st.files.length)} distributor x bulan siap disimpan.`}>
      <div className="upl-facts">
        <div>
          <div className="card-title">Perjalanan</div>
          <div className="upl-fact">{fmt(st.trips)}</div>
          <div className="upl-sub">{fmt(st.rowsUsed)} baris dipakai dari {fmt(st.rowsRead)}</div>
        </div>
        <div>
          <div className="card-title">Semen terkirim</div>
          <div className="upl-fact">{fmtTon(st.ton)} <span className="upl-of">ton</span></div>
          <div className="upl-sub">Semen & white cement</div>
        </div>
        <div>
          <div className="card-title">Ongkos tercatat</div>
          <div className="upl-fact">{fmtIDRCompact(st.biaya)}</div>
          <div className="upl-sub">{st.tonBerbiaya ? `${fmtIDR(st.biaya / st.tonBerbiaya)} per ton berbiaya` : 'Belum ada biaya'}</div>
        </div>
        <div>
          <div className="card-title">Sudah ada biaya</div>
          <div className={cx('upl-fact', cov < 0.8 && 'text-amber')}>{fmt(cov * 100, 0)}%</div>
          <div className="upl-sub">{fmtTon(st.tonBerbiaya)} dari {fmtTon(st.ton)} ton</div>
        </div>
      </div>

      <div className="px-[22px] pb-5 grid gap-5 grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] max-[960px]:grid-cols-1">
        <div className="flex flex-col gap-5">
          <div>
            <div className="card-title mb-2">Per distributor & bulan</div>
            <div className="border border-line rounded overflow-x-auto">
              <table className="!min-w-0 tbl-dense">
                <thead><tr><th>Distributor</th><th>Bulan</th><th className="num">Perjalanan</th><th className="num">Ton</th><th className="num">Sudah ada biaya</th><th className="num">Ongkos</th></tr></thead>
                <tbody>
                  {st.files.map(f => (
                    <tr key={f.dist + f.periode}>
                      <td className="text-[12px]">{f.dist} · {f.distName}</td>
                      <td className="whitespace-nowrap">{bulan(f.periode)}</td>
                      <td className="num font-mono">{fmt(f.trips)}</td>
                      <td className="num font-mono">{fmtTon(f.ton)}</td>
                      <td className="num font-mono">{f.ton ? fmt(f.tonBerbiaya / f.ton * 100, 0) + '%' : '–'}</td>
                      <td className="num font-mono">{fmtIDRCompact(f.biaya)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="card-title mb-2">Per tipe truk (perjalanan semen)</div>
            <div className="border border-line rounded overflow-x-auto">
              <table className="!min-w-0 tbl-dense">
                <thead><tr><th>Tipe truk</th><th className="num">Perjalanan</th><th className="num">Ton</th><th className="num">Ongkos</th></tr></thead>
                <tbody>
                  {st.trucks.map(t => (
                    <tr key={t.truk}><td className="text-[12px]">{t.truk}</td><td className="num font-mono">{fmt(t.trips)}</td><td className="num font-mono">{fmtTon(t.ton)}</td><td className="num font-mono">{fmtIDRCompact(t.biaya)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Note tone="warn">
            Isi ongkos kirim {st.files.map(f => `${f.dist} ${bulan(f.periode)}`).join(', ')} akan <b>diganti</b> dengan isi file ini. Bulan dan distributor lain tidak berubah.
          </Note>
          {cov < 0.97 && (
            <Note tone="info">
              Sebagian perjalanan belum ada biayanya (tagihan transporter biasanya masuk belakangan). Unggah ulang laporan bulan yang sama nanti untuk melengkapinya;
              halaman Ongkos Kirim hanya menghitung per ton dari DO yang biayanya sudah lengkap.
            </Note>
          )}
          <Note tone="info">Ongkos ditagih ke toko dan omzet diambil dari J073 distributor yang sama, jadi pastikan J073 bulan ini dan bulan sebelumnya sudah diunggah.</Note>
          <InvalidRows invalid={st.invalid} issues={st.issues} what="baris dilewati" />
        </div>
      </div>
    </PreviewFrame>
  );
}
