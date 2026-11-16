/* ============================================================================
   Kelola Data · Stock · Upload file Stock Semen bulanan (satu sheet per tanggal).
   Semua sheet sampai hari ini dibaca; tanggal yang ada di file diganti seluruhnya,
   tanggal lain tetap. Region diambil dari tabel Daerah stok (Kelola Data → Tabel).
============================================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, apiGet } from '../../lib/api';
import { fmt } from '../../lib/format';
import { fmtDate, fmtRange } from '../../lib/dates';
import type { StockParseResult } from '../../lib/stockImport';
import type { Row } from '../../lib/types';
import { DoneCard, ErrorLine, InvalidRows, Note, PreviewFrame, SourcePicker, Steps, Unusable, fmtTon, type ImportPhase, useImport } from './shared';
import { cx } from '../../components/ui';

const MAX_JSON = 11e6;
const norm = (s: unknown) => String(s ?? '').trim().toUpperCase();

export function StockUpload({ onChanged }: { onChanged: () => void }) {
  const imp = useImport<StockParseResult>('stock');
  const { phase } = imp;
  const [round, setRound] = useState(0);
  const [peta, setPeta] = useState<Row[] | null>(null);
  useEffect(() => { apiGet<Row[]>('stock_daerah?select=daerah,region,urutan').then(setPeta).catch(() => setPeta(null)); }, []);

  const save = async () => {
    if (phase.kind !== 'preview') return;
    const { res, name } = phase;
    const body = { rows: res.rows, file_name: phase.source === 'file' ? name : null };
    if (JSON.stringify(body).length > MAX_JSON) { imp.setError(`File terlalu besar untuk sekali simpan (${fmt(res.rows.length)} baris).`); return; }
    const ok = await imp.saveWith(() => adminApi<Row>('POST', 'admin/data/stock', body));
    if (ok) { setRound(r => r + 1); onChanged(); }
  };

  return (
    <div>
      <Steps phase={phase.kind} />
      <ErrorLine error={imp.error} />
      <div hidden={phase.kind !== 'idle' && phase.kind !== 'reading'}>
        <SourcePicker key={round} id="stock" reading={phase.kind === 'reading' ? phase : null} onFile={imp.readFile} onText={imp.readText} onCancel={imp.cancelRead}
          fileHint="File Stock Semen bulanan (.xlsx), mis. Stock Semen NOV 2026.xlsx. Semua sheet tanggal sampai hari ini dibaca sekaligus; isi tanggal itu di web diganti, tanggal lain tetap. TR-30 tidak dimasukkan."
          pastePlaceholder={'REKAP STOCK SEMEN s.d 16 NOV 2026\n\nDAERAH\tPCC 50\tTON\tPCC 40\tTON\t…\nNC SELAT PANJANG\t1,086\t54\t-\t-\t…'} />
      </div>

      {(phase.kind === 'preview' || phase.kind === 'saving') && (
        phase.res.ok
          ? <StockPreview phase={phase} peta={peta} onSave={save} onCancel={imp.reset} />
          : <Unusable error={phase.res.error} missing={phase.res.missing} onCancel={imp.reset}
              hint="Setiap sheet berisi judul REKAP STOCK SEMEN s.d <tanggal> dan baris judul kolom DAERAH, PCC 50, TON, PCC 40, TON, … seperti file stok harian." />
      )}

      {phase.kind === 'done' && (
        <DoneCard actions={<><Link to="/stock" className="btn btn-primary no-underline">Lihat Stock</Link><button type="button" className="btn" onClick={imp.reset}>Upload lagi</button></>}>
          Stok {fmt(phase.result.jumlah_tanggal)} tanggal ({fmtRange({ from: String(phase.result.tanggal_dari).slice(0, 10), to: String(phase.result.tanggal_sampai).slice(0, 10) })}) tersimpan:
          {' '}{fmt(phase.result.rows_saved)} baris, stok {fmtDate(String(phase.result.tanggal_sampai).slice(0, 10))} {fmtTon(Number(phase.result.ton_terakhir))} ton.
          {Number(phase.result.rows_deleted) > 0 ? ` Menggantikan ${fmt(phase.result.rows_deleted)} baris lama pada tanggal yang sama.` : ''}
        </DoneCard>
      )}
    </div>
  );
}

function StockPreview({ phase, peta, onSave, onCancel }: {
  phase: Extract<ImportPhase<StockParseResult>, { kind: 'preview' } | { kind: 'saving' }>;
  peta: Row[] | null; onSave: () => void; onCancel: () => void;
}) {
  const st = phase.res.stats;
  const regionOf = useMemo(() => new Map((peta || []).map(p => [norm(p.daerah), String(p.region)])), [peta]);
  const tanpaRegion = peta ? st.daerah.filter(d => !regionOf.has(norm(d))) : [];
  const dipakai = st.sheets.filter(s => s.status === 'dipakai');
  const tonAkhir = st.latest.reduce((a, b) => a + b.ton, 0);

  // stok tanggal terakhir per region x produk
  const produk = st.produk.map(p => p.produk);
  const perRegion = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const r of st.latest) {
      const reg = regionOf.get(norm(r.daerah)) || 'Tanpa region';
      const o = m.get(reg) || {};
      o[r.produk] = (o[r.produk] || 0) + r.ton;
      m.set(reg, o);
    }
    return [...m.entries()].sort(([a], [b]) => (a === 'Tanpa region' ? 1 : b === 'Tanpa region' ? -1 : a.localeCompare(b)));
  }, [st.latest, regionOf]);

  return (
    <PreviewFrame phase={phase} title={phase.source === 'tempel' ? 'Data tempelan' : phase.name} onSave={onSave} onCancel={onCancel}
      canSave={phase.res.rows.length > 0} readyText={`${fmt(dipakai.length)} tanggal stok siap disimpan.`}>
      <div className="upl-facts">
        <div>
          <div className="card-title">Tanggal di file</div>
          <div className="upl-fact">{st.dateFrom ? fmtRange({ from: st.dateFrom, to: st.dateTo! }) : '–'}</div>
          <div className="upl-sub">{fmt(dipakai.length)} sheet dipakai dari {fmt(st.sheets.length)}</div>
        </div>
        <div>
          <div className="card-title">Stok terakhir</div>
          <div className="upl-fact">{fmtTon(tonAkhir)} <span className="upl-of">ton</span></div>
          <div className="upl-sub">{st.dateTo ? fmtDate(st.dateTo) : '–'}</div>
        </div>
        <div>
          <div className="card-title">Daerah</div>
          <div className="upl-fact">{fmt(st.daerah.length)}</div>
          <div className="upl-sub">{tanpaRegion.length ? `${fmt(tanpaRegion.length)} belum punya region` : 'Semua punya region'}</div>
        </div>
        <div>
          <div className="card-title">Produk</div>
          <div className="upl-fact">{fmt(st.produk.length)}</div>
          <div className="upl-sub">{st.dilewati.length ? `${st.dilewati.join(', ')} tidak dimasukkan` : produk.join(', ')}</div>
        </div>
      </div>

      <div className="px-[22px] pb-5 grid gap-5 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] max-[960px]:grid-cols-1">
        <div className="flex flex-col gap-5">
          <div>
            <div className="card-title mb-2">Stok {st.dateTo ? fmtDate(st.dateTo) : ''} per region (ton)</div>
            <div className="border border-line rounded overflow-x-auto">
              <table className="!min-w-0 tbl-dense">
                <thead><tr><th>Region</th>{produk.map(p => <th key={p} className="num">{p}</th>)}<th className="num">Total</th></tr></thead>
                <tbody>
                  {perRegion.map(([reg, v]) => (
                    <tr key={reg} className={cx(reg === 'Tanpa region' && 'text-red')}>
                      <td>{reg}</td>
                      {produk.map(p => <td key={p} className="num font-mono">{v[p] ? fmtTon(v[p]) : '–'}</td>)}
                      <td className="num font-mono font-semibold">{fmtTon(Object.values(v).reduce((a, b) => a + b, 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="card-title mb-2">Sheet di file</div>
            <div className="border border-line rounded overflow-x-auto">
              <table className="!min-w-0 tbl-dense">
                <thead><tr><th>Sheet</th><th>Tanggal</th><th>Keterangan</th><th className="num">Daerah</th><th className="num">Ton</th></tr></thead>
                <tbody>
                  {st.sheets.map(s => (
                    <tr key={s.sheet} className={cx(s.status !== 'dipakai' && 'text-faint')}>
                      <td className="font-mono">{s.sheet}</td>
                      <td className="whitespace-nowrap">{s.tanggal ? fmtDate(s.tanggal) : '–'}</td>
                      <td className="text-[12px]">{s.status === 'dipakai' ? 'Dipakai' : s.status === 'masa depan' ? 'Setelah hari ini, dilewati' : s.status === 'kosong' ? 'Kosong, dilewati' : s.status === 'tanggal ganda' ? 'Tanggal ganda, dilewati' : s.status === 'bulan lain' ? 'Bukan bulan file ini, dilewati' : 'Tidak terbaca'}{s.catatan ? ` · ${s.catatan}` : ''}</td>
                      <td className="num font-mono">{s.daerah ? fmt(s.daerah) : '–'}</td>
                      <td className="num font-mono">{s.ton ? fmtTon(s.ton) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {tanpaRegion.length > 0 && (
            <Note tone="bad">
              <b>{fmt(tanpaRegion.length)} daerah belum punya region</b>: {tanpaRegion.join(', ')}. Stoknya tetap disimpan tetapi tampil sebagai
              {' '}<b>Tanpa region</b>. Tambahkan di <Link to="/kelola-data?data=tabel">Kelola Data → Tabel → Daerah stok</Link>.
            </Note>
          )}
          {st.peringatan.map(p => <Note key={p} tone="warn">{p}</Note>)}
          <InvalidRows invalid={st.invalid} issues={st.issues} />
          <Note tone="warn">
            Stok tanggal <b>{st.dateFrom ? fmtRange({ from: st.dateFrom, to: st.dateTo! }) : '–'}</b> di web akan <b>diganti</b> dengan isi file ini. Tanggal lain tidak berubah.
          </Note>
          <Note tone="info">
            Ton = zak × berat per zak dari nama kolom (PCC 50 = 50 kg, RAJAWALI 40 = 40 kg), bukan kolom TON di file.
            {st.dilewati.length > 0 && <> Kolom {st.dilewati.join(', ')} tidak dimasukkan.</>}
          </Note>
        </div>
      </div>
    </PreviewFrame>
  );
}
