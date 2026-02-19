import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { ensureSchema } from './db.js';
import healthRouter from './routes/health.js';
import directoriesRouter from './routes/directories.js';

const app = express();
const port = Number(process.env.PORT || 4002);

app.use(express.json({ limit: '2mb' }));
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);
app.use(healthRouter);
app.use(directoriesRouter);

app.get('/', (_req, res) => {
  res.json({ service: 'directories', status: 'ok' });
});

async function start() {
  await ensureSchema();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[directories] listening on :${port}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[directories] failed to start', error);
  process.exit(1);
});
