# DEPLOY — развёртывание momentum на Ubuntu VPS

Схема: **nginx (TLS) → systemd → Kestrel 127.0.0.1:8080 → LiteDB**. .NET и БД на сервере не нужны — деплоится self-contained пакет.
Префикс `/momentum` задаётся в двух местах и должен совпадать: `EXPO_PUBLIC_BASE_PATH` при сборке клиента (шаг 1) и `X-Forwarded-Prefix` в nginx (шаг 4). Сборочный префикс middleware не заменяет — он зашит в ссылки и пути ассетов статического бандла. Для деплоя в корень — ни то, ни другое.

## 1. Собрать пакет (локально)

```bash
cd server
EXPO_PUBLIC_BASE_PATH=/momentum dotnet publish Momentum.csproj /p:PublishProfile=linux-x64
```

Результат: `server/publish/` — бинарник `Momentum` + `wwwroot/` (клиент собирается таргетом `BuildClient`), без нативных библиотек.

Путь к csproj обязателен: иначе dotnet из `server/` опубликует ещё и тестовый проект.

## 2. Подготовить сервер (один раз)

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
sudo useradd --system --home-dir /opt/momentum --shell /usr/sbin/nologin momentum
sudo mkdir -p /opt/momentum/data
sudo chown -R momentum:momentum /opt/momentum
```

## 3. Отправить пакет и настроить сервис

```bash
scp -r server/publish/* root@SERVER:/opt/momentum/
ssh root@SERVER 'chown -R momentum:momentum /opt/momentum && chmod 750 /opt/momentum/Momentum'
```

`/etc/systemd/system/momentum.service`:

```ini
[Unit]
Description=momentum — E2EE secret exchange
After=network.target

[Service]
User=momentum
Group=momentum
WorkingDirectory=/opt/momentum
ExecStart=/opt/momentum/Momentum
Environment=ASPNETCORE_ENVIRONMENT=Production
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/momentum/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now momentum
curl -fsS http://127.0.0.1:8080/ -o /dev/null && echo OK
```

## 4. nginx + TLS

DNS: A-запись домена → IP сервера.

`/etc/nginx/sites-available/momentum`:

```nginx
server {
    listen 80;
    server_name momentum.example;

    client_max_body_size 9m;
    access_log off;

    location = /momentum { return 301 /momentum/; }
    location /momentum/ {
        proxy_pass         http://127.0.0.1:8080/;
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-For $remote_addr;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   X-Forwarded-Prefix /momentum;
    }
    location / { return 404; }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/momentum /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d momentum.example
```

`certbot --nginx` выпустит сертификат, сам добавит 443-сервер и редирект с HTTP.

## 5. Проверка

```bash
curl -fsS https://momentum.example/momentum/ -o /dev/null && echo "статика OK"
curl -fsS https://momentum.example/momentum/s/x -o /dev/null && echo "SPA OK"
sudo journalctl -u momentum --since -5min   # пусто = хорошо: сервис пишет только ошибки
```

Инкогнито в браузере: создать → открыть ссылку → прочитать → F5 → 404 (сожжён). В POST-запросе — только непрозрачные байты.
