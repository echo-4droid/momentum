using System.Globalization;
using Microsoft.Extensions.Options;
using Momentum.Domain;

namespace Momentum.Api;

/// <summary>
/// Обработчики HTTP API одноразовых сообщений.
/// </summary>
public static class VaultEndpoints
{
    public static async Task<IResult> Create(HttpRequest req, VaultService vault, IOptions<VaultOptions> options, CancellationToken ct)
    {
        var limits = options.Value;

        var ttl = limits.DefaultTtlMinutes;
        if (req.Query.TryGetValue("ttl_minutes", out var rawTtl) &&
            (!int.TryParse(rawTtl.ToString(), CultureInfo.InvariantCulture, out ttl) ||
             !vault.IsValidTtl(ttl)))
        {
            return Results.StatusCode(StatusCodes.Status400BadRequest);
        }

        var oneTime = true;
        if (req.Query.TryGetValue("one_time", out var rawOneTime) &&
            !bool.TryParse(rawOneTime.ToString(), out oneTime))
        {
            return Results.StatusCode(StatusCodes.Status400BadRequest);
        }

        var blob = await ReadBlobAsync(req.Body, limits.MaxBlobBytes, ct);
        if (blob is null || blob.Length == 0)
        {
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        return Results.Json(new { id = vault.Create(blob, ttl, oneTime) });
    }

    public static IResult Read(string id, VaultService vault)
    {
        return vault.Take(id) is { } blob
            ? Results.Bytes(blob, "application/octet-stream")
            : Results.StatusCode(StatusCodes.Status404NotFound);
    }

    /// <summary>Факт доступности секрета: без блоба и без сжигания one-time.</summary>
    public static IResult Status(string id, VaultService vault)
    {
        return vault.IsAvailable(id)
            ? Results.Json(new { available = true })
            : Results.StatusCode(StatusCodes.Status404NotFound);
    }


    /// <summary>Читает тело с прикладным лимитом.</summary>
    private static async Task<byte[]?> ReadBlobAsync(Stream body, long maxBytes, CancellationToken ct)
    {
        using var ms = new MemoryStream();
        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = await body.ReadAsync(buffer, ct)) > 0)
        {
            total += read;
            if (total > maxBytes)
                return null;
            ms.Write(buffer, 0, read);
        }

        return ms.ToArray();
    }
}