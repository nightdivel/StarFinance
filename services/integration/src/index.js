import 'dotenv/config';
import express from 'express';
import { ensureSchema } from './db.js';
import healthRouter from './routes/health.js';
import uexRouter from './routes/uex.js';

const app = express();
const port = Number(process.env.PORT || 4008);

app.use(express.json({ limit: '2mb' }));
app.use(healthRouter);
app.use(uexRouter);

app.get('/', (_req, res) => {
  res.json({ service: 'integration', status: 'ok' });
});

async function start() {
  await ensureSchema();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[integration] listening on :${port}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[integration] failed to start', error);
  process.exit(1);
});
