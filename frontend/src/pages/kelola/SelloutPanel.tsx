/* ============================================================================
   Kelola Data · Sell Out BNN: tempel DO FAS (rekap DO Korin) atau Sub ERP dari Excel.
   Setiap simpan mengganti seluruh data satu tahun. Hanya baris yang ada di peta
   Sell Out BNN yang dihitung; sisanya tetap disimpan tetapi ditandai "tidak dipakai".
============================================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { DataSource } from '../../lib/data';
import { MONTHS_ID, fmt } from '../../lib/format';
import type { Row } from '../../lib/types';
import {
  dofasPayload, erpPayload, mapDofas, mapErp, parseDofas, parseErp,
  type DofasRow, type ErpRow, type PasteResult, type PetaRow,
} from '../../lib/selloutPaste';
import { todayWIB } from '../../components/DataStatus';
import { ErrorBox, cx } from '../../components/ui';
import { DoneCard, InvalidRows, Note, afterDataChanged, errText, fmtTon } from './shared';

type Dataset = 'dofas' | 'erp';
const LABEL: Record<Dataset, string> = { dofas: 'DO FAS', erp: 'Sub ERP' };
const SUMBER: Record<Dataset, string> = { dofas: 'DO FAS', erp: 'Sub ERP' };
const PLACEHOLDER: Record<Dataset, string> = {
  dofas: '\tArea\tDistributor\tKeterangan\t1\t2\t…\t12\nSTR\tBANGKA\tGMD\tKapal\t32\t-\t…\t-',
  erp: 'JANUARI\nS006 - PT. WANDI JAYA MAKMUR\tPCC\t3,369.70\nS006 - PT. WANDI JAYA MAKMUR\tPCC – RJW\t1,919.50\n…\nFEBRUARI\n…',
};
const HINT: Record<Dataset, string> = {
  dofas: 'Salin tabel DO FAS dari Excel termasuk baris judul (kolom tipe STR/RJW, Distributor, Keterangan, 1 s.d. 12). Kolom Area tidak dipakai: region mengikuti peta Sell Out BNN. Angka dalam ton; "-" dibaca 0.',
  erp: 'Salin Sub ERP per tipe dari Excel: blok per bulan (judul JANUARI, FEBRUARI, …), lalu baris "S006 - Nama" | PCC / PCC – RJW | ton. Boleh hanya bulan tertentu: bulan yang tidak ditempel tidak diubah. Format total (Distributor | Jan … Dec | Total) juga masih bisa.',
};

type Phase =
  | { kind: 'idle' }
  | { kind: 'preview'; res: PasteResult<DofasRow> | PasteResult<ErpRow> }
  | { kind: 'saving'; res: PasteResult<DofasRow> | PasteResult<ErpRow> }
  | { kind: 'done'; result: Row };

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export function SelloutPaste({ dataset, onChanged }: { dataset: Dataset; onChanged: () => void }) {
  const thisYear = Number(todayWIB().slice(0, 4));
  const [tahun, setTahun] = useState(thisYear);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [peta, setPeta] = useState<PetaRow[] | null>(null);
  const [current, setCurrent] = useState<Row[] | null>(null);

  useEffect(() => {
    DataSource.selloutPeta().then(r => setPeta(r as unknown as PetaRow[])).catch(e => setError(errText(e)));
  }, []);
  // data yang sekarang tersimpan (untuk kolom "Sebelumnya"), dimuat ulang setelah simpan
  useEffect(() => {
    if (phase.kind !== 'idle' && phase.kind !== 'preview') return;
    DataSource.selloutMonthly().then(setCurrent).catch(() => setCurrent([]));
  }, [phase.kind]);

  const lines = useMemo(() => (text ? text.split('\n').filter(l => l.trim()).length : 0), [text]);

  const check = () => {
    setError(null);
    const res = dataset === 'dofas' ? parseDofas(text) : parseErp(text);
    if (!res.ok) { setError(res.error || 'Data tidak bisa dibaca.'); return; }
    setPhase({ kind: 'preview', res });
  };

  const save = async () => {
    if (phase.kind !== 'preview') return;
    const res = phase.res;
    setError(null);
    setPhase({ kind: 'saving', res });
    try {
      const rows = dataset === 'dofas' ? dofasPayload(res.rows as DofasRow[]) : erpPayload(res.rows as ErpRow[], res.months);
      const result = await adminApi<Row>('POST', 'admin/data/sellout', { dataset, tahun, rows });
      afterDataChanged(); onChanged();
      setText('');
      setPhase({ kind: 'done', result });
    } catch (e) {
      setError('Gagal menyimpan: ' + errText(e) + ' Data lama tidak berubah.');
      setPhase({ kind: 'preview', res });
    }
  };

  if (phase.kind === 'done') {
    return (
      <DoneCard title={`${LABEL[dataset]} ${tahun} tersimpan`}
        actions={<><Link to="/sell-out-bnn" className="btn btn-primary no-underline">Lihat Sell Out BNN</Link><button type="button" className="btn" onClick={() => setPhase({ kind: 'idle' })}>Tempel lagi</button></>}>
        {fmt(phase.result.rows_saved)} baris ({fmtTon(Number(phase.result.ton))} ton) menggantikan {fmt(phase.result.rows_deleted)} baris {LABEL[dataset]} {tahun} sebelumnya.
      </DoneCard>
    );
  }

  return (
    <div>
      {error && <div className="mb-4"><ErrorBox error={error} /></div>}
      {phase.kind === 'idle' ? (
        <section className="card">
          <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
            <div className="control">
              <label htmlFor={`so-${dataset}-th`}>Tahun data</label>
              <select id={`so-${dataset}-th`} value={tahun} onChange={e => setTahun(+e.target.value)}>
                {[thisYear, thisYear - 1].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <span className="text-faint text-[12px] max-w-[520px]">{dataset === 'erp'
              ? `Simpan mengganti bulan yang ada di tempelan saja; bulan lain tahun ${tahun} tetap.`
              : `Simpan akan mengganti seluruh ${LABEL[dataset]} tahun ${tahun}.`}</span>
          </div>
          <label htmlFor={`so-${dataset}-paste`} className="block text-[13px] text-soft mb-2">{HINT[dataset]}</label>
          <textarea id={`so-${dataset}-paste`} className="upl-paste" value={text} onChange={e => setText(e.target.value)} spellCheck={false} placeholder={PLACEHOLDER[dataset]} />
          <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
            <span className="font-mono text-[11.5px] text-faint">{lines ? `${fmt(Math.max(lines - 1, 0))} baris data` : 'Belum ada data'}</span>
            <div className="flex gap-2">
              {text && <button type="button" className="btn btn-sm" onClick={() => setText('')}>Kosongkan</button>}
              <button type="button" className="btn btn-sm btn-primary" disabled={lines < 2 || !peta} onClick={check}>Periksa data</button>
            </div>
          </div>
        </section>
      ) : (
        <Preview dataset={dataset} tahun={tahun} res={phase.res} peta={peta || []} current={current} saving={phase.kind === 'saving'}
          onSave={save} onCancel={() => setPhase({ kind: 'idle' })} />
      )}
    </div>
  );
}

function Preview({ dataset, tahun, res, peta, current, saving, onSave, onCancel }: {
  dataset: Dataset; tahun: number; res: PasteResult<DofasRow> | PasteResult<ErpRow>; peta: PetaRow[]; current: Row[] | null;
  saving: boolean; onSave: () => void; onCancel: () => void;
}) {
  const map0 = dataset === 'dofas' ? mapDofas(res.rows as DofasRow[], peta) : mapErp(res.rows as ErpRow[], peta);
  const ignored = map0.ignored;
  // format per bulan: bulan yang tidak ditempel tetap memakai data tersimpan
  const pasted = res.months;
  const keep = (k: number) => !!pasted && !pasted.includes(k + 1);
  const allTon = (res.rows as { ton: number[] }[]).reduce((a, r) => a + sum(r.ton), 0);
  // yang sekarang tersimpan per baris peta x bulan (index 0 = Jan)
  const prev = useMemo(() => {
    const m = new Map<number, number[]>();
    (current || []).filter(r => r.sumber === SUMBER[dataset] && Number(r.tahun) === tahun).forEach(r => {
      const a = m.get(Number(r.peta_id)) || new Array(12).fill(0);
      a[Number(r.bulan) - 1] += Number(r.ton || 0); m.set(Number(r.peta_id), a);
    });
    return m;
  }, [current, dataset, tahun]);
  const mapped = map0.mapped.map(m => ({ ...m, ton: m.ton.map((t, k) => (keep(k) ? prev.get(m.peta.id)?.[k] || 0 : t)) }));
  const usedTon = mapped.reduce((a, m) => a + sum(m.ton), 0);
  const keptMonths = pasted ? Array.from({ length: 12 }, (_, k) => k).filter(k => keep(k) && mapped.some(m => m.ton[k])) : [];
  // bulan yang sudah lewat tetapi turun dibanding yang tersimpan (mis. jadi 0): biasanya salah salin
  const today = todayWIB();
  const closedUpTo = tahun < Number(today.slice(0, 4)) ? 12 : Number(today.slice(5, 7)) - 1;
  const hilang = mapped.flatMap(m => (prev.get(m.peta.id) || []).map((before, k) => ({ m, k, before, after: m.ton[k] })))
    .filter(x => !keep(x.k)).filter(x => (x.k < closedUpTo && x.before - x.after >= 1) || (x.before >= 1 && Math.abs(x.after) < 0.5));
  const missing = mapped.filter(m => m.rows === 0);
  const lastMonth = Math.max(0, ...mapped.flatMap(m => m.ton.map((t, i) => (t ? i + 1 : 0))));
  const lastShown = Math.max(lastMonth, ...hilang.map(x => x.k + 1));
  const months = Array.from({ length: Math.max(lastShown, 1) }, (_, i) => i + 1);
  const hasType = dataset === 'erp' && (res.rows as ErpRow[]).some(r => r.tipe);

  return (
    <section className="card !p-0" aria-label={`Pratinjau ${LABEL[dataset]}`}>
      <div className="px-[22px] pt-5 pb-4 border-b border-line flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="card-title">Pratinjau</div>
          <div className="font-sans text-[17px] font-semibold text-ink mt-0.5">{LABEL[dataset]} {tahun}</div>
        </div>
        {!saving && <button type="button" className="btn btn-sm" onClick={onCancel}>Ubah tempelan</button>}
      </div>

      <div className="upl-facts">
        <div><div className="card-title">Baris terbaca</div><div className="upl-fact">{fmt(res.rows.length)}</div>
          <div className="upl-sub">{res.issues.length ? `${fmt(res.issues.length)} baris dilewati` : 'Semua baris terbaca'}</div></div>
        <div><div className="card-title">Dipakai</div><div className="upl-fact">{fmt(mapped.length - missing.length)} <span className="upl-of">dari {fmt(mapped.length)} baris peta</span></div>
          <div className="upl-sub">{fmtTon(usedTon)} ton setahun</div></div>
        <div><div className="card-title">Tidak dipakai</div><div className="upl-fact">{fmt(ignored.length)}</div>
          <div className="upl-sub">{fmtTon(allTon - usedTon)} ton, tetap disimpan</div></div>
        <div><div className="card-title">Bulan terakhir berisi</div><div className="upl-fact">{lastMonth ? MONTHS_ID[lastMonth] : '–'}</div>
          <div className="upl-sub">{hasType ? 'Ada kolom tipe' : dataset === 'erp' ? 'Total tanpa tipe' : 'Per STR / RJW'}</div></div>
      </div>

      <div className="px-[22px] pb-5 flex flex-col gap-3">
        <div className="card-title">Dipakai di Sell Out BNN (ton)</div>
        <div className="border border-line rounded overflow-x-auto">
          <table className="!min-w-0 tbl-dense">
            <thead><tr>
              <th>Region</th><th>Baris</th>{months.map(m => <th key={m} className="num">{MONTHS_ID[m]}</th>)}
              <th className="num">Total</th><th className="num" title="Total yang sekarang tersimpan">Sebelumnya</th>
            </tr></thead>
            <tbody>
              {mapped.map(m => {
                const stored = prev.get(m.peta.id), before = stored ? sum(stored) : undefined;
                const tot = sum(m.ton), diff = before == null ? null : tot - before;
                return (
                  <tr key={m.peta.id} className={cx(m.rows === 0 && 'text-faint')}>
                    <td className="whitespace-nowrap">{m.peta.region}</td>
                    <td className="whitespace-nowrap font-semibold" title={(m.peta.dofas_kode || [m.peta.erp_kode]).join(', ') + (m.peta.dofas_tipe ? ` (${m.peta.dofas_tipe})` : '')}>{m.peta.nama}</td>
                    {months.map(k => {
                      const lost = hilang.some(x => x.m === m && x.k === k - 1), kept = keep(k - 1);
                      return (
                        <td key={k} className={cx('num font-mono', lost && 'text-red font-semibold', kept && 'text-faint italic')}
                          title={lost ? `Sebelumnya ${fmtTon(stored![k - 1])} ton` : kept ? 'Tidak ada di tempelan: tetap data tersimpan' : undefined}>
                          {m.ton[k - 1] ? fmt(m.ton[k - 1], m.ton[k - 1] % 1 ? 1 : 0) : lost ? '0' : '–'}
                        </td>
                      );
                    })}
                    <td className="num font-mono font-semibold">{m.rows ? fmtTon(tot) : 'tidak ada'}</td>
                    <td className={cx('num font-mono', diff && Math.abs(diff) >= 0.5 ? (diff > 0 ? 'text-green' : 'text-red') : 'text-faint')}>
                      {before == null ? '–' : diff && Math.abs(diff) >= 0.5 ? `${diff > 0 ? '+' : ''}${fmtTon(diff)}` : 'sama'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {keptMonths.length > 0 && (
          <Note tone="info">
            <b>{keptMonths.map(k => MONTHS_ID[k + 1]).join(', ')}</b> tidak ada di tempelan, jadi tidak diubah: tetap memakai data yang sudah tersimpan (angka miring).
            Hanya bulan {pasted!.map(k => MONTHS_ID[k]).join(', ')} yang diganti.
          </Note>
        )}
        {hilang.length > 0 && (
          <Note tone="warn">
            <b>Lebih kecil dari yang tersimpan:</b>{' '}
            {hilang.map(x => `${x.m.peta.nama} ${MONTHS_ID[x.k + 1]} ${fmtTon(x.before)} → ${fmtTon(x.after)}`).join('; ')}.
            Kalau bukan koreksi, periksa lagi tempelannya (bulan yang belum ikut tersalin, baris terfilter atau tersembunyi di Excel, sel kosong) sebelum menyimpan.
          </Note>
        )}
        {missing.length > 0 && (
          <Note tone="warn">Tidak ditemukan di tempelan: <b>{missing.map(m => `${m.peta.nama} (${(m.peta.dofas_kode || [m.peta.erp_kode]).join(', ')})`).join('; ')}</b>. Setelah disimpan nilainya menjadi 0.</Note>
        )}
        {ignored.length > 0 && (
          <Note tone="info">
            <b>Tidak dihitung</b> karena tidak ada di peta Sell Out BNN:
            <div className="flex gap-1.5 flex-wrap mt-1.5">
              {ignored.map(g => <span key={g.key} className="tag-code" title={`${g.rows} baris`}>{g.label} · {fmtTon(g.ton)}</span>)}
            </div>
          </Note>
        )}
        {res.warnings.map(w => <Note key={w} tone="warn">{w}</Note>)}
        <InvalidRows invalid={res.issues.length} issues={res.issues} />
      </div>

      <div className="px-[22px] py-4 border-t border-line flex items-center justify-between gap-4 flex-wrap bg-surface2/60">
        <span className="text-[12.5px] text-soft">{saving ? 'Menyimpan…' : pasted ? `${LABEL[dataset]} ${tahun} bulan ${MONTHS_ID[pasted[0]]}${pasted.length > 1 ? '–' + MONTHS_ID[pasted[pasted.length - 1]] : ''} akan diganti; bulan lain tetap.` : `Seluruh ${LABEL[dataset]} ${tahun} yang tersimpan akan diganti.`}</span>
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>Batal</button>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving || !res.rows.length}>{saving ? 'Menyimpan…' : `Simpan ${LABEL[dataset]} ${tahun}`}</button>
        </div>
      </div>
    </section>
  );
}
