import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

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

function authenticateInternal(req, res, next) {
  if (!INTERNAL_TOKEN) return res.status(500).json({ error: 'INTERNAL_TOKEN не настроен' });
  const token = req.headers['x-internal-token'] || '';
  if (token !== INTERNAL_TOKEN) return res.status(403).json({ error: 'Недоступно' });
  return next();
}

router.use('/api', authenticateToken);
router.use('/internal', authenticateInternal);

router.get('/api/warehouse', async (_req, res) => {
  try {
    const rows = await pool.query(
      'SELECT id, name, type, quantity, cost, currency, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items ORDER BY created_at DESC'
    );
    return res.json(rows.rows);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения склада' });
  }
});

router.post('/api/warehouse', async (req, res) => {
  try {
    const {
      id,
      name,
      type,
      quantity,
      price,
      cost,
      currency,
      displayCurrencies,
      meta,
      warehouseType,
      ownerLogin,
    } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Название обязательно' });
    const newId = id || `w_${Date.now()}`;
    if (id) {
      const existing = await pool.query('SELECT owner_login FROM warehouse_items WHERE id = $1', [newId]);
      if (existing.rowCount > 0) {
        const currentOwner = existing.rows[0]?.owner_login || null;
        if (currentOwner && ownerLogin && currentOwner !== ownerLogin) {
          return res.status(403).json({ error: 'Недостаточно прав для обновления товара' });
        }
      }
    }
    const qty = Number(quantity ?? 0);
    if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ error: 'Некорректное количество' });
    const finalCost = cost ?? price ?? null;
    if (finalCost != null && !Number.isFinite(Number(finalCost)))
      return res.status(400).json({ error: 'Некорректная стоимость' });
    await pool.query(
      `INSERT INTO warehouse_items(id, name, type, quantity, cost, currency, display_currencies, meta, warehouse_type, owner_login, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, quantity = EXCLUDED.quantity, cost = EXCLUDED.cost,
         currency = COALESCE(EXCLUDED.currency, warehouse_items.currency), display_currencies = COALESCE(EXCLUDED.display_currencies, warehouse_items.display_currencies),
         meta = EXCLUDED.meta, warehouse_type = EXCLUDED.warehouse_type, owner_login = EXCLUDED.owner_login, updated_at = now()`,
      [
        newId,
        name,
        type || null,
        qty,
        finalCost !== undefined ? Number(finalCost) : null,
        currency || null,
        displayCurrencies || null,
        meta ? JSON.stringify(meta) : null,
        warehouseType || null,
        ownerLogin || null,
      ]
    );
    const row = await pool.query(
      'SELECT id, name, type, quantity, cost, currency, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items WHERE id = $1',
      [newId]
    );
    return res.json({ success: true, item: row.rows[0] });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сохранения товара' });
  }
});

router.put('/api/warehouse/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const {
      name,
      type,
      quantity,
      price,
      cost,
      currency,
      displayCurrencies,
      meta,
      warehouseType,
      ownerLogin,
    } = req.body || {};

    const exists = await pool.query('SELECT owner_login FROM warehouse_items WHERE id = $1', [id]);
    if (exists.rowCount === 0) return res.status(404).json({ error: 'Позиция не найдена' });
    const currentOwner = exists.rows[0]?.owner_login || null;
    if (currentOwner && ownerLogin && currentOwner !== ownerLogin) {
      return res.status(403).json({ error: 'Недостаточно прав для обновления товара' });
    }

    const finalCost = cost ?? price ?? null;
    await pool.query(
      `UPDATE warehouse_items
       SET name = COALESCE($2, name),
           type = COALESCE($3, type),
           quantity = COALESCE($4, quantity),
           cost = COALESCE($5, cost),
           currency = COALESCE($6, currency),
           display_currencies = COALESCE($7, display_currencies),
           meta = COALESCE($8, meta),
           warehouse_type = COALESCE($9, warehouse_type),
           owner_login = COALESCE($10, owner_login),
           updated_at = now()
       WHERE id = $1`,
      [
        id,
        name || null,
        type || null,
        quantity !== undefined ? Number(quantity) : null,
        finalCost !== undefined ? Number(finalCost) : null,
        currency || null,
        displayCurrencies || null,
        meta ? JSON.stringify(meta) : null,
        warehouseType || null,
        ownerLogin || null,
      ]
    );

    const row = await pool.query(
      'SELECT id, name, type, quantity, cost, currency, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items WHERE id = $1',
      [id]
    );
    return res.json({ success: true, item: row.rows[0] });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка обновления товара' });
  }
});

router.delete('/api/warehouse/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM warehouse_items WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка удаления товара' });
  }
});

router.get('/internal/warehouse/items/:id', async (req, res) => {
  try {
    const row = await pool.query(
      'SELECT id, name, owner_login, quantity, cost, currency FROM warehouse_items WHERE id = $1',
      [req.params.id]
    );
    if (row.rowCount === 0) return res.status(404).json({ error: 'Товар не найден' });
    return res.json(row.rows[0]);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения товара' });
  }
});

router.post('/internal/warehouse/items/:id/reserve', async (req, res) => {
  try {
    const qty = Number(req.body?.qty || 0);
    if (!(qty > 0)) return res.status(400).json({ error: 'Некорректное количество' });
    const { rows } = await pool.query('SELECT quantity FROM warehouse_items WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Товар не найден' });
    const available = Number(rows[0].quantity) || 0;
    if (available < qty) return res.status(400).json({ error: 'Недостаточно количества' });
    await pool.query('UPDATE warehouse_items SET quantity = quantity - $2, updated_at = now() WHERE id = $1', [
      req.params.id,
      qty,
    ]);
    return res.json({ success: true, availableAfter: available - qty });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка резервирования' });
  }
});

router.post('/internal/warehouse/items/:id/release', async (req, res) => {
  try {
    const qty = Number(req.body?.qty || 0);
    if (!(qty > 0)) return res.status(400).json({ error: 'Некорректное количество' });
    await pool.query('UPDATE warehouse_items SET quantity = quantity + $2, updated_at = now() WHERE id = $1', [
      req.params.id,
      qty,
    ]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка возврата резерва' });
  }
});

export default router;
