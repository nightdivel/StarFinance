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
    CREATE TABLE IF NOT EXISTS warehouse_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      quantity NUMERIC NOT NULL DEFAULT 0,
      cost NUMERIC,
      currency TEXT,
      display_currencies TEXT[],
      meta JSONB,
      warehouse_type TEXT,
      owner_login TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS warehouse_types (
      name TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS product_types (
      name TEXT PRIMARY KEY
    );
  `);
}
