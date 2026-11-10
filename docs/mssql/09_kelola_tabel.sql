/* =============================================================================
   SEMENTRACK di SQL Server 2022, tahap 4d: Kelola Data → Tabel (edit langsung tabel master kecil).
   - View target bentuk lebar (v_edit_target_*) + trigger INSTEAD OF yang menulis ke sementrack.target.
   - Prosedur tabel_baca, tabel_opsi, tabel_simpan (SQL dinamis; daftar tabel, kolom, kunci di sementrack.tabel_edit).
   Jalankan di MARKETING_ANALIS setelah 07_upload_sellin.sql. Aman dijalankan ulang.

   Perbedaan dari PostgreSQL:
   - Trigger PostgreSQL per baris (FOR EACH ROW, satu fungsi dengan argumen) menjadi satu trigger per view
     yang memproses semua baris sekaligus (tabel inserted / deleted).
   - Objek 'public.x' di tabel_edit menjadi 'dbo.x'.
   - Nama kolom dan objek diambil dari tabel_edit dan selalu dibungkus QUOTENAME; nilai dari pengguna
     dibaca lewat JSON_VALUE dari parameter, tidak pernah ditempel ke teks SQL.
============================================================================= */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

UPDATE sementrack.tabel_edit SET objek = N'dbo.' + SUBSTRING(objek, 8, 200) WHERE objek LIKE N'public.%';
GO

/* ============================ view target bentuk lebar ============================ */

CREATE OR ALTER VIEW sementrack.v_edit_target_sell_out AS
SELECT tahun, bulan, region, area AS distributor, tipe,
       MAX(CASE WHEN metrik = N'target_ton' THEN nilai END) AS target_ton,
       MAX(CASE WHEN metrik = N'target_ta' THEN nilai END) AS target_ta,
       MAX(CASE WHEN metrik = N'realisasi_ton' THEN nilai END) AS realisasi_ton,
       MAX(CASE WHEN metrik = N'realisasi_ta' THEN nilai END) AS realisasi_ta
FROM sementrack.target WHERE jenis = N'sell_out'
GROUP BY tahun, bulan, region, area, tipe;
GO

CREATE OR ALTER VIEW sementrack.v_edit_target_sell_in AS
SELECT tahun, bulan, region, area AS sub_region, tipe,
       MAX(CASE WHEN metrik = N'target_ton' THEN nilai END) AS target_ton,
       MAX(CASE WHEN metrik = N'realisasi_ton' THEN nilai END) AS realisasi_ton
FROM sementrack.target WHERE jenis = N'sell_in'
GROUP BY tahun, bulan, region, area, tipe;
GO

CREATE OR ALTER VIEW sementrack.v_edit_target_distributor AS
SELECT tahun, bulan, kode AS dist_code,
       MAX(CASE WHEN metrik = N'target_ton' THEN nilai END) AS target_ton,
       MAX(CASE WHEN metrik = N'target_ta' THEN nilai END) AS target_ta
FROM sementrack.target WHERE jenis = N'distributor'
GROUP BY tahun, bulan, kode;
GO

CREATE OR ALTER VIEW sementrack.v_edit_target_salesman AS
SELECT tahun, bulan, area AS dist_code, kode AS salesman_code, MAX(nama) AS salesman_name, MAX(status) AS status,
       MAX(CASE WHEN metrik = N'target_ta' THEN nilai END) AS target_ta,
       MAX(CASE WHEN metrik = N'target_ton' THEN nilai END) AS target_ton
FROM sementrack.target WHERE jenis = N'salesman'
GROUP BY tahun, bulan, area, kode;
GO

/* ---------- penulis bersama untuk keempat trigger ----------
   #lama: baris yang dihapus/diubah (kunci); #baru: baris baru per metrik. Keduanya diisi trigger lalu prosedur ini dipanggil. */
