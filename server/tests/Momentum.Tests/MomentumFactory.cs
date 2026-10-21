using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Momentum.Tests;

/// <summary>Фабрика приложения с тестовой БД во временном файле (удаляется после тестов).</summary>
public class MomentumFactory : WebApplicationFactory<Program>
{
    public string DbPath { get; } = Path.Combine(
        Path.GetTempPath(), $"momentum-test-{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.UseSetting("Momentum:DatabasePath", DbPath);

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (!disposing)
            return;
        foreach (var path in new[] { DbPath, DbPath + "-wal", DbPath + "-shm" })
            try { File.Delete(path); }
            catch (IOException) { }
    }
}
