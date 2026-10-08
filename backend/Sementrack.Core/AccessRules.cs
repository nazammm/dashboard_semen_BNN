namespace Sementrack.Core;

/// <summary>
/// Aturan akses (halaman, tabel, fungsi) -- port 1:1 dari server.js (v9/v10).
/// Murni data + fungsi tanpa ketergantungan paket luar, supaya bisa diuji tanpa database.
/// </summary>
public static class AccessRules
{
    public static readonly string[] DashboardPages =
    {
        "beranda", "performa-daerah", "delivery", "rekap-harian", "tim-sales",
        "peta-toko", "daftar-toko", "transaksi-detail", "toko-detail",
    };

    public static readonly string[] AdminOnlyPages = { "interaksi-web", "kelola-akses" };

    public static readonly string[] AllRoles = { "admin", "mo", "sales", "spv" };

    /// <summary>Role yang datanya dibatasi server ke SATU distributor (dist_code di sesi).</summary>
    public static readonly string[] DistScopedRoles = { "spv", "sales" };

    public static readonly IReadOnlyDictionary<string, string[]> DefaultRolePages = new Dictionary<string, string[]>
    {
        ["mo"] = DashboardPages.ToArray(),
        ["sales"] = new[] { "tim-sales", "rekap-harian", "peta-toko", "daftar-toko", "toko-detail", "transaksi-detail" },
        ["spv"] = new[] { "rekap-harian", "tim-sales", "peta-toko", "daftar-toko", "toko-detail", "transaksi-detail" },
    };

    public sealed record PagePermission(bool CanViewDetail, bool CanDownload);

    private static readonly Dictionary<string, Dictionary<string, PagePermission>> DefaultPagePermissions = new()
    {
        ["spv"] = new()
        {
            ["rekap-harian"] = new(false, false),
        },
        ["sales"] = new()
        {
            ["rekap-harian"] = new(false, false),
            ["daftar-toko"] = new(true, false),
            ["peta-toko"] = new(false, true),
            ["transaksi-detail"] = new(true, false),
        },
    };

    public static PagePermission DefaultPermFor(string role, string pageId)
    {
        if (DefaultPagePermissions.TryGetValue(role, out var perPage) && perPage.TryGetValue(pageId, out var p))
            return p;
        return new PagePermission(true, true);
    }

    // ---- Tabel / view yang boleh dibaca lewat GET /{table} -------------------------------------
    public static readonly HashSet<string> AllowedTables = new()
    {
        "v_cement_targets_ext", "v_transaksi_monthly", "v_distributor_summary",
        "v_salesman_performance", "v_toko_agg", "v_yearly_totals", "v_monthly_totals",
        "v_dist_monthly_totals", "produk", "v_target_dist", "v_delivery_ext",
        "v_transaksi_detail", "v_toko_pegangan_sales", "status_sync", "toko",
    };

    /// <summary>Tabel di atas yang punya kolom dist_code -> filter distributor DIPAKSA server untuk spv/sales.</summary>
    public static readonly HashSet<string> TablesWithDistCode = new()
    {
        "v_salesman_performance", "v_toko_agg", "toko", "v_transaksi_detail",
        "v_toko_pegangan_sales", "v_dist_monthly_totals", "v_transaksi_monthly",
    };

    /// <summary>Nama tabel -> objek sebenarnya di database (toko boleh punya >1 distributor, schema sementrack).</summary>
    public static readonly IReadOnlyDictionary<string, string> ReadAlias = new Dictionary<string, string>
    {
        ["toko"] = "sementrack.v_toko_multi",
        ["v_toko_agg"] = "sementrack.v_toko_agg",
    };

    /// <summary>Fungsi yang versi barunya ada di schema sementrack.</summary>
    public static readonly IReadOnlyDictionary<string, string> RpcSchema = new Dictionary<string, string>
    {
        ["dashboard_toko_monthly_v2"] = "sementrack",
        ["dashboard_top_customers_v2"] = "sementrack",
    };

