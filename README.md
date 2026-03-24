# Star Finance — микросервисная платформа управления финансами и складом

Современная веб-платформа для управления финансами, складом и бизнес-процессами. Построена на архитектуре микросервисов с React фронтендом и Node.js/Express бэкендом. Поддерживает локальную авторизацию и OAuth2 через Discord с гибким маппингом ролей.

**🏗️ Архитектура:**
- **Caddy** — TLS-терминатор, обратный прокси и роутинг микросервисов
- **PostgreSQL** — единая база данных для всех сервисов
- **9 микросервисов** (Node.js/Express) — каждый обслуживает свою доменную область
- **Frontend** — Vite + React 18 + Ant Design 5, публикуется через Caddy под `/economy`
- **Socket.io** — realtime обновления и уведомления

## Содержание

- **📁 Структура проекта**
- **🛠️ Технологический стек**
- **⚙️ Переменные окружения**
- **🚀 Локальный запуск (Development)**
- **🏭 Продакшн через Docker + Caddy (HTTPS)**
- **🚀 Пошаговый деплой на новый сервер**
- **🔐 Настройка Discord OAuth2**
- **💾 Резервное копирование и восстановление**
- **🏗️ Архитектура микросервисов**
- **🛠️ Полезные команды**
- **📚 Дополнительная документация**
- **🤝 Поддержка**

---

## Структура проекта

```
star-finance/
├─ 📁 backend/                    # Бэкенд на Node.js/Express
│  ├─ 🔧 .env                     # Переменные окружения (секреты)
│  ├─ 🚀 server.js                # Монолит (legacy, socket.io)
│  ├─ 🗄️ db.js                    # Модуль подключения к PostgreSQL
│  ├─ 🛡️ middleware/auth.js       # JWT и проверка прав доступа
│  ├─ 📁 services/                # Микросервисы (9 сервисов)
│  │  ├─ 📁 _shared/              # Общие модули
│  │  │   ├─ 🔧 createServiceApp.js   # Заготовка Express-приложения
│  │  │   └─ 🔐 permissions.js         # Управление правами доступа
│  │  ├─ 👥 users/server.js           # Управление пользователями
│  │  ├─ 📚 directories/server.js     # Справочники и классификаторы
│  │  ├─ 📦 warehouse/server.js        # Управление складом
│  │  ├─ 🏪 showcase/server.js        # Витрина товаров/услуг
│  │  ├─ 📋 requests/server.js        # Обработка заявок
│  │  ├─ 💰 finance/server.js         # Финансы (транзакции, заявки)
│  │  ├─ 🚀 uex/server.js             # UEX API интеграция
│  │  └─ ⚙️ settings/server.js        # Настройки системы + ассеты
├─ 📁 frontend/                   # Vite + React 18 + Ant Design 5
│  ├─ 🔧 .env                     # VITE_* переменные (без секретов)
│  ├─ 📁 public/                  # Статические ресурсы
│  ├─ 📁 src/                     # Исходный код React приложения
│  │  ├─ 📁 components/           # React компоненты
│  │  ├─ 📁 hooks/                # Custom hooks
│  │  ├─ 📁 config/               # Конфигурация приложения
│  │  ├─ 🎨 App.css               # Стили приложения
│  │  └─ ⚛️ App.jsx               # Главный компонент
├─ 🐳 docker-compose.yml          # Caddy, PostgreSQL, 9 сервисов
├─ 🔧 Caddyfile                   # Роутинг API и TLS конфигурация
├─ 🐳 Dockerfile                  # Образ монолита (legacy)
├─ 📄 package.json                # Корневые скрипты и зависимости
├─ 📁 docs/                       # Документация проекта
├─ 📁 scripts/                    # Скрипты деплоя и обслуживания
└─ 📖 README.md                   # Этот файл
```

### 🛠️ Технологический стек

**Фронтенд:**
- **React 18** — современная библиотека UI
- **Vite** — быстрый сборщик и dev сервер
- **Ant Design 5** — UI компонент фреймворк
- **React Router 6** — маршрутизация
- **TanStack Query** — управление состоянием сервера
- **Socket.io Client** — realtime коммуникация
- **Bootstrap 5** — дополнительные стили
- **Quill** — rich text редактор

**Бэкенд:**
- **Node.js 18+** — runtime среда
- **Express.js** — веб фреймворк
- **PostgreSQL** — реляционная БД
- **JWT** — аутентификация
- **Socket.io** — realtime сервер
- **Discord OAuth2** — внешняя аутентификация

