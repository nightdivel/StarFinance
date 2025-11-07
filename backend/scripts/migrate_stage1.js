/*
 Stage 1 normalization migration runner
 - Applies DDL from migrations/001_stage1.sql
 - Migrates data from app_state JSONB to normalized tables
*/

const fs = require('fs');
const path = require('path');
const { query, ensureSchema, readAppState } = require('../db');

async function applyDDL() {
  const ddlPath = path.resolve(__dirname, '../migrations/001_stage1.sql');
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

async function upsertAccountTypesAndPermissions(app) {
  const defaults = [
    {
      name: 'Администратор',
      permissions: {
        finance: 'write',
        warehouse: 'write',
        users: 'write',
        directories: 'write',
        settings: 'write',
        requests: 'write',
      },
    },
    {
      name: 'Пользователь',
      permissions: {
        finance: 'read',
        warehouse: 'read',
        users: 'none',
        directories: 'none',
        settings: 'none',
        requests: 'read',
      },
    },
    {
      name: 'Гость',
      permissions: {
        finance: 'read',
        warehouse: 'read',
        users: 'none',
        directories: 'none',
        settings: 'none',
        requests: 'read',
      },
    },
  ];

  const fromApp = Array.isArray(get(app, 'directories.accountTypes', []))
    ? get(app, 'directories.accountTypes', [])
    : [];
  const types = fromApp.length > 0 ? fromApp : defaults;

  for (const t of types) {
    const name = t.name || 'Пользователь';
    await query('INSERT INTO account_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
      name,
    ]);
    const perms = t.permissions || {};
    for (const resource of Object.keys(perms)) {
      const level = perms[resource];
      await query(
        `INSERT INTO account_type_permissions(account_type, resource, level)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level`,
        [name, resource, level]
      );
    }
  }
}

async function upsertUsers(app) {
  const users = Array.isArray(app.users) ? app.users : [];
  for (const u of users) {
    await query(
      `INSERT INTO users(id, username, email, auth_type, account_type, is_active, password_hash, discord_id, discord_data, created_at, last_login)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, email = EXCLUDED.email, auth_type = EXCLUDED.auth_type,
         account_type = EXCLUDED.account_type, is_active = EXCLUDED.is_active, password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash),
         discord_id = COALESCE(EXCLUDED.discord_id, users.discord_id), discord_data = COALESCE(EXCLUDED.discord_data, users.discord_data), last_login = EXCLUDED.last_login`,
      [
        u.id,
        u.username,
        u.email || null,
        u.authType || 'local',
        u.accountType || null,
        u.isActive !== false,
        u.passwordHash || null,
        u.discordId || null,
        u.discordData ? JSON.stringify(u.discordData) : null,
        u.createdAt ? new Date(u.createdAt) : new Date(),
        u.lastLogin ? new Date(u.lastLogin) : null,
      ]
    );
  }
}

async function upsertSettings(app) {
  const entries = [
    ['system.version', get(app, 'system.version', '1.0.0')],
    ['system.currencies', get(app, 'system.currencies', ['aUEC', 'КП'])],
    ['system.baseCurrency', get(app, 'system.baseCurrency', 'aUEC')],
    ['system.rates', get(app, 'system.rates', { aUEC: 1, КП: 0.9 })],
    ['directories.productTypes', get(app, 'directories.productTypes', ['Услуга', 'Товар'])],
    [
      'directories.showcaseStatuses',
      get(app, 'directories.showcaseStatuses', ['На витрине', 'Скрыт']),
    ],
    [
      'directories.warehouseLocations',
      get(app, 'directories.warehouseLocations', ['Основной склад', 'Резервный склад']),
    ],
  ];
  for (const [key, value] of entries) {
    await query(
      `INSERT INTO settings(key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)]
    );
  }
}

async function upsertDiscord(app) {
  const ds = get(app, 'system.discord', {});
  const enable = !!ds.enable;
  const clientId = ds.clientId || null;
  const clientSecret = ds.clientSecret || null;
  const redirectUri = ds.redirectUri || null;
  const defaultAccountType = ds.defaultAccountType || 'Гость';

  await query(
    `INSERT INTO discord_settings(id, enable, client_id, client_secret, redirect_uri, default_account_type)
     VALUES (1, $1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET enable = EXCLUDED.enable, client_id = EXCLUDED.client_id, client_secret = EXCLUDED.client_secret,
       redirect_uri = EXCLUDED.redirect_uri, default_account_type = EXCLUDED.default_account_type`,
    [enable, clientId, clientSecret, redirectUri, defaultAccountType]
  );

  const attr = Array.isArray(ds.attributeMappings) ? ds.attributeMappings : [];
  const guild = Array.isArray(ds.guildMappings) ? ds.guildMappings : [];

  // Recreate mappings idempotently (simple approach)
  await query('DELETE FROM discord_attr_mappings');
  await query('DELETE FROM discord_guild_mappings');

  for (const r of attr) {
    await query(
      `INSERT INTO discord_attr_mappings(source, key, value, account_type, guild_id, set)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        r.source,
        r.key,
        String(r.value),
        r.accountType || null,
        r.guildId || null,
        r.set ? JSON.stringify(r.set) : null,
      ]
    );
  }
  for (const g of guild) {
    await query(
      `INSERT INTO discord_guild_mappings(guild_id, account_type) VALUES ($1,$2)
       ON CONFLICT (guild_id) DO UPDATE SET account_type = EXCLUDED.account_type`,
      [g.guildId, g.accountType]
    );
  }
}

async function main() {
  console.log('> Stage 1 migration: start');
  await ensureSchema(); // ensure app_state exists
  await applyDDL();
  const app = (await readAppState()) || {};
  await upsertAccountTypesAndPermissions(app);
  await upsertUsers(app);
  await upsertSettings(app);
  await upsertDiscord(app);
  console.log('> Stage 1 migration: done');
}

main().catch((e) => {
  console.error('Stage 1 migration failed:', e);
  process.exit(1);
});
