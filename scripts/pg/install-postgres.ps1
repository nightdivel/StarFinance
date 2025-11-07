param(
  [string]$Version = "15",
  [switch]$UseDocker
)

# Requires: Windows PowerShell, Admin privileges for winget/choco install
# Usage examples:
#   .\install-postgres.ps1                # Install native PostgreSQL 15 via winget if available
#   .\install-postgres.ps1 -Version 16    # Install a specific version
#   .\install-postgres.ps1 -UseDocker     # Pull and run postgres in Docker

function Ensure-Admin {
  $currentUser = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $currentUser.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Error "Запустите PowerShell от имени администратора."
    exit 1
  }
}

function Install-Postgres-Native {
  # Try winget first
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Host "Устанавливаю PostgreSQL через winget..."
    # Winget identifiers vary; use keyword search
    winget install -e --id PostgreSQL.PostgreSQL --source winget --accept-package-agreements --accept-source-agreements | Out-Host
    return
  }
  # Fallback: chocolatey
  $choco = Get-Command choco -ErrorAction SilentlyContinue
  if ($choco) {
    Write-Host "Устанавливаю PostgreSQL через chocolatey..."
    choco install postgresql --version=$Version -y | Out-Host
    return
  }
  Write-Warning "winget/choco не найдены. Установите PostgreSQL вручную или используйте флаг -UseDocker"
}

function Install-Postgres-Docker {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    Write-Error "Docker не найден. Установите Docker Desktop или запустите без -UseDocker"
    exit 1
  }
  Write-Host "Запускаю контейнер postgres:$Version..."
  docker run -d --name starfinance-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=starfinance -p 5433:5432 -v starfinance_pgdata:/var/lib/postgresql/data postgres:$Version | Out-Host
}

if ($UseDocker) {
  Install-Postgres-Docker
} else {
  Ensure-Admin
  Install-Postgres-Native
}

Write-Host "Done. Check connectivity with: psql -h localhost -U postgres -d postgres"
