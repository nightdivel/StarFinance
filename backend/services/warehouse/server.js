const http = require('http');
const express = require('express');
const cors = require('cors');
const { query } = require('../../db');
const { authenticateToken, requirePermission } = require('../../middleware/auth');
const { createServiceApp } = require('../_shared/createServiceApp');

process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'warehouse-service';

const app = createServiceApp();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

app.get(
  '/api/warehouse',
  authenticateToken,
  requirePermission('warehouse', 'read'),
  async (req, res) => {
    try {
      const meRes = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (meRes.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = meRes.rows[0];

      let allowedTypes = null;
      try {
        const accType = me.account_type || null;
        if (accType) {
          const wres = await query(
            'SELECT warehouse_type FROM account_type_warehouse_types WHERE account_type = $1',
            [accType]
          );
          const arr = wres.rows.map((r) => r.warehouse_type).filter(Boolean);
          allowedTypes = arr;
        }
      } catch (_) {}

      let w;
      if (Array.isArray(allowedTypes) && allowedTypes.length > 0) {
        w = await query(
          'SELECT id, name, type, quantity, cost, currency, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items WHERE owner_login = $2 AND warehouse_type = ANY($1) ORDER BY created_at DESC',
          [allowedTypes, me.username]
        );
      } else {
        w = { rows: [] };
      }

      const items = w.rows.map((it) => ({
        id: it.id,
        name: it.name,
        type: it.type || null,
        quantity: Number(it.quantity) || 0,
        price: it.cost !== null && it.cost !== undefined ? Number(it.cost) : undefined,
        currency: it.currency || null,
        displayCurrencies: it.display_currencies || undefined,
        meta: it.meta || undefined,
        warehouseType: it.warehouse_type || null,
        ownerLogin: it.owner_login || null,
        createdAt: it.created_at ? new Date(it.created_at).toISOString() : undefined,
        updatedAt: it.updated_at ? new Date(it.updated_at).toISOString() : undefined,
      }));
      res.json(items);
    } catch (e) {
      res.status(500).json({ error: 'Ошибка чтения склада' });
    }
  }
);

app.post(
  '/api/warehouse',
  authenticateToken,
  requirePermission('warehouse', 'write'),
  async (req, res) => {
    try {
      const { id, name, type, quantity, price, currency, displayCurrencies, meta, warehouseType } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Название обязательно' });
      const newId = id || `w_${Date.now()}`;

      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      const existing = await query('SELECT id, owner_login FROM warehouse_items WHERE id = $1', [newId]);
      if (existing.rowCount > 0) {
        const isOwner = existing.rows[0]?.owner_login && existing.rows[0].owner_login === me.username;
        if (!isOwner) {
          return res.status(403).json({ error: 'Недостаточно прав для обновления товара' });
        }
      }

      const effectiveOwnerLogin = me.username;
      if (type) {
        await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [type]);
      }
      if (warehouseType) {
        await query('INSERT INTO warehouse_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [warehouseType]);
      }
      const effCurrency = currency || (Array.isArray(displayCurrencies) && displayCurrencies.length > 0 ? displayCurrencies[0] : null);
      await query(
        `INSERT INTO warehouse_items(id, name, type, quantity, cost, currency, display_currencies, meta, warehouse_type, owner_login, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, quantity = EXCLUDED.quantity, cost = EXCLUDED.cost,
           currency = COALESCE($6, warehouse_items.currency), display_currencies = COALESCE($7, warehouse_items.display_currencies), meta = EXCLUDED.meta, warehouse_type = EXCLUDED.warehouse_type, owner_login = EXCLUDED.owner_login, updated_at = now()`,
        [
          newId,
          name,
          type || null,
          Number(quantity) || 0,
          price !== undefined ? Number(price) : null,
          effCurrency || null,
          displayCurrencies || null,
          meta ? JSON.stringify(meta) : null,
          warehouseType || null,
          effectiveOwnerLogin || null,
        ]
      );
      const row = (
        await query(
          'SELECT id, name, type, quantity, cost, currency, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items WHERE id = $1',
          [newId]
        )
      ).rows[0];
      res.json({ success: true, item: row });
    } catch (e) {
      console.error('POST /api/warehouse error:', e);
      res.status(500).json({ error: 'Ошибка сохранения товара' });
    }
  }
);

app.put(
  '/api/warehouse/:id',
  authenticateToken,
  requirePermission('warehouse', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const { name, type, quantity, price, currency, displayCurrencies, meta, warehouseType } = req.body || {};
      const exists = await query('SELECT 1 FROM warehouse_items WHERE id = $1', [id]);
      if (exists.rowCount === 0) return res.status(404).json({ error: 'Позиция не найдена' });

      let effectiveOwnerLogin;
      try {
        const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
        if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
        const me = ures.rows[0];
        const itemRes = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [id]);
        const isOwner = itemRes.rows[0]?.owner_login && itemRes.rows[0].owner_login === me.username;
        if (!isOwner) {
          return res.status(403).json({ error: 'Недостаточно прав для редактирования товара' });
        }
        effectiveOwnerLogin = me.username;
      } catch (_) {
        return res.status(403).json({ error: 'Недостаточно прав' });
      }

      if (type) {
        await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [type]);
      }
      if (warehouseType) {
        await query('INSERT INTO warehouse_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [warehouseType]);
      }
      const effCurrencyUpdate = currency || (Array.isArray(displayCurrencies) && displayCurrencies.length > 0 ? displayCurrencies[0] : null);
      await query(
        `UPDATE warehouse_items SET name = COALESCE($2,name), type = COALESCE($3,type), quantity = COALESCE($4,quantity), cost = $5,
         currency = COALESCE($6,currency), display_currencies = COALESCE($7, display_currencies), meta = $8, warehouse_type = COALESCE($9, warehouse_type), owner_login = COALESCE($10, owner_login), updated_at = now() WHERE id = $1`,
        [
          id,
          name || null,
          type || null,
          quantity !== undefined ? Number(quantity) : null,
          price !== undefined ? Number(price) : null,
          effCurrencyUpdate || null,
          displayCurrencies || null,
          meta ? JSON.stringify(meta) : null,
          warehouseType || null,
          effectiveOwnerLogin || null,
        ]
      );
      const row = (
        await query(
          'SELECT id, name, type, quantity, cost, currency, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items WHERE id = $1',
          [id]
        )
      ).rows[0];
      res.json({ success: true, item: row });
    } catch (e) {
      console.error('PUT /api/warehouse/:id error:', e);
      res.status(500).json({ error: 'Ошибка обновления товара' });
    }
  }
);

