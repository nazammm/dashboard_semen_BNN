// Skenario mode --uji: prosedur tulis dijalankan di PostgreSQL dan SQL Server dengan masukan yang sama,
// masing-masing di dalam transaksi yang DIBATALKAN di akhir (ROLLBACK), jadi tidak ada data yang tersimpan.
// Data uji memakai tahun 2099 supaya tidak bersinggungan dengan data asli.
//
// Tiap skenario: siapkan (query PostgreSQL yang mengisi variabel {nama}), lalu langkah berurutan.
// Langkah: { nama, pg, ms?, simpan?: 'var' (kolom pertama baris pertama -> {var}, per database),
//            banding?: false (tidak dibandingkan, mis. id), galat?: true (kedua database harus menolak) }
// Fungsi tempel PostgreSQL membuat tabel sementara (on commit drop); panggilan kedua dalam satu transaksi uji
// didahului 'drop table if exists'. Hasil dibandingkan per kolom menurut urutan; array PostgreSQL dan teks JSON array dianggap sama ("A,B").

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

// ---------- Kelola Data lainnya ----------
const logTerakhir = (dataset) => ({
  nama: `kelola_log terakhir (${dataset})`,
  pg: `select dataset, aksi, created_by, source, file_name, to_char(date_from,'YYYY-MM-DD') dari, to_char(date_to,'YYYY-MM-DD') sampai, ${listPg('dist_codes')} dist,
         rows_read, rows_saved, rows_deleted, status from sementrack.kelola_log where id = (select max(id) from sementrack.kelola_log where dataset = '${dataset}')`,
  ms: `select dataset, aksi, created_by, source, file_name, CONVERT(char(10), date_from, 23) dari, CONVERT(char(10), date_to, 23) sampai, ${listMs('dist_codes')} dist,
         rows_read, rows_saved, rows_deleted, status from sementrack.kelola_log where id = (select max(id) from sementrack.kelola_log where dataset = '${dataset}')`,
});
const bulan12 = (...v) => Array.from({ length: 12 }, (_, i) => (i < v.length ? v[i] : null));

