namespace Momentum;

/// <summary>
/// Конфигурация рейтлимитера, секция "RateLimiter".
/// </summary>
public sealed record RateLimiterLimits
{
    public const string Section = "RateLimiter";
    public int NormalPermitLimit { get; set; } = 120;
    public int SlowPermitLimit { get; set; } = 30;
    public int WindowMinutes { get; set; } = 1;
}
