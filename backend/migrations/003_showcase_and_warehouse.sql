-- 003_showcase_and_warehouse.sql

-- Add showcase permission resource
INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Администратор','showcase','write')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;

INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Пользователь','showcase','read')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;

INSERT INTO account_type_permissions(account_type, resource, level) VALUES
('Гость','showcase','read')
ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level;

-- Warehouse types dictionary
CREATE TABLE IF NOT EXISTS warehouse_types (
  name TEXT PRIMARY KEY
);

-- Extend warehouse_items
ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS warehouse_type TEXT REFERENCES warehouse_types(name);
ALTER TABLE warehouse_items ADD COLUMN IF NOT EXISTS owner_login TEXT REFERENCES users(username);
