/* ============================================================================
   Kelola Data · Sell In BNN: upload / ganti per rentang tanggal + peta region.
============================================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { fmt, MONTHS_ID } from '../../lib/format';
import { dayCount, fmtDate, fmtRange } from '../../lib/dates';
import type { SellinParseResult } from '../../lib/sellin';
import type { Row } from '../../lib/types';
import { ErrorBox, TableWrap, cx } from '../../components/ui';
import {
  DoneCard, ErrorLine, ICON, InvalidRows, Note, PreviewFrame, SourcePicker, Steps, Unusable, afterDataChanged, errText, fmtTon, type ImportPhase, useImport,
} from './shared';

const regionList = (m: Row[] | null) => [...new Set((m || []).map(r => String(r.region)))].sort((a, b) => a.localeCompare(b));

/** Peta region + kode belum terpetakan, dimuat sekali dan bisa dimuat ulang. */
function useRegionData() {
  const [regionMap, setRegionMap] = useState<Row[] | null>(null);
  const [unmapped, setUnmapped] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    Promise.all([adminApi<Row[]>('GET', 'admin/sellin/region-map'), adminApi<Row[]>('GET', 'admin/sellin/unmapped')])
      .then(([m, x]) => { setRegionMap(m); setUnmapped(x); setError(null); })
      .catch(e => setError(errText(e)));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { regionMap, unmapped, error, reload };
}

export function SellinUpload({ onChanged }: { onChanged: () => void }) {
  const imp = useImport<SellinParseResult>('sellin');
  const { phase } = imp;
  const region = useRegionData();
  const [round, setRound] = useState(0);   // kosongkan form tempel setelah berhasil simpan

  const save = async () => {
    if (phase.kind !== 'preview') return;
    const { res, source, name } = phase;
    const ok = await imp.save('admin/sellin', res.rows,
      { source, file_name: source === 'file' ? name : null, date_from: res.stats.dateFrom, date_to: res.stats.dateTo, rows_read: res.stats.rowsRead });
    if (ok) { setRound(r => r + 1); region.reload(); onChanged(); }
  };
  const reset = () => imp.reset();

  return (
    <div>
      <Steps phase={phase.kind} />
      <ErrorLine error={imp.error} />
      <div hidden={phase.kind !== 'idle' && phase.kind !== 'reading'}>
        <SourcePicker key={round} id="si" reading={phase.kind === 'reading' ? phase : null} onFile={imp.readFile} onText={imp.readText} onCancel={imp.cancelRead}
          fileHint="Export raw sell in (.xlsx atau .csv). Data pada rentang tanggal di file akan diganti dengan isi file."
          pastePlaceholder={'Distributor\tKode Customer\tNama Customer\t…\n6984 - BANGUN MITRA MAKMUR, PT\t3300000006\tGudang Way Lunik\t…'} />
      </div>

      {(phase.kind === 'preview' || phase.kind === 'saving') && (
        phase.res.ok
          ? <SellinPreview phase={phase} regionMap={region.regionMap} onRegionSaved={region.reload} onSave={save} onCancel={reset} />
          : <Unusable error={phase.res.error} missing={phase.res.missing} onCancel={reset}
              hint="Pastikan baris pertama berisi judul kolom persis seperti export raw sell in, dan baris judul ikut tersalin." />
      )}

      {phase.kind === 'done' && (
        <DoneCard actions={<><Link to="/sell-in-bnn" className="btn btn-primary no-underline">Lihat Sell In BNN</Link><button type="button" className="btn" onClick={reset}>Upload lagi</button></>}>
          {fmt(phase.result.rows_saved)} pengiriman ({fmtTon(Number(phase.result.ton_saved))} ton) untuk {fmtRange({ from: String(phase.result.date_from), to: String(phase.result.date_to) })}.
          {Number(phase.result.rows_replaced) > 0 ? ` Menggantikan ${fmt(phase.result.rows_replaced)} baris lama pada rentang itu.` : ' Belum ada data sebelumnya pada rentang itu.'}
        </DoneCard>
      )}

      {region.error && <div className="mt-6"><ErrorBox error={region.error} /></div>}
      {region.unmapped && region.unmapped.length > 0 && phase.kind !== 'preview' && phase.kind !== 'saving' && (
        <>
          <h2 className="section-title">Gudang Belum Punya Region <span className="n">{region.unmapped.length} kode</span></h2>
          <p className="text-soft text-[13px] -mt-1.5 mb-3 max-w-[680px]">Pengiriman ke kode ini tampil sebagai "Belum dipetakan" di Sell In BNN. Pilih region-nya; berlaku langsung untuk semua data.</p>
          <RegionAssign codes={region.unmapped.map(u => ({ kode: String(u.kode_customer), nama: String(u.nama_customer || ''), extra: `${fmt(u.pengiriman)} pengiriman · ${fmtTon(Number(u.ton))} ton` }))}
            regions={regionList(region.regionMap)} onSaved={region.reload} />
        </>
      )}
    </div>
  );
}

