import { Router } from 'express';
import { healthCheck } from '../db.js';

const router = Router();

router.get('/health', async (_req, res) => {
  try {
    const dbOk = await healthCheck();
    if (!dbOk) return res.status(503).json({ status: 'degraded' });
    return res.json({ status: 'ok' });
  } catch (error) {
    return res.status(503).json({ status: 'degraded', error: error.message });
  }
});

export default router;
