namespace Sementrack.Core;

/// <summary>
/// Pembatas percobaan login per USERNAME (bukan per IP, supaya tidak bergantung konfigurasi proxy):
/// 5x gagal -> 30 detik, 10x -> 2 menit, 15x ke atas -> 15 menit. Reset saat login berhasil.
/// Disimpan di memori proses (cukup untuk satu instance).
/// </summary>
public sealed class LoginThrottle
{
    private sealed class Record { public int Fails; public long LockedUntilMs; public long LastMs; }

    private readonly Dictionary<string, Record> _attempts = new();
    private readonly object _gate = new();
    private readonly Func<long> _nowMs;

    private readonly int _scale;
    /// <summary>Catatan gagal yang lebih tua dari ini dianggap kedaluwarsa (dan dibuang) supaya memori tidak membengkak.</summary>
    private const long StaleAfterMs = 60 * 60 * 1000;
    private const int MaxEntries = 20000;

    /// <param name="scale">Pengali ambang (1 = per akun; &gt;1 = longgar, mis. untuk pembatas per alamat IP).</param>
    public LoginThrottle(Func<long>? nowMs = null, int scale = 1)
    {
        _nowMs = nowMs ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        _scale = Math.Max(1, scale);
    }

    public static long LockoutDurationMs(int fails) => fails switch
    {
        >= 15 => 15 * 60 * 1000,
        >= 10 => 2 * 60 * 1000,
        >= 5 => 30 * 1000,
        _ => 0,
    };

    private long DurationFor(int fails) => LockoutDurationMs(fails / _scale);

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
            var now = _nowMs();
            if (_attempts.Count >= MaxEntries) Prune(now);
            if (!_attempts.TryGetValue(username, out var rec) || now - rec.LastMs > StaleAfterMs) _attempts[username] = rec = new Record();
            rec.Fails++;
            rec.LastMs = now;
            var dur = DurationFor(rec.Fails);
            if (dur > 0) rec.LockedUntilMs = now + dur;
        }
    }

    private void Prune(long now)
    {
        foreach (var k in _attempts.Where(kv => now - kv.Value.LastMs > StaleAfterMs || (kv.Value.LockedUntilMs < now && kv.Value.Fails < 5 * _scale)).Select(kv => kv.Key).ToList())
            _attempts.Remove(k);
        if (_attempts.Count >= MaxEntries) _attempts.Clear();   // serangan banjir nama: lebih baik reset daripada kehabisan memori
    }

    public void RecordSuccess(string username)
    {
        lock (_gate) { _attempts.Remove(username); }
    }
}

/// <summary>Pembatas longgar per alamat IP (pembungkus LoginThrottle berskala besar), dipasang terpisah di DI.</summary>
public sealed class IpLoginThrottle
{
    public LoginThrottle Inner { get; } = new(scale: 8);
}
