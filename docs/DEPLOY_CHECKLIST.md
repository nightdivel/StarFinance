# Star Finance: Чеклист после деплоя

## ✅ Базовая проверка

- [ ] DNS A-записи `fin.blacksky.su` и `bot.blacksky.su` указывают на сервер
- [ ] nginx слушает 80/443 с wildcard сертификатом
- [ ] docker контейнеры запущены и здоровы (`docker compose ps`)
- [ ] порты 8080/8443 привязаны только к 127.0.0.1

## ✅ Тестирование эндпоинтов

```bash
# Фронтенд
curl -I https://fin.blacksky.su/economy/
# Ожидай: 200 OK

# API: Discord flag
curl -s https://fin.blacksky.su/economy/public/discord-enabled
# Ожидай: {"enable":true}

# API: Пользователи
curl -s https://fin.blacksky.su/economy/api/users | head -n 20
# Ожидай: JSON массив или 401 (если требует авторизации)

# Бот
curl -I https://bot.blacksky.su/login
# Ожидай: 200 OK
```

## ✅ Проверка безопасности

- [ ] Снаружи доступны только порты 80/443: `ss -lntp | grep -E ':(80|443)\b'`
- [ ] Порт 3001 (blackhole_bot) не торчит наружу
- [ ] Caddy не пытается выпускать сертификаты: `docker compose logs caddy | grep auto_https`
- [ ] nginx не редиректит в цикле (нет 308 на HTTP)

## ✅ Функциональность

- [ ] Фронтенд загружается, нет ошибок в консоли браузера
- [ ] Авторизация работает (admin/admin)
- [ ] Discord OAuth (если включён) редиректит корректно
- [ ] Socket.io подключается (нет ошибок в консоли)
- [ ] API-запросы от фронтенда возвращают JSON, а не HTML

## ✅ Логи и мониторинг

- [ ] nginx access/error логи без критических ошибок
- [ ] Caddy логи без ошибок роутинга
- [ ] Микросервисы не падают (проверить `docker compose logs -f`)

## ✅ Бэкап

- [ ] Создан бэкап БД: `docker compose exec -T postgres pg_dump -U postgres starfinance > backup.sql`
- [ ] Бэкап сохранён надёжно (не в репозитории)

## ❌ Если что-то не работает

1. **502 Bad Gateway** → проверь upstream порты и здоровье контейнеров.
2. **SSL error** → проверь путь к сертификатам в nginx и права на файлы.
3. **404 на API** → проверь Caddyfile (`auto_https off`, `http://{$DOMAIN}`) и роуты.
4. **Redirect loop** → проверь nginx vhosts и отсутствие `default` сервера.
5. **Caddy не отвечает** → проверь, что порты 8080/8443 привязаны к 127.0.0.1.

---

**Готово!** Если все пункты выполнены — деплой успешен.
