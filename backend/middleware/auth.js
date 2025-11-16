const jwt = require('jsonwebtoken');
const { JWT_CONFIG } = require('../config/serverConfig');
const { query } = require('../db');

// Генерация JWT токена
function generateToken(userId) {
  return jwt.sign({ id: userId }, JWT_CONFIG.SECRET, {
    expiresIn: JWT_CONFIG.EXPIRY,
  });
}

// Аутентификация токена
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Токен доступа отсутствует' });
  }

  jwt.verify(token, JWT_CONFIG.SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Недействительный токен' });
    }
    req.user = user;
    next();
  });
}

// Проверка прав доступа
async function loadUserAndPermissions(userId) {
  const { rows } = await query(
    'SELECT id, username, account_type, is_active FROM users WHERE id = $1',
    [userId]
  );
  const user = rows[0];
  if (!user || user.is_active === false) return { user: null, permissions: {} };
  const permsRes = await query(
    'SELECT resource, level FROM account_type_permissions WHERE account_type = $1',
    [user.account_type]
  );
  const permissions = Object.fromEntries(permsRes.rows.map((r) => [r.resource, r.level]));
  return { user, permissions };
}

function requirePermission(resource, level) {
  return async (req, res, next) => {
    try {
      const { user, permissions } = await loadUserAndPermissions(req.user.id);
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      // Администратор — всегда можно (серверный суперюзер)
      if (user.account_type === 'Администратор') return next();
      const userPermission = permissions[resource];
      if (!userPermission) return res.status(403).json({ error: 'Доступ запрещен' });
      const permissionLevels = { none: 0, read: 1, write: 2 };
      const requiredLevel = permissionLevels[level];
      const userLevel = permissionLevels[userPermission];
      if ((userLevel ?? 0) < requiredLevel)
        return res.status(403).json({ error: 'Недостаточно прав' });
      next();
    } catch (error) {
      res.status(500).json({ error: 'Ошибка проверки прав доступа' });
    }
  };
}

function requireAnyPermission(resources, level) {
  const permissionLevels = { none: 0, read: 1, write: 2 };
  const requiredLevel = permissionLevels[level];
  return async (req, res, next) => {
    try {
      const { user, permissions } = await loadUserAndPermissions(req.user.id);
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      // Администратор — всегда можно (серверный суперюзер)
      if (user.account_type === 'Администратор') return next();
      for (const r of resources) {
        const userPermission = permissions[r];
        const userLevel = permissionLevels[userPermission];
        if ((userLevel ?? 0) >= requiredLevel) return next();
      }
      return res.status(403).json({ error: 'Недостаточно прав' });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка проверки прав доступа' });
    }
  };
}

module.exports = {
  generateToken,
  authenticateToken,
  requirePermission,
  requireAnyPermission,
};
