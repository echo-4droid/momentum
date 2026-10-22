using Momentum.Domain;

namespace Momentum.Infrastructure;

/// <summary>
/// Фоновая чистка просроченных сообщений раз в 60 секунд; ежечасно Checkpoint,
/// ежедневно Rebuild файла БД (возврат страниц удалённых записей).
/// </summary>
public sealed class CleanupService(VaultService vault, ILogger<CleanupService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(60));
        var tick = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                vault.DeleteExpired();
                if (++tick % 60 == 0)
                    vault.Maintain(rebuild: tick % 1440 == 0);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Expired secret cleanup failed");
            }

            try
            {
                if (!await timer.WaitForNextTickAsync(stoppingToken))
                    break;
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}