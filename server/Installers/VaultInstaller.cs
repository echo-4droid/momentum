using Microsoft.Extensions.Options;
using Momentum.Domain;
using Momentum.Infrastructure;

namespace Momentum.Installers;

public static class VaultInstaller
{
    /// <summary>
    /// Регистрирует хранилище одноразовых сообщений и правила их жизненного цикла.
    /// </summary>
    public static IHostApplicationBuilder AddVault(this IHostApplicationBuilder builder)
    {
        builder.Services.Configure<VaultOptions>(builder.Configuration.GetSection(VaultOptions.Section));
        builder.Services.AddSingleton<VaultStore>(sp => new VaultStore(
            sp.GetRequiredService<IOptions<MomentumOptions>>().Value.DatabasePath,
            sp.GetRequiredService<IOptions<MomentumOptions>>().Value.DatabasePassword,
            sp.GetRequiredService<IOptions<VaultOptions>>().Value));
        builder.Services.AddSingleton<VaultService>();
        builder.Services.AddHostedService<CleanupService>();

        return builder;
    }
}