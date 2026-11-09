/* ============================================================================
   Kelola Data · Tabel: edit langsung tabel master kecil (target, salesman, subdist, distributor, ...).
   Daftar tabel & aturan kolom dari database (sementrack.tabel_edit). Perubahan dikumpulkan dulu,
   lalu disimpan sekaligus dalam satu transaksi (gagal satu baris = tidak ada yang tersimpan).
============================================================================ */
import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../../lib/api';
import { fmt, MONTHS_ID } from '../../lib/format';
import { toNumber } from '../../lib/sellin';
import { exportRowsToExcel } from '../../lib/xlsx';
import type { Row } from '../../lib/types';
import { cx } from '../../components/ui';
import { ErrorLine, Note, afterDataChanged, errText } from './shared';

interface Kolom { name: string; label: string; tipe: 'text' | 'int' | 'num'; wajib?: boolean; pilihan?: string[] }
interface Tabel { id: string; grup: string; label: string; keterangan: string | null; pk: string[]; kolom: Kolom[]; filter: string[] }
type Vals = Record<string, string>;
interface Baris { uid: number; orig: Vals | null; vals: Vals; del: boolean }

const PAGE = 100;
let uidSeq = 0;
const asText = (v: unknown) => (v == null ? '' : String(v));
const sameKey = (a: Vals, b: Vals, pk: string[]) => pk.every(k => (a[k] ?? '').trim() === (b[k] ?? '').trim());
const changed = (b: Baris) => !b.orig || Object.keys(b.vals).some(k => (b.vals[k] ?? '').trim() !== (b.orig![k] ?? '').trim());
const sortOpsi = (a: string, b: string) => (/^-?\d+$/.test(a) && /^-?\d+$/.test(b) ? Number(a) - Number(b) : a.localeCompare(b));

