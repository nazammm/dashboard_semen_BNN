# Konvensi port halaman (JS vanilla -> React + TypeScript + Tailwind)

Sumber lama (JANGAN diubah): `../deploy/pkg4/frontend/js/pages/*.js`, `js/utils.js`, `js/data.js`, `css/style.css`.
Hasil: `src/pages/<Nama>.tsx` (export default, tanpa props). Port 1:1 FITUR dan PERILAKU, bukan sekadar tampilan:
semua filter, urutan, KPI, grafik, tabel, drill-down link, export Excel, aturan akses, teks (bahasa Indonesia), angka/format.

## Yang sudah ada (pakai, jangan tulis ulang)
- `src/lib/api.ts` apiGet/apiGetAll/apiRpc/adminApi/logActivity · `src/lib/data.ts` `DataSource.*`, `periodSummary`, `topCustomers`,
  `dailyMatrix`, `deliveryTypeBreakdown`, `channelBreakdown`, `paymentBreakdown`, `getData` (cache)
- `src/lib/format.ts` fmt, fmtIDR, fmtIDRCompact, fmtCompact, pct, capaianClass, relDate, MONTHS_ID, ROLE_LABEL, dailyFreshness,
  monthlyFreshness, formatSyncWhen, uniqueTokoStats, weekBucketsForMonth, isWorkingDay, COLORS, PALETTE, chartSRSummary, isOnlineTransaction
- `src/lib/auth.tsx` `useAuth()` -> session {role, dist_code, name, username}, pageAllowed(id), canViewDetail(id), canDownload(id)
- `src/lib/chart.ts` `useChart(build, deps)`, `donutPercentPlugins`; `src/lib/hooks.ts` `useAsync`, `useSort`, `useDocTitle`, `useDebounced`
- `src/lib/xlsx.ts` exportTablesToExcel · `src/components/ui.tsx`: PageHeader, Badge, Card, Kpi, Capaian, CapaianAvg, PaymentBadge,
  OnlineBadge, PageSkeleton, Loading, ErrorBox, EmptyBox, Control, Select, Chip, Th, TableWrap, CellLink, ChartBox, FileIcon,
  ExportButton, Breadcrumb, BackLink, cx
- Kelas Tailwind komponen (src/index.css): `card`, `card-title`, `kpi-value`, `grid-kpi`, `badge good|warn|bad|neutral|online`,
  `capaian`, `chip`, `btn`, `btn-primary`, `controls`, `control`, `table-wrap`, `tbl-dense`, `tag-code`, `cell-link`, `section-title`,
  `chart-box`, `legend`, `error-box`, `empty-box`, `divider`. Warna token Tailwind: bg, surface, surface2, ink, soft, faint, line,
  line-strong, accent, accent-ink, accent-soft, blue, blue-mid, blue-soft, green(-soft), red(-soft), amber(-soft). Font: font-disp/mono/sans.
- Router: react-router v6. Link internal pakai `<Link to="/toko-detail?code=X">` (JANGAN `<a href>`), params via `useSearchParams`.
  Halaman lain: beranda, performa-daerah, delivery, rekap-harian, tim-sales, peta-toko, daftar-toko, transaksi-detail, toko-detail, interaksi-web, kelola-akses.

## Aturan
1. TypeScript strict, tanpa `any` berlebihan (pakai `Row` dari lib/types untuk baris database; `any` OK untuk objek Chart.js/Leaflet yang rumit).
2. Data: `useAsync(() => ..., [deps])`; tampilkan `<PageSkeleton/>` saat loading (state awal) dan `<ErrorBox error=.../>` saat gagal.
   Nilai numerik dari API bisa berupa number ATAU string -> selalu bungkus `Number(...)` seperti kode lama.
3. Jangan pakai `dangerouslySetInnerHTML` untuk data (React sudah meng-escape). Kecuali SVG statis milik sendiri.
4. Grafik: `<ChartBox build={() => config|null} deps={[...]} />` (Chart.js). Peta: Leaflet langsung di useEffect (cleanup `map.remove()`), CSS sudah di-import global.
5. Export Excel: `<ExportButton pageId="..." filename=... getTables={() => [{name, el: tableRef.current}]} />` (otomatis hormati canDownload).
   Hormati `canViewDetail(pageId)` untuk tombol/link detail seperti kode lama.
6. Role/akses: sama persis dengan kode lama (dist_code, session.role). Server tetap penegak aturan.
7. Jangan mengubah file di src/lib, src/components/ui.tsx, Layout, App — kalau perlu tambahan helper, taruh LOKAL di file halaman
   (atau file baru `src/lib/<nama>.ts` / `src/components/<Nama>.tsx` yang belum ada). Kalau terpaksa ubah file bersama, ubah minimal & aditif.
8. Verifikasi: `cd /tmp/claude-0/-home-claude/2b02a9ab-301a-5eca-a0f3-d82b6ae73608/scratchpad/web && npx tsc --noEmit` HARUS bersih untuk file kamu
   (error di file halaman agen lain boleh diabaikan), lalu `npx vite build` harus lolos.
9. Bagian halaman yang tidak bisa diport penuh: JANGAN dibuang diam-diam — catat di daftar "BELUM/BEDA" pada laporan akhir.