CREATE OR ALTER PROCEDURE sementrack.target_edit_tulis @p_jenis nvarchar(50), @p_metrik nvarchar(400)
AS
BEGIN
  SET NOCOUNT ON;
  DELETE t FROM sementrack.target t
  JOIN #lama o ON t.tahun = o.tahun AND t.bulan = o.bulan AND t.region = o.region AND t.area = o.area AND t.tipe = o.tipe AND t.kode = o.kode
  WHERE t.jenis = @p_jenis AND t.metrik IN (SELECT TRIM(value) FROM STRING_SPLIT(@p_metrik, N','));

  IF EXISTS (SELECT 1 FROM #baru WHERE tahun IS NULL OR tahun < 2000 OR tahun > 2100) THROW 52023, N'tahun tidak valid', 1;
  IF EXISTS (SELECT 1 FROM #baru WHERE bulan IS NULL OR bulan < 1 OR bulan > 12) THROW 52023, N'bulan harus 1–12', 1;

  MERGE sementrack.target AS t
  USING (SELECT * FROM #baru WHERE nilai IS NOT NULL) AS s
     ON t.jenis = @p_jenis AND t.metrik = s.metrik AND t.tahun = s.tahun AND t.bulan = s.bulan
    AND t.region = s.region AND t.area = s.area AND t.tipe = s.tipe AND t.kode = s.kode
  WHEN MATCHED THEN UPDATE SET nilai = s.nilai, nama = s.nama, status = s.status, diperbarui = SYSDATETIMEOFFSET()
  WHEN NOT MATCHED THEN INSERT (jenis, metrik, tahun, bulan, region, area, tipe, kode, nama, status, nilai, diperbarui)
    VALUES (@p_jenis, s.metrik, s.tahun, s.bulan, s.region, s.area, s.tipe, s.kode, s.nama, s.status, s.nilai, SYSDATETIMEOFFSET());
END
GO

-- kolom kunci: kosong / spasi = '' (PostgreSQL: coalesce(nullif(btrim(..), ''), ''))
CREATE OR ALTER TRIGGER sementrack.v_edit_target_sell_out_tulis ON sementrack.v_edit_target_sell_out
INSTEAD OF INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  SELECT tahun, bulan, ISNULL(region, N'') AS region, ISNULL(distributor, N'') AS area, ISNULL(tipe, N'') AS tipe, N'' AS kode INTO #lama FROM deleted;
  SELECT i.tahun, i.bulan, ISNULL(NULLIF(TRIM(i.region), N''), N'') AS region, ISNULL(NULLIF(TRIM(i.distributor), N''), N'') AS area,
         ISNULL(NULLIF(TRIM(i.tipe), N''), N'') AS tipe, N'' AS kode, CAST(NULL AS nvarchar(200)) AS nama, CAST(NULL AS nvarchar(200)) AS status,
         m.metrik, m.nilai
  INTO #baru FROM inserted i
  CROSS APPLY (VALUES (N'target_ton', i.target_ton), (N'target_ta', i.target_ta), (N'realisasi_ton', i.realisasi_ton), (N'realisasi_ta', i.realisasi_ta)) m(metrik, nilai);
  EXEC sementrack.target_edit_tulis N'sell_out', N'target_ton,target_ta,realisasi_ton,realisasi_ta';
END
GO

CREATE OR ALTER TRIGGER sementrack.v_edit_target_sell_in_tulis ON sementrack.v_edit_target_sell_in
INSTEAD OF INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  SELECT tahun, bulan, ISNULL(region, N'') AS region, ISNULL(sub_region, N'') AS area, ISNULL(tipe, N'') AS tipe, N'' AS kode INTO #lama FROM deleted;
  SELECT i.tahun, i.bulan, ISNULL(NULLIF(TRIM(i.region), N''), N'') AS region, ISNULL(NULLIF(TRIM(i.sub_region), N''), N'') AS area,
         ISNULL(NULLIF(TRIM(i.tipe), N''), N'') AS tipe, N'' AS kode, CAST(NULL AS nvarchar(200)) AS nama, CAST(NULL AS nvarchar(200)) AS status,
         m.metrik, m.nilai
  INTO #baru FROM inserted i
  CROSS APPLY (VALUES (N'target_ton', i.target_ton), (N'realisasi_ton', i.realisasi_ton)) m(metrik, nilai);
  EXEC sementrack.target_edit_tulis N'sell_in', N'target_ton,realisasi_ton';
END
GO

CREATE OR ALTER TRIGGER sementrack.v_edit_target_distributor_tulis ON sementrack.v_edit_target_distributor
INSTEAD OF INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  SELECT tahun, bulan, N'' AS region, N'' AS area, N'' AS tipe, ISNULL(dist_code, N'') AS kode INTO #lama FROM deleted;
  SELECT i.tahun, i.bulan, N'' AS region, N'' AS area, N'' AS tipe, ISNULL(NULLIF(TRIM(i.dist_code), N''), N'') AS kode,
         CAST(NULL AS nvarchar(200)) AS nama, CAST(NULL AS nvarchar(200)) AS status, m.metrik, m.nilai
  INTO #baru FROM inserted i
  CROSS APPLY (VALUES (N'target_ton', i.target_ton), (N'target_ta', i.target_ta)) m(metrik, nilai);
  EXEC sementrack.target_edit_tulis N'distributor', N'target_ton,target_ta';
END
GO

CREATE OR ALTER TRIGGER sementrack.v_edit_target_salesman_tulis ON sementrack.v_edit_target_salesman
INSTEAD OF INSERT, UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  SELECT tahun, bulan, N'' AS region, ISNULL(dist_code, N'') AS area, N'' AS tipe, ISNULL(salesman_code, N'') AS kode INTO #lama FROM deleted;
  SELECT i.tahun, i.bulan, N'' AS region, ISNULL(NULLIF(TRIM(i.dist_code), N''), N'') AS area, N'' AS tipe,
         ISNULL(NULLIF(TRIM(i.salesman_code), N''), N'') AS kode,
         CAST(NULLIF(TRIM(i.salesman_name), N'') AS nvarchar(200)) AS nama, CAST(NULLIF(TRIM(i.status), N'') AS nvarchar(200)) AS status,
         m.metrik, m.nilai
  INTO #baru FROM inserted i
  CROSS APPLY (VALUES (N'target_ta', i.target_ta), (N'target_ton', i.target_ton)) m(metrik, nilai);
  EXEC sementrack.target_edit_tulis N'salesman', N'target_ta,target_ton';
END
GO

/* ============================ baca, opsi, simpan ============================ */

-- teks angka sesuai aturan PostgreSQL: bulat ^-?\d+$, desimal ^-?\d+(\.\d+)?$
CREATE OR ALTER FUNCTION sementrack.teks_angka (@v nvarchar(4000), @bulat bit)
RETURNS bit
WITH SCHEMABINDING
AS
BEGIN
  DECLARE @s nvarchar(4000) = CASE WHEN LEFT(@v, 1) = N'-' THEN SUBSTRING(@v, 2, 4000) ELSE @v END;
  IF @s IS NULL OR @s = N'' OR @s LIKE N'%[^0-9.]%' RETURN 0;
  IF @bulat = 1 AND CHARINDEX(N'.', @s) > 0 RETURN 0;
  IF @s LIKE N'.%' OR @s LIKE N'%.' OR @s LIKE N'%.%.%' RETURN 0;
  RETURN 1;
END
GO

/* Baca isi satu tabel (kolom terdaftar saja), disaring kolom filter. Maks 20.000 baris. Hasil: kolom j berisi array JSON. */
CREATE OR ALTER PROCEDURE sementrack.tabel_baca @p_id nvarchar(100), @p_filter nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @objek nvarchar(400), @kolom nvarchar(max), @filter nvarchar(max), @urut nvarchar(400),
          @cols nvarchar(max), @cond nvarchar(max) = N'1 = 1', @sql nvarchar(max), @n int, @res nvarchar(max), @msg nvarchar(2048), @k nvarchar(200);
  SELECT @objek = objek, @kolom = kolom, @filter = filter, @urut = urut FROM sementrack.tabel_edit WHERE id = @p_id AND aktif = 1;
  IF @objek IS NULL BEGIN SET @msg = CONCAT(N'tabel ', @p_id, N' tidak bisa dibuka'); THROW 52023, @msg, 1; END

  SELECT @cols = STRING_AGG(N't.' + QUOTENAME(c.name), N', ') WITHIN GROUP (ORDER BY CAST(c.[key] AS int))
  FROM (SELECT j.[key], JSON_VALUE(j.[value], '$.name') AS name FROM OPENJSON(@kolom) j) c;

  SELECT TOP (1) @k = f.[key] FROM OPENJSON(ISNULL(@p_filter, N'{}')) f
  WHERE NOT EXISTS (SELECT 1 FROM OPENJSON(@filter) WITH (v nvarchar(200) '$') x WHERE x.v = f.[key]);
  IF @k IS NOT NULL BEGIN SET @msg = CONCAT(N'filter ', @k, N' tidak dikenal'); THROW 52023, @msg, 1; END
  SELECT @cond = @cond + N' AND CAST(t.' + QUOTENAME(f.[key]) + N' AS nvarchar(4000)) = JSON_VALUE(@f, ''$."' + f.[key] + N'"'')'
  FROM OPENJSON(ISNULL(@p_filter, N'{}')) f
  WHERE f.[value] IS NOT NULL AND f.[value] <> N'';

  SET @sql = N'SELECT @n = COUNT(*) FROM ' + @objek + N' t WHERE ' + @cond;
  EXEC sp_executesql @sql, N'@f nvarchar(max), @n int OUTPUT', @f = @p_filter, @n = @n OUTPUT;
  IF @n > 20000 BEGIN SET @msg = CONCAT(@n, N' baris: terlalu banyak, pilih filter dulu'); THROW 52023, @msg, 1; END

  SET @sql = N'SET @res = (SELECT ' + @cols + N' FROM ' + @objek + N' t WHERE ' + @cond + N' ORDER BY ' + @urut + N' FOR JSON PATH, INCLUDE_NULL_VALUES)';
  EXEC sp_executesql @sql, N'@f nvarchar(max), @res nvarchar(max) OUTPUT', @f = @p_filter, @res = @res OUTPUT;
  SELECT ISNULL(@res, N'[]') AS j;
END
GO

/* Pilihan filter dan saran isian: nilai unik per kolom teks/int (maks 300 per kolom). Hasil: kolom j berisi objek JSON. */
CREATE OR ALTER PROCEDURE sementrack.tabel_opsi @p_id nvarchar(100)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @objek nvarchar(400), @kolom nvarchar(max), @res nvarchar(max) = N'{}', @vals nvarchar(max), @sql nvarchar(max),
          @name nvarchar(200), @i int = 0, @n int, @msg nvarchar(2048);
  SELECT @objek = objek, @kolom = kolom FROM sementrack.tabel_edit WHERE id = @p_id AND aktif = 1;
  IF @objek IS NULL BEGIN SET @msg = CONCAT(N'tabel ', @p_id, N' tidak bisa dibuka'); THROW 52023, @msg, 1; END

  SELECT ROW_NUMBER() OVER (ORDER BY CAST(j.[key] AS int)) AS i, JSON_VALUE(j.[value], '$.name') AS name
  INTO #k FROM OPENJSON(@kolom) j WHERE JSON_VALUE(j.[value], '$.tipe') IN (N'text', N'int');
  SELECT @n = COUNT(*) FROM #k;
  WHILE @i < @n
  BEGIN
    SET @i += 1;
    SELECT @name = name FROM #k WHERE i = @i;
    SET @sql = N'SELECT @vals = N''['' + STRING_AGG(N''"'' + STRING_ESCAPE(v, ''json'') + N''"'', N'','') WITHIN GROUP (ORDER BY v) + N'']'' '
             + N'FROM (SELECT DISTINCT TOP (300) CAST(' + QUOTENAME(@name) + N' AS nvarchar(4000)) AS v FROM ' + @objek
             + N' WHERE ' + QUOTENAME(@name) + N' IS NOT NULL ORDER BY v) x';
    SET @vals = NULL;
    EXEC sp_executesql @sql, N'@vals nvarchar(max) OUTPUT', @vals = @vals OUTPUT;
    SET @res = JSON_MODIFY(@res, '$."' + @name + '"', JSON_QUERY(ISNULL(@vals, N'[]')));
  END
  SELECT @res AS j;
END
GO

/* Simpan perubahan dari editor (khusus admin). @p_upsert / @p_delete = array JSON berisi objek {kolom: nilai}.
   Satu transaksi: gagal satu, batal semua. Hasil: diubah, ditambah, dihapus. */
CREATE OR ALTER PROCEDURE sementrack.tabel_simpan @p_id nvarchar(100), @p_user nvarchar(200), @p_upsert nvarchar(max), @p_delete nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  DECLARE @objek nvarchar(400), @kolom nvarchar(max), @pk nvarchar(max), @label nvarchar(200),
          @pkcond nvarchar(max), @setlist nvarchar(max), @cols nvarchar(max), @vals nvarchar(max), @sql nvarchar(max),
          @r nvarchar(max), @i int = 0, @n int, @jml_up int, @jml_del int, @upd int = 0, @ins int = 0, @del int = 0,
          @msg nvarchar(2048);
  SELECT @objek = objek, @kolom = kolom, @pk = pk, @label = label FROM sementrack.tabel_edit WHERE id = @p_id AND aktif = 1;
  IF @objek IS NULL BEGIN SET @msg = CONCAT(N'tabel ', @p_id, N' tidak bisa diedit'); THROW 52023, @msg, 1; END
  SET @jml_up = (SELECT COUNT(*) FROM OPENJSON(ISNULL(@p_upsert, N'[]')));
  SET @jml_del = (SELECT COUNT(*) FROM OPENJSON(ISNULL(@p_delete, N'[]')));
  IF @jml_up + @jml_del = 0 THROW 52023, N'tidak ada perubahan', 1;
  IF @jml_up + @jml_del > 20000 THROW 52023, N'terlalu banyak perubahan sekaligus (maks 20.000 baris)', 1;

  -- kolom terdaftar; kunci dibandingkan sebagai teks (aman untuk kolom teks maupun angka)
  SELECT CAST(j.[key] AS int) AS urut, JSON_VALUE(j.[value], '$.name') AS name, JSON_VALUE(j.[value], '$.label') AS label,
         JSON_VALUE(j.[value], '$.tipe') AS tipe, ISNULL(TRY_CAST(JSON_VALUE(j.[value], '$.wajib') AS bit), 0) AS wajib,
         JSON_QUERY(j.[value], '$.pilihan') AS pilihan,
         CASE WHEN EXISTS (SELECT 1 FROM OPENJSON(@pk) WITH (v nvarchar(200) '$') p WHERE p.v = JSON_VALUE(j.[value], '$.name')) THEN 1 ELSE 0 END AS kunci
  INTO #kol FROM OPENJSON(@kolom) j;

  SELECT @pkcond = STRING_AGG(N'CAST(t.' + QUOTENAME(p.v) + N' AS nvarchar(4000)) IS NOT DISTINCT FROM NULLIF(TRIM(JSON_VALUE(@r, ''$."' + p.v + N'"'')), N'''')', N' AND ')
  FROM OPENJSON(@pk) WITH (v nvarchar(200) '$') p;
  SELECT @setlist = STRING_AGG(QUOTENAME(name) + N' = NULLIF(TRIM(JSON_VALUE(@r, ''$."' + name + N'"'')), N'''')', N', ') WITHIN GROUP (ORDER BY urut)
  FROM #kol WHERE kunci = 0;
  SELECT @cols = STRING_AGG(QUOTENAME(name), N', ') WITHIN GROUP (ORDER BY urut),
         @vals = STRING_AGG(N'NULLIF(TRIM(JSON_VALUE(@r, ''$."' + name + N'"'')), N'''')', N', ') WITHIN GROUP (ORDER BY urut)
  FROM #kol;

  SELECT CAST([key] AS int) AS i, [value] AS r INTO #up FROM OPENJSON(ISNULL(@p_upsert, N'[]'));
  SELECT CAST([key] AS int) AS i, [value] AS r INTO #del FROM OPENJSON(ISNULL(@p_delete, N'[]'));

  BEGIN TRAN;
  -- hapus
  SET @i = 0;
  WHILE @i < @jml_del
  BEGIN
    SELECT @r = r FROM #del WHERE i = @i;
    -- dihitung dulu: @@ROWCOUNT setelah DELETE pada view ber-trigger INSTEAD OF tidak bisa diandalkan
    SET @sql = N'SELECT @n = COUNT(*) FROM ' + @objek + N' t WHERE ' + @pkcond + N'; DELETE t FROM ' + @objek + N' t WHERE ' + @pkcond + N';';
    EXEC sp_executesql @sql, N'@r nvarchar(max), @n int OUTPUT', @r = @r, @n = @n OUTPUT;
    SET @del += ISNULL(@n, 0);
    SET @i += 1;
  END

  -- tambah / ubah
  SET @i = 0;
  WHILE @i < @jml_up
  BEGIN
    SELECT @r = r FROM #up WHERE i = @i;
    -- periksa isian (teks dirapikan, kosong = kosong)
    SELECT TOP (1)
           @msg = CASE
             WHEN x.v IS NULL THEN CONCAT(N'baris ', @i + 1, N': kolom "', k.label, N'" wajib diisi')
             WHEN k.tipe = N'int' AND sementrack.teks_angka(x.v, 1) = 0 THEN CONCAT(N'baris ', @i + 1, N': "', k.label, N'" harus bilangan bulat (isi: ', x.v, N')')
             WHEN k.tipe = N'num' AND sementrack.teks_angka(x.v, 0) = 0 THEN CONCAT(N'baris ', @i + 1, N': "', k.label, N'" harus angka (isi: ', x.v, N')')
             ELSE CONCAT(N'baris ', @i + 1, N': "', k.label, N'" harus salah satu dari ',
                         (SELECT STRING_AGG(p.v, N', ') WITHIN GROUP (ORDER BY CAST(p.[key] AS int)) FROM (SELECT [key], CAST([value] AS nvarchar(200)) AS v FROM OPENJSON(k.pilihan)) p))
           END
    FROM #kol k
    CROSS APPLY (SELECT NULLIF(TRIM(JSON_VALUE(@r, '$."' + k.name + '"')), N'') AS v) x
    WHERE ((k.wajib = 1 OR k.kunci = 1) AND x.v IS NULL)
       OR (x.v IS NOT NULL AND k.tipe = N'int' AND sementrack.teks_angka(x.v, 1) = 0)
       OR (x.v IS NOT NULL AND k.tipe = N'num' AND sementrack.teks_angka(x.v, 0) = 0)
       OR (x.v IS NOT NULL AND k.pilihan IS NOT NULL AND NOT EXISTS (SELECT 1 FROM OPENJSON(k.pilihan) WITH (p nvarchar(200) '$') o WHERE o.p = x.v))
    ORDER BY k.urut;
    IF @@ROWCOUNT > 0 THROW 52023, @msg, 1;

    SET @sql = N'SELECT @n = COUNT(*) FROM ' + @objek + N' t WHERE ' + @pkcond;
    EXEC sp_executesql @sql, N'@r nvarchar(max), @n int OUTPUT', @r = @r, @n = @n OUTPUT;
    IF @n > 0
    BEGIN
      IF @setlist IS NOT NULL
      BEGIN
        SET @sql = N'UPDATE t SET ' + @setlist + N' FROM ' + @objek + N' t WHERE ' + @pkcond;
        EXEC sp_executesql @sql, N'@r nvarchar(max)', @r = @r;
      END
      SET @upd += 1;
    END
    ELSE
    BEGIN
      SET @sql = N'INSERT INTO ' + @objek + N' (' + @cols + N') SELECT ' + @vals;
      EXEC sp_executesql @sql, N'@r nvarchar(max)', @r = @r;
      SET @ins += 1;
    END
    SET @i += 1;
  END

  INSERT INTO sementrack.kelola_log (dataset, aksi, created_by, source, file_name, date_from, date_to, rows_saved, rows_deleted, status, finished_at)
  VALUES (N'tabel', N'ubah', @p_user, N'edit', @label, CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '+07:00') AS date),
          CAST(SWITCHOFFSET(SYSDATETIMEOFFSET(), '+07:00') AS date), @upd + @ins, @del, N'selesai', SYSDATETIMEOFFSET());
  COMMIT;
  SELECT @upd AS diubah, @ins AS ditambah, @del AS dihapus;
END
GO
