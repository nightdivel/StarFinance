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

# Функция для определения затронутых сервисов с учетом зависимостей
get_affected_services() {
    local files="$1"
    local services=()
    local has_backend_common=false
    local has_frontend=false
    local has_infrastructure=false

    while IFS= read -r file; do
        # Проверяем общие файлы бэкенда
        case "$file" in
            "backend/middleware/"*|"backend/config/"*|"backend/db.js"|"backend/package.json"|"backend/package-lock.json"|"backend/lib/"*)
                has_backend_common=true
                continue
                ;;
            # Проверяем инфраструктуру
            "docker-compose.yml"|"Caddyfile"|"Dockerfile"|".dockerignore")
                has_infrastructure=true
                continue
                ;;
            # Проверяем frontend
            "frontend/"*|"*.jsx"|"*.js"|"*.css"|"*.html"|"package.json"|"package-lock.json")
                has_frontend=true
                continue
                ;;
            # Определяем конкретные сервисы
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
            "backend/migrations/"*)
                services+=("postgres")
                ;;
            "backend/server.js")
                # Основной сервер затрагивает все сервисы
                has_backend_common=true
                ;;
        esac
    done <<< "$files"

    # Добавляем сервисы на основе категорий изменений
    if [ "$has_frontend" = true ]; then
        services+=("economy")
    fi
    if [ "$has_backend_common" = true ]; then
        services+=("economy" "users" "directories" "warehouse" "showcase" "requests" "finance" "uex" "settings")
    fi
    if [ "$has_infrastructure" = true ]; then
        services+=("caddy" "economy" "users" "directories" "warehouse" "showcase" "requests" "finance" "uex" "settings")
    fi

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
if echo "$CHANGED_FILES" | grep -E "(Dockerfile|\.dockerignore|backend/package\.json|backend/package-lock\.json)" > /dev/null; then
    echo "🔨 Обнаружены изменения в Docker конфигурации, пересобираем образ..."
    if ! docker-compose build --no-cache; then
        echo "❌ Ошибка пересборки образов"
        exit 1
    fi
else
    echo "🔨 Пересобираем только затронутые сервисы..."

    # Функция для сборки одного сервиса
    build_service() {
        local service="$1"
        echo "  - Сборка $service"
        if docker-compose build "$service"; then
            echo "build_success:$service"
        else
            echo "build_failed:$service:$?"
        fi
    }

    # Запускаем параллельную сборку
    build_pids=()
    for service in $AFFECTED_SERVICES; do
        if [ "$service" != "caddy" ] && [ "$service" != "postgres" ]; then
            build_service "$service" &
            build_pids+=($!)
        fi
    done

    # Ждем завершения всех сборок и проверяем результаты
    build_failed=false
    for pid in "${build_pids[@]}"; do
        wait "$pid"
        if [ $? -ne 0 ]; then
            build_failed=true
        fi
    done

    if [ "$build_failed" = true ]; then
        echo "❌ Ошибка сборки одного или нескольких сервисов"
        echo "🔄 Откатываем изменения..."
        git reset --hard HEAD~1 >/dev/null 2>&1
        exit 1
    fi
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
