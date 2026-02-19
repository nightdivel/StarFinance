import 'dotenv/config';
import express from 'express';
import { ensureSchema } from './db.js';
import healthRouter from './routes/health.js';
import showcaseRouter from './routes/showcase.js';

const app = express();
const port = Number(process.env.PORT || 4005);

app.use(express.json({ limit: '2mb' }));
app.use(healthRouter);
app.use(showcaseRouter);

app.get('/', (_req, res) => {
  res.json({ service: 'showcase', status: 'ok' });
});

async function start() {
  await ensureSchema();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[showcase] listening on :${port}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[showcase] failed to start', error);
  process.exit(1);
});
