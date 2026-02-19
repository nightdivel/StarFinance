import 'dotenv/config';
import express from 'express';
import { ensureSchema } from './db.js';
import healthRouter from './routes/health.js';
import warehouseRouter from './routes/warehouse.js';

const app = express();
const port = Number(process.env.PORT || 4004);

app.use(express.json({ limit: '2mb' }));
app.use(healthRouter);
app.use(warehouseRouter);

app.get('/', (_req, res) => {
  res.json({ service: 'warehouse', status: 'ok' });
});

async function start() {
  await ensureSchema();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[warehouse] listening on :${port}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[warehouse] failed to start', error);
  process.exit(1);
});
