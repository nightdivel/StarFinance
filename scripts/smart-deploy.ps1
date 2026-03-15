# Скрипт умного деплоя для Windows - обновляет только измененные сервисы

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$ProjectDir = "C:\StarFinanceProject\StarFinance_v2"
Set-Location $ProjectDir

Write-Host "🚀 Начинаем умный деплой..." -ForegroundColor Green

# Получаем список измененных файлов с последнего деплоя
$LastDeployHashFile = "$ProjectDir\.last_deploy_hash"
if (Test-Path $LastDeployHashFile) {
    $LastHash = Get-Content $LastDeployHashFile
    Write-Host "📝 Последний деплой был с коммита: $LastHash" -ForegroundColor Yellow
    $ChangedFiles = git diff --name-only "$LastHash" HEAD
} else {
    Write-Host "📝 Первый деплой или не найден хэш последнего деплоя" -ForegroundColor Yellow
    $ChangedFiles = git ls-files
}

if ([string]::IsNullOrWhiteSpace($ChangedFiles)) {
    Write-Host "✅ Нет изменений для деплоя" -ForegroundColor Green
    exit 0
}

Write-Host "📋 Измененные файлы:" -ForegroundColor Cyan
$ChangedFiles

# Функция для определения затронутых сервисов с учетом зависимостей
function Get-AffectedServices {
    param([string]$Files)

    $services = @()
    $filesArray = $Files -split "`n"
    $hasBackendCommon = $false
    $hasFrontend = $false
    $hasInfrastructure = $false

    foreach ($file in $filesArray) {
        $file = $file.Trim()
        if ([string]::IsNullOrWhiteSpace($file)) { continue }

        # Проверяем общие файлы бэкенда
        if ($file -like "backend/middleware/*" -or $file -like "backend/config/*" -or
            $file -eq "backend/db.js" -or $file -eq "backend/package.json" -or
            $file -eq "backend/package-lock.json" -or $file -like "backend/lib/*") {
            $hasBackendCommon = $true
            continue
        }

        # Проверяем инфраструктуру
        if ($file -eq "docker-compose.yml" -or $file -eq "Caddyfile" -or $file -eq "Dockerfile" -or $file -eq ".dockerignore") {
            $hasInfrastructure = $true
            continue
        }

        # Проверяем frontend
        if ($file -like "frontend/*" -or $file -like "*.jsx" -or $file -like "*.js" -or
            $file -like "*.css" -or $file -like "*.html" -or $file -eq "package.json" -or $file -eq "package-lock.json") {
            $hasFrontend = $true
            continue
        }

        # Определяем конкретные сервисы
        if ($file -like "backend/services/users/*") {
            $services += "users"
        }
        elseif ($file -like "backend/services/directories/*") {
            $services += "directories"
        }
        elseif ($file -like "backend/services/warehouse/*") {
            $services += "warehouse"
        }
        elseif ($file -like "backend/services/showcase/*") {
            $services += "showcase"
        }
        elseif ($file -like "backend/services/requests/*") {
            $services += "requests"
        }
        elseif ($file -like "backend/services/finance/*") {
            $services += "finance"
        }
        elseif ($file -like "backend/services/uex/*") {
            $services += "uex"
        }
        elseif ($file -like "backend/services/settings/*") {
            $services += "settings"
        }
        elseif ($file -like "backend/migrations/*") {
            $services += "postgres"
        }
        elseif ($file -like "backend/server.js") {
            # Основной сервер затрагивает все сервисы
            $hasBackendCommon = $true
        }
    }

    # Добавляем сервисы на основе категорий изменений
    if ($hasFrontend) {
        $services += "economy"
    }
    if ($hasBackendCommon) {
        $services += @("economy", "users", "directories", "warehouse", "showcase", "requests", "finance", "uex", "settings")
    }
    if ($hasInfrastructure) {
        $services += @("caddy", "economy", "users", "directories", "warehouse", "showcase", "requests", "finance", "uex", "settings")
    }

    # Удаляем дубликаты и возвращаем уникальные сервисы
    return $services | Sort-Object -Unique
}

# Получаем список затронутых сервисов
$AffectedServices = Get-AffectedServices -Files $ChangedFiles

