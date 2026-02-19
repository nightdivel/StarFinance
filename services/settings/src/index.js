import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { ensureSchema } from './db.js';
import healthRouter from './routes/health.js';
import settingsRouter from './routes/settings.js';

const app = express();
const port = Number(process.env.PORT || 4003);

app.use(express.json({ limit: '2mb' }));
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);
app.use(healthRouter);
app.use(settingsRouter);

app.get('/', (_req, res) => {
  res.json({ service: 'settings', status: 'ok' });
});

async function start() {
  await ensureSchema();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[settings] listening on :${port}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[settings] failed to start', error);
  process.exit(1);
});
