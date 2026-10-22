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

        var blob = await ReadBlobAsync(req.Body, limits.MaxBlobBytes, req.ContentLength, ct);
        if (blob is null || blob.Length == 0)
        {
            return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
        }

        return vault.Create(blob, ttl, oneTime) is { } id
            ? Results.Json(new { id })
            : Results.StatusCode(StatusCodes.Status507InsufficientStorage);
    }

    public static IResult Read(HttpContext ctx, string id, VaultService vault)
    {
        // Шифротекст не должен оседать в кэше браузера на диске.
        ctx.Response.Headers.CacheControl = "no-store";
        return vault.Take(id) is { } blob
            ? Results.Bytes(blob, "application/octet-stream")
            : Results.StatusCode(StatusCodes.Status404NotFound);
    }

    /// <summary>Факт доступности секрета: без блоба и без сжигания one-time.</summary>
    public static IResult Status(HttpContext ctx, string id, VaultService vault)
    {
        ctx.Response.Headers.CacheControl = "no-store";
        return vault.IsAvailable(id)
            ? Results.Json(new { available = true })
            : Results.StatusCode(StatusCodes.Status404NotFound);
    }


    /// <summary>
    /// Читает тело с прикладным лимитом. По Content-Length — одна копия блоба:
    /// точный массив без MemoryStream и ToArray. Без заголовка (chunked) — буферизующий
    /// путь как раньше; nginx всегда отправляет Content-Length.
    /// </summary>
    private static async Task<byte[]?> ReadBlobAsync(Stream body, long maxBytes, long? contentLength, CancellationToken ct)
    {
        if (contentLength is > 0 && contentLength <= maxBytes)
        {
            var blob = new byte[contentLength.Value];
            var total = 0;
            int read;
            while (total < blob.Length &&
                   (read = await body.ReadAsync(blob.AsMemory(total, blob.Length - total), ct)) > 0)
            {
                total += read;
            }
            // Тело короче заголовка — соединение оборвалось: неполный блоб не принимаем.
            return total < blob.Length ? null : blob;
        }

        using var ms = new MemoryStream(capacity: (int)Math.Min(contentLength ?? 0, maxBytes));
        var buffer = new byte[81920];
        long totalChunked = 0;
        int chunk;
        while ((chunk = await body.ReadAsync(buffer, ct)) > 0)
        {
            totalChunked += chunk;
            if (totalChunked > maxBytes)
                return null;
            ms.Write(buffer, 0, chunk);
        }

        return ms.ToArray();
    }
}