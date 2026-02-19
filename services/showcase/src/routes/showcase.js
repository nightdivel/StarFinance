import { Router } from 'express';
import { pool } from '../db.js';

const warehouseBaseUrl = process.env.WAREHOUSE_URL || 'http://warehouse:4004';

const router = Router();

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
    const itemRes = await fetch(`${warehouseBaseUrl}/internal/warehouse/items/${warehouseItemId}`);
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
