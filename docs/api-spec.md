# Star Finance — API спецификация

Все защищённые эндпоинты требуют заголовок `Authorization: Bearer <JWT>`.
Уровни прав: `none | read | write`. Проверка выполняется middleware `requirePermission(resource, level)`.
Базовые ресурсы прав: `settings`, `users`, `warehouse`, `showcase`, `requests`, `transactions`, `directories`.

## Общее
- GET /health
  - Auth: нет
  - Описание: проверка доступа к БД и доступности сервера.
  - Ответ 200: `{ "status": "ok" }`

- GET /public/auth/background
  - Auth: нет
  - Описание: получить метаданные фонового изображения страницы входа.
  - 200: `{ url: string|null, updatedAt: string|null }`

- GET /public/auth/background/file/:name
  - Auth: нет
  - Описание: отдать файл изображения. `name` = `auth-bg.(png|jpg|jpeg|webp)`
  - 200: бинарный файл, 404 — если не найден

- PUT /api/system/auth/background
  - Auth: да
  - Права: `settings:write`
  - Тело: `{ dataUrl: 'data:image/png;base64,...' }`
  - 200: `{ ok: true, name, size }`

- DELETE /api/system/auth/background
  - Auth: да
  - Права: `settings:write`
  - 200: `{ ok: true }`

## Профиль и пользовательские настройки
- GET /auth/profile
  - Auth: да
  - Описание: профиль текущего пользователя, в т.ч. `permissions`.
  - 200: `{ id, username, nickname, accountType, isActive, authType, avatarUrl?, permissions }`

- GET /api/user/theme
  - Auth: да
  - 200: `{ theme: 'dark'|'light' }`

- PUT /api/user/theme
  - Auth: да
  - Тело: `{ theme: 'dark'|'light' }`
  - 200: `{ ok: true }`

- GET /api/user/layouts/:page
  - Auth: да
  - Описание: получить сохранённый layout для страницы.
  - 200: `{ userId, page, layouts, updatedAt }` или `{}`

- PUT /api/user/layouts/:page
  - Auth: да
  - Тело: `{ layouts: any }`
  - 200: `{ ok: true }`

## Пользователи и типы аккаунтов
- POST /api/users
  - Auth: да, Права: `users:write`
  - Тело: `{ username, email?, password, accountType, isActive?, nickname? }`
  - 201: `{ id }`

- POST /api/users/:id/password
  - Auth: да, Права: `users:write`
  - Тело: `{ password }`
  - 200: `{ ok: true }`

- DELETE /api/users/:id
  - Auth: да, Права: `users:write`
  - 200: `{ ok: true }`

- GET /api/account-types
  - Auth: да, Права: `users:read`
  - 200: `{ items: [{ name, permissions: Record<resource, level> }] }`

- POST /api/account-types
  - Auth: да, Права: `users:write`
  - Тело: `{ name, permissions?: Record<resource, level> }`
  - 201: `{ name }`

- PUT /api/account-types/:name
  - Auth: да, Права: `users:write`
  - Тело: `{ permissions: Record<resource, level> }`
  - 200: `{ ok: true }`

- DELETE /api/account-types/:name
  - Auth: да, Права: `users:write`
  - 200: `{ ok: true }`

## Склад (Warehouse)
- GET /api/warehouse
  - Auth: да, Права: `warehouse:read`
  - Параметры: фильтры по типу/локации и т.п. (см. server.js)
  - 200: `{ items: WarehouseItem[] }`

- POST /api/warehouse
  - Auth: да, Права: `warehouse:write`
  - Тело: `{ id?, name, type?, quantity?, cost?, currency?, location?, warehouse_type?, owner_login?, display_currencies?, meta? }`
  - 201: `{ id }`

- PUT /api/warehouse/:id
  - Auth: да, Права: `warehouse:write`
  - Тело: те же поля, что и при создании
  - 200: `{ ok: true }`

- PATCH /api/warehouse/:id/quantity
  - Auth: да
  - Права: админ (`warehouse:write`) или владелец `owner_login`
  - Тело: `{ quantity: number }`
  - 200: `{ ok: true, quantity, reserved }`

