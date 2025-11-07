/* eslint-disable no-empty */
/*
 Stage 2 normalization migration runner
 - Applies DDL from migrations/002_stage2.sql
 - Migrates data from app_state JSONB and settings table to normalized tables:
   product_types, showcase_statuses, warehouse_locations,
   currencies, currency_rates,
   warehouse_items, showcase_items, transactions
*/

const fs = require('fs');
const path = require('path');
const { query } = require('../db');

async function applyDDL() {
  const ddlPath = path.resolve(__dirname, '../migrations/002_stage2.sql');
  const sql = fs.readFileSync(ddlPath, 'utf8');
  await query(sql);
}

function get(obj, pathStr, defVal) {
  try {
    return (
      pathStr.split('.').reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), obj) ??
      defVal
    );
  } catch (_) {
    return defVal;
  }
}

async function readSettingsMap() {
  const map = {};
  try {
    const res = await query('SELECT key, value FROM settings');
    for (const r of res.rows) map[r.key] = r.value;
  } catch (_) {}
  return map;
}

async function upsertDirectories(app) {
  const s = await readSettingsMap();
  const productTypes =
    (Array.isArray(get(app, 'directories.productTypes')) && get(app, 'directories.productTypes')) ||
    (Array.isArray(s['directories.productTypes']) && s['directories.productTypes']) ||
    [];
  const showcaseStatuses =
    (Array.isArray(get(app, 'directories.showcaseStatuses')) &&
      get(app, 'directories.showcaseStatuses')) ||
    (Array.isArray(s['directories.showcaseStatuses']) && s['directories.showcaseStatuses']) ||
    [];
  const warehouseLocations =
    (Array.isArray(get(app, 'directories.warehouseLocations')) &&
      get(app, 'directories.warehouseLocations')) ||
    (Array.isArray(s['directories.warehouseLocations']) && s['directories.warehouseLocations']) ||
    [];

  for (const name of productTypes) {
    await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
      name,
    ]);
  }
  for (const name of showcaseStatuses) {
    await query('INSERT INTO showcase_statuses(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
      name,
    ]);
  }
  for (const name of warehouseLocations) {
    await query('INSERT INTO warehouse_locations(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
      name,
    ]);
  }
}

async function upsertCurrencies(app) {
  const s = await readSettingsMap();
  const currencies =
    (Array.isArray(get(app, 'system.currencies')) && get(app, 'system.currencies')) ||
    (Array.isArray(s['system.currencies']) && s['system.currencies']) ||
    [];
  const base = get(app, 'system.baseCurrency', s['system.baseCurrency'] || null);
  const rates = get(app, 'system.rates', s['system.rates'] || {});

  for (const code of currencies) {
    await query('INSERT INTO currencies(code) VALUES ($1) ON CONFLICT (code) DO NOTHING', [code]);
  }
  if (base) {
    // Ensure base in currencies
    await query('INSERT INTO currencies(code) VALUES ($1) ON CONFLICT (code) DO NOTHING', [base]);
    // Insert rates: for each currency code, we expect a numeric rate relative to base
    const entries = Object.entries(rates || {});
    for (const [code, rateVal] of entries) {
      const rate = Number(rateVal) || 0;
      if (rate > 0) {
        await query(
          `INSERT INTO currency_rates(base_code, code, rate) VALUES ($1,$2,$3)
           ON CONFLICT (base_code, code) DO UPDATE SET rate = EXCLUDED.rate`,
          [base, code, rate]
        );
      }
    }
    // Make sure base/base = 1
    await query(
      `INSERT INTO currency_rates(base_code, code, rate) VALUES ($1, $1, 1)
       ON CONFLICT (base_code, code) DO UPDATE SET rate = 1`,
      [base]
    );
  }
}

