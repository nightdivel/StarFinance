param(
  [string]$DbHost = "localhost",
  [int]$DbPort = 5432,
  [string]$Database = "starfinance",
  [string]$DbUser = "postgres",
  [string]$DbPassword = "postgres",
  [string]$SqlFile = "scripts/pg/init-db.sql",
  [switch]$UseDocker,
  [string]$ContainerName = "starfinance-postgres"
)

# Apply init SQL to PostgreSQL either via local psql or via docker exec

if (-not (Test-Path $SqlFile)) {
  Write-Error "SQL файл не найден: $SqlFile"
  exit 1
}

if ($UseDocker) {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    Write-Error "Docker не найден. Установите Docker Desktop или запустите без -UseDocker"
    exit 1
  }
  Write-Host "Применяю SQL внутри контейнера $ContainerName..."
  $escapedPath = (Resolve-Path $SqlFile).Path
  # Копируем файл внутрь контейнера и применяем
  docker cp $escapedPath "${ContainerName}:/init-db.sql" | Out-Null
  docker exec -e PGPASSWORD=$DbPassword $ContainerName psql -h 127.0.0.1 -U $DbUser -d $Database -f /init-db.sql | Out-Host
} else {
  $psql = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $psql) {
    Write-Error "psql не найден в PATH. Установите PostgreSQL client или используйте -UseDocker"
    exit 1
  }
  Write-Host "Применяю SQL через локальный psql..."
  $env:PGPASSWORD = $DbPassword
  & psql -h $DbHost -p $DbPort -U $DbUser -d $Database -f $SqlFile | Out-Host
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host "Done."
