using Sementrack.Api.Security;

namespace Sementrack.Api.Data;

/// <summary>
/// Membuat tabel auth_local bila belum ada (idempotent) dan, HANYA jika belum ada satu pun akun,
/// membuat admin pertama dari konfigurasi (BOOTSTRAP_ADMIN_USER / BOOTSTRAP_ADMIN_PASSWORD).
/// Tidak ada password bawaan di kode. Database yang sudah dipakai versi Node tidak berubah.
/// </summary>
public static class SchemaBootstrap
{
    public static async Task RunAsync(Db db, IConfiguration cfg, ILogger log)
    {
        await db.ExecuteAsync("create schema if not exists auth_local");
        await db.ExecuteAsync(@"create table if not exists auth_local.users (
            username text primary key, password_hash text not null,
            role text not null check (role in ('admin','mo','sales','spv')),
            name text, dist_code text, wilayah text, email text, created_at timestamptz not null default now())");
        await db.ExecuteAsync(@"create table if not exists auth_local.sessions (
            token text primary key, username text, email text, role text not null, name text,
            dist_code text, wilayah text, expires_at bigint not null)");
        await db.ExecuteAsync("create index if not exists sessions_username_idx on auth_local.sessions (username)");
        await db.ExecuteAsync(@"create table if not exists auth_local.role_pages (
            role text not null check (role in ('mo','sales','spv')), page_id text not null,
            can_view_detail boolean not null default true, can_download boolean not null default true,
            primary key (role, page_id))");
        await db.ExecuteAsync(@"create table if not exists auth_local.activity_log (
            id bigserial primary key, username text not null, role text, name text,
            event_type text not null check (event_type in ('login','page_view','download')),
            page_id text, detail text, created_at timestamptz not null default now())");
        await db.ExecuteAsync("create index if not exists activity_log_created_idx on auth_local.activity_log (created_at desc)");

        var n = Convert.ToInt32((await db.QueryAsync("select count(*)::int c from auth_local.users"))[0]["c"]);
        if (n > 0) return;
        var user = cfg["BOOTSTRAP_ADMIN_USER"]; var pass = cfg["BOOTSTRAP_ADMIN_PASSWORD"];
        if (string.IsNullOrWhiteSpace(user) || string.IsNullOrEmpty(pass) || pass.Length < 12)
        {
            log.LogWarning("Belum ada akun. Isi BOOTSTRAP_ADMIN_USER dan BOOTSTRAP_ADMIN_PASSWORD (min 12 karakter) lalu restart untuk membuat admin pertama.");
            return;
        }
        await db.ExecuteAsync("insert into auth_local.users (username, password_hash, role, name) values ($1,$2,'admin','Administrator')",
            new object?[] { user.Trim().ToLowerInvariant(), PasswordHasher.Hash(pass) });
        log.LogWarning("Admin pertama dibuat. Hapus BOOTSTRAP_ADMIN_PASSWORD dari konfigurasi sekarang.");
    }
}
