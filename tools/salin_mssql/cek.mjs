// Daftar pemeriksaan untuk mode --banding: query yang sama di PostgreSQL (pg) dan SQL Server (ms).
// kunci = jumlah kolom pertama yang menjadi kunci baris; kolom sesudahnya dibandingkan (angka dengan toleransi kecil).
// Tanggal selalu diubah ke teks di query supaya tidak ada geser zona waktu.

const tglPg = c => `to_char(${c}, 'YYYY-MM-DD')`;
const tglMs = c => `CONVERT(char(10), ${c}, 23)`;

export const CEK = {
  sellin: [
    {
      nama: 'sellin_bnn: ton per tahun (kolom terhitung)', kunci: 1,
      pg: `select extract(year from tanggal)::int k, count(*) n, round(sum(ton), 3) ton, sum(delivery_qty) zak from sementrack.sellin_bnn group by 1`,
      ms: `select YEAR(tanggal) k, COUNT(*) n, ROUND(SUM(ton), 3) ton, SUM(delivery_qty) zak from sementrack.sellin_bnn group by YEAR(tanggal)`,
    },
    {
      nama: 'v_sellin_bnn_daily per region', kunci: 1,
      pg: `select region, count(*) baris, sum(ton) ton, sum(zak) zak, sum(pengiriman) kirim from sementrack.v_sellin_bnn_daily group by region`,
    },
    {
      nama: 'v_sellin_bnn_daily per tipe pesanan, loco/franco, produk', kunci: 3,
      pg: `select tipe_pesanan, loco_franco, produk, count(*) baris, sum(ton) ton, sum(pengiriman) kirim from sementrack.v_sellin_bnn_daily group by tipe_pesanan, loco_franco, produk`,
    },
    {
      nama: 'v_sellin_bnn_daily per bulan', kunci: 1,
      pg: `select to_char(tanggal, 'YYYY-MM') bln, sum(ton) ton, sum(zak) zak from sementrack.v_sellin_bnn_daily group by 1`,
      ms: `select bln, SUM(ton) ton, SUM(zak) zak from (select CONVERT(char(7), tanggal, 126) bln, ton, zak from sementrack.v_sellin_bnn_daily) x group by bln`,
    },
    {
      nama: 'v_sellin_bnn_info', kunci: 1,
      pg: `select 'info' k, ${tglPg('data_mulai')} mulai, ${tglPg('data_sampai')} sampai, total_baris, upload_oleh from sementrack.v_sellin_bnn_info`,
      ms: `select 'info' k, ${tglMs('data_mulai')} mulai, ${tglMs('data_sampai')} sampai, total_baris, upload_oleh from sementrack.v_sellin_bnn_info`,
    },
    {
      nama: 'v_sellin_unmapped', kunci: 1,
      pg: `select kode_customer, pengiriman, ton from sementrack.v_sellin_unmapped`,
    },
    {
      nama: 'v_outstanding_do per region, jalur, status, semen', kunci: 4,
      pg: `select region, jalur, status, semen, count(*) orders, sum(sisa_zak) sisa_zak, sum(sisa_ton) sisa_ton, sum(order_ton) order_ton,
             sum(umur_hari) umur, sum(lewat_hari) lewat from sementrack.v_outstanding_do group by region, jalur, status, semen`,
    },
    {
      nama: 'v_outstanding_do: nama distributor rapi', kunci: 2,
      pg: `select distributor, dist_nama, count(*) orders from sementrack.v_outstanding_do group by distributor, dist_nama`,
    },
    {
      nama: 'v_outstanding_do: tipe pesanan, loco/franco', kunci: 2,
      pg: `select tipe_pesanan, loco_franco, count(*) orders, sum(sisa_ton) ton from sementrack.v_outstanding_do group by tipe_pesanan, loco_franco`,
    },
    {
      nama: 'v_outstanding_do_ringkas', kunci: 3,
      pg: `select region, status, jalur, count(*) baris, sum(orders) orders, sum(ton) ton from sementrack.v_outstanding_do_ringkas group by region, status, jalur`,
    },
    {
      nama: 'v_outstanding_do_info', kunci: 1,
      pg: `select 'info' k, ${tglPg('posisi')} posisi, ${tglPg('posisi_terlama')} terlama, ${tglPg('order_mulai')} mulai, ${tglPg('order_sampai')} sampai, total_order, upload_oleh from sementrack.v_outstanding_do_info`,
      ms: `select 'info' k, ${tglMs('posisi')} posisi, ${tglMs('posisi_terlama')} terlama, ${tglMs('order_mulai')} mulai, ${tglMs('order_sampai')} sampai, total_order, upload_oleh from sementrack.v_outstanding_do_info`,
    },
    {
      nama: 'v_sellin_po_bulanan per tahun, bulan, semen', kunci: 3,
      pg: `select tahun, bulan, semen, sum(order_ton) dipesan, sum(terkirim_ton) terkirim, sum(outstanding_ton) outstanding,
             sum(belum_verifikasi_ton) belum_verif, sum(reject_ton) reject from sementrack.v_sellin_po_bulanan group by tahun, bulan, semen`,
    },
    {
      nama: 'v_sellin_po_bulanan per region, distributor', kunci: 2,
      pg: `select region, distributor, count(*) baris, sum(order_ton) dipesan, sum(outstanding_ton) outstanding from sementrack.v_sellin_po_bulanan group by region, distributor`,
    },
    {
      nama: 'v_target_sell_in per tahun, tipe', kunci: 2,
      pg: `select tahun, tipe, count(*) baris, sum(target) target, sum(realisasi) realisasi from sementrack.v_target_sell_in group by tahun, tipe`,
    },
  ],
};