async function upsertWarehouse(app) {
  const items = Array.isArray(app.warehouse) ? app.warehouse : [];
  for (const it of items) {
    const id = String(it.id ?? it._id ?? `w_${Date.now()}_${Math.floor(Math.random() * 10000)}`);
    const name = it.name || 'Без названия';
    const type = it.type || null;
    const quantity = Number(it.quantity) || 0;
    const cost =
      it.cost !== undefined ? Number(it.cost) : it.price !== undefined ? Number(it.price) : null;
    const currency = it.currency || null;
    const location = it.location || null;
    const displayCurrencies = Array.isArray(it.displayCurrencies) ? it.displayCurrencies : null;
    const meta = it.meta ? JSON.stringify(it.meta) : null;

    // Ensure referenced directories exist
    if (type)
      await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
        type,
      ]);
    if (location)
      await query(
        'INSERT INTO warehouse_locations(name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [location]
      );

    await query(
      `INSERT INTO warehouse_items(id, name, type, quantity, cost, currency, location, display_currencies, meta, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, quantity = EXCLUDED.quantity,
         cost = EXCLUDED.cost, currency = EXCLUDED.currency, location = EXCLUDED.location, display_currencies = EXCLUDED.display_currencies, meta = EXCLUDED.meta,
         updated_at = now()`,
      [id, name, type, quantity, cost, currency, location, displayCurrencies, meta]
    );
  }
}

async function upsertShowcase(app) {
  const items = Array.isArray(app.showcase) ? app.showcase : [];
  for (const sc of items) {
    const id = String(sc.id ?? `s_${Date.now()}_${Math.floor(Math.random() * 10000)}`);
    const warehouseItemId = sc.warehouseItemId || null;
    const status = sc.status || null;
    const price = sc.price !== undefined ? Number(sc.price) : null;
    const currency = sc.currency || null;
    const meta = sc.meta ? JSON.stringify(sc.meta) : null;

    if (status)
      await query('INSERT INTO showcase_statuses(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
        status,
      ]);

    await query(
      `INSERT INTO showcase_items(id, warehouse_item_id, status, price, currency, meta, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (id) DO UPDATE SET warehouse_item_id = EXCLUDED.warehouse_item_id, status = EXCLUDED.status, price = EXCLUDED.price,
         currency = EXCLUDED.currency, meta = EXCLUDED.meta, updated_at = now()`,
      [id, warehouseItemId, status, price, currency, meta]
    );
  }
}

async function upsertTransactions(app) {
  const items = Array.isArray(app.transactions) ? app.transactions : [];
  for (const t of items) {
    const id = String(t.id ?? `t_${Date.now()}_${Math.floor(Math.random() * 10000)}`);
    const type = t.type || 'generic';
    const amount = Number(t.amount) || 0;
    const currency = t.currency || 'aUEC';
    const fromUser = t.from_user || t.fromUser || null;
    const toUser = t.to_user || t.toUser || null;
    const itemId = t.item_id || t.itemId || null;
    const meta = t.meta ? JSON.stringify(t.meta) : null;

    await query(
      `INSERT INTO transactions(id, type, amount, currency, from_user, to_user, item_id, meta, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, amount = EXCLUDED.amount, currency = EXCLUDED.currency,
         from_user = EXCLUDED.from_user, to_user = EXCLUDED.to_user, item_id = EXCLUDED.item_id, meta = EXCLUDED.meta`,
      [id, type, amount, currency, fromUser, toUser, itemId, meta]
    );
  }
}

async function main() {
  console.log('> Stage 2 migration: start');
  await applyDDL();
  // app_state больше не используется; миграцию выполняем на основе settings и явных таблиц
  const app = {};
  await upsertDirectories(app);
  await upsertCurrencies(app);
  await upsertWarehouse(app);
  await upsertShowcase(app);
  await upsertTransactions(app);
  console.log('> Stage 2 migration: done');
}

main().catch((e) => {
  console.error('Stage 2 migration failed:', e);
  process.exit(1);
});
