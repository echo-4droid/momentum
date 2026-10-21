namespace Momentum.Installers;

public static class MomentumOptionsInstaller
{
    /// <summary>
    /// Привязывает <see cref="MomentumOptions"/> из конфигурации и досчитывает значения по умолчанию.
    /// </summary>
    public static IHostApplicationBuilder AddMomentumOptions(this IHostApplicationBuilder builder)
    {
        builder.Services.AddOptions<MomentumOptions>()
            .BindConfiguration(MomentumOptions.Section)
            .PostConfigure(o =>
            {
                if (string.IsNullOrWhiteSpace(o.DatabasePath))
                {
                    o.DatabasePath = Path.Combine("data", "momentum.db");
                }

                // Относительный путь — от каталога приложения, не от текущего каталога процесса.
                if (!Path.IsPathRooted(o.DatabasePath))
                {
                    o.DatabasePath = Path.Combine(builder.Environment.ContentRootPath, o.DatabasePath);
                }

                o.DatabasePath = Path.GetFullPath(o.DatabasePath);
            });

        return builder;
    }
}
