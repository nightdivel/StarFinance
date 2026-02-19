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

router.get('/api/transactions', async (_req, res) => {
  try {
    const rows = await pool.query(
      'SELECT id, type, amount, currency, from_user, to_user, item_id, meta, created_at FROM transactions ORDER BY created_at DESC'
    );
    return res.json(rows.rows);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения транзакций' });
  }
});

router.post('/api/transactions', async (req, res) => {
  try {
    const { type, amount, currency, fromUser, toUser, itemId, meta } = req.body || {};
    if (!type || amount == null || !currency) return res.status(400).json({ error: 'Некорректные данные' });
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum)) return res.status(400).json({ error: 'Некорректная сумма' });
    const id = `t_${Date.now()}`;
    await pool.query(
      `INSERT INTO transactions(id, type, amount, currency, from_user, to_user, item_id, meta, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
      [id, type, amountNum, currency, fromUser || null, toUser || null, itemId || null, meta ? JSON.stringify(meta) : null]
    );
    return res.json({ success: true, transactionId: id });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка создания транзакции' });
  }
});

router.delete('/api/transactions/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM transactions WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка удаления транзакции' });
  }
});

router.get('/api/system/currencies', async (_req, res) => {
  try {
    const rows = await pool.query('SELECT code, name, is_base FROM currencies ORDER BY code');
    return res.json(rows.rows);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения валют' });
  }
});

router.post('/api/system/currencies', async (req, res) => {
  try {
    const { code, name, isBase } = req.body || {};
    if (!code || !name) return res.status(400).json({ error: 'Некорректные данные' });
    await pool.query(
      `INSERT INTO currencies(code, name, is_base) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_base = EXCLUDED.is_base`,
      [code, name, !!isBase]
    );
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сохранения валюты' });
  }
});

router.get('/api/system/currencies/rates', async (req, res) => {
  try {
    const base = req.query?.base || null;
    const rows = base
      ? await pool.query('SELECT base_code, code, rate, updated_at FROM currency_rates WHERE base_code = $1', [base])
      : await pool.query('SELECT base_code, code, rate, updated_at FROM currency_rates');
    return res.json(rows.rows);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка чтения курсов' });
  }
});

router.put('/api/system/currencies/rates', async (req, res) => {
  try {
    const { baseCode, rates } = req.body || {};
    if (!baseCode || !rates || typeof rates !== 'object') {
      return res.status(400).json({ error: 'Некорректные данные' });
    }
    for (const [code, rate] of Object.entries(rates)) {
      const rateNum = Number(rate);
      if (!Number.isFinite(rateNum)) return res.status(400).json({ error: 'Некорректный курс' });
      await pool.query(
        `INSERT INTO currency_rates(base_code, code, rate, updated_at) VALUES ($1,$2,$3, now())
         ON CONFLICT (base_code, code) DO UPDATE SET rate = EXCLUDED.rate, updated_at = now()`,
        [baseCode, code, rateNum]
      );
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сохранения курсов' });
  }
});

export default router;
