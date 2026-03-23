const createDataHelpers = ({ query }) => {
  if (typeof query !== 'function') throw new Error('createDataHelpers: query is required');

  const readSettingsMap = async () => {
    const map = {};
    try {
      const res = await query('SELECT key, value FROM settings');
      for (const r of res.rows) {
        map[r.key] = r.value;
      }
    } catch (_) {}
    return map;
  };

  const getPermissionsForTypeDb = async (typeName) => {
    try {
      const res = await query(
        'SELECT resource, level FROM account_type_permissions WHERE account_type = $1',
        [typeName]
      );
      if (res.rows.length > 0) {
        return Object.fromEntries(res.rows.map((r) => [r.resource, r.level]));
      }
    } catch (_) {}
    // Fallback default minimal permissions
    return {
      finance: 'read',
      warehouse: 'read',
      showcase: 'read',
      users: 'none',
      directories: 'none',
      settings: 'none',
    };
  };

  const getPermissionsForTypesDb = async (typeNames) => {
    const types = Array.from(
      new Set((Array.isArray(typeNames) ? typeNames : []).filter(Boolean))
    );
    const map = new Map();
    if (types.length === 0) return map;
    try {
      const res = await query(
        'SELECT account_type, resource, level FROM account_type_permissions WHERE account_type = ANY($1)',
        [types]
      );
      for (const r of res.rows) {
        if (!map.has(r.account_type)) map.set(r.account_type, {});
        map.get(r.account_type)[r.resource] = r.level;
      }
    } catch (_) {}
    return map;
  };

  return { readSettingsMap, getPermissionsForTypeDb, getPermissionsForTypesDb };
};

module.exports = { createDataHelpers };
