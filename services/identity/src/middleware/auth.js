import jwt from 'jsonwebtoken';
import { CONFIG } from '../config.js';
import { getUserWithPermissions } from '../repositories/users.js';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Токен доступа отсутствует' });
  try {
    const payload = jwt.verify(token, CONFIG.jwtSecret);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(403).json({ error: 'Недействительный токен' });
  }
}

export function requirePermission(resource, level) {
  const levels = { none: 0, read: 1, write: 2 };
  return async (req, res, next) => {
    try {
      const { user, permissions } = await getUserWithPermissions(req.user?.id);
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      if (user.account_type === 'Администратор') return next();
      const userLevel = levels[permissions?.[resource] ?? 'none'] ?? 0;
      const required = levels[level] ?? 0;
      if (userLevel < required) return res.status(403).json({ error: 'Недостаточно прав' });
      return next();
    } catch (error) {
      return res.status(500).json({ error: 'Ошибка проверки прав доступа' });
    }
  };
}
