import { Router } from 'express';
import { pool } from '../db.js';

const warehouseBaseUrl = process.env.WAREHOUSE_URL || 'http://warehouse:4004';
const financeBaseUrl = process.env.FINANCE_URL || 'http://finance:4007';

const router = Router();

router.get('/api/requests', async (_req, res) => {
  try {
    const rows = await pool.query(
      'SELECT id, warehouse_item_id, buyer_user_id, buyer_username, quantity, status, created_at, updated_at FROM purchase_requests ORDER BY created_at DESC'
    );
    return res.json(rows.rows);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения заявок' });
  }
});

router.get('/api/my/requests', async (req, res) => {
  try {
    const buyerUserId = req.query?.buyerUserId || null;
    if (!buyerUserId) return res.status(400).json({ error: 'buyerUserId обязателен' });
    const rows = await pool.query(
      'SELECT id, warehouse_item_id, buyer_user_id, buyer_username, quantity, status, created_at, updated_at FROM purchase_requests WHERE buyer_user_id = $1 ORDER BY created_at DESC',
      [buyerUserId]
    );
    return res.json(rows.rows);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения заявок' });
  }
});

router.get('/api/requests/related', async (req, res) => {
  try {
    const buyerUserId = req.query?.buyerUserId || null;
    if (!buyerUserId) return res.status(400).json({ error: 'buyerUserId обязателен' });
    const rows = await pool.query(
      'SELECT id, warehouse_item_id, buyer_user_id, buyer_username, quantity, status, created_at, updated_at FROM purchase_requests WHERE buyer_user_id = $1 ORDER BY created_at DESC',
      [buyerUserId]
    );
    return res.json(rows.rows);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения заявок' });
  }
});

router.post('/api/requests', async (req, res) => {
  try {
    const { warehouseItemId, quantity, buyerUserId, buyerUsername } = req.body || {};
    const qty = Number(quantity);
    if (!warehouseItemId || !(qty > 0)) return res.status(400).json({ error: 'Некорректные данные' });
    const reserveRes = await fetch(`${warehouseBaseUrl}/internal/warehouse/items/${warehouseItemId}/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty }),
    });
    if (!reserveRes.ok) {
      const detail = await reserveRes.json().catch(() => ({}));
      return res.status(400).json({ error: detail.error || 'Не удалось зарезервировать товар' });
    }
    const id = `r_${Date.now()}`;
    await pool.query(
      `INSERT INTO purchase_requests(id, warehouse_item_id, buyer_user_id, buyer_username, quantity, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, warehouseItemId, buyerUserId || null, buyerUsername || null, qty, 'В обработке']
    );
    return res.json({ success: true, request: { id, warehouseItemId, quantity: qty, status: 'В обработке' } });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка создания заявки' });
  }
});

router.put('/api/requests/:id/confirm', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT warehouse_item_id, buyer_user_id, quantity, status FROM purchase_requests WHERE id = $1',
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Заявка не найдена' });
    if (r.rows[0].status === 'Выполнено') return res.json({ success: true });

    const itemRes = await fetch(`${warehouseBaseUrl}/internal/warehouse/items/${r.rows[0].warehouse_item_id}`);
    if (!itemRes.ok) return res.status(400).json({ error: 'Товар не найден' });
    const item = await itemRes.json();
    const amount = Math.ceil((Number(item.cost) || 0) * (Number(r.rows[0].quantity) || 0));

    await fetch(`${financeBaseUrl}/api/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'income',
        amount,
        currency: item.currency,
        fromUser: r.rows[0].buyer_user_id || null,
        toUser: item.owner_login || null,
        itemId: r.rows[0].warehouse_item_id,
        meta: { reqId: req.params.id },
      }),
    });

    await pool.query('UPDATE purchase_requests SET status = $2, updated_at = now() WHERE id = $1', [
      req.params.id,
      'Выполнено',
    ]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка подтверждения заявки' });
  }
});

router.put('/api/requests/:id/cancel', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT warehouse_item_id, quantity, status FROM purchase_requests WHERE id = $1',
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Заявка не найдена' });
    if (r.rows[0].status === 'Отменена') return res.json({ success: true });

    await fetch(`${warehouseBaseUrl}/internal/warehouse/items/${r.rows[0].warehouse_item_id}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qty: Number(r.rows[0].quantity) || 0 }),
    });

    await pool.query('UPDATE purchase_requests SET status = $2, updated_at = now() WHERE id = $1', [
      req.params.id,
      'Отменена',
    ]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка отмены заявки' });
  }
});

router.delete('/api/requests/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM purchase_requests WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка удаления заявки' });
  }
});

export default router;
