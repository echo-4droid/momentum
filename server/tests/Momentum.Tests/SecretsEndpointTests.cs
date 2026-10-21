using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Momentum.Tests;

internal sealed record IdResponse(string Id);

public class SecretsEndpointTests : IClassFixture<MomentumFactory>
{
    private readonly MomentumFactory _factory;

    public SecretsEndpointTests(MomentumFactory factory) => _factory = factory;

    [Fact]
    public async Task OneTimeSecret_CreateGetThenSecondGet()
    {
        var client = _factory.CreateClient();
        var payload = RandomNumberGenerator.GetBytes(1024);

        using var post = await client.PostAsync(
            "/api/v1/secrets?ttl_minutes=60&one_time=true", new ByteArrayContent(payload));
        Assert.Equal(HttpStatusCode.OK, post.StatusCode);

        var id = JsonSerializer.Deserialize<IdResponse>(
            await post.Content.ReadAsStringAsync(), JsonSerializerOptions.Web)!.Id;
        Assert.Matches("^[0-9a-f]{32}$", id);

        using var get1 = await client.GetAsync($"/api/v1/secrets/{id}");
        Assert.Equal(HttpStatusCode.OK, get1.StatusCode);
        Assert.Equal("application/octet-stream", get1.Content.Headers.ContentType?.MediaType);
        var received = await get1.Content.ReadAsByteArrayAsync();
        Assert.Equal(payload, received);

        using var get2 = await client.GetAsync($"/api/v1/secrets/{id}");
        Assert.Equal(HttpStatusCode.NotFound, get2.StatusCode);
    }

    [Fact]
    public async Task OversizedBlob_Returns413()
    {
        var client = _factory.CreateClient();
        var payload = new byte[8 * 1024 * 1024 + 1];

        using var post = await client.PostAsync("/api/v1/secrets", new ByteArrayContent(payload));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, post.StatusCode);
    }

    [Fact]
    public async Task InvalidId_Returns404()
    {
        var client = _factory.CreateClient();

        using var get = await client.GetAsync("/api/v1/secrets/not-a-hex-id");

        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    [Fact]
    public async Task Status_DoesNotBurnOneTimeAndReflectsAvailability()
    {
        var client = _factory.CreateClient();
        var payload = RandomNumberGenerator.GetBytes(128);

        using var post = await client.PostAsync(
            "/api/v1/secrets?ttl_minutes=60&one_time=true", new ByteArrayContent(payload));
        var id = JsonSerializer.Deserialize<IdResponse>(
            await post.Content.ReadAsStringAsync(), JsonSerializerOptions.Web)!.Id;

        // Статус доступен, повторяется и не сжигает one-time.
        using var status1 = await client.GetAsync($"/api/v1/secrets/{id}/status");
        Assert.Equal(HttpStatusCode.OK, status1.StatusCode);
        Assert.Contains("true", await status1.Content.ReadAsStringAsync());
        using var status2 = await client.GetAsync($"/api/v1/secrets/{id}/status");
        Assert.Equal(HttpStatusCode.OK, status2.StatusCode);

        // Блоб на месте, статус-запросы не выдали его содержимое.
        using var get = await client.GetAsync($"/api/v1/secrets/{id}");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        Assert.Equal(payload, await get.Content.ReadAsByteArrayAsync());

        // После сжигания статус — 404.
        using var status3 = await client.GetAsync($"/api/v1/secrets/{id}/status");
        Assert.Equal(HttpStatusCode.NotFound, status3.StatusCode);
    }

    [Fact]
    public async Task Status_InvalidId_Returns404()
    {
        var client = _factory.CreateClient();

        using var status = await client.GetAsync("/api/v1/secrets/not-a-hex-id/status");

        Assert.Equal(HttpStatusCode.NotFound, status.StatusCode);
    }

    [Fact]
    public async Task TooShortTtl_Returns400()
    {
        var client = _factory.CreateClient();

        using var post = await client.PostAsync(
            "/api/v1/secrets?ttl_minutes=30", new ByteArrayContent([1, 2, 3]));

        Assert.Equal(HttpStatusCode.BadRequest, post.StatusCode);
    }

    [Fact]
    public async Task EmptyBody_Returns413()
    {
        var client = _factory.CreateClient();

        using var post = await client.PostAsync("/api/v1/secrets", new ByteArrayContent([]));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, post.StatusCode);
    }
}

