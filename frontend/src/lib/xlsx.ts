// Pustaka xlsx (±400 KB) baru dimuat saat tombol unduh diklik, bukan saat halaman dibuka.
const loadXlsx = () => import('xlsx');
import { xlsxSafeCell } from './format';
import { logActivity } from './api';

/**
 * Export beberapa <table> DOM ke satu .xlsx (1 sheet per tabel). Mengambil isi apa adanya dari
 * thead/tbody/tfoot yang tampil, jadi otomatis mengikuti filter/periode aktif.
 */
export async function exportTablesToExcel(tables: { name: string; el: HTMLTableElement | null | undefined }[], filename: string, pageId?: string | null) {
  // isi tabel dibaca SEKARANG (sebelum menunggu pustaka), supaya sama dengan yang tampil saat diklik
  const sheets = tables.filter(t => t.el).map(({ name, el }) => {
    const aoa: string[][] = [];
    el!.querySelectorAll('thead tr, tbody tr, tfoot tr').forEach(tr => {
      aoa.push([...tr.children].map(td => xlsxSafeCell((td.textContent || '').trim())));
    });
    return { name, aoa };
  });
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, aoa }) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), (name || 'Sheet').slice(0, 31)));
  XLSX.writeFile(wb, filename);
  void logActivity('download', pageId, filename);
}

/**
 * Export data mentah (bukan tabel DOM) ke .xlsx: angka tetap angka (bisa dijumlah/di-pivot),
 * diformat ribuan dengan "-" untuk nol, seperti sheet Excel kantor. null = sel kosong.
 */
export async function exportRowsToExcel(
  sheets: { name: string; header: string[]; rows: (string | number | null)[][]; widths?: number[] }[],
  filename: string, pageId?: string | null,
) {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, header, rows, widths }) => {
    const aoa = [header, ...rows.map(r => r.map(c => (typeof c === 'string' ? xlsxSafeCell(c) : c)))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    Object.keys(ws).forEach(k => {
      const cell = ws[k];
      if (k[0] !== '!' && cell && cell.t === 'n') cell.z = '#,##0;(#,##0);"-"';
    });
    if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
    ws['!cols'] = header.map((h, i) => ({ wch: widths?.[i] ?? Math.max(10, h.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, (name || 'Sheet').slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
  void logActivity('download', pageId, filename);
}