- DELETE /api/warehouse/:id
  - Auth: да, Права: `warehouse:write`
  - 200: `{ ok: true }`

## Витрина (Showcase)
- GET /api/showcase
  - Auth: да, Права: `showcase:read`
  - 200: `{ items: ShowcaseItem[] }`

- POST /api/showcase
  - Auth: да, Права: `showcase:write`
  - Тело: `{ id?, warehouse_item_id, status?, price?, currency?, meta? }`
  - 201: `{ id }`

- PUT /api/showcase/:id
  - Auth: да, Права: `showcase:write`
  - Тело: частичное обновление
  - 200: `{ ok: true }`

- DELETE /api/showcase/:id
  - Auth: да, Права: `showcase:write`
  - 200: `{ ok: true }`

- DELETE /api/showcase/by-warehouse/:warehouseItemId
  - Auth: да, Права: `showcase:write`
  - 200: `{ ok: true, deleted: number }`

## Заявки на покупку (Purchase Requests)
- POST /api/requests
  - Auth: да
  - Тело: `{ warehouseItemId, quantity }`
  - Бизнес-логика: резервирование количества; запрет покупки собственных позиций.
  - 201: `{ id, status, reserved }`

- GET /api/my/requests
  - Auth: да
  - 200: `{ items: Request[] }`

- GET /api/requests
  - Auth: да, Права: `requests:read`
  - 200: `{ items: Request[] }`

- PUT /api/requests/:id/confirm
  - Auth: да
  - Права: админ (`requests:write`) или владелец товара
  - 200: `{ ok: true, status: 'Выполнено', transactionId }`

- PUT /api/requests/:id/cancel
  - Auth: да
  - Права: админ (`requests:write`) или покупатель
  - 200: `{ ok: true, status: 'Отменена' }`

- DELETE /api/requests/:id
  - Auth: да, Права: `requests:write`
  - 200: `{ ok: true }`

## Транзакции (Finance)
- GET /api/transactions
  - Auth: да, Права: `transactions:read`
  - 200: `{ items: Transaction[] }`

- POST /api/transactions
  - Auth: да, Права: `transactions:write`
  - Тело: `{ id?, type, amount, currency, from_user?, to_user?, item_id?, meta? }`
  - 201: `{ id }`

- PUT /api/transactions/:id
  - Auth: да, Права: `transactions:write`
  - Тело: частичное обновление
  - 200: `{ ok: true }`

- DELETE /api/transactions/:id
  - Auth: да, Права: `transactions:write`
  - 200: `{ ok: true }`

## Справочники (Directories)
- GET /api/directories
  - Auth: да, Права: `directories:read`
  - 200: `{ product_types, showcase_statuses, warehouse_locations, product_names?, warehouse_types?, currencies }`

- CRUD для таблиц справочников (см. server.js «Directories CRUD»):
  - product_types: GET/POST/DELETE/PUT /api/directories/product-types
  - showcase_statuses: GET/POST/DELETE/PUT /api/directories/showcase-statuses
  - warehouse_locations: GET/POST/DELETE/PUT /api/directories/warehouse-locations
  - product_names: GET/POST/DELETE/PUT /api/directories/product-names

## Валюты и курсы
- GET /api/system/currencies
  - Auth: да, Права: `settings:read`
  - 200: `{ items: string[] }`

- POST /api/system/currencies
  - Auth: да, Права: `settings:write`
  - Тело: `{ code }`
  - 201: `{ ok: true }`

- DELETE /api/system/currencies/:code
  - Auth: да, Права: `settings:write`
  - 200: `{ ok: true }`

- GET /api/system/currencies/rates
  - Auth: да, Права: `settings:read`
  - 200: `{ base, rates: Record<code, number> }`

- PUT /api/system/currencies/rates
  - Auth: да, Права: `settings:write`
  - Тело: `{ base, rates }`
  - 200: `{ ok: true }`

## Discord scopes & mappings
- GET /api/discord/scopes
  - Auth: да, Права: `settings:read`
  - 200: `{ items: string[] }`

