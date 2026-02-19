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
    CREATE TABLE IF NOT EXISTS account_types (
      name TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT,
      auth_type TEXT NOT NULL DEFAULT 'local',
      account_type TEXT NOT NULL REFERENCES account_types(name) ON DELETE RESTRICT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      nickname TEXT,
      discord_id TEXT,
      discord_data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS account_type_permissions (
      account_type TEXT NOT NULL REFERENCES account_types(name) ON DELETE CASCADE,
      resource TEXT NOT NULL,
      level TEXT NOT NULL,
      PRIMARY KEY (account_type, resource)
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ,
      user_agent TEXT,
      ip TEXT,
      revoked_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
