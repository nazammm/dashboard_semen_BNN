using System.Globalization;

namespace Sementrack.Core;

/// <summary>
/// Membentuk nilai kolom database agar JSON-nya sama dengan versi Node:
/// DATE -> "YYYY-MM-DD" (TANPA konversi zona waktu), timestamptz -> ISO-8601 UTC.
/// Npgsql mengembalikan kolom `date` sebagai DateTime (Kind=Unspecified); memanggil ToUniversalTime()
/// padanya menggeser tanggal mundur sebanyak offset zona server (mis. UTC+7 -> "2026-09-30T17:00:00Z").
/// </summary>
public static class ValueNormalizer
{
    public static object? Normalize(object v, string? pgTypeName)
    {
        switch (v)
        {
            case DateOnly d:
                return d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            case DateTimeOffset dto:
                return dto.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
            case DateTime dt:
                if (string.Equals(pgTypeName, "date", StringComparison.OrdinalIgnoreCase))
                    return dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                var utc = dt.Kind switch
                {
                    DateTimeKind.Utc => dt,
                    DateTimeKind.Local => dt.ToUniversalTime(),
                    _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc), // timestamp tanpa zona: anggap UTC, jangan geser
                };
                return utc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
            default:
                return v;
        }
    }
}