    // ---- Fungsi (RPC) yang boleh dipanggil + urutan nama argumennya -----------------------------
    public static readonly IReadOnlyDictionary<string, string[]> AllowedFunctions = new Dictionary<string, string[]>
    {
        ["dashboard_period_summary_v2"] = new[] { "p_dist_code", "p_year", "p_start_month", "p_end_month", "p_product_codes" },
        ["dashboard_top_customers_v2"] = new[] { "p_dist_code", "p_year", "p_start_month", "p_end_month", "p_product_codes", "p_limit" },
        ["dashboard_daily_matrix"] = new[] { "p_year", "p_month", "p_product_codes", "p_dist_code" },
        ["dashboard_delivery_type_breakdown"] = new[] { "p_dist_code", "p_year", "p_start_month", "p_end_month", "p_product_codes" },
        ["dashboard_channel_breakdown"] = new[] { "p_dist_code", "p_year", "p_start_month", "p_end_month", "p_product_codes" },
        ["dashboard_payment_breakdown"] = new[] { "p_dist_code", "p_year", "p_start_month", "p_end_month", "p_product_codes" },
        ["dashboard_toko_monthly_v2"] = new[] { "p_year", "p_month", "p_dist_code" },
        ["dashboard_store_year"] = new[] { "p_customer_code", "p_year" },
    };

    private sealed record PageDep(string[] Tables, string[] Functions);

    private static readonly Dictionary<string, PageDep> PageDependencies = new()
    {
        ["beranda"] = new(
            new[] { "v_distributor_summary", "produk", "v_target_dist", "v_toko_agg", "v_transaksi_monthly", "v_dist_monthly_totals" },
            new[] { "dashboard_period_summary_v2", "dashboard_top_customers_v2", "dashboard_delivery_type_breakdown", "dashboard_channel_breakdown", "dashboard_payment_breakdown" }),
        ["performa-daerah"] = new(new[] { "v_cement_targets_ext" }, Array.Empty<string>()),
        ["delivery"] = new(new[] { "v_delivery_ext" }, Array.Empty<string>()),
        ["rekap-harian"] = new(new[] { "v_distributor_summary", "v_monthly_totals", "produk", "v_target_dist" }, new[] { "dashboard_daily_matrix" }),
        ["tim-sales"] = new(new[] { "v_salesman_performance" }, Array.Empty<string>()),
        ["peta-toko"] = new(new[] { "v_monthly_totals" }, new[] { "dashboard_toko_monthly_v2" }),
        ["daftar-toko"] = new(new[] { "v_monthly_totals", "toko" }, new[] { "dashboard_toko_monthly_v2" }),
        ["transaksi-detail"] = new(new[] { "produk", "v_salesman_performance", "v_toko_pegangan_sales", "v_transaksi_detail" }, Array.Empty<string>()),
        ["toko-detail"] = new(new[] { "toko", "v_transaksi_detail" }, new[] { "dashboard_store_year" }),
    };

    private static readonly string[] AlwaysTables = { "status_sync" };

    public sealed record Access(HashSet<string> Tables, HashSet<string> Functions);

    /// <summary>Akses data sebuah role, dihitung dari daftar halaman yang diizinkan untuk role itu.</summary>
    public static Access ComputeAccess(string role, IReadOnlyCollection<string> pages)
    {
        if (role == "admin")
            return new Access(new HashSet<string>(AllowedTables), new HashSet<string>(AllowedFunctions.Keys));

        var tables = new HashSet<string>(AlwaysTables);
        var functions = new HashSet<string>();
        foreach (var p in pages)
        {
            if (!PageDependencies.TryGetValue(p, out var dep)) continue;
            foreach (var t in dep.Tables) tables.Add(t);
            foreach (var f in dep.Functions) functions.Add(f);
        }
        return new Access(tables, functions);
    }

    /// <summary>Halaman default sebuah role (dipakai kalau tabel role_pages kosong untuk role itu).</summary>
    public static string[] DefaultPagesFor(string role)
    {
        if (role == "admin") return DashboardPages.Concat(AdminOnlyPages).ToArray();
        return DefaultRolePages.TryGetValue(role, out var p) ? p.ToArray() : Array.Empty<string>();
    }

    /// <summary>Apakah p_dist_code harus DITIMPA dari sesi untuk fungsi ini (spv/sales). daily_matrix dikecualikan.</summary>
    public static bool MustForceDistScope(string role, string fn)
    {
        if (fn == "dashboard_daily_matrix") return false;
        if (!DistScopedRoles.Contains(role)) return false;
        return AllowedFunctions.TryGetValue(fn, out var args) && args.Contains("p_dist_code");
    }
}
