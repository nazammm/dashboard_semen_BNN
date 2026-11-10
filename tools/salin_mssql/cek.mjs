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
  sellout: [
    {
      nama: 'calc_tonase pada transaksi per tahun', kunci: 1,
      pg: `select extract(year from do_date)::int k, count(*) n, round(sum(public.calc_tonase(product_code, order_qty)), 4) ton from transaksi group by 1`,
      ms: `select YEAR(do_date) k, COUNT(*) n, ROUND(SUM(dbo.calc_tonase(product_code, order_qty)), 4) ton from dbo.transaksi group by YEAR(do_date)`,
    },
    {
      nama: 'v_sellout_bnn_peta: sumber dan jenis', kunci: 1,
      pg: `select id, urutan, region, nama, sumber, jenis, dofas_tipe, erp_kode, target_region, target_key from sementrack.v_sellout_bnn_peta`,
    },
    {
      nama: 'v_sellout_bnn_peta: kode DO FAS', kunci: 1,
      pg: `select id, array_to_string(dofas_kode, ',') kode from sementrack.v_sellout_bnn_peta`,
      ms: `select p.id, (select STRING_AGG(CAST(j.[value] AS nvarchar(200)), ',') WITHIN GROUP (ORDER BY CAST(j.[key] AS int)) from OPENJSON(p.dofas_kode) j) kode from sementrack.v_sellout_bnn_peta p`,
    },
    {
      nama: 'v_sellout_j073_baris per asal, tahun, bulan, tipe, daerah', kunci: 5,
      pg: `select asal, tahun, bulan, tipe, peta_id, count(*) baris, round(sum(ton), 4) ton, sum(net) net from sementrack.v_sellout_j073_baris group by asal, tahun, bulan, tipe, peta_id`,
    },
    {
      nama: 'v_sellout_bnn_monthly per daerah, tahun, bulan, tipe, sumber', kunci: 5,
      pg: `select peta_id, tahun, bulan, tipe, sumber, round(sum(ton), 4) ton from sementrack.v_sellout_bnn_monthly group by peta_id, tahun, bulan, tipe, sumber`,
    },
    {
      nama: 'v_sellout_bnn_monthly per tahun, sumber', kunci: 2,
      pg: `select tahun, sumber, count(*) baris, round(sum(ton), 4) ton from sementrack.v_sellout_bnn_monthly group by tahun, sumber`,
    },
    {
      nama: 'v_sellout_bnn_ta per daerah, tahun, bulan, tipe', kunci: 4,
      pg: `select peta_id, tahun, bulan, tipe, ta, ta_sd from sementrack.v_sellout_bnn_ta`,
    },
    {
      nama: 'v_target_sell_out per tahun, region, tipe', kunci: 3,
      pg: `select tahun, region, tipe, count(*) baris, sum(target_ton) target_ton, sum(realisasi_ton) realisasi_ton, sum(target_ta) target_ta, sum(realisasi_ta) realisasi_ta
             from sementrack.v_target_sell_out group by tahun, region, tipe`,
    },
    {
      nama: 'v_target_dist', kunci: 3,
      pg: `select tahun, dist_code, month_num, month, target, target_ta from sementrack.v_target_dist`,
      ms: `select tahun, dist_code, month_num, [month], target, target_ta from sementrack.v_target_dist`,
    },
    {
      nama: 'v_target_ringkas', kunci: 3,
      pg: `select jenis, metrik, tahun, array_to_string(bulan, ',') bulan, baris, total from sementrack.v_target_ringkas`,
      ms: `select jenis, metrik, tahun, REPLACE(REPLACE(bulan, '[', ''), ']', '') bulan, baris, total from sementrack.v_target_ringkas`,
    },
  ],
};
