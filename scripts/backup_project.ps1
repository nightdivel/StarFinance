#Requires -Version 5.1
<#!
Полный бэкап проекта (исключая тяжёлые и производимые директории)
- Создаёт снепшот дерева проекта в backups/<TS>/project/
- Исключает: node_modules, dist, build, .next, .git, backups, coverage, .turbo, .cache
- Создаёт ZIP архивацию снепшота: backups/<TS>_project.zip
- Не требует Docker

Запуск из корня проекта:
  powershell -ExecutionPolicy Bypass -File .\scripts\backup_project.ps1
!#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-ProjectRoot {
    param([string]$StartPath)
    $p = if ($StartPath) { Resolve-Path -LiteralPath $StartPath } else { (Get-Location).Path }
    if (Test-Path (Join-Path $p 'docker-compose.yml')) { return $p }
    $up = Split-Path -Parent $p
    if ($up -and (Test-Path (Join-Path $up 'docker-compose.yml'))) { return $up }
    return $p
}

$ProjectRoot = Resolve-ProjectRoot -StartPath $PSScriptRoot
$Timestamp   = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$BackupRoot  = Join-Path $ProjectRoot 'backups'
$BackupDir   = Join-Path $BackupRoot $Timestamp
$StageDir    = Join-Path $BackupDir 'project'

Write-Host "Project root: $ProjectRoot"
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

# Список исключаемых директорий (по именам каталогов)
$ExcludeDirs = @(
    'node_modules','dist','build','.next','.git','backups','coverage','.turbo','.cache','.parcel-cache','.vite','out'
)

# Список исключаемых файлов/масок
$ExcludeFiles = @('Thumbs.db','*.log','*.tmp','*.cache')

# Robocopy для быстрого копирования со строгими исключениями
# /MIR зеркалирует структуру. Будьте внимательны: целевая папка — чистая staging-папка.
$rcArgs = @()
$rcArgs += @('"' + $ProjectRoot + '"', '"' + $StageDir + '"', '/MIR', '/R:1', '/W:1', '/NFL', '/NDL', '/NP', '/NJH', '/NJS')
if ($ExcludeDirs.Count -gt 0) { $rcArgs += @('/XD'); $rcArgs += $ExcludeDirs }
if ($ExcludeFiles.Count -gt 0) { $rcArgs += @('/XF'); $rcArgs += $ExcludeFiles }

Write-Host 'Creating project snapshot (excluding heavy/derived dirs)...' -ForegroundColor Cyan
$rcCmd = 'robocopy ' + ($rcArgs -join ' ')
Write-Host $rcCmd
$robocode = (Start-Process -FilePath 'robocopy.exe' -ArgumentList $rcArgs -Wait -PassThru).ExitCode
# Robocopy возвращает коды > 8 при ошибках; 1-7 — это вариации успеха/изменений
if ($robocode -ge 8) { throw "Robocopy failed with code $robocode" }

# Создание ZIP
try {
    $zipPath = Join-Path $BackupRoot ("$Timestamp`_project.zip")
    Write-Host "Creating archive: $zipPath" -ForegroundColor Cyan
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($StageDir, $zipPath)
    Write-Host 'Archive created.' -ForegroundColor Green
}
catch {
    Write-Warning "Failed to create ZIP: $($_.Exception.Message)"
}

Write-Host "Full project backup finished: $StageDir" -ForegroundColor Green
