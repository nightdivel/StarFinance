const axios = require('axios');

const ECONOMY_BASE_URL = process.env.ECONOMY_BASE_URL || 'http://economy:3000';

function filterHeaders(headers) {
  const out = { ...headers };
  delete out.host;
  delete out.connection;
  delete out['content-length'];
  return out;
}

async function proxyToEconomy(req, res) {
  const targetUrl = `${ECONOMY_BASE_URL}${req.originalUrl}`;

  try {
    const upstream = await axios({
      method: req.method,
      url: targetUrl,
      headers: filterHeaders(req.headers || {}),
      data: req,
      responseType: 'stream',
      validateStatus: () => true,
    });

    res.status(upstream.status);
    for (const [k, v] of Object.entries(upstream.headers || {})) {
      if (k.toLowerCase() === 'transfer-encoding') continue;
      if (v !== undefined) res.setHeader(k, v);
    }

    upstream.data.pipe(res);
  } catch (e) {
    const msg = e?.message || 'proxy error';
    res.status(502).json({ error: 'Upstream proxy failed', detail: msg, url: targetUrl });
  }
}

module.exports = { proxyToEconomy };
