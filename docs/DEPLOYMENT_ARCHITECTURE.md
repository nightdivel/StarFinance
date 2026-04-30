# Star Finance: Архитектура деплоя (nginx + Caddy + Docker)

## Схема

```
Internet (80/443) → nginx (TLS termination, wildcard SSL)
                     ├─ fin.blacksky.su → Caddy (127.0.0.1:8080) → микросервисы
                     └─ bot.blacksky.su → blackhole_bot (127.0.0.1:3001)
```

### Компоненты

| Компонент | Роль | Порты (хост) | Порты (контейнер) |
|-----------|------|--------------|-------------------|
| **nginx** | TLS-терминатор, роутинг по доменам | 80, 443 | — |
| **Caddy** | HTTP-бэкенд, роутинг микросервисов | 127.0.0.1:8080, 127.0.0.1:8443 | 80, 443 |
| **economy** | Монолит: фронтенд, socket.io, auth | — | 3000 |
| **users** | Микросервис: пользователи | — | 3001 |
| **directories** | Микросервис: справочники | — | 3002 |
| **warehouse** | Микросервис: склад | — | 3003 |
| **showcase** | Микросервис: витрина | — | 3004 |
| **requests** | Микросервис: заявки | — | 3005 |
| **finance** | Микросервис: финансы | — | 3006 |
| **uex** | Микросервис: UEX API | — | 3007 |
| **settings** | Микросервис: настройки, public assets | — | 3008 |
| **tools_service** | История запусков и настройки инструментов | — | 3010 |
| **postgres** | База данных | — | 5432 |
| **blackhole_bot** | Discord-бот (отдельный проект) | 127.0.0.1:3001 (только внутри) | 3001 |

---

## nginx конфигурация

### fin.blacksky.su
```nginx
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
```

### bot.blacksky.su
```nginx
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
```

---

## Caddyfile (HTTP-бэкенд)

```caddy
{
	auto_https off
}

http://{$DOMAIN} {
	encode gzip

	@root path /
	redir @root /economy/ 301

	@economyNoSlash path /economy
	redir @economyNoSlash /economy/ 301

	# Socket.IO
	handle /economy/socket.io* {
		uri strip_prefix /economy
		reverse_proxy economy:3000 {
			lb_try_duration 10s
			lb_try_interval 250ms
		}
	}

	# API микросервисы
	handle /economy/api/users/*     { uri strip_prefix /economy; reverse_proxy users:3001 }
	handle /economy/api/directories/* { uri strip_prefix /economy; reverse_proxy directories:3002 }
	handle /economy/api/warehouse/*   { uri strip_prefix /economy; reverse_proxy warehouse:3003 }
	handle /economy/api/showcase/*   { uri strip_prefix /economy; reverse_proxy showcase:3004 }
	handle /economy/api/requests/*   { uri strip_prefix /economy; reverse_proxy requests:3005 }
	handle /economy/api/finance/*    { uri strip_prefix /economy; reverse_proxy finance:3006 }
	handle /economy/api/uex*         { uri strip_prefix /economy; reverse_proxy uex:3007 }
	handle /economy/api/system/*     { uri strip_prefix /economy; reverse_proxy settings:3008 }

	# Public assets (discord-enabled в economy, остальное в settings)
	handle /economy/public/discord-enabled { uri strip_prefix /economy; reverse_proxy economy:3000 }
	handle /economy/public/*               { uri strip_prefix /economy; reverse_proxy settings:3008 }

	# Auth (login, Discord callbacks)
	handle /economy/auth/* { uri strip_prefix /economy; reverse_proxy economy:3000 }

	# Фронтенд и остальные запросы
	handle /economy/* {
		uri strip_prefix /economy
		reverse_proxy economy:3000 {
			lb_try_duration 10s
			lb_try_interval 250ms
		}
	}
}
```

---

## docker-compose.yml (ключевые моменты)

```yaml
caddy:
  image: caddy:2.8-alpine
  container_name: economy_caddy
  restart: unless-stopped
  environment:
    DOMAIN: ${DOMAIN}
    EMAIL: ${EMAIL}
  ports:
    - "127.0.0.1:8080:80"
    - "127.0.0.1:8443:443"
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile:ro
    - caddy_data:/data
    - caddy_config:/config
  depends_on:
    - economy
    - users
    - directories
    - warehouse
    - showcase
    - requests
    - finance
    - uex
    - settings
```

