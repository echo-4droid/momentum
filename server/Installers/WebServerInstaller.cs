using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.Extensions.Options;

namespace Momentum.Installers;

public static class WebServerInstaller
{
    public static IHostApplicationBuilder AddMomentumWebServer(this IHostApplicationBuilder builder)
    {
        builder.Services.AddOptions<KestrelServerOptions>()
            .Configure<IOptions<VaultOptions>>((o, vault) =>
            {
                o.Configure(builder.Configuration.GetSection("Kestrel"));
                o.Limits.MaxRequestBodySize = vault.Value.MaxBlobBytes + 1024 * 1024;
                // Раньше 8 — легко выбиралось параллельными запросами, nginx отвечал 502.
                // 16 держится по памяти потому, что POST хранит одну копию блоба:
                // худший случай ~2 × 8 МиБ × 16 ≈ 256 МиБ на профиле 512 МиБ.
                o.Limits.MaxConcurrentConnections = 16;
            });

        builder.Services.Configure<ForwardedHeadersOptions>(o => { o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedPrefix; });

        return builder;
    }

    public static IApplicationBuilder UseMomentumExceptionHandler(this IApplicationBuilder app)
    {
        return app.UseExceptionHandler(eh => eh.Run(ctx =>
        {
            ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
            return Task.CompletedTask;
        }));
    }
}