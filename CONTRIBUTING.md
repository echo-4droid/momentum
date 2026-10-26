# Основное

Правила работы над проектом: [AGENTS.md](AGENTS.md).

## Запуск

Клиент и сервер одной командой, адрес `127.0.0.1:8080`:

```
dotnet run --project server/Momentum.csproj
```

Клиент собирается при сборке сервера таргетом `BuildClient` (устройство сборки: [архитектура](docs/architecture/INDEX.md)).

## Тесты

```
cd client && npm test      # криптомодуль: конверт, оба режима, подмены, лимиты
cd server && dotnet test   # API: create→get→404, лимиты, рейт-лимит
```

## Публикация

Self-contained пакет, результат в `server/publish/` — бинарник `Momentum` + `wwwroot/`:

```
cd server && dotnet publish Momentum.csproj /p:PublishProfile=linux-x64
```

Развёртывание пакета на сервер: [DEPLOYMENT.md](DEPLOYMENT.md).
