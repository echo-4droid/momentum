using LiteDB;

namespace Momentum.Infrastructure;

/// <summary>
/// Хранилище/
/// </summary>
public sealed class VaultStore : IDisposable
{
    private readonly LiteDatabase _db;

    public VaultStore(string dbPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(dbPath))!);
        _db = new LiteDatabase(dbPath);
        var vault = _db.GetCollection<VaultDoc>("vault");
        vault.EnsureIndex(x => x.IdHex, true);
        vault.EnsureIndex(x => x.ExpiresAt);
    }

    public void Insert(string idHex, byte[] blob, long expiresAt, bool oneTime, long createdAt) =>
        Vault.Insert(new VaultDoc
        {
            IdHex = idHex,
            Blob = blob,
            ExpiresAt = expiresAt,
            OneTime = oneTime,
            CreatedAt = createdAt,
        });

    /// <summary>
    /// Отдаёт блоб; для one_time удаляет запись в одной транзакции.
    /// </summary>
    public byte[]? Take(string idHex, long now)
    {
        _db.BeginTrans();
        try
        {
            var doc = Vault.FindOne(x => x.IdHex == idHex && x.ExpiresAt >= now);
            if (doc is not null && doc.OneTime)
                Vault.DeleteMany(x => x.IdHex == idHex);
            _db.Commit();
            return doc?.Blob;
        }
        catch
        {
            _db.Rollback();
            throw;
        }
    }

    public long DeleteExpired(long now) => Vault.DeleteMany(x => x.ExpiresAt < now);

    /// <summary>
    /// Проверяет доступность записи без выдачи блоба и без удаления (для статуса на странице чтения).
    /// </summary>
    public bool Exists(string idHex, long now) =>
        Vault.Exists(x => x.IdHex == idHex && x.ExpiresAt >= now);

    public void Dispose() => _db.Dispose();

    private ILiteCollection<VaultDoc> Vault => _db.GetCollection<VaultDoc>("vault");

    private sealed class VaultDoc
    {
        public string IdHex { get; set; } = "";
        public byte[] Blob { get; set; } = [];
        public long ExpiresAt { get; set; }
        public bool OneTime { get; set; }
        public long CreatedAt { get; set; }
    }
}