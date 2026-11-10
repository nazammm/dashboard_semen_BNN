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
