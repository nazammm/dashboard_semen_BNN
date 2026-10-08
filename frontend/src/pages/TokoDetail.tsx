import { Link, useSearchParams } from 'react-router-dom';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { COLORS, MONTHS_ID, chartSRSummary, fmt, fmtCompact, fmtIDR, relDate } from '../lib/format';
import { Badge, Card, ChartBox, ErrorBox, Kpi, OnlineBadge, PageHeader, PageSkeleton, PaymentBadge, TableWrap } from '../components/ui';

// Tombol "Kembali" mengikuti ?from= (Link biasa, bukan history.back()).
const FROM_LABEL: Record<string, string> = {
  'beranda': 'Overview', 'peta-toko': 'Peta Toko', 'daftar-toko': 'Daftar Toko',
  'transaksi-detail': 'Detail Transaksi', 'tim-sales': 'Tim Sales',
};
const YEAR = 2026;

export default function TokoDetail() {
  useDocTitle('Detail Toko');
  const [params] = useSearchParams();
  const code = params.get('code');
  const from = params.get('from');
  const fromLabel = from && FROM_LABEL[from] ? FROM_LABEL[from] : null;
  const back = fromLabel ? <Link to={`/${from}`} className="btn">← Kembali ke {fromLabel}</Link> : null;

  if (!code) {
    return (
      <div>
        <PageHeader title="Parameter tidak lengkap" />
        <div className="error-box" role="alert">Halaman ini hanya bisa diakses lewat klik dari halaman lain (Overview, Peta Toko, atau Daftar Toko).</div>
        {back && <div className="mt-3.5">{back}</div>}
      </div>
    );
  }
  return <TokoBody key={code} code={code} back={back} />;
}

