using System.Text;
using Sementrack.Api.Data;
using Sementrack.Api.Security;
using Sementrack.Core;

namespace Sementrack.Api.Endpoints;

internal static class DataEndpoints
{
    public static void Map(RouteGroupBuilder api)
    {
        // ---- POST /api/rpc/{fn}: panggil fungsi dashboard_* ----
        api.MapPost("/rpc/{fn}", async (string fn, HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            if (fn == "login") return Helpers.Error(404, "unknown function"); // ditangani endpoint login
            var (s, st, err) = await auth.GetSessionAsync(ctx);
            if (s is null) return Helpers.Error(st, err!);

            if (!AccessRules.AllowedFunctions.TryGetValue(fn, out var argNames)) return Helpers.Error(404, "unknown function");
            try
            {
                var pages = await auth.GetPagesForRoleAsync(s.Role);
                var access = AccessRules.ComputeAccess(s.Role, pages);
                if (!access.Functions.Contains(fn)) return Helpers.Error(403, "role ini tidak boleh memanggil fungsi ini");

                var body = await Helpers.ReadBodyAsync(ctx.Request);
                var distCodes = s.DistCode is { Length: > 0 } ? new[] { s.DistCode } : Array.Empty<string>();
                var forceScope = argNames.Contains("p_dist_code") && AccessRules.MustForceDistScope(s.Role, fn);

                if (fn == "dashboard_store_year" && AccessRules.DistScopedRoles.Contains(s.Role))
                {
                    var rows = distCodes.Length == 0 ? new() : await db.QueryAsync(
                        "select 1 from sementrack.toko_distributor where cust_code=$1 and dist_code = any($2::text[])",
                        new object?[] { body.GetString("p_customer_code"), distCodes });
                    if (rows.Count == 0) return Helpers.Json(Array.Empty<object>());
                }

                var pars = new List<object?>();
                var args = new List<string>();
                foreach (var name in argNames)
                {
                    if (name == "p_dist_code" && forceScope)
                    {
                        args.Add(ArrayArg(name, distCodes.Cast<object?>(), pars));
                        continue;
                    }
                    var v = body.Get(name);
                    if (name == "p_dist_code" && v is { ValueKind: not System.Text.Json.JsonValueKind.Null and not System.Text.Json.JsonValueKind.Array })
                    {
                        args.Add(ArrayArg(name, new object?[] { Helpers.ScalarToString(v.Value) }, pars));
                    }
                    else if (v is { ValueKind: System.Text.Json.JsonValueKind.Array })
                    {
                        args.Add(ArrayArg(name, v.Value.EnumerateArray().Select(e => (object?)Helpers.ScalarToString(e)), pars));
                    }
                    else
                    {
                        pars.Add(v is null ? null : Helpers.ScalarToString(v.Value));
                        args.Add($"{name} => ${pars.Count}");
                    }
                }
                var schema = AccessRules.RpcSchema.TryGetValue(fn, out var sc) ? sc + "." : "";
                var result = await db.QueryAsync($"SELECT * FROM {schema}{fn}({string.Join(", ", args)})", pars);
                return Helpers.Json(result);
            }
            catch (Exception e)
            {
                log.LogError(e, "[RPC {Fn}]", fn);
                return Results.Json(new { error = "query failed", detail = e.Message }, statusCode: 500);
            }
        });

        // ---- GET /api/data-freshness ----
        api.MapGet("/data-freshness", async (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            var (s, st, err) = await auth.GetSessionAsync(ctx);
            if (s is null) return Helpers.Error(st, err!);
            try
            {
                var rows = await db.QueryAsync("select max(do_date) as max_do_date from public.transaksi");
                return Helpers.Json(new { max_do_date = rows.Count > 0 ? rows[0]["max_do_date"] : null });
            }
            catch (Exception e) { log.LogError(e, "[data-freshness]"); return Helpers.Error(500, "Gagal mengambil kesegaran data."); }
        });

        // ---- POST /api/activity/log ----
        api.MapPost("/activity/log", async (HttpContext ctx, AuthService auth, ILogger<Db> log) =>
        {
            var (s, st, err) = await auth.GetSessionAsync(ctx);
            if (s is null) return Helpers.Error(st, err!);
            var body = await Helpers.ReadBodyAsync(ctx.Request);
            var ev = body.GetString("event_type");
            if (ev != "page_view" && ev != "download") return Helpers.Error(400, "event_type tidak valid");
            auth.LogActivity(log, s.Username, s.Role, s.Name, ev, body.GetString("page_id"), body.GetString("detail"));
            return Helpers.Json(new { ok = true });
        });

        // ---- GET /api/{table}: HARUS terakhir (route dinamis) ----
        api.MapGet("/{table}", async (string table, HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            var (s, st, err) = await auth.GetSessionAsync(ctx);
            if (s is null) return Helpers.Error(st, err!);
            if (!AccessRules.AllowedTables.Contains(table)) return Helpers.Error(404, "unknown table");
            var sqlTable = AccessRules.ReadAlias.TryGetValue(table, out var alias) ? alias : table;
            try
            {
                var pages = await auth.GetPagesForRoleAsync(s.Role);
                var access = AccessRules.ComputeAccess(s.Role, pages);
                if (!access.Tables.Contains(table)) return Helpers.Error(403, "role ini tidak boleh mengakses data ini");

                var q = QueryParser.Parse(ctx.Request.Query.SelectMany(kv => kv.Value.Select(v => new KeyValuePair<string, string>(kv.Key, v ?? ""))));

                if (AccessRules.DistScopedRoles.Contains(s.Role) && AccessRules.TablesWithDistCode.Contains(table))
                {
                    if (string.IsNullOrEmpty(s.DistCode)) return Helpers.Json(Array.Empty<object>());
                    q.Where.Add($"\"dist_code\" IN ({q.AddParam(s.DistCode)})");
                }

                var whereSql = q.Where.Count > 0 ? " WHERE " + string.Join(" AND ", q.Where) : "";
                if (ctx.Request.Headers["Prefer"].ToString() == "count=exact")
                {
                    var c = await db.QueryAsync($"SELECT COUNT(*)::int AS c FROM {sqlTable}{whereSql}", q.Params.Cast<object?>());
                    ctx.Response.Headers["Content-Range"] = $"0-0/{c[0]["c"]}";
                }

                var sql = new StringBuilder($"SELECT * FROM {sqlTable}{whereSql}");
                var pars = q.Params.Cast<object?>().ToList();
                if (!string.IsNullOrEmpty(q.Order)) sql.Append(" ORDER BY ").Append(q.Order);
                if (q.Limit is int lim) { pars.Add(lim); sql.Append($" LIMIT ${pars.Count}"); }
                if (q.Offset is int off) { pars.Add(off); sql.Append($" OFFSET ${pars.Count}"); }
                return Helpers.Json(await db.QueryAsync(sql.ToString(), pars));
            }
            catch (ArgumentException e) { return Helpers.Error(400, e.Message); }
            catch (Exception e)
            {
                log.LogError(e, "[GET {Table}]", table);
                return Results.Json(new { error = "query failed", detail = e.Message }, statusCode: 500);
            }
        });
    }

    private static string ArrayArg(string name, IEnumerable<object?> values, List<object?> pars)
    {
        var ph = values.Select(v => { pars.Add(v); return "$" + pars.Count; }).ToList();
        return $"{name} => ARRAY[{string.Join(",", ph)}]::text[]";
    }
}
