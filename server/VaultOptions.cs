namespace Momentum;

/// <summary>
/// Правила одноразовых сообщений, секция "Vault" (appsettings.json).
/// Значения по умолчанию — прод-контракт (см. idea.md и docs/features).
/// </summary>
public sealed record VaultOptions
{
    public const string Section = "Vault";

    /// <summary>Максимальный размер шифроблоба, байт (8 МиБ включительно).</summary>
    public int MaxBlobBytes { get; set; } = 8 * 1024 * 1024;

    /// <summary>Минимальный TTL, минут (1 час).</summary>
    public int MinTtlMinutes { get; set; } = 60;

    /// <summary>Максимальный TTL, минут (7 дней).</summary>
    public int MaxTtlMinutes { get; set; } = 10080;

    /// <summary>TTL по умолчанию, минут (24 часа).</summary>
    public int DefaultTtlMinutes { get; set; } = 1440;
}
