const { Pool } = require('pg');
const { URL } = require('url');

// Support either individual PG_* vars or DATABASE_URL
function buildConfig() {
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    return {
      host: u.hostname,
      port: Number(u.port || 5432),
      database: u.pathname.replace(/^\//, ''),
      user: u.username,
      password: u.password,
      ssl: /true|require/i.test(process.env.PG_SSL || '') ? { rejectUnauthorized: false } : false,
      max: 10,
    };
  }
  return {
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT || 5432),
    database: process.env.PG_DATABASE || 'starfinance',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    ssl: /true|require/i.test(process.env.PG_SSL || '') ? { rejectUnauthorized: false } : false,
    max: 10,
  };
}

const pool = new Pool(buildConfig());

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

module.exports = { pool, query };
