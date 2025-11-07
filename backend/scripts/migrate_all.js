/*
 Unified migration runner
 - Applies DDL + seeds from migrations/000_all.sql
*/

const fs = require('fs');
const path = require('path');
const { query } = require('../db');

async function applyDDL() {
  const ddlPath = path.resolve(__dirname, '../migrations/000_all.sql');
  const sql = fs.readFileSync(ddlPath, 'utf8');
  await query(sql);
}

async function main() {
  console.log('> Unified migration: start');
  await applyDDL();
  console.log('> Unified migration: done');
}

main().catch((e) => {
  console.error('Unified migration failed:', e);
  process.exit(1);
});
