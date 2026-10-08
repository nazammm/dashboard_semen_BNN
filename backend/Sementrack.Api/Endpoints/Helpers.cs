using System.Text.Json;

namespace Sementrack.Api.Endpoints;

internal static class Helpers
{
    /// <summary>Baca body JSON sebagai objek (kosong kalau tidak ada / bukan objek).</summary>
    public static async Task<JsonElement> ReadBodyAsync(HttpRequest req)
    {
        try
        {
            if (req.ContentLength == 0) return default;
            var el = await req.ReadFromJsonAsync<JsonElement>();
            return el.ValueKind == JsonValueKind.Object ? el : default;
        }
        catch (JsonException) { return default; }
    }

    public static bool Has(this JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out _);

    public static JsonElement? Get(this JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var v) ? v : null;

    /// <summary>String dari properti JSON (angka/boolean diubah ke teks). null kalau tidak ada / null.</summary>
    public static string? GetString(this JsonElement body, string name)
    {
        var v = body.Get(name);
        if (v is null) return null;
        return ScalarToString(v.Value);
    }

    public static string? ScalarToString(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String => v.GetString(),
        JsonValueKind.Number => v.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        _ => v.GetRawText(),
    };

    public static IResult Json(object value, int status = 200) => Results.Json(value, statusCode: status);
    public static IResult Error(int status, string message) => Results.Json(new { error = message }, statusCode: status);
}
