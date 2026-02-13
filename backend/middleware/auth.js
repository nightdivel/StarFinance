const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { JWT_CONFIG } = require('../config/serverConfig');
const { query } = require('../db');

// --- Helpers ---------------------------------------------------------------

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generateAccessToken(userId) {
  return jwt.sign({ id: userId }, JWT_CONFIG.SECRET, {
    expiresIn: JWT_CONFIG.EXPIRY,
  });
}

function generateRefreshToken(userId) {
  return jwt.sign({ id: userId, type: 'refresh' }, JWT_CONFIG.REFRESH_SECRET, {
    expiresIn: JWT_CONFIG.REFRESH_EXPIRY,
  });
}

async function storeRefreshToken(userId, refreshToken, { userAgent, ip } = {}) {
  const payload = jwt.decode(refreshToken, { json: true }) || {};
  const expiresAt = payload.exp ? new Date(payload.exp * 1000) : null;
  await query(
    `INSERT INTO refresh_tokens (token_hash, user_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (token_hash) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         expires_at = EXCLUDED.expires_at,
         user_agent = COALESCE(EXCLUDED.user_agent, refresh_tokens.user_agent),
         ip = COALESCE(EXCLUDED.ip, refresh_tokens.ip),
         revoked_at = NULL,
         updated_at = now()`,
    [hashToken(refreshToken), userId, expiresAt, userAgent || null, ip || null]
  );
  return expiresAt;
}

async function issueAuthTokens(userId, meta = {}) {
  const accessToken = generateAccessToken(userId);
  const refreshToken = generateRefreshToken(userId);
  const refreshExpiresAt = await storeRefreshToken(userId, refreshToken, meta);
  return { accessToken, refreshToken, refreshExpiresAt };
}

async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) return;
  await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hashToken(refreshToken)]);
}

async function revokeAllRefreshTokensForUser(userId) {
  if (!userId) return;
  await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
}

async function verifyRefreshToken(refreshToken) {
  if (!refreshToken) {
    const error = new Error('Refresh-токен обязателен');
    error.statusCode = 400;
    throw error;
  }
  let payload;
  try {
    payload = jwt.verify(refreshToken, JWT_CONFIG.REFRESH_SECRET);
  } catch (err) {
    err.statusCode = 401;
    throw err;
  }
  if (!payload?.id) {
    const error = new Error('Некорректный payload refresh-токена');
    error.statusCode = 401;
    throw error;
  }
  const { rows } = await query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [
    hashToken(refreshToken),
  ]);
  const record = rows[0];
  if (!record) {
    const error = new Error('Refresh-токен не найден или отозван');
    error.statusCode = 401;
    throw error;
  }
  if (record.revoked_at || (record.expires_at && new Date(record.expires_at) < new Date())) {
    await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hashToken(refreshToken)]);
    const error = new Error('Refresh-токен истёк или отозван');
    error.statusCode = 401;
    throw error;
  }
  return { userId: payload.id, record };
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
  generateAccessToken,
  generateRefreshToken,
  issueAuthTokens,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
  authenticateToken,
  requirePermission,
  requireAnyPermission,
};
