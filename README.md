# Star Finance — микросервисы + Caddy

Веб-приложение управления финансами и складом (React + Ant Design + Node.js/Express). Поддерживает локальную авторизацию и OAuth2 через Discord с маппингом ролей гильдии.

**Схема развёртывания:**
- **Caddy** — TLS-терминатор, обратный прокси и роутинг микросервисов.
- **PostgreSQL** — единая БД для всех сервисов.
- **8 микросервисов** (Node.js/Express) — каждый обслуживает свою доменную область.
- **Frontend** — Vite + React, публикуется через Caddy под `/economy`.

## Содержание

- **Структура проекта**
- **Переменные окружения**
- **Локальный запуск (Dev)**
- **Продакшн через Docker + Caddy (HTTPS)**
- **Настройка Discord OAuth2**
- **Резервное копирование (бэкапы)**
- **Архитектура микросервисов**

---

## Структура проекта

```
.
├─ backend/
│  ├─ .env                     # Переменные окружения бэкенда (секреты)
│  ├─ server.js                # Монолит (оставлен для совместимости, socket.io)
│  ├─ db.js                    # Общий модуль подключения к PostgreSQL
│  ├─ middleware/auth.js       # JWT и проверка прав
│  └─ services/                # Микросервисы
│     ├─ _shared/
│     │   ├─ createServiceApp.js   # Заготовка Express-приложения
│     │   └─ permissions.js         # getPermissionsForTypeDb
│     ├─ users/server.js           # Пользователи
│     ├─ directories/server.js     # Справочники
│     ├─ warehouse/server.js        # Склад
│     ├─ showcase/server.js        # Витрина
│     ├─ requests/server.js        # Заявки
│     ├─ finance/server.js         # Финансы (transactions, finance-requests)
│     ├─ uex/server.js             # UEX API
│     └─ settings/server.js       # Настройки + public assets
├─ frontend/                   # Vite + React (Ant Design)
│  ├─ .env                     # VITE_* переменные (без секретов)
│  └─ src/
├─ docker-compose.yml         # Caddy, PostgreSQL, 8 сервисов
├─ Caddyfile                  # Роутинг API и TLS
├─ Dockerfile                 # Образ монолита (legacy)
└─ README.md                  # Этот файл
```

---

## Переменные окружения

Переменные окружения разделены: фронт и бэк. Секреты — только в `backend/.env`.

`backend/.env` (пример):

```bash
# Server
PORT=3000
HOST=0.0.0.0
BASE_URL=https://blsk.fin-tech.com

# Public URLs / domain
DOMAIN=blsk.fin-tech.com
EMAIL=hitsnruns@gmail.com
CERT_NAME=blsk.fin-tech.com
FRONTEND_URL=https://blsk.fin-tech.com/economy
DISCORD_REDIRECT_URI=https://blsk.fin-tech.com/economy/auth/discord/callback

# PostgreSQL (docker network)
PG_HOST=postgres
PG_PORT=5432
PG_DATABASE=starfinance
PG_USER=postgres
PG_PASSWORD=postgres

# Security
JWT_SECRET=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
TOKEN_EXPIRY=24h

# Discord OAuth (секреты)
DISCORD_CLIENT_ID=xxxx
DISCORD_CLIENT_SECRET=xxxxxx
```

`frontend/.env` (пример):

```bash
VITE_APP_TITLE=BLSK Star Finance
VITE_API_BASE_URL=http://localhost:3000
VITE_ENABLE_DISCORD_AUTH=false
```

---

## Локальный запуск (Dev)

Требования: Node.js 18+

```bash
npm install
npm run dev
```

Скрипт запустит:
- бэкенд на `http://localhost:3000`
- фронтенд на `http://localhost:5173`

Войти в систему: логин `admin`, пароль `admin`.

---

## Продакшн через Docker + Caddy (HTTPS)

