using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Sementrack.Api.Data;
using Sementrack.Api.Security;

namespace Sementrack.Api.Endpoints;

/// <summary>
/// Halaman Kelola Data (khusus admin): upload transaksi, hapus data per tanggal, riwayat, status sinkronisasi.
/// Logika ada di fungsi database sementrack.transaksi_* dan sementrack.kelola_* (lihat docs/sql/kelola_data.sql).
/// </summary>
internal static class KelolaEndpoints
{
    private const long StageMaxBody = 12 * 1024 * 1024;
    /// <summary>Simpan / hapus transaksi memicu refresh materialized view: beri waktu sampai 5 menit.</summary>
    internal const int LongQuery = 300;

    /// <summary>Daftar teks dari body JSON (array string) -> string[]; null kalau kosong / bukan array.</summary>
    private static string[]? StringArray(JsonElement b, string name)
    {
        var el = b.Get(name);
        if (el is not { ValueKind: JsonValueKind.Array }) return null;
        var list = el.Value.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String)
            .Select(x => x.GetString()!.Trim()).Where(x => x.Length > 0).Distinct().ToArray();
        return list.Length == 0 ? null : list;
    }

    public static void Map(RouteGroupBuilder api)
    {
        var t = api.MapGroup("/admin/transaksi");

        t.MapPost("/impact", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "trx impact", async _ =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            return Helpers.Json(await db.QueryAsync("select * from sementrack.transaksi_impact($1::date, $2::date, $3)",
                new object?[] { b.GetString("date_from"), b.GetString("date_to"), StringArray(b, "dist_codes") ?? Array.Empty<string>() }));
        }));

        t.MapPost("/begin", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "trx begin", async s =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            var rows = await db.QueryAsync("select sementrack.transaksi_begin($1, $2, $3, $4::date, $5::date, $6, $7::int) as id",
                new object?[] { s.Username, b.GetString("source"), b.GetString("file_name"), b.GetString("date_from"), b.GetString("date_to"),
                    StringArray(b, "dist_codes") ?? Array.Empty<string>(), b.GetString("rows_read") ?? "0" });
            return Helpers.Json(new { id = rows[0]["id"] });
        }));

        t.MapPost("/stage", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            var limit = ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = StageMaxBody;
            return SellinEndpoints.Run(ctx, auth, log, "trx stage", async _ =>
            {
                var b = await Helpers.ReadBodyAsync(ctx.Request);
                var rowsEl = b.Get("rows");
                if (rowsEl is not { ValueKind: JsonValueKind.Array }) return Helpers.Error(400, "paket baris tidak valid");
                var n = await db.QueryAsync("select sementrack.transaksi_stage($1::bigint, $2::json) as n",
                    new object?[] { b.GetString("upload_id"), rowsEl.Value.GetRawText() });
                return Helpers.Json(new { staged = n[0]["n"] });
            });
        });

        t.MapPost("/commit", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "trx commit", async _ =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            var rows = await db.QueryAsync("select * from sementrack.transaksi_commit($1::bigint)", new object?[] { b.GetString("upload_id") }, timeoutSeconds: LongQuery);
            db.ClearCache();
            return Helpers.Json(rows[0]);
        }));

        t.MapPost("/abort", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "trx abort", async _ =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            await db.ExecuteAsync("select sementrack.transaksi_abort($1::bigint)", new object?[] { b.GetString("upload_id") });
            return Helpers.Json(new { ok = true });
        }));

        var d = api.MapGroup("/admin/data");

        d.MapGet("/riwayat", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "riwayat", async _ =>
            Helpers.Json(await db.QueryAsync("select * from sementrack.v_kelola_riwayat order by created_at desc limit 50"))));

        d.MapPost("/hapus-pratinjau", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "hapus pratinjau", async _ =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            var rows = await db.QueryAsync("select * from sementrack.kelola_hapus_pratinjau($1, $2::date, $3::date, $4)",
                new object?[] { b.GetString("dataset"), b.GetString("date_from"), b.GetString("date_to"), StringArray(b, "dist_codes") });
            return Helpers.Json(rows[0]);
        }));

        d.MapPost("/hapus", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "hapus", async s =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            // konfirmasi wajib dikirim dari layar (ketik HAPUS) supaya tidak terhapus karena salah klik / panggilan liar
            if (!string.Equals(b.GetString("konfirmasi"), "HAPUS", StringComparison.Ordinal)) return Helpers.Error(400, "konfirmasi hapus tidak valid");
            var rows = await db.QueryAsync("select sementrack.kelola_hapus($1, $2::date, $3::date, $4, $5) as n",
                new object?[] { b.GetString("dataset"), b.GetString("date_from"), b.GetString("date_to"), StringArray(b, "dist_codes"), s.Username }, timeoutSeconds: LongQuery);
            db.ClearCache();
            return Helpers.Json(new { deleted = rows[0]["n"] });
        }));

        // Sell Out BNN: tempelan DO FAS / Sub ERP (ganti seluruh data satu tahun) dan upload J073
        // (baris transaksi warehouse INSA/PKB yang sudah disaring; diganti per distributor pada rentang tanggal file).
        d.MapPost("/sellout", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            var limit = ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = StageMaxBody;
            return SellinEndpoints.Run(ctx, auth, log, "sellout", async s =>
            {
                var b = await Helpers.ReadBodyAsync(ctx.Request);
                var dataset = b.GetString("dataset");
                var rowsEl = b.Get("rows");
                if (rowsEl is not { ValueKind: JsonValueKind.Array }) return Helpers.Error(400, "baris tidak valid");
                if (dataset == "j073")
                {
                    var r = await db.QueryAsync("select * from sementrack.sellout_j073_simpan($1::json, $2, $3)",
                        new object?[] { rowsEl.Value.GetRawText(), s.Username, b.GetString("file_name") }, timeoutSeconds: LongQuery);
                    db.ClearCache();
                    return Helpers.Json(r[0]);
                }
                var fn = dataset switch { "dofas" => "sellout_dofas_simpan", "erp" => "sellout_erp_simpan", _ => null };
                if (fn is null) return Helpers.Error(400, "dataset harus dofas, erp, atau j073");
                var rows = await db.QueryAsync($"select * from sementrack.{fn}($1::int, $2::json, $3)",
                    new object?[] { b.GetString("tahun"), rowsEl.Value.GetRawText(), s.Username });
                db.ClearCache();
                return Helpers.Json(rows[0]);
            });
        });

        d.MapGet("/status-sync", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "status-sync", async _ =>
        {
            var rows = await db.QueryAsync("select tanggal_update, jam_update, keterangan from public.status_sync where id = 1");
            return Helpers.Json(rows.Count > 0 ? rows[0] : new Dictionary<string, object?>());
        }));

        d.MapPost("/status-sync", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "status-sync save", async _ =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            var jam = b.GetString("jam_update");
            await db.ExecuteAsync("select sementrack.status_sync_set($1::date, $2::time, $3)",
                new object?[] { b.GetString("tanggal_update"), string.IsNullOrWhiteSpace(jam) ? null : jam, b.GetString("keterangan") });
            db.ClearCache();
            return Helpers.Json(new { ok = true });
        }));

        d.MapGet("/distributor", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "distributor", async _ =>
            Helpers.Json(await db.QueryAsync("select dist_code, dist_name from public.distributor order by dist_code"))));
    }
}
