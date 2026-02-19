import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

const warehouseBaseUrl = process.env.WAREHOUSE_URL || 'http://warehouse:4004';
const financeBaseUrl = process.env.FINANCE_URL || 'http://finance:4007';
const identityBaseUrl = process.env.IDENTITY_URL || 'http://identity:4001';

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

async function fetchPermissions(req) {
  const authHeader = req.headers.authorization || '';
  const resp = await fetch(`${identityBaseUrl}/auth/profile`, {
    headers: { Authorization: authHeader },
  });
  if (!resp.ok) {
    const err = new Error('Не удалось получить permissions');
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  return data?.permissions || {};
}

function requirePermission(resource, level) {
  const levels = { none: 0, read: 1, write: 2 };
  return async (req, res, next) => {
    try {
      const permissions = await fetchPermissions(req);
      const userLevel = levels[permissions?.[resource] ?? 'none'] ?? 0;
      const required = levels[level] ?? 0;
      if (userLevel < required) return res.status(403).json({ error: 'Недостаточно прав' });
      return next();
    } catch (error) {
      return res.status(error.status || 503).json({ error: 'Ошибка проверки прав доступа' });
    }
  };
}
router.use('/api', authenticateToken);

router.get('/api/requests', requirePermission('requests', 'read'), async (_req, res) => {
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
    const buyerUserId = req.user?.id || null;
    if (!buyerUserId) return res.status(401).json({ error: 'Пользователь не определен' });
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
    const buyerUserId = req.user?.id || null;
    if (!buyerUserId) return res.status(401).json({ error: 'Пользователь не определен' });
    const rows = await pool.query(
      'SELECT id, warehouse_item_id, buyer_user_id, buyer_username, quantity, status, created_at, updated_at FROM purchase_requests WHERE buyer_user_id = $1 ORDER BY created_at DESC',
      [buyerUserId]
    );
    return res.json(rows.rows);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения заявок' });
  }
});

router.post('/api/requests', requirePermission('requests', 'write'), async (req, res) => {
  try {
    const { warehouseItemId, quantity, buyerUsername } = req.body || {};
    const qty = Number(quantity);
    const buyerUserId = req.user?.id || null;
    if (!warehouseItemId || !(qty > 0)) return res.status(400).json({ error: 'Некорректные данные' });
    if (!buyerUserId) return res.status(401).json({ error: 'Пользователь не определен' });
    const reserveRes = await fetch(`${warehouseBaseUrl}/internal/warehouse/items/${warehouseItemId}/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(INTERNAL_TOKEN ? { 'x-internal-token': INTERNAL_TOKEN } : {}),
      },
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

router.put('/api/requests/:id/confirm', requirePermission('requests', 'write'), async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT warehouse_item_id, buyer_user_id, quantity, status FROM purchase_requests WHERE id = $1',
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Заявка не найдена' });
    if (r.rows[0].status === 'Выполнено') return res.json({ success: true });

    const itemRes = await fetch(`${warehouseBaseUrl}/internal/warehouse/items/${r.rows[0].warehouse_item_id}`, {
      headers: INTERNAL_TOKEN ? { 'x-internal-token': INTERNAL_TOKEN } : {},
    });
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

router.put('/api/requests/:id/cancel', requirePermission('requests', 'write'), async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT warehouse_item_id, quantity, status FROM purchase_requests WHERE id = $1',
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Заявка не найдена' });
    if (r.rows[0].status === 'Отменена') return res.json({ success: true });

    await fetch(`${warehouseBaseUrl}/internal/warehouse/items/${r.rows[0].warehouse_item_id}/release`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(INTERNAL_TOKEN ? { 'x-internal-token': INTERNAL_TOKEN } : {}),
      },
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

router.delete('/api/requests/:id', requirePermission('requests', 'write'), async (req, res) => {
  try {
    await pool.query('DELETE FROM purchase_requests WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка удаления заявки' });
  }
});

export default router;
