import { pool } from '../db.js';

export async function listAccountTypes() {
  const at = await pool.query('SELECT name FROM account_types ORDER BY name');
  const result = [];
  for (const row of at.rows) {
    const perms = await pool.query(
      'SELECT resource, level FROM account_type_permissions WHERE account_type = $1',
      [row.name]
    );
    result.push({
      name: row.name,
      permissions: Object.fromEntries(perms.rows.map((p) => [p.resource, p.level])),
    });
  }
  return result;
}

export async function saveAccountType({ name, permissions }) {
  await pool.query('INSERT INTO account_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
  if (permissions && typeof permissions === 'object') {
    for (const [resource, level] of Object.entries(permissions)) {
      if (!level) continue;
      await pool.query(
        `INSERT INTO account_type_permissions(account_type, resource, level) VALUES ($1,$2,$3)
         ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level`,
        [name, resource, level]
      );
    }
  }
}

export async function updateAccountType({ currentName, name, permissions }) {
  if (name && name !== currentName) {
    await pool.query('UPDATE account_types SET name = $1 WHERE name = $2', [name, currentName]);
  }
  const target = name || currentName;
  if (permissions && typeof permissions === 'object') {
    for (const [resource, level] of Object.entries(permissions)) {
      if (!level) continue;
      await pool.query(
        `INSERT INTO account_type_permissions(account_type, resource, level) VALUES ($1,$2,$3)
         ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level`,
        [target, resource, level]
      );
    }
  }
  const perms = await pool.query(
    'SELECT resource, level FROM account_type_permissions WHERE account_type = $1',
    [target]
  );
  return {
    name: target,
    permissions: Object.fromEntries(perms.rows.map((p) => [p.resource, p.level])),
  };
}

export async function deleteAccountType(name) {
  await pool.query('DELETE FROM account_type_permissions WHERE account_type = $1', [name]);
  await pool.query('DELETE FROM account_types WHERE name = $1', [name]);
}
