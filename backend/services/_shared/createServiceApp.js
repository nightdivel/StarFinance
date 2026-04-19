const express = require('express');

const mutationLocks = new Map();
const mutationRecent = new Map();
const DUPLICATE_SUBMISSION_TTL_MS = Number(process.env.DUPLICATE_SUBMISSION_TTL_MS || 1200);

function buildMutationKey(req) {
  const actor = req.user?.id || req.headers['authorization'] || req.ip || 'anon';
  const idempotencyKey = req.headers['x-idempotency-key'] || '';
  const route = (req.originalUrl || req.path || '').split('?')[0];
  return `${String(actor)}:${req.method}:${route}:${String(idempotencyKey)}`;
}

function duplicateMutationGuard(req, res, next) {
  const isMutation = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
  if (!isMutation) return next();

  const now = Date.now();
  const key = buildMutationKey(req);
  const recentAt = mutationRecent.get(key);

  if (mutationLocks.has(key) || (recentAt && now - recentAt < DUPLICATE_SUBMISSION_TTL_MS)) {
    return res.status(409).json({ error: 'Повторная отправка запроса. Подождите завершения операции.' });
  }

  mutationLocks.set(key, now);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    mutationLocks.delete(key);
    mutationRecent.set(key, Date.now());
  };

  res.on('finish', release);
  res.on('close', release);
  next();
}

function createServiceApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(duplicateMutationGuard);

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: process.env.SERVICE_NAME || 'service', ts: new Date().toISOString() });
  });

  return app;
}

module.exports = { createServiceApp };
