const express = require('express');

function createServiceApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: process.env.SERVICE_NAME || 'service', ts: new Date().toISOString() });
  });

  return app;
}

module.exports = { createServiceApp };
