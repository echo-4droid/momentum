using Momentum.Infrastructure;
using Xunit;

namespace Momentum.Tests;

/// <summary>Прямые тесты VaultStore: учёт квоты при чистке, шифрование файла БД.</summary>
public sealed class VaultStoreTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"momentum-store-{Guid.NewGuid():N}.db");
    private readonly VaultOptions _limits = new() { MaxTotalBytes = 1024, DiskReserveBytes = 0 };

    public void Dispose()
    {
        foreach (var suffix in new[] { "", "-log", "-wal", "-shm" })
            try { File.Delete(_path + suffix); }
            catch (IOException) { }
    }

    [Fact]
    public void DeleteExpired_FreesQuota_ForNewInserts()
    {
        using var store = new VaultStore(_path, "", _limits);
        var now = 1000L;

        Assert.True(store.Insert("a", new byte[600], now - 1, oneTime: false, createdAt: now));
        Assert.True(store.Insert("b", new byte[300], now + 100, oneTime: false, createdAt: now));
        // Квота 1024: занято 900, третий блоб не помещается.
        Assert.False(store.Insert("c", new byte[600], now + 100, oneTime: false, createdAt: now));

        Assert.Equal(1, store.DeleteExpired(now));
        Assert.Equal(0, store.DeleteExpired(now));

        // Чистка освободила место — вставка снова проходит.
        Assert.True(store.Insert("c", new byte[600], now + 100, oneTime: false, createdAt: now));
    }

    [Fact]
    public void Password_EncryptsFile_AndReopens()
    {
        using (var store = new VaultStore(_path, "pass", _limits))
            Assert.True(store.Insert("a", new byte[16], long.MaxValue, oneTime: false, createdAt: 0));

        // Зашифрованная БД без пароля не открывается.
        Assert.ThrowsAny<Exception>(() => new VaultStore(_path, "", _limits));

        using (var reopened = new VaultStore(_path, "pass", _limits))
            Assert.NotNull(reopened.Take("a", 0));
    }

    [Fact]
    public void Maintain_Rebuild_KeepsPassword_Data_AndCleansBackups()
    {
        using var store = new VaultStore(_path, "pass", _limits);
        Assert.True(store.Insert("a", new byte[16], long.MaxValue, oneTime: false, createdAt: 0));

        // Повторные циклы: шифрование переживает Rebuild (LiteDB #2449 — пароль передаётся явно),
        // резервные копии (*-backup*.db) не накапливаются.
        store.Maintain(rebuild: true);
        store.Maintain(rebuild: true);

        Assert.Empty(Directory.GetFiles(
            Path.GetDirectoryName(_path)!, Path.GetFileNameWithoutExtension(_path) + "*backup*"));

        using (var reopened = new VaultStore(_path, "pass", _limits))
            Assert.Equal(new byte[16], reopened.Take("a", 0));

        Assert.ThrowsAny<Exception>(() => new VaultStore(_path, "", _limits));
    }

    [Fact]
    public void Password_WithSpacesAndQuotes_SurvivesRebuild()
    {
        const string pass = "  pass \"';-- x  ";
        using var store = new VaultStore(_path, pass, _limits);
        Assert.True(store.Insert("a", new byte[16], long.MaxValue, oneTime: false, createdAt: 0));

        // Рабочий экземпляр жив после Rebuild: открытие и обслуживание получают один и тот же пароль.
        store.Maintain(rebuild: true);
        Assert.Equal(new byte[16], store.Take("a", 0));

        using var reopened = new VaultStore(_path, pass, _limits);
        Assert.Equal(new byte[16], reopened.Take("a", 0));
    }

    [Fact]
    public void Maintain_CleansOnlyOwnRebuildBackups()
    {
        var dir = Path.GetDirectoryName(_path)!;
        var baseName = Path.GetFileNameWithoutExtension(_path);
        var decoys = new[]
        {
            Path.Combine(dir, baseName + "-backup-settings.json"),
            Path.Combine(dir, baseName + "2-backup.db"),
            Path.Combine(dir, baseName + "-backup-1-notes.txt"),
        };
        foreach (var decoy in decoys)
            File.WriteAllText(decoy, "x");
        // Номера без ограничения: LiteDB нумерует копии, пока существуют предыдущие.
        var numbered = new[]
        {
            Path.Combine(dir, baseName + "-backup.db"),
            Path.Combine(dir, baseName + "-backup-1.db"),
            Path.Combine(dir, baseName + "-backup-100.db"),
            Path.Combine(dir, baseName + "-backup-4321.db"),
        };
        foreach (var leftover in numbered)
            File.WriteAllText(leftover, "x");

        using var store = new VaultStore(_path, "", _limits);
        Assert.True(store.Insert("a", new byte[16], long.MaxValue, oneTime: false, createdAt: 0));
        store.Maintain(rebuild: true);

        Assert.All(decoys, d => Assert.True(File.Exists(d), d));
        Assert.All(numbered, d => Assert.False(File.Exists(d), d));
        Assert.Empty(Directory.GetFiles(dir, baseName + "-backup*.db"));
    }
}