**Инфраструктура:**
- **Docker & Docker Compose** — контейнеризация
- **Caddy** — reverse proxy и TLS
- **Nginx** — внешний TLS terminator (production)

---

## Переменные окружения

Переменные окружения разделены: фронт и бэк. Секреты — только в `backend/.env`.

`backend/.env` (пример):

```bash
# Server
PORT=3000
HOST=0.0.0.0
BASE_URL=https://fin.blacksky.su

# Public URLs / domain
DOMAIN=fin.blacksky.su
EMAIL=hitsnruns@gmail.com
CERT_NAME=fin.blacksky.su
FRONTEND_URL=https://fin.blacksky.su/economy
DISCORD_REDIRECT_URI=https://fin.blacksky.su/economy/auth/discord/callback

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
VITE_APP_TITLE=BlackSky Star Finance
VITE_API_BASE_URL=https://fin.blacksky.su
VITE_ENABLE_DISCORD_AUTH=true
```

---

## 🚀 Локальный запуск (Development)

### Требования
- **Node.js 18+** и **npm**
- **Docker** и **Docker Compose** (для PostgreSQL)

### Быстрый старт

```bash
# Клонируем репозиторий
git clone <repository-url>
cd star-finance

# Устанавливаем зависимости
npm install

# Запускаем базу данных
npm run dev:db

# Запускаем приложение в режиме разработки
npm run dev
```

### Что происходит при запуске

Скрипт `npm run dev` запускает:
- **Бэкенд** на `http://localhost:3000` (Express + Socket.io)
- **Фронтенд** на `http://localhost:5173` (Vite dev сервер)
- **PostgreSQL** в Docker контейнере на порту `5432`

### Доступ к системе

- **Приложение**: http://localhost:5173
- **API**: http://localhost:3000
- **База данных**: postgresql://postgres:postgres@localhost:5432/starfinance

**Учётные данные по умолчанию:**
- Логин: `admin`
- Пароль: `admin`

### Доступные скрипты

```bash
# Разработка
npm run dev              # Запустить всё (бэкенд + фронтенд + БД)
npm run dev:backend      # Только бэкенд
npm run dev:frontend     # Только фронтенд
npm run dev:db           # Только PostgreSQL
npm run dev:stop:db      # Остановить PostgreSQL
npm run dev:down         # Остановить все Docker контейнеры

# Сборка
npm run build            # Собрать фронтенд
npm run build:frontend   # Сборка фронтенда (псевдоним)

# Production
npm start                # Запустить бэкенд в production режиме

# Docker
npm run docker:build     # Собрать Docker образы
npm run docker:up        # Запустить в Docker
npm run docker:down      # Остановить Docker

# Качество кода
npm run lint             # Проверить ESLint
npm run lint:fix         # Исправить ESLint ошибки
npm run format           # Форматировать Prettier
```

---

## 🏭 Продакшн через Docker + Caddy (HTTPS)

### 🏗️ Архитектура production

- **Nginx** (опционально) — внешний TLS-терминатор с wildcard сертификатом
- **Caddy** — основной reverse proxy, автоматический TLS и роутинг микросервисов
- **PostgreSQL** — единая база данных в Docker контейнере
- **9 микросервисов** + монолит `economy` (фронтенд + socket.io)

### 📋 Подготовка к деплою

1. **Системные требования:**
   - Docker и Docker Compose
   - Nginx (если используется внешний TLS terminator)
   - Домен с настроенными DNS A-записями

2. **SSL сертификаты** (если используется Nginx):
   ```bash
   # Положить wildcard сертификат в /etc/nginx/ssl/fin.blacksky.su/
   - fullchain.pem
   - clean.pem (приватный ключ)
   ```

3. **Конфигурация Nginx** (опционально):
   ```bash
   # Создать vhosts
   /etc/nginx/sites-available/fin.blacksky.su
   # Включить в sites-enabled
   ```

### ⚙️ Конфигурационные файлы

- **`.env`** — домен, URL, Discord OAuth, настройки БД
- **`Caddyfile`** — роутинг API, автоматический HTTPS
- **`docker-compose.yml`** — определение сервисов и портов

### 🚀 Запуск в production

```bash
# Сборка и запуск всех сервисов
docker compose up -d --build

# Проверка статуса
docker compose ps

# Просмотр логов
docker compose logs -f caddy
docker compose logs -f postgres
```

### 🔍 Проверка работоспособности

