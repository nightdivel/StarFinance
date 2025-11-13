param(
  [switch]$NoSeed,
  [string]$PgUser = "postgres",
  [string]$PgDatabase = "starfinance",
  [string]$ComposeFile = "docker-compose.yml"
)

# Ensure Docker CLI is available
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  Write-Error "Docker не найден. Установите Docker Desktop и перезапустите терминал."
  exit 1
}

# Ensure docker compose v2 is available
try {
  docker compose version | Out-Null
} catch {
  Write-Error "Docker Compose v2 не найден (docker compose). Обновите Docker Desktop."
  exit 1
}

# Build and start stack
if (-not (Test-Path $ComposeFile)) {
  Write-Error "Файл compose не найден: $ComposeFile"
  exit 1
}

Write-Host "Собираю образы..."
 docker compose -f $ComposeFile build | Out-Host

Write-Host "Поднимаю сервисы в фоне..."
 docker compose -f $ComposeFile up -d | Out-Host

# Get postgres container id
$pgId = (docker compose -f $ComposeFile ps -q postgres).Trim()
if (-not $pgId) {
  Write-Warning "Не удалось определить контейнер postgres через docker compose."
  $pgId = (docker ps --filter "name=postgres" --format "{{.ID}}" | Select-Object -First 1).Trim()
}
if (-not $pgId) {
  Write-Error "Контейнер postgres не найден. Проверьте docker compose ps."
  exit 1
}

# Wait for PostgreSQL readiness
Write-Host "Ожидаю готовность PostgreSQL..."
$maxAttempts = 30
$attempt = 0
$ready = $false
while ($attempt -lt $maxAttempts -and -not $ready) {
  $attempt++
  $status = docker exec $pgId pg_isready -U $PgUser -d $PgDatabase -h 127.0.0.1 2>$null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  Write-Error "PostgreSQL не готов после ожидания. Проверьте логи контейнера: docker logs $pgId"
  exit 1
}

# Ensure app_state table exists via temp SQL file
Write-Host "Проверяю/создаю таблицу app_state..."
$ddlContent = @"
CREATE TABLE IF NOT EXISTS app_state (
  id SMALLINT PRIMARY KEY,
  data JSONB NOT NULL
);
INSERT INTO app_state (id, data)
VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
"@

  $ddlPath = Join-Path $env:TEMP "init_app_state.sql"
  Set-Content -Path $ddlPath -Value $ddlContent -Encoding UTF8
  docker cp $ddlPath "${pgId}:/init_app_state.sql" | Out-Null
  docker exec -i ${pgId} psql -U $PgUser -d $PgDatabase -v ON_ERROR_STOP=1 -f /init_app_state.sql | Out-Host

if (-not $NoSeed) {
  # Check current data value
  $current = docker exec -i ${pgId} psql -U $PgUser -d $PgDatabase -t -A -c "SELECT data::text FROM app_state WHERE id=1;"
  $currentText = ($current | ForEach-Object { $_.Trim() })
  if (-not $currentText -or $currentText -eq '{}' -or $currentText -eq '') { $needSeed = $true }

  $seedPath = Join-Path $PSScriptRoot "..\..\backend\data\starFinance.json"
  if ($needSeed -and (Test-Path $seedPath)) {
    Write-Host "Импортирую начальные данные из backend/data/starFinance.json в app_state..."
    $json = Get-Content -Raw -Path $seedPath -Encoding UTF8
    # Escape single quotes for SQL literal
    $jsonEsc = $json -replace "'", "''"
    $updateContent = "UPDATE app_state SET data = '$jsonEsc'::jsonb WHERE id = 1;"
    $updatePath = Join-Path $env:TEMP "seed_app_state.sql"
    Set-Content -Path $updatePath -Value $updateContent -Encoding UTF8
    docker cp $updatePath "${pgId}:/seed_app_state.sql" | Out-Null
    docker exec -i $pgId psql -U $PgUser -d $PgDatabase -v ON_ERROR_STOP=1 -f /seed_app_state.sql | Out-Host
  } else {
    Write-Host "Сидинг пропущен (NoSeed=$NoSeed, данные уже присутствуют или файл не найден)."
  }
}

# Show status
Write-Host "Контейнеры:"; docker compose -f $ComposeFile ps | Out-Host
Write-Host "Проверка доступа к БД:"; docker exec -it $pgId psql -U $PgUser -d $PgDatabase -c "SELECT jsonb_object_keys(data) FROM app_state WHERE id=1;" | Out-Host

Write-Host "Готово. Приложение доступно через Nginx на http://localhost (если поднят сервис nginx в compose)."
