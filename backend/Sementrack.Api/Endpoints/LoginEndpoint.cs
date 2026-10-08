using System.Security.Cryptography;
using Sementrack.Api.Data;
using Sementrack.Api.Security;
using Sementrack.Core;

namespace Sementrack.Api.Endpoints;

internal static class LoginEndpoint
{
    public static void Map(RouteGroupBuilder api)
    {
        api.MapPost("/rpc/login", async (HttpContext ctx, AuthService auth, Db db, LoginThrottle throttle, IConfiguration cfg, ILogger<Db> log) =>
        {
            var body = await Helpers.ReadBodyAsync(ctx.Request);
            var uname = (body.GetString("username") ?? "").Trim().ToLowerInvariant();
            var password = body.GetString("password") ?? "";
            try
            {
                var remaining = throttle.RemainingMs(uname);
                if (remaining > 0)
                    return Results.Json(new { error = "too many failed attempts, try again later", retry_after_seconds = (long)Math.Ceiling(remaining / 1000.0) }, statusCode: 429);

                var rows = await db.QueryAsync("select username, password_hash, role, name, dist_code from auth_local.users where username=$1", new object?[] { uname });
                var u = rows.FirstOrDefault();
                await Task.Delay(300); // hambat brute-force sedikit
                var ok = PasswordHasher.Verify(password, u?["password_hash"] as string) && u is not null;
                if (!ok)
                {
                    throttle.RecordFailure(uname);
                    return Helpers.Error(401, "invalid credentials");
                }
                throttle.RecordSuccess(uname);

                var username = (string)u!["username"]!;
                var role = (string)u["role"]!;
                var name = (u["name"] as string) is { Length: > 0 } n ? n : username;
                var distCode = u["dist_code"] as string;
                if (string.IsNullOrEmpty(distCode)) distCode = null;

                var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
                var hours = cfg.GetValue("SESSION_HOURS", 8);
                var expiresAt = AuthService.NowSeconds() + hours * 3600L;
                await db.ExecuteAsync(
                    "insert into auth_local.sessions (token, username, role, name, dist_code, expires_at) values ($1,$2,$3,$4,$5,$6)",
                    new object?[] { token, username, role, name, distCode, expiresAt });

                var pages = await auth.GetPagesForRoleAsync(role);
                var perms = await auth.GetPagePermissionsForRoleAsync(role, pages);
                auth.LogActivity(log, username, role, name, "login", null, null);
                return Helpers.Json(new
                {
                    access_token = token, expires_at = expiresAt, role, username, name, dist_code = distCode, pages,
                    pagePermissions = perms.ToDictionary(k => k.Key, k => new { can_view_detail = k.Value.CanViewDetail, can_download = k.Value.CanDownload }),
                });
            }
            catch (Exception e)
            {
                log.LogError(e, "[login]");
                return Helpers.Error(500, "server error");
            }
        });
    }
}
