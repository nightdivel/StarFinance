# Скрипт для настройки SSH ключа для пользователя root
# Запускать от имени администратора

Write-Host "Настройка SSH ключа для пользователя root..." -ForegroundColor Green

# Создаем директорию .ssh для root
$rootSshPath = "C:\Users\root\.ssh"
if (!(Test-Path $rootSshPath)) {
    New-Item -ItemType Directory -Path $rootSshPath -Force
    Write-Host "Создана директория $rootSshPath" -ForegroundColor Green
}

# Добавляем публичный ключ в authorized_keys
$publicKey = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDcuUUs4hWsHyvu35wrXVLJyRoO8b3b3dvty0O7jTy31Pj4a+YoO3I/+gRQQok+Sov8bEghUlXZkrqfCoquftOxT4Y1IamZaQzw1z+j1z3TUcU70i0A+t9Z2zYZWDVW9+NihwmiKDS4crnubDoTEkONIPfuQzBqk1cxO6MtKJ7BaH0uTAESWSIM7uUULTnHAAQVH+r8ODxPzm/xIYtXlYzrHi65phlyGva4UZc9Lu4GkNA/Mmd+yDuoUmr82L2jEr5hnO87hMIVpm2lA9ChLoZFmAVE62kx9TUc6ui2Umlcqzsh+POaWL4k3rlrV9/jW9NyjeKbwnTBRNLQrkx5nU0XSxBkXmCKSgzzI6MolkBW/Wnm7eVbYHAWd9xV81WqD8a46kjPy5qkdSAgOjfDSgB7lLqX4eFKByRYWFUOBcI4rKNr+wNwdEcSU+MGkFTwdZEco6mgG20Mrke3IYC6qbIWJp9aQklEmu0AORXrb7Y13uOjovVZT2eXJcstO2SZejGKcjDl7MiBZ3/Y9HV9L7s10YRJVUzBWsqC4JqGql7pp6ecfH3+O7n+Mxy2WCJbVHIx2zvY+oDDWRms7r7LgI3je91/jh4RXR1ajHLAdh1JMt8ei4Fm/jf9uEL6m0zz+hOyuBeBiLaecjSjlFsEPsKFq7ruLe5+zFSikkSlQt5mBw== github-actions-deploy"

Add-Content "$rootSshPath\authorized_keys" $publicKey
Write-Host "Ключ добавлен в C:\Users\root\.ssh\authorized_keys" -ForegroundColor Green

# Показываем ключ для проверки
Get-Content "$rootSshPath\authorized_keys"

Write-Host "Готово! Теперь обновите USERNAME в GitHub Secrets на 'root'" -ForegroundColor Yellow
