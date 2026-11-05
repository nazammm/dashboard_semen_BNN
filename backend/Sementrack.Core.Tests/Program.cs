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

// Overview rentang tanggal
var mo = AccessRules.ComputeAccess("mo", AccessRules.DefaultPagesFor("mo"));
Check(mo.Functions.Contains("dashboard_period_summary_range") && mo.Functions.Contains("dashboard_product_breakdown_range"), "mo: fungsi range overview");
Check(!sales.Functions.Contains("dashboard_top_customers_range"), "sales: TIDAK boleh fungsi range overview");
Check(AccessRules.MustForceDistScope("spv", "dashboard_period_summary_range"), "spv: dist dipaksa utk fungsi range");
Check(AccessRules.AllowedFunctions["dashboard_top_customers_range"].SequenceEqual(new[] { "p_dist_code", "p_start_date", "p_end_date", "p_product_codes", "p_limit" }), "argumen top_customers_range");
Check(AccessRules.RpcSchema["dashboard_period_summary_range"] == "sementrack", "fungsi range di schema sementrack");

// Sell In BNN
Check(mo.Tables.Contains("v_sellin_bnn_daily") && mo.Tables.Contains("v_sellin_bnn_info") && mo.Tables.Contains("v_delivery_ext"), "mo: data sell in BNN + target bulanan");
Check(!sales.Tables.Contains("v_sellin_bnn_daily"), "sales: TIDAK boleh sell in BNN");
Check(AccessRules.DefaultPagesFor("admin").Contains("kelola-data") && !AccessRules.DefaultPagesFor("mo").Contains("kelola-data"), "kelola data khusus admin");
Check(sales.Tables.Contains("v_data_status") && mo.Tables.Contains("v_data_status"), "status data boleh untuk semua role");
Check(AccessRules.ReadAlias["v_sellin_bnn_daily"] == "sementrack.v_sellin_bnn_daily", "view sell in di schema sementrack");

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

// ---- Regresi: kolom DATE tidak boleh bergeser karena zona waktu server (bug Rekap Harian) ----
var dateVal = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Unspecified); // bentuk yang dikembalikan Npgsql untuk `date`
Check((string?)ValueNormalizer.Normalize(dateVal, "date") == "2026-10-01", "date Unspecified -> 2026-10-01 (tanpa geser zona)");
Check((string?)ValueNormalizer.Normalize(new DateOnly(2026, 10, 1), "date") == "2026-10-01", "DateOnly -> yyyy-MM-dd");
Check((string?)ValueNormalizer.Normalize(new DateTimeOffset(2026, 10, 1, 7, 0, 0, TimeSpan.FromHours(7)), "timestamptz") == "2026-10-01T00:00:00.000Z", "timestamptz -> UTC ISO");
Check((string?)ValueNormalizer.Normalize(new DateTime(2026, 10, 1, 10, 30, 0, DateTimeKind.Utc), "timestamptz") == "2026-10-01T10:30:00.000Z", "DateTime Utc -> ISO");
Check((string?)ValueNormalizer.Normalize(new DateTime(2026, 10, 1, 10, 30, 0, DateTimeKind.Unspecified), "timestamp") == "2026-10-01T10:30:00.000Z", "timestamp tanpa zona tidak digeser");
Check(ValueNormalizer.Normalize(123L, "int8") is long, "angka tidak diubah");
// Awal hari lokal -> UTC harus ber-offset 0 (Npgsql menolak offset != 0)
Check(new DateTimeOffset(DateTime.Today).ToUniversalTime().Offset == TimeSpan.Zero, "batas awal hari dikirim sebagai UTC");

// ---- Regresi keamanan (audit) --------------------------------------------------------------
// Nama kolom dengan newline di belakang tidak boleh lolos validasi ($ di .NET menerima "\n" akhir).
var nl = QueryParser.Parse(new[] { new KeyValuePair<string, string>("dist_code\n", "eq.X") });
Check(nl.Where.Count == 0, "kolom 'dist_code\\n' harus diabaikan");
try { QueryParser.Parse(new[] { new KeyValuePair<string, string>("order", "cust_code\n.desc") }); Check(false, "order dengan newline harus error"); }
catch (ArgumentException) { Check(true, "order newline"); }
Check(AccessRules.KnownPageIds.Contains("tim-sales") && !AccessRules.KnownPageIds.Contains("<script>"), "daftar id halaman dikenal");
// Pembatas: kunci per akun+IP terpisah; catatan kedaluwarsa; pembatas IP lebih longgar
long t2 = 5_000_000;
var th2 = new LoginThrottle(() => t2);
for (int i = 0; i < 5; i++) th2.RecordFailure("admin|1.1.1.1");
Check(th2.RemainingMs("admin|1.1.1.1") > 0, "IP penyerang terkunci");
Check(th2.RemainingMs("admin|2.2.2.2") == 0, "admin dari IP lain TIDAK ikut terkunci");
t2 += 61 * 60 * 1000;
th2.RecordFailure("admin|1.1.1.1");
Check(th2.RemainingMs("admin|1.1.1.1") == 0, "catatan gagal >1 jam dianggap kedaluwarsa");
var ipT = new IpLoginThrottle().Inner;
for (int i = 0; i < 39; i++) ipT.RecordFailure("9.9.9.9");
Check(ipT.RemainingMs("9.9.9.9") == 0, "IP: 39 gagal belum terkunci (kantor dengan 1 IP aman)");
ipT.RecordFailure("9.9.9.9");
Check(ipT.RemainingMs("9.9.9.9") > 0, "IP: 40 gagal terkunci");
var flood = new LoginThrottle();
for (int i = 0; i < 60000; i++) flood.RecordFailure("u" + i);
Check(flood.RemainingMs("u59999") >= 0, "banjir nama acak tidak membuat crash / memori tak terbatas");

// Tabel target salesman: hanya admin & Management (mo), walau halaman tim-sales terbuka untuk spv/sales
Check(AccessRules.ComputeAccess("mo", AccessRules.DefaultPagesFor("mo")).Tables.Contains("distributor_target_salesman"), "mo boleh target salesman");
Check(AccessRules.ComputeAccess("admin", AccessRules.DefaultPagesFor("admin")).Tables.Contains("distributor_target_salesman"), "admin boleh target salesman");
Check(!AccessRules.ComputeAccess("spv", AccessRules.DefaultPagesFor("spv")).Tables.Contains("distributor_target_salesman"), "spv TIDAK boleh target salesman");
Check(!AccessRules.ComputeAccess("sales", new[] { "tim-sales" }).Tables.Contains("distributor_target_salesman"), "sales TIDAK boleh target salesman");

Console.WriteLine($"Lulus: {passed}, Gagal: {failed}");
return failed == 0 ? 0 : 1;
