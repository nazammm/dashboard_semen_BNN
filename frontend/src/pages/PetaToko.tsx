import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import {
  COLORS, MONTHS_ID, dailyFreshness, fmt, fmtIDR, relDate, uniqueTokoStats,
} from '../lib/format';
import type { Row } from '../lib/types';
import { Chip, ErrorBox, PageHeader, PageSkeleton, cx } from '../components/ui';

/* ---------- Konfigurasi basemap ---------- */
// CARTO hanya dipakai kalau key terisi (kebijakan CARTO: tanpa key tile diganti watermark total).
// Kosong -> Esri World Street Map (gratis, tanpa key). Sama dengan config.js lama (CARTO_API_KEY kosong).
const CARTO_API_KEY = '';
const DEFAULT_VIEW = { center: [-1.2, 103.2] as [number, number], zoom: 6 };
const MISSING_LIMIT = 500;

function addBasemap(map: L.Map) {
  if (CARTO_API_KEY) {
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?api_key=${encodeURIComponent(CARTO_API_KEY)}`, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd', maxZoom: 20,
    }).addTo(map);
  } else {
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, USGS, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom',
      maxZoom: 19,
    }).addTo(map);
  }
}

const hasGeo = (t: Row) => {
  const lat = Number(t.latitude), lng = Number(t.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
};
const latlng = (t: Row): [number, number] => [Number(t.latitude), Number(t.longitude)];

/* ---------- Popup (DOM murni, di luar React; semua teks lewat textContent = otomatis ter-escape) ---------- */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, opts: { text?: string; style?: string } = {}, kids: (Node | string)[] = []) {
  const n = document.createElement(tag);
  if (opts.text != null) n.textContent = opts.text;
  if (opts.style) n.style.cssText = opts.style;
  kids.forEach(k => n.append(k));
  return n;
}

function popupGroupEl(rows: Row[], month: number, canView: boolean, navigate: (to: string) => void) {
  const t0 = rows[0];
  const multi = rows.length > 1;
  const root = el('div');
  root.append(el('b', { text: t0.cust_name || 'Tanpa nama' }), el('br'), `Zona: ${t0.zona || '–'}`, el('br'));
  if (multi) {
    root.append(el('span', {
      text: `${rows.length} distributor`,
      style: 'display:inline-block;margin:4px 0;background:#F1EEE5;border:1px solid #C6BFAF;border-radius:4px;padding:1px 6px;font-size:11px;',
    }));
  }
  rows.forEach((t, i) => {
    if (i > 0) root.append(el('hr', { style: 'border:0;border-top:1px solid #DDD6C5;margin:6px 0;' }));
    const name = el('span', { text: t.dist_name || t.dist_code || '', style: 'color:#645E52' });
    root.append(name);
    if (multi) root.append(' ', el('span', { text: `(${t.dist_code})`, style: "font-family:'IBM Plex Mono',monospace;font-size:11px;" }));
    root.append(
      el('br'), 'Status: ',
      el('strong', { text: `${t.is_active ? 'Aktif' : 'Nonaktif'} bulan ini`, style: `color:${t.is_active ? COLORS.green : COLORS.red}` }),
      el('br'), `Amount ${MONTHS_ID[month]}: ${fmtIDR(t.net_amount)}`,
      el('br'), `Tonase ${MONTHS_ID[month]}: ${fmt(t.total_qty, 1)} ton`,
      el('br'), `Jumlah DO: ${fmt(t.num_do)}`,
      el('br'), `Transaksi terakhir: ${relDate(t.last_transaction)}`,
      el('br'),
    );
  });
  // Link detail hanya untuk role yang boleh (server tetap menolak kalau dipaksa).
  if (canView) {
    const to = `/toko-detail?code=${encodeURIComponent(t0.cust_code)}&from=peta-toko`;
    const a = document.createElement('a');
    a.href = to;
    a.textContent = 'Lihat detail toko →';
    a.addEventListener('click', e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // biarkan buka tab baru
      e.preventDefault();
      navigate(to);
    });
    root.append(a);
  }
  return root;
}

const RESET_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
  </svg>
);

type Show = 'all' | 'active' | 'inactive';

export default function PetaToko() {
  useDocTitle('Peta Toko');
  const navigate = useNavigate();
  const { canViewDetail } = useAuth();
  const [params] = useSearchParams();
  const focusCode = params.get('focus');

  const load = useAsync(async () => {
    const monthly = await DataSource.monthlyTotals();
    const months2026 = monthly.filter(r => r.year === 2026).map(r => Number(r.month));
    const year = 2026, month = months2026.length ? Math.max(...months2026) : 8;
    const [tokoAll, freshnessData] = await Promise.all([DataSource.tokoMonthly(year, month), DataSource.dataFreshness()]);
    return { year, month, tokoAll, freshness: dailyFreshness(freshnessData) };
  }, []);

  if (load.error) return <ErrorBox error={load.error} />;
  if (!load.data) return <PageSkeleton />;
  return <PetaTokoView data={load.data} focusCode={focusCode} navigate={navigate} canView={canViewDetail('peta-toko')} />;
}

function PetaTokoView({ data, focusCode, navigate, canView }: {
  data: { year: number; month: number; tokoAll: Row[]; freshness: ReturnType<typeof dailyFreshness> };
  focusCode: string | null; navigate: (to: string) => void; canView: boolean;
}) {
  const { month, tokoAll, freshness } = data;
  const [dist, setDist] = useState('all');
  const [show, setShow] = useState<Show>('all');
  const [query, setQuery] = useState(() => {
    if (!focusCode) return '';
    const t = tokoAll.find(x => x.cust_code === focusCode);
    return t && hasGeo(t) ? (t.cust_name || t.cust_code) : '';
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [caption, setCaption] = useState('');

  const mapEl = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const focusDone = useRef(false);
  // popup dibuat di luar React -> selalu pakai navigate/canView terbaru lewat ref
  const navRef = useRef(navigate); navRef.current = navigate;
  const canViewRef = useRef(canView); canViewRef.current = canView;

  const dists = useMemo(() => [...new Set(tokoAll.map(t => t.dist_code as string))].sort(), [tokoAll]);
  const scoped = useMemo(() => (dist === 'all' ? tokoAll : tokoAll.filter(t => t.dist_code === dist)), [tokoAll, dist]);
  // Toko UNIK: toko yang dilayani >1 distributor hanya dihitung sekali
  const us = useMemo(() => uniqueTokoStats(scoped, hasGeo), [scoped]);
  const filtered = useMemo(() => scoped.filter(t => (show === 'active' ? t.is_active : show === 'inactive' ? !t.is_active : true)), [scoped, show]);

  const distsOf = (code: string) => tokoAll.filter(x => x.cust_code === code);
  const openGroupPopup = (code: string, at: [number, number]) => {
    const map = mapRef.current; if (!map) return;
    L.popup().setLatLng(at).setContent(popupGroupEl(distsOf(code), month, canViewRef.current, navRef.current)).openOn(map);
  };

  /* Inisialisasi peta sekali */
  useEffect(() => {
    if (!mapEl.current) return;
    const map = L.map(mapEl.current, { scrollWheelZoom: true, preferCanvas: true, zoomControl: false }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
    // Zoom dipindah ke kanan-bawah supaya tidak bentrok dengan kotak pencarian kiri-atas
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    addBasemap(map);
    mapRef.current = map;
    return () => { focusDone.current = false; map.remove(); mapRef.current = null; layerRef.current = null; markersRef.current = new Map(); };
  }, []);

  /* Gambar marker: satu titik per cust_code, popup per distributor */
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    if (layerRef.current) map.removeLayer(layerRef.current);
    const layer = L.layerGroup();
    const canvas = L.canvas({ padding: 0.5 });
    const list = filtered.filter(hasGeo);
    const groups = new Map<string, Row[]>();
    list.forEach(t => { const g = groups.get(t.cust_code); if (g) g.push(t); else groups.set(t.cust_code, [t]); });
    const markers = new Map<string, L.CircleMarker>();
    groups.forEach((rows, code) => {
      const t = rows[0];
      const anyActive = rows.some(r => r.is_active);
      const m = L.circleMarker(latlng(t), {
        renderer: canvas,
        radius: rows.length > 1 ? 6 : (anyActive ? 4.5 : 3.5), weight: rows.length > 1 ? 2 : 1,
        color: anyActive ? '#2F6B44' : '#8F3823',
        fillColor: anyActive ? COLORS.green : COLORS.red, fillOpacity: 0.8,
      });
      // Popup dibangun saat dibuka (lazy) supaya ribuan marker tidak membangun DOM di muka
      m.bindPopup(() => popupGroupEl(rows, month, canViewRef.current, navRef.current));
      layer.addLayer(m);
      markers.set(code, m);
    });
    map.addLayer(layer);
    layerRef.current = layer; markersRef.current = markers;
    setCaption(`Menampilkan ${fmt(groups.size)} titik toko sesuai filter.`);
    if (dist !== 'all' && list.length) {
      map.fitBounds(L.latLngBounds(list.map(latlng)), { padding: [30, 30], maxZoom: 11 });
    }

    // Datang dari link "Peta": langsung sorot toko itu (sekali saja)
    if (focusCode && !focusDone.current) {
      focusDone.current = true;
      const t = tokoAll.find(x => x.cust_code === focusCode);
      if (t && hasGeo(t)) {
        map.setView(latlng(t), 15);
        markers.get(focusCode)?.openPopup();
      } else {
        setCaption(t ? `Toko ${t.cust_name || focusCode} belum punya titik koordinat, tidak bisa ditampilkan di peta.` : `Toko ${focusCode} tidak ditemukan.`);
      }
    }
  }, [filtered, dist, month, focusCode, tokoAll]);

  /* Tutup modal saat filter berubah (perilaku lama: redraw menutup overlay) */
  useEffect(() => { setShowMissing(false); }, [dist, show]);

  /* Esc menutup modal */
  useEffect(() => {
    if (!showMissing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMissing(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showMissing]);

  /* Klik di luar kotak pencarian menutup hasil */
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!searchBox.current?.contains(e.target as Node)) setSearchOpen(false); };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  /* Pencarian di seluruh data (bukan hanya yang lolos filter), dedupe per cust_code */
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (q.length < 2) return [];
    const seen = new Set<string>();
    return tokoAll
      .filter(t => (t.cust_name || '').toLowerCase().includes(q) || (t.cust_code || '').toLowerCase().includes(q))
      .filter(t => (seen.has(t.cust_code) ? false : (seen.add(t.cust_code), true)))
      .slice(0, 8);
  }, [tokoAll, q]);

  const pickMatch = (t: Row) => {
    const map = mapRef.current; if (!map) return;
    map.setView(latlng(t), 15);
    openGroupPopup(t.cust_code, latlng(t));
    setSearchOpen(false); setQuery(t.cust_name || t.cust_code);
  };

  const missing = us.noGeoRows;
  const activePct = us.total ? (us.active / us.total * 100).toFixed(1) : '0.0';

  return (
    <div>
      <PageHeader title="Peta Toko" desc={`Sebaran Geografis · ${MONTHS_ID[month]} ${data.year} (MTD)`} status={freshness.status} statusVariant={freshness.statusVariant}>
        <div className="controls !mb-0">
          <div className="control">
            <label htmlFor="mDist">Distributor</label>
            <select id="mDist" value={dist} onChange={e => setDist(e.target.value)}>
              <option value="all">Semua Distributor</option>
              {dists.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="control">
            <span id="mShowLabel" className="control-group-label">Tampilkan</span>
            <div className="pill-row" role="group" aria-labelledby="mShowLabel">
              <Chip active={show === 'all'} onClick={() => setShow('all')}>Semua Toko</Chip>
              <Chip active={show === 'active'} onClick={() => setShow('active')}>Aktif Bulan Ini</Chip>
              <Chip active={show === 'inactive'} onClick={() => setShow('inactive')}>Nonaktif Bulan Ini</Chip>
            </div>
          </div>
        </div>
      </PageHeader>

      <div className="grid-kpi">
        <div className="card"><div className="card-title">Total Toko{dist === 'all' ? ' Terdaftar' : ' · ' + dist}</div><div className="kpi-value">{fmt(us.total)}</div></div>
        <div className="card"><div className="card-title">Aktif Bulan Ini</div><div className="kpi-value">{fmt(us.active)}</div><div className="kpi-delta">{activePct}% dari toko ini</div></div>
        <div className="card"><div className="card-title">Nonaktif Bulan Ini</div><div className="kpi-value">{fmt(us.total - us.active)}</div><div className="kpi-delta">Tidak aktif {MONTHS_ID[month]}</div></div>
        <button type="button" className="card cursor-pointer text-left w-full hover:border-accent" aria-expanded={showMissing} onClick={() => setShowMissing(v => !v)}>
          <div className="card-title">Tanpa Titik Koordinat</div><div className="kpi-value">{fmt(missing.length)}</div><div className="kpi-delta">Klik untuk lihat daftar &darr;</div>
        </button>
      </div>

      <div className="relative mt-4">
        <div ref={searchBox} className="absolute top-3.5 left-3.5 z-[1001] w-[280px] max-w-[calc(100%-28px)]">
          <input
            type="text" value={query} autoComplete="off" placeholder="Cari nama atau kode toko…" aria-label="Cari toko berdasarkan nama atau kode"
            className="w-full box-border bg-surface border border-line-strong rounded-md px-3 py-[9px] text-[13px] shadow-[0_2px_6px_rgba(33,30,25,.12)] focus:outline-none focus:border-accent"
            onChange={e => { setQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
          />
          {searchOpen && q.length >= 2 && (
            <div className="mt-1 bg-surface border border-line-strong rounded-md shadow-[0_4px_14px_rgba(33,30,25,.16)] max-h-[280px] overflow-y-auto">
              {!matches.length ? (
                <div className="px-3 py-2.5 font-mono text-[11.5px] text-faint">Tidak ditemukan.</div>
              ) : matches.map(t => {
                const geo = hasGeo(t);
                return (
                  <button
                    key={t.cust_code} type="button" disabled={!geo} onClick={() => pickMatch(t)}
                    className={cx('flex flex-col gap-px w-full text-left px-3 py-2 border-0 border-b border-line last:border-b-0 bg-surface', geo ? 'cursor-pointer hover:bg-surface2' : 'cursor-default opacity-55')}
                  >
                    <span className="text-[12.5px] font-semibold text-ink">{t.cust_name || t.cust_code}</span>
                    <span className="font-mono text-[10.5px] text-faint">{distsOf(t.cust_code).map(x => x.dist_code).join(', ')}{geo ? '' : ' · tanpa koordinat'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="absolute bottom-3.5 left-3.5 z-[1001] bg-surface border border-line-strong rounded-md px-3 py-2 flex gap-3.5 text-[11.5px] text-soft shadow-[0_2px_6px_rgba(33,30,25,.12)]">
          <span className="inline-flex items-center gap-1.5"><i className="w-[9px] h-[9px] rounded-full inline-block" style={{ background: COLORS.green }} aria-hidden="true" />Aktif bulan ini</span>
          <span className="inline-flex items-center gap-1.5"><i className="w-[9px] h-[9px] rounded-full inline-block" style={{ background: COLORS.red }} aria-hidden="true" />Nonaktif bulan ini</span>
        </div>
        <button
          type="button" title="Kembalikan tampilan peta" aria-label="Kembalikan tampilan peta"
          className="absolute top-3.5 right-3.5 z-[1001] w-[34px] h-[34px] bg-surface border border-line-strong rounded-md shadow-[0_2px_6px_rgba(33,30,25,.12)] flex items-center justify-center cursor-pointer text-soft hover:text-accent-ink hover:border-accent [&_svg]:w-4 [&_svg]:h-4"
          onClick={() => mapRef.current?.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom)}
        >{RESET_ICON}</button>
        <div ref={mapEl} role="img" aria-label="Peta sebaran lokasi toko" className="h-[320px] min-[481px]:h-[400px] min-[881px]:h-[560px] rounded-lg border border-line" />
      </div>
      <div className="font-mono text-[11px] text-faint mt-2">{caption}</div>

      {showMissing && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-[clamp(8px,4vw,24px)]" style={{ background: 'rgba(20,18,14,0.55)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowMissing(false); }}
        >
          <div role="dialog" aria-modal="true" aria-label="Toko Tanpa Titik Koordinat" className="bg-white text-[#211E19] w-full max-w-[780px] max-h-[88vh] flex flex-col rounded-[10px] shadow-[0_12px_40px_rgba(0,0,0,0.35)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E4E0D4] flex items-center justify-between shrink-0">
              <div>
                <div className="font-bold text-[15px]">Toko Tanpa Titik Koordinat</div>
                <div className="font-mono text-[11px] text-[#8A8375] mt-0.5">
                  {fmt(missing.length)} toko{dist === 'all' ? '' : ' · ' + dist}{missing.length > MISSING_LIMIT ? ` · menampilkan ${MISSING_LIMIT} pertama` : ''}
                </div>
              </div>
              <button type="button" autoFocus onClick={() => setShowMissing(false)} className="bg-[#211E19] text-white border-0 rounded-md px-3.5 py-[7px] text-[13px] cursor-pointer shrink-0">Tutup</button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full border-collapse text-[13px] min-w-[560px]">
                <thead>
                  <tr className="bg-[#F8F6F0] text-[#645E52] text-[11px] uppercase tracking-[.04em]">
                    <th className="text-left px-3.5 py-[9px] border-b border-[#C6BFAF]">Toko</th>
                    <th className="text-left px-3.5 py-[9px] border-b border-[#C6BFAF]">Distributor</th>
                    <th className="text-left px-3.5 py-[9px] border-b border-[#C6BFAF]">Zona</th>
                    <th className="text-right px-3.5 py-[9px] border-b border-[#C6BFAF]">Transaksi Terakhir</th>
                  </tr>
                </thead>
                <tbody>
                  {missing.length === 0 ? (
                    <tr><td colSpan={4} className="text-center text-[#8A8375] p-6">Semua toko sudah punya titik koordinat.</td></tr>
                  ) : missing.slice(0, MISSING_LIMIT).map(t => (
                    <tr key={t.cust_code + '|' + t.dist_code}>
                      <td className="px-3.5 py-[9px] border-b border-[#E4E0D4]">{t.cust_name || t.cust_code}<br /><span className="font-mono text-[11px] text-[#8A8375]">{t.cust_code}</span></td>
                      <td className="px-3.5 py-[9px] border-b border-[#E4E0D4]"><span className="bg-[#F1EEE5] border border-[#C6BFAF] rounded px-1.5 py-px font-mono text-[11px]">{t.dist_code}</span> {t.dist_name || ''}</td>
                      <td className="px-3.5 py-[9px] border-b border-[#E4E0D4]">{t.zona || '–'}</td>
                      <td className="px-3.5 py-[9px] border-b border-[#E4E0D4] text-right font-mono">{relDate(t.last_transaction)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
