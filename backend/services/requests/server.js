const http = require('http');
const express = require('express');
const cors = require('cors');
const { query } = require('../../db');
const { authenticateToken, requirePermission } = require('../../middleware/auth');
const { getPermissionsForTypeDb } = require('../_shared/permissions');
const { createServiceApp } = require('../_shared/createServiceApp');

process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'requests-service';

const app = createServiceApp();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

async function ensurePurchaseRequestsTable() {
  try {
    await query(`CREATE TABLE IF NOT EXISTS purchase_requests (
      id text PRIMARY KEY,
      warehouse_item_id text NOT NULL,
      buyer_user_id text NOT NULL,
      buyer_username text,
      buyer_nickname text,
      quantity numeric NOT NULL,
      status text NOT NULL,
      created_at timestamp without time zone DEFAULT now(),
      updated_at timestamp without time zone
    )`);
    await query("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS buyer_username text").catch(() => {});
    await query("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS buyer_nickname text").catch(() => {});
  } catch (e) {
    console.warn('[requests-service] Failed to ensure purchase_requests table:', e?.message || e);
  }
}

// Fire-and-forget init
(async () => {
  await ensurePurchaseRequestsTable();
})();

// User-related requests (buyer or seller)
app.get('/api/requests/related', authenticateToken, async (req, res) => {
  try {
    const ures = await query('SELECT id, username, nickname, account_type FROM users WHERE id = $1', [req.user.id]);
    if (ures.rowCount === 0) {
      // If guest, return empty array instead of error
      if (req.user && req.user.id && req.user.id.toLowerCase().includes('guest')) {
        return res.json([]);
      }
      return res.status(401).json({ error: 'Нет пользователя' });
    }
    const me = ures.rows[0];
    // If guest by account_type, return empty array
    if (me.account_type === 'Гость') {
      return res.json([]);
    }
    const rows = (
      await query(
        `SELECT r.id, r.warehouse_item_id, r.quantity, r.status, r.created_at,
                r.buyer_user_id, r.buyer_username, r.buyer_nickname, w.name, w.cost, w.currency, w.owner_id,
                u.username as owner_username, u.nickname as owner_nickname, u.id as owner_id,
                w.owner_id as raw_owner_id
         FROM purchase_requests r
         JOIN warehouse_items w ON w.id = r.warehouse_item_id
         LEFT JOIN users u ON w.owner_id = u.id
         WHERE r.buyer_user_id = $1 OR w.owner_id = $1
         ORDER BY r.created_at DESC`,
        [me.id]
      )
    ).rows;
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения заявок' });
  }
});