export function TabelPanel({ onChanged }: { onChanged: () => void }) {
  const [tabels, setTabels] = useState<Tabel[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [id, setId] = useState<string>('');
  useEffect(() => {
    adminApi<Row[]>('GET', 'admin/tabel')
      .then(r => {
        const t = r.map(x => ({ ...x, kolom: typeof x.kolom === 'string' ? JSON.parse(x.kolom) : x.kolom }) as Tabel);
        setTabels(t); setId(i => i || t[0]?.id || '');
      })
      .catch(e => setErr(errText(e)));
  }, []);
  const [dirty, setDirty] = useState(false);
  const pick = (v: string) => {
    if (v === id) return;
    if (dirty && !window.confirm('Perubahan yang belum disimpan akan hilang. Lanjut?')) return;
    setId(v);
  };
  const tabel = tabels?.find(t => t.id === id) || null;
  const grups = useMemo(() => [...new Set((tabels || []).map(t => t.grup))], [tabels]);

  return (
    <div>
      <ErrorLine error={err} />
      {!tabels && !err && <div className="card text-soft text-[13px]">Memuat…</div>}
      {tabels && (
        <div className="grid grid-cols-[220px_minmax(0,1fr)] max-[960px]:grid-cols-1 gap-5">
          <nav aria-label="Pilih tabel" className="flex flex-col gap-4 max-[960px]:flex-row max-[960px]:flex-wrap max-[960px]:gap-2">
            {grups.map(g => (
              <div key={g} className="max-[960px]:contents">
                <div className="text-[12px] font-medium text-faint px-3 mb-1 max-[960px]:hidden">{g}</div>
                {tabels.filter(t => t.grup === g).map(t => (
                  <button key={t.id} type="button" onClick={() => pick(t.id)} aria-current={t.id === id ? 'page' : undefined}
                    className={cx('block w-full text-left px-3 py-2 rounded-sm text-[13.5px] border-0 cursor-pointer max-[960px]:w-auto max-[960px]:border max-[960px]:border-line',
                      t.id === id ? 'bg-accent-soft text-accent-ink font-semibold' : 'bg-transparent text-soft hover:bg-surface2 hover:text-ink')}>
                    {t.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          {tabel && <Editor key={tabel.id} tabel={tabel} onDirty={setDirty} onSaved={onChanged} />}
        </div>
      )}
    </div>
  );
}

function Editor({ tabel, onDirty, onSaved }: { tabel: Tabel; onDirty: (d: boolean) => void; onSaved: () => void }) {
  const [opsi, setOpsi] = useState<Record<string, string[]> | null>(null);
  const [filter, setFilter] = useState<Vals | null>(null);
  const [rows, setRows] = useState<Baris[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [round, setRound] = useState(0);

  // pilihan filter; tahun default = tahun terbaru
  useEffect(() => {
    adminApi<Record<string, string[]>>('GET', `admin/tabel/${tabel.id}/opsi`).then(o => {
      const sorted = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort(sortOpsi)]));
      setOpsi(sorted);
      const f: Vals = {};
      tabel.filter.forEach(k => { f[k] = k === 'tahun' && sorted.tahun?.length ? sorted.tahun[sorted.tahun.length - 1] : ''; });
      setFilter(f);
    }).catch(e => setLoadErr(errText(e)));
  }, [tabel]);

  useEffect(() => {
    if (!filter) return;
    setRows(null); setLoadErr(null);
    const qs = Object.entries(filter).filter(([, v]) => v).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    adminApi<Row[]>('GET', `admin/tabel/${tabel.id}${qs ? '?' + qs : ''}`)
      .then(r => { setRows(r.map(x => { const v: Vals = {}; tabel.kolom.forEach(c => { v[c.name] = asText(x[c.name]); }); return { uid: ++uidSeq, orig: v, vals: { ...v }, del: false }; })); setPage(0); })
      .catch(e => setLoadErr(errText(e)));
  }, [tabel, filter, round]);

  const stats = useMemo(() => {
    const r = rows || [];
    return { baru: r.filter(b => !b.orig && !b.del).length, ubah: r.filter(b => b.orig && !b.del && changed(b)).length, hapus: r.filter(b => b.orig && b.del).length };
  }, [rows]);
  const dirty = stats.baru + stats.ubah + stats.hapus > 0;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows || []).filter(b => !s || !b.orig || Object.values(b.vals).some(v => v.toLowerCase().includes(s)));
  }, [rows, q]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageRows = shown.slice(page * PAGE, page * PAGE + PAGE);

  const setCell = (uid: number, k: string, v: string) => { setOkMsg(null); setRows(rs => rs!.map(b => (b.uid === uid ? { ...b, vals: { ...b.vals, [k]: v } } : b))); };
  const toggleDel = (uid: number) => { setOkMsg(null); setRows(rs => rs!.flatMap(b => (b.uid !== uid ? [b] : !b.orig ? [] : [{ ...b, del: !b.del }]))); };
  const addRow = () => {
    const v: Vals = {}; tabel.kolom.forEach(c => { v[c.name] = filter?.[c.name] || ''; });
    setOkMsg(null); setQ(''); setPage(0);
    setRows(rs => [{ uid: ++uidSeq, orig: null, vals: v, del: false }, ...(rs || [])]);
  };
  const reset = () => { if (!dirty || window.confirm('Batalkan semua perubahan yang belum disimpan?')) { setRound(r => r + 1); setSaveErr(null); } };
  const changeFilter = (k: string, v: string) => {
    if (dirty && !window.confirm('Perubahan yang belum disimpan akan hilang. Lanjut?')) return;
    setFilter(f => ({ ...f!, [k]: v }));
  };

  /** Cek di browser dulu supaya pesan salahnya jelas; database tetap memeriksa ulang. */
  const validate = (): { upsert: Vals[]; del: Vals[] } | string => {
    const live = rows!.filter(b => !b.del);
    const upsert: Vals[] = [], del: Vals[] = [];
    for (const b of rows!) {
      if (b.del) { if (b.orig) del.push(Object.fromEntries(tabel.pk.map(k => [k, b.orig![k]]))); continue; }
      if (b.orig && !changed(b)) continue;
      const out: Vals = {};
      for (const c of tabel.kolom) {
        const raw = (b.vals[c.name] ?? '').trim();
        const label = `${c.label}${b.orig ? '' : ' (baris baru)'}`;
        if (!raw && (c.wajib || tabel.pk.includes(c.name))) return `"${label}" wajib diisi.`;
        if (raw && c.tipe !== 'text') {
          const n = toNumber(raw);
          if (n == null || (c.tipe === 'int' && !Number.isInteger(n))) return `"${label}" harus ${c.tipe === 'int' ? 'bilangan bulat' : 'angka'} (isi: ${raw}).`;
          out[c.name] = String(n);
        } else out[c.name] = raw;
        if (raw && c.pilihan && !c.pilihan.includes(out[c.name])) return `"${label}" harus salah satu dari ${c.pilihan.join(', ')}.`;
      }
      // kunci diganti: baris lama dihapus, baris baru ditulis
      if (b.orig && !sameKey(b.orig, out, tabel.pk)) del.push(Object.fromEntries(tabel.pk.map(k => [k, b.orig![k]])));
      upsert.push(out);
    }
    const seen = new Set<string>();
    for (const b of live) {
      const k = tabel.pk.map(x => (b.vals[x] ?? '').trim()).join('|');
      if (seen.has(k)) return `Ada dua baris dengan ${tabel.pk.map(x => tabel.kolom.find(c => c.name === x)?.label).join(' + ')} yang sama: ${k.replace(/\|/g, ' · ')}.`;
      seen.add(k);
    }
    return { upsert, del };
  };

  const save = async () => {
    setSaveErr(null); setOkMsg(null);
    const v = validate();
    if (typeof v === 'string') { setSaveErr(v); return; }
    setBusy(true);
    try {
      const r = await adminApi<Row>('POST', `admin/tabel/${tabel.id}`, { upsert: v.upsert, delete: v.del });
      afterDataChanged(); onSaved();
      setOkMsg(`Tersimpan: ${fmt(r.diubah)} diubah, ${fmt(r.ditambah)} ditambah, ${fmt(r.dihapus)} dihapus.`);
      setRound(x => x + 1);
    } catch (e) { setSaveErr('Gagal menyimpan: ' + errText(e) + ' Tidak ada yang berubah.'); }
    finally { setBusy(false); }
  };

  const download = () => exportRowsToExcel([{
    name: tabel.label, header: tabel.kolom.map(c => c.label),
    rows: (rows || []).filter(b => b.orig).map(b => tabel.kolom.map(c => { const v = b.orig![c.name]; return v === '' ? null : c.tipe !== 'text' ? Number(v) : v; })),
  }], `${tabel.label.replace(/\s+/g, '_')}.xlsx`, 'kelola-data');

  const numCls = (c: Kolom) => c.tipe !== 'text';
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-[17px] font-semibold">{tabel.label}</h2>
        {rows && <span className="text-faint text-[12.5px]">{fmt(rows.filter(b => b.orig).length)} baris</span>}
      </div>
      {tabel.keterangan && <p className="text-soft text-[13px] mt-1 max-w-[720px]">{tabel.keterangan}</p>}

      <div className="flex items-end gap-2.5 flex-wrap mt-4 mb-3">
        {tabel.filter.map(k => {
          const c = tabel.kolom.find(x => x.name === k);
          return (
            <div key={k} className="control">
              <label htmlFor={`tf-${k}`}>{c?.label || k}</label>
              <select id={`tf-${k}`} value={filter?.[k] ?? ''} onChange={e => changeFilter(k, e.target.value)} disabled={!filter}>
                <option value="">Semua</option>
                {(opsi?.[k] || []).map(v => <option key={v} value={v}>{k === 'bulan' ? MONTHS_ID[+v] || v : v}</option>)}
              </select>
            </div>
          );
        })}
        <div className="control">
          <label htmlFor="tf-cari">Cari</label>
          <input id="tf-cari" type="search" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} placeholder="Ketik untuk menyaring" className="!min-w-[180px]" />
        </div>
        <div className="ml-auto flex gap-2 flex-wrap max-[640px]:ml-0">
          <button type="button" className="btn" onClick={addRow} disabled={!rows || busy}>Tambah baris</button>
          <button type="button" className="btn" onClick={download} disabled={!rows?.length}>Unduh Excel</button>
        </div>
      </div>

      <ErrorLine error={loadErr || saveErr} />
      {okMsg && <div className="mb-3"><Note tone="info">{okMsg}</Note></div>}

      {dirty && (
        <div className="sticky top-0 max-[880px]:top-14 z-20 mb-3 flex items-center justify-between gap-3 flex-wrap rounded border border-amber/40 bg-[#FFF8EC] px-4 py-2.5">
          <span className="text-[13px]">
            Belum disimpan: {[stats.ubah && `${fmt(stats.ubah)} diubah`, stats.baru && `${fmt(stats.baru)} baris baru`, stats.hapus && `${fmt(stats.hapus)} dihapus`].filter(Boolean).join(', ')}
          </span>
          <span className="flex gap-2">
            <button type="button" className="btn btn-sm" onClick={reset} disabled={busy}>Batalkan</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan perubahan'}</button>
          </span>
        </div>
      )}

      {!rows && !loadErr && <div className="card text-soft text-[13px]">Memuat…</div>}
      {rows && (
        <div className="table-wrap">
          <table className="tbl-dense tbl-edit">
            <caption className="sr-only">{tabel.label}: sel bisa diedit langsung</caption>
            <thead>
              <tr>
                {tabel.kolom.map(c => <th key={c.name} className={cx(numCls(c) && 'num')}>{c.label}{(c.wajib || tabel.pk.includes(c.name)) && <span className="text-red" aria-hidden="true"> *</span>}</th>)}
                <th aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && <tr><td colSpan={tabel.kolom.length + 1} className="!text-center !text-faint !p-5">Tidak ada baris.</td></tr>}
              {pageRows.map(b => (
                <tr key={b.uid} className={cx(!b.orig && 'is-new', b.del && 'is-del')}>
                  {tabel.kolom.map(c => {
                    const v = b.vals[c.name] ?? '';
                    const edited = b.orig ? v.trim() !== (b.orig[c.name] ?? '').trim() : false;
                    const listId = c.tipe === 'text' && opsi?.[c.name]?.length ? `tl-${tabel.id}-${c.name}` : undefined;
                    return (
                      <td key={c.name} className={cx(edited && 'is-edit')}>
                        {c.pilihan
                          ? <select aria-label={c.label} value={v} disabled={b.del} onChange={e => setCell(b.uid, c.name, e.target.value)}>
                              <option value="">–</option>
                              {c.pilihan.map(p => <option key={p} value={p}>{c.name === 'bulan' ? `${p} · ${MONTHS_ID[+p]}` : p}</option>)}
                            </select>
                          : <input aria-label={c.label} value={v} list={listId} disabled={b.del} inputMode={numCls(c) ? 'decimal' : undefined}
                              className={cx(numCls(c) && 'text-right tabular-nums', /nama|name/.test(c.name) && '!min-w-[220px]')} onChange={e => setCell(b.uid, c.name, e.target.value)} />}
                      </td>
                    );
                  })}
                  <td className="text-right whitespace-nowrap">
                    <button type="button" className="btn btn-sm" onClick={() => toggleDel(b.uid)} title={b.del ? 'Batal hapus' : 'Hapus baris'}>{b.del ? 'Batal' : b.orig ? 'Hapus' : 'Buang'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tabel.kolom.filter(c => c.tipe === 'text' && opsi?.[c.name]?.length).map(c => (
            <datalist key={c.name} id={`tl-${tabel.id}-${c.name}`}>{opsi![c.name].map(v => <option key={v} value={v} />)}</datalist>
          ))}
        </div>
      )}
      {rows && pages > 1 && (
        <div className="flex items-center justify-end gap-2 mt-3 text-[13px]">
          <button type="button" className="btn btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Sebelumnya</button>
          <span className="text-soft">Halaman {page + 1} dari {pages} · {fmt(shown.length)} baris</span>
          <button type="button" className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>Berikutnya</button>
        </div>
      )}
      <p className="text-faint text-[12px] mt-3">Klik sel untuk mengubah. Semua perubahan baru tersimpan setelah klik Simpan perubahan, dan tercatat di Riwayat.</p>
    </div>
  );
}
