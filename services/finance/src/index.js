import 'dotenv/config';
import express from 'express';
import { ensureSchema } from './db.js';
import healthRouter from './routes/health.js';
import transactionsRouter from './routes/transactions.js';

const app = express();
const port = Number(process.env.PORT || 4007);

app.use(express.json({ limit: '2mb' }));
app.use(healthRouter);
app.use(transactionsRouter);

app.get('/', (_req, res) => {
  res.json({ service: 'finance', status: 'ok' });
});

async function start() {
  await ensureSchema();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[finance] listening on :${port}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[finance] failed to start', error);
  process.exit(1);
});
