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
  transaksi: [
    { nama: 'v_toko_month_status per tahun, bulan', kunci: 2,
      pg: `select year, month, count(*) baris, sum(net_amount) net, round(sum(tonase), 4) ton, sum(num_do) do_, sum(case when is_active then 1 else 0 end) aktif from public.v_toko_month_status group by year, month`,
      ms: `select [year], [month], count(*) baris, sum(net_amount) net, round(sum(tonase), 4) ton, sum(num_do) do_, sum(case when is_active = 1 then 1 else 0 end) aktif from dbo.v_toko_month_status group by [year], [month]` },
    { nama: 'v_transaksi_monthly', kunci: 4,
      pg: `select year, month, dist_code, product_code, order_qty, bonus_qty, round(total_qty, 4) ton, num_do, num_active_stores, num_lines, net_amount from public.v_transaksi_monthly`,
      ms: `select [year], [month], dist_code, product_code, order_qty, bonus_qty, round(total_qty, 4) ton, num_do, num_active_stores, num_lines, net_amount from dbo.v_transaksi_monthly` },
    { nama: 'v_distributor_summary', kunci: 1,
      pg: `select dist_code, dist_name, wilayah, tag, round(total_qty_all, 4) all_, round(total_qty_ytd, 4) ytd, num_do_ytd, num_active_stores_ytd, to_char(last_transaction, 'YYYY-MM-DD') akhir, num_salesman, net_amount_all, net_amount_ytd from public.v_distributor_summary`,
      ms: `select dist_code, dist_name, wilayah, tag, round(total_qty_all, 4) all_, round(total_qty_ytd, 4) ytd, num_do_ytd, num_active_stores_ytd, CONVERT(char(10), last_transaction, 23) akhir, num_salesman, net_amount_all, net_amount_ytd from dbo.v_distributor_summary` },
    { nama: 'v_yearly_totals', kunci: 1,
      pg: `select year, round(total_qty, 4) ton, order_qty, bonus_qty, num_do, num_active_stores, num_distributors, num_lines, net_amount from public.v_yearly_totals`,
      ms: `select [year], round(total_qty, 4) ton, order_qty, bonus_qty, num_do, num_active_stores, num_distributors, num_lines, net_amount from dbo.v_yearly_totals` },
    { nama: 'v_monthly_totals', kunci: 2,
      pg: `select year, month, round(total_qty, 4) ton, order_qty, bonus_qty, num_do, num_active_stores, num_lines, net_amount from public.v_monthly_totals`,
      ms: `select [year], [month], round(total_qty, 4) ton, order_qty, bonus_qty, num_do, num_active_stores, num_lines, net_amount from dbo.v_monthly_totals` },
    { nama: 'v_dist_monthly_totals', kunci: 3,
      pg: `select dist_code, year, month, round(total_qty, 4) ton, order_qty, num_do, num_active_stores, num_lines, net_amount from public.v_dist_monthly_totals`,
      ms: `select dist_code, [year], [month], round(total_qty, 4) ton, order_qty, num_do, num_active_stores, num_lines, net_amount from dbo.v_dist_monthly_totals` },
    { nama: 'v_salesman_performance', kunci: 4,
      pg: `select tahun, dist_code, salesman_code, month, salesman_name, status, target_ta, target_tonase, round(actual_tonase, 4) ton, actual_ta, actual_num_do, actual_omzet from sementrack.v_salesman_performance`,
      ms: `select tahun, dist_code, salesman_code, [month], salesman_name, status, target_ta, target_tonase, round(actual_tonase, 4) ton, actual_ta, actual_num_do, actual_omzet from sementrack.v_salesman_performance` },
    { nama: 'v_toko_agg per distributor', kunci: 1,
      pg: `select dist_code, count(*) toko, round(sum(total_qty), 4) ton, sum(num_do) do_, to_char(max(last_transaction), 'YYYY-MM-DD') akhir, count(last_transaction) pernah from sementrack.v_toko_agg group by dist_code`,
      ms: `select dist_code, count(*) toko, round(sum(total_qty), 4) ton, sum(num_do) do_, CONVERT(char(10), max(last_transaction), 23) akhir, count(last_transaction) pernah from sementrack.v_toko_agg group by dist_code` },
    { nama: 'v_transaksi_detail per distributor, tahun', kunci: 2,
      pg: `select dist_code, extract(year from do_date)::int th, count(*) baris, round(sum(tonase), 4) ton, sum(net_amount) net, sum(case when is_subdist then 1 else 0 end) subdist, count(salesman_name) bernama from sementrack.v_transaksi_detail group by 1, 2`,
      ms: `select dist_code, YEAR(do_date) th, count(*) baris, round(sum(tonase), 4) ton, sum(net_amount) net, sum(case when is_subdist = 1 then 1 else 0 end) subdist, count(salesman_name) bernama from sementrack.v_transaksi_detail group by dist_code, YEAR(do_date)` },
    { nama: 'v_transaksi_detail: nama salesman', kunci: 1,
      pg: `select salesman_code, max(salesman_name) nama, count(*) baris from sementrack.v_transaksi_detail where salesman_code is not null group by salesman_code`,
      ms: `select salesman_code, max(salesman_name) nama, count(*) baris from sementrack.v_transaksi_detail where salesman_code is not null group by salesman_code` },
    { nama: 'v_toko_pegangan_sales per distributor, bulan', kunci: 2,
      pg: `select dist_code, month, count(*) baris, round(sum(omset), 4) omset, sum(num_do) do_, sum(net_amount) net, sum(case when is_active then 1 else 0 end) aktif, sum(case when is_subdist then 1 else 0 end) subdist from sementrack.v_toko_pegangan_sales group by dist_code, month`,
      ms: `select dist_code, [month], count(*) baris, round(sum(omset), 4) omset, sum(num_do) do_, sum(net_amount) net, sum(case when is_active = 1 then 1 else 0 end) aktif, sum(case when is_subdist = 1 then 1 else 0 end) subdist from sementrack.v_toko_pegangan_sales group by dist_code, [month]` },
    { nama: 'dashboard_period_summary_v2 (semua, tahun ini)', kunci: 1,
      pg: `select 'x' k, round(total_qty, 4) ton, order_qty, bonus_qty, num_do, num_active_stores, num_lines, net_amount from public.dashboard_period_summary_v2(null::text[], extract(year from current_date)::int, 1, 12, null::text[])`,
      ms: `select 'x' k, round(total_qty, 4) ton, order_qty, bonus_qty, num_do, num_active_stores, num_lines, net_amount from dbo.dashboard_period_summary_v2(NULL, YEAR(GETDATE()), 1, 12, NULL)` },
    { nama: 'dashboard_period_summary_v2 (2 distributor, 1 produk, Jan-Jun tahun lalu)', kunci: 1,
      pg: `select 'x' k, round(total_qty, 4) ton, num_do, num_active_stores, num_lines, net_amount from public.dashboard_period_summary_v2(array['BKP','KTP'], extract(year from current_date)::int - 1, 1, 6, array['CMT001'])`,
      ms: `select 'x' k, round(total_qty, 4) ton, num_do, num_active_stores, num_lines, net_amount from dbo.dashboard_period_summary_v2(N'["BKP","KTP"]', YEAR(GETDATE()) - 1, 1, 6, N'["CMT001"]')` },
    { nama: 'dashboard_top_customers_v2 (semua pelanggan)', kunci: 2,
      pg: `select customer_code, dist_code, cust_name, dist_name, round(total_qty, 4) ton, num_do, net_amount from sementrack.dashboard_top_customers_v2(null::text[], extract(year from current_date)::int, 1, 12, null::text[], null)`,
      ms: `select customer_code, dist_code, cust_name, dist_name, round(total_qty, 4) ton, num_do, net_amount from sementrack.dashboard_top_customers_v2(NULL, YEAR(GETDATE()), 1, 12, NULL, NULL)` },
    { nama: 'dashboard_daily_matrix (bulan lalu)', kunci: 2,
      pg: `select to_char(do_date, 'YYYY-MM-DD') tgl, dist_code, round(total_qty, 4) ton from public.dashboard_daily_matrix(extract(year from current_date - interval '1 month')::int, extract(month from current_date - interval '1 month')::int, null::text[], null::text[])`,
      ms: `select CONVERT(char(10), do_date, 23) tgl, dist_code, round(total_qty, 4) ton from dbo.dashboard_daily_matrix(YEAR(DATEADD(month, -1, GETDATE())), MONTH(DATEADD(month, -1, GETDATE())), NULL, NULL)` },
    { nama: 'dashboard_delivery_type_breakdown', kunci: 1,
      pg: `select delivery_type, round(total_qty, 4) ton from public.dashboard_delivery_type_breakdown(null::text[], extract(year from current_date)::int, 1, 12, null::text[])`,
      ms: `select delivery_type, round(total_qty, 4) ton from dbo.dashboard_delivery_type_breakdown(NULL, YEAR(GETDATE()), 1, 12, NULL)` },
    { nama: 'dashboard_channel_breakdown', kunci: 1,
      pg: `select channel, num_do, net_amount from public.dashboard_channel_breakdown(null::text[], extract(year from current_date)::int, 1, 12, null::text[])`,
      ms: `select channel, num_do, net_amount from dbo.dashboard_channel_breakdown(NULL, YEAR(GETDATE()), 1, 12, NULL)` },
    { nama: 'dashboard_payment_breakdown', kunci: 1,
      pg: `select payment, num_do, net_amount from public.dashboard_payment_breakdown(null::text[], extract(year from current_date)::int, 1, 12, null::text[])`,
      ms: `select payment, num_do, net_amount from dbo.dashboard_payment_breakdown(NULL, YEAR(GETDATE()), 1, 12, NULL)` },
    { nama: 'dashboard_toko_monthly_v2 (bulan lalu) per distributor', kunci: 1,
      pg: `select dist_code, count(*) toko, round(sum(total_qty), 4) ton, sum(num_do) do_, sum(net_amount) net, sum(case when is_active then 1 else 0 end) aktif, sum(case when is_subdist then 1 else 0 end) subdist, count(last_transaction) pernah
             from sementrack.dashboard_toko_monthly_v2(extract(year from current_date - interval '1 month')::int, extract(month from current_date - interval '1 month')::int, null::text[]) group by dist_code`,
      ms: `select dist_code, count(*) toko, round(sum(total_qty), 4) ton, sum(num_do) do_, sum(net_amount) net, sum(case when is_active = 1 then 1 else 0 end) aktif, sum(case when is_subdist = 1 then 1 else 0 end) subdist, count(last_transaction) pernah
             from sementrack.dashboard_toko_monthly_v2(YEAR(DATEADD(month, -1, GETDATE())), MONTH(DATEADD(month, -1, GETDATE())), NULL) group by dist_code` },
    { nama: 'dashboard_store_year (toko paling sering belanja)', kunci: 1,
      pg: `select f.month, round(f.total_qty, 4) ton, f.net_amount, f.num_do, f.is_active, f.is_subdist
             from (select customer_code c from transaksi where customer_code is not null group by customer_code order by count(*) desc, customer_code limit 1) x,
                  sementrack.dashboard_store_year(x.c, extract(year from current_date)::int) f`,
      ms: `select f.[month], round(f.total_qty, 4) ton, f.net_amount, f.num_do, f.is_active, f.is_subdist
             from (select top (1) customer_code c from dbo.transaksi where customer_code is not null group by customer_code order by count(*) desc, customer_code) x
             cross apply sementrack.dashboard_store_year(x.c, YEAR(GETDATE())) f` },
    { nama: 'dashboard_period_summary_range (tahun ini sampai hari ini)', kunci: 1,
      pg: `select 'x' k, round(total_qty, 4) ton, order_qty, num_do, num_active_stores, num_lines, net_amount from sementrack.dashboard_period_summary_range(null::text[], date_trunc('year', current_date)::date, current_date, null::text[])`,
      ms: `select 'x' k, round(total_qty, 4) ton, order_qty, num_do, num_active_stores, num_lines, net_amount from sementrack.dashboard_period_summary_range(NULL, DATEFROMPARTS(YEAR(GETDATE()), 1, 1), CAST(GETDATE() AS date), NULL)` },
    { nama: 'dashboard_top_customers_range (100 teratas)', kunci: 1,
      pg: `select customer_code, cust_name, dist_code, dist_name, round(total_qty, 4) ton, num_do, net_amount, is_subdist from sementrack.dashboard_top_customers_range(null::text[], date_trunc('year', current_date)::date, current_date, null::text[], 100)`,
      ms: `select customer_code, cust_name, dist_code, dist_name, round(total_qty, 4) ton, num_do, net_amount, is_subdist from sementrack.dashboard_top_customers_range(NULL, DATEFROMPARTS(YEAR(GETDATE()), 1, 1), CAST(GETDATE() AS date), NULL, 100)` },
    { nama: 'dashboard_*_breakdown_range (kanal, bayar, kirim, produk)', kunci: 2,
      pg: `select 'kanal' j, channel k, num_do::numeric a, net_amount b from sementrack.dashboard_channel_breakdown_range(null::text[], date_trunc('year', current_date)::date, current_date, null::text[])
           union all select 'bayar', payment, num_do, net_amount from sementrack.dashboard_payment_breakdown_range(null::text[], date_trunc('year', current_date)::date, current_date, null::text[])
           union all select 'kirim', delivery_type, round(total_qty, 4), null from sementrack.dashboard_delivery_type_breakdown_range(null::text[], date_trunc('year', current_date)::date, current_date, null::text[])
           union all select 'produk', product_name, round(total_qty, 4), null from sementrack.dashboard_product_breakdown_range(null::text[], date_trunc('year', current_date)::date, current_date, null::text[])`,
      ms: `select 'kanal' j, channel k, CAST(num_do AS decimal(38,6)) a, net_amount b from sementrack.dashboard_channel_breakdown_range(NULL, DATEFROMPARTS(YEAR(GETDATE()), 1, 1), CAST(GETDATE() AS date), NULL)
           union all select 'bayar', payment, num_do, net_amount from sementrack.dashboard_payment_breakdown_range(NULL, DATEFROMPARTS(YEAR(GETDATE()), 1, 1), CAST(GETDATE() AS date), NULL)
           union all select 'kirim', delivery_type, round(total_qty, 4), null from sementrack.dashboard_delivery_type_breakdown_range(NULL, DATEFROMPARTS(YEAR(GETDATE()), 1, 1), CAST(GETDATE() AS date), NULL)
           union all select 'produk', product_name, round(total_qty, 4), null from sementrack.dashboard_product_breakdown_range(NULL, DATEFROMPARTS(YEAR(GETDATE()), 1, 1), CAST(GETDATE() AS date), NULL)` },
  ],
  kelola: [
    { nama: 'v_data_status', kunci: 1,
      pg: `select sumber, nama, frekuensi, to_char(data_sampai, 'YYYY-MM-DD') sampai, diperbarui, keterangan from sementrack.v_data_status where sumber not in ('sellout_bulanan', 'sellin_bulanan')`,
      ms: `select sumber, nama, frekuensi, CONVERT(char(10), data_sampai, 23) sampai, diperbarui, keterangan from sementrack.v_data_status` },
    { nama: 'v_kelola_riwayat per dataset, aksi, status', kunci: 3,
      pg: `select dataset, aksi, status, count(*) baris, sum(rows_read) dibaca, sum(rows_saved) disimpan, sum(rows_deleted) dihapus, count(dist_codes) ada_dist,
             to_char(max(created_at) at time zone 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI:SS') terakhir, to_char(min(date_from), 'YYYY-MM-DD') dari from sementrack.v_kelola_riwayat group by dataset, aksi, status`,
      ms: `select dataset, aksi, status, count(*) baris, sum(rows_read) dibaca, sum(rows_saved) disimpan, sum(rows_deleted) dihapus, count(dist_codes) ada_dist,
             CONVERT(char(19), SWITCHOFFSET(max(created_at), '+07:00'), 126) terakhir, CONVERT(char(10), min(date_from), 23) dari from sementrack.v_kelola_riwayat group by dataset, aksi, status` },
  ],
};