// Create request (buy) — reserves quantity by decreasing warehouse quantity; forbids buying own items
app.post('/api/requests', authenticateToken, async (req, res) => {
  try {
    const { warehouseItemId, quantity } = req.body || {};
    const qty = Number(quantity);
    if (!warehouseItemId || !(qty > 0)) return res.status(400).json({ error: 'Некорректные данные' });
    const buyerId = req.user?.id;
    const buyer = (await query('SELECT id, username, nickname FROM users WHERE id = $1', [buyerId])).rows[0];
    if (!buyer) return res.status(401).json({ error: 'Нет пользователя' });
    const wres = await query(
      'SELECT id, name, owner_id, quantity, cost, currency FROM warehouse_items WHERE id = $1',
      [warehouseItemId]
    );
    if (wres.rowCount === 0) return res.status(404).json({ error: 'Товар не найден' });
    const item = wres.rows[0];
    if (item.owner_id && item.owner_id === buyer.id)
      return res.status(400).json({ error: 'Нельзя покупать свой товар' });
    const available = Number(item.quantity) || 0;
    if (qty > available) return res.status(400).json({ error: 'Недостаточное количество на складе' });

    await query('UPDATE warehouse_items SET quantity = quantity - $2, updated_at = now() WHERE id = $1', [
      warehouseItemId,
      qty,
    ]);
    const id = `r_${Date.now()}`;
    await query(
      `INSERT INTO purchase_requests(id, warehouse_item_id, buyer_user_id, buyer_username, buyer_nickname, quantity, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, warehouseItemId, buyer.id, buyer.username, buyer.nickname || null, qty, 'В обработке']
    );
    res.json({
      success: true,
      request: {
        id,
        warehouseItemId,
        buyerUserId: buyer.id,
        buyerUsername: buyer.username,
        buyerNickname: buyer.nickname || null,
        quantity: qty,
        status: 'В обработке',
      },
    });
  } catch (e) {
    console.error('POST /api/requests error:', e);
    res.status(500).json({ error: 'Ошибка создания заявки' });
  }
});

// My requests (cart)
app.get('/api/my/requests', authenticateToken, async (req, res) => {
  try {
    const me = req.user?.id;
    const rows = (
      await query(
        `SELECT r.id, r.warehouse_item_id, r.quantity, r.status, r.created_at, r.buyer_nickname, w.name, w.cost, w.currency, w.owner_id,
                u.username as owner_username, u.nickname as owner_nickname, u.id as owner_id,
                w.owner_id as raw_owner_id
         FROM purchase_requests r
         JOIN warehouse_items w ON w.id = r.warehouse_item_id
         LEFT JOIN users u ON w.owner_id = u.id
         WHERE r.buyer_user_id = $1 ORDER BY r.created_at DESC`,
        [me]
      )
    ).rows;
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения корзины' });
  }
});

// Admin: list all requests
app.get('/api/requests', authenticateToken, requirePermission('requests', 'read'), async (req, res) => {
  try {
    const rows = (
      await query(
        `SELECT r.id, r.warehouse_item_id, r.quantity, r.status, r.created_at,
          r.buyer_user_id, r.buyer_username, r.buyer_nickname, w.name, w.cost, w.currency, w.owner_id,
          u.username as owner_username, u.nickname as owner_nickname, u.id as owner_id,
          w.owner_id as raw_owner_id
         FROM purchase_requests r
         JOIN warehouse_items w ON w.id = r.warehouse_item_id
         LEFT JOIN users u ON w.owner_id = u.id
         ORDER BY r.created_at DESC`
      )
    ).rows;
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения заявок' });
  }
});

// Confirm request: mark done, create finance transaction
// Allowed: admin (requests:write) OR seller (owner of the warehouse item)
app.put('/api/requests/:id/confirm', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const rres = await query(
      'SELECT warehouse_item_id, buyer_user_id, quantity, status FROM purchase_requests WHERE id = $1',
      [id]
    );
    if (rres.rowCount === 0) return res.status(404).json({ error: 'Заявка не найдена' });
    const r = rres.rows[0];
    if (r.status === 'Выполнено') return res.json({ success: true });
    const w = (
      await query('SELECT id, owner_id, cost, currency, name FROM warehouse_items WHERE id = $1', [r.warehouse_item_id])
    ).rows[0];
    if (!w) return res.status(404).json({ error: 'Товар не найден' });

    const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
    if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
    const me = ures.rows[0];
    const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
    const isAdmin = me.account_type === 'Администратор' || perms?.requests === 'write';
    const isOwner = w.owner_id && w.owner_id === me.id;
    if (!isAdmin && !isOwner)
      return res.status(403).json({ error: 'Недостаточно прав для подтверждения заявки' });

    const buyerId = r.buyer_user_id;
    const ownerId = w.owner_id;
    const amount = Math.ceil((Number(w.cost) || 0) * (Number(r.quantity) || 0));
    const currency = w.currency;
    const tid = `t_${Date.now()}`;
    await query(
      `INSERT INTO transactions(id, type, amount, currency, from_user, to_user, item_id, meta, created_at)
       VALUES ($1,'income',$2,$3,$4,$5,$6,$7, now())`,
      [tid, amount, currency, buyerId, ownerId, r.warehouse_item_id, JSON.stringify({ reqId: id, itemName: w.name })]
    );
    await query('UPDATE purchase_requests SET status = $2, updated_at = now() WHERE id = $1', [id, 'Выполнено']);
    res.json({ success: true });
  } catch (e) {
    console.error('PUT /api/requests/:id/confirm error:', e);
    res.status(500).json({ error: 'Ошибка подтверждения заявки' });
  }
});

// Cancel request: mark cancelled and return reserved qty
// Allowed: admin (requests:write) OR original buyer
app.put('/api/requests/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const rres = await query(
      'SELECT warehouse_item_id, quantity, status, buyer_user_id FROM purchase_requests WHERE id = $1',
      [id]
    );
    if (rres.rowCount === 0) return res.status(404).json({ error: 'Заявка не найдена' });
    const r = rres.rows[0];
    if (r.status === 'Отменена') return res.json({ success: true });
    const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
    if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
    const me = ures.rows[0];
    const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
    const isAdmin = me.account_type === 'Администратор' || perms?.users === 'write';
    const isBuyer = r.buyer_user_id && r.buyer_user_id === me.id;
    if (!isAdmin && !isBuyer) return res.status(403).json({ error: 'Недостаточно прав для отмены заявки' });
    await query('UPDATE warehouse_items SET quantity = quantity + $2, updated_at = now() WHERE id = $1', [
      r.warehouse_item_id,
      Number(r.quantity),
    ]);
    await query('UPDATE purchase_requests SET status = $2, updated_at = now() WHERE id = $1', [id, 'Отменена']);
    res.json({ success: true });
  } catch (e) {
    console.error('PUT /api/requests/:id/cancel error:', e);
    res.status(500).json({ error: 'Ошибка отмены заявки' });
  }
});

// Delete request (allowed after confirm/cancel)
app.delete('/api/requests/:id', authenticateToken, requirePermission('requests', 'write'), async (req, res) => {
  try {
    const id = req.params.id;
    const r = (await query('SELECT status FROM purchase_requests WHERE id = $1', [id])).rows[0];
    if (!r) return res.status(404).json({ error: 'Не найдено' });
    if (r.status !== 'Выполнено' && r.status !== 'Отменена')
      return res.status(400).json({ error: 'Нельзя удалить незавершённую заявку' });
    await query('DELETE FROM purchase_requests WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления заявки' });
  }
});

const port = Number(process.env.PORT || 3005);
http.createServer(app).listen(port, '0.0.0.0', () => {
  console.log(`[requests-service] listening on :${port}`);
});
