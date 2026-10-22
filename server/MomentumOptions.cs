namespace Momentum;

/// <summary>
/// Конфигурация приложения, секция "Momentum".
/// </summary>
public sealed record MomentumOptions
{
    public const string Section = "Momentum";

    /// <summary>Путь к файлу БД LiteDB</summary>
    public string DatabasePath { get; set; } = "";

    /// <summary>
    /// Пароль шифрования файла БД LiteDB; пусто — файл не шифруется.
    /// Применяется к новой (пустой) БД; существующую незашифрованную БД переносить заранее.
    /// Задаётся через окружение: Momentum__DatabasePassword.
    /// </summary>
    public string DatabasePassword { get; set; } = "";
}
