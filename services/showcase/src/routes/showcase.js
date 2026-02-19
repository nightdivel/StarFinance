import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

const warehouseBaseUrl = process.env.WAREHOUSE_URL || 'http://warehouse:4004';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN;

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

router.get('/api/showcase', async (_req, res) => {
  try {
    const rows = await pool.query(
      'SELECT id, warehouse_item_id, status, price, currency, meta, created_at, updated_at FROM showcase_items ORDER BY created_at DESC'
    );
    return res.json(rows.rows);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения витрины' });
  }
});

router.post('/api/showcase', async (req, res) => {
  try {
    const { id, warehouseItemId, status, price, currency, meta, ownerLogin } = req.body || {};
    if (!warehouseItemId) return res.status(400).json({ error: 'warehouseItemId обязателен' });
    if (price != null && !Number.isFinite(Number(price))) {
      return res.status(400).json({ error: 'Некорректная цена' });
    }
    if (currency != null && String(currency).trim() === '') {
      return res.status(400).json({ error: 'Некорректная валюта' });
    }
    const itemRes = await fetch(`${warehouseBaseUrl}/internal/warehouse/items/${warehouseItemId}`, {
      headers: INTERNAL_TOKEN ? { 'x-internal-token': INTERNAL_TOKEN } : {},
    });
    if (!itemRes.ok) return res.status(400).json({ error: 'Связанный товар не найден' });
    const item = await itemRes.json();
    if (ownerLogin && item.owner_login && ownerLogin !== item.owner_login) {
      return res.status(403).json({ error: 'Недостаточно прав для размещения товара на витрине' });
    }
    const newId = id || `s_${Date.now()}`;
    await pool.query(
      `INSERT INTO showcase_items(id, warehouse_item_id, status, price, currency, meta, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (id) DO UPDATE SET warehouse_item_id = EXCLUDED.warehouse_item_id, status = EXCLUDED.status,
         price = EXCLUDED.price, currency = EXCLUDED.currency, meta = EXCLUDED.meta, updated_at = now()`,
      [newId, warehouseItemId, status || null, price ?? null, currency || null, meta ? JSON.stringify(meta) : null]
    );
    const row = await pool.query(
      'SELECT id, warehouse_item_id, status, price, currency, meta, created_at, updated_at FROM showcase_items WHERE id = $1',
      [newId]
    );
    return res.json({ success: true, item: row.rows[0] });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сохранения витрины' });
  }
});

router.delete('/api/showcase/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM showcase_items WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка удаления витрины' });
  }
});

export default router;
