#!/bin/bash

# Скрипт умного деплоя - обновляет только измененные сервисы

set -e

PROJECT_DIR="/c/StarFinanceProject/StarFinance_v2"
cd "$PROJECT_DIR"

echo "🚀 Начинаем умный деплой..."

# Получаем список измененных файлов с последнего деплоя
if [ -f ".last_deploy_hash" ]; then
    LAST_HASH=$(cat .last_deploy_hash)
    echo "📝 Последний деплой был с коммита: $LAST_HASH"
    CHANGED_FILES=$(git diff --name-only "$LAST_HASH" HEAD)
else
    echo "📝 Первый деплой или не найден хэш последнего деплоя"
    CHANGED_FILES=$(git ls-files)
fi

if [ -z "$CHANGED_FILES" ]; then
    echo "✅ Нет изменений для деплоя"
    exit 0
fi

echo "📋 Измененные файлы:"
echo "$CHANGED_FILES"

# Функция для определения затронутых сервисов
get_affected_services() {
    local files="$1"
    local services=()
    
    while IFS= read -r file; do
        case "$file" in
            "frontend/"*|"*.jsx"|"*.js"|"*.css"|"*.html")
                services+=("economy") # Frontend часть в economy сервисе
                ;;
            "backend/services/users/"*)
                services+=("users")
                ;;
            "backend/services/directories/"*)
                services+=("directories")
                ;;
            "backend/services/warehouse/"*)
                services+=("warehouse")
                ;;
            "backend/services/showcase/"*)
                services+=("showcase")
                ;;
            "backend/services/requests/"*)
                services+=("requests")
                ;;
            "backend/services/finance/"*)
                services+=("finance")
                ;;
            "backend/services/uex/"*)
                services+=("uex")
                ;;
            "backend/services/settings/"*)
                services+=("settings")
                ;;
            "backend/middleware/"*|"backend/config/"*|"backend/db.js"|"backend/package.json"|"Dockerfile"|".dockerignore")
                # Общие файлы бэкенда - затрагивают все сервисы
                services+=("economy" "users" "directories" "warehouse" "showcase" "requests" "finance" "uex" "settings")
                ;;
            "docker-compose.yml"|"Caddyfile")
                services+=("caddy" "economy" "users" "directories" "warehouse" "showcase" "requests" "finance" "uex" "settings")
                ;;
            "backend/migrations/"*)
                services+=("postgres")
                ;;
        esac
    done <<< "$files"
    
    # Удаляем дубликаты и возвращаем уникальные сервисы
    printf '%s\n' "${services[@]}" | sort -u
}

# Получаем список затронутых сервисов
AFFECTED_SERVICES=$(get_affected_services "$CHANGED_FILES")

if [ -z "$AFFECTED_SERVICES" ]; then
    echo "✅ Изменения не затрагивают сервисы, требующие перезапуска"
    # Сохраняем хэш текущего коммита
    git rev-parse HEAD > .last_deploy_hash
    exit 0
fi

echo "🔄 Затронутые сервисы:"
echo "$AFFECTED_SERVICES"

# Пересобираем образ если изменились файлы Dockerfile или общие файлы бэкенда
if echo "$CHANGED_FILES" | grep -E "(Dockerfile|\.dockerignore|backend/package\.json)" > /dev/null; then
    echo "🔨 Обнаружены изменения в Docker конфигурации, пересобираем образ..."
    docker-compose build --no-cache
else
    echo "🔨 Пересобираем только затронутые сервисы..."
    # Пересобираем образ для затронутых сервисов
    for service in $AFFECTED_SERVICES; do
        if [ "$service" != "caddy" ] && [ "$service" != "postgres" ]; then
            echo "  - Пересборка $service"
            docker-compose build "$service"
        fi
    done
fi

# Перезапускаем только затронутые сервисы
echo "🔄 Перезапускаем затронутые сервисы..."
for service in $AFFECTED_SERVICES; do
    echo "  - Перезапуск $service"
    docker-compose up -d "$service"
    
    # Ждем запуска сервиса (кроме caddy и postgres)
    if [ "$service" != "caddy" ] && [ "$service" != "postgres" ]; then
        echo "  - Ожидание запуска $service..."
        sleep 10
    fi
done

# Если затронут postgres, применяем миграции
if echo "$AFFECTED_SERVICES" | grep -q "postgres"; then
    echo "🗄️ Применяем миграции базы данных..."
    docker-compose exec postgres psql -U postgres -d starfinance -c "SELECT 1;" > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "✅ База данных доступна"
    else
        echo "❌ Ошибка подключения к базе данных"
        exit 1
    fi
fi

# Проверяем состояние сервисов
echo "🔍 Проверяем состояние сервисов..."
docker-compose ps

# Очищаем старые образы (только если не было ошибок)
echo "🧹 Очищаем старые образы..."
docker system prune -f

# Сохраняем хэш текущего коммита
git rev-parse HEAD > .last_deploy_hash

echo "✅ Деплой успешно завершен!"
echo "📊 Обновлены сервисы: $AFFECTED_SERVICES"
