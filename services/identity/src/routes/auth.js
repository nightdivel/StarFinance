import { Router } from 'express';
import { findUserById, findUserByUsername, getUserWithPermissions, verifyPassword, updateUserPassword } from '../repositories/users.js';
import { issueAuthTokens, verifyRefreshToken, revokeRefreshToken } from '../repositories/tokens.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Необходимо указать имя пользователя и пароль' });
    }
    const user = await findUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const tokens = await issueAuthTokens(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    const { permissions } = await getUserWithPermissions(user.id);

    return res.json({
      authToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      refreshExpiresAt: tokens.refreshExpiresAt,
      username: user.username,
      accountType: user.account_type,
      permissions,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/api/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Необходимы currentPassword и newPassword' });
    }
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.auth_type !== 'local') {
      return res.status(400).json({ error: 'Сменить пароль можно только для локальных аккаунтов' });
    }
    const ok = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) return res.status(400).json({ error: 'Текущий пароль неверен' });
    await updateUserPassword(user.id, newPassword);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка смены пароля' });
  }
});

router.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    const { userId } = await verifyRefreshToken(refreshToken);
    const tokens = await issueAuthTokens(userId, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    return res.json({
      authToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      refreshExpiresAt: tokens.refreshExpiresAt,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'Ошибка сервера' });
  }
});

router.post('/auth/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    await revokeRefreshToken(refreshToken);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/auth/profile', authenticateToken, async (req, res) => {
  try {
    const { user, permissions } = await getUserWithPermissions(req.user.id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    let avatarUrl;
    if (user.auth_type === 'discord') {
      try {
        const data = typeof user.discord_data === 'object'
          ? user.discord_data
          : JSON.parse(user.discord_data || 'null');
        if (data?.id && data?.avatar) {
          avatarUrl = `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`;
        }
      } catch (_) {}
    }
    return res.json({
      id: user.id,
      username: user.username,
      nickname: user.nickname || null,
      accountType: user.account_type,
      permissions,
      authType: user.auth_type,
      isActive: user.is_active !== false,
      avatarUrl,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка получения профиля' });
  }
});

export default router;
