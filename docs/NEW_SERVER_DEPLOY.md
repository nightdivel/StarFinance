# Star Finance — Как поставить на новый сервер (nginx + Caddy + Docker)

Пошаговая инструкция для установки на новый VPS/сервер из Git с публикацией под `https://fin.blacksky.su/economy/` и `https://bot.blacksky.su/login`.

## 1) Требования к серверу

- Linux сервер с публичным IP.
- Открыты входящие порты: **80/tcp**, **443/tcp**.
- Установлены: `git`, `docker`, `docker-compose`, `nginx`.

## 2) DNS

Создай A-записи:
- `fin.blacksky.su` → `<PUBLIC_SERVER_IP>`
- `bot.blacksky.su` → `<PUBLIC_SERVER_IP>`

Жди обновления DNS (1–30 минут).

## 3) Подготовка SSL (wildcard сертификат)

Положи wildcard сертификат в `/etc/nginx/ssl/blacksky.su/`:
```bash
sudo mkdir -p /etc/nginx/ssl/blacksky.su
sudo cp fullchain.pem /etc/nginx/ssl/blacksky.su/
sudo cp clean.pem /etc/nginx/ssl/blacksky.su/
sudo chmod 600 /etc/nginx/ssl/blacksky.su/clean.pem
```

## 4) nginx vhosts

Создай два файла:

### fin.blacksky.su
```bash
sudo tee /etc/nginx/sites-available/fin.blacksky.su <<'EOF'
server {
    listen 80;
    server_name fin.blacksky.su;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name fin.blacksky.su;
    ssl_certificate /etc/nginx/ssl/blacksky.su/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/blacksky.su/clean.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
```

### bot.blacksky.su
```bash
sudo tee /etc/nginx/sites-available/bot.blacksky.su <<'EOF'
server {
    listen 80;
    server_name bot.blacksky.su;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name bot.blacksky.su;
    ssl_certificate /etc/nginx/ssl/blacksky.su/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/blacksky.su/clean.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
EOF
```

Включи сайты:
```bash
sudo ln -s /etc/nginx/sites-available/fin.blacksky.su /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/bot.blacksky.su /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 5) Клонирование и настройка проекта

```bash
git clone <REPO_URL> starfinance
cd starfinance
```

Создай `.env`:
```bash
cp .env.example .env
```

Заполни:
```bash
DOMAIN=fin.blacksky.su
EMAIL=no-reply@blacksky.su
FRONTEND_URL=https://fin.blacksky.su/economy
DISCORD_REDIRECT_URI=https://fin.blacksky.su/economy/auth/discord/callback

# PostgreSQL
PG_HOST=postgres
PG_PORT=5432
PG_DATABASE=starfinance
PG_USER=postgres
PG_PASSWORD=postgres

# Секреты (обязательно!)
JWT_SECRET=<длинный случайный секрет>
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
```

## 6) Запуск контейнеров

```bash
docker compose up -d --build
```

Проверь статус:
```bash
docker compose ps
```

## 7) Проверка работоспособности

```bash
curl -I https://fin.blacksky.su/economy/
curl -s https://fin.blacksky.su/economy/public/discord-enabled
curl -I https://bot.blacksky.su/login
```

Ожидай:
- `200 OK` для фронтенда.
- `{"enable":true}` для `discord-enabled`.
- `200 OK` для бота.

## 8) Discord OAuth (если включено)

В Discord Developer Portal добавь Redirect URI:
- `https://fin.blacksky.su/economy/auth/discord/callback`

## 9) Обновление (redeploy)

```bash
git pull
docker compose down
docker compose up -d --build
```

## 10) Логи и отладка

```bash
# nginx
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log

# Caddy
docker compose logs -f caddy

# Микросервисы
docker compose logs -f economy users directories
```

## 11) Резервное копирование

```bash
# Бэкап
docker compose exec -T postgres pg_dump -U postgres starfinance > backup_$(date +%Y%m%d_%H%M%S).sql

# Восстановление
docker compose exec -T postgres psql -U postgres starfinance < backup.sql
```

---

Если что-то не работает:
1. Проверь, что nginx слушает 443 с правильными сертификатами: `sudo nginx -t`.
2. Проверь, что Caddy не пытается выпускать сертификаты: `docker compose logs caddy | grep auto_https`.
3. Проверь, что порты 8080/8443 привязаны к 127.0.0.1: `ss -lntp | grep 8080`.
4. Проверь, что микросервисы здоровы: `docker compose ps`.
