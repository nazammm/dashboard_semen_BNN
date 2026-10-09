using System.Text.RegularExpressions;
using Npgsql;
using Sementrack.Api.Data;
using Sementrack.Api.Security;
using Sementrack.Core;

namespace Sementrack.Api.Endpoints;

internal static class AdminEndpoints
{
    private static readonly Regex UserRe = new("^[a-z0-9_.-]{3,32}$", RegexOptions.Compiled);

    private static async Task<(SessionInfo? S, IResult? Fail)> AdminAsync(HttpContext ctx, AuthService auth)
    {
        var (s, st, err) = await auth.GetSessionAsync(ctx);
        if (s is null) return (null, Helpers.Error(st, err!));
        if (s.Role != "admin") return (null, Helpers.Error(403, "khusus akun admin"));
        return (s, null);
    }

    public static void Map(RouteGroupBuilder api)
    {
        var admin = api.MapGroup("/admin");

        admin.MapGet("/users", async (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            var (_, fail) = await AdminAsync(ctx, auth); if (fail != null) return fail;
            try { return Helpers.Json(await db.QueryAsync("select username, name, role, dist_code, created_at from auth_local.users order by role, username")); }
            catch (Exception e) { log.LogError(e, "[admin/users list]"); return Helpers.Error(500, "gagal mengambil daftar akun"); }
        });

        admin.MapGet("/distributor-list", async (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            var (_, fail) = await AdminAsync(ctx, auth); if (fail != null) return fail;
            try { return Helpers.Json(await db.QueryAsync("select dist_code, dist_name from public.distributor where tag = 'Distributor' order by dist_code")); }
            catch (Exception e) { log.LogError(e, "[admin/distributor-list]"); return Helpers.Error(500, "Gagal mengambil daftar distributor."); }
        });

        admin.MapPost("/users", async (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            var (_, fail) = await AdminAsync(ctx, auth); if (fail != null) return fail;
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            var uname = (b.GetString("username") ?? "").Trim().ToLowerInvariant();
            var role = b.GetString("role") ?? "";
            var password = b.GetString("password") ?? "";
            var dc = b.GetString("dist_code")?.Trim();
            if (string.IsNullOrEmpty(dc)) dc = null;
            if (!UserRe.IsMatch(uname)) return Helpers.Error(400, "Username tidak valid (huruf kecil, angka, titik/underscore/strip, 3-32 karakter).");
            if (!AccessRules.AllRoles.Contains(role)) return Helpers.Error(400, "Role tidak valid.");
            if (password.Length < 8) return Helpers.Error(400, "Password minimal 8 karakter.");
            var scoped = AccessRules.DistScopedRoles.Contains(role);
            if (scoped && dc is null) return Helpers.Error(400, "Role spv/sales wajib diisi distributornya.");
            try
            {
                var name = (b.GetString("name") ?? uname).Trim();
                await db.ExecuteAsync("insert into auth_local.users (username, password_hash, role, name, dist_code) values ($1,$2,$3,$4,$5)",
                    new object?[] { uname, PasswordHasher.Hash(password), role, name.Length > 0 ? name : uname, scoped ? dc : null });
                return Helpers.Json(new { ok = true });
            }
            catch (PostgresException e) when (e.SqlState == "23505") { return Helpers.Error(409, "Username sudah dipakai."); }
            catch (Exception e) { log.LogError(e, "[admin/users create]"); return Helpers.Error(500, "Gagal membuat akun."); }
        });

        admin.MapPut("/users/{username}", async (string username, HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            var (_, fail) = await AdminAsync(ctx, auth); if (fail != null) return fail;
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            try
            {
                var rows = await db.QueryAsync("select role, dist_code from auth_local.users where username=$1", new object?[] { username });
                if (rows.Count == 0) return Helpers.Error(404, "Akun tidak ditemukan.");
                var cur = rows[0];
                var role = b.GetString("role");
                if (!string.IsNullOrEmpty(role) && !AccessRules.AllRoles.Contains(role)) return Helpers.Error(400, "Role tidak valid.");
                if (!string.IsNullOrEmpty(role) && role != "admin" && (string)cur["role"]! == "admin")
                {
                    var c = await db.QueryAsync("select count(*)::int as c from auth_local.users where role='admin'");
                    if (Convert.ToInt32(c[0]["c"]) <= 1) return Helpers.Error(400, "Tidak bisa mengubah role admin terakhir (dashboard butuh minimal 1 akun admin).");
                }
                var effRole = string.IsNullOrEmpty(role) ? (string)cur["role"]! : role;
                var distSent = b.Has("dist_code");
                var dc = distSent ? (b.GetString("dist_code") is { } d && d.Trim().Length > 0 ? d.Trim() : null) : cur["dist_code"] as string;
                var scoped = AccessRules.DistScopedRoles.Contains(effRole);
                if (scoped && dc is null) return Helpers.Error(400, "Role spv/sales wajib diisi distributornya.");

                var sets = new List<string>(); var pars = new List<object?>();
                var name = b.GetString("name")?.Trim();
                if (!string.IsNullOrEmpty(name)) { pars.Add(name); sets.Add($"name=${pars.Count}"); }
                if (!string.IsNullOrEmpty(role)) { pars.Add(role); sets.Add($"role=${pars.Count}"); }
                pars.Add(scoped ? dc : null); sets.Add($"dist_code=${pars.Count}");
                var password = b.GetString("password");
                if (!string.IsNullOrEmpty(password))
                {
                    if (password.Length < 8) return Helpers.Error(400, "Password minimal 8 karakter.");
                    pars.Add(PasswordHasher.Hash(password)); sets.Add($"password_hash=${pars.Count}");
                }
                pars.Add(username);
                await db.ExecuteAsync($"update auth_local.users set {string.Join(", ", sets)} where username=${pars.Count}", pars);

                // Paksa logout kalau role / dist_code / password berubah, supaya hak lama tidak terpakai.
                if (!string.IsNullOrEmpty(role) || distSent || !string.IsNullOrEmpty(password))
                    await db.ExecuteAsync("delete from auth_local.sessions where username=$1", new object?[] { username });
                return Helpers.Json(new { ok = true });
            }
            catch (Exception e) { log.LogError(e, "[admin/users update]"); return Helpers.Error(500, "Gagal mengubah akun."); }
        });

        admin.MapDelete("/users/{username}", async (string username, HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            var (_, fail) = await AdminAsync(ctx, auth); if (fail != null) return fail;
            try
            {
                var rows = await db.QueryAsync("select role from auth_local.users where username=$1", new object?[] { username });
                if (rows.Count == 0) return Helpers.Error(404, "Akun tidak ditemukan.");
                if ((string)rows[0]["role"]! == "admin")
                {
                    var c = await db.QueryAsync("select count(*)::int as c from auth_local.users where role='admin'");
                    if (Convert.ToInt32(c[0]["c"]) <= 1) return Helpers.Error(400, "Tidak bisa menghapus admin terakhir (dashboard butuh minimal 1 akun admin).");
                }
                await db.ExecuteAsync("delete from auth_local.sessions where username=$1", new object?[] { username });
                await db.ExecuteAsync("delete from auth_local.users where username=$1", new object?[] { username });
                return Helpers.Json(new { ok = true });
            }
            catch (Exception e) { log.LogError(e, "[admin/users delete]"); return Helpers.Error(500, "Gagal menghapus akun."); }
        });

        admin.MapGet("/role-pages", async (HttpContext ctx, AuthService auth, ILogger<Db> log) =>
        {
            var (_, fail) = await AdminAsync(ctx, auth); if (fail != null) return fail;
            try
            {
                var mo = await auth.GetPagesForRoleAsync("mo");
                var sales = await auth.GetPagesForRoleAsync("sales");
                var spv = await auth.GetPagesForRoleAsync("spv");
                static object Shape(Dictionary<string, AccessRules.PagePermission> d) =>
                    d.ToDictionary(k => k.Key, k => new { can_view_detail = k.Value.CanViewDetail, can_download = k.Value.CanDownload });
                return Helpers.Json(new
                {
                    allPages = AccessRules.DashboardPages,
                    current = new { mo, sales, spv },
                    permissions = new { sales = Shape(await auth.GetPagePermissionsForRoleAsync("sales", sales)), spv = Shape(await auth.GetPagePermissionsForRoleAsync("spv", spv)) },
                });
            }
            catch (Exception e) { log.LogError(e, "[admin/role-pages get]"); return Helpers.Error(500, "Gagal mengambil hak akses halaman."); }
        });

        admin.MapPost("/role-pages", async (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            var (_, fail) = await AdminAsync(ctx, auth); if (fail != null) return fail;
            var b = await Helpers.ReadBodyAsync(ctx.Request);
            var role = b.GetString("role") ?? "";
            if (role is not ("mo" or "sales" or "spv")) return Helpers.Error(400, "Role tidak valid.");
            var pagesEl = b.Get("pages");
            if (pagesEl is not { ValueKind: System.Text.Json.JsonValueKind.Array }) return Helpers.Error(400, "Daftar halaman tidak valid.");
            var pages = pagesEl.Value.EnumerateArray().Select(e => Helpers.ScalarToString(e) ?? "").ToList();
            if (pages.Any(p => !AccessRules.DashboardPages.Contains(p))) return Helpers.Error(400, "Daftar halaman tidak valid.");
            var perms = b.Get("permissions");
            try
            {
                await db.ExecuteAsync("delete from auth_local.role_pages where role=$1", new object?[] { role });
                foreach (var p in pages)
                {
                    bool view = true, dl = true;
                    if (perms is { ValueKind: System.Text.Json.JsonValueKind.Object } pe && pe.TryGetProperty(p, out var one) && one.ValueKind == System.Text.Json.JsonValueKind.Object)
                    {
                        if (one.TryGetProperty("can_view_detail", out var v)) view = Truthy(v);
                        if (one.TryGetProperty("can_download", out var d)) dl = Truthy(d);
                    }
                    await db.ExecuteAsync("insert into auth_local.role_pages (role, page_id, can_view_detail, can_download) values ($1,$2,$3,$4)",
                        new object?[] { role, p, view, dl });
                }
                auth.InvalidateRolePagesCache(role);
                return Helpers.Json(new { ok = true });
            }
            catch (Exception e) { log.LogError(e, "[admin/role-pages save]"); return Helpers.Error(500, "Gagal menyimpan hak akses."); }
        });

        admin.MapGet("/activity", async (HttpContext ctx, AuthService auth, Db db, ILogger<Db> log) =>
        {
            var (_, fail) = await AdminAsync(ctx, auth); if (fail != null) return fail;
            try
            {
                var since30 = DateTimeOffset.UtcNow.AddDays(-30);
                // awal hari menurut zona waktu server (sama dengan Node), dikirim sebagai UTC: Npgsql menolak DateTimeOffset ber-offset != 0
                var today = new DateTimeOffset(DateTime.Today).ToUniversalTime();
                static async Task<int> Count(Db db, string ev, DateTimeOffset t) =>
                    Convert.ToInt32((await db.QueryAsync($"select count(*)::int c from auth_local.activity_log where event_type='{ev}' and lower(role)!='admin' and created_at >= $1", new object?[] { t }))[0]["c"]);
                var active = Convert.ToInt32((await db.QueryAsync("select count(distinct username)::int c from auth_local.activity_log where lower(role)!='admin' and created_at >= $1", new object?[] { today }))[0]["c"]);
                return Helpers.Json(new
                {
                    summary = new { logins_today = await Count(db, "login", today), page_views_today = await Count(db, "page_view", today), downloads_today = await Count(db, "download", today), active_users_today = active },
                    active_users_by_role = await db.QueryAsync("select role, username, max(name) as name, max(created_at) as last_activity from auth_local.activity_log where lower(role) != 'admin' and created_at >= $1 group by role, username order by role, last_activity desc", new object?[] { today }),
                    recent_logins = await db.QueryAsync("select username, name, role, created_at from auth_local.activity_log where event_type='login' and lower(role)!='admin' order by created_at desc limit 20"),
                    page_view_counts = await db.QueryAsync("select page_id, count(*)::int c from auth_local.activity_log where event_type='page_view' and lower(role)!='admin' and page_id is not null and created_at >= $1 group by page_id order by c desc", new object?[] { since30 }),
                    recent_downloads = await db.QueryAsync("select username, name, detail, created_at from auth_local.activity_log where event_type='download' and lower(role)!='admin' order by created_at desc limit 20"),
                    recent_activity = await db.QueryAsync("select username, name, role, event_type, page_id, detail, created_at from auth_local.activity_log where lower(role)!='admin' order by created_at desc limit 50"),
                });
            }
            catch (Exception e) { log.LogError(e, "[admin/activity]"); return Helpers.Error(500, "Gagal mengambil data aktivitas."); }
        });
    }

    private static bool Truthy(System.Text.Json.JsonElement v) => v.ValueKind switch
    {
        System.Text.Json.JsonValueKind.True => true,
        System.Text.Json.JsonValueKind.False or System.Text.Json.JsonValueKind.Null => false,
        System.Text.Json.JsonValueKind.Number => v.GetDouble() != 0,
        System.Text.Json.JsonValueKind.String => v.GetString() != "",
        _ => true,
    };
}
