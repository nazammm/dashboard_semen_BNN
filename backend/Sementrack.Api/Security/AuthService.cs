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
    /// <summary>Penanda "role ini sengaja tanpa halaman" (tabel kosong = pakai default, jadi perlu baris penanda).</summary>
    public const string NoPagesMarker = "__none__";

    // Cache sesi singkat (20 dtk): satu halaman memicu ~10 request, tiap request tidak perlu 1 query sesi lagi.
    // Logout / ubah akun membersihkan cache langsung, jadi pencabutan akses tetap seketika.
    private const long SessionCacheMs = 20_000;
    private readonly ConcurrentDictionary<string, (SessionInfo S, long At)> _sessionCache = new();
    private long _lastPurge;

    public AuthService(Db db) { _db = db; }

    public static long NowSeconds() => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    /// <summary>Baca sesi dari header "Authorization: Bearer ...". null = tidak ada/kedaluwarsa.</summary>
    public async Task<(SessionInfo? Session, int Status, string? Error)> GetSessionAsync(HttpContext ctx)
    {
        var header = ctx.Request.Headers.Authorization.ToString();
        var token = header.StartsWith("Bearer ", StringComparison.Ordinal) ? header[7..] : null;
        if (string.IsNullOrEmpty(token)) return (null, 401, "missing token");

        if (token.Length > 200) return (null, 401, "expired");

        var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (_sessionCache.TryGetValue(token, out var hit))
        {
            if (nowMs - hit.At < SessionCacheMs && hit.S.ExpiresAt >= NowSeconds()) return (hit.S, 200, null);
            _sessionCache.TryRemove(token, out _);
        }

        var rows = await _db.QueryAsync(
            "select token, username, role, name, dist_code, expires_at from auth_local.sessions where token=$1", new object?[] { token });
        if (rows.Count == 0) return (null, 401, "expired");
        var r = rows[0];
        var expires = Convert.ToInt64(r["expires_at"]);
        if (expires < NowSeconds()) return (null, 401, "expired");

        var username = r["username"] as string ?? "";
        var info = new SessionInfo(token, username, r["role"] as string ?? "", (r["name"] as string) ?? username, r["dist_code"] as string, expires);
        if (_sessionCache.Count > 5000) _sessionCache.Clear();
        _sessionCache[token] = (info, nowMs);
        return (info, 200, null);
    }

    /// <summary>Logout sungguhan: sesi dihapus di server (token curian/yang tertinggal di browser jadi tidak berguna).</summary>
    public async Task RevokeAsync(string token)
    {
        _sessionCache.TryRemove(token, out _);
        await _db.ExecuteAsync("delete from auth_local.sessions where token=$1", new object?[] { token });
    }

    /// <summary>Dipanggil setelah sesi sebuah akun dihapus di database (ubah role/dist/password, hapus akun).</summary>
    public void ForgetUserSessions(string username)
    {
        foreach (var k in _sessionCache.Where(kv => kv.Value.S.Username == username).Select(kv => kv.Key).ToList())
            _sessionCache.TryRemove(k, out _);
    }

    /// <summary>Buang sesi kedaluwarsa (paling sering tiap 10 menit) supaya tabel tidak menumpuk selamanya.</summary>
    public async Task PurgeExpiredSessionsAsync()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var last = Interlocked.Read(ref _lastPurge);
        if (now - last < 600_000 || Interlocked.CompareExchange(ref _lastPurge, now, last) != last) return;
        await _db.ExecuteAsync("delete from auth_local.sessions where expires_at < $1", new object?[] { NowSeconds() });
    }

    public async Task<string[]> GetPagesForRoleAsync(string role)
    {
        if (role == "admin") return AccessRules.DefaultPagesFor("admin");
        if (!AccessRules.DefaultRolePages.ContainsKey(role)) return Array.Empty<string>();
        if (_rolePagesCache.TryGetValue(role, out var cached)) return cached;

        var rows = await _db.QueryAsync("select page_id from auth_local.role_pages where role=$1 order by page_id", new object?[] { role });
        var pages = rows.Count > 0
            ? rows.Select(x => (string)x["page_id"]!).Where(x => x != NoPagesMarker).ToArray()
            : AccessRules.DefaultPagesFor(role);
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
