# Умный деплой StarFinance

## Обзор

Система умного деплоя позволяет обновлять только те сервисы, которые были затронуты изменениями в коде, вместо полного пересборки всех контейнеров.

## Как это работает

1. **Анализ изменений** - система определяет какие файлы изменились с последнего деплоя
2. **Определение затронутых сервисов** - на основе измененных файлов определяется список сервисов для обновления
3. **Селективная пересборка** - пересобираются только образы измененных сервисов
4. **Целевой перезапуск** - перезапускаются только необходимые контейнеры

## Способы использования

### 1. Автоматический деплой (GitHub Actions)

При каждом push в ветку `main` автоматически запускается умный деплой:

```yaml
# .github/workflows/smart-deploy.yml
```

### 2. Ручной деплой с принудительной пересборкой

В GitHub Actions можно запустить деплой вручную с опцией "Принудительно пересобрать все образы".

### 3. Локальный деплой

#### PowerShell (Windows):
```powershell
# Обычный деплой
.\scripts\smart-deploy.ps1

# Принудительная пересборка всех сервисов
.\scripts\smart-deploy.ps1 -Force
```

#### Bash (Linux):
```bash
# Обычный деплой
chmod +x scripts/smart-deploy.sh
./scripts/smart-deploy.sh
```

## Логика определения сервисов

### Изменения во Frontend (`frontend/*`, `*.jsx`, `*.js`, `*.css`, `*.html`)
- Обновляется сервис: `economy`

### Изменения в сервисах бэкенда:
- `backend/services/users/*` → `users`
- `backend/services/directories/*` → `directories`
- `backend/services/warehouse/*` → `warehouse`
- `backend/services/showcase/*` → `showcase`
- `backend/services/requests/*` → `requests`
- `backend/services/finance/*` → `finance`
- `backend/services/uex/*` → `uex`
- `backend/services/settings/*` → `settings`

### Общие файлы бэкенда:
- `backend/middleware/*`, `backend/config/*`, `backend/db.js`, `backend/package.json`
- Обновляются все бэкенд сервисы: `economy`, `users`, `directories`, `warehouse`, `showcase`, `requests`, `finance`, `uex`, `settings`

### Docker конфигурация:
- `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `Caddyfile`
- Обновляются все сервисы: `caddy` + все бэкенд сервисы

### Миграции базы данных:
- `backend/migrations/*`
- Обновляется сервис: `postgres`

## Преимущества

1. **Скорость** - деплой занимает значительно меньше времени
2. **Ресурсы** - не пересобираются ненужные образы
3. **Стабильность** - меньше риск затронуть работающие сервисы
4. **Эффективность** - обновляется только то, что действительно изменилось

## Откат изменений

Для отката изменений можно использовать предыдущий workflow:

```yaml
# .github/workflows/deploy.yml (старый вариант)
```

Или вручную:
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## Мониторинг

После каждого деплоя:
- Сохраняется хэш коммита в файле `.last_deploy_hash`
- В логах отображается список обновленных сервисов
- Проверяется состояние всех контейнеров

## Troubleshooting

### Если сервис не обновился
Проверьте логи:
```bash
docker-compose logs [имя_сервиса]
```

### Если нужно принудительно обновить все
Используйте флаг `-Force` в PowerShell или手动 запустите полный деплой.

### Если изменения не применились
Убедитесь, что файлы действительно изменены и отслеживаются Git:
```bash
git status
git diff
```