**Важно:** Порты 8080/8443 привязаны только к `127.0.0.1`, чтобы не торчать наружу.

---

## Переменные окружения (.env)

```bash
# Домен и почта (для Caddy, но без ACME)
DOMAIN=fin.blacksky.su
EMAIL=no-reply@blacksky.su

# URL фронтенда и Discord OAuth
FRONTEND_URL=https://fin.blacksky.su/economy
DISCORD_REDIRECT_URI=https://fin.blacksky.su/economy/auth/discord/callback
DISCORD_BOT_TOKEN=

# PostgreSQL (внутри Docker сети)
PG_HOST=postgres
PG_PORT=5432
PG_DATABASE=starfinance
PG_USER=postgres
PG_PASSWORD=postgres
```

---

## Роутинг API

| Путь (снаружи) | Внутри Docker | Сервис |
|----------------|---------------|--------|
| `/economy/api/users/*` | `/api/users/*` | users:3001 |
| `/economy/api/directories/*` | `/api/directories/*` | directories:3002 |
| `/economy/api/warehouse/*` | `/api/warehouse/*` | warehouse:3003 |
| `/economy/api/showcase/*` | `/api/showcase/*` | showcase:3004 |
| `/economy/api/requests/*` | `/api/requests/*` | requests:3005 |
| `/economy/api/finance/*` | `/api/finance/*` | finance:3006 |
| `/economy/api/uex*` | `/api/uex*` | uex:3007 |
| `/economy/api/system/*` | `/api/system/*` | settings:3008 |
| `/economy/public/discord-enabled` | `/public/discord-enabled` | economy:3000 |
| `/economy/public/*` | `/public/*` | settings:3008 |
| `/economy/auth/*` | `/auth/*` | economy:3000 |
| `/economy/socket.io/*` | `/socket.io/*` | economy:3000 |
| `/economy/*` | `/` | economy:3000 (фронтенд) |

---

## Проверка работоспособности

```bash
# Фронтенд
curl -I https://fin.blacksky.su/economy/

# API
curl -s https://fin.blacksky.su/economy/public/discord-enabled
curl -s https://fin.blacksky.su/economy/api/users | head -n 20

# Бот
curl -I https://bot.blacksky.su/login
```

---

## Важные моменты

1. **Только nginx слушает 80/443 извне.** Caddy и микросервисы доступны только через `127.0.0.1`.
2. **Caddy работает в HTTP-режиме (`auto_https off`)**, потому что TLS терминирует nginx.
3. **Роутинг `/economy/auth/*` и `/economy/public/*`** явно прописаны, чтобы избежать 404.
4. **Порт 3001 (blackhole_bot) скрыт** — доступен только через nginx vhost `bot.blacksky.su`.
5. **Wildcard SSL сертификат** используется в nginx для обоих доменов.

---

## Деплой на новый сервер

1. Установить Docker, Docker Compose, nginx.
2. Положить wildcard сертификат в `/etc/nginx/ssl/blacksky.su/`.
3. Создать nginx vhosts для `fin.blacksky.su` и `bot.blacksky.su`.
4. Скопировать проект в `/opt/starfinance`.
5. Настроить `.env` под домен.
6. Запустить: `docker compose up -d --build`.
7. Проверить эндпоинты.

---

## Резервное копирование

```bash
# Бэкап БД
docker compose exec -T postgres pg_dump -U postgres starfinance > backup_$(date +%Y%m%d_%H%M%S).sql

# Восстановление
docker compose exec -T postgres psql -U postgres starfinance < backup.sql
```

---

## Логи и отладка

```bash
# nginx
tail -f /var/log/nginx/access.log /var/log/nginx/error.log

# Caddy
docker compose logs -f caddy

# Микросервисы
docker compose logs -f economy users directories
```

---

Если возникнут проблемы с роутингом или SSL — проверьте:
- nginx vhosts слушают 443 ssl с правильными сертификатами.
- Caddyfile содержит `auto_https off` и `http://{$DOMAIN}`.
- Порты в docker-compose.yml привязаны к `127.0.0.1`.
- Микросервисы запущены и здоровы (`docker compose ps`).
