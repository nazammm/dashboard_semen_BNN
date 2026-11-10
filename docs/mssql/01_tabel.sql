-- =====================================================================
-- SQL Server 2022: struktur tabel dashboard (hasil tools/pg_ke_mssql_tabel.py, jangan disunting manual).
-- Schema: dbo (dulu public), sementrack, auth_local. Jalankan di database MARKETING_ANALIS. Aman dijalankan ulang:
-- tabel yang sudah ada dilewati. Kolom array PostgreSQL disimpan sebagai teks JSON (["a","b"]).
-- =====================================================================
IF SCHEMA_ID(N'sementrack') IS NULL EXEC(N'CREATE SCHEMA sementrack');
IF SCHEMA_ID(N'auth_local') IS NULL EXEC(N'CREATE SCHEMA auth_local');
GO

IF OBJECT_ID(N'dbo.distributor', N'U') IS NULL
CREATE TABLE [dbo].[distributor] (
  [dist_code] nvarchar(50) NOT NULL,
  [dist_name] nvarchar(200) NULL,
  [wilayah] nvarchar(200) NULL,
  [tag] nvarchar(200) NULL,
  [source] nvarchar(200) NULL,
  CONSTRAINT [PK_distributor] PRIMARY KEY ([dist_code])
);
GO

IF OBJECT_ID(N'dbo.produk', N'U') IS NULL
CREATE TABLE [dbo].[produk] (
  [kode] nvarchar(50) NOT NULL,
  [nama] nvarchar(200) NULL,
  [jenis] nvarchar(200) NULL,
  CONSTRAINT [PK_produk] PRIMARY KEY ([kode])
);
GO

