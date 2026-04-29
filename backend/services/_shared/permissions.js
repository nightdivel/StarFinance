const { query } = require('../../db');

async function getPermissionsForTypeDb(typeName) {
  try {
    const res = await query(
      'SELECT resource, level FROM account_type_permissions WHERE account_type = $1',
      [typeName]
    );
    if (res.rows.length > 0) {
      return Object.fromEntries(res.rows.map((r) => [r.resource, r.level]));
    }
  } catch (_) {}

  return {
    finance: 'read',
    warehouse: 'read',
    showcase: 'read',
    users: 'none',
    directories: 'none',
    settings: 'none',
    requests: 'read',
    news: 'read',
    tools: 'read',
  };
}

module.exports = { getPermissionsForTypeDb };
