import { Router } from 'express';
import { pool } from '../db.js';

const router = Router();

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
