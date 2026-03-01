const http = require('http');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { query } = require('../../db');
const { authenticateToken, requirePermission } = require('../../middleware/auth');
const { createServiceApp } = require('../_shared/createServiceApp');

process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'users-service';

const app = createServiceApp();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

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
  return {
    finance: 'read',
    warehouse: 'read',
    showcase: 'read',
    users: 'none',
    directories: 'none',
    settings: 'none',
  };
};

// Admin: change another user's password (local accounts only)
app.post(
  '/api/users/:id/password',
  authenticateToken,
  requirePermission('users', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const { newPassword } = req.body || {};
      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 4) {
        return res.status(400).json({ error: 'Новый пароль некорректен (минимум 4 символа)' });
      }
      const ures = await query('SELECT id, auth_type FROM users WHERE id = $1', [id]);
      if (ures.rowCount === 0) return res.status(404).json({ error: 'Пользователь не найден' });
      const user = ures.rows[0];
      if (user.auth_type !== 'local') {
        return res.status(400).json({ error: 'Сменить пароль можно только для локальных аккаунтов' });
      }
      const newHash = crypto.createHash('sha256').update(newPassword).digest('hex');
      await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
      res.json({ success: true });
    } catch (error) {
      console.error('POST /api/users/:id/password error:', error);
      res.status(500).json({ error: 'Ошибка смены пароля' });
    }
  }
);

app.post('/api/users', authenticateToken, requirePermission('users', 'write'), async (req, res) => {
  try {
    const { username, email, password, accountType, isActive, nickname } = req.body || {};
    if (!username || !password || !accountType)
      return res.status(400).json({ error: 'Необходимы username, password и accountType' });
    const id = `u_${Date.now()}`;
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    await query(
      `INSERT INTO users(id, username, email, nickname, auth_type, password_hash, account_type, is_active, created_at)
       VALUES($1,$2,$3,$4,'local',$5,$6,COALESCE($7, TRUE), now())`,
      [
        id,
        username,
        email || null,
        nickname || null,
        hash,
        accountType,
        typeof isActive === 'boolean' ? isActive : true,
      ]
    );
    const perms = await getPermissionsForTypeDb(accountType);
    res.json({
      success: true,
      user: {
        id,
        username,
        nickname: nickname || null,
        email,
        authType: 'local',
        accountType,
        isActive: isActive !== false,
        permissions: perms,
      },
    });
  } catch (error) {
    console.error('POST /api/users error:', error);
    res.status(500).json({ error: 'Ошибка создания пользователя' });
  }
});

app.delete(
  '/api/users/:id',
  authenticateToken,
  requirePermission('users', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      await query('DELETE FROM users WHERE id = $1', [id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка удаления пользователя' });
    }
  }
);

app.get('/api/users', authenticateToken, requirePermission('users', 'read'), async (req, res) => {
  try {
    const ures = await query(
      'SELECT id, username, email, nickname, auth_type, account_type, is_active, discord_id, discord_data, created_at, last_login FROM users'
    );
    const result = [];
    for (const u of ures.rows) {
      const perms = await getPermissionsForTypeDb(u.account_type);
      let avatarUrl;
      if (u.auth_type === 'discord') {
        try {
          const d = typeof u.discord_data === 'object' ? u.discord_data : JSON.parse(u.discord_data || 'null');
          if (d && d.id && d.avatar) {
            avatarUrl = `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png`;
          }
        } catch (_) {}
      }
      result.push({
        id: u.id,
        username: u.username,
        nickname: u.nickname || null,
        email: u.email,
        authType: u.auth_type,
        accountType: u.account_type,
        permissions: perms,
        isActive: u.is_active !== false,
        discordId: u.discord_id || undefined,
        avatarUrl,
        createdAt: u.created_at ? new Date(u.created_at).toISOString() : undefined,
        lastLogin: u.last_login ? new Date(u.last_login).toISOString() : undefined,
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка чтения пользователей' });
  }
});

app.put(
  '/api/users/:id',
  authenticateToken,
  requirePermission('users', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const { username, email, accountType, isActive, nickname } = req.body || {};
      const ures = await query('SELECT * FROM users WHERE id = $1', [id]);
      if (ures.rowCount === 0) return res.status(404).json({ error: 'Пользователь не найден' });
      const dbUser = ures.rows[0];

      const fields = [];
      const values = [];
      let i = 1;
      if (typeof username === 'string' && username.trim() !== '') {
        if (dbUser.auth_type === 'discord') {
          // Forbid renaming discord-linked accounts
        } else {
          fields.push(`username = $${i++}`);
          values.push(username.trim());
        }
      }
      if (typeof email === 'string') {
        fields.push(`email = $${i++}`);
        values.push(email || null);
      }
      if (typeof nickname === 'string') {
        fields.push(`nickname = $${i++}`);
        values.push(nickname || null);
      }
      if (typeof accountType === 'string' && accountType.trim() !== '') {
        fields.push(`account_type = $${i++}`);
        values.push(accountType.trim());
      }
      if (typeof isActive === 'boolean') {
        fields.push(`is_active = $${i++}`);
        values.push(isActive);
      }
      if (fields.length === 0) return res.json({ success: true });
      values.push(id);
      await query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`, values);

      const updated = (
        await query(
          'SELECT id, username, email, auth_type, account_type, is_active FROM users WHERE id = $1',
          [id]
        )
      ).rows[0];
      const perms = await getPermissionsForTypeDb(updated.account_type);
      res.json({
        success: true,
        user: {
          id: updated.id,
          username: updated.username,
          email: updated.email,
          authType: updated.auth_type,
          accountType: updated.account_type,
          isActive: updated.is_active !== false,
          permissions: perms,
        },
      });
    } catch (error) {
      console.error('PUT /api/users/:id error:', error);
      res.status(500).json({ error: 'Ошибка обновления пользователя' });
    }
  }
);

app.post('/api/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'Укажите текущий и новый пароль' });
    const ures = await query('SELECT id, password_hash, auth_type FROM users WHERE id = $1', [
      req.user.id,
    ]);
    if (ures.rowCount === 0) return res.status(404).json({ error: 'Пользователь не найден' });
    const user = ures.rows[0];
    if (user.auth_type !== 'local')
      return res.status(400).json({ error: 'Пароль можно менять только для локальных аккаунтов' });
    const currentHash = crypto.createHash('sha256').update(currentPassword).digest('hex');
    if (user.password_hash !== currentHash)
      return res.status(401).json({ error: 'Текущий пароль неверный' });
    const newHash = crypto.createHash('sha256').update(newPassword).digest('hex');
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
    res.json({ success: true, message: 'Пароль успешно изменен' });
  } catch (error) {
    console.error('POST /api/change-password error:', error);
    res.status(500).json({ error: 'Ошибка смены пароля' });
  }
});

const port = Number(process.env.PORT || 3001);
http.createServer(app).listen(port, '0.0.0.0', () => {
  console.log(`[users-service] listening on :${port}`);
});
