import * as XLSX from 'xlsx';
import { xlsxSafeCell } from './format';
import { logActivity } from './api';

/**
 * Export beberapa <table> DOM ke satu .xlsx (1 sheet per tabel). Mengambil isi apa adanya dari
 * thead/tbody/tfoot yang tampil, jadi otomatis mengikuti filter/periode aktif.
 */
export function exportTablesToExcel(tables: { name: string; el: HTMLTableElement | null | undefined }[], filename: string, pageId?: string | null) {
  const wb = XLSX.utils.book_new();
  tables.forEach(({ name, el }) => {
    if (!el) return;
    const aoa: string[][] = [];
    el.querySelectorAll('thead tr, tbody tr, tfoot tr').forEach(tr => {
      aoa.push([...tr.children].map(td => xlsxSafeCell((td.textContent || '').trim())));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), (name || 'Sheet').slice(0, 31));
  });
  XLSX.writeFile(wb, filename);
  void logActivity('download', pageId, filename);
}
