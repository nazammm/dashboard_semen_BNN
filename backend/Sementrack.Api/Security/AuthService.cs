using System.Collections.Concurrent;
using Sementrack.Api.Data;
using Sementrack.Core;

namespace Sementrack.Api.Security;

public sealed record SessionInfo(string Token, string Username, string Role, string Name, string? DistCode, long ExpiresAt);

/// <summary>Sesi (tabel auth_local.sessions, token acak) + hak halaman per role (auth_local.role_pages) dengan cache.</summary>
public sealed class AuthService
{
    private readonly Db _db;
    private readonly ConcurrentDictionary<string, string[]> _rolePagesCache = new();

    public AuthService(Db db) { _db = db; }

    public static long NowSeconds() => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    /// <summary>Baca sesi dari header "Authorization: Bearer ...". null = tidak ada/kedaluwarsa.</summary>
    public async Task<(SessionInfo? Session, int Status, string? Error)> GetSessionAsync(HttpContext ctx)
    {
        var header = ctx.Request.Headers.Authorization.ToString();
        var token = header.StartsWith("Bearer ", StringComparison.Ordinal) ? header[7..] : null;
        if (string.IsNullOrEmpty(token)) return (null, 401, "missing token");

        var rows = await _db.QueryAsync(
            "select token, username, role, name, dist_code, expires_at from auth_local.sessions where token=$1", new object?[] { token });
        if (rows.Count == 0) return (null, 401, "expired");
        var r = rows[0];
        var expires = Convert.ToInt64(r["expires_at"]);
        if (expires < NowSeconds()) return (null, 401, "expired");

        var username = r["username"] as string ?? "";
        return (new SessionInfo(token, username, r["role"] as string ?? "", (r["name"] as string) ?? username, r["dist_code"] as string, expires), 200, null);
    }

    public async Task<string[]> GetPagesForRoleAsync(string role)
    {
        if (role == "admin") return AccessRules.DefaultPagesFor("admin");
        if (!AccessRules.DefaultRolePages.ContainsKey(role)) return Array.Empty<string>();
        if (_rolePagesCache.TryGetValue(role, out var cached)) return cached;

        var rows = await _db.QueryAsync("select page_id from auth_local.role_pages where role=$1 order by page_id", new object?[] { role });
        var pages = rows.Count > 0 ? rows.Select(x => (string)x["page_id"]!).ToArray() : AccessRules.DefaultPagesFor(role);
        _rolePagesCache[role] = pages;
        return pages;
    }

    public void InvalidateRolePagesCache(string? role = null)
    {
        if (role == null) _rolePagesCache.Clear(); else _rolePagesCache.TryRemove(role, out _);
    }

    public async Task<Dictionary<string, AccessRules.PagePermission>> GetPagePermissionsForRoleAsync(string role, IEnumerable<string> pages)
    {
        var result = new Dictionary<string, AccessRules.PagePermission>();
        if (role == "admin" || role == "mo")
        {
            foreach (var p in pages) result[p] = new AccessRules.PagePermission(true, true);
            return result;
        }
        var rows = await _db.QueryAsync("select page_id, can_view_detail, can_download from auth_local.role_pages where role=$1", new object?[] { role });
        var saved = rows.ToDictionary(r => (string)r["page_id"]!, r => new AccessRules.PagePermission((bool)r["can_view_detail"]!, (bool)r["can_download"]!));
        foreach (var p in pages)
            result[p] = saved.TryGetValue(p, out var perm) ? perm : AccessRules.DefaultPermFor(role, p);
        return result;
    }

    /// <summary>Catat aktivitas tanpa menunggu (gagal mencatat tidak boleh mengganggu request utama). Aktivitas admin tidak dicatat.</summary>
    public void LogActivity(ILogger logger, string username, string role, string name, string eventType, string? pageId, string? detail)
    {
        if (string.Equals(role, "admin", StringComparison.OrdinalIgnoreCase)) return;
        _ = Task.Run(async () =>
        {
            try
            {
                await _db.ExecuteAsync(
                    "insert into auth_local.activity_log (username, role, name, event_type, page_id, detail) values ($1,$2,$3,$4,$5,$6)",
                    new object?[] { username, role, name, eventType, pageId, detail });
            }
            catch (Exception e) { logger.LogError(e, "[activity_log] gagal mencatat"); }
        });
    }
}