IF OBJECT_ID(N'dbo.toko', N'U') IS NULL
CREATE TABLE [dbo].[toko] (
  [dist_code] nvarchar(50) NULL,
  [dist_name] nvarchar(200) NULL,
  [cust_name] nvarchar(200) NULL,
  [latitude] float NULL,
  [longitude] float NULL,
  [cust_code] nvarchar(50) NOT NULL,
  [zona] nvarchar(200) NULL,
  CONSTRAINT [PK_toko] PRIMARY KEY ([cust_code]),
  CONSTRAINT [UQ_toko_dist_cust_unique] UNIQUE ([dist_code], [cust_code])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_toko_cust_code' AND object_id = OBJECT_ID(N'dbo.toko'))
  CREATE INDEX [idx_toko_cust_code] ON [dbo].[toko] ([cust_code]);

IF OBJECT_ID(N'dbo.transaksi', N'U') IS NULL
CREATE TABLE [dbo].[transaksi] (
  [dist_code] nvarchar(50) NULL,
  [distributor_name] nvarchar(200) NULL,
  [do_date] date NULL,
  [do_no] nvarchar(200) NOT NULL,
  [payment] nvarchar(200) NULL,
  [customer_code] nvarchar(50) NULL,
  [customer_name] nvarchar(200) NULL,
  [delivery_type] nvarchar(200) NULL,
  [product_code] nvarchar(50) NULL,
  [product_name] nvarchar(200) NULL,
  [destination] nvarchar(200) NULL,
  [order_qty] decimal(20,6) NULL,
  [bonus_qty] decimal(20,6) NULL,
  [total_qty] decimal(20,6) NULL,
  [salesman_code] nvarchar(50) NULL,
  [mss_no_order] nvarchar(200) NULL,
  [parent_customer_code] nvarchar(50) NULL,
  [parent_customer_name] nvarchar(200) NULL,
  [cust_group] nvarchar(200) NULL,
  [net_amount] decimal(20,6) NULL,
  [sales_tim] nvarchar(200) NULL,
  [pelunasan_hari] decimal(20,6) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_transaksi_product' AND object_id = OBJECT_ID(N'dbo.transaksi'))
  CREATE INDEX [idx_transaksi_product] ON [dbo].[transaksi] ([product_code]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_transaksi_net_amount' AND object_id = OBJECT_ID(N'dbo.transaksi'))
  CREATE INDEX [idx_transaksi_net_amount] ON [dbo].[transaksi] ([customer_code], [do_date], [net_amount]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_transaksi_dist' AND object_id = OBJECT_ID(N'dbo.transaksi'))
  CREATE INDEX [idx_transaksi_dist] ON [dbo].[transaksi] ([dist_code]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_transaksi_product_ym' AND object_id = OBJECT_ID(N'dbo.transaksi'))
  CREATE INDEX [idx_transaksi_product_ym] ON [dbo].[transaksi] ([product_code], [do_date]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_transaksi_ym' AND object_id = OBJECT_ID(N'dbo.transaksi'))
  CREATE INDEX [idx_transaksi_ym] ON [dbo].[transaksi] ([do_date]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_transaksi_salesman' AND object_id = OBJECT_ID(N'dbo.transaksi'))
  CREATE INDEX [idx_transaksi_salesman] ON [dbo].[transaksi] ([salesman_code]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_transaksi_parent_customer' AND object_id = OBJECT_ID(N'dbo.transaksi'))
  CREATE INDEX [idx_transaksi_parent_customer] ON [dbo].[transaksi] ([parent_customer_code]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_transaksi_dist_ym' AND object_id = OBJECT_ID(N'dbo.transaksi'))
  CREATE INDEX [idx_transaksi_dist_ym] ON [dbo].[transaksi] ([dist_code], [do_date]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_transaksi_customer_do_date' AND object_id = OBJECT_ID(N'dbo.transaksi'))
  CREATE INDEX [idx_transaksi_customer_do_date] ON [dbo].[transaksi] ([customer_code], [do_date]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_transaksi_customer' AND object_id = OBJECT_ID(N'dbo.transaksi'))
  CREATE INDEX [idx_transaksi_customer] ON [dbo].[transaksi] ([customer_code]);

IF OBJECT_ID(N'dbo.status_sync', N'U') IS NULL
CREATE TABLE [dbo].[status_sync] (
  [id] int NOT NULL CONSTRAINT [DF_status_sync_id] DEFAULT (1),
  [tanggal_update] date NOT NULL CONSTRAINT [DF_status_sync_tanggal_update] DEFAULT (cast(sysdatetimeoffset() as date)),
  [jam_update] time(0) NOT NULL CONSTRAINT [DF_status_sync_jam_update] DEFAULT (cast(sysdatetimeoffset() as time(0))),
  [keterangan] nvarchar(200) NULL,
  CONSTRAINT [CK_status_sync_single_row] CHECK ((id = 1)),
  CONSTRAINT [PK_status_sync] PRIMARY KEY ([id])
);
GO

IF OBJECT_ID(N'dbo.toko_pegangan_sales', N'U') IS NULL
CREATE TABLE [dbo].[toko_pegangan_sales] (
  [month] nvarchar(200) NULL,
  [dist_code] nvarchar(200) NULL,
  [dist_name] nvarchar(200) NULL,
  [salesman_code] nvarchar(200) NULL,
  [cust_code] nvarchar(200) NULL,
  [cust_name] nvarchar(200) NULL
);
GO

IF OBJECT_ID(N'dbo.salesman_status_target', N'U') IS NULL
CREATE TABLE [dbo].[salesman_status_target] (
  [dist_code] nvarchar(50) NULL,
  [salesman_code] nvarchar(50) NULL,
  [salesman_name] nvarchar(200) NULL,
  [Month] int NULL,
  [Target TA] decimal(20,6) NULL,
  [Target Tonase] decimal(20,6) NULL,
  [status] nvarchar(200) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_salesman_status_target_salesman' AND object_id = OBJECT_ID(N'dbo.salesman_status_target'))
  CREATE INDEX [idx_salesman_status_target_salesman] ON [dbo].[salesman_status_target] ([salesman_code]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'idx_salesman_status_target_dist' AND object_id = OBJECT_ID(N'dbo.salesman_status_target'))
  CREATE INDEX [idx_salesman_status_target_dist] ON [dbo].[salesman_status_target] ([dist_code]);

IF OBJECT_ID(N'sementrack.distributor_target_salesman', N'U') IS NULL
CREATE TABLE [sementrack].[distributor_target_salesman] (
  [dist_code] nvarchar(50) NOT NULL,
  [dist_name] nvarchar(200) NULL,
  [target_salesman] int NULL,
  CONSTRAINT [PK_distributor_target_salesman] PRIMARY KEY ([dist_code])
);
GO

IF OBJECT_ID(N'sementrack.toko_distributor', N'U') IS NULL
CREATE TABLE [sementrack].[toko_distributor] (
  [cust_code] nvarchar(50) NOT NULL,
  [dist_code] nvarchar(50) NOT NULL,
  [sumber] nvarchar(200) NULL,
  [created_at] datetimeoffset(3) NULL CONSTRAINT [DF_toko_distributor_created_at] DEFAULT (sysdatetimeoffset()),
  CONSTRAINT [PK_toko_distributor] PRIMARY KEY ([cust_code], [dist_code])
);
GO

IF OBJECT_ID(N'sementrack.subdist_customer', N'U') IS NULL
CREATE TABLE [sementrack].[subdist_customer] (
  [dist_code] nvarchar(50) NOT NULL,
  [customer_code] nvarchar(50) NOT NULL,
  [subdist] nvarchar(200) NOT NULL,
  CONSTRAINT [PK_subdist_customer] PRIMARY KEY ([dist_code], [customer_code])
);
GO

IF OBJECT_ID(N'sementrack.kelola_log', N'U') IS NULL
CREATE TABLE [sementrack].[kelola_log] (
  [id] bigint IDENTITY(1,1) NOT NULL,
  [dataset] nvarchar(200) NOT NULL,
  [aksi] nvarchar(200) NOT NULL,
  [created_at] datetimeoffset(3) NOT NULL CONSTRAINT [DF_kelola_log_created_at] DEFAULT (sysdatetimeoffset()),
  [created_by] nvarchar(200) NOT NULL,
  [source] nvarchar(200) NULL,
  [file_name] nvarchar(200) NULL,
  [date_from] date NOT NULL,
  [date_to] date NOT NULL,
  [dist_codes] nvarchar(max) NULL CONSTRAINT [CK_kelola_log_dist_codes_json] CHECK ([dist_codes] IS NULL OR ISJSON([dist_codes]) = 1),
  [rows_read] int NULL,
  [rows_staged] int NOT NULL CONSTRAINT [DF_kelola_log_rows_staged] DEFAULT (0),
  [rows_saved] int NULL,
  [rows_deleted] int NULL,
  [status] nvarchar(200) NOT NULL CONSTRAINT [DF_kelola_log_status] DEFAULT (N'proses'),
  [finished_at] datetimeoffset(3) NULL,
  CONSTRAINT [CK_kelola_log_status_check] CHECK ((status IN (N'proses', N'selesai', N'batal'))),
  CONSTRAINT [CK_kelola_log_check] CHECK ((date_from <= date_to)),
  CONSTRAINT [PK_kelola_log] PRIMARY KEY ([id]),
  CONSTRAINT [CK_kelola_log_dataset_check] CHECK ((dataset IN (N'transaksi', N'sellin', N'dofas', N'erp', N'j073', N'target', N'outstanding', N'tabel'))),
  CONSTRAINT [CK_kelola_log_aksi_check] CHECK ((aksi IN (N'upload', N'hapus', N'ubah')))
);
GO

IF OBJECT_ID(N'sementrack.transaksi_staging', N'U') IS NULL
CREATE TABLE [sementrack].[transaksi_staging] (
  [log_id] bigint NOT NULL,
  [dist_code] nvarchar(200) NULL,
  [distributor_name] nvarchar(200) NULL,
  [do_date] date NULL,
  [do_no] nvarchar(200) NULL,
  [mss_no_order] nvarchar(200) NULL,
  [payment] nvarchar(200) NULL,
  [customer_code] nvarchar(200) NULL,
  [customer_name] nvarchar(200) NULL,
  [parent_customer_code] nvarchar(200) NULL,
  [parent_customer_name] nvarchar(200) NULL,
  [cust_group] nvarchar(200) NULL,
  [delivery_type] nvarchar(200) NULL,
  [product_code] nvarchar(200) NULL,
  [product_name] nvarchar(200) NULL,
  [destination] nvarchar(200) NULL,
  [order_qty] decimal(20,6) NULL,
  [bonus_qty] decimal(20,6) NULL,
  [total_qty] decimal(20,6) NULL,
  [net_amount] decimal(20,6) NULL,
  [salesman_code] nvarchar(200) NULL,
  [sales_tim] nvarchar(200) NULL,
  [pelunasan_hari] decimal(20,6) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'transaksi_staging_log_idx' AND object_id = OBJECT_ID(N'sementrack.transaksi_staging'))
  CREATE INDEX [transaksi_staging_log_idx] ON [sementrack].[transaksi_staging] ([log_id]);

IF OBJECT_ID(N'sementrack.target', N'U') IS NULL
CREATE TABLE [sementrack].[target] (
  [jenis] nvarchar(50) NOT NULL,
  [metrik] nvarchar(50) NOT NULL,
  [tahun] int NOT NULL,
  [bulan] int NOT NULL,
  [region] nvarchar(50) NOT NULL CONSTRAINT [DF_target_region] DEFAULT (N''),
  [area] nvarchar(50) NOT NULL CONSTRAINT [DF_target_area] DEFAULT (N''),
  [tipe] nvarchar(50) NOT NULL CONSTRAINT [DF_target_tipe] DEFAULT (N''),
  [kode] nvarchar(50) NOT NULL CONSTRAINT [DF_target_kode] DEFAULT (N''),
  [nama] nvarchar(200) NULL,
  [status] nvarchar(200) NULL,
  [nilai] decimal(20,6) NOT NULL,
  [diperbarui] datetimeoffset(3) NOT NULL CONSTRAINT [DF_target_diperbarui] DEFAULT (sysdatetimeoffset()),
  CONSTRAINT [CK_target_jenis_check] CHECK ((jenis IN (N'sell_in', N'sell_out', N'distributor', N'salesman'))),
  CONSTRAINT [CK_target_metrik_check] CHECK ((metrik IN (N'target_ton', N'realisasi_ton', N'target_ta', N'realisasi_ta'))),
  CONSTRAINT [CK_target_tahun_check] CHECK (((tahun >= 2000) AND (tahun <= 2100))),
  CONSTRAINT [CK_target_bulan_check] CHECK (((bulan >= 1) AND (bulan <= 12))),
  CONSTRAINT [PK_target] PRIMARY KEY NONCLUSTERED ([jenis], [metrik], [tahun], [bulan], [region], [area], [tipe], [kode])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'target_tahun_idx' AND object_id = OBJECT_ID(N'sementrack.target'))
  CREATE INDEX [target_tahun_idx] ON [sementrack].[target] ([jenis], [tahun]);

IF OBJECT_ID(N'sementrack.tabel_edit', N'U') IS NULL
CREATE TABLE [sementrack].[tabel_edit] (
  [id] nvarchar(50) NOT NULL,
  [urutan] int NOT NULL CONSTRAINT [DF_tabel_edit_urutan] DEFAULT (100),
  [grup] nvarchar(200) NOT NULL,
  [label] nvarchar(200) NOT NULL,
  [keterangan] nvarchar(400) NULL,
  [objek] nvarchar(200) NOT NULL,
  [pk] nvarchar(max) NOT NULL CONSTRAINT [CK_tabel_edit_pk_json] CHECK ([pk] IS NULL OR ISJSON([pk]) = 1),
  [kolom] nvarchar(max) NOT NULL CONSTRAINT [CK_tabel_edit_kolom_json] CHECK ([kolom] IS NULL OR ISJSON([kolom]) = 1),
  [filter] nvarchar(max) NOT NULL CONSTRAINT [DF_tabel_edit_filter] DEFAULT (N'[]') CONSTRAINT [CK_tabel_edit_filter_json] CHECK ([filter] IS NULL OR ISJSON([filter]) = 1),
  [urut] nvarchar(200) NOT NULL,
  [aktif] bit NOT NULL CONSTRAINT [DF_tabel_edit_aktif] DEFAULT (1),
  CONSTRAINT [PK_tabel_edit] PRIMARY KEY ([id])
);
GO

IF OBJECT_ID(N'sementrack.sellin_bnn_upload', N'U') IS NULL
CREATE TABLE [sementrack].[sellin_bnn_upload] (
  [id] bigint IDENTITY(1,1) NOT NULL,
  [created_at] datetimeoffset(3) NOT NULL CONSTRAINT [DF_sellin_bnn_upload_created_at] DEFAULT (sysdatetimeoffset()),
  [created_by] nvarchar(200) NOT NULL,
  [source] nvarchar(200) NOT NULL,
  [file_name] nvarchar(200) NULL,
  [date_from] date NOT NULL,
  [date_to] date NOT NULL,
  [rows_read] int NOT NULL CONSTRAINT [DF_sellin_bnn_upload_rows_read] DEFAULT (0),
  [rows_staged] int NOT NULL CONSTRAINT [DF_sellin_bnn_upload_rows_staged] DEFAULT (0),
  [rows_saved] int NULL,
  [rows_replaced] int NULL,
  [ton_saved] decimal(20,6) NULL,
  [status] nvarchar(200) NOT NULL CONSTRAINT [DF_sellin_bnn_upload_status] DEFAULT (N'proses'),
  [finished_at] datetimeoffset(3) NULL,
  CONSTRAINT [CK_sellin_bnn_upload_source_check] CHECK ((source IN (N'file', N'tempel'))),
  CONSTRAINT [CK_sellin_bnn_upload_status_check] CHECK ((status IN (N'proses', N'selesai', N'batal'))),
  CONSTRAINT [CK_sellin_bnn_upload_check] CHECK ((date_from <= date_to)),
  CONSTRAINT [PK_sellin_bnn_upload] PRIMARY KEY ([id])
);
GO

IF OBJECT_ID(N'sementrack.sellin_bnn', N'U') IS NULL
CREATE TABLE [sementrack].[sellin_bnn] (
  [id] bigint IDENTITY(1,1) NOT NULL,
  [upload_id] bigint NOT NULL,
  [tanggal] date NOT NULL,
  [tanggal_order] date NULL,
  [distributor] nvarchar(200) NOT NULL,
  [kode_customer] nvarchar(200) NOT NULL,
  [nama_customer] nvarchar(200) NULL,
  [tipe_pesanan] nvarchar(200) NOT NULL,
  [tipe_produk] nvarchar(200) NOT NULL,
  [asal_pengiriman] nvarchar(200) NULL,
  [kode_tujuan] nvarchar(200) NULL,
  [nama_tujuan] nvarchar(200) NULL,
  [kota_tujuan] nvarchar(200) NULL,
  [loco_franco] nvarchar(200) NULL,
  [order_no] nvarchar(200) NULL,
  [sdo] nvarchar(200) NULL,
  [nomor_truk] nvarchar(200) NULL,
  [zona_group] nvarchar(200) NULL,
  [status_order] nvarchar(200) NULL,
  [delivery_qty] decimal(20,6) NOT NULL,
  [ton] decimal(20,6) NULL,
  CONSTRAINT [PK_sellin_bnn] PRIMARY KEY ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sellin_bnn_tanggal_idx' AND object_id = OBJECT_ID(N'sementrack.sellin_bnn'))
  CREATE INDEX [sellin_bnn_tanggal_idx] ON [sementrack].[sellin_bnn] ([tanggal]);

IF OBJECT_ID(N'sementrack.sellin_bnn_staging', N'U') IS NULL
CREATE TABLE [sementrack].[sellin_bnn_staging] (
  [upload_id] bigint NOT NULL,
  [tanggal] date NOT NULL,
  [tanggal_order] date NULL,
  [distributor] nvarchar(200) NOT NULL,
  [kode_customer] nvarchar(200) NOT NULL,
  [nama_customer] nvarchar(200) NULL,
  [tipe_pesanan] nvarchar(200) NOT NULL,
  [tipe_produk] nvarchar(200) NOT NULL,
  [asal_pengiriman] nvarchar(200) NULL,
  [kode_tujuan] nvarchar(200) NULL,
  [nama_tujuan] nvarchar(200) NULL,
  [kota_tujuan] nvarchar(200) NULL,
  [loco_franco] nvarchar(200) NULL,
  [order_no] nvarchar(200) NULL,
  [sdo] nvarchar(200) NULL,
  [nomor_truk] nvarchar(200) NULL,
  [zona_group] nvarchar(200) NULL,
  [status_order] nvarchar(200) NULL,
  [delivery_qty] decimal(20,6) NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sellin_bnn_staging_upload_idx' AND object_id = OBJECT_ID(N'sementrack.sellin_bnn_staging'))
  CREATE INDEX [sellin_bnn_staging_upload_idx] ON [sementrack].[sellin_bnn_staging] ([upload_id]);

IF OBJECT_ID(N'sementrack.sellin_region_map', N'U') IS NULL
CREATE TABLE [sementrack].[sellin_region_map] (
  [kode_customer] nvarchar(50) NOT NULL,
  [region] nvarchar(200) NOT NULL,
  [nama_customer] nvarchar(200) NULL,
  [updated_at] datetimeoffset(3) NOT NULL CONSTRAINT [DF_sellin_region_map_updated_at] DEFAULT (sysdatetimeoffset()),
  [updated_by] nvarchar(200) NULL,
  CONSTRAINT [CK_sellin_region_map_region_check] CHECK ((trim(region) <> N'')),
  CONSTRAINT [PK_sellin_region_map] PRIMARY KEY ([kode_customer])
);
GO

IF OBJECT_ID(N'sementrack.sellin_po_upload', N'U') IS NULL
CREATE TABLE [sementrack].[sellin_po_upload] (
  [id] bigint IDENTITY(1,1) NOT NULL,
  [created_at] datetimeoffset(3) NOT NULL CONSTRAINT [DF_sellin_po_upload_created_at] DEFAULT (sysdatetimeoffset()),
  [created_by] nvarchar(200) NOT NULL,
  [source] nvarchar(200) NOT NULL,
  [file_name] nvarchar(200) NULL,
  [date_from] date NOT NULL,
  [date_to] date NOT NULL,
  [rows_read] int NOT NULL CONSTRAINT [DF_sellin_po_upload_rows_read] DEFAULT (0),
  [rows_staged] int NOT NULL CONSTRAINT [DF_sellin_po_upload_rows_staged] DEFAULT (0),
  [rows_saved] int NULL,
  [rows_replaced] int NULL,
  [posisi] date NULL,
  [status] nvarchar(200) NOT NULL CONSTRAINT [DF_sellin_po_upload_status] DEFAULT (N'proses'),
  [finished_at] datetimeoffset(3) NULL,
  CONSTRAINT [CK_sellin_po_upload_source_check] CHECK ((source IN (N'file', N'tempel'))),
  CONSTRAINT [CK_sellin_po_upload_status_check] CHECK ((status IN (N'proses', N'selesai', N'batal'))),
  CONSTRAINT [CK_sellin_po_upload_check] CHECK ((date_from <= date_to)),
  CONSTRAINT [PK_sellin_po_upload] PRIMARY KEY ([id])
);
GO

IF OBJECT_ID(N'sementrack.sellin_po', N'U') IS NULL
CREATE TABLE [sementrack].[sellin_po] (
  [upload_id] bigint NOT NULL,
  [distributor] nvarchar(100) NOT NULL,
  [order_no] nvarchar(50) NOT NULL,
  [tipe_produk] nvarchar(50) NOT NULL,
  [tanggal_order] date NOT NULL,
  [estimasi_kirim] date NULL,
  [kirim_terakhir] date NULL,
  [status_order] nvarchar(50) NOT NULL,
  [alasan_reject] nvarchar(200) NULL,
  [kode_customer] nvarchar(200) NOT NULL,
  [nama_customer] nvarchar(200) NULL,
  [tipe_pesanan] nvarchar(200) NOT NULL,
  [asal_pengiriman] nvarchar(200) NULL,
  [kode_tujuan] nvarchar(200) NULL,
  [nama_tujuan] nvarchar(200) NULL,
  [kota_tujuan] nvarchar(200) NULL,
  [loco_franco] nvarchar(200) NULL,
  [order_qty] decimal(20,6) NOT NULL,
  [delivery_qty] decimal(20,6) NOT NULL CONSTRAINT [DF_sellin_po_delivery_qty] DEFAULT (0),
  [pengiriman] int NOT NULL CONSTRAINT [DF_sellin_po_pengiriman] DEFAULT (0),
  CONSTRAINT [PK_sellin_po] PRIMARY KEY NONCLUSTERED ([distributor], [order_no], [tipe_produk])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sellin_po_tanggal_idx' AND object_id = OBJECT_ID(N'sementrack.sellin_po'))
  CREATE INDEX [sellin_po_tanggal_idx] ON [sementrack].[sellin_po] ([tanggal_order]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sellin_po_status_idx' AND object_id = OBJECT_ID(N'sementrack.sellin_po'))
  CREATE INDEX [sellin_po_status_idx] ON [sementrack].[sellin_po] ([status_order]);

IF OBJECT_ID(N'sementrack.sellin_po_staging', N'U') IS NULL
CREATE TABLE [sementrack].[sellin_po_staging] (
  [upload_id] bigint NOT NULL,
  [tanggal_order] date NOT NULL,
  [distributor] nvarchar(200) NOT NULL,
  [order_no] nvarchar(200) NOT NULL,
  [tipe_produk] nvarchar(200) NOT NULL,
  [status_order] nvarchar(200) NOT NULL,
  [estimasi_kirim] date NULL,
  [tanggal_kirim] date NULL,
  [alasan_reject] nvarchar(200) NULL,
  [kode_customer] nvarchar(200) NOT NULL,
  [nama_customer] nvarchar(200) NULL,
  [tipe_pesanan] nvarchar(200) NOT NULL,
  [asal_pengiriman] nvarchar(200) NULL,
  [kode_tujuan] nvarchar(200) NULL,
  [nama_tujuan] nvarchar(200) NULL,
  [kota_tujuan] nvarchar(200) NULL,
  [loco_franco] nvarchar(200) NULL,
  [order_qty] decimal(20,6) NULL,
  [delivery_qty] decimal(20,6) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sellin_po_staging_upload_idx' AND object_id = OBJECT_ID(N'sementrack.sellin_po_staging'))
  CREATE INDEX [sellin_po_staging_upload_idx] ON [sementrack].[sellin_po_staging] ([upload_id]);

IF OBJECT_ID(N'sementrack.sellout_bnn_peta', N'U') IS NULL
CREATE TABLE [sementrack].[sellout_bnn_peta] (
  [id] int NOT NULL,
  [urutan] int NOT NULL,
  [region] nvarchar(50) NOT NULL,
  [nama] nvarchar(50) NOT NULL,
  [j028_dist] nvarchar(200) NULL,
  [j028_mode] nvarchar(200) NULL,
  [j028_customers] nvarchar(max) NULL CONSTRAINT [CK_sellout_bnn_peta_j028_customers_json] CHECK ([j028_customers] IS NULL OR ISJSON([j028_customers]) = 1),
  [dofas_kode] nvarchar(max) NULL CONSTRAINT [CK_sellout_bnn_peta_dofas_kode_json] CHECK ([dofas_kode] IS NULL OR ISJSON([dofas_kode]) = 1),
  [dofas_tipe] nvarchar(200) NULL,
  [erp_kode] nvarchar(200) NULL,
  [j073] bit NOT NULL CONSTRAINT [DF_sellout_bnn_peta_j073] DEFAULT (0),
  [target_region] nvarchar(200) NULL,
  [target_key] nvarchar(200) NULL,
  CONSTRAINT [CK_sellout_bnn_peta_j028_mode_check] CHECK ((j028_mode IN (N'penuh', N'tanpa', N'hanya'))),
  CONSTRAINT [CK_sellout_bnn_peta_dofas_tipe_check] CHECK ((dofas_tipe IN (N'STR', N'RJW', N'CWC'))),
  CONSTRAINT [CK_sellout_bnn_peta_check] CHECK (((j028_dist IS NULL AND j028_mode IS NULL) OR (j028_dist IS NOT NULL AND j028_mode IS NOT NULL))),
  CONSTRAINT [CK_sellout_bnn_peta_check1] CHECK (((j028_mode IS DISTINCT FROM N'penuh') OR (j028_customers IS NULL))),
  CONSTRAINT [CK_sellout_bnn_peta_check2] CHECK (((j028_mode NOT IN (N'tanpa', N'hanya')) OR (json_value(j028_customers, N'$[0]') IS NOT NULL))),
  CONSTRAINT [PK_sellout_bnn_peta] PRIMARY KEY ([id]),
  CONSTRAINT [UQ_sellout_bnn_peta_region_nama_key] UNIQUE ([region], [nama])
);
GO

IF OBJECT_ID(N'sementrack.sellout_dofas', N'U') IS NULL
CREATE TABLE [sementrack].[sellout_dofas] (
  [tahun] int NOT NULL,
  [baris] int NOT NULL,
  [tipe] nvarchar(200) NOT NULL,
  [area] nvarchar(200) NULL,
  [distributor] nvarchar(200) NOT NULL,
  [keterangan] nvarchar(200) NULL,
  [bulan] int NOT NULL,
  [ton] decimal(20,6) NOT NULL,
  CONSTRAINT [CK_sellout_dofas_tahun_check] CHECK (((tahun >= 2020) AND (tahun <= 2100))),
  CONSTRAINT [CK_sellout_dofas_tipe_check] CHECK ((tipe IN (N'STR', N'RJW', N'CWC'))),
  CONSTRAINT [CK_sellout_dofas_bulan_check] CHECK (((bulan >= 1) AND (bulan <= 12))),
  CONSTRAINT [PK_sellout_dofas] PRIMARY KEY NONCLUSTERED ([tahun], [baris], [bulan])
);
GO

IF OBJECT_ID(N'sementrack.sellout_erp', N'U') IS NULL
CREATE TABLE [sementrack].[sellout_erp] (
  [tahun] int NOT NULL,
  [kode] nvarchar(50) NOT NULL,
  [nama] nvarchar(200) NULL,
  [tipe] nvarchar(200) NULL,
  [bulan] int NOT NULL,
  [ton] decimal(20,6) NOT NULL,
  CONSTRAINT [CK_sellout_erp_tahun_check] CHECK (((tahun >= 2020) AND (tahun <= 2100))),
  CONSTRAINT [CK_sellout_erp_tipe_check] CHECK ((tipe IN (N'STR', N'RJW', N'CWC'))),
  CONSTRAINT [CK_sellout_erp_bulan_check] CHECK (((bulan >= 1) AND (bulan <= 12)))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sellout_erp_tahun_idx' AND object_id = OBJECT_ID(N'sementrack.sellout_erp'))
  CREATE INDEX [sellout_erp_tahun_idx] ON [sementrack].[sellout_erp] ([tahun], [kode]);

IF OBJECT_ID(N'sementrack.sellout_j073_dist', N'U') IS NULL
CREATE TABLE [sementrack].[sellout_j073_dist] (
  [dist_code] nvarchar(50) NOT NULL,
  [nama] nvarchar(200) NOT NULL,
  [j028_dist] nvarchar(200) NULL,
  CONSTRAINT [PK_sellout_j073_dist] PRIMARY KEY ([dist_code])
);
GO

IF OBJECT_ID(N'sementrack.sellout_j073_aturan', N'U') IS NULL
CREATE TABLE [sementrack].[sellout_j073_aturan] (
  [dist_code] nvarchar(50) NOT NULL,
  [urutan] int NOT NULL,
  [gudang] nvarchar(200) NULL,
  [customer_code] nvarchar(200) NULL,
  [do_j028] nvarchar(200) NULL,
  [peta_id] int NOT NULL,
  CONSTRAINT [PK_sellout_j073_aturan] PRIMARY KEY ([dist_code], [urutan])
);
GO

IF OBJECT_ID(N'sementrack.sellout_j073', N'U') IS NULL
CREATE TABLE [sementrack].[sellout_j073] (
  [dist_code] nvarchar(50) NOT NULL,
  [do_date] date NOT NULL,
  [do_no] nvarchar(200) NOT NULL,
  [customer_code] nvarchar(200) NOT NULL,
  [customer_name] nvarchar(200) NULL,
  [product_code] nvarchar(200) NOT NULL,
  [product_name] nvarchar(200) NULL,
  [order_qty] decimal(20,6) NOT NULL,
  [net_amount] decimal(20,6) NOT NULL CONSTRAINT [DF_sellout_j073_net_amount] DEFAULT (0),
  [warehouse] nvarchar(200) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sellout_j073_dist_tgl_idx' AND object_id = OBJECT_ID(N'sementrack.sellout_j073'))
  CREATE INDEX [sellout_j073_dist_tgl_idx] ON [sementrack].[sellout_j073] ([dist_code], [do_date]);

IF OBJECT_ID(N'auth_local.users', N'U') IS NULL
CREATE TABLE [auth_local].[users] (
  [username] nvarchar(50) NOT NULL,
  [password_hash] nvarchar(200) NULL,
  [role] nvarchar(200) NULL,
  [name] nvarchar(200) NULL,
  [dist_code] nvarchar(200) NULL,
  [created_at] datetimeoffset(3) NULL CONSTRAINT [DF_users_created_at] DEFAULT (sysdatetimeoffset()),
  CONSTRAINT [PK_users] PRIMARY KEY ([username])
);
GO

IF OBJECT_ID(N'auth_local.sessions', N'U') IS NULL
CREATE TABLE [auth_local].[sessions] (
  [token] nvarchar(200) NOT NULL CONSTRAINT [PK_sessions] PRIMARY KEY,
  [username] nvarchar(100) NULL, [email] nvarchar(200) NULL, [role] nvarchar(20) NOT NULL, [name] nvarchar(200) NULL,
  [dist_code] nvarchar(50) NULL, [wilayah] nvarchar(100) NULL, [expires_at] bigint NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'sessions_username_idx' AND object_id = OBJECT_ID(N'auth_local.sessions'))
  CREATE INDEX [sessions_username_idx] ON [auth_local].[sessions] ([username]);

IF OBJECT_ID(N'auth_local.role_pages', N'U') IS NULL
CREATE TABLE [auth_local].[role_pages] (
  [role] nvarchar(200) NULL,
  [page_id] nvarchar(200) NULL,
  [can_view_detail] bit NULL,
  [can_download] bit NULL
);
GO

IF OBJECT_ID(N'auth_local.activity_log', N'U') IS NULL
CREATE TABLE [auth_local].[activity_log] (
  [id] int IDENTITY(1,1) NOT NULL,
  [username] nvarchar(200) NULL,
  [role] nvarchar(200) NULL,
  [name] nvarchar(200) NULL,
  [event_type] nvarchar(200) NULL,
  [page_id] nvarchar(200) NULL,
  [detail] nvarchar(200) NULL,
  [created_at] datetimeoffset(3) NULL CONSTRAINT [DF_activity_log_created_at] DEFAULT (sysdatetimeoffset())
);
GO

-- Relasi antar tabel (setelah semua tabel ada)
IF OBJECT_ID(N'dbo.FK_toko_dist_code_fkey', N'F') IS NULL ALTER TABLE [dbo].[toko] ADD CONSTRAINT [FK_toko_dist_code_fkey] FOREIGN KEY ([dist_code]) REFERENCES [dbo].[distributor] ([dist_code]) ON DELETE CASCADE;
IF OBJECT_ID(N'dbo.FK_transaksi_dist_code_fkey', N'F') IS NULL ALTER TABLE [dbo].[transaksi] ADD CONSTRAINT [FK_transaksi_dist_code_fkey] FOREIGN KEY ([dist_code]) REFERENCES [dbo].[distributor] ([dist_code]);
IF OBJECT_ID(N'dbo.FK_transaksi_product_code_fkey', N'F') IS NULL ALTER TABLE [dbo].[transaksi] ADD CONSTRAINT [FK_transaksi_product_code_fkey] FOREIGN KEY ([product_code]) REFERENCES [dbo].[produk] ([kode]);
IF OBJECT_ID(N'dbo.FK_transaksi_customer_code_fkey', N'F') IS NULL ALTER TABLE [dbo].[transaksi] ADD CONSTRAINT [FK_transaksi_customer_code_fkey] FOREIGN KEY ([customer_code]) REFERENCES [dbo].[toko] ([cust_code]);
IF OBJECT_ID(N'dbo.FK_salesman_status_target_backup_dist_code_fkey', N'F') IS NULL ALTER TABLE [dbo].[salesman_status_target] ADD CONSTRAINT [FK_salesman_status_target_backup_dist_code_fkey] FOREIGN KEY ([dist_code]) REFERENCES [dbo].[distributor] ([dist_code]);
IF OBJECT_ID(N'sementrack.FK_sellin_bnn_upload_id_fkey', N'F') IS NULL ALTER TABLE [sementrack].[sellin_bnn] ADD CONSTRAINT [FK_sellin_bnn_upload_id_fkey] FOREIGN KEY ([upload_id]) REFERENCES [sementrack].[sellin_bnn_upload] ([id]);
IF OBJECT_ID(N'sementrack.FK_sellin_po_upload_id_fkey', N'F') IS NULL ALTER TABLE [sementrack].[sellin_po] ADD CONSTRAINT [FK_sellin_po_upload_id_fkey] FOREIGN KEY ([upload_id]) REFERENCES [sementrack].[sellin_po_upload] ([id]);
IF OBJECT_ID(N'sementrack.FK_sellout_j073_aturan_dist_code_fkey', N'F') IS NULL ALTER TABLE [sementrack].[sellout_j073_aturan] ADD CONSTRAINT [FK_sellout_j073_aturan_dist_code_fkey] FOREIGN KEY ([dist_code]) REFERENCES [sementrack].[sellout_j073_dist] ([dist_code]);
IF OBJECT_ID(N'sementrack.FK_sellout_j073_aturan_peta_id_fkey', N'F') IS NULL ALTER TABLE [sementrack].[sellout_j073_aturan] ADD CONSTRAINT [FK_sellout_j073_aturan_peta_id_fkey] FOREIGN KEY ([peta_id]) REFERENCES [sementrack].[sellout_bnn_peta] ([id]);
GO
