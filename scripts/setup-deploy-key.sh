#!/bin/bash

# Скрипт для создания SSH ключа для GitHub Actions на сервере
# Запускать на сервере: bash setup-deploy-key.sh

echo ">>> Создание SSH ключа для GitHub Actions..."

# Создаем ключ без пароля
ssh-keygen -t rsa -b 4096 -C "github-actions" -f ~/.ssh/github_actions -N ""

# Добавляем публичный ключ в authorized_keys
cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys

# Устанавливаем правильные права
chmod 600 ~/.ssh/github_actions
chmod 644 ~/.ssh/github_actions.pub
chmod 700 ~/.ssh

echo ">>> Публичный ключ для добавления в GitHub:"
echo "----------------------------------------"
cat ~/.ssh/github_actions.pub
echo "----------------------------------------"

echo ">>> Приватный ключ для добавления в GitHub Secrets:"
echo "----------------------------------------"
cat ~/.ssh/github_actions
echo "----------------------------------------"

echo ">>> Готово! Теперь:"
echo "1. Скопируйте публичный ключ и добавьте в GitHub Settings > SSH Keys"
echo "2. Скопируйте приватный ключ и добавьте в GitHub Secrets как SSH_PRIVATE_KEY"
