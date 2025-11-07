-- Stage 1 normalization DDL
-- account types and permissions
CREATE TABLE IF NOT EXISTS account_types (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS account_type_permissions (
  account_type TEXT REFERENCES account_types(name) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('none','read','write')),
  PRIMARY KEY (account_type, resource)
);

-- users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  auth_type TEXT NOT NULL,
  account_type TEXT REFERENCES account_types(name),
  is_active BOOLEAN NOT NULL DEFAULT true,
  password_hash TEXT,
  discord_id TEXT UNIQUE,
  discord_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login TIMESTAMPTZ
);

-- settings (generic key-value JSONB)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

-- discord settings
CREATE TABLE IF NOT EXISTS discord_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  enable BOOLEAN NOT NULL DEFAULT false,
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

CREATE TABLE IF NOT EXISTS discord_guild_mappings (
  guild_id TEXT PRIMARY KEY,
  account_type TEXT REFERENCES account_types(name)
);
