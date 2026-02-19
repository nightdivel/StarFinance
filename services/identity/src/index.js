import 'dotenv/config';
import express from 'express';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import accountTypesRouter from './routes/accountTypes.js';
import { ensureSchema } from './db.js';

const app = express();
const port = Number(process.env.PORT || 4001);

app.use(express.json({ limit: '2mb' }));
app.use(healthRouter);
app.use(authRouter);
app.use(usersRouter);
app.use(accountTypesRouter);

app.get('/', (_req, res) => {
  res.json({ service: 'identity', status: 'ok' });
});

async function start() {
  await ensureSchema();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[identity] listening on :${port}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[identity] failed to start', error);
  process.exit(1);
});
