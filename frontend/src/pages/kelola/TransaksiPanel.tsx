/* ============================================================================
   Kelola Data · Transaksi distributor: upload / ganti per (tanggal × distributor)
   dan status sinkronisasi.
============================================================================ */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { fmt } from '../../lib/format';
import { dayCount, fmtRange } from '../../lib/dates';
import type { DateOrder } from '../../lib/sellin';
import type { TrxParseResult } from '../../lib/transaksiImport';
import type { Row } from '../../lib/types';
import { ErrorBox, cx } from '../../components/ui';
import { todayWIB } from '../../components/DataStatus';
import {
  DateOrderNote, DoneCard, ErrorLine, InvalidRows, Note, PreviewFrame, SourcePicker, Steps, Unusable, afterDataChanged, errText, type ImportPhase, useImport,
} from './shared';

export function TransaksiUpload({ onChanged }: { onChanged: () => void }) {
  const imp = useImport<TrxParseResult>('transaksi');
  const { phase } = imp;
  const [round, setRound] = useState(0);

  const save = async () => {
    if (phase.kind !== 'preview') return;
    const { res, source, name } = phase;
    const ok = await imp.save('admin/transaksi', res.rows, {
      source, file_name: source === 'file' ? name : null, date_from: res.stats.dateFrom, date_to: res.stats.dateTo,
      dist_codes: Object.keys(res.stats.perDist), rows_read: res.stats.rowsRead,
    });
    if (ok) { setRound(r => r + 1); onChanged(); }
  };

  return (
    <div>
      <Steps phase={phase.kind} />
      <ErrorLine error={imp.error} />
      <div hidden={phase.kind !== 'idle' && phase.kind !== 'reading'}>
        <SourcePicker key={round} id="trx" reading={phase.kind === 'reading' ? phase : null} onFile={imp.readFile} onText={imp.readText} onCancel={imp.cancelRead}
          fileHint="Template transaksi distributor (.xlsx atau .csv, kolom dist_code s.d. pelunasan_hari). Data distributor yang ada di file, pada rentang tanggal di file, akan diganti."
          pastePlaceholder={'dist_code\tdistributor_name\tdo_date\tdo_no\t…\nBMM\tPT. BANGUN MITRA MAKMUR\t2026-11-03\t2611001\t…'} />
      </div>

      {(phase.kind === 'preview' || phase.kind === 'saving') && (
        phase.res.ok && phase.res.stats.rowsUsed === 0
          ? <Unusable error="Tidak ada baris yang bisa dipakai." hint="" onCancel={imp.reset}>
              {phase.res.stats.invalid > 0
                ? <InvalidRows invalid={phase.res.stats.invalid} issues={phase.res.stats.issues} />
                : <p className="text-soft text-[13px]">File hanya berisi baris judul.</p>}
            </Unusable>
          : phase.res.ok
          ? <TrxPreview phase={phase} onSave={save} onCancel={imp.reset} onDateOrder={imp.rereadDates} />
          : <Unusable error={phase.res.error} missing={phase.res.missing} onCancel={imp.reset}
              hint="Baris pertama harus berisi nama kolom template (dist_code, do_date, do_no, customer_code, product_code, order_qty, …) dan ikut tersalin." />
      )}

      {phase.kind === 'done' && (
        <DoneCard actions={<><Link to="/rekap-harian" className="btn btn-primary no-underline">Lihat Rekap Harian</Link><button type="button" className="btn" onClick={imp.reset}>Upload lagi</button></>}>
          {fmt(phase.result.rows_saved)} baris transaksi untuk {fmtRange({ from: String(phase.result.date_from), to: String(phase.result.date_to) })}
          {' '}({(phase.result.dist_codes as string[] | null)?.join(', ') || '–'}).
          {Number(phase.result.rows_deleted) > 0 ? ` Menggantikan ${fmt(phase.result.rows_deleted)} baris lama.` : ' Belum ada data sebelumnya pada rentang itu.'}
          {' '}Ringkasan dashboard sudah dihitung ulang.
        </DoneCard>
      )}
    </div>
  );
}

