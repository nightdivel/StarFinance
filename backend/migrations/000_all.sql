-- Unified migration: schema + seeds

-- Extensions (optional)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Accounts and permissions
CREATE TABLE IF NOT EXISTS account_types (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS account_type_permissions (
  account_type TEXT NOT NULL REFERENCES account_types(name) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('none','read','write')),
  PRIMARY KEY (account_type, resource)
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  auth_type TEXT NOT NULL DEFAULT 'local',
  password_hash TEXT,
  account_type TEXT REFERENCES account_types(name),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  discord_id TEXT,
  discord_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);

-- Settings (generic key-value JSONB)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Discord config
CREATE TABLE IF NOT EXISTS discord_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  enable BOOLEAN NOT NULL DEFAULT FALSE,
  client_id TEXT,
  client_secret TEXT,
  redirect_uri TEXT
);

CREATE TABLE IF NOT EXISTS discord_attr_mappings (
  id SERIAL PRIMARY KEY,
  rule JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS discord_guild_mappings (
  id SERIAL PRIMARY KEY,
  rule JSONB NOT NULL
);

-- Directories
CREATE TABLE IF NOT EXISTS product_types (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS showcase_statuses (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS warehouse_locations (
  name TEXT PRIMARY KEY
);

-- Product names
CREATE TABLE IF NOT EXISTS product_names (
  name TEXT PRIMARY KEY,
  type TEXT REFERENCES product_types(name)
);

-- Currencies
CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS currency_rates (
  base_code TEXT NOT NULL REFERENCES currencies(code) ON DELETE CASCADE,
  code TEXT NOT NULL REFERENCES currencies(code) ON DELETE CASCADE,
  rate NUMERIC(18,6) NOT NULL CHECK (rate > 0),
  PRIMARY KEY (base_code, code)
);

-- Warehouse
CREATE TABLE IF NOT EXISTS warehouse_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT REFERENCES product_types(name),
  quantity NUMERIC(18,3) NOT NULL DEFAULT 0,
  cost NUMERIC(18,2),
  currency TEXT,
  location TEXT REFERENCES warehouse_locations(name),
  display_currencies TEXT[],
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

-- Showcase
CREATE TABLE IF NOT EXISTS showcase_items (
  id TEXT PRIMARY KEY,
  warehouse_item_id TEXT REFERENCES warehouse_items(id) ON DELETE SET NULL,
  status TEXT REFERENCES showcase_statuses(name),
  price NUMERIC(18,2),
  currency TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

-- Finance
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  currency TEXT NOT NULL,
  from_user TEXT REFERENCES users(id),
  to_user TEXT REFERENCES users(id),
  item_id TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed defaults (idempotent)
-- Account types
INSERT INTO account_types(name) VALUES ('Администратор') ON CONFLICT DO NOTHING;
INSERT INTO account_types(name) VALUES ('Пользователь') ON CONFLICT DO NOTHING;
INSERT INTO account_types(name) VALUES ('Гость') ON CONFLICT DO NOTHING;

-- Permissions for Admin
INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Администратор','finance','write'),
('Администратор','warehouse','write'),
('Администратор','users','write'),
('Администратор','directories','write'),
('Администратор','settings','write')
ON CONFLICT DO NOTHING;

-- Permissions for User
INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Пользователь','finance','read'),
('Пользователь','warehouse','read'),
('Пользователь','users','none'),
('Пользователь','directories','none'),
('Пользователь','settings','none')
ON CONFLICT DO NOTHING;

-- Permissions for Guest
INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Гость','finance','read'),
('Гость','warehouse','read'),
('Гость','users','none'),
('Гость','directories','none'),
('Гость','settings','none')
ON CONFLICT DO NOTHING;

-- Basic directories
INSERT INTO product_types(name) VALUES ('Услуга') ON CONFLICT DO NOTHING;
INSERT INTO product_types(name) VALUES ('Товар') ON CONFLICT DO NOTHING;
INSERT INTO showcase_statuses(name) VALUES ('На витрине') ON CONFLICT DO NOTHING;
INSERT INTO showcase_statuses(name) VALUES ('Скрыт') ON CONFLICT DO NOTHING;
INSERT INTO warehouse_locations(name) VALUES ('Основной склад') ON CONFLICT DO NOTHING;
INSERT INTO warehouse_locations(name) VALUES ('Резервный склад') ON CONFLICT DO NOTHING;

-- Currencies base
INSERT INTO currencies(code) VALUES ('aUEC') ON CONFLICT DO NOTHING;
INSERT INTO currencies(code) VALUES ('КП') ON CONFLICT DO NOTHING;
INSERT INTO currency_rates(base_code, code, rate) VALUES ('aUEC','aUEC',1)
ON CONFLICT (base_code, code) DO UPDATE SET rate = EXCLUDED.rate;
INSERT INTO currency_rates(base_code, code, rate) VALUES ('aUEC','КП',0.9)
ON CONFLICT (base_code, code) DO UPDATE SET rate = EXCLUDED.rate;

-- Settings
INSERT INTO settings(key, value) VALUES ('system.version', '"1.0.0"')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO settings(key, value) VALUES ('system.baseCurrency', '"aUEC"')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO settings(key, value) VALUES ('system.currencies', '["aUEC","КП"]'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO settings(key, value) VALUES ('system.rates', '{"aUEC":1, "КП":0.9}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Discord default row
INSERT INTO discord_settings(id, enable) VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Admin user seed (admin/admin)
-- SHA-256('admin') = 8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918
INSERT INTO users (id, username, email, auth_type, password_hash, account_type, is_active)
VALUES ('admin_1', 'admin', 'admin@starfinance.local', 'local',
        '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
        'Администратор', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Additional seeds: test users and demo goods

-- Enable pgcrypto for SHA-256 hashing (idempotent)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Test users (passwords: user -> 'user', guest -> 'guest')
INSERT INTO users (id, username, email, auth_type, password_hash, account_type, is_active)
VALUES ('u_demo_user', 'user', 'user@starfinance.local', 'local',
        encode(digest('user','sha256'),'hex'), 'Пользователь', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, username, email, auth_type, password_hash, account_type, is_active)
VALUES ('u_demo_guest', 'guest', 'guest@starfinance.local', 'local',
        encode(digest('guest','sha256'),'hex'), 'Гость', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Demo warehouse items
INSERT INTO warehouse_items (id, name, type, quantity, cost, currency, location)
VALUES ('w_item_001', 'Aurora LX Paint', 'Товар', 10, 2500, 'aUEC', 'Основной склад')
ON CONFLICT (id) DO NOTHING;

INSERT INTO warehouse_items (id, name, type, quantity, cost, currency, location)
VALUES ('w_item_002', 'Cargo Crate 1SCU', 'Товар', 50, 1200, 'aUEC', 'Основной склад')
ON CONFLICT (id) DO NOTHING;

INSERT INTO warehouse_items (id, name, type, quantity, cost, currency, location)
VALUES ('w_item_003', 'Delivery Service (microTech)', 'Услуга', 5, 5000, 'КП', 'Резервный склад')
ON CONFLICT (id) DO NOTHING;

-- Extend directories: more product types, currencies, and warehouses
INSERT INTO product_types(name) VALUES ('Комплект') ON CONFLICT DO NOTHING;
INSERT INTO product_types(name) VALUES ('Материал') ON CONFLICT DO NOTHING;
INSERT INTO product_types(name) VALUES ('Запчасть') ON CONFLICT DO NOTHING;

INSERT INTO currencies(code) VALUES ('UEC') ON CONFLICT DO NOTHING;
INSERT INTO currencies(code) VALUES ('REC') ON CONFLICT DO NOTHING;
INSERT INTO currency_rates(base_code, code, rate) VALUES ('aUEC','UEC',1)
ON CONFLICT (base_code, code) DO UPDATE SET rate = EXCLUDED.rate;
INSERT INTO currency_rates(base_code, code, rate) VALUES ('aUEC','REC',2.5)
ON CONFLICT (base_code, code) DO UPDATE SET rate = EXCLUDED.rate;

INSERT INTO warehouse_locations(name) VALUES ('Орбитальный склад') ON CONFLICT DO NOTHING;
INSERT INTO warehouse_locations(name) VALUES ('Склад New Babbage') ON CONFLICT DO NOTHING;

-- Additional warehouse demo items
INSERT INTO warehouse_items (id, name, type, quantity, cost, currency, location)
VALUES ('w_item_004', 'Component: Power Plant (S2)', 'Запчасть', 8, 7500, 'aUEC', 'Орбитальный склад')
ON CONFLICT (id) DO NOTHING;
INSERT INTO warehouse_items (id, name, type, quantity, cost, currency, location)
VALUES ('w_item_005', 'Materials: Titanium Ore (stack)', 'Материал', 20, 3200, 'aUEC', 'Склад New Babbage')
ON CONFLICT (id) DO NOTHING;
INSERT INTO warehouse_items (id, name, type, quantity, cost, currency, location)
VALUES ('w_item_006', 'Starter Kit: Courier Pack', 'Комплект', 3, 15000, 'UEC', 'Основной склад')
ON CONFLICT (id) DO NOTHING;

-- Showcase demo items (link to warehouse items)
INSERT INTO showcase_items (id, warehouse_item_id, status, price, currency)
VALUES ('s_item_001', 'w_item_001', 'На витрине', 3500, 'aUEC')
ON CONFLICT (id) DO NOTHING;
INSERT INTO showcase_items (id, warehouse_item_id, status, price, currency)
VALUES ('s_item_002', 'w_item_002', 'На витрине', 1800, 'aUEC')
ON CONFLICT (id) DO NOTHING;
INSERT INTO showcase_items (id, warehouse_item_id, status, price, currency)
VALUES ('s_item_003', 'w_item_006', 'На витрине', 18000, 'UEC')
ON CONFLICT (id) DO NOTHING;

-- Sample transactions
-- Purchase items, transfers, income/expense examples
INSERT INTO transactions (id, type, amount, currency, from_user, to_user, item_id, meta)
VALUES ('t_001', 'sale', 3500, 'aUEC', 'u_demo_user', 'admin_1', 'w_item_001', '{"note":"Покупка Aurora LX Paint"}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO transactions (id, type, amount, currency, from_user, to_user, item_id, meta)
VALUES ('t_002', 'sale', 1800, 'aUEC', 'u_demo_user', 'admin_1', 'w_item_002', '{"note":"Покупка Cargo Crate 1SCU"}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO transactions (id, type, amount, currency, from_user, to_user, item_id, meta)
VALUES ('t_003', 'service', 5000, 'КП', 'u_demo_guest', 'admin_1', 'w_item_003', '{"note":"Доставка microTech"}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO transactions (id, type, amount, currency, from_user, to_user, item_id, meta)
VALUES ('t_004', 'transfer', 10000, 'aUEC', 'admin_1', 'u_demo_user', NULL, '{"note":"Пополнение баланса пользователя"}')
ON CONFLICT (id) DO NOTHING;
