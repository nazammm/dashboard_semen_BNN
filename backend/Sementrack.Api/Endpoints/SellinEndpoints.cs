using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Npgsql;
using Sementrack.Api.Data;
using Sementrack.Api.Security;

namespace Sementrack.Api.Endpoints;

/// <summary>
/// Upload data Sell In BNN (khusus admin). Semua logika (aturan baris, tonase, ganti data per rentang tanggal)
/// ada di fungsi database sementrack.sellin_bnn_* -- endpoint ini hanya meneruskan.
/// Alur dari browser: begin -> stage (beberapa paket) -> commit, atau abort.
/// </summary>
internal static class SellinEndpoints
{
    /// <summary>Batas body khusus untuk paket baris (default server 256 KB terlalu kecil untuk ribuan baris).</summary>
    private const long StageMaxBody = 12 * 1024 * 1024;

    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/admin/sellin");

        g.MapGet("/uploads", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => Run(ctx, auth, log, "uploads", async _ =>
            Helpers.Json(await db.QueryAsync(
                "select id, created_at, created_by, source, file_name, date_from, date_to, rows_read, rows_saved, rows_replaced, ton_saved, status " +
                "from sementrack.sellin_bnn_upload order by id desc limit 30"))));

        g.MapGet("/unmapped", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => Run(ctx, auth, log, "unmapped", async _ =>
            Helpers.Json(await db.QueryAsync("select * from sementrack.v_sellin_unmapped order by ton desc nulls last"))));

        g.MapGet("/region-map", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => Run(ctx, auth, log, "region-map", async _ =>
            Helpers.Json(await db.QueryAsync(
                "select kode_customer, region, nama_customer, updated_at, updated_by from sementrack.sellin_region_map order by region, kode_customer"))));

        g.MapPost("/region-map", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => Run(ctx, auth, log, "region-map save", async s =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            await db.ExecuteAsync("select sementrack.sellin_region_set($1, $2, $3, $4)",
                new object?[] { b.GetString("kode_customer"), b.GetString("region"), b.GetString("nama_customer"), s.Username });
            db.ClearCache();
            return Helpers.Json(new { ok = true });
        }));

        g.MapGet("/impact", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => Run(ctx, auth, log, "impact", async _ =>
        {
            var rows = await db.QueryAsync("select * from sementrack.sellin_bnn_impact($1::date, $2::date)",
                new object?[] { ctx.Request.Query["from"].ToString(), ctx.Request.Query["to"].ToString() });
            return Helpers.Json(rows.Count > 0 ? rows[0] : new Dictionary<string, object?>());
        }));

        g.MapPost("/begin", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => Run(ctx, auth, log, "begin", async s =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            var rows = await db.QueryAsync("select sementrack.sellin_bnn_begin($1, $2, $3, $4::date, $5::date, $6::int) as id",
                new object?[] { s.Username, b.GetString("source"), b.GetString("file_name"), b.GetString("date_from"), b.GetString("date_to"), b.GetString("rows_read") ?? "0" });
            return Helpers.Json(new { id = rows[0]["id"] });
        }));

        g.MapPost("/stage", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            // Harus sebelum body dibaca: naikkan batas ukuran khusus endpoint ini (Kestrel & IIS in-process).
            var limit = ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = StageMaxBody;
            return Run(ctx, auth, log, "stage", async _ =>
            {
                var b = await Helpers.ReadBodyAsync(ctx.Request);
                var rowsEl = b.Get("rows");
                if (rowsEl is not { ValueKind: JsonValueKind.Array }) return Helpers.Error(400, "paket baris tidak valid");
                var n = await db.QueryAsync("select sementrack.sellin_bnn_stage($1::bigint, $2::json) as n",
                    new object?[] { b.GetString("upload_id"), rowsEl.Value.GetRawText() });
                return Helpers.Json(new { staged = n[0]["n"] });
            });
        });

        g.MapPost("/commit", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => Run(ctx, auth, log, "commit", async _ =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            var rows = await db.QueryAsync("select * from sementrack.sellin_bnn_commit($1::bigint)", new object?[] { b.GetString("upload_id") });
            db.ClearCache();   // halaman Sell In BNN langsung membaca data baru
            return Helpers.Json(rows[0]);
        }));

        g.MapPost("/abort", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => Run(ctx, auth, log, "abort", async _ =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            await db.ExecuteAsync("select sementrack.sellin_bnn_abort($1::bigint)", new object?[] { b.GetString("upload_id") });
            return Helpers.Json(new { ok = true });
        }));
    }

    /// <summary>Cek admin + tangani error seragam. Pesan dari fungsi database (kode 22xxx) aman ditampilkan ke admin.</summary>
    private static async Task<IResult> Run(HttpContext ctx, AuthService auth, ILogger log, string name, Func<SessionInfo, Task<IResult>> body)
    {
        var (s, fail) = await AdminEndpoints.AdminAsync(ctx, auth);
        if (fail != null) return fail;
        try { return await body(s!); }
        catch (PostgresException e) when (e.SqlState.StartsWith("22", StringComparison.Ordinal))
        {
            return Helpers.Error(400, e.MessageText);
        }
        catch (BadHttpRequestException e) when (e.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            return Helpers.Error(413, "paket terlalu besar");
        }
        catch (Exception e)
        {
            log.LogError(e, "[sellin {Name}]", name);
            return Helpers.Error(500, "Gagal memproses data sell in.");
        }
    }
}
