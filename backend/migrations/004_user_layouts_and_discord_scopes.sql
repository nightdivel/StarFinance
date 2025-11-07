-- 004_user_layouts_and_discord_scopes.sql

-- Scopes dictionary for Discord
CREATE TABLE IF NOT EXISTS discord_scopes (
  name TEXT PRIMARY KEY
);

-- Scope mappings to account types (value can be NULL for scope-wide mapping)
CREATE TABLE IF NOT EXISTS discord_scope_mappings (
  scope TEXT NOT NULL REFERENCES discord_scopes(name) ON DELETE CASCADE,
  value TEXT,
  account_type TEXT REFERENCES account_types(name) ON DELETE SET NULL,
  PRIMARY KEY (scope, value)
);

-- Per-user persisted layouts per page
CREATE TABLE IF NOT EXISTS user_layouts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page TEXT NOT NULL,
  layouts JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, page)
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_user_layouts_user ON user_layouts(user_id);