function TrxPreview({ phase, onSave, onCancel, onDateOrder }: {
  phase: Extract<ImportPhase<TrxParseResult>, { kind: 'preview' } | { kind: 'saving' }>; onSave: () => void; onCancel: () => void; onDateOrder: (o: DateOrder) => void;
}) {
  const st = phase.res.stats;
  const dists = Object.keys(st.perDist).sort();
  const [impact, setImpact] = useState<Record<string, Row> | null>(null);
  const [impactErr, setImpactErr] = useState<string | null>(null);
  const [accept, setAccept] = useState(false);
  const distKey = dists.join(',');
  useEffect(() => {
    setImpact(null); setImpactErr(null);
    if (!st.dateFrom || !st.dateTo || !distKey) return;
    adminApi<Row[]>('POST', 'admin/transaksi/impact', { date_from: st.dateFrom, date_to: st.dateTo, dist_codes: distKey.split(',') })
      .then(r => setImpact(Object.fromEntries(r.map(x => [String(x.dist_code), x]))))
      .catch(e => setImpactErr(errText(e)));
  }, [st.dateFrom, st.dateTo, distKey]);

  const totalDo = dists.reduce((a, d) => a + st.perDist[d].dos, 0);
  const totalQty = dists.reduce((a, d) => a + st.perDist[d].qty, 0);
  const oldRows = impact ? Object.values(impact).reduce((a, r) => a + Number(r.baris || 0), 0) : null;
  const days = st.dateFrom && st.dateTo ? dayCount({ from: st.dateFrom, to: st.dateTo }) : 0;
  const range = st.dateFrom ? fmtRange({ from: st.dateFrom, to: st.dateTo! }) : '–';
  const future = st.dateTo && st.dateTo > todayWIB();
  const needAccept = st.invalid > 0;
  const canSave = st.rowsUsed > 0 && (!needAccept || accept);

  return (
    <PreviewFrame phase={phase} title={phase.source === 'tempel' ? 'Data tempelan' : phase.name} onSave={onSave} onCancel={onCancel} canSave={canSave}
      readyText={!st.rowsUsed ? 'Tidak ada baris yang bisa disimpan.' : needAccept && !accept ? 'Centang persetujuan di atas untuk melanjutkan.' : `${fmt(st.rowsUsed)} baris siap disimpan.`}
      savingHint="Jangan tutup halaman ini. Setelah baris terkirim, ringkasan dashboard dihitung ulang (bisa sampai beberapa menit). Kalau gagal, data lama tetap utuh.">
      <div className="upl-facts">
        <div>
          <div className="card-title">Periode di file</div>
          <div className="upl-fact">{range}</div>
          <div className="upl-sub">{days ? `${fmt(days)} hari, menurut do_date` : 'Tidak ada tanggal'}</div>
        </div>
        <div>
          <div className="card-title">Baris dipakai</div>
          <div className="upl-fact">{fmt(st.rowsUsed)} <span className="upl-of">dari {fmt(st.rowsRead)}</span></div>
          <div className="upl-sub">{st.invalid ? `${fmt(st.invalid)} baris tidak terbaca` : 'Semua baris terbaca'}</div>
        </div>
        <div>
          <div className="card-title">Distributor</div>
          <div className="upl-fact">{fmt(dists.length)}</div>
          <div className="upl-sub">{fmt(totalDo)} nomor DO</div>
        </div>
        <div>
          <div className="card-title">Order qty</div>
          <div className="upl-fact">{fmt(totalQty)}</div>
          <div className="upl-sub">Jumlah kolom order_qty</div>
        </div>
      </div>

      <div className="px-[22px] pb-5 grid gap-5 grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] max-[960px]:grid-cols-1">
        <div>
          <div className="card-title mb-2">Per distributor</div>
          <div className="border border-line rounded overflow-x-auto">
            <table className="!min-w-0 tbl-dense">
              <thead><tr><th>Distributor</th><th className="num">Baris file</th><th className="num">DO</th><th className="num">Data lama</th></tr></thead>
              <tbody>
                {dists.map(d => {
                  const old = impact?.[d];
                  return (
                    <tr key={d}>
                      <td><span className="font-mono text-[12px]">{d}</span>{st.distNames[d] && <span className="text-soft text-[12px]"> · {st.distNames[d]}</span>}</td>
                      <td className="num font-mono">{fmt(st.perDist[d].rows)}</td>
                      <td className="num font-mono">{fmt(st.perDist[d].dos)}</td>
                      <td className={cx('num font-mono', old && Number(old.baris) > 0 ? 'text-amber' : 'text-faint')}>
                        {impact == null ? '…' : old ? `${fmt(old.baris)} baris` : '–'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <DateOrderNote info={st.dateOrder} onSwitch={onDateOrder} disabled={phase.kind === 'saving'} />
          {impactErr ? <ErrorBox error={impactErr} /> : (
            <Note tone={oldRows ? 'warn' : 'info'}>
              {oldRows == null ? 'Memeriksa data yang sudah ada…'
                : oldRows
                  ? <>Data lama <b>{fmt(oldRows)} baris</b> milik {dists.length === 1 ? 'distributor ini' : `${dists.length} distributor ini`} pada {range} akan <b>diganti</b> dengan isi file. Distributor lain dan tanggal lain tidak berubah.</>
                  : <>Belum ada data distributor ini pada {range}. Isi file akan ditambahkan; data lain tidak berubah.</>}
            </Note>
          )}
          {future && <Note tone="warn">Ada tanggal setelah hari ini ({fmtRange({ from: st.dateTo!, to: st.dateTo! })}). Pastikan kolom do_date benar.</Note>}
          <InvalidRows invalid={st.invalid} issues={st.issues} what="baris tidak akan disimpan" />
          {needAccept && (
            <label className="flex items-start gap-2.5 text-[13px] text-ink cursor-pointer">
              <input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} className="mt-0.5" disabled={phase.kind === 'saving'} />
              <span>Saya mengerti {fmt(st.invalid)} baris di atas tidak ikut tersimpan, sementara data lama pada rentang ini tetap diganti. Perbaiki file dulu kalau baris itu penting.</span>
            </label>
          )}
        </div>
      </div>
    </PreviewFrame>
  );
}

/* ---------------------------------------------------------------------------
   Status sinkronisasi: tanggal & jam "diperbarui" untuk data transaksi
--------------------------------------------------------------------------- */
export function StatusSyncForm({ onChanged }: { onChanged: () => void }) {
  const [form, setForm] = useState<{ tanggal: string; jam: string; ket: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    adminApi<Row>('GET', 'admin/data/status-sync')
      .then(r => setForm({ tanggal: String(r.tanggal_update || '').slice(0, 10), jam: String(r.jam_update || '').slice(0, 5), ket: String(r.keterangan || '') }))
      .catch(e => setError(errText(e)));
  }, []);
  const now = () => {
    const d = new Date();
    setForm(f => f && { ...f, tanggal: todayWIB(), jam: d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }) });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form?.tanggal) return;
    setBusy(true); setMsg(null); setError(null);
    try {
      await adminApi('POST', 'admin/data/status-sync', { tanggal_update: form.tanggal, jam_update: form.jam || null, keterangan: form.ket.trim() || null });
      afterDataChanged(); onChanged();
      setMsg('Tersimpan.');
    } catch (err) { setError(errText(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid gap-5 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-[960px]:grid-cols-1 items-start">
      <form className="card" onSubmit={submit}>
        <div className="card-title">Waktu pembaruan transaksi</div>
        {error && <div className="my-3"><ErrorBox error={error} /></div>}
        {!form ? !error && <div className="text-faint text-[13px] mt-3">Memuat…</div> : (
          <div className="flex flex-col gap-3 mt-3">
            <div className="flex gap-3 flex-wrap items-end">
              <div className="control"><label htmlFor="ssTgl">Tanggal</label><input id="ssTgl" type="date" required value={form.tanggal} max={todayWIB()} onChange={e => setForm({ ...form, tanggal: e.target.value })} /></div>
              <div className="control"><label htmlFor="ssJam">Jam (WIB)</label><input id="ssJam" type="time" value={form.jam} onChange={e => setForm({ ...form, jam: e.target.value })} /></div>
              <button type="button" className="btn btn-sm mb-[3px]" onClick={now}>Isi waktu sekarang</button>
            </div>
            <div className="control"><label htmlFor="ssKet">Keterangan (opsional)</label><input id="ssKet" type="text" maxLength={200} value={form.ket} onChange={e => setForm({ ...form, ket: e.target.value })} placeholder="mis. Sinkron otomatis dari server distributor" /></div>
            <div className="flex items-center gap-3">
              <button type="submit" className="btn btn-primary" disabled={busy || !form.tanggal}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
              {msg && <span className="text-green text-[12.5px]" role="status">{msg}</span>}
            </div>
          </div>
        )}
      </form>
      <div className="text-soft text-[13px] leading-relaxed max-w-[460px]">
        <p>Waktu ini tampil sebagai <b className="text-ink font-semibold">Diperbarui</b> pada status data transaksi (badge di tiap halaman dan panel di sidebar).</p>
        <p className="mt-2">Upload transaksi lewat halaman ini mengisinya otomatis. Ubah manual hanya kalau data masuk dari jalur lain, misalnya sinkronisasi langsung ke database.</p>
        <p className="mt-2 text-faint">"Data s.d." tidak diatur di sini: selalu dihitung dari tanggal transaksi terakhir yang benar-benar ada.</p>
      </div>
    </div>
  );
}
