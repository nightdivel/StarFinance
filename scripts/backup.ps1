#Requires -Version 5.1
<#!
StarFinance backup script (Windows PowerShell)
- Dumps PostgreSQL database from the docker-compose service `postgres`
- Copies important configs and data into a timestamped folder under `backups/`
- Creates a ZIP archive of the backup folder
- Optionally prunes old backups (default keep last 14)

Usage:
  1) Ensure Docker Desktop is running and the stack is up (`docker compose up -d`).
  2) From project root or `scripts/` folder, run:
       powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1
  3) Result: `backups/<YYYY-MM-DD_HH-mm-ss>/` and `backups/<YYYY-MM-DD_HH-mm-ss>.zip`

Restore DB example:
  docker cp backups\<TS>\db\starfinance.dump postgres:/tmp/starfinance.dump
  docker exec -it postgres bash -lc "pg_restore -U postgres -d starfinance -c /tmp/starfinance.dump"
!#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-ProjectRoot {
    param(
        [string]$StartPath
    )
    $p = if ($StartPath) { Resolve-Path -LiteralPath $StartPath } else { (Get-Location).Path }
    # If running from scripts/, go one level up
    if (Test-Path (Join-Path $p 'docker-compose.yml')) { return $p }
    $up = Split-Path -Parent $p
    if ($up -and (Test-Path (Join-Path $up 'docker-compose.yml'))) { return $up }
    return $p
}

$ProjectRoot = Resolve-ProjectRoot -StartPath $PSScriptRoot
$Timestamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$BackupRoot = Join-Path $ProjectRoot 'backups'
$BackupDir  = Join-Path $BackupRoot $Timestamp
$DbDir      = Join-Path $BackupDir 'db'
$CfgDir     = Join-Path $BackupDir 'config'
$FilesDir   = Join-Path $BackupDir 'files'

Write-Host "Project root: $ProjectRoot"
New-Item -ItemType Directory -Force -Path $BackupDir, $DbDir, $CfgDir, $FilesDir | Out-Null

# Compose service/container names
$PgService   = 'postgres'    # from docker-compose.yml
$DbName      = 'starfinance' # from docker-compose.yml
$PgUser      = 'postgres'    # from docker-compose.yml
$DumpName    = 'starfinance.dump'
$DumpPath    = Join-Path $DbDir $DumpName

# 1) Database dump using pg_dump custom format (-F c)
try {
    Write-Host 'Creating PostgreSQL dump from container...' -ForegroundColor Cyan
    # Create dump inside container, then docker cp to host. Using bash -lc to ensure pg_dump is found and redirection works on Linux side.
    docker exec $PgService bash -lc "pg_dump -U $PgUser -d $DbName -F c -f /tmp/$DumpName"
    docker cp "$(
        $PgService
    ):/tmp/$DumpName" "$DumpPath"
    docker exec $PgService bash -lc "rm -f /tmp/$DumpName"
    Write-Host "DB dump saved to $DumpPath" -ForegroundColor Green
}
catch {
    Write-Warning "Failed to dump DB. Ensure the 'postgres' container is running. Error: $($_.Exception.Message)"
}

# 2) Copy configs and important files
try {
    Write-Host 'Copying configuration and assets...' -ForegroundColor Cyan
    # nginx.conf
    $nginxConf = Join-Path $ProjectRoot 'nginx.conf'
    if (Test-Path $nginxConf) { Copy-Item $nginxConf (Join-Path $CfgDir 'nginx.conf') -Force }

    # SSL folder (certs)
    $sslDir = Join-Path $ProjectRoot 'ssl'
    if (Test-Path $sslDir) { Copy-Item $sslDir (Join-Path $CfgDir 'ssl') -Recurse -Force }

    # Backend .env & configs
    $backendEnv = Join-Path $ProjectRoot 'backend\.env'
    if (Test-Path $backendEnv) { Copy-Item $backendEnv (Join-Path $CfgDir 'backend.env') -Force }

    $serverConfigJs = Join-Path $ProjectRoot 'backend\config\serverConfig.js'
    if (Test-Path $serverConfigJs) { Copy-Item $serverConfigJs (Join-Path $CfgDir 'serverConfig.js') -Force }

    # Backend migrations
    $migrationsDir = Join-Path $ProjectRoot 'backend\migrations'
    if (Test-Path $migrationsDir) { Copy-Item $migrationsDir (Join-Path $CfgDir 'migrations') -Recurse -Force }

    # Backend public auth background image(s)
    $authPublicDir = Join-Path $ProjectRoot 'backend\public'
    if (Test-Path $authPublicDir) {
        $bg = Get-ChildItem $authPublicDir -Filter 'auth-bg.*' -ErrorAction SilentlyContinue
        if ($bg) {
            New-Item -ItemType Directory -Force -Path (Join-Path $FilesDir 'auth-public') | Out-Null
            Copy-Item $bg.FullName (Join-Path $FilesDir 'auth-public') -Force
        }
    }

    # Backend data folder (JSON, etc.)
    $dataDir = Join-Path $ProjectRoot 'backend\data'
    if (Test-Path $dataDir) { Copy-Item $dataDir (Join-Path $FilesDir 'backend-data') -Recurse -Force }

    Write-Host 'Config and files copied.' -ForegroundColor Green
}
catch {
    Write-Warning "Failed to copy some configs/files: $($_.Exception.Message)"
}

# 3) Create a manifest file with brief metadata
$manifest = @{
    projectRoot = $ProjectRoot
    timestamp   = $Timestamp
    db = @{ service=$PgService; name=$DbName; user=$PgUser; dump=$DumpName }
    includes = @(
        'nginx.conf?','ssl/','backend/.env?','backend/config/serverConfig.js','backend/migrations/','backend/public/auth-bg.*','backend/data/'
    )
} | ConvertTo-Json -Depth 5
$manifest | Out-File -FilePath (Join-Path $BackupDir 'manifest.json') -Encoding UTF8 -Force

# 4) Create ZIP archive
try {
    $zipPath = Join-Path $BackupRoot ("$Timestamp.zip")
    Write-Host "Creating archive: $zipPath" -ForegroundColor Cyan
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($BackupDir, $zipPath)
    Write-Host 'Archive created.' -ForegroundColor Green
}
catch {
    Write-Warning "Failed to create ZIP: $($_.Exception.Message)"
}

# 5) Prune old backups (keep last N zips and dirs matching pattern)
$Keep = 14
try {
    Write-Host "Pruning old backups (keep $Keep)..." -ForegroundColor Cyan
    $items = Get-ChildItem $BackupRoot | Where-Object { $_.Name -match '^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})(\.zip)?$' }
    $ordered = $items | Sort-Object { $_.Name } -Descending
    $toRemove = $ordered | Select-Object -Skip ($Keep)
    foreach ($i in $toRemove) {
        try { Remove-Item $i.FullName -Recurse -Force } catch { Write-Warning "Failed to remove $($i.FullName): $($_.Exception.Message)" }
    }
    Write-Host 'Prune complete.' -ForegroundColor Green
}
catch {
    Write-Warning "Prune step failed: $($_.Exception.Message)"
}

Write-Host "Backup finished: $BackupDir" -ForegroundColor Green
