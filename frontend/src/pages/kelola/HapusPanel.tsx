/* ============================================================================
   Kelola Data · Hapus data per rentang tanggal (transaksi: bisa per distributor).
   Alur: pilih rentang → lihat jumlah yang akan terhapus → ketik HAPUS → hapus.
============================================================================ */
import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../../lib/api';
import { fmt } from '../../lib/format';
import { addDays, fmtRange, isISO, startOfMonth, type DateRange } from '../../lib/dates';
import type { Dataset } from '../../lib/importer.worker';
import type { Row } from '../../lib/types';
import { DateRangePicker, type RangePreset } from '../../components/DateRangePicker';
import { todayWIB } from '../../components/DataStatus';
import { ErrorBox, cx } from '../../components/ui';
import { ICON, Ic, Note, afterDataChanged, errText, fmtTon } from './shared';

const WORD = 'HAPUS';

export function HapusPanel({ dataset, lastDate, onChanged }: { dataset: Dataset; lastDate: string | null; onChanged: () => void }) {
  const today = todayWIB();
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [allDist, setAllDist] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [dists, setDists] = useState<Row[] | null>(null);
  const [preview, setPreview] = useState<Row | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const isTrx = dataset === 'transaksi';

  useEffect(() => {
    if (!isTrx) return;
    adminApi<Row[]>('GET', 'admin/data/distributor').then(setDists).catch(e => setError(errText(e)));
  }, [isTrx]);

  const hasRange = isISO(range.from) && isISO(range.to);
  const distArg = isTrx && !allDist ? picked : null;
  const distKey = distArg ? distArg.slice().sort().join(',') : '';
  const blocked = isTrx && !allDist && picked.length === 0;

  // hitung ulang jumlah yang akan terhapus setiap pilihan berubah
  useEffect(() => {
    setPreview(null); setConfirm(''); setError(null);
    if (!hasRange || blocked) return;
    let alive = true;
    setChecking(true);
    const t = setTimeout(() => {
      adminApi<Row>('POST', 'admin/data/hapus-pratinjau', { dataset, date_from: range.from, date_to: range.to, dist_codes: distKey ? distKey.split(',') : null })
        .then(r => { if (alive) setPreview(r); })
        .catch(e => { if (alive) setError(errText(e)); })
        .finally(() => { if (alive) setChecking(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [dataset, range.from, range.to, distKey, hasRange, blocked]);

  const presets = useMemo<RangePreset[]>(() => {
    const p: RangePreset[] = [];
    if (lastDate) p.push({ label: 'Tanggal data terakhir', range: { from: lastDate, to: lastDate } });
    p.push({ label: 'Kemarin', range: { from: addDays(today, -1), to: addDays(today, -1) } });
    p.push({ label: 'Bulan ini', range: { from: startOfMonth(today), to: today } });
    return p;
  }, [lastDate, today]);

  const count = preview ? Number(preview.baris) : 0;
  const scopeText = isTrx ? (allDist ? 'semua distributor' : picked.length === 1 ? `distributor ${picked[0]}` : `${picked.length} distributor`) : 'Sell In BNN';

  const run = async () => {
    if (!hasRange || confirm !== WORD || !count) return;
    setBusy(true); setError(null);
    try {
      const r = await adminApi<{ deleted: number }>('POST', 'admin/data/hapus',
        { dataset, date_from: range.from, date_to: range.to, dist_codes: distArg, konfirmasi: WORD });
      afterDataChanged(); onChanged();
      setDone(`${fmt(r.deleted)} baris ${isTrx ? 'transaksi' : 'sell in'} (${scopeText}) pada ${fmtRange(range)} sudah dihapus.`);
      setRange({ from: '', to: '' }); setConfirm(''); setPreview(null);
    } catch (e) { setError(errText(e)); }
    finally { setBusy(false); }
  };

  const toggle = (code: string) => setPicked(p => (p.includes(code) ? p.filter(x => x !== code) : [...p, code]));

  return (
    <div className="grid gap-5 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] max-[960px]:grid-cols-1 items-start">
      <section className="card" aria-label="Pilih data yang dihapus">
        <div className="card-title mb-3">1 · Pilih data</div>
        <DateRangePicker label="Rentang tanggal" value={range} onChange={r => { setRange(r); setDone(null); }} max={today} presets={presets} allowClear placeholder="Pilih rentang tanggal" />

        {isTrx && (
          <fieldset className="mt-4 border-0 p-0 m-0">
            <legend className="text-[12px] text-soft font-semibold mb-2">Distributor</legend>
            <div className="flex gap-4 flex-wrap text-[13px]">
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="hapusDist" checked={allDist} onChange={() => setAllDist(true)} />Semua distributor</label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="hapusDist" checked={!allDist} onChange={() => setAllDist(false)} />Pilih distributor</label>
            </div>
            {!allDist && (
              <div className="hps-dists mt-2.5">
                {!dists && <span className="text-faint text-[12.5px]">Memuat…</span>}
                {dists?.map(d => {
                  const code = String(d.dist_code);
                  return (
                    <label key={code} className={cx('hps-dist', picked.includes(code) && 'is-on')} title={String(d.dist_name || '')}>
                      <input type="checkbox" checked={picked.includes(code)} onChange={() => toggle(code)} />
                      <span className="font-mono text-[12px] font-semibold whitespace-nowrap">{code}</span>
                      <span className="text-soft text-[12px] truncate">{String(d.dist_name || '')}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
        )}
        {!isTrx && <p className="text-faint text-[12.5px] mt-3">Semua pengiriman Sell In BNN pada rentang ini ikut terhapus. Peta region tidak berubah.</p>}
      </section>

      <section className="card" aria-label="Konfirmasi hapus" aria-live="polite">
        <div className="card-title mb-3">2 · Periksa & hapus</div>
        {error && <div className="mb-3"><ErrorBox error={error} /></div>}
        {done && <Note tone="info" icon={ICON.check}>{done}</Note>}
        {!done && !hasRange && <p className="text-faint text-[13px]">Pilih rentang tanggal dulu.</p>}
        {!done && hasRange && blocked && <p className="text-faint text-[13px]">Centang minimal satu distributor.</p>}
        {!done && hasRange && !blocked && (checking || !preview) && !error && <p className="text-faint text-[13px]">Menghitung data…</p>}
        {!done && preview && !checking && (count === 0 ? (
          <Note tone="info">Tidak ada data {isTrx ? 'transaksi' : 'sell in'} ({scopeText}) pada {fmtRange(range)}.</Note>
        ) : (
          <div className="flex flex-col gap-3.5">
            <Note tone="bad" icon={ICON.trash}>
              <b>{fmt(count)} baris</b> ({fmtTon(Number(preview.ton))} ton, {scopeText}) akan dihapus permanen.
              <div className="text-[12.5px] mt-1 opacity-90">Data yang ada: {fmtRange({ from: String(preview.tanggal_pertama), to: String(preview.tanggal_terakhir) })}.
                {isTrx && ' Ringkasan dashboard dihitung ulang setelahnya.'}</div>
            </Note>
            <div className="control">
              <label htmlFor={`hps-${dataset}`}>Ketik <b className="font-mono text-ink">{WORD}</b> untuk mengonfirmasi</label>
              <input id={`hps-${dataset}`} type="text" autoComplete="off" spellCheck={false} value={confirm} onChange={e => setConfirm(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') void run(); }} className="font-mono !w-[180px]" />
            </div>
            <div>
              <button type="button" className="btn btn-danger" disabled={confirm !== WORD || busy} onClick={run}>
                <Ic d={ICON.trash} />{busy ? 'Menghapus…' : `Hapus ${fmt(count)} baris`}
              </button>
            </div>
            <p className="text-faint text-[12px]">Tidak bisa dibatalkan. Untuk mengembalikan, upload ulang file aslinya.</p>
          </div>
        ))}
      </section>
    </div>
  );
}
