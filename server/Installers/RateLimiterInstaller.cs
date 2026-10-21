using System.Threading.RateLimiting;
using Momentum.Constants;

namespace Momentum.Installers;

public static class RateLimiterInstaller
{
    public static IHostApplicationBuilder AddMomentumRateLimiter(this IHostApplicationBuilder builder)
    {
        var limits = builder.Configuration.GetSection(RateLimiterLimits.Section).Get<RateLimiterLimits>() ?? new();

        builder.Services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

            o.AddPolicy(RateLimiterPolicies.Slow, ctx => Partition(IpKey(ctx), limits.SlowPermitLimit, limits.WindowMinutes));
            o.AddPolicy(RateLimiterPolicies.Normal, ctx => Partition(IpKey(ctx), limits.NormalPermitLimit, limits.WindowMinutes));
        });

        return builder;
    }

    private static RateLimitPartition<string> Partition(string key, int permitLimit, int windowMinutes)
    {
        return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permitLimit,
            Window = TimeSpan.FromMinutes(windowMinutes),
        });
    }

    private static string IpKey(HttpContext ctx) => ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
}