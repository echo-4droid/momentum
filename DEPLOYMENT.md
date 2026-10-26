# Основное

momentum разворачивается на Ubuntu VPS. Сервис systemd запускает self-contained пакет; nginx с TLS принимает запросы и передаёт их Kestrel на `127.0.0.1:8080`; данные хранятся в файле LiteDB в `/opt/momentum/data`. На сервере требуются только nginx и TLS-сертификат.

## Размещение

- Минимальный VPS: Linux, 1 vCPU / 512 МБ RAM / 5–10 ГБ диск.
- Отдельный поддомен (например, `momentum.example.com`) — изоляция origin приложения от соседних сайтов.
- HSTS с `includeSubDomains` — заголовок в конфиге ниже; `preload` — при готовности всего домена к HTTPS.
- Каталог `data/` вне бэкапов провайдера: шифруйте БД паролем (шаг 3) и исключайте каталог из снапшотов.

## 1. Собрать пакет (локально)

```bash
cd server && dotnet publish Momentum.csproj /p:PublishProfile=linux-x64
```

Результат: `server/publish/` — бинарник `Momentum` + `wwwroot/`.

## 2. Подготовить сервер (один раз)

```bash
sudo apt update && sudo apt install -y nginx
sudo useradd --system --home-dir /opt/momentum --shell /usr/sbin/nologin momentum
sudo install -d -o momentum -g momentum -m 750 /opt/momentum
sudo install -d -o momentum -g momentum -m 700 /opt/momentum/data
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
UMask=0077
ReadWritePaths=/opt/momentum/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now momentum
curl -fsS http://127.0.0.1:8080/ -o /dev/null && echo OK
```

Шифрование файла БД: задайте пароль до первого запуска с каталогом `data/`; пароль применяется при создании БД:

```bash
sudo systemctl edit momentum
# [Service]
# Environment=Momentum__DatabasePassword=<пароль>
```

Пароль защищает содержимое файла БД (ID ссылок, времена жизни) при получении файла или снапшота диска.

## 4. nginx + TLS

DNS: A-запись домена → IP сервера.

`/etc/nginx/sites-available/momentum`:

```nginx
server {
    listen 443 ssl http2;
    server_name momentum.example;

    ssl_certificate     /etc/ssl/momentum/fullchain.pem;
    ssl_certificate_key /etc/ssl/momentum/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    client_max_body_size 9m;

    client_body_timeout 60s;
    proxy_connect_timeout 5s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;

    access_log off;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Referrer-Policy no-referrer always;
    add_header X-Content-Type-Options nosniff always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;

    location / {
        proxy_pass         http://127.0.0.1:8080;
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-For $remote_addr;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name momentum.example;
    return 301 https://$host$request_uri;
}
```

Инвариант: Kestrel слушает только 127.0.0.1 (appsettings.json), ForwardedHeaders доверяет заголовкам X-Forwarded-* с loopback — рейт-лимит работает по реальному адресу клиента.

```bash
sudo ln -s /etc/nginx/sites-available/momentum /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Проверка

```bash
curl -fsS https://momentum.example/ -o /dev/null && echo "статика OK"
curl -fsS https://momentum.example/s/x -o /dev/null && echo "SPA OK"
sudo journalctl -u momentum --since -5min   # сервис пишет в журнал только ошибки
```

Инкогнито в браузере: создать → открыть ссылку → прочитать → F5 → 404 (сожжён). В POST-запросе — только непрозрачные байты.
