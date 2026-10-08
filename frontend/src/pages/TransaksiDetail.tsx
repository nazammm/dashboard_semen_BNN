import { useMemo, useRef, useState, type Ref } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataSource } from '../lib/data';
import { useAsync, useDocTitle } from '../lib/hooks';
import { COLORS, MONTHS_ID, chartSRSummary, fmt, fmtCompact, fmtIDR, isOnlineTransaction, relDate } from '../lib/format';
import type { Row } from '../lib/types';
import { Badge, Card, Chip, ChartBox, ErrorBox, ExportButton, Kpi, OnlineBadge, PageHeader, PageSkeleton, PaymentBadge, TableWrap } from '../components/ui';

export default function TransaksiDetail() {
  useDocTitle('Detail Transaksi');
  const [params] = useSearchParams();
  const salesman = params.get('salesman');
  const date = params.get('date');
  if (salesman) {
    return <SalesmanMode key={params.toString()} salesman={salesman} year={+(params.get('year') || 2026)} month={+(params.get('month') || 1)} name={params.get('name') || salesman} />;
  }
  if (date) {
    return <DateMode key={params.toString()} date={date} dist={params.get('dist') || 'all'} jenis={params.get('jenis') || 'all'} />;
  }
  return (
    <div>
      <PageHeader title="Parameter tidak lengkap" />
      <div className="error-box" role="alert">Halaman ini hanya bisa diakses lewat klik dari Rekap Harian atau Tim Sales.</div>
    </div>
  );
}

type Channel = 'all' | 'online' | 'offline';

function ChannelFilter({ rows, channel, setChannel }: { rows: Row[]; channel: Channel; setChannel: (c: Channel) => void }) {
  const onlineCount = rows.filter(r => isOnlineTransaction(r.mss_no_order)).length;
  return (
    <div className="flex items-baseline justify-between flex-wrap gap-2.5 mb-3">
      <span className="control-group-label" id="txChannelLabel">Kanal transaksi · {fmt(onlineCount)} online dari {fmt(rows.length)} baris</span>
      <div className="pill-row" role="group" aria-labelledby="txChannelLabel">
        <Chip active={channel === 'all'} onClick={() => setChannel('all')}>Semua</Chip>
        <Chip active={channel === 'online'} onClick={() => setChannel('online')}>Online</Chip>
        <Chip active={channel === 'offline'} onClick={() => setChannel('offline')}>Offline</Chip>
      </div>
    </div>
  );
}

