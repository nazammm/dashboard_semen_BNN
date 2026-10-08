// Daftar halaman + ikon menu. Aturan siapa boleh membuka halaman apa ada di SERVER (dikirim saat login).
const ICONS = {
  beranda: '<path d="M3 11 12 4l9 7"/><path d="M5 10v9h14v-9"/><path d="M10 19v-6h4v6"/>',
  performa: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  rekap: '<rect x="3.5" y="4" width="17" height="16" rx="1"/><path d="M3.5 9h17"/><path d="M8 4v-1.5M16 4v-1.5"/><path d="M7 13h2M11 13h2M15 13h2M7 16.5h2M11 16.5h2"/>',
  timsales: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17.5" cy="9" r="2.3"/><path d="M15.5 20c.3-2.6 2-4.5 4.3-4.9"/>',
  peta: '<path d="M12 21s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12Z"/><circle cx="12" cy="9" r="2.4"/>',
  delivery: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18.5" r="1.6"/><circle cx="17.5" cy="18.5" r="1.6"/>',
  interaksi: '<path d="M4 4h16v12H8l-4 4Z"/><path d="M8 9h8M8 12.5h5"/>',
  kelola: '<circle cx="12" cy="8" r="3.2"/><path d="M4.5 20c.6-4 3.5-6.5 7.5-6.5s6.9 2.5 7.5 6.5"/><path d="M18.5 5.5l1.2 1.2M19.7 4.3l-1.2 1.2" stroke-width="1.3"/>',
  daftar: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01" stroke-width="2.6"/>',
};

export const NAV_GROUPS = [
  { label: 'Harian', items: [
    { id: 'beranda', label: 'Overview', icon: ICONS.beranda },
    { id: 'rekap-harian', label: 'Rekap Harian', icon: ICONS.rekap },
    { id: 'tim-sales', label: 'Tim Sales', icon: ICONS.timsales },
  ] },
  { label: 'Performa Bulanan', items: [
    { id: 'performa-daerah', label: 'Penjualan Daerah', icon: ICONS.performa },
    { id: 'delivery', label: 'Delivery', icon: ICONS.delivery },
  ] },
  { label: 'Customer', items: [
    { id: 'daftar-toko', label: 'Daftar Toko', icon: ICONS.daftar },
    { id: 'peta-toko', label: 'Peta Toko', icon: ICONS.peta },
  ] },
  { label: 'Administrasi', items: [
    { id: 'interaksi-web', label: 'Interaksi Web', icon: ICONS.interaksi },
    { id: 'kelola-akses', label: 'Kelola Akses', icon: ICONS.kelola },
  ] },
];

export const PAGE_LABEL: Record<string, string> = {
  ...Object.fromEntries(NAV_GROUPS.flatMap(g => g.items).map(p => [p.id, p.label])),
  'transaksi-detail': 'Detail Transaksi',
  'toko-detail': 'Detail Toko',
};
