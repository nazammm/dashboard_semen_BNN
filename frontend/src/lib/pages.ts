// Daftar halaman + ikon menu. Aturan siapa boleh membuka halaman apa ada di SERVER (dikirim saat login).
const ICONS = {
  sellout: '<path d="M4 20h16"/><path d="M6.5 16.5V11M11 16.5V7.5M15.5 16.5v-4M20 16.5V5"/><path d="m4.5 9 4-3.5 4 2.5 6-5"/>',
  beranda: '<path d="M3 11 12 4l9 7"/><path d="M5 10v9h14v-9"/><path d="M10 19v-6h4v6"/>',
  rekap: '<rect x="3.5" y="4" width="17" height="16" rx="1"/><path d="M3.5 9h17"/><path d="M8 4v-1.5M16 4v-1.5"/><path d="M7 13h2M11 13h2M15 13h2M7 16.5h2M11 16.5h2"/>',
  timsales: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17.5" cy="9" r="2.3"/><path d="M15.5 20c.3-2.6 2-4.5 4.3-4.9"/>',
  peta: '<path d="M12 21s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12Z"/><circle cx="12" cy="9" r="2.4"/>',
  interaksi: '<path d="M4 4h16v12H8l-4 4Z"/><path d="M8 9h8M8 12.5h5"/>',
  kelola: '<circle cx="12" cy="8" r="3.2"/><path d="M4.5 20c.6-4 3.5-6.5 7.5-6.5s6.9 2.5 7.5 6.5"/><path d="M18.5 5.5l1.2 1.2M19.7 4.3l-1.2 1.2" stroke-width="1.3"/>',
  sellin: '<rect x="3.5" y="12.5" width="7.5" height="7" rx=".6"/><rect x="13" y="12.5" width="7.5" height="7" rx=".6"/><rect x="8.25" y="4.5" width="7.5" height="7" rx=".6"/><path d="M7.25 12.5v2M16.75 12.5v2M12 4.5v2"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v6.5c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V5.5"/><path d="M4.5 12v6.5c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V12"/>',
  outstanding: '<rect x="3.5" y="5" width="17" height="14" rx="1.2"/><path d="M3.5 9.5h17"/><path d="M12 12.5v3l2 1.2"/>',
  daftar: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01" stroke-width="2.6"/>',
};

export const NAV_GROUPS = [
  { label: '', items: [
    { id: 'overview', label: 'Overview', icon: ICONS.beranda },
  ] },
  { label: 'Sell In', items: [
    { id: 'sell-in-bnn', label: 'Sell In BNN', icon: ICONS.sellin },
    { id: 'outstanding-do', label: 'Outstanding DO', icon: ICONS.outstanding },
  ] },
  { label: 'Sell Out', items: [
    { id: 'beranda', label: 'Penjualan Toko', icon: ICONS.daftar },
    { id: 'sell-out-bnn', label: 'Sell Out BNN', icon: ICONS.sellout },
    { id: 'rekap-harian', label: 'Rekap Harian', icon: ICONS.rekap },
    { id: 'tim-sales', label: 'Tim Sales', icon: ICONS.timsales },
  ] },
  { label: 'Customer', items: [
    { id: 'daftar-toko', label: 'Daftar Toko', icon: ICONS.daftar },
    { id: 'peta-toko', label: 'Peta Toko', icon: ICONS.peta },
  ] },
  { label: 'Administrasi', items: [
    { id: 'interaksi-web', label: 'Interaksi Web', icon: ICONS.interaksi },
    { id: 'kelola-akses', label: 'Kelola Akses', icon: ICONS.kelola },
    { id: 'kelola-data', label: 'Kelola Data', icon: ICONS.database },
  ] },
];

export const PAGE_LABEL: Record<string, string> = {
  ...Object.fromEntries(NAV_GROUPS.flatMap(g => g.items).map(p => [p.id, p.label])),
  'transaksi-detail': 'Detail Transaksi',
  'toko-detail': 'Detail Toko',
};
