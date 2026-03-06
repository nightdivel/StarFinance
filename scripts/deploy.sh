#!/bin/bash

# Deploy script for StarFinance project
# This script runs on the production server

set -e

APP_DIR="/var/www/starfinance"
REPO_URL="https://github.com/nightdivel/StarFinance.git"

echo ">>> Starting deployment..."

# Create directory if not exists
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Pull latest code
echo ">>> Pulling latest code..."
if [ -d .git ]; then
  git fetch origin
  git checkout -B main origin/main
  git pull origin main
else
  git clone "$REPO_URL" .
fi

echo ">>> Rebuilding and restarting services..."
# Stop existing containers
docker-compose down || true

# Build with no cache to ensure latest changes
docker-compose build --no-cache

# Start services
docker-compose up -d

# Wait for services to be healthy
echo ">>> Waiting for services to start..."
sleep 10

# Clean up old images and containers
echo ">>> Cleaning up old Docker resources..."
docker system prune -f

echo ">>> Deployment completed successfully!"
echo ">>> Services status:"
docker-compose ps