function TxTable({ rows, channel, caption, tableRef }: { rows: Row[]; channel: Channel; caption: string; tableRef?: Ref<HTMLTableElement> }) {
  const filtered = channel === 'all' ? rows : rows.filter(r => (channel === 'online') === isOnlineTransaction(r.mss_no_order));
  return (
    <TableWrap>
      <table ref={tableRef}>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>
          <th>Tanggal</th><th>Distributor</th><th>Toko</th><th>Produk</th><th>Sales</th>
          <th className="num">Qty (zak)</th><th className="num">Tonase</th><th className="num">Amount</th><th>No DO</th><th>Pembayaran</th>
        </tr></thead>
        <tbody>
          {filtered.length === 0
            ? <tr><td colSpan={10} className="!text-center text-faint !p-6">Tidak ada transaksi untuk kombinasi filter ini.</td></tr>
            : filtered.map((r, i) => (
              <tr key={`${r.do_no}-${r.product_code}-${i}`}>
                <td className="font-mono">{r.do_date}</td>
                <td><span className="tag-code">{r.dist_code}</span> {r.distributor_name || ''}</td>
                <td>{r.customer_name || r.customer_code}</td>
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
  );
}

const sum = (rows: Row[], k: string) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
const AmountValue = ({ v }: { v: number }) => <span className="text-[21px]">{fmtIDR(v)}</span>;

/* ---------------- Mode salesman (dari Tim Sales) ---------------- */
function SalesmanMode({ salesman, year, month, name }: { salesman: string; year: number; month: number; name: string }) {
  const { data, error } = useAsync(async () => {
    const [yearRows, perfRows, pegangan] = await Promise.all([
      DataSource.transaksiDetailBySalesmanYear(salesman, year),
      DataSource.salesman(),
      DataSource.tokoPegangan(salesman, month),
    ]);
    return { yearRows, perfRows, pegangan };
  }, []);
  const [view, setView] = useState<'pegangan' | 'transaksi'>('pegangan');
  const [channel, setChannel] = useState<Channel>('all');
  const pRef = useRef<HTMLTableElement>(null);
  const tRef = useRef<HTMLTableElement>(null);

  const calc = useMemo(() => {
    if (!data) return null;
    const rows = data.yearRows.filter(r => {
      const d = new Date(r.do_date + 'T00:00:00');
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    });
    // Transaksi terakhir per toko (sepanjang tahun), dari data yang sama tanpa query tambahan
    const lastTxByStore: Record<string, string> = {};
    data.yearRows.forEach(r => {
      if (!lastTxByStore[r.customer_code] || r.do_date > lastTxByStore[r.customer_code]) lastTxByStore[r.customer_code] = r.do_date;
    });
    const peganganList: Row[] = data.pegangan.map((t: Row) => ({ ...t, last_transaction: lastTxByStore[t.cust_code] || null }));
    const mine = data.perfRows.filter(r => r.salesman_code === salesman).sort((a, b) => a.month - b.month);
    const trend = {
      months: mine.map(r => Number(r.month)),
      actualTA: mine.map(r => Number(r.actual_ta || 0)),
      targetTA: mine.map(r => (r.target_ta > 0 ? Number(r.target_ta) : null)),
      actualTonase: mine.map(r => Number(r.actual_tonase || 0)),
      targetTonase: mine.map(r => (r.target_tonase > 0 ? Number(r.target_tonase) : null)),
    };
    return { rows, peganganList, trend };
  }, [data, year, month, salesman]);

  if (error) return <ErrorBox error={error} />;
  if (!calc) return <PageSkeleton />;
  const { rows, peganganList, trend } = calc;

  const title = `${name} · ${MONTHS_ID[month]} ${year}`;
  const peganganActive = peganganList.filter(t => t.is_active).length;
  const labels = trend.months.map(m => MONTHS_ID[m]);
  const exportLabel = `${name}_${MONTHS_ID[month]}_${year}`.replace(/[\s/\\]+/g, '_');

  const trendChart = (actual: number[], target: (number | null)[], tonase: boolean) => () => ({
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Aktual', data: actual, backgroundColor: COLORS.accent, maxBarThickness: 26 },
      { label: 'Target', data: target, type: 'line', borderColor: COLORS.blueMid, borderDash: [4, 3], borderWidth: 2, pointRadius: 2, fill: false, tension: 0.3 },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { grid: { color: COLORS.line }, ticks: tonase ? { callback: (v: any) => fmtCompact(v) } : {} }, x: { grid: { display: false } } },
      plugins: { tooltip: { callbacks: { label: (c: any) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}${tonase ? ' ton' : ''}` } } },
    },
  } as any);

  return (
    <div>
      <PageHeader title={title} />
      <div className="mb-[18px]"><Link to="/tim-sales" className="btn">← Kembali ke Tim Sales</Link></div>

      <div className="grid-kpi">
        <Kpi title="Total Tonase" value={fmt(sum(rows, 'tonase'), 2)} unit="ton" />
        <Kpi title="Total Qty" value={fmt(sum(rows, 'order_qty'))} unit="zak" />
        <Kpi title="Amount (IDR)" value={<AmountValue v={sum(rows, 'net_amount')} />} />
        <Kpi title="Toko Pegangan" value={fmt(peganganList.length)} delta={`${fmt(peganganActive)} aktif bulan ini`} />
      </div>

      <div className="grid grid-cols-2 max-lg:grid-cols-1 gap-4 mt-5">
        <Card>
          <h2 className="card-title">Tren Toko Aktif per Bulan · Seluruh Toko Pegangan</h2>
          <div className="legend"><span><i style={{ background: COLORS.accent }} aria-hidden="true" />Aktual</span><span><i style={{ background: COLORS.blueMid }} aria-hidden="true" />Target</span></div>
          <ChartBox label={chartSRSummary(labels, trend.actualTA, 'toko aktif')} deps={[trend]} build={trendChart(trend.actualTA, trend.targetTA, false)} />
        </Card>
        <Card>
          <h2 className="card-title">Tren Tonase per Bulan · Seluruh Toko Pegangan</h2>
          <div className="legend"><span><i style={{ background: COLORS.accent }} aria-hidden="true" />Aktual</span><span><i style={{ background: COLORS.blueMid }} aria-hidden="true" />Target</span></div>
          <ChartBox label={chartSRSummary(labels, trend.actualTonase, 'ton')} deps={[trend]} build={trendChart(trend.actualTonase, trend.targetTonase, true)} />
        </Card>
      </div>

      <div className="flex items-baseline justify-between flex-wrap gap-2.5 mt-[30px]">
        <h2 className="section-title !m-0">Toko &amp; Omset</h2>
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Export tabel yang SEDANG TAMPIL saja, mengikuti toggle. */}
          <ExportButton pageId="transaksi-detail"
            filename={() => view === 'pegangan' ? `Toko_Pegangan_${exportLabel}.xlsx` : `Detail_Transaksi_${exportLabel}.xlsx`}
            getTables={() => view === 'pegangan'
              ? [{ name: 'Toko Pegangan', el: pRef.current }]
              : [{ name: 'Detail Transaksi', el: tRef.current }]} />
          <div className="pill-row" role="group" aria-label="Tampilan">
            <Chip active={view === 'pegangan'} onClick={() => setView('pegangan')}>Toko Pegangan</Chip>
            <Chip active={view === 'transaksi'} onClick={() => setView('transaksi')}>Detail Transaksi</Chip>
          </div>
        </div>
      </div>

      {view === 'pegangan' ? (
        <div className="mt-3.5">
          <TableWrap>
            <table ref={pRef}>
              <caption className="sr-only">Toko pegangan {title} beserta omset masing-masing</caption>
              <thead><tr>
                <th>Toko</th><th>Distributor</th><th>Status</th>
                <th className="num">Jumlah DO</th><th className="num">Amount (IDR)</th><th className="num">Omset (Tonase)</th><th className="num">Transaksi Terakhir</th>
                <th>Peta</th><th>Detail</th>
              </tr></thead>
              <tbody>
                {peganganList.length === 0
                  ? <tr><td colSpan={9} className="!text-center text-faint !p-6">Belum ada toko pegangan tercatat untuk bulan ini.</td></tr>
                  : peganganList.map((t, i) => (
                    <tr key={`${t.cust_code}-${t.dist_code}-${i}`}>
                      <td>{t.cust_name || t.cust_code}<br /><span className="font-mono text-faint text-[11px]">{t.cust_code}</span></td>
                      <td><span className="tag-code">{t.dist_code}</span> {t.dist_name || ''}</td>
                      <td>{t.is_active ? <Badge variant="good">Aktif</Badge> : <Badge variant="bad">Nonaktif</Badge>}</td>
                      <td className="num font-mono">{fmt(t.num_do)}</td>
                      <td className="num font-mono">{fmtIDR(t.net_amount)}</td>
                      <td className="num font-mono">{fmt(t.omset, 2)}</td>
                      <td className="num font-mono">{relDate(t.last_transaction)}</td>
                      <td><Link className="cell-link" to={`/peta-toko?focus=${encodeURIComponent(t.cust_code)}`} title={`Lihat ${t.cust_name || t.cust_code} di peta`}>Peta</Link></td>
                      <td><Link className="cell-link" to={`/toko-detail?code=${encodeURIComponent(t.cust_code)}&from=transaksi-detail`} title={`Detail toko ${t.cust_name || t.cust_code}`}>Detail</Link></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      ) : (
        <div className="mt-3.5">
          <ChannelFilter rows={rows} channel={channel} setChannel={setChannel} />
          <TxTable rows={rows} channel={channel} tableRef={tRef} caption={`Detail transaksi ${title}, Salesman ${name}`} />
        </div>
      )}
    </div>
  );
}

/* ---------------- Mode tanggal (dari Rekap Harian) ---------------- */
function DateMode({ date, dist, jenis }: { date: string; dist: string; jenis: string }) {
  const { data: rows, error } = useAsync<Row[]>(async () => {
    const produk = await DataSource.produk();
    const productCodes = jenis !== 'all' ? produk.filter(p => p.jenis === jenis).map(p => String(p.kode)) : null;
    return DataSource.transaksiDetail(date, dist, productCodes);
  }, []);
  const [channel, setChannel] = useState<Channel>('all');
  if (error) return <ErrorBox error={error} />;
  if (!rows) return <PageSkeleton />;

  const title = new Date(date + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  const scopeDesc = `${dist !== 'all' ? `Distributor ${dist}` : 'Semua distributor'}${jenis !== 'all' ? ' · Jenis ' + jenis : ''}`;

  return (
    <div>
      <PageHeader title={title} />
      <div className="mb-[18px]"><Link to="/rekap-harian" className="btn">← Kembali ke Rekap Harian</Link></div>
      <div className="grid-kpi">
        <Kpi title="Total Tonase" value={fmt(sum(rows, 'tonase'), 2)} unit="ton" />
        <Kpi title="Total Qty" value={fmt(sum(rows, 'order_qty'))} unit="zak" />
        <Kpi title="Amount (IDR)" value={<AmountValue v={sum(rows, 'net_amount')} />} />
        <Kpi title="Jumlah Baris" value={fmt(rows.length)} />
      </div>
      <div className="mt-5">
        <ChannelFilter rows={rows} channel={channel} setChannel={setChannel} />
        <TxTable rows={rows} channel={channel} caption={`Detail transaksi ${title}, ${scopeDesc}`} />
      </div>
    </div>
  );
}
