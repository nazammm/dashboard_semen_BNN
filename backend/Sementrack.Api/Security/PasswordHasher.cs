namespace Sementrack.Api.Security;

/// <summary>Pembungkus tipis BCrypt.Net-Next. Hash lama dari bcryptjs ($2a$/$2b$) kompatibel.</summary>
public static class PasswordHasher
{
    // Hash dummy (bukan rahasia): dibandingkan saat username tidak ada, supaya waktu respons sama.
    private const string DummyHash = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8n6/wQJj6ZkvXWGvcH4PmlLbUj3qQy";

    public static string Hash(string password) => global::BCrypt.Net.BCrypt.HashPassword(password, 10);

    public static bool Verify(string password, string? hash)
    {
        try { return global::BCrypt.Net.BCrypt.Verify(password, string.IsNullOrEmpty(hash) ? DummyHash : hash); }
        catch { return false; }
    }
}