app.patch('/api/warehouse/:id/quantity', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const { quantity } = req.body || {};
    if (quantity == null || isNaN(Number(quantity))) {
      return res.status(400).json({ error: 'Некорректное количество' });
    }
    const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
    if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
    const me = ures.rows[0];
    const itemRes = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [id]);
    if (itemRes.rowCount === 0) return res.status(404).json({ error: 'Позиция не найдена' });
    const isOwner = itemRes.rows[0].owner_login && itemRes.rows[0].owner_login === me.username;
    if (!isOwner) {
      return res.status(403).json({ error: 'Недостаточно прав для изменения количества' });
    }
    await query('UPDATE warehouse_items SET quantity = $2, updated_at = now() WHERE id = $1', [id, Number(quantity)]);
    res.json({ success: true });
  } catch (e) {
    console.error('PATCH /api/warehouse/:id/quantity error:', e);
    res.status(500).json({ error: 'Ошибка обновления количества' });
  }
});

app.delete(
  '/api/warehouse/:id',
  authenticateToken,
  requirePermission('warehouse', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const exists = await query('SELECT id, owner_login FROM warehouse_items WHERE id = $1', [id]);
      if (exists.rowCount === 0) return res.status(404).json({ error: 'Позиция не найдена' });
      const item = exists.rows[0];
      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      const isOwner = item.owner_login && item.owner_login === me.username;
      if (!isOwner) {
        return res.status(403).json({ error: 'Недостаточно прав для удаления товара' });
      }
      await query('DELETE FROM warehouse_items WHERE id = $1', [id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления товара' });
    }
  }
);

const port = Number(process.env.PORT || 3003);
http.createServer(app).listen(port, '0.0.0.0', () => {
  console.log(`[warehouse-service] listening on :${port}`);
});
