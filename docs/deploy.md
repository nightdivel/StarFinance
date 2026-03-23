# Star Finance — Деплой и конфигурация

## Обзор
- Контейнеры: `economy` (gateway/legacy + frontend build + socket.io), `postgres`, `caddy` и микросервисы.
- Прокси: **Caddy** принимает 80/443, выпускает сертификаты Let's Encrypt и роутит запросы под префиксом `/economy`.
- Персистентные данные: `pgdata` (том Postgres), `backend_data`/`backend_public` (тома для данных/публичных файлов).

## Переменные окружения

### Глобальный .env (корень проекта)
- DOMAIN, EMAIL — домен и email для Caddy/Let's Encrypt.
- FRONTEND_URL — внешний URL приложения **с префиксом**: `https://<domain>/economy`.
- DISCORD_REDIRECT_URI — внешний redirect URI: `https://<domain>/economy/auth/discord/callback`.
- PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD — подключение к Postgres (в docker-сети).
- JWT_SECRET, TOKEN_EXPIRY — безопасность JWT.

### Подключение к PostgreSQL (используется backend/db.js)
- DATABASE_URL — альтернатива точечной конфигурации. Формат: `postgres://user:pass@host:port/dbname`.
- PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD — параметры подключения, если не используется `DATABASE_URL`.
- PG_SSL=true|require — при необходимости использовать SSL (в контейнерном окружении обычно не требуется).

### Переменные docker-compose (services.app.environment)
- NODE_ENV=production
- PORT=3000
- FRONTEND_URL=https://<domain>/economy
- PG_HOST=postgres
- PG_PORT=5432
- PG_DATABASE=starfinance
- PG_USER=postgres
- PG_PASSWORD=postgres

## Docker Compose
Файл: `docker-compose.yml`
- `economy`
  - build: `Dockerfile` (сборка frontend + backend в одном образе для всех сервисов).
  - внутрь проксируется Caddy (наружу напрямую порт не публикуется).
- микросервисы: `users`, `directories`, `warehouse`, `showcase`, `requests`, `finance`, `uex`, `settings`.
- `postgres`
  - image: `postgres:15`
  - ports: `5433:5432` — доступ извне (локально — на 5433).
  - volume: `pgdata:/var/lib/postgresql/data`.
- `caddy`
  - image: `caddy:2.8-alpine`
  - ports: `80:80`, `443:443`
  - volume: `./Caddyfile:/etc/caddy/Caddyfile:ro`

Запуск:
```bash
docker-compose up -d --build
```
Остановка:
```bash
docker-compose down
```

## Dockerfile
- Устанавливает зависимости корня, фронтенда и бэкенда.
- Собирает фронтенд (`frontend/dist`).
- Экспонирует порт 3000 и запускает `npm start` (скрипт корня или backend — зависит от `package.json`).

## Caddy
Файлы: `Caddyfile`, `docker-compose.yml`
- Публикация приложения под поддиректорией: `https://<domain>/economy/`.
- Caddy автоматически выпускает TLS-сертификат Let's Encrypt при первом старте.

## Профили окружений
- Dev (локально, без Docker):
  - Запустите PostgreSQL локально.
  - Установите `backend/.env` и корневой `.env`.
  - `cd backend && npm run dev` и `cd frontend && npm run dev` (Vite на 5173).
- Prod (через Docker Compose):
  - Настройте реальные значения переменных (`JWT_SECRET`, креды БД, домен).
  - Укажите публичный адрес: `FRONTEND_URL=https://<domain>/economy`.
  - Убедитесь, что порты 80/443 доступны снаружи (для Let's Encrypt).

## CI/CD (GitHub Actions)

- Workflow: `.github/workflows/deploy.yml`
- Секреты репозитория:
  - `HOST` — домен/IP сервера
  - `USERNAME` — SSH-пользователь
  - `PORT` — `22`
  - `SSH_PRIVATE_KEY` — приватный ключ OpenSSH
- Деплой: на пуш в ветку `main` выполняется SSH-скрипт на сервере:
  - `git pull` или `git clone` репозитория
  - `docker-compose down && docker-compose build && docker-compose up -d`
  - очистка старых образов `docker image prune -f`

## Миграции БД
- Скрипты: `backend/migrations/*.sql` + утилиты `backend/scripts/migrate_*.js`.
- Запуск (пример):
```bash
cd backend
npm run migrate:all
```
Убедитесь, что переменные подключения к БД заданы (`DATABASE_URL` или PG_*).

## Резервное копирование
- Том `pgdata` — штатный механизм бэкапа Postgres (pg_dump/pg_basebackup).
- Папка `backend/data` — файлы (например, фон логина). Резервируйте через volume backup.

## Мониторинг и здоровье
- `GET /health` — проверка доступности (Nginx/Load Balancer health checks).

## Безопасность
- Всегда используйте долгий случайный `JWT_SECRET` в проде.
- Ограничьте доступ к БД (сетевые ACL, пароли).
- Включите HTTPS (строгий TLS, HSTS).
- Регулярно обновляйте образы (Node, Nginx, Postgres).
