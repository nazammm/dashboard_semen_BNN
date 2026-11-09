import { fmt } from '../lib/format';
import { CONTEXT_PATH, DAERAH_SHAPES } from '../lib/petaDaerah';

/* ============================================================================
   Hero Overview: daerah dengan sell out tertinggi "memimpin".
   Latar = potongan peta yang dipusatkan ke daerah pemimpin, jadi tampilannya ikut berganti
   setiap kali pemimpinnya berganti. Kanan: peringkat semua daerah.
============================================================================ */

export interface DaerahRow { key: string; name: string; target: number; cur: number; prev: number }

/** Nama lengkap untuk judul (nama pendek tetap dipakai di peringkat). */
const NAMA_LENGKAP: Record<string, string> = {
  'North Sum': 'Sumatera Utara', 'West Sum': 'Sumatera Barat', 'South Sum': 'Sumatera Selatan', 'Riau Island': 'Kepulauan Riau',
  'West Kal': 'Kalimantan Barat', Babel: 'Bangka Belitung', Riau: 'Riau', Jambi: 'Jambi', Bengkulu: 'Bengkulu', Lampung: 'Lampung',
};
const BG = '#0B3556';
const fmtTon = (t: number) => fmt(t, Math.abs(t) < 10 && t % 1 ? 1 : 0);

/** viewBox yang menaruh daerah pemimpin di ±57% lebar dan memenuhi ±70% tinggi hero (rasio ±2,8 : 1). */
function frameFor(key: string) {
  const sh = DAERAH_SHAPES[key];
  if (!sh) return '0 14 390 252';
  const [x0, y0, x1, y1] = sh.box;
  const bw = Math.max(x1 - x0, 8), bh = Math.max(y1 - y0, 8), ratio = 2.8;
  let h = bh / 0.7, w = h * ratio;
  if (w < bw / 0.24) { w = bw / 0.24; h = w / ratio; }   // lebar daerah maks ±24% hero: tidak tertutup peringkat di kanan
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return `${(cx - w * 0.57).toFixed(1)} ${(cy - h * 0.5).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
}

export function DaerahHero({ rows, P, period, kind }: { rows: DaerahRow[]; P: number; period: string; kind: 'bulan' | 'ytd' }) {
  const ranked = rows.filter(r => r.cur > 0).sort((a, b) => b.cur - a.cur);
  const lead = ranked[0];
  if (!lead) return null;
  const second = ranked[1];
  const cap = lead.target > 0 ? lead.cur / lead.target * 100 : null;
  const g = lead.prev > 0 ? (lead.cur - lead.prev) / lead.prev * 100 : null;
  const max = lead.cur || 1;
  const nama = NAMA_LENGKAP[lead.key] || lead.name;

  return (
    <section className="relative overflow-hidden rounded-[10px] text-white mb-4" style={{ background: BG }} aria-label={`${nama} memimpin sell out ${period}`}>
      {/* latar: potongan peta, daerah pemimpin menyala */}
      <svg key={lead.key} viewBox={frameFor(lead.key)} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full hero-map-in" aria-hidden="true">
        <path d={CONTEXT_PATH} fill="rgba(255,255,255,.035)" />
        {Object.entries(DAERAH_SHAPES).map(([k, sh]) => k === lead.key ? null : (
          <path key={k} d={sh.d} fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.16)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
        ))}
        <path d={DAERAH_SHAPES[lead.key]?.d} fill="#0181D5" stroke="#7CB8E4" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      </svg>
      {/* teks tetap terbaca di atas peta */}
      <div className="absolute inset-0 pointer-events-none max-[880px]:hidden" style={{ background: `linear-gradient(90deg, ${BG} 0%, ${BG} 30%, rgba(11,53,86,.55) 48%, rgba(11,53,86,0) 62%)` }} />
      <div className="absolute inset-0 pointer-events-none hidden max-[880px]:block" style={{ background: 'rgba(11,53,86,.6)' }} />

      <div className="relative grid grid-cols-[minmax(0,1fr)_300px] max-[880px]:grid-cols-1 gap-8 max-[880px]:gap-6 px-8 py-8 max-[880px]:px-5 max-[880px]:py-6">
        <div className="min-w-0 self-center">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium" style={{ background: 'rgba(255,255,255,.1)', color: '#CFE3F4' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#C8035F' }} aria-hidden="true" />
            Sell out tertinggi · {period}
          </span>
          <h2 className="mt-4 font-semibold leading-[1.02] tracking-[-.02em]" style={{ fontSize: 'clamp(30px,4.2vw,50px)', color: '#fff' }}>
            {nama}<br /><span style={{ color: '#9CCBEE' }}>memimpin {kind === 'bulan' ? 'bulan ini' : 'tahun ini'}.</span>
          </h2>
          <p className="mt-4 max-w-[520px] text-[14.5px] leading-relaxed" style={{ color: '#C4D6E6' }}>
            Sell out {lead.name} <b className="text-white font-semibold">{fmtTon(lead.cur)} ton</b>
            {cap != null && <>, {fmt(cap, 1)}% dari target {fmtTon(lead.target)} ton</>}
            {g != null && <>, {g >= 0 ? 'naik' : 'turun'} {fmt(Math.abs(g), 1)}% dari {P} di tanggal yang sama</>}.
            {second && <> Unggul {fmtTon(lead.cur - second.cur)} ton dari {second.name}.</>}
          </p>
        </div>

        <aside className="rounded-[8px] px-4 py-3.5 border self-center" style={{ background: 'rgba(5,26,44,.62)', borderColor: 'rgba(255,255,255,.12)', backdropFilter: 'blur(6px)' }}
          aria-label={`Peringkat sell out per daerah ${period}`}>
          <div className="text-[12px] mb-2" style={{ color: '#9DB5CA' }}>Peringkat sell out · {period}</div>
          <ol className="list-none m-0 p-0 flex flex-col gap-[7px]">
            {ranked.map((r, i) => {
              const c = r.target > 0 ? r.cur / r.target * 100 : null;
              return (
                <li key={r.key} className="grid grid-cols-[16px_minmax(0,1fr)_auto_40px] items-center gap-x-2.5">
                  <span className="text-[12px] text-right tabular-nums font-semibold" style={{ color: i === 0 ? '#9CCBEE' : '#6F8AA2' }}>{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] truncate" style={{ color: i === 0 ? '#fff' : '#D5E2EE', fontWeight: i === 0 ? 600 : 500 }}>{r.name}</span>
                    <span className="block h-[3px] mt-[3px] rounded-full" style={{ background: 'rgba(255,255,255,.1)' }}>
                      <span className="block h-full rounded-full" style={{ width: `${r.cur / max * 100}%`, background: i === 0 ? '#0181D5' : 'rgba(156,203,238,.55)' }} />
                    </span>
                  </span>
                  <span className="text-[12.5px] tabular-nums text-right whitespace-nowrap" style={{ color: '#E6EEF5' }}>{fmtTon(r.cur)}</span>
                  <span className="text-[11.5px] tabular-nums text-right" style={{ color: '#9DB5CA' }} title="Capaian target">{c == null ? '–' : `${fmt(c, 0)}%`}</span>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </section>
  );
}
