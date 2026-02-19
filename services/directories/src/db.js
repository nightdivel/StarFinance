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
    CREATE TABLE IF NOT EXISTS product_names (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS warehouse_locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS warehouse_types (
      name TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS product_types (
      name TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS showcase_statuses (
      name TEXT PRIMARY KEY
    );
  `);
}
