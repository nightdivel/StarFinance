const http = require('http');
const express = require('express');
const cors = require('cors');
const { query } = require('../../db');
const { authenticateToken, requirePermission } = require('../../middleware/auth');
const { createServiceApp } = require('../_shared/createServiceApp');

process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'showcase-service';

const app = createServiceApp();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

app.get(
  '/api/showcase',
  authenticateToken,
  requirePermission('showcase', 'read'),
  async (req, res) => {
    try {
      const q = (req.query?.q || '').toString().trim();
      let scRes;
      if (q) {
        const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
        scRes = await query(
          `SELECT s.id, s.warehouse_item_id, s.status, s.price, s.currency, s.meta, s.created_at, s.updated_at
           FROM showcase_items s
           LEFT JOIN warehouse_items w ON w.id = s.warehouse_item_id
           WHERE (
             s.id ILIKE $1 ESCAPE '\\' OR
             COALESCE(s.warehouse_item_id,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(s.status,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(s.currency,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(CAST(s.price AS TEXT),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(CAST(s.meta AS TEXT),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(TO_CHAR(s.created_at, 'YYYY-MM-DD HH24:MI:SS'),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(TO_CHAR(s.updated_at, 'YYYY-MM-DD HH24:MI:SS'),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(w.id,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(w.name,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(w.type,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(CAST(w.quantity AS TEXT),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(CAST(w.cost AS TEXT),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(w.currency,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(CAST(w.display_currencies AS TEXT),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(CAST(w.meta AS TEXT),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(w.warehouse_type,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(w.owner_login,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(TO_CHAR(w.created_at, 'YYYY-MM-DD HH24:MI:SS'),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(TO_CHAR(w.updated_at, 'YYYY-MM-DD HH24:MI:SS'),'') ILIKE $1 ESCAPE '\\'
           )
           ORDER BY s.created_at DESC`,
          [like]
        );
      } else {
        scRes = await query(
          'SELECT id, warehouse_item_id, status, price, currency, meta, created_at, updated_at FROM showcase_items ORDER BY created_at DESC'
        );
      }
      const items = scRes.rows.map((srow) => ({
        id: srow.id,
        warehouseItemId: srow.warehouse_item_id || null,
        status: srow.status || null,
        price: srow.price !== null && srow.price !== undefined ? Number(srow.price) : undefined,
        currency: srow.currency || null,
        meta: srow.meta || undefined,
        createdAt: srow.created_at ? new Date(srow.created_at).toISOString() : undefined,
        updatedAt: srow.updated_at ? new Date(srow.updated_at).toISOString() : undefined,
      }));
      res.json(items);
    } catch (e) {
      res.status(500).json({ error: 'Ошибка чтения витрины' });
    }
  }
);

app.post(
  '/api/showcase',
  authenticateToken,
  requirePermission('showcase', 'write'),
  async (req, res) => {
    try {
      const { id, warehouseItemId, status, price, currency, meta } = req.body || {};
      let newId = id || null;
      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      if (warehouseItemId) {
        const w = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [warehouseItemId]);
        if (w.rowCount === 0) return res.status(400).json({ error: 'Связанный товар не найден' });
        const isOwner = w.rows[0]?.owner_login && w.rows[0].owner_login === me.username;
        if (!isOwner) return res.status(403).json({ error: 'Недостаточно прав для размещения товара на витрине' });
      } else {
        return res.status(400).json({ error: 'warehouseItemId обязателен' });
      }

      if (!newId) {
        const existing = await query(
          'SELECT id FROM showcase_items WHERE warehouse_item_id = $1 ORDER BY created_at DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT 1',
          [warehouseItemId]
        );
        const existingId = existing.rows[0]?.id || null;
        if (existingId) {
          newId = existingId;
          await query('DELETE FROM showcase_items WHERE warehouse_item_id = $1 AND id <> $2', [
            warehouseItemId,
            existingId,
          ]);
        } else {
          newId = `s_${Date.now()}`;
        }
      }
      if (status) {
        await query('INSERT INTO showcase_statuses(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [status]);
      }
      await query(
        `INSERT INTO showcase_items(id, warehouse_item_id, status, price, currency, meta, created_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())
         ON CONFLICT (id) DO UPDATE SET warehouse_item_id = EXCLUDED.warehouse_item_id, status = EXCLUDED.status, price = EXCLUDED.price,
           currency = EXCLUDED.currency, meta = EXCLUDED.meta, updated_at = now()`,
        [
          newId,
          warehouseItemId,
          status || null,
          price !== undefined ? Number(price) : null,
          currency || null,
          meta ? JSON.stringify(meta) : null,
        ]
      );
      const row = (
        await query(
          'SELECT id, warehouse_item_id, status, price, currency, meta, created_at, updated_at FROM showcase_items WHERE id = $1',
          [newId]
        )
      ).rows[0];
      res.json({ success: true, item: row });
    } catch (e) {
      console.error('POST /api/showcase error:', e);
      res.status(500).json({ error: 'Ошибка сохранения позиции витрины' });
    }
  }
);