UJI.kelola = [
  {
    nama: 'hapus transaksi satu distributor satu bulan (pratinjau, hapus, catatan)',
    siapkan: `select dist_code dist, to_char(date_trunc('month', min(do_date)), 'YYYY-MM-DD') dari,
                to_char(date_trunc('month', min(do_date)) + interval '1 month - 1 day', 'YYYY-MM-DD') sampai
              from transaksi where dist_code = (select min(dist_code) from transaksi) group by dist_code`,
    langkah: v => [
      { nama: 'pratinjau satu distributor', pg: `select * from sementrack.kelola_hapus_pratinjau('transaksi', '${v.dari}', '${v.sampai}', ${arrPg([v.dist])})`,
        ms: `EXEC sementrack.kelola_hapus_pratinjau N'transaksi', '${v.dari}', '${v.sampai}', ${arrMs([v.dist])}` },
      { nama: 'pratinjau semua distributor (array kosong)', pg: `select * from sementrack.kelola_hapus_pratinjau('transaksi', '${v.dari}', '${v.sampai}', array[]::text[])`,
        ms: `EXEC sementrack.kelola_hapus_pratinjau N'transaksi', '${v.dari}', '${v.sampai}', N'[]'` },
      { nama: 'hapus', pg: `select sementrack.kelola_hapus('transaksi', '${v.dari}', '${v.sampai}', ${arrPg([v.dist])}, 'uji') n`,
        ms: `EXEC sementrack.kelola_hapus N'transaksi', '${v.dari}', '${v.sampai}', ${arrMs([v.dist])}, N'uji'` },
      { nama: 'sisa baris', pg: `select count(*) from transaksi where dist_code = '${v.dist}' and do_date between '${v.dari}' and '${v.sampai}'`,
        ms: `select count(*) from dbo.transaksi where dist_code = '${v.dist}' and do_date between '${v.dari}' and '${v.sampai}'` },
      logTerakhir('transaksi'),
    ],
  },
  {
    nama: 'hapus sell in tiga hari pertama',
    siapkan: `select to_char(min(tanggal), 'YYYY-MM-DD') dari, to_char(min(tanggal) + 2, 'YYYY-MM-DD') sampai from sementrack.sellin_bnn`,
    langkah: v => [
      { nama: 'pratinjau', pg: `select * from sementrack.kelola_hapus_pratinjau('sellin', '${v.dari}', '${v.sampai}', null)`,
        ms: `EXEC sementrack.kelola_hapus_pratinjau N'sellin', '${v.dari}', '${v.sampai}', NULL` },
      { nama: 'hapus', pg: `select sementrack.kelola_hapus('sellin', '${v.dari}', '${v.sampai}', array['X'], 'uji') n`,
        ms: `EXEC sementrack.kelola_hapus N'sellin', '${v.dari}', '${v.sampai}', N'["X"]', N'uji'` },
      logTerakhir('sellin'),
      { nama: 'dataset tidak dikenal ditolak', galat: true, pg: `select sementrack.kelola_hapus('j073', '2099-01-01', '2099-01-02', null, 'uji')`,
        ms: `EXEC sementrack.kelola_hapus N'j073', '2099-01-01', '2099-01-02', NULL, N'uji'` },
    ],
  },
  {
    nama: 'status sinkron',
    langkah: () => [
      { nama: 'simpan', banding: false, pg: `select sementrack.status_sync_set('2099-01-02', '08:15', '  catatan uji  ')`,
        ms: `EXEC sementrack.status_sync_set '2099-01-02', '08:15', N'  catatan uji  '` },
      { nama: 'isi', pg: `select to_char(tanggal_update,'YYYY-MM-DD') tgl, to_char(jam_update,'HH24:MI') jam, keterangan from status_sync where id = 1`,
        ms: `select CONVERT(char(10), tanggal_update, 23) tgl, CONVERT(char(5), jam_update, 108) jam, keterangan from dbo.status_sync where id = 1` },
      { nama: 'simpan tanpa keterangan', banding: false, pg: `select sementrack.status_sync_set('2099-01-03', '09:00', '   ')`,
        ms: `EXEC sementrack.status_sync_set '2099-01-03', '09:00', N'   '` },
      { nama: 'isi', pg: `select to_char(tanggal_update,'YYYY-MM-DD') tgl, keterangan from status_sync where id = 1`,
        ms: `select CONVERT(char(10), tanggal_update, 23) tgl, keterangan from dbo.status_sync where id = 1` },
      { nama: 'tanggal kosong ditolak', galat: true, pg: `select sementrack.status_sync_set(null, '09:00', 'x')`, ms: `EXEC sementrack.status_sync_set NULL, '09:00', N'x'` },
    ],
  },
  {
    nama: 'DO FAS: tempel tahun 2099, tempel ulang mengganti',
    langkah: () => {
      const a = [['str', ' Area1 ', ' GMD ', ' kapal ', ...bulan12(10, null, '2.5', 0, 1e2)], ['RJW', null, 'KB', null, ...bulan12(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)]];
      const b = [['CWC', null, 'CB', 'ket', ...bulan12(7)]];
      const isi = { nama: 'isi sellout_dofas 2099',
        pg: `select baris, tipe, area, distributor, keterangan, count(*) bulan, sum(ton) ton from sementrack.sellout_dofas where tahun = 2099 group by 1,2,3,4,5`,
        ms: `select baris, tipe, area, distributor, keterangan, count(*) bulan, sum(ton) ton from sementrack.sellout_dofas where tahun = 2099 group by baris, tipe, area, distributor, keterangan` };
      return [
        { nama: 'simpan 2 baris', pg: `select * from sementrack.sellout_dofas_simpan(2099, ${jsonPg(a)}, 'uji')`, ms: `EXEC sementrack.sellout_dofas_simpan 2099, ${jsonMs(a)}, N'uji'` },
        isi,
        { nama: 'simpan ulang 1 baris', pg: `drop table if exists _dofas; select * from sementrack.sellout_dofas_simpan(2099, ${jsonPg(b)}, 'uji')`, ms: `EXEC sementrack.sellout_dofas_simpan 2099, ${jsonMs(b)}, N'uji'` },
        isi,
        logTerakhir('dofas'),
        { nama: 'tipe salah ditolak', galat: true, pg: `drop table if exists _dofas; select * from sementrack.sellout_dofas_simpan(2099, ${jsonPg([['XYZ', null, 'A', null, 1]])}, 'uji')`,
          ms: `EXEC sementrack.sellout_dofas_simpan 2099, ${jsonMs([['XYZ', null, 'A', null, 1]])}, N'uji'` },
      ];
    },
  },
  {
    nama: 'Sub ERP: hanya bulan yang berisi angka yang diganti',
    langkah: () => {
      const a = [['s006', 'PT UJI', 'str', ...bulan12(1, 2)], ['S007', null, null, ...bulan12(null, 5)]];
      const b = [['S006', 'PT UJI BARU', 'STR', ...bulan12(null, 20)]];
      const isi = { nama: 'isi sellout_erp 2099',
        pg: `select kode, nama, tipe, bulan, ton from sementrack.sellout_erp where tahun = 2099`,
        ms: `select kode, nama, tipe, bulan, ton from sementrack.sellout_erp where tahun = 2099` };
      return [
        { nama: 'simpan Jan-Feb', pg: `select * from sementrack.sellout_erp_simpan(2099, ${jsonPg(a)}, 'uji')`, ms: `EXEC sementrack.sellout_erp_simpan 2099, ${jsonMs(a)}, N'uji'` },
        isi,
        { nama: 'simpan Feb saja', pg: `drop table if exists _erp; select * from sementrack.sellout_erp_simpan(2099, ${jsonPg(b)}, 'uji')`, ms: `EXEC sementrack.sellout_erp_simpan 2099, ${jsonMs(b)}, N'uji'` },
        isi,
        logTerakhir('erp'),
        { nama: 'kode dobel ditolak', galat: true, pg: `drop table if exists _erp; select * from sementrack.sellout_erp_simpan(2099, ${jsonPg([b[0], b[0]])}, 'uji')`,
          ms: `EXEC sementrack.sellout_erp_simpan 2099, ${jsonMs([b[0], b[0]])}, N'uji'` },
      ];
    },
  },
  {
    nama: 'J073: upload, upload ulang sebagian rentang',
    siapkan: `select min(dist_code) dist, (select min(kode) from produk) produk from sementrack.sellout_j073_dist`,
    langkah: v => {
      const r = (tgl, doNo, cust, qty, net, wh) => [v.dist, tgl, doNo, cust, `Toko ${cust}`, v.produk.toLowerCase(), 'PCC 40KG', qty, net, wh];
      const a = [r('2099-01-02', 'J1', 'C1', 100, 5000000, ' aceh '), r('2099-01-03', 'J2', 'C2', 50, null, null), r('2099-01-05', 'J3', 'C1', 25, 1000, 'dumai')];
      const b = [r('2099-01-03', 'J9', 'C3', 10, 10, null)];
      const isi = { nama: 'isi sellout_j073 2099 dan v_sellout_j073_baris',
        pg: `select do_no, customer_code, product_code, order_qty, net_amount, warehouse, (select round(ton, 4) from sementrack.v_sellout_j073_baris b where b.do_no = j.do_no and b.asal = 'J073') ton
             from sementrack.sellout_j073 j where do_date >= '2099-01-01'`,
        ms: `select do_no, customer_code, product_code, order_qty, net_amount, warehouse, (select round(ton, 4) from sementrack.v_sellout_j073_baris b where b.do_no = j.do_no and b.asal = 'J073') ton
             from sementrack.sellout_j073 j where do_date >= '2099-01-01'` };
      return [
        { nama: 'simpan 3 baris', pg: `select * from sementrack.sellout_j073_simpan(${jsonPg(a)}, 'uji', 'j073.xlsx')`, ms: `EXEC sementrack.sellout_j073_simpan ${jsonMs(a)}, N'uji', N'j073.xlsx'` },
        isi,
        { nama: 'simpan ulang tanggal 3', pg: `drop table if exists _j073; select * from sementrack.sellout_j073_simpan(${jsonPg(b)}, 'uji')`, ms: `EXEC sementrack.sellout_j073_simpan ${jsonMs(b)}, N'uji'` },
        isi,
        logTerakhir('j073'),
        { nama: 'distributor belum dikenal ditolak', galat: true,
          pg: `drop table if exists _j073; select * from sementrack.sellout_j073_simpan(${jsonPg([['ZZZ-UJI', '2099-01-02', 'J1', 'C1', null, 'X', null, 1, 1, null]])}, 'uji')`,
          ms: `EXEC sementrack.sellout_j073_simpan ${jsonMs([['ZZZ-UJI', '2099-01-02', 'J1', 'C1', null, 'X', null, 1, 1, null]])}, N'uji'` },
      ];
    },
  },
  {
    nama: 'target sell out 2099: simpan, simpan ulang satu metrik satu bulan',
    langkah: () => {
      const a = [
        ['target_ton', 2099, 1, 'Jambi', 'JMB', 'str', '', null, null, 100], ['target_ton', 2099, 2, 'Jambi', 'JMB', 'STR', '', null, null, '110.5'],
        ['target_ton', 2099, 1, 'Lampung', 'BMM', 'RJW', '', null, null, 50], ['realisasi_ton', 2099, 1, 'Jambi', 'JMB', 'STR', '', null, null, 90],
        ['target_ta', '2099', '1', 'Jambi', 'JMB', 'STR', null, ' nama ', ' ', 12],
      ];
      const b = [['target_ton', 2099, 1, 'Jambi', 'JMB', 'STR', '', null, null, 120]];
      const isi = { nama: 'isi v_target_sell_out 2099',
        pg: `select bulan, region, distributor, tipe, target_ton, realisasi_ton, target_ta, realisasi_ta from sementrack.v_target_sell_out where tahun = 2099`,
        ms: `select bulan, region, distributor, tipe, target_ton, realisasi_ton, target_ta, realisasi_ta from sementrack.v_target_sell_out where tahun = 2099` };
      return [
        { nama: 'simpan 5 baris', pg: `select * from sementrack.target_simpan('sell_out', ${jsonPg(a)}, 'uji', 'target.xlsx')`,
          ms: `EXEC sementrack.target_simpan N'sell_out', ${jsonMs(a)}, N'uji', N'target.xlsx'` },
        isi,
        { nama: 'baris target_ta (nama, status)', pg: `select kode, nama, status, nilai from sementrack.target where jenis = 'sell_out' and tahun = 2099 and metrik = 'target_ta'`,
          ms: `select kode, nama, status, nilai from sementrack.target where jenis = 'sell_out' and tahun = 2099 and metrik = 'target_ta'` },
        { nama: 'simpan ulang target_ton Januari', pg: `drop table if exists _t; select * from sementrack.target_simpan('sell_out', ${jsonPg(b)}, 'uji')`,
          ms: `EXEC sementrack.target_simpan N'sell_out', ${jsonMs(b)}, N'uji'` },
        isi,
        logTerakhir('target'),
        { nama: 'baris dobel ditolak', galat: true, pg: `drop table if exists _t; select * from sementrack.target_simpan('sell_out', ${jsonPg([b[0], b[0]])}, 'uji')`,
          ms: `EXEC sementrack.target_simpan N'sell_out', ${jsonMs([b[0], b[0]])}, N'uji'` },
      ];
    },
  },
  {
    nama: 'target: tolak bulan 13',
    langkah: () => [
      { nama: 'bulan 13', galat: true, pg: `select * from sementrack.target_simpan('salesman', ${jsonPg([['target_ta', 2099, 13, '', 'X', '', 'S1', null, null, 1]])}, 'uji')`,
        ms: `EXEC sementrack.target_simpan N'salesman', ${jsonMs([['target_ta', 2099, 13, '', 'X', '', 'S1', null, null, 1]])}, N'uji'` },
    ],
  },
  {
    nama: 'target: tolak jenis tidak dikenal',
    langkah: () => [
      { nama: 'jenis "apa"', galat: true, pg: `select * from sementrack.target_simpan('apa', ${jsonPg([['target_ta', 2099, 1, '', '', '', 'S1', null, null, 1]])}, 'uji')`,
        ms: `EXEC sementrack.target_simpan N'apa', ${jsonMs([['target_ta', 2099, 1, '', '', '', 'S1', null, null, 1]])}, N'uji'` },
    ],
  },
];