```bash
# Проверка фронтенда
curl -I https://fin.blacksky.su/economy/

# Проверка API
curl -s https://fin.blacksky.su/economy/api/users/health

# Проверка Discord OAuth
curl -s https://fin.blacksky.su/economy/public/discord-enabled

# Проверка Socket.io
curl -I https://fin.blacksky.su/economy/socket.io/
```

### 📊 Мониторинг и обслуживание

```bash
# Статус всех контейнеров
docker compose ps

# Логи конкретного сервиса
docker compose logs -f users
docker compose logs -f finance

# Подключение к базе данных
docker compose exec postgres psql -U postgres starfinance

# Перезапуск сервиса
docker compose restart users

# Обновление сервиса
docker compose up -d --build users
```

---

## 🚀 Пошаговый деплой на новый сервер

> **Подробная инструкция**: см. документ `docs/NEW_SERVER_DEPLOY.md`

### Краткая версия деплоя:

1. **Подготовка сервера**
   ```bash
   # Установка Docker и Docker Compose
   curl -fsSL https://get.docker.com -o get-docker.sh
   sh get-docker.sh
   
   # Установка Node.js (если нужен локальный dev)
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   apt-get install -y nodejs
   ```

2. **Настройка проекта**
   ```bash
   # Клонирование и настройка
   git clone <repository-url>
   cd star-finance
   cp .env.example .env
   # Редактировать .env с нужными параметрами
   ```

3. **Запуск**
   ```bash
   # Production запуск
   docker compose up -d --build
   ```

---

## 🔐 Настройка Discord OAuth2

### 1. Создание Discord приложения

