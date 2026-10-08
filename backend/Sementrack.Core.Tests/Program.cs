using System.Text.Json;
using Sementrack.Core;

int failed = 0, passed = 0;
void Check(bool ok, string name, string? detail = null)
{
    if (ok) { passed++; return; }
    failed++;
    Console.WriteLine($"GAGAL: {name} {detail}");
}

// ---- 1. Tes diferensial parser vs implementasi Node (server.js) ---------------------------
if (args.Length >= 2)
{
    var cases = JsonSerializer.Deserialize<List<List<List<string>>>>(File.ReadAllText(args[0]))!;
    var nodeOut = JsonDocument.Parse(File.ReadAllText(args[1])).RootElement;
    for (int i = 0; i < cases.Count; i++)
    {
        var q = cases[i].Select(p => new KeyValuePair<string, string>(p[0], p[1]));
        var exp = nodeOut[i];
        try
        {
            var r = QueryParser.Parse(q);
            if (exp.TryGetProperty("error", out _)) { Check(false, $"kasus {i}: Node error, C# tidak"); continue; }
            Check(exp.GetProperty("where").EnumerateArray().Select(x => x.GetString()).SequenceEqual(r.Where), $"kasus {i} where",
                  $"node={exp.GetProperty("where")} cs={string.Join("|", r.Where)}");
            Check(exp.GetProperty("params").EnumerateArray().Select(x => x.GetString()).SequenceEqual(r.Params), $"kasus {i} params");
            Check(exp.GetProperty("order").GetString() == r.Order, $"kasus {i} order", $"node={exp.GetProperty("order")} cs={r.Order}");
            int? lim = exp.GetProperty("limit").ValueKind == JsonValueKind.Null ? null : exp.GetProperty("limit").GetInt32();
            int? off = exp.GetProperty("offset").ValueKind == JsonValueKind.Null ? null : exp.GetProperty("offset").GetInt32();
            Check(lim == r.Limit, $"kasus {i} limit"); Check(off == r.Offset, $"kasus {i} offset");
        }
        catch (ArgumentException e)
        {
            Check(exp.TryGetProperty("error", out var err) && err.GetString() == e.Message, $"kasus {i} error");
        }
    }
}

// order dengan kolom tak valid harus melempar error
try { QueryParser.Parse(new[] { new KeyValuePair<string, string>("order", "a;drop.desc") }); Check(false, "order injeksi harus error"); }
catch (ArgumentException) { Check(true, "order injeksi"); }

// ---- 2. Aturan akses ------------------------------------------------------------------------
var adminAccess = AccessRules.ComputeAccess("admin", AccessRules.DefaultPagesFor("admin"));
Check(adminAccess.Tables.SetEquals(AccessRules.AllowedTables), "admin boleh semua tabel");
Check(adminAccess.Functions.Count == AccessRules.AllowedFunctions.Count, "admin boleh semua fungsi");

var sales = AccessRules.ComputeAccess("sales", AccessRules.DefaultPagesFor("sales"));
Check(sales.Tables.Contains("status_sync"), "sales: status_sync selalu boleh");
Check(sales.Tables.Contains("toko") && sales.Tables.Contains("v_transaksi_detail"), "sales: toko & transaksi detail");
Check(!sales.Tables.Contains("v_cement_targets_ext"), "sales: TIDAK boleh target semen");
Check(!sales.Functions.Contains("dashboard_period_summary_v2"), "sales: TIDAK boleh period_summary");
Check(sales.Functions.Contains("dashboard_toko_monthly_v2") && sales.Functions.Contains("dashboard_store_year"), "sales: fungsi toko");

Check(AccessRules.MustForceDistScope("spv", "dashboard_toko_monthly_v2"), "spv: dist dipaksa utk toko_monthly");
Check(!AccessRules.MustForceDistScope("spv", "dashboard_daily_matrix"), "spv: daily_matrix dikecualikan");
Check(!AccessRules.MustForceDistScope("spv", "dashboard_store_year"), "store_year tidak punya p_dist_code");
Check(!AccessRules.MustForceDistScope("mo", "dashboard_toko_monthly_v2"), "mo: tidak dipaksa");

Check(AccessRules.DefaultPermFor("sales", "daftar-toko") is { CanViewDetail: true, CanDownload: false }, "perm sales daftar-toko");
Check(AccessRules.DefaultPermFor("spv", "rekap-harian") is { CanViewDetail: false, CanDownload: false }, "perm spv rekap");
Check(AccessRules.DefaultPermFor("mo", "beranda") is { CanViewDetail: true, CanDownload: true }, "perm default");

// ---- 3. Pembatas login ---------------------------------------------------------------------
long now = 1_000_000;
var th = new LoginThrottle(() => now);
for (int i = 0; i < 4; i++) th.RecordFailure("u");
Check(th.RemainingMs("u") == 0, "4x gagal belum terkunci");
th.RecordFailure("u");
Check(th.RemainingMs("u") == 30_000, "5x gagal -> 30 dtk");
now += 31_000;
Check(th.RemainingMs("u") == 0, "kunci habis setelah 30 dtk");
for (int i = 0; i < 5; i++) th.RecordFailure("u");
Check(th.RemainingMs("u") == 120_000, "10x gagal -> 2 menit");
th.RecordSuccess("u");
Check(th.RemainingMs("u") == 0, "sukses mereset");

Console.WriteLine($"Lulus: {passed}, Gagal: {failed}");
return failed == 0 ? 0 : 1;
