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
    CREATE TABLE IF NOT EXISTS purchase_requests (
      id TEXT PRIMARY KEY,
      warehouse_item_id TEXT NOT NULL,
      buyer_user_id TEXT NOT NULL,
      buyer_username TEXT,
      quantity NUMERIC NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS purchase_request_logs (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      actor_user_id TEXT,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