1. Перейдите в [Discord Developer Portal](https://discord.com/developers/applications)
2. Создайте новое приложение → **New Application**
3. Включите **OAuth2** в настройках
4. Добавьте **Redirect URI**:
   ```
   https://fin.blacksky.su/economy/auth/discord/callback
   ```
5. Настройте **Scopes** (права доступа):
   - `identify` — информация о пользователе
   - `email` — email пользователя  
   - `guilds.members.read` — роли в гильдии

### 2. Настройка в админке Star Finance

1. Войдите в систему как администратор
2. Перейдите: **Настройки → Системные параметры**
3. Включите **«Авторизация через Discord»**
4. Заполните параметры:
   - **Client ID**: ID Discord приложения
   - **Client Secret**: секрет Discord приложения
   - **Redirect URI**: такой же как в Discord Developer Portal
5. Нажмите **«Сохранить»**

### 3. Маппинг ролей (опционально)

Для автоматического распределения прав по ролям Discord:

- **Источник**: `member`
- **Атрибут**: `roles`
- **Значение**: `<role_id>` (ID роли Discord)
- **Guild ID**: `<guild_id>` (ID сервера Discord)

### 4. Проверка работы

```bash
# Проверка включенного OAuth
curl -s https://fin.blacksky.su/economy/public/discord-enabled

# Должен вернуть: {"enabled": true}
```

---

## 💾 Резервное копирование и восстановление

### 📦 Создание бэкапов

```bash
# Полный бэкап базы данных
docker compose exec -T postgres pg_dump -U postgres starfinance > backup_$(date +%Y%m%d_%H%M%S).sql

# Сжатый бэкап
docker compose exec -T postgres pg_dump -U postgres starfinance | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Бэкап только данных (без схемы)
docker compose exec -T postgres pg_dump -U postgres --data-only starfinance > data_backup_$(date +%Y%m%d_%H%M%S).sql
```

### 🔄 Восстановление из бэкапа

```bash
# Восстановление из полного бэкапа
docker compose exec -T postgres psql -U postgres starfinance < backup_20240324_120000.sql

# Восстановление из сжатого бэкапа
gunzip -c backup_20240324_120000.sql.gz | docker compose exec -T postgres psql -U postgres starfinance

# Восстановление только данных
docker compose exec -T postgres psql -U postgres starfinance < data_backup_20240324_120000.sql
```

### 🕐 Автоматические бэкапы (cron)

```bash
# Добавить в crontab для ежедневных бэкапов в 2:00 ночи
0 2 * * * cd /path/to/star-finance && docker compose exec -T postgres pg_dump -U postgres starfinance | gzip > /backups/starfinance_$(date +\%Y\%m\%d_\%H\%M\%S).sql.gz

# Удалять бэкапы старше 30 дней
0 3 * * * find /backups -name "starfinance_*.sql.gz" -mtime +30 -delete
```

---

## 🏗️ Архитектура микросервисов

### 🌐 Роутинг API через Caddy

```
/economy/api/users/*           → users:3001        # Управление пользователями
/economy/api/directories/*     → directories:3002  # Справочники
/economy/api/warehouse/*       → warehouse:3003    # Склад
/economy/api/showcase/*        → showcase:3004     # Витрина
/economy/api/requests/*        → requests:3005     # Заявки
/economy/api/transactions/*    → finance:3006      # Финансовые транзакции
/economy/api/finance-requests/* → finance:3006    # Финансовые заявки
/economy/api/uex/*            → uex:3007          # UEX интеграция
/economy/api/system/*         → settings:3008     # Настройки системы
/economy/socket.io/*           → economy:3000      # Realtime (монолит)
/economy/*                     → economy:3000      # Фронтенд (монолит)
```

### 🔗 Общие зависимости и компоненты

- **🗄️ База данных** — единая PostgreSQL для всех сервисов
- **🛡️ Аутентификация** — JWT middleware `authenticateToken` и `requirePermission`
- **🔐 Права доступа** — `getPermissionsForTypeDb` из `backend/services/_shared/permissions.js`
- **⚡ Socket.io** — realtime обновления (пока в монолите `economy`)

### 📦 Микросервисы и их ответственность

| Сервис | Порт | Ответственность | Основные эндпойнты |
|--------|------|----------------|-------------------|
| **users** | 3001 | Управление пользователями | `/api/users/*`, `/change-password` |
| **directories** | 3002 | Справочники и классификаторы | `/api/directories/*` |
| **warehouse** | 3003 | Управление складом | `/api/warehouse/*` |
| **showcase** | 3004 | Витрина товаров/услуг | `/api/showcase/*` |
| **requests** | 3005 | Обработка заявок | `/api/requests/*`, `/my/requests` |
| **finance** | 3006 | Финансы | `/api/transactions`, `/api/finance-requests/*` |
| **uex** | 3007 | UEX API интеграция | `/api/uex/*`, `/api/uex/sync-directories` |
| **settings** | 3008 | Настройки системы | `/api/system/*`, `/public/auth/*` |

### 🔄 Что осталось в монолите (`economy`)

- **⚛️ Фронтенд** — статика React приложения
- **⚡ Socket.io** — realtime коммуникация
- **🔗 Legacy эндпойнты** — обратная совместимость

---

## 🛠️ Полезные команды

### 📋 Development команды

```bash
# Запустить всё в режиме разработки
npm run dev

# Только бэкенд
npm run dev:backend

# Только фронтенд  
npm run dev:frontend

# База данных
npm run dev:db          # Запустить PostgreSQL
npm run dev:stop:db     # Остановить PostgreSQL
npm run dev:down        # Остановить все Docker контейнеры
```

### 🏗️ Build и Production

```bash
# Сборка фронтенда
npm run build

# Production запуск бэкенда
npm start

# Docker команды
npm run docker:build    # Собрать образы
npm run docker:up       # Запустить в Docker
npm run docker:down     # Остановить Docker
```

### 🔍 Проверка и отладка

```bash
# Проверка кода
npm run lint            # ESLint проверка
npm run lint:fix        # Исправить ESLint ошибки
npm run format          # Prettier форматирование

# Docker статус
docker compose ps       # Статус контейнеров
docker compose logs -f  # Логи всех сервисов
docker compose logs -f caddy  # Логи Caddy
```

### 🗄️ Работа с базой данных

```bash
# Подключение к PostgreSQL
docker compose exec postgres psql -U postgres starfinance

# SQL запросы из файла
docker compose exec -T postgres psql -U postgres starfinance < query.sql

# Просмотр таблиц
docker compose exec postgres psql -U postgres starfinance -c "\dt"
```

---

## 📚 Дополнительная документация

- **📖 Архитектура деплоя**: `docs/DEPLOYMENT_ARCHITECTURE.md`
- **🚀 Деплой на новый сервер**: `docs/NEW_SERVER_DEPLOY.md`
- **✅ Чек-лист деплоя**: `docs/DEPLOY_CHECKLIST.md`

---

## 🤝 Поддержка

Если возникнут вопросы по настройке домена/SSL, расширению функциональности или появятся проблемы с деплоем — создайте issue в репозитории или свяжитесь с командой разработки.

**📧 Контакты:**
- Техническая поддержка: hitsnruns@gmail.com
- Документация: `docs/` папка проекта