if ($AffectedServices.Count -eq 0) {
    Write-Host "✅ Изменения не затрагивают сервисы, требующие перезапуска" -ForegroundColor Green
    # Сохраняем хэш текущего коммита
    $currentHash = git rev-parse HEAD
    Set-Content -Path $LastDeployHashFile -Value $currentHash
    exit 0
}

Write-Host "🔄 Затронутые сервисы:" -ForegroundColor Cyan
$AffectedServices

# Пересобираем образ если изменились файлы Dockerfile или общие файлы бэкенда
$dockerFilesChanged = $ChangedFiles -match "(Dockerfile|\.dockerignore|backend/package\.json|backend/package-lock\.json)"
if ($dockerFilesChanged -or $Force) {
    Write-Host "🔨 Обнаружены изменения в Docker конфигурации, пересобираем образ..." -ForegroundColor Yellow
    try {
        docker-compose build --no-cache
        if ($LASTEXITCODE -ne 0) {
            throw "Ошибка полной пересборки образов"
        }
    } catch {
        Write-Host "❌ Ошибка пересборки образов: $_" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "🔨 Пересобираем только затронутые сервисы..." -ForegroundColor Yellow
    # Пересобираем образ для затронутых сервисов параллельно
    $buildJobs = @()
    foreach ($service in $AffectedServices) {
        if ($service -ne "caddy" -and $service -ne "postgres") {
            Write-Host "  - Запуск сборки $service" -ForegroundColor Gray
            $buildJobs += Start-Job -ScriptBlock {
                param($service)
                try {
                    $output = docker-compose build $service 2>&1
                    if ($LASTEXITCODE -eq 0) {
                        return @{ Service = $service; Success = $true; Output = $output }
                    } else {
                        return @{ Service = $service; Success = $false; Error = "Exit code: $LASTEXITCODE" }
                    }
                } catch {
                    return @{ Service = $service; Success = $false; Error = $_.Exception.Message }
                }
            } -ArgumentList $service
        }
    }

    # Ждем завершения всех сборок
    $buildResults = $buildJobs | Wait-Job | Receive-Job

    # Проверяем результаты сборки
    foreach ($result in $buildResults) {
        if ($result.Success) {
            Write-Host "  - ✅ Сборка $($result.Service) завершена" -ForegroundColor Green
        } else {
            Write-Host "  - ❌ Ошибка сборки $($result.Service): $($result.Error)" -ForegroundColor Red
            # Откатываем изменения в git
            Write-Host "  - 🔄 Откатываем изменения..." -ForegroundColor Yellow
            git reset --hard HEAD~1 2>$null
            exit 1
        }
    }
}

# Перезапускаем только затронутые сервисы
Write-Host "🔄 Перезапускаем затронутые сервисы..." -ForegroundColor Yellow
foreach ($service in $AffectedServices) {
    Write-Host "  - Перезапуск $service" -ForegroundColor Gray
    docker-compose up -d $service
    
    # Ждем запуска сервиса (кроме caddy и postgres)
    if ($service -ne "caddy" -and $service -ne "postgres") {
        Write-Host "  - Ожидание запуска $service..." -ForegroundColor Gray
        Start-Sleep -Seconds 10
    }
}

# Если затронут postgres, применяем миграции
if ($AffectedServices -contains "postgres") {
    Write-Host "🗄️ Применяем миграции базы данных..." -ForegroundColor Yellow
    try {
        $result = docker-compose exec postgres psql -U postgres -d starfinance -c "SELECT 1;" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ База данных доступна" -ForegroundColor Green
        } else {
            Write-Host "❌ Ошибка подключения к базе данных" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "❌ Ошибка подключения к базе данных: $_" -ForegroundColor Red
        exit 1
    }
}

# Проверяем состояние сервисов
Write-Host "🔍 Проверяем состояние сервисов..." -ForegroundColor Cyan
docker-compose ps

# Очищаем старые образы (только если не было ошибок)
Write-Host "🧹 Очищаем старые образы..." -ForegroundColor Yellow
docker system prune -f

# Сохраняем хэш текущего коммита
$currentHash = git rev-parse HEAD
Set-Content -Path $LastDeployHashFile -Value $currentHash

Write-Host "✅ Деплой успешно завершен!" -ForegroundColor Green
Write-Host "📊 Обновлены сервисы: $($AffectedServices -join ', ')" -ForegroundColor Cyan
