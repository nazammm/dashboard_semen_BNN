namespace Sementrack.Core;

/// <summary>
/// Pembatas percobaan login per USERNAME (bukan per IP, supaya tidak bergantung konfigurasi proxy):
/// 5x gagal -> 30 detik, 10x -> 2 menit, 15x ke atas -> 15 menit. Reset saat login berhasil.
/// Disimpan di memori proses (cukup untuk satu instance).
/// </summary>
public sealed class LoginThrottle
{
    private sealed class Record { public int Fails; public long LockedUntilMs; }

    private readonly Dictionary<string, Record> _attempts = new();
    private readonly object _gate = new();
    private readonly Func<long> _nowMs;

    public LoginThrottle(Func<long>? nowMs = null)
    {
        _nowMs = nowMs ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    public static long LockoutDurationMs(int fails) => fails switch
    {
        >= 15 => 15 * 60 * 1000,
        >= 10 => 2 * 60 * 1000,
        >= 5 => 30 * 1000,
        _ => 0,
    };

    public long RemainingMs(string username)
    {
        lock (_gate)
        {
            if (!_attempts.TryGetValue(username, out var rec) || rec.LockedUntilMs == 0) return 0;
            return Math.Max(0, rec.LockedUntilMs - _nowMs());
        }
    }

    public void RecordFailure(string username)
    {
        lock (_gate)
        {
            if (!_attempts.TryGetValue(username, out var rec)) _attempts[username] = rec = new Record();
            rec.Fails++;
            var dur = LockoutDurationMs(rec.Fails);
            if (dur > 0) rec.LockedUntilMs = _nowMs() + dur;
        }
    }

    public void RecordSuccess(string username)
    {
        lock (_gate) { _attempts.Remove(username); }
    }
}
