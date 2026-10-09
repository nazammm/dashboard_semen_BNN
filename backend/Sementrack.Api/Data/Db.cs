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

    public async Task<List<Dictionary<string, object?>>> QueryAsync(string sql, IEnumerable<object?>? pars = null, CancellationToken ct = default)
    {
        await using var conn = await _ds.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(sql, conn);
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

    public async Task<int> ExecuteAsync(string sql, IEnumerable<object?>? pars = null, CancellationToken ct = default)
    {
        await using var conn = await _ds.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(sql, conn);
        if (pars != null) AddParams(cmd, pars);
        return await cmd.ExecuteNonQueryAsync(ct);
    }

}
