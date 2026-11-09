using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Sementrack.Api.Data;
using Sementrack.Api.Security;

namespace Sementrack.Api.Endpoints;

/// <summary>
/// Upload Outstanding DO (khusus admin): export raw sell in menurut tanggal order.
/// Aturan baris, penggabungan per order, dan penggantian per rentang tanggal order ada di
/// fungsi database sementrack.sellin_po_* (docs/sql/outstanding_do.sql). Alur: begin -> stage -> commit, atau abort.
/// </summary>
internal static class OutstandingEndpoints
{
    private const long StageMaxBody = 12 * 1024 * 1024;

    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/admin/outstanding");

        g.MapGet("/impact", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "outstanding impact", async _ =>
        {
            var rows = await db.QueryAsync("select * from sementrack.sellin_po_impact($1::date, $2::date)",
                new object?[] { ctx.Request.Query["from"].ToString(), ctx.Request.Query["to"].ToString() });
            return Helpers.Json(rows.Count > 0 ? rows[0] : new Dictionary<string, object?>());
        }));

        g.MapPost("/begin", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "outstanding begin", async s =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            var rows = await db.QueryAsync("select sementrack.sellin_po_begin($1, $2, $3, $4::date, $5::date, $6::int) as id",
                new object?[] { s.Username, b.GetString("source"), b.GetString("file_name"), b.GetString("date_from"), b.GetString("date_to"), b.GetString("rows_read") ?? "0" });
            return Helpers.Json(new { id = rows[0]["id"] });
        }));

        g.MapPost("/stage", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            var limit = ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = StageMaxBody;
            return SellinEndpoints.Run(ctx, auth, log, "outstanding stage", async _ =>
            {
                var b = await Helpers.ReadBodyAsync(ctx.Request);
                var rowsEl = b.Get("rows");
                if (rowsEl is not { ValueKind: JsonValueKind.Array }) return Helpers.Error(400, "paket baris tidak valid");
                var n = await db.QueryAsync("select sementrack.sellin_po_stage($1::bigint, $2::json) as n",
                    new object?[] { b.GetString("upload_id"), rowsEl.Value.GetRawText() });
                return Helpers.Json(new { staged = n[0]["n"] });
            });
        });

        g.MapPost("/commit", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "outstanding commit", async _ =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            var rows = await db.QueryAsync("select * from sementrack.sellin_po_commit($1::bigint)", new object?[] { b.GetString("upload_id") }, timeoutSeconds: KelolaEndpoints.LongQuery);
            db.ClearCache();
            return Helpers.Json(rows[0]);
        }));

        g.MapPost("/abort", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "outstanding abort", async _ =>
        {
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            await db.ExecuteAsync("select sementrack.sellin_po_abort($1::bigint)", new object?[] { b.GetString("upload_id") });
            return Helpers.Json(new { ok = true });
        }));
    }
}
