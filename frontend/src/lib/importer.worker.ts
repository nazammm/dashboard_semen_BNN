/// <reference lib="webworker" />
// Membaca file impor (Sell In BNN / Transaksi) di thread terpisah supaya halaman tetap responsif.
import { SellinCollector, parseTextWith, parseXlsxWith, type DateOrder, type RowCollector, type SellinParseResult } from './sellin';
import { TransaksiCollector, type TrxParseResult } from './transaksiImport';

export type Dataset = 'sellin' | 'transaksi';
export type ImportResult = SellinParseResult | TrxParseResult;
export type ImportWorkerIn = { dataset: Dataset; dateOrder?: DateOrder | null } & ({ kind: 'file'; file: File } | { kind: 'text'; text: string });
export type ImportWorkerOut =
  | { type: 'progress'; p: number }
  | { type: 'done'; res: ImportResult }
  | { type: 'error'; message: string };

const post = (m: ImportWorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
const collectorFor = (d: Dataset, o?: DateOrder | null): RowCollector<ImportResult> => (d === 'transaksi' ? new TransaksiCollector(o) : new SellinCollector(o));

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
    const name = msg.file.name.toLowerCase();
    if (/\.(csv|txt|tsv)$/.test(name)) { post({ type: 'done', res: parseTextWith(await readCsv(msg.file), col) }); return; }
    if (name.endsWith('.xls')) throw new Error('Format .xls lama tidak didukung. Buka di Excel lalu simpan sebagai .xlsx atau .csv.');
    if (typeof DecompressionStream === 'undefined') throw new Error('Browser ini belum bisa membaca .xlsx. Pakai Chrome/Edge versi terbaru, atau unggah sebagai .csv.');
    post({ type: 'done', res: await parseXlsxWith(await msg.file.arrayBuffer(), col, p => post({ type: 'progress', p })) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
