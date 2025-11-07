# Star Finance — продакшн-развёртывание и инструкция

Веб-приложение управления финансами и складом (React + Ant Design + Node.js/Express). Поддерживает локальную авторизацию и OAuth2 через Discord с маппингом ролей гильдии.

## Содержание

- **Структура проекта**
- **Переменные окружения**
- **Локальный запуск (Dev)**
- **Продакшн через Docker + Nginx (Интернет-доступ)**
- **Настройка Discord OAuth2**
- **Резервное копирование (бэкапы)**
- **Заметки по чистому коду и изменениям**

---

## Структура проекта

```
.
├─ backend/                 # Express-сервер, API, OAuth2 Discord
│  ├─ .env                  # Переменные окружения бэкенда (секреты)
│  ├─ server.js             # Входной файл сервера
│  ├─ config/serverConfig.js# Загрузка env из backend/.env
│  ├─ middleware/auth.js    # JWT и проверка прав
│  └─ data/starFinance.json # Хранилище данных (инициализируется автоматически)
├─ frontend/                # Vite + React (Ant Design)
│  ├─ .env                  # VITE_* переменные (без секретов)
│  └─ src/
├─ Dockerfile               # Образ приложения (сборка фронта, запуск бэка)
├─ docker-compose.yml       # Сервисы: app и nginx
├─ nginx.conf               # Реверс-прокси для доступа из интернета
└─ README.md                # Этот файл
```

---

## Переменные окружения

Переменные окружения разделены: фронт и бэк. Секреты — только в `backend/.env`.

`backend/.env` (пример):

```
PORT=3000
HOST=0.0.0.0
BASE_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173

# Discord OAuth (секреты)
DISCORD_CLIENT_ID=1419421881739640842
DISCORD_CLIENT_SECRET=xxxxxx
DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback

# JWT
JWT_SECRET=change-me
TOKEN_EXPIRY=24h
```

`frontend/.env` (пример):

```
VITE_APP_TITLE=BLSK Star Finance
VITE_API_BASE_URL=http://localhost:3000
# Опционально: только как локальный фолбэк
VITE_ENABLE_DISCORD_AUTH=false
```

Важно: бэкенд явно грузит переменные из `backend/.env` (см. `backend/config/serverConfig.js`).

---

## Локальный запуск (Dev)

Требования: Node.js 18+

```
npm install
npm run dev
```

Скрипт запустит:

- бэкенд на `http://localhost:3000`
- фронтенд на `http://localhost:5173`

Войти в систему: логин `admin`, пароль `admin`.

---

## Продакшн через Docker + Nginx (Интернет-доступ)

1. Подготовить файлы:

- Указать реальные значения в `backend/.env` (включая Discord OAuth и домен в `FRONTEND_URL`).
- Опционально положить SSL-сертификаты в `./ssl` (`fullchain.pem`, `privkey.pem`) и раскомментировать HTTPS-блок в `nginx.conf`.
- Публичный адрес приложения: `https://korjeek.ru/economy/` (публикация под поддиректорией `/economy`).
  - В `docker-compose.yml` проброс портов `8080:3000` для сервиса `app`.
  - В `backend/.env` или `docker-compose.yml` установите `FRONTEND_URL=https://korjeek.ru/economy`.
   - В `docker-compose.yml` проброс портов `8080:3000` для сервиса `app`.
   - В `backend/.env` или `docker-compose.yml` установите `FRONTEND_URL=https://korjeek.ru/economy`.

2. Собрать и поднять:

```
npm run docker:build
npm run docker:up
```

Сервисы:

- `app` — Node.js-приложение (порт 3000 внутри контейнера).
- `nginx` — реверс-прокси (порт 80/443 на хосте).
 - Публикация под путём `/economy` на домене `korjeek.ru` (см. `nginx.conf`).

3. Пробросить домен:

- Настройте DNS A-запись на ваш сервер.

- `000_all.sql` — базовая схема и сиды (учётные записи, справочники, валюты, финансы, настройки).
- `001_stage1.sql` — нормализация (учётные записи, настройки, Discord таблицы v1).
- `002_stage2.sql` — справочники и сущности склада/витрины/финансов.
- `003_add_theme_preference.sql` — поле `users.theme_preference`.
- `003_showcase_and_warehouse.sql` — права `showcase`, словарь `warehouse_types`, поля владельца/типа склада.
- `004_user_layouts_and_discord_scopes.sql` — таблицы `user_layouts`, `discord_scopes`, `discord_scope_mappings`.

Полезно: для разработки можно поднять только БД

```
npm run dev:db      # поднять postgres (порт 5433 на хосте)
npm run dev:stop:db # остановить postgres
npm run dev:down    # удалить контейнеры postgres
```

Примечание: значения портов/URL по умолчанию согласованы — сервер слушает `:3000` (см. `backend/config/serverConfig.js`), фронтенд в dev на `:5173`.

## Настройка Discord OAuth2

1. В Discord Developer Portal:

- Создайте приложение, включите OAuth2.
- Добавьте Redirect URI: `http://<ваш_домен>/auth/discord/callback` (для локали — `http://localhost:3000/auth/discord/callback`).
- Выдайте права (Scopes): `identify`, `email`, `guilds.members.read`.

2. В админке приложения (Настройки → Системные параметры):

- Включите «Авторизация через Discord».
- Заполните `Client ID`, `Client Secret`, `Redirect URI` и нажмите «Сохранить».
  - Значения сохранятся в `data/system.discord` и продублируются в `backend/.env`.
- Для маппинга по ролям:
  - Источник: `member`
  - Атрибут: `roles`
  - Значение: `<role_id>`
  - Guild ID: `<guild_id>`

---

## Заметки по чистому коду и изменениям

- Удалены неиспользуемые импорты в `frontend/src/components/Settings/Settings.jsx`.
- Защита от затирания пустыми значениями при сохранении Discord-параметров:
  - Фронтенд `saveSystemSettings()` мержит payload с текущими значениями формы.
  - Бэкенд `PUT /api/system/discord` сохраняет существующие значения, если пришли пустые строки.
- Валидация `/auth/discord`: при отсутствии `clientId`/`redirectUri` возвращает понятное `400` JSON, а не редирект с ошибкой.
- Логи запросов выполняются после парсинга тела (`express.json()`), чтобы `req.body` был заполнен.
- Инициализация `data/starFinance.json`: при пустом/битом файле автоматически перезаписывается корректной структурой.
- UI маппинга Discord: добавлена подсказка по `guilds.members.read` и обязательность `Guild ID` при `source=member`.

---

## Полезные команды

```
# Dev
npm run dev

# Build только фронтенда
npm run build

# Docker
npm run docker:build
npm run docker:up
npm run docker:down
```

---

Если возникнут вопросы по настройке домена/SSL или расширению функциональности — напишите.
