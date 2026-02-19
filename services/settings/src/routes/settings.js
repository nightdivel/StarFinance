import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

function authenticateToken(req, res, next) {
  if (!JWT_SECRET) return res.status(500).json({ error: 'JWT_SECRET не настроен' });
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Токен доступа отсутствует' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(403).json({ error: 'Недействительный токен' });
  }
}

router.use('/api', authenticateToken);

router.get('/api/system/settings', async (_req, res) => {
  try {
    const rows = await pool.query('SELECT key, value FROM settings');
    return res.json(Object.fromEntries(rows.rows.map((r) => [r.key, r.value])));
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения настроек' });
  }
});

router.put('/api/system/settings', async (req, res) => {
  try {
    const payload = req.body || {};
    if (typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'Некорректный формат настроек' });
    }
    const entries = Object.entries(payload);
    for (const [key, value] of entries) {
      await pool.query(
        `INSERT INTO settings(key, value, updated_at) VALUES ($1,$2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)]
      );
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сохранения настроек' });
  }
});

router.get('/api/discord/scopes', async (_req, res) => {
  try {
    const rows = await pool.query('SELECT name FROM discord_scopes ORDER BY name');
    return res.json(rows.rows.map((r) => r.name));
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения справочника scopes' });
  }
});

router.post('/api/discord/scopes', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Некорректное имя scope' });
    }
    await pool.query('INSERT INTO discord_scopes(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
      name.trim(),
    ]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка добавления scope' });
  }
});

router.delete('/api/discord/scopes/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name || '');
    if (!name) return res.status(400).json({ error: 'Имя не указано' });
    await pool.query('DELETE FROM discord_scopes WHERE name = $1', [name]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка удаления scope' });
  }
});

router.get('/api/discord/scope-mappings', async (_req, res) => {
  try {
    const rows = await pool.query(
      'SELECT scope, value, account_type, position FROM discord_scope_mappings ORDER BY (position IS NULL), position, scope, value'
    );
    return res.json(rows.rows);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения маппингов' });
  }
});

router.post('/api/discord/scope-mappings', async (req, res) => {
  try {
    const { scope, value, accountType, position } = req.body || {};
    if (!scope || !accountType) return res.status(400).json({ error: 'Укажите scope и тип' });
    let pos = position;
    if (pos == null) {
      const max = await pool.query('SELECT COALESCE(MAX(position), 0) AS max_pos FROM discord_scope_mappings');
      pos = Number(max.rows?.[0]?.max_pos || 0) + 1;
    }
    await pool.query(
      `INSERT INTO discord_scope_mappings(scope, value, account_type, position) VALUES ($1,$2,$3,$4)
       ON CONFLICT (scope, value) DO UPDATE SET account_type = EXCLUDED.account_type, position = COALESCE(EXCLUDED.position, discord_scope_mappings.position)`,
      [scope, value ?? null, accountType, pos]
    );
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сохранения маппинга' });
  }
});

router.delete('/api/discord/scope-mappings', async (req, res) => {
  try {
    const { scope, value } = req.query || {};
    if (!scope) return res.status(400).json({ error: 'Укажите scope' });
    await pool.query('DELETE FROM discord_scope_mappings WHERE scope = $1 AND value IS NOT DISTINCT FROM $2', [
      scope,
      value ?? null,
    ]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка удаления маппинга' });
  }
});

export default router;
