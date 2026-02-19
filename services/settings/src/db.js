import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DB_URL,
});

export async function healthCheck() {
  const res = await pool.query('SELECT 1 AS ok');
  return res.rows?.[0]?.ok === 1;
}

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS discord_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      enable BOOLEAN NOT NULL DEFAULT FALSE,
      client_id TEXT,
      client_secret TEXT,
      redirect_uri TEXT,
      base_url TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS discord_scopes (
      name TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS discord_scope_mappings (
      scope TEXT NOT NULL,
      value TEXT,
      account_type TEXT NOT NULL,
      position INTEGER,
      PRIMARY KEY (scope, value)
    );
  `);
}
