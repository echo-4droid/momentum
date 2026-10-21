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
                o.Limits.MaxConcurrentConnections = 8;
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