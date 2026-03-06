# Скрипт для исправления SSH конфигурации
# Запускать от имени администратора

Write-Host "Исправление SSH конфигурации..." -ForegroundColor Green

# Читаем конфиг
$configPath = "$env:ProgramData\ssh\sshd_config"
$config = Get-Content $configPath

# Раскомментируем PubkeyAuthentication
$config = $config -replace '#PubkeyAuthentication yes', 'PubkeyAuthentication yes'

# Записываем обратно
$config | Set-Content $configPath

Write-Host "PubkeyAuthentication включен" -ForegroundColor Green

# Перезапускаем SSH сервис
Restart-Service sshd -Force
Write-Host "SSH сервис перезапущен" -ForegroundColor Green

# Проверяем
Get-Content $configPath | Select-String PubkeyAuthentication

Write-Host "Готово! Теперь попробуйте запустить воркфлоу." -ForegroundColor Green
