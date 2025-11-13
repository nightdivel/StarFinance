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

-- Additional user preferences
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(10) DEFAULT 'light';
-- Optional profile fields
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS nickname TEXT;
UPDATE users SET theme_preference = COALESCE(theme_preference, 'light');

-- Settings (generic key-value JSONB)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- Discord config (final schema)
CREATE TABLE IF NOT EXISTS discord_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  enable BOOLEAN NOT NULL DEFAULT FALSE,
  client_id TEXT,
  client_secret TEXT,
  redirect_uri TEXT,
  default_account_type TEXT REFERENCES account_types(name)
);

CREATE TABLE IF NOT EXISTS discord_attr_mappings (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('user','member')),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  account_type TEXT REFERENCES account_types(name),
  guild_id TEXT,
  set JSONB
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

-- Warehouse extensions
CREATE TABLE IF NOT EXISTS warehouse_types (
  name TEXT PRIMARY KEY
);
-- Seed some default warehouse types (idempotent)
INSERT INTO warehouse_types(name) VALUES
  ('Основной'),
  ('Орбитальный'),
  ('Региональный')
ON CONFLICT DO NOTHING;
ALTER TABLE warehouse_items 
  ADD COLUMN IF NOT EXISTS warehouse_type TEXT REFERENCES warehouse_types(name);
ALTER TABLE warehouse_items 
  ADD COLUMN IF NOT EXISTS owner_login TEXT REFERENCES users(username);
ALTER TABLE warehouse_items 
  ADD COLUMN IF NOT EXISTS reserved NUMERIC(18,3) NOT NULL DEFAULT 0;

-- Access matrix: which account types can use which warehouse types
CREATE TABLE IF NOT EXISTS account_type_warehouse_types (
  account_type TEXT NOT NULL REFERENCES account_types(name) ON DELETE CASCADE,
  warehouse_type TEXT NOT NULL REFERENCES warehouse_types(name) ON DELETE CASCADE,
  PRIMARY KEY (account_type, warehouse_type)
);

-- Seed default allowed warehouse types per account type (idempotent)
INSERT INTO account_type_warehouse_types(account_type, warehouse_type) VALUES
  ('Администратор','Основной'),
  ('Администратор','Орбитальный'),
  ('Администратор','Региональный'),
  ('Пользователь','Основной')
ON CONFLICT DO NOTHING;

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

-- Purchase requests and logs
CREATE TABLE IF NOT EXISTS purchase_requests (
  id TEXT PRIMARY KEY,
  warehouse_item_id TEXT NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  buyer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  buyer_username TEXT,
  quantity NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  price_per_unit NUMERIC(18,2),
  currency TEXT,
  status TEXT NOT NULL CHECK (status IN ('В обработке','Заявка отправлена','Выполнено','Отменена')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

-- If table existed with older constraint, ensure it matches final list
DO $$
DECLARE c RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'purchase_requests' AND table_schema = 'public'
  ) THEN
    FOR c IN (
      SELECT conname
      FROM pg_constraint con
      JOIN pg_class cls ON cls.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
      WHERE cls.relname = 'purchase_requests' AND con.contype = 'c'
    ) LOOP
      EXECUTE format('ALTER TABLE purchase_requests DROP CONSTRAINT %I', c.conname);
    END LOOP;
    BEGIN
      EXECUTE 'ALTER TABLE purchase_requests
               ADD CONSTRAINT purchase_requests_status_check
               CHECK (status IN (''В обработке'',''Заявка отправлена'',''Выполнено'',''Отменена''))';
    EXCEPTION WHEN duplicate_object THEN
      -- already recreated
    END;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS purchase_request_logs (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_buyer ON purchase_requests(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_item ON purchase_requests(warehouse_item_id);

-- Finance requests flow
CREATE TABLE IF NOT EXISTS finance_requests (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  from_user TEXT REFERENCES users(id) ON DELETE SET NULL,
  to_user TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'В обработке',
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_finance_requests_to_user ON finance_requests(to_user);
CREATE INDEX IF NOT EXISTS idx_finance_requests_status ON finance_requests(status);

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

-- Permissions for Showcase module
INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Администратор','showcase','write')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;
INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Пользователь','showcase','read')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;
INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Гость','showcase','read')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;

-- Permissions for Requests module
INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Администратор','requests','write')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;
INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Пользователь','requests','read')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;
INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Гость','requests','none')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;

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

-- Demo warehouse items removed

-- Extend directories: more product types, currencies, and warehouses
INSERT INTO product_types(name) VALUES ('Комплект') ON CONFLICT DO NOTHING;
INSERT INTO product_types(name) VALUES ('Материал') ON CONFLICT DO NOTHING;
INSERT INTO product_types(name) VALUES ('Запчасть') ON CONFLICT DO NOTHING;

-- Remove deprecated currencies if present (idempotent cleanup)
DELETE FROM currency_rates WHERE code IN ('UEC','REC') OR base_code IN ('UEC','REC');
DELETE FROM currencies WHERE code IN ('UEC','REC');

INSERT INTO warehouse_locations(name) VALUES ('Орбитальный склад') ON CONFLICT DO NOTHING;
INSERT INTO warehouse_locations(name) VALUES ('Склад New Babbage') ON CONFLICT DO NOTHING;

-- Additional warehouse demo items removed

-- Showcase demo items removed

-- Ensure previously seeded rows referencing UEC are normalized to aUEC
UPDATE warehouse_items SET currency = 'aUEC' WHERE currency = 'UEC';
UPDATE showcase_items SET currency = 'aUEC' WHERE currency = 'UEC';

-- Sample transactions removed
