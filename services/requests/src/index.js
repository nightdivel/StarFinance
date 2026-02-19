import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { ensureSchema } from './db.js';
import healthRouter from './routes/health.js';
import requestsRouter from './routes/requests.js';

const app = express();
const port = Number(process.env.PORT || 4006);

app.use(express.json({ limit: '2mb' }));
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);
app.use(healthRouter);
app.use(requestsRouter);

app.get('/', (_req, res) => {
  res.json({ service: 'requests', status: 'ok' });
});

async function start() {
  await ensureSchema();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[requests] listening on :${port}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[requests] failed to start', error);
  process.exit(1);
});
