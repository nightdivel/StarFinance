param(
  [string]$DbHost = "localhost",
  [int]$DbPort = 5432,
  [string]$Database = "starfinance",
  [string]$DbUser = "postgres",
  [System.Security.SecureString]$DbPassword,
  [string]$SqlFile = "scripts/pg/init-db.sql",
  [switch]$UseDocker,
  [string]$ContainerName = "starfinance-postgres"
)

function Get-PlainText {
  param([Parameter(Mandatory=$true)][System.Security.SecureString]$Secure)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally {
    if ($bstr -ne [System.IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
}

if (-not $DbPassword) {
  $DbPassword = Read-Host "Введите пароль пользователя $DbUser" -AsSecureString
}

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
  $plain = Get-PlainText -Secure $DbPassword
  docker exec -e PGPASSWORD=$plain $ContainerName psql -h 127.0.0.1 -U $DbUser -d $Database -f /init-db.sql | Out-Host
  $plain = $null
} else {
  $psql = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $psql) {
    Write-Error "psql не найден в PATH. Установите PostgreSQL client или используйте -UseDocker"
    exit 1
  }
  Write-Host "Применяю SQL через локальный psql..."
  $plain = Get-PlainText -Secure $DbPassword
  $env:PGPASSWORD = $plain
  & psql -h $DbHost -p $DbPort -U $DbUser -d $Database -f $SqlFile | Out-Host
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  $plain = $null
}

Write-Host "Done."
