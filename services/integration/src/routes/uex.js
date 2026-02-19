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

router.post('/internal/integration/uex/sync', async (_req, res) => {
  try {
    const id = `uex_${Date.now()}`;
    await pool.query(
      'INSERT INTO uex_sync_jobs(id, status, meta) VALUES ($1,$2,$3)',
      [id, 'queued', JSON.stringify({})]
    );
    return res.json({ success: true, jobId: id });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка постановки синка' });
  }
});

export default router;
