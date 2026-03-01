const http = require('http');
const express = require('express');
const cors = require('cors');
const { query } = require('../../db');
const { authenticateToken, requirePermission } = require('../../middleware/auth');
const { getPermissionsForTypeDb } = require('../_shared/permissions');
const { createServiceApp } = require('../_shared/createServiceApp');

process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'finance-service';

const app = createServiceApp();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

async function ensureFinanceRequestsTable() {
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS finance_requests (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        from_user TEXT REFERENCES users(id) ON DELETE SET NULL,
        to_user TEXT REFERENCES users(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'В обработке',
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITHOUT TIME ZONE
      )`
    ).catch(() => {});
  } catch (e) {
    console.warn('[finance-service] Failed to ensure finance_requests table:', e?.message || e);
  }
}

(async () => {
  await ensureFinanceRequestsTable();
})();

// ---------- Transactions CRUD ----------
app.get('/api/transactions', authenticateToken, requirePermission('finance', 'read'), async (req, res) => {
  try {
    const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
    if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
    const me = ures.rows[0];
    const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
    const isAdmin = me.account_type === 'Администратор' || perms?.users === 'write' || perms?.finance === 'write';

    let t;
    if (isAdmin) {
      t = await query(
        'SELECT id, type, amount, currency, from_user, to_user, item_id, meta, created_at FROM transactions ORDER BY created_at DESC'
      );
    } else {
      t = await query(
        'SELECT id, type, amount, currency, from_user, to_user, item_id, meta, created_at FROM transactions WHERE from_user = $1 OR to_user = $1 ORDER BY created_at DESC',
        [me.id]
      );
    }
    const items = t.rows.map((r) => ({
      id: r.id,
      type: r.type,
      amount: Number(r.amount) || 0,
      currency: r.currency,
      from_user: r.from_user || null,
      to_user: r.to_user || null,
      item_id: r.item_id || null,
      meta: r.meta || undefined,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
    }));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения транзакций' });
  }
});

app.post('/api/transactions', authenticateToken, requirePermission('finance', 'write'), async (req, res) => {
  try {
    const { id, type, amount, currency, from_user, to_user, item_id, meta } = req.body || {};
    if (!type) return res.status(400).json({ error: 'Тип обязателен' });
    if (!currency) return res.status(400).json({ error: 'Валюта обязательна' });
    const newId = id || `t_${Date.now()}`;

    const resolveUserId = async (val) => {
      if (!val) return null;
      const r = await query('SELECT id FROM users WHERE id = $1 OR username = $1 LIMIT 1', [val]);
      return r.rowCount > 0 ? r.rows[0].id : null;
    };
    const fromUserId = await resolveUserId(from_user);
    const toUserId = await resolveUserId(to_user);
    if (type === 'outcome') {
      if (!toUserId) return res.status(400).json({ error: 'Получатель обязателен для исходящей транзакции' });
      if (fromUserId && toUserId && fromUserId === toUserId)
        return res.status(400).json({ error: 'Отправитель и получатель не могут совпадать' });
    }

    let metaObj = {};
    try {
      metaObj = meta && typeof meta === 'object' ? meta : meta ? JSON.parse(String(meta)) : {};
    } catch (_) {
      metaObj = {};
    }

    let financeReqId = null;
    if (type === 'outcome' && toUserId) {
      financeReqId = `fr_${Date.now()}`;
      metaObj.status = metaObj.status || 'В обработке';
      metaObj.financeRequestId = financeReqId;
    }

    await query(
      `INSERT INTO transactions(id, type, amount, currency, from_user, to_user, item_id, meta, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, amount = EXCLUDED.amount, currency = EXCLUDED.currency,
         from_user = EXCLUDED.from_user, to_user = EXCLUDED.to_user, item_id = EXCLUDED.item_id, meta = EXCLUDED.meta`,
      [
        newId,
        type,
        Number(amount) || 0,
        currency,
        fromUserId,
        toUserId,
        item_id || null,
        Object.keys(metaObj).length ? JSON.stringify(metaObj) : null,
      ]
    );

    if (financeReqId) {
      await query(
        `INSERT INTO finance_requests(id, transaction_id, from_user, to_user, status, created_at)
         VALUES ($1,$2,$3,$4,'В обработке', now())
         ON CONFLICT (id) DO NOTHING`,
        [financeReqId, newId, fromUserId, toUserId]
      );
    }

    const row = (
      await query(
        'SELECT id, type, amount, currency, from_user, to_user, item_id, meta, created_at FROM transactions WHERE id = $1',
        [newId]
      )
    ).rows[0];
    res.json({ success: true, item: row });
  } catch (e) {
    console.error('POST /api/transactions error:', e);
    res.status(500).json({ error: 'Ошибка сохранения транзакции' });
  }
});

app.put('/api/transactions/:id', authenticateToken, requirePermission('finance', 'write'), async (req, res) => {
  try {
    const id = req.params.id;
    const { type, amount, currency, from_user, to_user, item_id, meta } = req.body || {};
    const exists = await query('SELECT 1 FROM transactions WHERE id = $1', [id]);
    if (exists.rowCount === 0) return res.status(404).json({ error: 'Транзакция не найдена' });
    const resolveUserId = async (val) => {
      if (!val) return null;
      const r = await query('SELECT id FROM users WHERE id = $1 OR username = $1 LIMIT 1', [val]);
      return r.rowCount > 0 ? r.rows[0].id : null;
    };
    const fromUserId = await resolveUserId(from_user);
    const toUserId = await resolveUserId(to_user);
    await query(
      `UPDATE transactions SET type = COALESCE($2,type), amount = COALESCE($3,amount), currency = COALESCE($4,currency),
       from_user = COALESCE($5,from_user), to_user = COALESCE($6,to_user), item_id = COALESCE($7,item_id), meta = $8 WHERE id = $1`,
      [
        id,
        type || null,
        amount !== undefined ? Number(amount) : null,
        currency || null,
        fromUserId,
        toUserId,
        item_id || null,
        meta ? JSON.stringify(meta) : null,
      ]
    );
    const row = (
      await query(
        'SELECT id, type, amount, currency, from_user, to_user, item_id, meta, created_at FROM transactions WHERE id = $1',
        [id]
      )
    ).rows[0];
    res.json({ success: true, item: row });
  } catch (e) {
    console.error('PUT /api/transactions/:id error:', e);
    res.status(500).json({ error: 'Ошибка обновления транзакции' });
  }
});

app.delete('/api/transactions/:id', authenticateToken, requirePermission('finance', 'write'), async (req, res) => {
  try {
    const id = req.params.id;
    await query('DELETE FROM transactions WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления транзакции' });
  }
});

// ---------- Finance Requests workflow ----------
app.get('/api/finance-requests/related', authenticateToken, async (req, res) => {
  try {
    const me = (await query('SELECT id FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!me) return res.status(401).json({ error: 'Нет пользователя' });
    const rows = (
      await query(
        `SELECT fr.id, fr.transaction_id,
                fr.from_user, uf.username AS from_username,
                fr.to_user, ut.username AS to_username,
                fr.status, fr.created_at, fr.updated_at,
                t.amount, t.currency, t.type
         FROM finance_requests fr
         JOIN transactions t ON t.id = fr.transaction_id
         LEFT JOIN users uf ON uf.id = fr.from_user
         LEFT JOIN users ut ON ut.id = fr.to_user
         WHERE fr.from_user = $1 OR fr.to_user = $1
         ORDER BY fr.created_at DESC`,
        [me.id]
      )
    ).rows;
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения заявок по транзакциям' });
  }
});

app.put('/api/finance-requests/:id/confirm', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const fr = (
      await query('SELECT id, transaction_id, from_user, to_user, status FROM finance_requests WHERE id = $1', [id])
    ).rows[0];
    if (!fr) return res.status(404).json({ error: 'Заявка не найдена' });
    if (fr.status === 'Выполнено') return res.json({ success: true });
    const me = (await query('SELECT id, account_type FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!me) return res.status(401).json({ error: 'Нет пользователя' });
    const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
    const isAdmin = me.account_type === 'Администратор' || perms?.finance === 'write';
    const isRecipient = fr.to_user === me.id;
    if (!isAdmin && !isRecipient) return res.status(403).json({ error: 'Недостаточно прав для подтверждения' });
    await query('UPDATE finance_requests SET status = $2, updated_at = now() WHERE id = $1', [id, 'Выполнено']);
    await query(
      `UPDATE transactions SET meta = COALESCE(meta, '{}'::jsonb) || '{"status":"Выполнено"}'::jsonb WHERE id = $1`,
      [fr.transaction_id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('PUT /api/finance-requests/:id/confirm error:', e);
    res.status(500).json({ error: 'Ошибка подтверждения заявки' });
  }
});

app.put('/api/finance-requests/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const fr = (
      await query('SELECT id, transaction_id, from_user, to_user, status FROM finance_requests WHERE id = $1', [id])
    ).rows[0];
    if (!fr) return res.status(404).json({ error: 'Заявка не найдена' });
    if (fr.status === 'Отменена') return res.json({ success: true });
    const me = (await query('SELECT id, account_type FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!me) return res.status(401).json({ error: 'Нет пользователя' });
    const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
    const isAdmin = me.account_type === 'Администратор' || perms?.finance === 'write';
    const isRecipient = fr.to_user === me.id;
    if (!isAdmin && !isRecipient) return res.status(403).json({ error: 'Недостаточно прав для отмены' });
    await query('DELETE FROM transactions WHERE id = $1', [fr.transaction_id]);
    await query('UPDATE finance_requests SET status = $2, updated_at = now() WHERE id = $1', [id, 'Отменена']).catch(() => {});
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка отмены заявки' });
  }
});

const port = Number(process.env.PORT || 3006);
http.createServer(app).listen(port, '0.0.0.0', () => {
  console.log(`[finance-service] listening on :${port}`);
});