/// <summary>Отдельный класс (отдельный экземпляр приложения), чтобы лимит 30/мин не мешал другим тестам.</summary>
public class RateLimitTests : IClassFixture<MomentumFactory>
{
    private readonly MomentumFactory _factory;

    public RateLimitTests(MomentumFactory factory) => _factory = factory;

    [Fact]
    public async Task PostBeyondLimit_Returns429()
    {
        var client = _factory.CreateClient();

        HttpStatusCode last = 0;
        for (var i = 0; i < 31; i++)
        {
            using var post = await client.PostAsync(
                "/api/v1/secrets", new ByteArrayContent([1, 2, 3]));
            last = post.StatusCode;
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, last);
    }
}

/// <summary>Фабрика с тесной квотой хранилища (2048 байт) для тестов переполнения.</summary>
public sealed class QuotaFactory : MomentumFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Vault:MaxTotalBytes", "2048");
    }
}

public class OneTimeRaceTests : IClassFixture<MomentumFactory>
{
    private readonly MomentumFactory _factory;

    public OneTimeRaceTests(MomentumFactory factory) => _factory = factory;

    [Fact]
    public async Task ParallelGets_ExactlyOneBlob()
    {
        var client = _factory.CreateClient();
        var payload = RandomNumberGenerator.GetBytes(256);

        using var post = await client.PostAsync(
            "/api/v1/secrets?ttl_minutes=60&one_time=true", new ByteArrayContent(payload));
        var id = JsonSerializer.Deserialize<IdResponse>(
            await post.Content.ReadAsStringAsync(), JsonSerializerOptions.Web)!.Id;

        // 16 одновременных чтений one-time секрета: ровно один получает блоб.
        var responses = await Task.WhenAll(
            Enumerable.Range(0, 16).Select(_ => client.GetAsync($"/api/v1/secrets/{id}")));

        var oks = responses.Where(r => r.StatusCode == HttpStatusCode.OK).ToList();
        Assert.Single(oks);
        Assert.Equal(payload, await oks[0].Content.ReadAsByteArrayAsync());
        Assert.All(responses.Where(r => r != oks[0]), r => Assert.Equal(HttpStatusCode.NotFound, r.StatusCode));
    }
}

public class QuotaTests : IClassFixture<QuotaFactory>
{
    private readonly QuotaFactory _factory;

    public QuotaTests(QuotaFactory factory) => _factory = factory;

    private static async Task<string> PostAsync(HttpClient client, byte[] payload)
    {
        using var post = await client.PostAsync(
            "/api/v1/secrets?ttl_minutes=60&one_time=true", new ByteArrayContent(payload));
        Assert.Equal(HttpStatusCode.OK, post.StatusCode);
        return JsonSerializer.Deserialize<IdResponse>(
            await post.Content.ReadAsStringAsync(), JsonSerializerOptions.Web)!.Id;
    }

    [Fact]
    public async Task QuotaExceeded_Returns507_AndFreesOnBurn()
    {
        var client = _factory.CreateClient();

        // Квота 2048: два блоба по 1024 помещаются, третий — нет.
        await PostAsync(client, new byte[1024]);
        var id = await PostAsync(client, new byte[1024]);
        using var rejected = await client.PostAsync(
            "/api/v1/secrets", new ByteArrayContent(new byte[1024]));
        Assert.Equal(HttpStatusCode.InsufficientStorage, rejected.StatusCode);

        // Сжигание one-time освобождает место — вставка снова проходит.
        using var get = await client.GetAsync($"/api/v1/secrets/{id}");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        await PostAsync(client, new byte[1024]);
    }
}
