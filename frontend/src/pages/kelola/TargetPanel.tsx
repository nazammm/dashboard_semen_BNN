/* ============================================================================
   Kelola Data · Target per tahun (Sell In, Sell Out, Distributor, Salesman).
   Tempel / upload sheet target dengan format yang sama seperti selama ini. Tahun dibaca dari nama kolom
   (target_do_2027, do_2026, target_2027, ...); sheet tanpa tahun (Target Dist, salesman) memakai tahun pilihan.
   Yang diganti hanya (metrik, tahun, bulan) yang ada di sheet.
============================================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi } from '../../lib/api';
import { fmt, MONTHS_ID } from '../../lib/format';
import type { Row } from '../../lib/types';
import { exportRowsToExcel } from '../../lib/xlsx';
import {
  JENIS_LABEL, METRIK_LABEL, toSheet, withYear, type TargetJenis, type TargetMetrik, type TargetParseResult,
} from '../../lib/targetImport';
import { TableWrap } from '../../components/ui';
import {
  DoneCard, ErrorLine, InvalidRows, Note, PreviewFrame, SourcePicker, Steps, Unusable, errText, fmtWhen, type ImportPhase, useImport,
} from './shared';

const JENIS: TargetJenis[] = ['sell_out', 'sell_in', 'distributor', 'salesman'];
const bulanText = (b: number[]) => {
  if (!b.length) return '–';
  const contiguous = b.every((x, i) => i === 0 || x === b[i - 1] + 1);
  return contiguous ? (b.length === 1 ? MONTHS_ID[b[0]] : `${MONTHS_ID[b[0]]}–${MONTHS_ID[b[b.length - 1]]}`) : b.map(x => MONTHS_ID[x]).join(', ');
};
const nilaiText = (m: string, v: number) => (m.endsWith('_ta') ? `${fmt(v)} toko` : `${fmt(v)} ton`);

export function TargetPanel({ onChanged }: { onChanged: () => void }) {
  const [ringkas, setRingkas] = useState<Row[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const loadRingkas = useCallback(() => {
    adminApi<Row[]>('GET', 'admin/data/target-ringkas').then(r => { setRingkas(r); setLoadErr(null); }).catch(e => setLoadErr(errText(e)));
  }, []);
  useEffect(loadRingkas, [loadRingkas, round]);

  return (
    <div className="flex flex-col gap-6">
      <TargetSaved rows={ringkas} error={loadErr} />
      <TargetUpload onSaved={() => { setRound(r => r + 1); onChanged(); }} />
    </div>
  );
}

/* ---------- target yang sudah tersimpan + unduh untuk diedit ---------- */
function TargetSaved({ rows, error }: { rows: Row[] | null; error: string | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [dlErr, setDlErr] = useState<string | null>(null);
  const byJenis = useMemo(() => {
    const m = new Map<string, Row[]>();
    (rows || []).forEach(r => { const a = m.get(String(r.jenis)) || []; a.push(r); m.set(String(r.jenis), a); });
    return m;
  }, [rows]);
  const download = async (jenis: TargetJenis, tahun: number) => {
    const k = `${jenis}-${tahun}`;
    setBusy(k); setDlErr(null);
    try {
      const data = await adminApi<Row[]>('GET', `admin/data/target?jenis=${jenis}&tahun=${tahun}`);
      const sheet = toSheet(jenis, tahun, data as never);
      await exportRowsToExcel([{ name: `Target ${tahun}`, header: sheet.header, rows: sheet.rows as (string | number | null)[][] }],
        `Target_${JENIS_LABEL[jenis].split(' ')[0]}_${jenis === 'sell_in' || jenis === 'sell_out' ? jenis.replace('_', '') + '_' : ''}${tahun}.xlsx`, 'kelola-data');
    } catch (e) { setDlErr(errText(e)); } finally { setBusy(null); }
  };

  return (
    <section aria-labelledby="tgt-saved">
      <h2 id="tgt-saved" className="section-title !mt-0">Target tersimpan</h2>
      <ErrorLine error={error || dlErr} />
      {!rows && !error && <div className="card text-soft text-[13px]">Memuat…</div>}
      {rows && (
        <TableWrap>
          <table className="tbl-dense">
            <caption className="sr-only">Target dan realisasi pembanding yang sudah tersimpan per jenis dan tahun</caption>
            <thead><tr><th>Untuk</th><th>Tahun</th><th>Isi</th><th>Bulan</th><th className="num">Total</th><th>Diperbarui</th><th /></tr></thead>
            <tbody>
              {JENIS.map(j => {
                const list = byJenis.get(j) || [];
                if (!list.length) return (
                  <tr key={j}><td className="font-medium">{JENIS_LABEL[j]}</td><td colSpan={6} className="text-faint">Belum ada target</td></tr>
                );
                const years = [...new Set(list.map(r => Number(r.tahun)))].sort((a, b) => b - a);
                return years.map((y, yi) => {
                  const ofYear = list.filter(r => Number(r.tahun) === y);
                  return ofYear.map((r, i) => (
                    <tr key={`${j}-${y}-${r.metrik}`} className={i === 0 && yi > 0 ? 'border-t border-line' : undefined}>
                      <td className="font-medium">{yi === 0 && i === 0 ? JENIS_LABEL[j] : ''}</td>
                      <td className="tabular-nums">{i === 0 ? y : ''}</td>
                      <td>{METRIK_LABEL[r.metrik as TargetMetrik]}</td>
                      <td>{bulanText((r.bulan as number[]) || [])}</td>
                      <td className="num">{nilaiText(String(r.metrik), Number(r.total))}</td>
                      <td className="text-soft whitespace-nowrap">{i === 0 ? fmtWhen(r.diperbarui) : ''}</td>
                      <td className="text-right">
                        {i === 0 && (
                          <button type="button" className="btn btn-sm" disabled={busy === `${j}-${y}`} onClick={() => download(j, y)}>
                            {busy === `${j}-${y}` ? 'Menyiapkan…' : 'Unduh'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ));
                });
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      <p className="text-faint text-[12.5px] mt-2">
        Untuk tahun baru: unduh target tahun ini, ganti angka dan nama kolom tahunnya di Excel (mis. target_do_2026 jadi target_do_2027), lalu tempel di bawah.
      </p>
    </section>
  );
}

/* ---------- tempel / upload ---------- */
function TargetUpload({ onSaved }: { onSaved: () => void }) {
  const imp = useImport<TargetParseResult>('target');
  const { phase } = imp;
  const [tahun, setTahun] = useState(() => new Date().getFullYear());

  const save = async () => {
    if (phase.kind !== 'preview') return;
    const { res, name, source } = phase;
    const rows = withYear(res.rows, tahun);
    const ok = await imp.saveWith(() => adminApi<Row>('POST', 'admin/data/target', { jenis: res.stats.jenis, rows, file_name: source === 'file' ? name : null }));
    if (ok) onSaved();
  };

  return (
    <section aria-labelledby="tgt-upl">
      <h2 id="tgt-upl" className="section-title !mt-0">Tempel atau upload target</h2>
      <Steps phase={phase.kind} />
      <ErrorLine error={imp.error} />
      <div hidden={phase.kind !== 'idle' && phase.kind !== 'reading'}>
        <SourcePicker id="target" reading={phase.kind === 'reading' ? phase : null} onFile={imp.readFile} onText={imp.readText} onCancel={imp.cancelRead}
          fileHint="Sheet target Sell Out (cement_targets), Sell In (delivery), Target Dist, atau target salesman. Jenisnya dikenali dari judul kolom."
          pastePlaceholder={'Region\tDistributor\tMonth\tType Cement\ttarget_do_2027\tdo_2026\ttarget_ta_2027\nBabel\tBelitung\tJan\tRJW\t1200\t1168\t0'} />
      </div>

      {(phase.kind === 'preview' || phase.kind === 'saving') && (
        phase.res.ok
          ? <TargetPreview phase={phase} tahun={tahun} setTahun={setTahun} onSave={save} onCancel={imp.reset} />
          : <Unusable error={phase.res.error} missing={phase.res.missing} onCancel={imp.reset}
              hint="Baris pertama harus judul kolom. Sell Out: Region, Distributor, Month, Type Cement, target_do_YYYY. Sell In: Region, Sub Region, Month, Type Cement, target_YYYY. Distributor: dist_code, Month, Target, Target TA. Salesman: dist_code, salesman_code, salesman_name, Month, Target TA, Target Tonase, status." />
      )}

      {phase.kind === 'done' && (
        <DoneCard actions={<button type="button" className="btn" onClick={imp.reset}>Tempel target lain</button>}>
          {fmt(phase.result.rows_saved)} angka target tersimpan untuk tahun {((phase.result.tahun_list as number[]) || []).join(', ')}.
          {Number(phase.result.rows_deleted) > 0 ? ` Menggantikan ${fmt(phase.result.rows_deleted)} angka lama.` : ''}
        </DoneCard>
      )}
    </section>
  );
}

function TargetPreview({ phase, tahun, setTahun, onSave, onCancel }: {
  phase: Extract<ImportPhase<TargetParseResult>, { kind: 'preview' } | { kind: 'saving' }>;
  tahun: number; setTahun: (y: number) => void; onSave: () => void; onCancel: () => void;
}) {
  const st = phase.res.stats;
  const jenis = st.jenis!;
  const nowY = new Date().getFullYear();
  const years = [nowY - 1, nowY, nowY + 1];
  const groups = st.groups.map(g => ({ ...g, tahun: g.tahun ?? tahun }));
  return (
    <PreviewFrame phase={phase} title={phase.source === 'tempel' ? 'Data tempelan' : phase.name} onSave={onSave} onCancel={onCancel}
      canSave={phase.res.rows.length > 0} readyText={`${fmt(phase.res.rows.length)} angka siap disimpan.`}>
      <div className="px-[22px] py-5 grid gap-5 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] max-[960px]:grid-cols-1">
        <div>
          <div className="text-[13px] text-soft">Dikenali sebagai target <b className="text-ink">{JENIS_LABEL[jenis]}</b> · {fmt(st.kunci)} baris {jenis === 'salesman' ? 'salesman' : jenis === 'distributor' ? 'distributor' : 'region / distributor / tipe'}</div>
          {st.needsYear && (
            <div className="mt-3 flex items-center gap-2.5 flex-wrap">
              <label htmlFor="tgt-year" className="text-[13px] font-medium">Tahun target</label>
              <select id="tgt-year" value={tahun} onChange={e => setTahun(+e.target.value)} disabled={phase.kind === 'saving'}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <span className="text-faint text-[12.5px]">Sheet ini tidak menyebut tahun di nama kolom.</span>
            </div>
          )}
          <div className="border border-line rounded overflow-x-auto mt-3">
            <table className="!min-w-0 tbl-dense">
              <thead><tr><th>Isi</th><th>Tahun</th><th>Bulan</th><th className="num">Total</th></tr></thead>
              <tbody>
                {groups.map(g => (
                  <tr key={`${g.metrik}-${g.tahun}`}>
                    <td>{METRIK_LABEL[g.metrik]}</td><td className="tabular-nums">{g.tahun}</td><td>{bulanText(g.bulan)}</td>
                    <td className="num">{nilaiText(g.metrik, g.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Note tone="warn">
            Yang diganti hanya bulan di atas, per isi dan tahun. Target bulan atau tahun lain tidak berubah.
          </Note>
          {st.ignored.length > 0 && <Note tone="info">Kolom tidak dipakai: {st.ignored.join(', ')}.</Note>}
          <InvalidRows invalid={st.invalid} issues={st.issues} what="baris dilewati" />
        </div>
      </div>
    </PreviewFrame>
  );
}
