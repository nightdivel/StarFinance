# Star Finance — Деплой и конфигурация

## Обзор
- Контейнеры: `app` (Node.js + frontend build), `postgres`, `nginx`.
- Прокси: Nginx пробрасывает все запросы на `app:3000`.
- Персистентные данные: `pgdata` (том Postgres), `./backend/data` (локальные файлы, напр. фон авторизации).

## Переменные окружения

### Глобальный .env (корень проекта)
- PORT=3000 — порт backend (и фронтенд-статик), который слушает Express.
- HOST=0.0.0.0 — адрес бинда сервера внутри контейнера.
- BASE_URL=http://localhost:3000 — базовый URL сервиса.
- FRONTEND_URL=http://localhost:5173 — базовый URL фронтенда при локальной разработке.
- JWT_SECRET=... — секрет для подписи JWT.
- TOKEN_EXPIRY=24h — срок действия токена.
- DATA_FILE_PATH=./data/starFinance.json — внутренняя папка для сохранения файлов (например, фон авторизации).

### Подключение к PostgreSQL (используется backend/db.js)
- DATABASE_URL — альтернатива точечной конфигурации. Формат: `postgres://user:pass@host:port/dbname`.
- PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD — параметры подключения, если не используется `DATABASE_URL`.
- PG_SSL=true|require — при необходимости использовать SSL (в контейнерном окружении обычно не требуется).

### Переменные docker-compose (services.app.environment)
- NODE_ENV=production
- PORT=3000
- HOST=0.0.0.0
- FRONTEND_URL=https://korjeek.ru/economy
- PG_HOST=postgres
- PG_PORT=5432
- PG_DATABASE=starfinance
- PG_USER=postgres
- PG_PASSWORD=postgres

## Docker Compose
Файл: `docker-compose.yml`
- `app`
  - build: `Dockerfile` (собирает фронтенд и стартует `npm start`).
  - ports: `8080:3000` — внешний порт 8080 на хосте, внутри контейнера 3000.
  - volumes: `./backend/data:/app/backend/data` — публичные файлы, фон логина и др.
  - depends_on: `postgres`.
- `postgres`
  - image: `postgres:15`
  - ports: `5433:5432` — доступ извне (локально — на 5433).
  - volume: `pgdata:/var/lib/postgresql/data`.
- `nginx`
  - image: `nginx:alpine`
  - ports: `80:80`, `443:443` (опционально)
  - volumes: `./nginx.conf:/etc/nginx/nginx.conf`, `./ssl:/etc/ssl/certs`.
  - depends_on: `app`.

Запуск:
```bash
docker compose up -d --build
```
Остановка:
```bash
docker compose down
```

## Dockerfile
- Устанавливает зависимости корня, фронтенда и бэкенда.
- Собирает фронтенд (`frontend/build`).
- Экспонирует порт 3000 и запускает `npm start` (скрипт корня или backend — зависит от `package.json`).

## Nginx
Файл: `nginx.conf`
- upstream `app_backend` → `app:3000`.
- `client_max_body_size 25m` — для загрузок фона авторизации (base64 через JSON).
- Базовые security-заголовки. Пример HTTPS-конфига закомментирован — включите при наличии сертификатов в `./ssl`.
- Публикация приложения под поддиректорией: `https://korjeek.ru/economy/`.
  - `server_name korjeek.ru;`
  - `location = /economy { return 301 /economy/; }`
  - `location /economy/ { proxy_pass http://app_backend/; ... }`

## Профили окружений
- Dev (локально, без Docker):
  - Запустите PostgreSQL локально.
  - Установите `backend/.env` и корневой `.env`.
  - `cd backend && npm run dev` и `cd frontend && npm run dev` (Vite на 5173).
- Prod (через Docker Compose):
  - Настройте реальные значения переменных (`JWT_SECRET`, креды БД, домен).
  - Укажите публичный адрес: `FRONTEND_URL=https://korjeek.ru/economy`.
  - Включите HTTPS: раскомментируйте соответствующий серверный блок и укажите сертификаты.
  - При необходимости настройте `PG_SSL`.

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
