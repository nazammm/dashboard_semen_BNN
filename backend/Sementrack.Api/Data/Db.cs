using System.Collections.Concurrent;
using System.Globalization;
using Npgsql;
using NpgsqlTypes;
using Sementrack.Core;

namespace Sementrack.Api.Data;

/// <summary>
/// Satu-satunya tempat yang bicara langsung dengan Npgsql. Dibuat setipis mungkin.
/// Parameter bertipe string dikirim sebagai "unknown" supaya PostgreSQL yang menentukan tipenya dari konteks
/// (sama seperti perilaku driver pg di Node: "date >= $1" tetap valid dengan teks "2026-01-01").
/// </summary>
public sealed class Db
{
    private readonly NpgsqlDataSource _ds;
    public Db(NpgsqlDataSource ds) { _ds = ds; }

    private static NpgsqlParameter ToParam(object? v)
    {
        if (v is null) return new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Unknown, Value = DBNull.Value };
        if (v is string s) return new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Unknown, Value = s };
        return new NpgsqlParameter { Value = v };
    }

    private static void AddParams(NpgsqlCommand cmd, IEnumerable<object?> pars)
    {
        foreach (var p in pars) cmd.Parameters.Add(ToParam(p));
    }

    /// <param name="timeoutSeconds">Batas waktu query; default Npgsql 30 detik. Simpan/hapus data besar (memicu refresh
    /// materialized view) memakai batas lebih panjang.</param>
    public async Task<List<Dictionary<string, object?>>> QueryAsync(string sql, IEnumerable<object?>? pars = null, CancellationToken ct = default, int? timeoutSeconds = null)
    {
        await using var conn = await _ds.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(sql, conn);
        if (timeoutSeconds is int t) cmd.CommandTimeout = t;
        if (pars != null) AddParams(cmd, pars);
        await using var rd = await cmd.ExecuteReaderAsync(ct);
        var rows = new List<Dictionary<string, object?>>();
        while (await rd.ReadAsync(ct))
        {
            var row = new Dictionary<string, object?>(rd.FieldCount);
            for (int i = 0; i < rd.FieldCount; i++)
                row[rd.GetName(i)] = rd.IsDBNull(i) ? null : ValueNormalizer.Normalize(rd.GetValue(i), rd.GetDataTypeName(i));
            rows.Add(row);
        }
        return rows;
    }

    // ---- Cache hasil singkat untuk bacaan data dashboard ------------------------------------------
    // Data hanya berubah saat import (batch), tapi view-nya berat (1-2 dtk) dan dipakai semua pengguna.
    // Kunci = teks SQL + parameter. Filter distributor spv/sales sudah MASUK ke SQL/parameter, jadi hasil
    // satu distributor tidak pernah terpakai oleh distributor lain. Permintaan identik yang berbarengan
    // berbagi satu eksekusi (single-flight).
    private sealed record CacheEntry(long At, Task<List<Dictionary<string, object?>>> Task);
    private readonly ConcurrentDictionary<string, CacheEntry> _cache = new();
    private const int MaxCachedRowsTotal = 60_000;

    public async Task<List<Dictionary<string, object?>>> QueryCachedAsync(string sql, IEnumerable<object?> pars, int ttlSeconds = 45)
    {
        var plist = pars.ToList();
        var key = sql + "\u0001" + string.Join("\u0002", plist.Select(p => p is null ? "\0null" : p.GetType().Name + ":" + p));
        var now = Environment.TickCount64;
        if (_cache.TryGetValue(key, out var hit) && now - hit.At < ttlSeconds * 1000L && !hit.Task.IsFaulted && !hit.Task.IsCanceled)
            return await hit.Task;

        var entry = new CacheEntry(now, QueryAsync(sql, plist));
        _cache[key] = entry;
        try
        {
            var rows = await entry.Task;
            TrimCache(now, ttlSeconds);
            return rows;
        }
        catch
        {
            _cache.TryRemove(new KeyValuePair<string, CacheEntry>(key, entry));   // kegagalan tidak di-cache
            throw;
        }
    }

    private void TrimCache(long now, int ttlSeconds)
    {
        long total = 0;
        foreach (var kv in _cache.ToArray())
        {
            if (now - kv.Value.At >= ttlSeconds * 1000L) { _cache.TryRemove(kv); continue; }
            if (kv.Value.Task.IsCompletedSuccessfully) total += kv.Value.Task.Result.Count;
        }
        if (total > MaxCachedRowsTotal) _cache.Clear();   // batas memori: lebih baik hitung ulang daripada membengkak
    }

    /// <summary>Kosongkan cache bacaan (dipanggil setelah data diganti lewat upload).</summary>
    public void ClearCache() => _cache.Clear();

    public async Task<int> ExecuteAsync(string sql, IEnumerable<object?>? pars = null, CancellationToken ct = default)
    {
        await using var conn = await _ds.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(sql, conn);
        if (pars != null) AddParams(cmd, pars);
        return await cmd.ExecuteNonQueryAsync(ct);
    }

}
