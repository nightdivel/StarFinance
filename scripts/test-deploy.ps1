# Тестовый скрипт деплоя для проверки
Write-Host "=== Тест деплоя ===" -ForegroundColor Green

Write-Host "Переходим в директорию проекта..." -ForegroundColor Yellow
cd c:\StarFinanceProject\StarFinance_v2

Write-Host "Проверяем Git статус..." -ForegroundColor Yellow
git status

Write-Host "Выкачиваем изменения..." -ForegroundColor Yellow
git fetch origin
git checkout main
git pull origin main

Write-Host "Останавливаем контейнеры..." -ForegroundColor Yellow
docker-compose down

Write-Host "Пересобираем..." -ForegroundColor Yellow
docker-compose build --no-cache

Write-Host "Запускаем..." -ForegroundColor Yellow
docker-compose up -d

Write-Host "=== Деплой завершен ===" -ForegroundColor Green

Write-Host "Проверяем статус контейнеров:" -ForegroundColor Cyan
docker-compose ps
