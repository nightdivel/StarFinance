import { Router } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { createUser, deleteUser, listUsers, updateUserPassword } from '../repositories/users.js';

const router = Router();

router.get('/api/users', authenticateToken, requirePermission('users', 'read'), async (_req, res) => {
  try {
    const rows = await listUsers();
    const result = rows.map((u) => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname || null,
      email: u.email,
      authType: u.auth_type,
      accountType: u.account_type,
      isActive: u.is_active !== false,
      discordId: u.discord_id || undefined,
      createdAt: u.created_at ? new Date(u.created_at).toISOString() : undefined,
      lastLogin: u.last_login ? new Date(u.last_login).toISOString() : undefined,
    }));
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения пользователей' });
  }
});

router.post('/api/users', authenticateToken, requirePermission('users', 'write'), async (req, res) => {
  try {
    const { id, username, email, password, accountType, authType } = req.body || {};
    if (!username || !accountType) {
      return res.status(400).json({ error: 'username и accountType обязательны' });
    }
    const user = await createUser({ id, username, email, password, accountType, authType });
    return res.json({ success: true, id: user.id });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сохранения пользователя' });
  }
});

router.post(
  '/api/users/:id/password',
  authenticateToken,
  requirePermission('users', 'write'),
  async (req, res) => {
    try {
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ error: 'Пароль обязателен' });
      await updateUserPassword(req.params.id, password);
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: 'Ошибка обновления пароля' });
    }
  }
);

router.delete('/api/users/:id', authenticateToken, requirePermission('users', 'write'), async (req, res) => {
  try {
    await deleteUser(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка удаления пользователя' });
  }
});

export default router;
