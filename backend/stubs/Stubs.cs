// Stub permukaan API Npgsql 8 dan BCrypt.Net-Next yang dipakai Sementrack.Api.
// Tujuannya hanya memeriksa bahwa kode kita konsisten dengan bentuk API itu saat kompilasi.
// TIDAK ada logika database/bcrypt di sini.
using System.Data.Common;

namespace NpgsqlTypes { public enum NpgsqlDbType { Unknown = 40, Text = 19, Integer = 9 } }

namespace Npgsql
{
    public class NpgsqlConnectionStringBuilder { public string? Host { get; set; } public int Port { get; set; } public string? Database { get; set; } public string? Username { get; set; } public string? Password { get; set; } public int MaxPoolSize { get; set; } public string ConnectionString => ""; }
    public class PostgresException : Exception { public string SqlState { get; set; } = ""; }
    public class NpgsqlParameter { public NpgsqlTypes.NpgsqlDbType NpgsqlDbType { get; set; } public object? Value { get; set; } }
    public class NpgsqlParameterCollection { public NpgsqlParameter Add(NpgsqlParameter p) => p; }
    public class NpgsqlConnection : IAsyncDisposable { public ValueTask DisposeAsync() => default; }
    public class NpgsqlDataReader : IAsyncDisposable
    {
        public int FieldCount => 0;
        public string GetName(int i) => "";
        public bool IsDBNull(int i) => true;
        public object GetValue(int i) => DBNull.Value;
        public Task<bool> ReadAsync(CancellationToken ct = default) => Task.FromResult(false);
        public ValueTask DisposeAsync() => default;
    }
    public class NpgsqlCommand : IAsyncDisposable
    {
        public NpgsqlCommand(string sql, NpgsqlConnection conn) { }
        public NpgsqlParameterCollection Parameters { get; } = new();
        public Task<NpgsqlDataReader> ExecuteReaderAsync(CancellationToken ct = default) => Task.FromResult(new NpgsqlDataReader());
        public Task<int> ExecuteNonQueryAsync(CancellationToken ct = default) => Task.FromResult(0);
        public ValueTask DisposeAsync() => default;
    }
    public class NpgsqlDataSource : IAsyncDisposable
    {
        public static NpgsqlDataSource Create(string connectionString) => new();
        public ValueTask<NpgsqlConnection> OpenConnectionAsync(CancellationToken ct = default) => new(new NpgsqlConnection());
        public ValueTask DisposeAsync() => default;
    }
}

namespace BCrypt.Net
{
    public static class BCrypt
    {
        public static string HashPassword(string text, int workFactor) => "";
        public static bool Verify(string text, string hash) => false;
    }
}
