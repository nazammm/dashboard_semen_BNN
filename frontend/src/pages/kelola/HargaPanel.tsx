/* ============================================================================
   Kelola Data · Sell In BNN · Harga ERP.
   File CSV dari Nazam Auto Task (bagian Harga ERP): baris tabel harga ERP Price & Promo Simulation per distributor x produk
   x tipe kirim x zona x masa berlaku. LOCO GUDANG = harga Loco (nilai Outstanding DO): untuk tiap distributor x produk di file,
   masa berlaku sejak tanggal paling awal di file diganti. Tipe lain = tarif kirim per zona (Ongkos Kirim): disisipkan / diperbarui per baris.
============================================================================ */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../lib/api';
import { DataSource, forgetData } from '../../lib/data';
import { fmt, fmtIDR } from '../../lib/format';
import { fmtDate } from '../../lib/dates';
import { useAsync } from '../../lib/hooks';
import type { HargaParseResult } from '../../lib/hargaImport';
import type { Row } from '../../lib/types';
import { DoneCard, ErrorLine, InvalidRows, Note, PreviewFrame, SourcePicker, Steps, Unusable, type ImportPhase, useImport } from './shared';

const MAX_JSON = 11e6;
const daftarDist = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String);
  try { const x = JSON.parse(String(v ?? '[]')); return Array.isArray(x) ? x.map(String) : [String(x)]; } catch { return [String(v)]; }
};
const tgl = (v: unknown) => (v ? fmtDate(String(v).slice(0, 10)) : '–');

export function HargaUpload({ onChanged }: { onChanged: () => void }) {
  const imp = useImport<HargaParseResult>('harga');
  const { phase } = imp;
  const [round, setRound] = useState(0);

  const save = async () => {
    if (phase.kind !== 'preview') return;
    const { res, name } = phase;
    const body = { rows: res.rows, file_name: phase.source === 'file' ? name.slice(0, 200) : null };
    if (JSON.stringify(body).length > MAX_JSON) { imp.setError(`Terlalu besar untuk sekali simpan (${fmt(res.rows.length)} baris).`); return; }
    const ok = await imp.saveWith(() => adminApi<Row>('POST', 'admin/data/harga', body));
    if (ok) { forgetData('harga:'); forgetData('po:'); setRound(r => r + 1); onChanged(); }
  };

  return (
    <div>
      <Steps phase={phase.kind} />
      <ErrorLine error={imp.error} />
      <div hidden={phase.kind !== 'idle' && phase.kind !== 'reading'}>
        <SourcePicker key={round} id="harga" reading={phase.kind === 'reading' ? phase : null} onFile={imp.readFile} onFiles={f => imp.readFiles(f)} onText={imp.readText} onCancel={imp.cancelRead}
          accept=".csv,.txt"
          fileHint="File HARGA_LOCO_….csv dari Nazam Auto Task (bagian Harga ERP). Isinya harga Loco dan tarif kirim per zona per PT, per produk, per masa berlaku dari ERP Price & Promo Simulation."
          pastePlaceholder={'dist_code,product_code,product_name,warehouse,delivery_type,price,net_price,effective_date,expired_date,diambil\n1001K,CMT002,PCC@50KG,KTP,LOCO GUDANG,84800,84800,2026-07-03,2026-10-15,2026-11-20'} />
      </div>

      {(phase.kind === 'preview' || phase.kind === 'saving') && (
        phase.res.ok && phase.res.rows.length > 0
          ? <HargaPreview phase={phase} onSave={save} onCancel={imp.reset} />
          : <Unusable error={phase.res.ok ? 'Tidak ada baris harga di file ini.' : phase.res.error} missing={phase.res.missing} onCancel={imp.reset}
              hint="Pakai file harga dari Nazam Auto Task apa adanya." />
      )}

      {phase.kind === 'done' && (
        <DoneCard actions={<><Link to="/outstanding-do" className="btn btn-primary no-underline">Lihat Outstanding DO</Link><button type="button" className="btn" onClick={imp.reset}>Upload lagi</button></>}>
          {fmt(phase.result.rows_saved)} masa berlaku harga untuk {fmt(phase.result.kombinasi)} PT x produk ({daftarDist(phase.result.dist_codes).join(', ') || '–'}),
          {' '}berlaku {tgl(phase.result.date_from)} s.d. {tgl(phase.result.date_to)}.
          {Number(phase.result.rows_deleted) > 0 ? ` Menggantikan ${fmt(phase.result.rows_deleted)} masa berlaku lama.` : ''}
          {Number(phase.result.tarif_kirim) > 0 ? ` Tarif kirim per zona: ${fmt(phase.result.tarif_kirim)} baris disimpan.` : ''}
        </DoneCard>
      )}

      {phase.kind === 'idle' && <HargaTersimpan key={round} />}
    </div>
  );
}