function TokoBody({ code, back }: { code: string; back: React.ReactNode }) {
  const { data, error } = useAsync(async () => {
    const [info, monthly, recentTx] = await Promise.all([
      DataSource.storeInfo(code), DataSource.storeYear(code, YEAR), DataSource.storeRecentTx(code, 50),
    ]);
    return { info, monthly, recentTx };
  }, [code]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <PageSkeleton />;
  const { info, monthly, recentTx } = data;

  if (!info) {
    return (
      <div>
        <PageHeader title="Toko tidak ditemukan" />
        <div className="error-box" role="alert">Kode toko {code} tidak ditemukan.</div>
        {back && <div className="mt-3.5">{back}</div>}
      </div>
    );
  }

  const lat = Number(info.latitude), lng = Number(info.longitude);
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
  const months = monthly.map(m => Number(m.month));
  const curMonth = months.length ? Math.max(...months) : null;
  const curRow = monthly.find(m => Number(m.month) === curMonth);
  const totalNetYear = monthly.reduce((a, m) => a + Number(m.net_amount || 0), 0);
  const totalTonaseYear = monthly.reduce((a, m) => a + Number(m.total_qty || 0), 0);
  const activeMonthsCount = monthly.filter(m => m.is_active).length;
  const lastTx = recentTx.length ? recentTx[0].do_date : null;

  const labels = monthly.map(m => MONTHS_ID[Number(m.month)]);
  const amounts = monthly.map(m => Number(m.net_amount || 0));
  const tonases = monthly.map(m => Number(m.total_qty || 0));
  const name = info.cust_name || info.cust_code;

  return (
    <div>
      <PageHeader title={name} />
      <div className="mb-[18px] flex gap-2.5 flex-wrap">
        {back}
        {hasGeo && <Link to={`/peta-toko?focus=${encodeURIComponent(info.cust_code)}`} className="btn">Lihat di Peta</Link>}
      </div>

      <div className="grid-kpi">
        <Kpi title={`Status ${curMonth ? MONTHS_ID[curMonth] + ' ' + YEAR : 'Bulan Ini'}`}
          value={curRow && curRow.is_active ? <Badge variant="good">Aktif</Badge> : <Badge variant="bad">Nonaktif</Badge>}
          delta="Ambang batas Rp200.000/bulan" />
        <Kpi title={`Amount ${YEAR}`} value={<span className="text-[22px]">{fmtIDR(totalNetYear)}</span>} delta="Akumulasi tahun berjalan" />
        <Kpi title={`Tonase ${YEAR}`} value={fmt(totalTonaseYear, 2)} unit="ton" />
        <Kpi title="Bulan Aktif" value={fmt(activeMonthsCount)} unit={`/ ${fmt(months.length)}`} delta={`Transaksi terakhir: ${relDate(lastTx)}`} />
      </div>

      <h2 className="section-title !mt-[30px]">Tren Bulanan · {YEAR}</h2>
      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-4">
        <Card>
          <h2 className="card-title">Amount per Bulan</h2>
          <ChartBox label={chartSRSummary(labels, amounts, 'rupiah')} deps={[monthly]} build={() => ({
            type: 'bar',
            data: { labels, datasets: [{ data: amounts, backgroundColor: monthly.map(m => (m.is_active ? COLORS.accent : '#C6BFAF')), maxBarThickness: 26 }] },
            options: {
              responsive: true, maintainAspectRatio: false,
              scales: { y: { grid: { color: COLORS.line }, ticks: { callback: (v: any) => fmtCompact(v) } }, x: { grid: { display: false } } },
              plugins: { tooltip: { callbacks: { label: (c: any) => ` ${fmtIDR(c.parsed.y)}` } } },
            },
          } as any)} />
        </Card>
        <Card>
          <h2 className="card-title">Tonase per Bulan</h2>
          <ChartBox label={chartSRSummary(labels, tonases, 'ton')} deps={[monthly]} build={() => ({
            type: 'bar',
            data: { labels, datasets: [{ data: tonases, backgroundColor: COLORS.blueMid, maxBarThickness: 26 }] },
            options: {
              responsive: true, maintainAspectRatio: false,
              scales: { y: { grid: { color: COLORS.line } }, x: { grid: { display: false } } },
              plugins: { tooltip: { callbacks: { label: (c: any) => ` ${fmt(c.parsed.y, 2)} ton` } } },
            },
          } as any)} />
        </Card>
      </div>

      <h2 className="section-title !mt-[30px]">Transaksi Terbaru</h2>
      <p className="text-soft text-[14.5px] max-w-[640px] -mt-1.5 mb-3.5">Menampilkan hingga 50 transaksi terakhir toko ini.</p>
      <TableWrap>
        <table>
          <caption className="sr-only">Transaksi terbaru {name}</caption>
          <thead><tr>
            <th>Tanggal</th><th>Distributor</th><th>Produk</th><th>Sales</th>
            <th className="num">Qty (zak)</th><th className="num">Tonase</th><th className="num">Amount</th><th>No DO</th><th>Pembayaran</th>
          </tr></thead>
          <tbody>
            {recentTx.length === 0
              ? <tr><td colSpan={9} className="!text-center text-faint !p-6">Belum ada transaksi tercatat untuk toko ini.</td></tr>
              : recentTx.map((r, i) => (
                <tr key={`${r.do_no}-${r.product_code}-${i}`}>
                  <td className="font-mono">{r.do_date}</td>
                  <td><span className="tag-code">{r.dist_code}</span> {r.distributor_name || ''}</td>
                  <td>{r.product_name || r.product_code}</td>
                  <td>{r.salesman_name || r.salesman_code || '–'}</td>
                  <td className="num font-mono">{fmt(r.order_qty)}</td>
                  <td className="num font-mono">{fmt(r.tonase, 2)}</td>
                  <td className="num font-mono">{fmtIDR(r.net_amount)}</td>
                  <td className="font-mono">{r.do_no || '–'} <OnlineBadge mssNoOrder={r.mss_no_order} /></td>
                  <td><PaymentBadge payment={r.payment} /></td>
                </tr>
              ))}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}
