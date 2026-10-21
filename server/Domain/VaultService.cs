using System.Security.Cryptography;
using Microsoft.Extensions.Options;
using Momentum.Infrastructure;

namespace Momentum.Domain;

/// <summary>
/// Правила работы с одноразовыми сообщениями: ограничения блоба и TTL.
/// </summary>
public sealed class VaultService(VaultStore store, IOptions<VaultOptions> options)
{
    private VaultOptions Options => options.Value;

    /// <summary>Доменное правило допустимого TTL.</summary>
    public bool IsValidTtl(int minutes) => minutes >= Options.MinTtlMinutes && minutes <= Options.MaxTtlMinutes;

    /// <summary>Сохраняет блоб и возвращает hex-id (32 символа, 128 бит CSPRNG); null — место в хранилище кончилось.</summary>
    public string? Create(byte[] blob, int ttlMinutes, bool oneTime)
    {
        var idHex = ToHex(RandomNumberGenerator.GetBytes(16));
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        return store.Insert(idHex, blob, now + (long)ttlMinutes * 60, oneTime, now)
            ? idHex
            : null;
    }

    /// <summary>
    /// Отдаёт блоб по hex-id из ссылки.
    /// </summary>
    public byte[]? Take(string idHex)
    {
        if (idHex.Length != 32 || !idHex.All(char.IsAsciiHexDigit)) return null;
        return store.Take(idHex.ToLowerInvariant(), DateTimeOffset.UtcNow.ToUnixTimeSeconds());
    }

    /// <summary>
    /// Доступен ли секрет: запись есть и срок не истёк. Блоб не выдаётся, one-time не сжигается.
    /// </summary>
    public bool IsAvailable(string idHex)
    {
        if (idHex.Length != 32 || !idHex.All(char.IsAsciiHexDigit)) return false;
        return store.Exists(idHex.ToLowerInvariant(), DateTimeOffset.UtcNow.ToUnixTimeSeconds());
    }

    public long DeleteExpired() => store.DeleteExpired(DateTimeOffset.UtcNow.ToUnixTimeSeconds());

    private static string ToHex(byte[] id) => Convert.ToHexString(id).ToLowerInvariant();
}