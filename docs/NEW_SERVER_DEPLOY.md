# Star Finance — Как поставить на новый сервер (реальный пошаговый деплой)

Ниже описан "чистый" сценарий установки на новый VPS/сервер из Git с публикацией приложения под URL `https://<domain>/economy/`.

## 1) Требования к серверу

- Linux сервер с публичным IP.
- Открыты входящие порты:
  - 80/tcp
  - 443/tcp
- Установлены:
  - `git`
  - `docker`
  - `docker-compose`

## 2) DNS

У DNS-провайдера (регистратор/Cloudflare и т.п.) создай запись:

- `A`:
  - `blsk.fin-tech.com` -> `<PUBLIC_SERVER_IP>`

Если используешь поддомен, укажи его:
- `A`:
  - `starfinance.yourdomain.co` -> `<PUBLIC_SERVER_IP>`

После изменения DNS дождись обновления (обычно 1–30 минут).

## 3) Клонирование репозитория

На сервере:

```bash
git clone <REPO_URL> starfinance
cd starfinance
```

## 4) Подготовка переменных окружения

В корне проекта есть шаблон `.env.example`. На сервере создай `.env`:

```bash
cp .env.example .env
```

Заполни минимум:

- `DOMAIN=<domain>`
- `EMAIL=<your-email>` (для Let's Encrypt)
- `FRONTEND_URL=https://<domain>/economy`
- `DISCORD_REDIRECT_URI=https://<domain>/economy/auth/discord/callback`

И секреты (если используешь Discord OAuth и JWT):

- `DISCORD_CLIENT_ID=...`
- `DISCORD_CLIENT_SECRET=...`
- `JWT_SECRET=...` (обязательно свой длинный случайный секрет)

## 5) Запуск контейнеров

Сборка и старт:

```bash
docker-compose up -d --build
```

Проверка статуса:

```bash
docker-compose ps
```

Логи Caddy (удобно для диагностики сертификатов):

```bash
docker-compose logs -f caddy
```

## 6) Проверка работоспособности

- Открыть в браузере:
  - `https://<domain>/economy/`

- Проверить редирект с корня:
  - `https://<domain>/` -> `https://<domain>/economy/`

## 7) Discord OAuth (если включено)

В Discord Developer Portal добавь Redirect URI:

- `https://<domain>/economy/auth/discord/callback`

Если этот шаг пропустить, вход через Discord работать не будет.

## 8) Доступ к базе данных (если нужен)

По умолчанию Postgres проброшен на хост:

- `localhost:5433` (на сервере)

Подключение, например:

```bash
docker-compose exec -T postgres psql -U postgres starfinance
```

## 9) Обновление (redeploy)

Самый простой безопасный сценарий:

```bash
git pull

docker-compose down

docker-compose up -d --build
```

Если используешь GitHub Actions / smart-deploy — см. `docs/SMART_DEPLOY.md`.