app.put(
  '/api/showcase/:id',
  authenticateToken,
  requirePermission('showcase', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const { warehouseItemId, status, price, currency, meta } = req.body || {};
      const exists = await query('SELECT 1 FROM showcase_items WHERE id = $1', [id]);
      if (exists.rowCount === 0) return res.status(404).json({ error: 'Позиция не найдена' });

      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      const current = await query('SELECT warehouse_item_id FROM showcase_items WHERE id = $1', [id]);
      const targetWid = warehouseItemId || current.rows[0]?.warehouse_item_id || null;
      if (targetWid) {
        const w = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [targetWid]);
        if (w.rowCount === 0) return res.status(400).json({ error: 'Связанный товар не найден' });
        const isOwner = w.rows[0]?.owner_login && w.rows[0].owner_login === me.username;
        if (!isOwner) return res.status(403).json({ error: 'Недостаточно прав для изменения позиции витрины' });
      } else {
        return res.status(400).json({ error: 'warehouseItemId обязателен' });
      }

      if (status) {
        await query('INSERT INTO showcase_statuses(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [status]);
      }
      await query(
        `UPDATE showcase_items SET warehouse_item_id = COALESCE($2, warehouse_item_id), status = COALESCE($3, status), price = $4,
         currency = COALESCE($5, currency), meta = $6, updated_at = now() WHERE id = $1`,
        [
          id,
          warehouseItemId || null,
          status || null,
          price !== undefined ? Number(price) : null,
          currency || null,
          meta ? JSON.stringify(meta) : null,
        ]
      );
      const row = (
        await query(
          'SELECT id, warehouse_item_id, status, price, currency, meta, created_at, updated_at FROM showcase_items WHERE id = $1',
          [id]
        )
      ).rows[0];
      res.json({ success: true, item: row });
    } catch (e) {
      console.error('PUT /api/showcase/:id error:', e);
      res.status(500).json({ error: 'Ошибка обновления позиции витрины' });
    }
  }
);

app.delete(
  '/api/showcase/:id',
  authenticateToken,
  requirePermission('showcase', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      const cur = await query('SELECT warehouse_item_id FROM showcase_items WHERE id = $1', [id]);
      if (cur.rowCount === 0) return res.status(404).json({ error: 'Позиция не найдена' });
      const wid = cur.rows[0]?.warehouse_item_id || null;
      if (wid) {
        const w = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [wid]);
        const isOwner = w.rows[0]?.owner_login && w.rows[0].owner_login === me.username;
        if (!isOwner) return res.status(403).json({ error: 'Недостаточно прав для удаления позиции витрины' });
      } else {
        return res.status(403).json({ error: 'Недостаточно прав для удаления позиции витрины' });
      }
      await query('DELETE FROM showcase_items WHERE id = $1', [id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления позиции витрины' });
    }
  }
);

app.delete(
  '/api/showcase/by-warehouse/:warehouseItemId',
  authenticateToken,
  requirePermission('showcase', 'write'),
  async (req, res) => {
    try {
      const wid = req.params.warehouseItemId;
      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      const w = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [wid]);
      if (w.rowCount === 0) return res.status(404).json({ error: 'Товар не найден' });
      const isOwner = w.rows[0]?.owner_login && w.rows[0].owner_login === me.username;
      if (!isOwner) return res.status(403).json({ error: 'Недостаточно прав для очистки витрины по товару' });
      await query('DELETE FROM showcase_items WHERE warehouse_item_id = $1', [wid]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления по товару' });
    }
  }
);

const port = Number(process.env.PORT || 3004);
http.createServer(app).listen(port, '0.0.0.0', () => {
  console.log(`[showcase-service] listening on :${port}`);
});
