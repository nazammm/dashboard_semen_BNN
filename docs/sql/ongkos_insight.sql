-- ============================================================================
-- ongkos_insight.sql · Ongkos Kirim lebih tepat (PostgreSQL; kembaran docs/mssql/20_ongkos_insight.sql)
-- - Angkutan ke gudang (baris ORDB019 tanpa No DO, "-") dipisah dari ongkos ke toko.
-- - Status transporter: normal / armada_sendiri (biaya di luar ERP, mis. LAM) / truk_toko (Eks. Toko, memang tanpa biaya).
-- - Ongkir dibayar toko: rincian Delivery di J073 kalau diisi; kalau kosong pada DO kirim, dari harga:
--   Product Price - harga Loco Net (harga_loco) pada tanggal DO (minimal 0).
-- Jalankan setelah ongkos_kirim.sql dan harga_loco.sql, lalu logistik.sql.
-- ============================================================================
begin;

create table if not exists sementrack.ongkos_transporter (
  kode text primary key,                       -- kode di depan nama transporter ORDB019 (BMM055, ISA061, ...)
  status text not null check (status in ('normal', 'armada_sendiri', 'truk_toko')),
  catatan text
);
insert into sementrack.ongkos_transporter (kode, status, catatan)
select v.a, 'armada_sendiri', v.b from (values ('ISA001', 'truk INSA sendiri'), ('ISA066', 'mobil internal BNN Group')) v(a, b)
where not exists (select 1 from sementrack.ongkos_transporter t where t.kode = v.a);
create index if not exists harga_loco_produk_idx on sementrack.harga_loco (dist_code, product_code, berlaku_dari);

-- View v_ongkos_trip / v_ongkos_do / v_ongkos_info ada di logistik.sql (rekap logistik sebagai sumber biaya kedua); jalankan sesudah file ini.

commit;
