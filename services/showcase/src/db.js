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
    CREATE TABLE IF NOT EXISTS showcase_statuses (
      name TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS showcase_items (
      id TEXT PRIMARY KEY,
      warehouse_item_id TEXT NOT NULL,
      status TEXT,
      price NUMERIC,
      currency TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ
    );
  `);
}
