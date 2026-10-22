using System.Text.RegularExpressions;
using LiteDB;

namespace Momentum.Infrastructure;

/// <summary>
/// Хранилище/
/// </summary>
public sealed class VaultStore : IDisposable
{
    private readonly LiteDatabase _db;
    private readonly string _dbPath;
    private readonly string? _password;
    private readonly VaultOptions _limits;

    /// <summary>
    /// Сериализует все операции, меняющие записи или счётчик: транзакции LiteDB
    /// не изолируют параллельные read-check-write (общий read-lock до write-lock),
    /// из-за чего квота обходилась параллельными вставками.
    /// </summary>
    private readonly object _sync = new();

    public VaultStore(string dbPath, string dbPassword, VaultOptions limits)
    {
        _dbPath = Path.GetFullPath(dbPath);
        _limits = limits;
        _password = string.IsNullOrEmpty(dbPassword) ? null : dbPassword;
        Directory.CreateDirectory(Path.GetDirectoryName(_dbPath)!);
        // Пароль задаётся типизированным свойством: разбор строки подключения
        // искажает значения с пробелами и кавычками, и Rebuild получил бы другой пароль.
        var connectionString = new ConnectionString { Filename = _dbPath };
        if (_password != null)
            connectionString.Password = dbPassword;
        _db = new LiteDatabase(connectionString);
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
    /// Удаляет просроченное и вычитает их длины из счётчика занятых байтов.
    /// Читаются только просроченные записи: полный пересчёт коллекции читал бы все
    /// блобы (при полной квоте — до 2 ГиБ каждую минуту), держа <see cref="_sync"/>.
    /// </summary>
    public long DeleteExpired(long now)
    {
        lock (_sync)
        {
            var freed = 0L;
            foreach (var doc in Vault.Query().Where(x => x.ExpiresAt < now).ToDocuments())
                freed += doc["BlobLength"].AsInt64;

            var deleted = Vault.DeleteMany(x => x.ExpiresAt < now);
            if (deleted > 0)
                SetTotalBytes(TotalBytes() - freed);
            return deleted;
        }
    }

    /// <summary>
    /// Сервисное обслуживание файла БД: Checkpoint подтягивает журнал, Rebuild
    /// возвращает страницы удалённых записей. Вызывается фоновой чисткой.
    /// </summary>
    public void Maintain(bool rebuild)
    {
        lock (_sync)
        {
            _db.Checkpoint();
            if (!rebuild)
                return;
            // Rebuild без пароля создаёт незашифрованный файл и не открывается заново
            // (LiteDB #2449): пароль передаётся явно, шифрование сохраняется.
            _db.Rebuild(new LiteDB.Engine.RebuildOptions { Password = _password });
            CleanRebuildBackups();
        }
    }

    /// <summary>
    /// Убирает резервные копии Rebuild — ровно те имена, что создаёт LiteDB
    /// (FileHelper.GetSuffixFile): <c>{имя}-backup{ext}</c> и <c>{имя}-backup-{n}{ext}</c>,
    /// номер без ограничения (LiteDB нумерует, пока файлы существуют).
    /// Они дублируют удалённые записи и расходуют диск вне квоты живых блобов.
    /// </summary>
    private void CleanRebuildBackups()
    {
        var dir = Path.GetDirectoryName(_dbPath)!;
        var baseName = Path.GetFileNameWithoutExtension(_dbPath);
        var ext = Path.GetExtension(_dbPath);
        var backup = new Regex($"^{Regex.Escape(baseName)}-backup(?:-\\d+)?{Regex.Escape(ext)}$");
        foreach (var file in Directory.EnumerateFiles(dir).Where(f => backup.IsMatch(Path.GetFileName(f))))
            File.Delete(file);
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