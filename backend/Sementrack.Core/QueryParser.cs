using System.Text.RegularExpressions;

namespace Sementrack.Core;

/// <summary>Hasil parsing query-string bergaya PostgREST. Semua parameter bertipe teks (server database yang menentukan tipenya).</summary>
public sealed class ParsedQuery
{
    public List<string> Where { get; } = new();
    public List<string?> Params { get; } = new();
    public string Order { get; set; } = "";
    public int? Limit { get; set; }
    public int? Offset { get; set; }

    /// <summary>Tambah satu parameter, kembalikan placeholder posisinya ("$1", "$2", ...).</summary>
    public string AddParam(string? value)
    {
        Params.Add(value);
        return "$" + Params.Count;
    }
}

/// <summary>
/// Port dari parseQuery() di server.js: eq./gte./lte./gt./lt./in., order=, limit, offset.
/// Satu kolom boleh muncul dua kali dengan operator berbeda (mis. do_date=gte.X&amp;do_date=lt.Y).
/// </summary>
public static partial class QueryParser
{
    [GeneratedRegex("^[a-zA-Z0-9_]+$")]
    private static partial Regex IdentRegex();

    [GeneratedRegex("^(eq|gte|lte|gt|lt|in)\\.(.*)$", RegexOptions.Singleline)]
    private static partial Regex OpRegex();

    public static ParsedQuery Parse(IEnumerable<KeyValuePair<string, string>> query)
    {
        var result = new ParsedQuery();
        var list = query.ToList();

        // Urutan kunci mengikuti kemunculan pertama (sama seperti Object.entries di Node).
        var keys = new List<string>();
        foreach (var kv in list) if (!keys.Contains(kv.Key)) keys.Add(kv.Key);

        foreach (var key in keys)
        {
            var values = list.Where(kv => kv.Key == key).Select(kv => kv.Value).ToList();

            if (key == "select") continue;

            if (key == "order")
            {
                var orderVal = values[^1];
                var parts = orderVal.Split(',').Select(part =>
                {
                    var bits = part.Split('.');
                    var col = bits[0];
                    var dir = bits.Length > 1 ? bits[1] : "";
                    if (!IdentRegex().IsMatch(col)) throw new ArgumentException("invalid order column");
                    return $"\"{col}\" {(dir == "desc" ? "DESC" : "ASC")}";
                });
                result.Order = string.Join(", ", parts);
                continue;
            }

            if (key == "limit")
            {
                if (int.TryParse(values[0], out var l)) result.Limit = l;
                continue;
            }
            if (key == "offset")
            {
                if (int.TryParse(values[0], out var o)) result.Offset = o;
                continue;
            }

            if (!IdentRegex().IsMatch(key)) continue; // nama kolom aneh -> abaikan demi keamanan

            foreach (var v in values)
            {
                var m = OpRegex().Match(v);
                if (!m.Success) continue;
                var op = m.Groups[1].Value;
                var val = m.Groups[2].Value;

                if (op == "in")
                {
                    var trimmed = val;
                    if (trimmed.StartsWith('(')) trimmed = trimmed[1..];
                    if (trimmed.EndsWith(')')) trimmed = trimmed[..^1];
                    var vals = trimmed.Split(',').Where(s => s.Length > 0).ToList();
                    if (vals.Count == 0) { result.Where.Add("1=0"); continue; }
                    var placeholders = vals.Select(pv => result.AddParam(pv));
                    result.Where.Add($"\"{key}\" IN ({string.Join(",", placeholders)})");
                }
                else
                {
                    var sqlOp = op switch { "eq" => "=", "gte" => ">=", "lte" => "<=", "gt" => ">", _ => "<" };
                    result.Where.Add($"\"{key}\" {sqlOp} {result.AddParam(val)}");
                }
            }
        }
        return result;
    }
}
