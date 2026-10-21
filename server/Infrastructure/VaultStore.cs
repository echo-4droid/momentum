using LiteDB;

namespace Momentum.Infrastructure;

/// <summary>
/// Хранилище/
/// </summary>
public sealed class VaultStore : IDisposable
{
    private readonly LiteDatabase _db;
    private readonly string _dbPath;
    private readonly VaultOptions _limits;

    /// <summary>
    /// Сериализует все операции, меняющие записи или счётчик: транзакции LiteDB
    /// не изолируют параллельные read-check-write (общий read-lock до write-lock),
    /// из-за чего квота обходилась параллельными вставками.
    /// </summary>
    private readonly object _sync = new();

    public VaultStore(string dbPath, VaultOptions limits)
    {
        _dbPath = Path.GetFullPath(dbPath);
        _limits = limits;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(dbPath))!);
        _db = new LiteDatabase(dbPath);
        var vault = _db.GetCollection<VaultDoc>("vault");
        vault.EnsureIndex(x => x.IdHex, true);
        vault.EnsureIndex(x => x.ExpiresAt);
        MigrateBlobLengthAndRecount();
    }

    /// <summary>
    /// Одноразово при старте: записям до введения BlobLength проставляется фактическая
    /// длина (иначе legacy-блобы не занимают квоту), счётчик пересчитывается с нуля —
    /// любой дрейф не переживает рестарт. По одному документу в памяти.
    /// </summary>
    private void MigrateBlobLengthAndRecount()
    {
        var raw = _db.GetCollection("vault");
        var ids = raw.FindAll().Select(d => d["_id"]).ToList();
        long total = 0;
        foreach (var id in ids)
        {
            var doc = raw.FindById(id);
            if (doc is null)
                continue;
            var blobLength = doc["Blob"].AsBinary.Length;
            if (!doc.ContainsKey("BlobLength") || doc["BlobLength"].AsInt64 != blobLength)
            {
                doc["BlobLength"] = blobLength;
                raw.Update(doc);
            }
            total += blobLength;
        }
        SetTotalBytes(total);
    }

    /// <summary>
    /// Сохраняет блоб; false — суммарный лимит превышен или на диске нет резерва.
    /// </summary>
    public bool Insert(string idHex, byte[] blob, long expiresAt, bool oneTime, long createdAt)
    {
        if (new DriveInfo(Path.GetPathRoot(_dbPath)!).AvailableFreeSpace < _limits.DiskReserveBytes) return false;

        lock (_sync)
        {
            _db.BeginTrans();
            try
            {
                var total = TotalBytes() + blob.Length;
                if (total > _limits.MaxTotalBytes)
                {
                    _db.Rollback();
                    return false;
                }
                Vault.Insert(new VaultDoc
                {
                    IdHex = idHex,
                    Blob = blob,
                    BlobLength = blob.Length,
                    ExpiresAt = expiresAt,
                    OneTime = oneTime,
                    CreatedAt = createdAt,
                });
                SetTotalBytes(total);
                _db.Commit();
                return true;
            }
            catch
            {
                _db.Rollback();
                throw;
            }
        }
    }

    /// <summary>
    /// Отдаёт блоб; для one_time удаляет запись в одной транзакции.
    /// Параллельные читатели видят запись до write-lock, но DeleteMany &gt; 0
    /// ровно у одного — блоб получает только победитель удаления.
    /// </summary>
    public byte[]? Take(string idHex, long now)
    {
        lock (_sync)
        {
            _db.BeginTrans();
            try
            {
                var doc = Vault.FindOne(x => x.IdHex == idHex && x.ExpiresAt >= now);
                if (doc is not null && doc.OneTime)
                {
                    if (Vault.DeleteMany(x => x.IdHex == idHex) == 0)
                        doc = null;
                    else
                        SetTotalBytes(TotalBytes() - doc.BlobLength);
                }
                _db.Commit();
                return doc?.Blob;
            }
            catch
            {
                _db.Rollback();
                throw;
            }
        }
    }

    /// <summary>
    /// Удаляет просроченное и пересчитывает счётчик занятых байтов.
    /// Все мутаторы сериализованы <see cref="_sync"/>, пересчёт консистентен.
    /// </summary>
    public long DeleteExpired(long now)
    {
        lock (_sync)
        {
            var deleted = Vault.DeleteMany(x => x.ExpiresAt < now);
            if (deleted > 0)
                SetTotalBytes(Vault.Query().Select("$.BlobLength").ToDocuments().Sum(d => d["BlobLength"].AsInt64));
            return deleted;
        }
    }

    /// <summary>
    /// Проверяет доступность записи без выдачи блоба и без удаления (для статуса на странице чтения).
    /// </summary>
    public bool Exists(string idHex, long now) => Vault.Exists(x => x.IdHex == idHex && x.ExpiresAt >= now);

    public void Dispose() => _db.Dispose();

    private ILiteCollection<VaultDoc> Vault => _db.GetCollection<VaultDoc>("vault");

    /// <summary>Счётчик занятых байтов в коллекции meta (документ _id = "totalBytes").</summary>
    private long TotalBytes() => Meta.FindById("totalBytes")?["v"].AsInt64 ?? 0;

    private void SetTotalBytes(long value) => Meta.Upsert(new BsonDocument { ["_id"] = "totalBytes", ["v"] = Math.Max(0, value) });

    private ILiteCollection<BsonDocument> Meta => _db.GetCollection("meta");

    private sealed class VaultDoc
    {
        public string IdHex { get; set; } = "";
        public byte[] Blob { get; set; } = [];
        public long BlobLength { get; set; }
        public long ExpiresAt { get; set; }
        public bool OneTime { get; set; }
        public long CreatedAt { get; set; }
    }
}