1. Подготовить файлы:
- Указать реальные значения в `backend/.env` (включая Discord OAuth и домен в `FRONTEND_URL`).
- Убедиться, что `DOMAIN` и `EMAIL` заданы (для Let's Encrypt).

2. Собрать и поднять:

```bash
docker-compose up -d --build
```

Сервисы:
- `caddy` — TLS-терминатор и роутинг (порты 80/443 на хосте).
- `postgres` — база данных (порт 5433 на хосте).
- `economy` — монолит (legacy, socket.io, фронтенд).
- `users`, `directories`, `warehouse`, `showcase`, `requests`, `finance`, `uex`, `settings` — микросервисы.

3. Пробросить домен:
- Настройте DNS A-запись на ваш сервер.
- Убедитесь, что порт **80** доступен из интернета (обязателен для Let's Encrypt HTTP‑challenge).

### SSL/Let's Encrypt (автовыпуск)

Сертификаты выпускаются Caddy автоматически при первом запуске и хранятся в volume `caddy_data`.

Проверка:
```bash
curl -I https://blsk.fin-tech.com/economy/
```

---

## Настройка Discord OAuth2

1. В Discord Developer Portal:
- Создайте приложение, включите OAuth2.
- Добавьте Redirect URI: `https://blsk.fin-tech.com/economy/auth/discord/callback`.
- Выдайте права (Scopes): `identify`, `email`, `guilds.members.read`.

2. В админке приложения (Настройки → Системные параметры):
- Включите «Авторизация через Discord».
- Заполните `Client ID`, `Client Secret`, `Redirect URI` и нажмите «Сохранить».
- Для маппинга по ролям:
  - Источник: `member`
  - Атрибут: `roles`
  - Значение: `<role_id>`
  - Guild ID: `<guild_id>`

---

## Резервное копирование (бэкапы)

```bash
# Создать бэкап
docker-compose exec -T postgres pg_dump -U postgres starfinance > backup_$(date +%Y%m%d_%H%M%S).sql

# Восстановить бэкап
docker-compose exec -T postgres psql -U postgres starfinance < backup.sql
```

---

## Архитектура микросервисов

### Роутинг API через Caddy

```
/economy/api/users/*      → users:3001
/economy/api/directories/* → directories:3002
/economy/api/warehouse/*   → warehouse:3003
/economy/api/showcase/*   → showcase:3004
/economy/api/requests/*   → requests:3005
/economy/api/transactions/* → finance:3006
/economy/api/finance-requests/* → finance:3006
/economy/api/uex/*        → uex:3007
/economy/api/system/*     → settings:3008
/economy/socket.io/*      → economy:3000 (монолит, realtime)
/economy/*                 → economy:3000 (монолит, фронтенд)
```

### Общие зависимости

- **База данных** — единая PostgreSQL для всех сервисов.
- **Аутентификация** — JWT middleware `authenticateToken` и `requirePermission`.
- **Права доступа** — `getPermissionsForTypeDb` из `backend/services/_shared/permissions.js`.
- **Socket.io** — пока оставлен в монолите (`economy`), события между сервисами не реализованы.

### Что вынесено из монолита

- **UEX API** (`/api/uex`, `/api/uex/sync-directories`)
- **Справочники** (`/api/directories/*`)
- **Пользователи** (`/api/users/*`, `/api/change-password`)
- **Настройки** (`/api/system/*`, `/public/auth/*`)
- **Склад** (`/api/warehouse/*`)
- **Витрина** (`/api/showcase/*`)
- **Заявки** (`/api/requests/*`, `/api/my/requests`)
- **Финансы** (`/api/transactions`, `/api/finance-requests/*`)

Осталось в монолите:
- Фронтенд (статика)
- Socket.io realtime
- Некоторые legacy эндпойнты (если есть)

---

## Полезные команды

```bash
# Dev
npm run dev

# Build только фронтенда
npm run build

# Docker
docker-compose up -d --build
docker-compose logs -f caddy
docker-compose exec -T postgres psql -U postgres starfinance
```

---

Если возникнут вопросы по настройке домена/SSL или расширению функциональности — напишите.
