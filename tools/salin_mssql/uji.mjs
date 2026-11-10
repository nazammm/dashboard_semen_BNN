// Skenario mode --uji: prosedur tulis dijalankan di PostgreSQL dan SQL Server dengan masukan yang sama,
// masing-masing di dalam transaksi yang DIBATALKAN di akhir (ROLLBACK), jadi tidak ada data yang tersimpan.
// Data uji memakai tahun 2099 supaya tidak bersinggungan dengan data asli.
//
// Tiap skenario: siapkan (query PostgreSQL yang mengisi variabel {nama}), lalu langkah berurutan.
// Langkah: { nama, pg, ms?, simpan?: 'var' (kolom pertama baris pertama -> {var}, per database),
//            banding?: false (tidak dibandingkan, mis. id), galat?: true (kedua database harus menolak) }
// Hasil dibandingkan per kolom menurut urutan; array PostgreSQL dan teks JSON array dianggap sama ("A,B").

const q = s => s.replace(/'/g, "''");                    // isi string SQL
const jsonPg = v => `'${q(JSON.stringify(v))}'::json`;
const jsonMs = v => `N'${q(JSON.stringify(v))}'`;
const arrPg = a => `array[${a.map(x => `'${q(x)}'`).join(',')}]::text[]`;
const arrMs = a => jsonMs(a);
// array PostgreSQL / JSON SQL Server menjadi teks "a,b" untuk dibandingkan
const listPg = c => `array_to_string(${c}, ',')`;
const listMs = c => `(select STRING_AGG(CAST([value] AS nvarchar(200)), ',') WITHIN GROUP (ORDER BY CAST([key] AS int)) from OPENJSON(${c}))`;

// baris transaksi untuk paket upload (urutan kolom = transaksi_staging)
const baris = (dist, tgl, doNo, cust, produk, qty, net) =>
  [dist, 'DIST UJI', tgl, doNo, null, 'CASH', cust, `Toko ${cust}`, null, null, null, 'FRANCO', produk, 'PRODUK UJI', null, qty, 0, qty, net, 'UJI-S1', null, 30];

const logPg = id => `select dataset, aksi, created_by, source, file_name, to_char(date_from,'YYYY-MM-DD') dari, to_char(date_to,'YYYY-MM-DD') sampai,
  ${listPg('dist_codes')} dist, rows_read, rows_staged, rows_saved, rows_deleted, status from sementrack.kelola_log where id = ${id}`;
const logMs = id => `select dataset, aksi, created_by, source, file_name, CONVERT(char(10), date_from, 23) dari, CONVERT(char(10), date_to, 23) sampai,
  ${listMs('dist_codes')} dist, rows_read, rows_staged, rows_saved, rows_deleted, status from sementrack.kelola_log where id = ${id}`;
const isi2099 = {
  nama: 'isi transaksi 2099, toko uji, status sinkron',
  pg: `select (select count(*) from transaksi where do_date >= '2099-01-01') baris, (select sum(order_qty) from transaksi where do_date >= '2099-01-01') qty,
         (select sum(net_amount) from transaksi where do_date >= '2099-01-01') net, (select count(*) from toko where cust_code like 'UJI-%') toko,
         (select string_agg(cust_code || '/' || coalesce(dist_code,'') || '/' || coalesce(cust_name,''), ';' order by cust_code) from toko where cust_code like 'UJI-%') toko_isi,
         (select keterangan from status_sync where id = 1) ket, (select count(*) from sementrack.transaksi_staging) staging`,
  ms: `select (select count(*) from dbo.transaksi where do_date >= '2099-01-01') baris, (select sum(order_qty) from dbo.transaksi where do_date >= '2099-01-01') qty,
         (select sum(net_amount) from dbo.transaksi where do_date >= '2099-01-01') net, (select count(*) from dbo.toko where cust_code like 'UJI-%') toko,
         (select STRING_AGG(cust_code + '/' + ISNULL(dist_code,'') + '/' + ISNULL(cust_name,''), ';') WITHIN GROUP (ORDER BY cust_code) from dbo.toko where cust_code like 'UJI-%') toko_isi,
         (select keterangan from dbo.status_sync where id = 1) ket, (select count(*) from sementrack.transaksi_staging) staging`,
};

export const UJI = {
  transaksi: [
    {
      nama: 'upload baru, lalu upload ulang rentang yang sama (mengganti)',
      siapkan: `select (select min(dist_code) from transaksi where dist_code in (select dist_code from distributor)) dist, (select min(kode) from produk) produk`,
      langkah: v => [
        { nama: 'begin', simpan: 'id', banding: false,
          pg: `select sementrack.transaksi_begin('uji', 'file', 'uji.xlsx', '2099-01-01', '2099-01-31', ${arrPg([v.dist, ` ${v.dist} `])}, 3) id`,
          ms: `EXEC sementrack.transaksi_begin N'uji', N'file', N'uji.xlsx', '2099-01-01', '2099-01-31', ${arrMs([v.dist, ` ${v.dist} `])}, 3` },
        { nama: 'kelola_log setelah begin', pg: logPg('{id}'), ms: logMs('{id}') },
        { nama: 'stage 3 baris',
          pg: `select sementrack.transaksi_stage({id}, ${jsonPg([baris(v.dist, '2099-01-05', 'UJI001', 'UJI-C1', v.produk, 100, 5000000), baris(v.dist, '2099-01-05', 'UJI001', 'UJI-C1', v.produk, 20, 1000000), baris(v.dist, '2099-01-20', 'UJI002', ' UJI-C2 ', v.produk, '12.5', 150000)])}) n`,
          ms: `EXEC sementrack.transaksi_stage {id}, ${jsonMs([baris(v.dist, '2099-01-05', 'UJI001', 'UJI-C1', v.produk, 100, 5000000), baris(v.dist, '2099-01-05', 'UJI001', 'UJI-C1', v.produk, 20, 1000000), baris(v.dist, '2099-01-20', 'UJI002', ' UJI-C2 ', v.produk, '12.5', 150000)])}` },
        { nama: 'impact (belum ada data 2099)',
          pg: `select * from sementrack.transaksi_impact('2099-01-01', '2099-01-31', ${arrPg([v.dist])})`,
          ms: `EXEC sementrack.transaksi_impact '2099-01-01', '2099-01-31', ${arrMs([v.dist])}` },
        { nama: 'commit',
          pg: `select * from sementrack.transaksi_commit({id})`, ms: `EXEC sementrack.transaksi_commit {id}` },
        isi2099,
        { nama: 'kelola_log setelah commit', pg: logPg('{id}'), ms: logMs('{id}') },
        { nama: 'begin kedua (rentang sama)', simpan: 'id2', banding: false,
          pg: `select sementrack.transaksi_begin('uji', 'tempel', null, '2099-01-01', '2099-01-31', ${arrPg([v.dist])}, null) id`,
          ms: `EXEC sementrack.transaksi_begin N'uji', N'tempel', NULL, '2099-01-01', '2099-01-31', ${arrMs([v.dist])}, NULL` },
        { nama: 'impact (3 baris akan terganti)',
          pg: `select * from sementrack.transaksi_impact('2099-01-01', '2099-01-31', ${arrPg([v.dist])})`,
          ms: `EXEC sementrack.transaksi_impact '2099-01-01', '2099-01-31', ${arrMs([v.dist])}` },
        { nama: 'stage 2 baris',
          pg: `select sementrack.transaksi_stage({id2}, ${jsonPg([baris(v.dist, '2099-01-06', 'UJI001', 'UJI-C1', v.produk, 50, 2500000), baris(v.dist, '2099-01-31', 'UJI003', 'UJI-C3', v.produk, 1e3, 1.5e7)])}) n`,
          ms: `EXEC sementrack.transaksi_stage {id2}, ${jsonMs([baris(v.dist, '2099-01-06', 'UJI001', 'UJI-C1', v.produk, 50, 2500000), baris(v.dist, '2099-01-31', 'UJI003', 'UJI-C3', v.produk, 1e3, 1.5e7)])}` },
        { nama: 'commit kedua',
          pg: `select * from sementrack.transaksi_commit({id2})`, ms: `EXEC sementrack.transaksi_commit {id2}` },
        isi2099,
        { nama: 'kelola_log upload kedua', pg: logPg('{id2}'), ms: logMs('{id2}') },
      ],
    },
    {
      nama: 'batal (abort)',
      siapkan: `select (select min(dist_code) from transaksi where dist_code in (select dist_code from distributor)) dist, (select min(kode) from produk) produk`,
      langkah: v => [
        { nama: 'begin', simpan: 'id', banding: false,
          pg: `select sementrack.transaksi_begin('uji', 'file', 'x.csv', '2099-02-01', '2099-02-28', ${arrPg([v.dist])}, 1) id`,
          ms: `EXEC sementrack.transaksi_begin N'uji', N'file', N'x.csv', '2099-02-01', '2099-02-28', ${arrMs([v.dist])}, 1` },
        { nama: 'stage 1 baris',
          pg: `select sementrack.transaksi_stage({id}, ${jsonPg([baris(v.dist, '2099-02-02', 'UJI010', 'UJI-C9', v.produk, 1, 1)])}) n`,
          ms: `EXEC sementrack.transaksi_stage {id}, ${jsonMs([baris(v.dist, '2099-02-02', 'UJI010', 'UJI-C9', v.produk, 1, 1)])}` },
        { nama: 'abort', banding: false, pg: `select sementrack.transaksi_abort({id})`, ms: `EXEC sementrack.transaksi_abort {id}` },
        { nama: 'kelola_log dan staging setelah abort',
          pg: `select status, rows_staged, (select count(*) from sementrack.transaksi_staging where log_id = {id}) staging from sementrack.kelola_log where id = {id}`,
          ms: `select status, rows_staged, (select count(*) from sementrack.transaksi_staging where log_id = {id}) staging from sementrack.kelola_log where id = {id}` },
        { nama: 'commit setelah abort harus ditolak', galat: true,
          pg: `select * from sementrack.transaksi_commit({id})`, ms: `EXEC sementrack.transaksi_commit {id}` },
      ],
    },
    {
      nama: 'tolak: tanggal di luar rentang',
      siapkan: `select (select min(dist_code) from transaksi where dist_code in (select dist_code from distributor)) dist, (select min(kode) from produk) produk`,
      langkah: v => [
        { nama: 'begin', simpan: 'id', banding: false,
          pg: `select sementrack.transaksi_begin('uji', 'file', 'x', '2099-03-01', '2099-03-31', ${arrPg([v.dist])}, 1) id`,
          ms: `EXEC sementrack.transaksi_begin N'uji', N'file', N'x', '2099-03-01', '2099-03-31', ${arrMs([v.dist])}, 1` },
        { nama: 'stage tanggal April', galat: true,
          pg: `select sementrack.transaksi_stage({id}, ${jsonPg([baris(v.dist, '2099-04-01', 'UJI020', 'UJI-C1', v.produk, 1, 1)])})`,
          ms: `EXEC sementrack.transaksi_stage {id}, ${jsonMs([baris(v.dist, '2099-04-01', 'UJI020', 'UJI-C1', v.produk, 1, 1)])}` },
      ],
    },
    {
      nama: 'tolak: nomor DO sudah ada di tanggal lain',
      siapkan: `select dist_code dist, do_no do_lama, (select min(kode) from produk) produk from transaksi where dist_code in (select dist_code from distributor) order by do_date, do_no limit 1`,
      langkah: v => [
        { nama: 'begin', simpan: 'id', banding: false,
          pg: `select sementrack.transaksi_begin('uji', 'file', 'x', '2099-04-01', '2099-04-30', ${arrPg([v.dist])}, 1) id`,
          ms: `EXEC sementrack.transaksi_begin N'uji', N'file', N'x', '2099-04-01', '2099-04-30', ${arrMs([v.dist])}, 1` },
        { nama: 'stage DO lama',
          pg: `select sementrack.transaksi_stage({id}, ${jsonPg([baris(v.dist, '2099-04-02', v.do_lama, 'UJI-C1', v.produk, 1, 1)])}) n`,
          ms: `EXEC sementrack.transaksi_stage {id}, ${jsonMs([baris(v.dist, '2099-04-02', v.do_lama, 'UJI-C1', v.produk, 1, 1)])}` },
        { nama: 'commit ditolak', galat: true, pg: `select * from sementrack.transaksi_commit({id})`, ms: `EXEC sementrack.transaksi_commit {id}` },
      ],
    },
    {
      nama: 'tolak: kode produk belum terdaftar',
      siapkan: `select (select min(dist_code) from transaksi where dist_code in (select dist_code from distributor)) dist`,
      langkah: v => [
        { nama: 'begin', simpan: 'id', banding: false,
          pg: `select sementrack.transaksi_begin('uji', 'file', 'x', '2099-05-01', '2099-05-31', ${arrPg([v.dist])}, 1) id`,
          ms: `EXEC sementrack.transaksi_begin N'uji', N'file', N'x', '2099-05-01', '2099-05-31', ${arrMs([v.dist])}, 1` },
        { nama: 'stage produk UJI-PRODUK',
          pg: `select sementrack.transaksi_stage({id}, ${jsonPg([baris(v.dist, '2099-05-02', 'UJI030', 'UJI-C1', 'UJI-PRODUK', 1, 1)])}) n`,
          ms: `EXEC sementrack.transaksi_stage {id}, ${jsonMs([baris(v.dist, '2099-05-02', 'UJI030', 'UJI-C1', 'UJI-PRODUK', 1, 1)])}` },
        { nama: 'commit ditolak', galat: true, pg: `select * from sementrack.transaksi_commit({id})`, ms: `EXEC sementrack.transaksi_commit {id}` },
      ],
    },
    {
      nama: 'tolak: angka tidak terbaca',
      siapkan: `select (select min(dist_code) from transaksi where dist_code in (select dist_code from distributor)) dist, (select min(kode) from produk) produk`,
      langkah: v => [
        { nama: 'begin', simpan: 'id', banding: false,
          pg: `select sementrack.transaksi_begin('uji', 'file', 'x', '2099-06-01', '2099-06-30', ${arrPg([v.dist])}, 1) id`,
          ms: `EXEC sementrack.transaksi_begin N'uji', N'file', N'x', '2099-06-01', '2099-06-30', ${arrMs([v.dist])}, 1` },
        { nama: 'stage qty "abc"', galat: true,
          pg: `select sementrack.transaksi_stage({id}, ${jsonPg([baris(v.dist, '2099-06-02', 'UJI040', 'UJI-C1', v.produk, 'abc', 1)])})`,
          ms: `EXEC sementrack.transaksi_stage {id}, ${jsonMs([baris(v.dist, '2099-06-02', 'UJI040', 'UJI-C1', v.produk, 'abc', 1)])}` },
      ],
    },
    {
      nama: 'tolak: rentang tanggal terbalik',
      langkah: () => [
        { nama: 'rentang terbalik', galat: true,
          pg: `select sementrack.transaksi_begin('uji', 'file', 'x', '2099-02-01', '2099-01-01', array['A'], 1)`,
          ms: `EXEC sementrack.transaksi_begin N'uji', N'file', N'x', '2099-02-01', '2099-01-01', N'["A"]', 1` },
      ],
    },
    {
      nama: 'tolak: distributor kosong',
      langkah: () => [
        { nama: 'tanpa distributor', galat: true,
          pg: `select sementrack.transaksi_begin('uji', 'file', 'x', '2099-01-01', '2099-01-31', array[]::text[], 1)`,
          ms: `EXEC sementrack.transaksi_begin N'uji', N'file', N'x', '2099-01-01', '2099-01-31', N'[]', 1` },
      ],
    },
  ],
};

// ---------- sell in ----------
// baris Sell In BNN: 18 nilai (urutan = sellin_bnn_staging tanpa upload_id)
const bnn = (tgl, dist, cust, tipe, produk, asal, qty) =>
  [tgl, '2099-01-01', dist, cust, `Cust ${cust}`, tipe, produk, asal, null, null, null, 'FRANCO', `SO-${cust}`, null, null, null, 'Delivered', qty];
// baris raw PO: 18 nilai (urutan = sellin_po_staging tanpa upload_id)
const po = (tgl, dist, order, produk, status, kirim, cust, tipe, asal, oq, dq) =>
  [tgl, dist, order, produk, status, '2099-01-20', kirim, status === 'Reject' ? 'Stok habis' : null, cust, `Cust ${cust}`, tipe, asal, null, null, null, 'LOCO', oq, dq];
const PMN = '9000 - PERMATA MULTI NIAGA, PT';
const isiSellin = {
  nama: 'isi sell in 2099 (tabel, view harian, peta region)',
  pg: `select (select count(*) from sementrack.sellin_bnn where tanggal >= '2099-01-01') baris, (select sum(ton) from sementrack.sellin_bnn where tanggal >= '2099-01-01') ton,
         (select string_agg(region || ':' || tipe_pesanan || ':' || loco_franco || ':' || ton::float, ';' order by region, tipe_pesanan) from sementrack.v_sellin_bnn_daily where tanggal >= '2099-01-01') harian,
         (select count(*) from sementrack.sellin_bnn_staging) staging`,
  ms: `select (select count(*) from sementrack.sellin_bnn where tanggal >= '2099-01-01') baris, (select sum(ton) from sementrack.sellin_bnn where tanggal >= '2099-01-01') ton,
         (select STRING_AGG(region + ':' + tipe_pesanan + ':' + loco_franco + ':' + FORMAT(CAST(ton AS decimal(20,6)), 'G29'), ';') WITHIN GROUP (ORDER BY region, tipe_pesanan) from sementrack.v_sellin_bnn_daily where tanggal >= '2099-01-01') harian,
         (select count(*) from sementrack.sellin_bnn_staging) staging`,
};
const uploadPg = id => `select status, rows_read, rows_staged, rows_saved, rows_replaced, ton_saved from sementrack.sellin_bnn_upload where id = ${id}`;
const isiPo = {
  nama: 'isi sellin_po 2099 dan v_outstanding_do',
  pg: `select (select string_agg(order_no || ':' || status_order || ':' || to_char(tanggal_order,'MMDD') || ':' || coalesce(to_char(kirim_terakhir,'MMDD'),'-') || ':' || order_qty::float || ':' || delivery_qty::float || ':' || pengiriman, ';' order by order_no)
           from sementrack.sellin_po where tanggal_order >= '2099-01-01') po,
         (select string_agg(order_no || ':' || status || ':' || jalur || ':' || region || ':' || sisa_ton::float || ':' || umur_hari || ':' || lewat_hari, ';' order by order_no)
           from sementrack.v_outstanding_do where tanggal_order >= '2099-01-01') os,
         (select count(*) from sementrack.sellin_po_staging) staging`,
  ms: `select (select STRING_AGG(order_no + ':' + status_order + ':' + FORMAT(tanggal_order,'MMdd') + ':' + ISNULL(FORMAT(kirim_terakhir,'MMdd'),'-') + ':' + FORMAT(CAST(order_qty AS decimal(20,6)), 'G29') + ':' + FORMAT(CAST(delivery_qty AS decimal(20,6)), 'G29') + ':' + CAST(pengiriman AS varchar(10)), ';') WITHIN GROUP (ORDER BY order_no)
           from sementrack.sellin_po where tanggal_order >= '2099-01-01') po,
         (select STRING_AGG(order_no + ':' + status + ':' + jalur + ':' + region + ':' + FORMAT(CAST(sisa_ton AS decimal(20,6)), 'G29') + ':' + CAST(umur_hari AS varchar(10)) + ':' + CAST(lewat_hari AS varchar(10)), ';') WITHIN GROUP (ORDER BY order_no)
           from sementrack.v_outstanding_do where tanggal_order >= '2099-01-01') os,
         (select count(*) from sementrack.sellin_po_staging) staging`,
};

UJI.sellin = [
  {
    nama: 'Sell In BNN: aturan sell in, peta region, upload ulang',
    langkah: () => {
      const rows = [
        bnn('2099-01-05', '9575 - DIST UJI, PT', 'UJI-K1', 'GUDANG', 'PCC 40KG', 'CITEUREUP', 400),
        bnn('2099-01-06', '9575 - DIST UJI, PT', 'UJI-K2', 'TOKO', 'PCC 50KG', 'CITEUREUP', 100),           // tidak lolos aturan
        bnn('2099-01-07', PMN, 'UJI-K3', 'PROJECT', 'PCC 50KG', 'ITP-Palembang Terminal', 200),           // lolos (PMN)
        bnn('2099-01-08', '9575 - DIST UJI, PT', 'UJI-K4', 'GUDANG', 'MORTAR UTAMA 25KG', 'CITEUREUP', 80), // mortar
        bnn('2099-01-09', '9575 - DIST UJI, PT', 'UJI-K5', ' gudang ', 'NEW - PCC RAJAWALI 50KG', 'CITEUREUP', '12.5'),
      ];
      return [
        { nama: 'begin', simpan: 'id', banding: false,
          pg: `select sementrack.sellin_bnn_begin('uji', 'file', 'raw.xlsx', '2099-01-01', '2099-01-31', 5) id`,
          ms: `EXEC sementrack.sellin_bnn_begin N'uji', N'file', N'raw.xlsx', '2099-01-01', '2099-01-31', 5` },
        { nama: 'stage 5 baris', pg: `select sementrack.sellin_bnn_stage({id}, ${jsonPg(rows)}) n`, ms: `EXEC sementrack.sellin_bnn_stage {id}, ${jsonMs(rows)}` },
        { nama: 'impact', pg: `select * from sementrack.sellin_bnn_impact('2099-01-01', '2099-01-31')`, ms: `EXEC sementrack.sellin_bnn_impact '2099-01-01', '2099-01-31'` },
        { nama: 'peta region UJI-K1', banding: false,
          pg: `select sementrack.sellin_region_set(' UJI-K1 ', 'Jambi', 'Cust UJI-K1', 'uji')`, ms: `EXEC sementrack.sellin_region_set N' UJI-K1 ', N'Jambi', N'Cust UJI-K1', N'uji'` },
        { nama: 'commit', pg: `select * from sementrack.sellin_bnn_commit({id})`, ms: `EXEC sementrack.sellin_bnn_commit {id}` },
        { nama: 'catatan upload', pg: uploadPg('{id}'), ms: uploadPg('{id}') },
        isiSellin,
        { nama: 'begin kedua', simpan: 'id2', banding: false,
          pg: `select sementrack.sellin_bnn_begin('uji', 'tempel', null, '2099-01-01', '2099-01-31', null) id`,
          ms: `EXEC sementrack.sellin_bnn_begin N'uji', N'tempel', NULL, '2099-01-01', '2099-01-31', NULL` },
        { nama: 'impact (akan terganti)', pg: `select * from sementrack.sellin_bnn_impact('2099-01-01', '2099-01-31')`, ms: `EXEC sementrack.sellin_bnn_impact '2099-01-01', '2099-01-31'` },
        { nama: 'stage 1 baris', pg: `select sementrack.sellin_bnn_stage({id2}, ${jsonPg([rows[0]])}) n`, ms: `EXEC sementrack.sellin_bnn_stage {id2}, ${jsonMs([rows[0]])}` },
        { nama: 'commit kedua', pg: `select * from sementrack.sellin_bnn_commit({id2})`, ms: `EXEC sementrack.sellin_bnn_commit {id2}` },
        isiSellin,
      ];
    },
  },
  {
    nama: 'Sell In BNN: tolak bila tidak ada baris yang lolos aturan',
    langkah: () => [
      { nama: 'begin', simpan: 'id', banding: false,
        pg: `select sementrack.sellin_bnn_begin('uji', 'file', 'x', '2099-02-01', '2099-02-28', 1) id`,
        ms: `EXEC sementrack.sellin_bnn_begin N'uji', N'file', N'x', '2099-02-01', '2099-02-28', 1` },
      { nama: 'stage baris toko', pg: `select sementrack.sellin_bnn_stage({id}, ${jsonPg([bnn('2099-02-02', 'D', 'UJI-K9', 'TOKO', 'PCC 40KG', 'X', 1)])}) n`,
        ms: `EXEC sementrack.sellin_bnn_stage {id}, ${jsonMs([bnn('2099-02-02', 'D', 'UJI-K9', 'TOKO', 'PCC 40KG', 'X', 1)])}` },
      { nama: 'commit ditolak', galat: true, pg: `select * from sementrack.sellin_bnn_commit({id})`, ms: `EXEC sementrack.sellin_bnn_commit {id}` },
    ],
  },
  {
    nama: 'Sell In BNN: tolak qty negatif',
    langkah: () => [
      { nama: 'begin', simpan: 'id', banding: false,
        pg: `select sementrack.sellin_bnn_begin('uji', 'file', 'x', '2099-02-01', '2099-02-28', 1) id`,
        ms: `EXEC sementrack.sellin_bnn_begin N'uji', N'file', N'x', '2099-02-01', '2099-02-28', 1` },
      { nama: 'stage qty -5', galat: true, pg: `select sementrack.sellin_bnn_stage({id}, ${jsonPg([bnn('2099-02-02', 'D', 'UJI-K9', 'GUDANG', 'PCC 40KG', 'X', -5)])})`,
        ms: `EXEC sementrack.sellin_bnn_stage {id}, ${jsonMs([bnn('2099-02-02', 'D', 'UJI-K9', 'GUDANG', 'PCC 40KG', 'X', -5)])}` },
    ],
  },
  {
    nama: 'Sell In BNN: tolak rentang lebih dari 800 hari',
    langkah: () => [
      { nama: 'begin 2097-2099', galat: true, pg: `select sementrack.sellin_bnn_begin('uji', 'file', 'x', '2097-01-01', '2099-12-31', 1)`,
        ms: `EXEC sementrack.sellin_bnn_begin N'uji', N'file', N'x', '2097-01-01', '2099-12-31', 1` },
    ],
  },
  {
    nama: 'Outstanding DO: gabung pengiriman bertahap, aturan, posisi',
    langkah: () => {
      const D = '9575 - DIST UJI, PT';
      const rows = [
        po('2099-01-03', D, 'O1', 'PCC 50KG', 'Partially Delivered', '2099-01-10', 'UJI-K1', 'GUDANG', 'SUNDA KELAPA', 150, 100),
        po('2099-01-03', D, 'O1', 'PCC 50KG', 'Delivered', '2099-01-12', 'UJI-K1', 'GUDANG', 'SUNDA KELAPA', 150, 50),
        po('2099-01-04', D, 'O2', 'PCC 50KG', 'Verified', null, 'UJI-K1', 'GUDANG', 'CCY KOJA', 200, 0),
        po('2099-01-05', D, 'O3', 'NEW - PCC RAJAWALI 40KG', 'Partially Delivered', '2099-01-15', 'UJI-K2', 'GUDANG', 'Terminal Lampung', 300, 100),
        po('2099-01-06', D, 'O4', 'PCC 50KG', 'Reject', null, 'UJI-K2', 'GUDANG', 'CITEUREUP', 90, null),
        po('2099-01-07', D, 'O5', 'PCC 50KG', 'Verified', null, 'UJI-K3', 'TOKO', 'CITEUREUP', 70, 0),                 // tidak lolos aturan
        po('2099-01-08', D, 'O6', 'PCC 40KG', 'Not Verified', null, 'UJI-K3', 'GUDANG', 'MARUNDA', 80, 0),
      ];
      return [
        { nama: 'begin', simpan: 'id', banding: false,
          pg: `select sementrack.sellin_po_begin('uji', 'file', 'raw_po.xlsx', '2099-01-01', '2099-01-31', 7) id`,
          ms: `EXEC sementrack.sellin_po_begin N'uji', N'file', N'raw_po.xlsx', '2099-01-01', '2099-01-31', 7` },
        { nama: 'stage 7 baris', pg: `select sementrack.sellin_po_stage({id}, ${jsonPg(rows)}) n`, ms: `EXEC sementrack.sellin_po_stage {id}, ${jsonMs(rows)}` },
        { nama: 'impact', pg: `select * from sementrack.sellin_po_impact('2099-01-01', '2099-01-31')`, ms: `EXEC sementrack.sellin_po_impact '2099-01-01', '2099-01-31'` },
        { nama: 'commit', pg: `select * from sementrack.sellin_po_commit({id})`, ms: `EXEC sementrack.sellin_po_commit {id}` },
        isiPo,
        { nama: 'upload Februari berisi order O2 (Januari) yang kini terkirim', simpan: 'id2', banding: false,
          pg: `select sementrack.sellin_po_begin('uji', 'tempel', null, '2099-02-01', '2099-02-28', 1) id`,
          ms: `EXEC sementrack.sellin_po_begin N'uji', N'tempel', NULL, '2099-02-01', '2099-02-28', 1` },
        { nama: 'stage O2', pg: `select sementrack.sellin_po_stage({id2}, ${jsonPg([po('2099-02-02', D, 'O2', 'PCC 50KG', 'Delivered', '2099-02-05', 'UJI-K1', 'GUDANG', 'CCY KOJA', 200, 200)])}) n`,
          ms: `EXEC sementrack.sellin_po_stage {id2}, ${jsonMs([po('2099-02-02', D, 'O2', 'PCC 50KG', 'Delivered', '2099-02-05', 'UJI-K1', 'GUDANG', 'CCY KOJA', 200, 200)])}` },
        { nama: 'commit kedua (O2 diperbarui, bukan dobel)', pg: `select * from sementrack.sellin_po_commit({id2})`, ms: `EXEC sementrack.sellin_po_commit {id2}` },
        isiPo,
      ];
    },
  },
  {
    nama: 'Outstanding DO: tolak kolom wajib kosong',
    langkah: () => [
      { nama: 'begin', simpan: 'id', banding: false,
        pg: `select sementrack.sellin_po_begin('uji', 'file', 'x', '2099-03-01', '2099-03-31', 1) id`,
        ms: `EXEC sementrack.sellin_po_begin N'uji', N'file', N'x', '2099-03-01', '2099-03-31', 1` },
      { nama: 'stage tanpa nomor order', galat: true,
        pg: `select sementrack.sellin_po_stage({id}, ${jsonPg([po('2099-03-02', 'D', '', 'PCC 50KG', 'Verified', null, 'K', 'GUDANG', 'X', 1, 0)])})`,
        ms: `EXEC sementrack.sellin_po_stage {id}, ${jsonMs([po('2099-03-02', 'D', '', 'PCC 50KG', 'Verified', null, 'K', 'GUDANG', 'X', 1, 0)])}` },
    ],
  },
  {
    nama: 'Peta region: ubah region, nama lama dipertahankan bila nama kosong',
    langkah: () => [
      { nama: 'set pertama', banding: false, pg: `select sementrack.sellin_region_set('UJI-K7', 'Bengkulu', 'Toko Tujuh', 'uji')`,
        ms: `EXEC sementrack.sellin_region_set N'UJI-K7', N'Bengkulu', N'Toko Tujuh', N'uji'` },
      { nama: 'set kedua tanpa nama', banding: false, pg: `select sementrack.sellin_region_set('UJI-K7', 'Lampung', '  ', 'uji2')`,
        ms: `EXEC sementrack.sellin_region_set N'UJI-K7', N'Lampung', N'  ', N'uji2'` },
      { nama: 'isi peta', pg: `select kode_customer, region, nama_customer, updated_by, updated_at is not null ada_waktu from sementrack.sellin_region_map where kode_customer = 'UJI-K7'`,
        ms: `select kode_customer, region, nama_customer, updated_by, CAST(CASE WHEN updated_at IS NOT NULL THEN 1 ELSE 0 END AS bit) ada_waktu from sementrack.sellin_region_map where kode_customer = 'UJI-K7'` },
      { nama: 'kode kosong ditolak', galat: true, pg: `select sementrack.sellin_region_set(' ', 'Jambi', null, 'uji')`, ms: `EXEC sementrack.sellin_region_set N' ', N'Jambi', NULL, N'uji'` },
    ],
  },
];
