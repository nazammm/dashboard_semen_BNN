/// <reference lib="webworker" />
// Membaca file Sell In di thread terpisah supaya halaman tetap responsif selama file besar diproses.
import { parseSellinText, parseSellinXlsx, type SellinParseResult } from './sellin';

export type SellinWorkerIn = { kind: 'file'; file: File } | { kind: 'text'; text: string };
export type SellinWorkerOut =
  | { type: 'progress'; p: number }
  | { type: 'done'; res: SellinParseResult }
  | { type: 'error'; message: string };

const post = (m: SellinWorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

/** Teks CSV: coba UTF-8, kalau banyak karakter rusak berarti file ANSI (Windows-1252). */
async function readCsv(file: File) {
  const buf = await file.arrayBuffer();
  const utf = new TextDecoder('utf-8').decode(buf);
  const broken = (utf.match(/�/g) || []).length;
  return broken > 20 ? new TextDecoder('windows-1252').decode(buf) : utf;
}

self.onmessage = async (e: MessageEvent<SellinWorkerIn>) => {
  try {
    const msg = e.data;
    if (msg.kind === 'text') { post({ type: 'done', res: parseSellinText(msg.text) }); return; }
    const name = msg.file.name.toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
      post({ type: 'done', res: parseSellinText(await readCsv(msg.file)) });
      return;
    }
    if (name.endsWith('.xls')) throw new Error('Format .xls lama tidak didukung. Buka di Excel lalu simpan sebagai .xlsx atau .csv.');
    if (typeof DecompressionStream === 'undefined') throw new Error('Browser ini belum bisa membaca .xlsx. Pakai Chrome/Edge versi terbaru, atau unggah sebagai .csv.');
    const res = await parseSellinXlsx(await msg.file.arrayBuffer(), p => post({ type: 'progress', p }));
    post({ type: 'done', res });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