function HargaPreview({ phase, onSave, onCancel }: {
  phase: Extract<ImportPhase<HargaParseResult>, { kind: 'preview' } | { kind: 'saving' }>; onSave: () => void; onCancel: () => void;
}) {
  const st = phase.res.stats;
  return (
    <PreviewFrame phase={phase} title={phase.source === 'tempel' ? 'Data tempelan' : phase.name} onSave={onSave} onCancel={onCancel}
      canSave={phase.res.rows.length > 0} readyText={`${fmt(st.loco)} masa berlaku harga Loco dan ${fmt(st.rowsUsed - st.loco)} baris tarif kirim siap disimpan.`}>
      <div className="px-[22px] pb-5 grid gap-5 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] max-[960px]:grid-cols-1">
        <div>
          <div className="card-title mb-2">Per PT & produk</div>
          <div className="border border-line rounded overflow-x-auto">
            <table className="!min-w-0 tbl-dense">
              <thead><tr><th>PT</th><th>Produk</th><th>Gudang</th><th>Tipe</th><th className="num">Masa berlaku</th><th>Sejak</th><th className="num">Loco Net terakhir</th><th>Berlaku s.d.</th></tr></thead>
              <tbody>
                {st.kombinasi.map(k => (
                  <tr key={k.dist + k.produk + k.gudang}>
                    <td className="font-mono text-[12px]">{k.dist}</td>
                    <td className="text-[12px] whitespace-nowrap">{k.produk} · {k.nama}</td>
                    <td className="text-[12px] whitespace-nowrap">{k.gudang || '–'}</td>
                    <td className="text-[12px]">{k.semen}{k.kg ? ` ${k.kg} kg` : ''}</td>
                    <td className="num font-mono">{fmt(k.masa)}</td>
                    <td className="whitespace-nowrap text-[12px]">{fmtDate(k.dari)}</td>
                    <td className="num font-mono">{fmtIDR(k.hargaTerakhir)}</td>
                    <td className="whitespace-nowrap text-[12px]">{k.sampai ? fmtDate(k.sampai) : 'masih berlaku'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Note tone="warn">
            Untuk tiap PT x produk di file, harga sejak tanggal paling awal di file akan <b>diganti</b>. Harga sebelum tanggal itu dan PT / produk lain tidak berubah.
          </Note>
          <Note tone="info">Harga dipakai di Outstanding DO menurut tanggal order: Loco Net yang berlaku pada tanggal itu x sisa zak. Kode 1001 di OS memakai harga 1001K untuk sub region KTP dan 1001P untuk lainnya.
            PT dengan beberapa gudang (mis. INSA: INSA, Kuala Tanjung, Aceh) memakai gudang yang sesuai tujuan OS.</Note>
          {st.tarif.length > 0 && (
            <div>
              <div className="card-title mb-2">Tarif kirim per zona</div>
              <div className="border border-line rounded overflow-x-auto">
                <table className="!min-w-0 tbl-dense">
                  <thead><tr><th>PT</th><th>Tipe</th><th className="num">Zona</th><th className="num">Ongkir per zak</th></tr></thead>
                  <tbody>
                    {st.tarif.map(t => (
                      <tr key={t.dist + t.tipe}>
                        <td className="font-mono text-[12px]">{t.dist}</td>
                        <td className="text-[12px] whitespace-nowrap">{t.tipe}</td>
                        <td className="num font-mono">{fmt(t.zona)}</td>
                        <td className="num font-mono whitespace-nowrap">{t.ongkirMin === t.ongkirMax ? fmt(t.ongkirMin) : `${fmt(t.ongkirMin)} s.d. ${fmt(t.ongkirMax)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-faint text-[11.5px] mt-1.5">Ongkir = Net Price − (Price − Discount): Transport, Subsidi, dan Handling. Dipakai halaman Ongkos Kirim kalau kolom Delivery di J073 kosong.</p>
            </div>
          )}
          <InvalidRows invalid={st.invalid} issues={st.issues} what="baris dilewati" />
        </div>
      </div>
    </PreviewFrame>
  );
}

/** Harga yang sudah tersimpan per PT x produk. */
function HargaTersimpan() {
  const info = useAsync(() => DataSource.hargaInfo(), []);
  if (info.error) return <p className="text-faint text-[12.5px] mt-4">Tabel harga belum ada di database. Jalankan docs/mssql/18_harga_loco.sql di SSMS dulu.</p>;
  if (!info.data || info.data.length === 0) return null;
  return (
    <section className="card !p-0 overflow-hidden mt-5">
      <div className="card-title px-4 pt-3.5 !mb-2">Harga Loco tersimpan</div>
      <div className="overflow-x-auto border-t border-line">
        <table className="tbl-dense !min-w-0">
          <thead><tr><th>PT</th><th>Produk</th><th>Gudang</th><th className="num">Masa berlaku</th><th>Sejak</th><th className="num">Loco Net terakhir</th><th>Berlaku</th><th>Diambil</th></tr></thead>
          <tbody>
            {info.data.map(r => (
              <tr key={`${r.dist_code}|${r.product_code}|${r.warehouse}`}>
                <td className="font-mono text-[12px]">{String(r.dist_code)}</td>
                <td className="text-[12px] whitespace-nowrap">{String(r.product_code)} · {String(r.product_name ?? '')}</td>
                <td className="text-[12px] whitespace-nowrap">{String(r.warehouse ?? '') || '–'}</td>
                <td className="num font-mono">{fmt(r.masa_berlaku)}</td>
                <td className="whitespace-nowrap text-[12px]">{tgl(r.dari)}</td>
                <td className="num font-mono">{fmtIDR(r.harga_terakhir)}</td>
                <td className="whitespace-nowrap text-[12px]">{tgl(r.berlaku_terakhir)} s.d. {r.sampai_terakhir ? tgl(r.sampai_terakhir) : 'sekarang'}</td>
                <td className="whitespace-nowrap text-[12px]">{tgl(r.diambil)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
