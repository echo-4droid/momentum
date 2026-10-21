namespace Momentum;

/// <summary>
/// Конфигурация приложения, секция "Momentum".
/// </summary>
public sealed record MomentumOptions
{
    public const string Section = "Momentum";

    /// <summary>Путь к файлу БД LiteDB</summary>
    public string DatabasePath { get; set; } = "";
}
