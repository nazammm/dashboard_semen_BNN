using System.Text.Json;
using Microsoft.AspNetCore.Http.Features;
using Sementrack.Api.Data;
using Sementrack.Api.Security;

namespace Sementrack.Api.Endpoints;

/// <summary>
/// Kelola Data → Tabel (khusus admin): edit langsung tabel master kecil.
/// Daftar tabel, kolom, kunci, dan validasi ada di database (sementrack.tabel_edit, tabel_baca, tabel_opsi, tabel_simpan,
/// docs/sql/kelola_tabel.sql). Endpoint ini hanya meneruskan, jadi tabel yang tidak terdaftar tidak bisa dibuka.
/// </summary>
internal static class TabelEndpoints
{
    private const long SaveMaxBody = 12 * 1024 * 1024;

    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/admin/tabel");

        g.MapGet("", (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "tabel daftar", async _ =>
            Helpers.Json(await db.QueryAsync(
                "select id, grup, label, keterangan, pk, kolom::text as kolom, filter from sementrack.tabel_edit where aktif order by urutan, label"))));

        g.MapGet("/{id}/opsi", (string id, HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "tabel opsi", async _ =>
        {
            var rows = await db.QueryAsync("select sementrack.tabel_opsi($1)::text as j", new object?[] { id });
            return Results.Content(rows[0]["j"]?.ToString() ?? "{}", "application/json");
        }));

        // filter dikirim sebagai query string kolom=nilai; kolom yang boleh diperiksa database
        g.MapGet("/{id}", (string id, HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) => SellinEndpoints.Run(ctx, auth, log, "tabel baca", async _ =>
        {
            var filter = ctx.Request.Query.ToDictionary(q => q.Key, q => q.Value.ToString());
            var rows = await db.QueryAsync("select sementrack.tabel_baca($1, $2::json)::text as j",
                new object?[] { id, JsonSerializer.Serialize(filter) }, timeoutSeconds: KelolaEndpoints.LongQuery);
            return Results.Content(rows[0]["j"]?.ToString() ?? "[]", "application/json");
        }));

        g.MapPost("/{id}", (string id, HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            var limit = ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = SaveMaxBody;
            return SellinEndpoints.Run(ctx, auth, log, "tabel simpan", async s =>
            {
                var b = await Helpers.ReadBodyAsync(ctx.Request);
                var up = b.Get("upsert"); var del = b.Get("delete");
                if (up is not { ValueKind: JsonValueKind.Array } || del is not { ValueKind: JsonValueKind.Array }) return Helpers.Error(400, "perubahan tidak valid");
                var rows = await db.QueryAsync("select * from sementrack.tabel_simpan($1, $2, $3::json, $4::json)",
                    new object?[] { id, s.Username, up.Value.GetRawText(), del.Value.GetRawText() }, timeoutSeconds: KelolaEndpoints.LongQuery);
                db.ClearCache();   // halaman lain langsung membaca data baru
                return Helpers.Json(rows[0]);
            });
        });
    }
}