- POST /api/discord/scopes
  - Auth: да, Права: `settings:write`
  - Тело: `{ name }`
  - 201: `{ ok: true }`

- DELETE /api/discord/scopes/:name
  - Auth: да, Права: `settings:write`
  - 200: `{ ok: true }`

- GET /api/discord/scope-mappings
  - Auth: да, Права: `settings:read`
  - 200: `{ items: { scope, value, account_type }[] }`

- POST /api/discord/scope-mappings
  - Auth: да, Права: `settings:write`
  - Тело: `{ scope, value?, account_type? }`
  - 201: `{ ok: true }`

- DELETE /api/discord/scope-mappings
  - Auth: да, Права: `settings:write`
  - Тело: `{ scope, value }`
  - 200: `{ ok: true }`

## Примеры запросов и ответов

### Профиль
Запрос:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/auth/profile
```
Успех 200:
```json
{
  "id": "admin_1",
  "username": "admin",
  "nickname": null,
  "accountType": "Администратор",
  "isActive": true,
  "authType": "local",
  "avatarUrl": null,
  "permissions": {
    "settings": "write",
    "users": "write",
    "warehouse": "write",
    "showcase": "write",
    "requests": "write",
    "transactions": "write",
    "directories": "write"
  }
}
```

### Тема пользователя
GET:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/user/theme
```
200:
```json
{ "theme": "dark" }
```

PUT:
```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"theme":"light"}' http://localhost:3000/api/user/theme
```
200:
```json
{ "ok": true }
```

### Склад — выборка и создание
GET (с фильтром по типу):
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/warehouse?type=Товар"
```
200 (пример):
```json
{ "items": [
  { "id": "w1", "name": "Лазерный резак", "type": "Товар", "quantity": 10,
    "reserved": 0, "currency": "aUEC", "location": "Основной склад" }
]}
```

POST (создание позиции):
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name":"Лазерный резак","type":"Товар","quantity":5,
    "currency":"aUEC","location":"Основной склад","owner_login":"admin"
  }' http://localhost:3000/api/warehouse
```
201:
```json
{ "id": "w2" }
```

### Витрина — публикация
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"warehouse_item_id":"w2","status":"На витрине","price":100,"currency":"aUEC"}' \
  http://localhost:3000/api/showcase
```
201:
```json
{ "id": "s1" }
```

### Заявки — создание и подтверждение
Создание заявки:
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"warehouseItemId":"w2","quantity":2}' http://localhost:3000/api/requests
```
201:
```json
{ "id": "r1", "status": "Заявка отправлена", "reserved": 2 }
```

Подтверждение (админ или владелец):
```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/requests/r1/confirm
```
200:
```json
{ "ok": true, "status": "Выполнено", "transactionId": "t1" }
```

### Транзакции — создание
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"sale","amount":200,"currency":"aUEC","from_user":"admin_1","to_user":"user_2"}' \
  http://localhost:3000/api/transactions
```
201:
```json
{ "id": "t1" }
```

### Справочники
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/directories
```
200 (пример):
```json
{
  "product_types": ["Услуга","Товар"],
  "showcase_statuses": ["На витрине","Скрыт"],
  "warehouse_locations": ["Основной склад","Резервный склад"],
  "warehouse_types": ["Тип A","Тип B"],
  "currencies": ["aUEC","КП"]
}
```

### Валюты и курсы — чтение и обновление
GET курсов:
```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/system/currencies/rates
```
200:
```json
{ "base": "aUEC", "rates": { "aUEC": 1, "КП": 0.9 } }
```

PUT курсов:
```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"base":"aUEC","rates":{"aUEC":1,"КП":0.95}}' \
  http://localhost:3000/api/system/currencies/rates
```
200:
```json
{ "ok": true }
```

### Discord scopes
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"guild:12345"}' http://localhost:3000/api/discord/scopes
```
201:
```json
{ "ok": true }
```

---
Примечание: точные структуры ответов могут содержать дополнительные поля. При интеграции ориентируйтесь на актуальный `backend/server.js`.
