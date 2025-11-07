-- Stage 2 normalization DDL
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
