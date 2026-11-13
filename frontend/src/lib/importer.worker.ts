/// <reference lib="webworker" />
// Membaca file impor (Sell In BNN / Outstanding DO / Transaksi / J073 / Target) di thread terpisah supaya halaman tetap responsif.
import { SellinCollector, parseTextWith, parseXlsxWith, type DateOrder, type RowCollector, type SellinParseResult } from './sellin';
import { TransaksiCollector, type TrxParseResult } from './transaksiImport';
import { J073Collector, type J073ParseResult } from './j073Import';
import { TargetCollector, type TargetParseResult } from './targetImport';
import { PoCollector, type PoParseResult } from './outstandingImport';
import { gabungJ028, isRawJ028, type DistMaster } from './j028Raw';

export type Dataset = 'sellin' | 'transaksi' | 'j073' | 'target' | 'outstanding';
export type ImportResult = SellinParseResult | TrxParseResult | J073ParseResult | TargetParseResult | PoParseResult;
/** kind 'files' = beberapa file sekaligus (hanya transaksi: file mentah J028 + J028B). distributor = master untuk mencocokkan kode ERP. */
export type ImportWorkerIn = { dataset: Dataset; dateOrder?: DateOrder | null; distributor?: DistMaster[] }
  & ({ kind: 'file'; file: File } | { kind: 'files'; files: File[] } | { kind: 'text'; text: string });
export type ImportWorkerOut =
  | { type: 'progress'; p: number }
  | { type: 'done'; res: ImportResult }
  | { type: 'error'; message: string };

const post = (m: ImportWorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
const collectorFor = (d: Dataset, o?: DateOrder | null): RowCollector<ImportResult> =>
  d === 'transaksi' ? new TransaksiCollector(o) : d === 'j073' ? new J073Collector(o) : d === 'target' ? new TargetCollector()
    : d === 'outstanding' ? new PoCollector(o) : new SellinCollector(o);

/** Teks CSV: coba UTF-8, kalau banyak karakter rusak berarti file ANSI (Windows-1252). */
async function readCsv(file: File) {
  const buf = await file.arrayBuffer();
  const utf = new TextDecoder('utf-8').decode(buf);
  return (utf.match(/�/g) || []).length > 20 ? new TextDecoder('windows-1252').decode(buf) : utf;
}

self.onmessage = async (e: MessageEvent<ImportWorkerIn>) => {
  try {
    const msg = e.data;
    const col = collectorFor(msg.dataset, msg.dateOrder);
    if (msg.kind === 'text') { post({ type: 'done', res: parseTextWith(msg.text, col) }); return; }
    const files = msg.kind === 'files' ? msg.files : [msg.file];
    const isText = (f: File) => /\.(csv|txt|tsv)$/i.test(f.name);
    // Transaksi: file mentah ERP (J028, J028B) digabung dan dibersihkan otomatis
    if (msg.dataset === 'transaksi' && files.every(isText)) {
      const texts = await Promise.all(files.map(async f => ({ name: f.name, text: await readCsv(f) })));
      if (texts.every(t => isRawJ028(t.text))) { post({ type: 'done', res: gabungJ028(texts, msg.distributor || [], msg.dateOrder) }); return; }
      if (texts.some(t => isRawJ028(t.text))) throw new Error('File mentah ERP (J028, J028B) tidak bisa dicampur dengan file template.');
    }
    if (files.length > 1) throw new Error('Beberapa file sekaligus hanya untuk file mentah ERP: J028 dan J028B. Untuk file lain, pilih satu file.');
    const file = files[0];
    const name = file.name.toLowerCase();
    if (/\.(csv|txt|tsv)$/.test(name)) { post({ type: 'done', res: parseTextWith(await readCsv(file), col) }); return; }
    if (name.endsWith('.xls')) throw new Error('Format .xls lama tidak didukung. Buka di Excel lalu simpan sebagai .xlsx atau .csv.');
    if (typeof DecompressionStream === 'undefined') throw new Error('Browser ini belum bisa membaca .xlsx. Pakai Chrome/Edge versi terbaru, atau unggah sebagai .csv.');
    post({ type: 'done', res: await parseXlsxWith(await file.arrayBuffer(), col, p => post({ type: 'progress', p })) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