function SellinPreview({ phase, regionMap, onRegionSaved, onSave, onCancel }: {
  phase: Extract<ImportPhase<SellinParseResult>, { kind: 'preview' } | { kind: 'saving' }>;
  regionMap: Row[] | null; onRegionSaved: () => void; onSave: () => void; onCancel: () => void;
}) {
  const st = phase.res.stats;
  const [impact, setImpact] = useState<Row | null>(null);
  useEffect(() => {
    setImpact(null);
    if (!st.dateFrom || !st.dateTo) return;
    adminApi<Row>('GET', `admin/sellin/impact?from=${st.dateFrom}&to=${st.dateTo}`).then(setImpact).catch(() => setImpact(null));
  }, [st.dateFrom, st.dateTo]);

  const known = new Set((regionMap || []).map(r => String(r.kode_customer)));
  const unknownCodes = regionMap ? Object.entries(st.customers).filter(([k]) => !known.has(k)) : [];
  const months = Object.entries(st.byMonth).sort(([a], [b]) => a.localeCompare(b));
  const days = st.dateFrom && st.dateTo ? dayCount({ from: st.dateFrom, to: st.dateTo }) : 0;
  const existing = impact ? Number(impact.rows_existing) : null;
  const skipped = st.skippedTokoProject + st.skippedOther + st.skippedMortar;

  return (
    <PreviewFrame phase={phase} title={phase.source === 'tempel' ? 'Data tempelan' : phase.name} onSave={onSave} onCancel={onCancel}
      canSave={st.rowsUsed > 0} readyText={st.rowsUsed ? `${fmt(st.rowsUsed)} pengiriman siap disimpan.` : 'Tidak ada baris yang memenuhi aturan.'}>
      <div className="upl-facts">
        <div>
          <div className="card-title">Periode di file</div>
          <div className="upl-fact">{st.dateFrom ? fmtRange({ from: st.dateFrom, to: st.dateTo! }) : '–'}</div>
          <div className="upl-sub">{days ? `${fmt(days)} hari, menurut Tanggal Pengiriman` : 'Tidak ada tanggal'}</div>
        </div>
        <div>
          <div className="card-title">Baris dipakai</div>
          <div className="upl-fact">{fmt(st.rowsUsed)} <span className="upl-of">dari {fmt(st.rowsRead)}</span></div>
          <div className="upl-sub">{fmt(st.usedGudang)} Gudang · {fmt(st.usedPmTokoProject)} Toko/Project PM</div>
        </div>
        <div>
          <div className="card-title">Tonase</div>
          <div className="upl-fact">{fmtTon(st.ton)} <span className="upl-of">ton</span></div>
          <div className="upl-sub">Delivery Quantity × berat per zak</div>
        </div>
        <div>
          <div className="card-title">Tidak dipakai</div>
          <div className="upl-fact">{fmt(skipped)}</div>
          <div className="upl-sub">
            {[st.skippedTokoProject && `${fmt(st.skippedTokoProject)} toko/project non-PM`, st.skippedMortar && `${fmt(st.skippedMortar)} mortar/thinbed`, st.skippedOther && `${fmt(st.skippedOther)} tipe lain`].filter(Boolean).join(' · ') || 'Semua baris memenuhi aturan'}
          </div>
        </div>
      </div>

      <div className="px-[22px] pb-5 grid gap-5 grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] max-[960px]:grid-cols-1">
        <div>
          <div className="card-title mb-2">Per bulan</div>
          <div className="border border-line rounded overflow-hidden">
            <table className="!min-w-0 tbl-dense">
              <thead><tr><th>Bulan</th><th className="num">Pengiriman</th><th className="num">Ton</th></tr></thead>
              <tbody>
                {months.map(([k, v]) => (
                  <tr key={k}><td>{MONTHS_ID[Number(k.slice(5))]} {k.slice(0, 4)}</td><td className="num font-mono">{fmt(v.rows)}</td><td className="num font-mono">{fmtTon(v.ton)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Note tone={existing ? 'warn' : 'info'}>
            {impact == null ? 'Memeriksa data yang sudah ada…'
              : existing
                ? <>Data lama pada {fmtRange({ from: st.dateFrom!, to: st.dateTo! })} (<b>{fmt(existing)} pengiriman, {fmtTon(Number(impact.ton_existing))} ton</b>) akan <b>diganti</b> dengan isi file ini.</>
                : <>Belum ada data pada {fmtRange({ from: st.dateFrom!, to: st.dateTo! })}. Isi file akan ditambahkan.</>}
          </Note>
          <InvalidRows invalid={st.invalid} issues={st.issues} />
          {unknownCodes.length > 0 && (
            <Note tone="warn" icon={ICON.pin}>
              <b>{unknownCodes.length} kode Gudang belum punya region.</b> Atur sekarang supaya langsung masuk region yang benar (bisa juga setelah upload).
              <div className="mt-2.5">
                <RegionAssign compact codes={unknownCodes.map(([kode, nama]) => ({ kode, nama }))} regions={regionList(regionMap)} onSaved={onRegionSaved} />
              </div>
            </Note>
          )}
        </div>
      </div>
    </PreviewFrame>
  );
}

/* ---------------------------------------------------------------------------
   Pilih region untuk kode customer
--------------------------------------------------------------------------- */
function RegionAssign({ codes, regions, onSaved, compact }: { codes: { kode: string; nama: string; extra?: string }[]; regions: string[]; onSaved: () => void; compact?: boolean }) {
  const [val, setVal] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const listId = useMemo(() => 'rg-' + Math.random().toString(36).slice(2, 8), []);
  const save = async (kode: string, nama: string) => {
    const region = (val[kode] || '').trim();
    if (!region) return;
    setBusy(kode); setMsg(null);
    try { await adminApi('POST', 'admin/sellin/region-map', { kode_customer: kode, region, nama_customer: nama }); afterDataChanged(); onSaved(); }
    catch (e) { setMsg(errText(e)); }
    finally { setBusy(null); }
  };
  return (
    <div className={cx('flex flex-col', compact ? 'gap-2' : 'gap-0 card !p-0 overflow-hidden')}>
      <datalist id={listId}>{regions.map(r => <option key={r} value={r} />)}</datalist>
      {codes.map(c => (
        <div key={c.kode} className={cx('flex items-center gap-3 flex-wrap', !compact && 'px-4 py-3 border-b border-line last:border-b-0')}>
          <div className="min-w-0 flex-1 basis-[220px]">
            <span className="font-mono text-[12px] text-soft mr-2">{c.kode}</span>
            <span className="text-[13px] text-ink">{c.nama || '–'}</span>
            {c.extra && <div className="text-faint text-[11.5px] mt-0.5">{c.extra}</div>}
          </div>
          <input type="text" list={listId} aria-label={`Region untuk ${c.kode}`} placeholder="Region" value={val[c.kode] || ''}
            onChange={e => setVal(v => ({ ...v, [c.kode]: e.target.value }))} className="!min-w-0 w-[150px] !py-1.5"
            onKeyDown={e => { if (e.key === 'Enter') void save(c.kode, c.nama); }} />
          <button type="button" className="btn btn-sm" disabled={!val[c.kode]?.trim() || busy === c.kode} onClick={() => save(c.kode, c.nama)}>
            {busy === c.kode ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      ))}
      {msg && <div className="text-red text-[12.5px] px-1">{msg}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Peta region lengkap (lihat + tambah/ubah)
--------------------------------------------------------------------------- */
export function SellinRegionMap() {
  const { regionMap, error, reload } = useRegionData();
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ kode: '', region: '', nama: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const regions = regionList(regionMap);
  const rows = (regionMap || []).filter(r => !q || `${r.kode_customer} ${r.nama_customer} ${r.region}`.toLowerCase().includes(q.toLowerCase()));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.kode.trim() || !form.region.trim()) return;
    setBusy(true); setMsg(null);
    try {
      await adminApi('POST', 'admin/sellin/region-map', { kode_customer: form.kode.trim(), region: form.region.trim(), nama_customer: form.nama.trim() || null });
      afterDataChanged();
      setMsg({ ok: true, text: `Region untuk ${form.kode.trim()} disimpan.` });
      setForm({ kode: '', region: '', nama: '' });
      reload();
    } catch (err) { setMsg({ ok: false, text: errText(err) }); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <p className="text-soft text-[13px] mb-3.5 max-w-[720px]">
        Menentukan region setiap kode Gudang di Sell In BNN{regionMap ? ` (${fmt(regionMap.length)} kode, ${regions.length} region)` : ''}. Toko/project PT Permata Multi Niaga otomatis masuk Sumsel.
      </p>
      {error && <div className="mb-3"><ErrorBox error={error} /></div>}
      <div className="grid gap-4 grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)] max-[960px]:grid-cols-1 items-start">
        <div>
          <input type="search" placeholder="Cari kode, nama, atau region…" value={q} onChange={e => setQ(e.target.value)} className="w-full mb-2.5" aria-label="Cari di peta region" />
          <TableWrap className="max-h-[460px] overflow-y-auto">
            <table className="!min-w-0">
              <thead><tr><th>Region</th><th>Kode</th><th>Nama customer</th><th>Diubah</th></tr></thead>
              <tbody>
                {!regionMap && !error && <tr><td colSpan={4} className="!text-center !text-faint !p-5">Memuat…</td></tr>}
                {rows.map(r => (
                  <tr key={r.kode_customer} className="cursor-pointer" tabIndex={0} title="Klik untuk mengubah"
                    onClick={() => setForm({ kode: String(r.kode_customer), region: String(r.region), nama: String(r.nama_customer || '') })}
                    onKeyDown={e => { if (e.key === 'Enter') setForm({ kode: String(r.kode_customer), region: String(r.region), nama: String(r.nama_customer || '') }); }}>
                    <td className="font-semibold">{r.region}</td>
                    <td className="font-mono text-[12px]">{r.kode_customer}</td>
                    <td>{r.nama_customer || '–'}</td>
                    <td className="text-faint text-[12px] whitespace-nowrap">{r.updated_by}{r.updated_at ? ' · ' + fmtDate(String(r.updated_at).slice(0, 10)) : ''}</td>
                  </tr>
                ))}
                {regionMap && rows.length === 0 && <tr><td colSpan={4} className="!text-center !text-faint !p-5">Tidak ditemukan.</td></tr>}
              </tbody>
            </table>
          </TableWrap>
        </div>
        <form className="card" onSubmit={submit}>
          <div className="card-title">Tambah atau ubah</div>
          <p className="text-faint text-[12px] mb-3">Klik baris di tabel untuk mengubahnya.</p>
          <div className="flex flex-col gap-3">
            <div className="control"><label htmlFor="rmKode">Kode customer</label><input id="rmKode" type="text" value={form.kode} onChange={e => setForm(f => ({ ...f, kode: e.target.value }))} placeholder="mis. 3300000006" /></div>
            <div className="control"><label htmlFor="rmRegion">Region</label>
              <input id="rmRegion" type="text" list="rm-regions" value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} placeholder="Pilih atau ketik region baru" />
              <datalist id="rm-regions">{regions.map(r => <option key={r} value={r} />)}</datalist>
            </div>
            <div className="control"><label htmlFor="rmNama">Nama customer (opsional)</label><input id="rmNama" type="text" value={form.nama} onChange={e => setForm(f => ({ ...f, nama: e.target.value }))} /></div>
            <button type="submit" className="btn btn-primary justify-center" disabled={busy || !form.kode.trim() || !form.region.trim()}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
            {msg && <div className={cx('text-[12.5px]', msg.ok ? 'text-green' : 'text-red')} role="status">{msg.text}</div>}
          </div>
        </form>
      </div>
    </div>
  );
}
