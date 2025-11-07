param(
  [string]$ComposeFile = "docker-compose.yml",
  [switch]$RemoveVolumes
)

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  Write-Error "Docker не найден. Установите Docker Desktop и перезапустите терминал."
  exit 1
}

if (-not (Test-Path $ComposeFile)) {
  Write-Error "Файл compose не найден: $ComposeFile"
  exit 1
}

Write-Host "Останавливаю стек..."
if ($RemoveVolumes) {
  docker compose -f $ComposeFile down -v | Out-Host
} else {
  docker compose -f $ComposeFile down | Out-Host
}

Write-Host "Готово."
