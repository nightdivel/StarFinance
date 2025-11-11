param(
  [string]$ServerHost = "77.91.126.52",
  [string]$ServerUser = "korjeek",
  [int]$Port = 22,
  [string]$RepoUrl = "https://github.com/nightdivel/StarFinance.git",
  [string]$AppDir = "/var/www/economy",
  [string]$KeyPath = "",
  [string]$StrictHostKeyChecking = "no"
)

Write-Host "Deploying to $($ServerUser)@$($ServerHost):$Port" -ForegroundColor Cyan

$remoteScript = @"
set -e

APP_DIR="$AppDir"
REPO_URL="$RepoUrl"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed on the server. Please install Docker and Docker Compose v2." >&2
  exit 1
fi

mkdir -p "$APP_DIR"
cd "$APP_DIR"

echo ">>> Pulling latest code..."
if [ -d .git ]; then
  git fetch origin
  git checkout -B main origin/main
else
  git clone "$REPO_URL" .
fi

echo ">>> Rebuilding and restarting Docker container..."
if docker compose version >/dev/null 2>&1; then
  docker compose down || true
  docker compose build
  docker compose up -d
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose down || true
  docker-compose build
  docker-compose up -d
else
  echo "Neither 'docker compose' nor 'docker-compose' found." >&2
  exit 1
fi

echo ">>> Pruning old Docker images..."
docker image prune -f || true

echo ">>> Deployment successful!"
"@

# Pipe the script into ssh and execute via bash -s
try {
  $sshArgs = @()
  $sshArgs += @("-p", $Port)
  if ($StrictHostKeyChecking) { $sshArgs += @("-o", "StrictHostKeyChecking=$StrictHostKeyChecking") }
  if ($KeyPath) { $sshArgs += @("-i", $KeyPath) }
  $sshArgs += @("$ServerUser@$ServerHost", "bash -s")
  $remoteScript | ssh @sshArgs
  if ($LASTEXITCODE -ne 0) { throw "Remote deploy failed with exit code $LASTEXITCODE" }
  Write-Host "Done." -ForegroundColor Green
}
catch {
  Write-Error $_
  exit 1
}
