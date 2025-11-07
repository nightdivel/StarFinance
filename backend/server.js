/* eslint-disable no-empty */
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { query } = require('./db');
const { authenticateToken, generateToken, requirePermission } = require('./middleware/auth');
const { SERVER_CONFIG, DISCORD_CONFIG } = require('./config/serverConfig');

// Helper: build Discord authorize URL based on effective settings and mappings
function buildDiscordAuthorizeUrl(eff) {
  const clientId = eff.clientId || DISCORD_CONFIG.CLIENT_ID;
  const redirectUri = encodeURIComponent(eff.redirectUri || DISCORD_CONFIG.REDIRECT_URI || '');
  if (!clientId || !redirectUri) return '';
  // Determine scopes similar to /auth/discord route
  const attrMappings = Array.isArray(eff.attributeMappings) ? eff.attributeMappings : [];
  const needEmail = attrMappings.some(
    (r) => r?.source === 'user' && String(r?.key).toLowerCase() === 'email'
  );
  const needGuildMember = attrMappings.some((r) => r?.source === 'member');
  const scopes = ['identify'];
  if (needEmail) scopes.push('email');
  if (needGuildMember) scopes.push('guilds.members.read');
  // Include only safe scope from mappings: connections
  try {
    // Note: helper does not have DB access here; rely on eff.attributeMappings and env cannot be used
    // Therefore, do not auto-include anything except base set.
    // If ever needed, a caller should compute URL via /auth/discord route.
  } catch {}
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(
    clientId
  )}&response_type=code&redirect_uri=${redirectUri}&scope=${encodeURIComponent(scopes.join(' '))}`;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

// CORS configuration (apply only to API/auth/public/health, not to static assets)
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:')) {
      return callback(null, true);
    }
    const allowedOrigins = [
      'http://localhost',
      'https://korjeek.ru',
    ];
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
app.use('/api', cors(corsOptions));
app.use('/auth', cors(corsOptions));
app.use('/public', cors(corsOptions));
app.use('/health', cors(corsOptions));

// Body parsers should be BEFORE routes so early-declared routes see req.body
// Note: base64 increases size by ~33%, so allow headroom for 15MB files
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

// Request logging (after parsers so we can log body for POST/PUT)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  if ((req.method === 'POST' || req.method === 'PUT') && req.body !== undefined) {
    console.log('Request body:', req.body);
  }
  next();
});

// ---- Auth page background (public GET, admin PUT/DELETE) ----
// Storage path: backend/public/auth-bg.<ext>
const AUTH_BG_NAME = 'auth-bg';
const AUTH_PUBLIC_DIR = path.join(__dirname, 'public');
async function getAuthBgFile() {
  try {
    const files = await fs.readdir(AUTH_PUBLIC_DIR).catch(() => []);
    const f = files.find((n) => /^auth-bg\.(png|jpe?g|webp)$/i.test(n));
    return f ? path.join(AUTH_PUBLIC_DIR, f) : null;
  } catch (_) { return null; }
}

// Public metadata endpoint used by login form
app.get('/public/auth/background', async (req, res) => {
  try {
    const filePath = await getAuthBgFile();
    if (!filePath) return res.json({ url: null, updatedAt: null });
    const stat = await fs.stat(filePath).catch(() => null);
    const fileName = path.basename(filePath);
    // Serve via dedicated send endpoint below
    return res.json({ url: `/public/auth/background/file/${encodeURIComponent(fileName)}`, updatedAt: stat ? stat.mtimeMs : null });
  } catch (e) {
    return res.json({ url: null, updatedAt: null });
  }
});

// Public file sender
app.get('/public/auth/background/file/:name', async (req, res) => {
  try {
    const name = req.params.name;
    if (!/^auth-bg\.(png|jpe?g|webp)$/i.test(name)) return res.status(404).end();
    const filePath = path.join(AUTH_PUBLIC_DIR, name);
    const exists = await fs.stat(filePath).catch(() => null);
    if (!exists) return res.status(404).end();
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).end();
  }
});

// Admin: set background. Body: { dataUrl: 'data:image/png;base64,...' }
app.put('/api/system/auth/background', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const { dataUrl } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'Некорректные данные изображения' });
    }
    if (!dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Ожидается data:image/*;base64,...' });
    }
    // Parse data URL more flexibly: data:image/<subtype>[;params];base64,<payload>
    const headerEnd = dataUrl.indexOf(',');
    if (headerEnd < 0) return res.status(400).json({ error: 'Неверный формат data URL' });
    const header = dataUrl.slice(0, headerEnd); // e.g., data:image/jpeg;base64
    const b64 = dataUrl.slice(headerEnd + 1);
    const mimeMatch = header.match(/^data:image\/([^;]+)(;.*)?;base64$/i);
    if (!mimeMatch) return res.status(400).json({ error: 'Неверный заголовок data URL (нет ;base64)' });
    const subtype = String(mimeMatch[1] || '').toLowerCase();
    // Normalize jpeg aliases
    let ext;
    if (subtype === 'png') ext = 'png';
    else if (subtype === 'webp') ext = 'webp';
    else if (subtype === 'jpeg' || subtype === 'jpg' || subtype === 'pjpeg' || subtype === 'jfif') ext = 'jpeg';
    else return res.status(400).json({ error: 'Поддерживаются PNG/JPEG/WebP (base64)' });
    // Size limit ~15 MB (15000 KB)
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 15000 * 1024) return res.status(413).json({ error: 'Размер изображения превышает 15MB' });
    // Ensure dir
    await fs.mkdir(AUTH_PUBLIC_DIR, { recursive: true }).catch(() => {});
    // Remove previous variants
    try {
      for (const e of ['png','jpg','jpeg','webp']) {
        const p = path.join(AUTH_PUBLIC_DIR, `${AUTH_BG_NAME}.${e}`);
        await fs.unlink(p).catch(() => {});
      }
    } catch (_) {}
    const target = path.join(AUTH_PUBLIC_DIR, `${AUTH_BG_NAME}.${ext}`);
    await fs.writeFile(target, buf);
    return res.json({ success: true, url: `/public/auth/background/file/${AUTH_BG_NAME}.${ext}` });
  } catch (e) {
    console.error('PUT /api/system/auth/background error:', e);
    return res.status(500).json({ error: 'Ошибка сохранения фона' });
  }
});

// Admin: delete background
app.delete('/api/system/auth/background', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    for (const e of ['png','jpg','jpeg','webp']) {
      const p = path.join(AUTH_PUBLIC_DIR, `${AUTH_BG_NAME}.${e}`);
      await fs.unlink(p).catch(() => {});
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка удаления фона' });
  }
});
app.locals.io = io;
io.on('connection', (socket) => {
  console.log('[socket] client connected', socket.id);
  socket.on('disconnect', () => console.log('[socket] client disconnected', socket.id));
});


 

// Health check (used by frontend service and external monitors)
app.get('/health', cors(), async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'db_error' });
  }
});

// User-related requests (buyer or seller)
app.get('/api/requests/related', authenticateToken, async (req, res) => {
  try {
    const ures = await query('SELECT id, username FROM users WHERE id = $1', [req.user.id]);
    if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
    const me = ures.rows[0];
    const rows = (
      await query(
        `SELECT r.id, r.warehouse_item_id, r.quantity, r.status, r.created_at,
                r.buyer_user_id, r.buyer_username, w.name, w.cost, w.currency, w.owner_login
         FROM purchase_requests r JOIN warehouse_items w ON w.id = r.warehouse_item_id
         WHERE r.buyer_user_id = $1 OR w.owner_login = $2
         ORDER BY r.created_at DESC`,
        [me.id, me.username]
      )
    ).rows;
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения заявок' });
  }
});

// Ensure DB has required columns (idempotent) at startup
async function ensureThemePreferenceColumn() {
  try {
    await query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(10) DEFAULT 'light'"
    );
    await query(
      "UPDATE users SET theme_preference = 'light' WHERE theme_preference IS NULL"
    );
    console.log('[init] users.theme_preference ensured');
  } catch (e) {
    console.error('[init] Failed to ensure users.theme_preference:', e);
  }
}

// Simple SQL migration runner
async function runSqlMigrations() {
  try {
    // Ensure bookkeeping table
    await query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())'
    );
    const applied = new Set(
      (await query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
    );
    const migrationsDir = path.join(__dirname, 'migrations');
    let files = [];
    try {
      files = (await fs.readdir(migrationsDir)).filter((f) => f.toLowerCase().endsWith('.sql'));
    } catch (e) {
      // No migrations directory — nothing to run
      return;
    }
    files.sort(); // run in lexical order like 001_, 002_
    for (const file of files) {
      if (applied.has(file)) continue;
      const fullPath = path.join(migrationsDir, file);
      const sql = await fs.readFile(fullPath, 'utf8');
      console.log(`[migrate] Applying ${file} ...`);
      try {
        await query('BEGIN');
        // Split on semicolon? Better to send as-is; Node pg supports multiple statements when enabled per query.
        // Our pool is configured to allow multiple statements in sql files if separated by ;
        await query(sql);
        await query('INSERT INTO schema_migrations(filename) VALUES ($1)', [file]);
        await query('COMMIT');
        console.log(`[migrate] Applied ${file}`);
      } catch (e) {
        await query('ROLLBACK').catch(() => {});
        console.error(`[migrate] Failed ${file}:`, e);
        // Stop further migrations to avoid partial order issues
        break;
      }
    }
  } catch (e) {
    console.error('[migrate] Initialization error:', e);
  }
}

// Fire-and-forget initialization
(async () => {
  await runSqlMigrations();
  await ensureThemePreferenceColumn();
  // Ensure purchase_requests table
  try {
    await query(`CREATE TABLE IF NOT EXISTS purchase_requests (
      id text PRIMARY KEY,
      warehouse_item_id text NOT NULL,
      buyer_user_id text NOT NULL,
      buyer_username text,
      quantity numeric NOT NULL,
      status text NOT NULL,
      created_at timestamp without time zone DEFAULT now(),
      updated_at timestamp without time zone
    )`);
    console.log('[init] purchase_requests ensured');
  } catch (e) {
    console.error('[init] Failed to ensure purchase_requests:', e);
  }
  // Backfill missing columns if the table existed before
  try {
    await query("ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS buyer_username text");
  } catch (e) {
    console.error('[init] Failed to alter purchase_requests (buyer_username):', e);
  }
})();

// ---------- Purchase Requests ----------
// Create request (buy) — reserves quantity by decreasing warehouse quantity; forbids buying own items
app.post('/api/requests', authenticateToken, async (req, res) => {
  try {
    const { warehouseItemId, quantity } = req.body || {};
    const qty = Number(quantity);
    if (!warehouseItemId || !(qty > 0)) return res.status(400).json({ error: 'Некорректные данные' });
    const buyerId = req.user?.id;
    const buyer = (await query('SELECT id, username FROM users WHERE id = $1', [buyerId])).rows[0];
    if (!buyer) return res.status(401).json({ error: 'Нет пользователя' });
    const wres = await query('SELECT id, name, owner_login, quantity, cost, currency FROM warehouse_items WHERE id = $1', [warehouseItemId]);
    if (wres.rowCount === 0) return res.status(404).json({ error: 'Товар не найден' });
    const item = wres.rows[0];
    if (item.owner_login && item.owner_login === buyer.username) return res.status(400).json({ error: 'Нельзя покупать свой товар' });
    const available = Number(item.quantity) || 0;
    if (qty > available) return res.status(400).json({ error: 'Недостаточное количество на складе' });
    // Reserve by decreasing quantity
    await query('UPDATE warehouse_items SET quantity = quantity - $2, updated_at = now() WHERE id = $1', [warehouseItemId, qty]);
    const id = `r_${Date.now()}`;
    await query(
      `INSERT INTO purchase_requests(id, warehouse_item_id, buyer_user_id, buyer_username, quantity, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, warehouseItemId, buyer.id, buyer.username, qty, 'В обработке']
    );
    try { app.locals.io.emit('requests:changed', { id, action: 'created' }); } catch(_) {}
    res.json({ success: true, request: { id, warehouseItemId, buyerUserId: buyer.id, buyerUsername: buyer.username, quantity: qty, status: 'В обработке' } });
  } catch (e) {
    console.error('POST /api/requests error:', e);
    res.status(500).json({ error: 'Ошибка создания заявки' });
  }
});

// My requests (cart)
app.get('/api/my/requests', authenticateToken, async (req, res) => {
  try {
    const me = req.user?.id;
    const rows = (
      await query(
        `SELECT r.id, r.warehouse_item_id, r.quantity, r.status, r.created_at, w.name, w.cost, w.currency, w.owner_login
         FROM purchase_requests r JOIN warehouse_items w ON w.id = r.warehouse_item_id
         WHERE r.buyer_user_id = $1 ORDER BY r.created_at DESC`,
        [me]
      )
    ).rows;
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения корзины' });
  }
});

// Admin: list all requests
app.get('/api/requests', authenticateToken, requirePermission('requests', 'read'), async (req, res) => {
  try {
    const rows = (
      await query(
        `SELECT r.id, r.warehouse_item_id, r.quantity, r.status, r.created_at,
                r.buyer_user_id, r.buyer_username, w.name, w.cost, w.currency, w.owner_login
         FROM purchase_requests r JOIN warehouse_items w ON w.id = r.warehouse_item_id
         ORDER BY r.created_at DESC`
      )
    ).rows;
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения заявок' });
  }
});

// Confirm request: mark done, create finance transaction
// Allowed: admin (requests:write) OR seller (owner of the warehouse item)
app.put('/api/requests/:id/confirm', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const rres = await query('SELECT warehouse_item_id, buyer_user_id, quantity, status FROM purchase_requests WHERE id = $1', [id]);
    if (rres.rowCount === 0) return res.status(404).json({ error: 'Заявка не найдена' });
    const r = rres.rows[0];
    if (r.status === 'Выполнено') return res.json({ success: true });
    const w = (await query('SELECT id, owner_login, cost, currency FROM warehouse_items WHERE id = $1', [r.warehouse_item_id])).rows[0];
    if (!w) return res.status(404).json({ error: 'Товар не найден' });
    // Permissions: admin or owner
    const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
    if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
    const me = ures.rows[0];
    const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
    const isAdmin = me.account_type === 'Администратор' || perms?.requests === 'write';
    const isOwner = w.owner_login && w.owner_login === me.username;
    if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Недостаточно прав для подтверждения заявки' });
    // Create finance transaction: from buyer to owner
    const buyerId = r.buyer_user_id;
    const ownerUsername = w.owner_login;
    const amount = Math.ceil((Number(w.cost) || 0) * (Number(r.quantity) || 0));
    const currency = w.currency;
    const resolveId = async (val) => {
      if (!val) return null;
      const q = await query('SELECT id FROM users WHERE id = $1 OR username = $1 LIMIT 1', [val]);
      return q.rowCount > 0 ? q.rows[0].id : null;
    };
    const fromId = await resolveId(buyerId);
    const toId = await resolveId(ownerUsername);
    const tid = `t_${Date.now()}`;
    await query(
      `INSERT INTO transactions(id, type, amount, currency, from_user, to_user, item_id, meta, created_at)
       VALUES ($1,'income',$2,$3,$4,$5,$6,$7, now())`,
      [tid, amount, currency, fromId, toId, r.warehouse_item_id, JSON.stringify({ reqId: id })]
    );
    await query('UPDATE purchase_requests SET status = $2, updated_at = now() WHERE id = $1', [id, 'Выполнено']);
    try { app.locals.io.emit('transactions:changed', { id: tid, action: 'created' }); } catch(_) {}
    try { app.locals.io.emit('requests:changed', { id, action: 'updated' }); } catch(_) {}
    res.json({ success: true });
  } catch (e) {
    console.error('PUT /api/requests/:id/confirm error:', e);
    res.status(500).json({ error: 'Ошибка подтверждения заявки' });
  }
});

// Cancel request: mark cancelled and return reserved qty
// Allowed: admin (requests:write) OR original buyer
app.put('/api/requests/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const rres = await query('SELECT warehouse_item_id, quantity, status, buyer_user_id FROM purchase_requests WHERE id = $1', [id]);
    if (rres.rowCount === 0) return res.status(404).json({ error: 'Заявка не найдена' });
    const r = rres.rows[0];
    if (r.status === 'Отменена') return res.json({ success: true });
    // Permissions: admin or buyer
    const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
    if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
    const me = ures.rows[0];
    const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
    const isAdmin = me.account_type === 'Администратор' || perms?.users === 'write';
    const isBuyer = r.buyer_user_id && r.buyer_user_id === me.id;
    if (!isAdmin && !isBuyer) return res.status(403).json({ error: 'Недостаточно прав для отмены заявки' });
    // return reserved qty
    await query('UPDATE warehouse_items SET quantity = quantity + $2, updated_at = now() WHERE id = $1', [r.warehouse_item_id, Number(r.quantity)]);
    await query('UPDATE purchase_requests SET status = $2, updated_at = now() WHERE id = $1', [id, 'Отменена']);
    try { app.locals.io.emit('warehouse:changed', { id: r.warehouse_item_id, action: 'updated' }); } catch(_) {}
    try { app.locals.io.emit('requests:changed', { id, action: 'updated' }); } catch(_) {}
    res.json({ success: true });
  } catch (e) {
    console.error('PUT /api/requests/:id/cancel error:', e);
    res.status(500).json({ error: 'Ошибка отмены заявки' });
  }
});

// Delete request (allowed after confirm/cancel)
app.delete('/api/requests/:id', authenticateToken, requirePermission('requests', 'write'), async (req, res) => {
  try {
    const id = req.params.id;
    const r = (await query('SELECT status FROM purchase_requests WHERE id = $1', [id])).rows[0];
    if (!r) return res.status(404).json({ error: 'Не найдено' });
    if (r.status !== 'Выполнено' && r.status !== 'Отменена') return res.status(400).json({ error: 'Нельзя удалить незавершённую заявку' });
    await query('DELETE FROM purchase_requests WHERE id = $1', [id]);
    try { app.locals.io.emit('requests:changed', { id, action: 'deleted' }); } catch(_) {}
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления заявки' });
  }
});

// ---------- Discord Scopes & Mappings CRUD ----------
// List available scopes (dictionary)
app.get(
  '/api/discord/scopes',
  authenticateToken,
  requirePermission('settings', 'read'),
  async (req, res) => {
    try {
      const r = await query('SELECT name FROM discord_scopes ORDER BY name');
      res.json(r.rows.map((x) => x.name));
    } catch (e) {
      res.status(500).json({ error: 'Ошибка чтения справочника scopes' });
    }
  }
);

// (Removed) Discord Guild Mappings CRUD — feature deprecated

// Admin: change another user's password (local accounts only)
app.post(
  '/api/users/:id/password',
  authenticateToken,
  requirePermission('users', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const { newPassword } = req.body || {};
      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 4) {
        return res.status(400).json({ error: 'Новый пароль некорректен (минимум 4 символа)' });
      }
      const ures = await query('SELECT id, auth_type FROM users WHERE id = $1', [id]);
      if (ures.rowCount === 0) return res.status(404).json({ error: 'Пользователь не найден' });
      const user = ures.rows[0];
      if (user.auth_type !== 'local') {
        return res.status(400).json({ error: 'Сменить пароль можно только для локальных аккаунтов' });
      }
      const newHash = crypto.createHash('sha256').update(newPassword).digest('hex');
      await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
      res.json({ success: true });
    } catch (error) {
      console.error('POST /api/users/:id/password error:', error);
      res.status(500).json({ error: 'Ошибка смены пароля' });
    }
  }
);

// --------- Per-user layouts (persist grid layouts per page) ---------
// Get layout for page
app.get('/api/user/layouts/:page', authenticateToken, async (req, res) => {
  try {
    const page = decodeURIComponent(req.params.page || '');
    if (!page) return res.status(400).json({ error: 'Page не указан' });
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Нет пользователя' });
    const r = await query('SELECT layouts FROM user_layouts WHERE user_id = $1 AND page = $2', [
      userId,
      page,
    ]);
    if (r.rowCount === 0) return res.json({ layouts: null });
    return res.json({ layouts: r.rows[0].layouts });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения раскладки' });
  }
});

// Save layout for page
app.put('/api/user/layouts/:page', authenticateToken, async (req, res) => {
  try {
    const page = decodeURIComponent(req.params.page || '');
    if (!page) return res.status(400).json({ error: 'Page не указан' });
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Нет пользователя' });
    const { layouts } = req.body || {};
    if (!layouts || typeof layouts !== 'object')
      return res.status(400).json({ error: 'Некорректные данные раскладки' });
    await query(
      `INSERT INTO user_layouts(user_id, page, layouts, updated_at) VALUES ($1,$2,$3, now())
       ON CONFLICT (user_id, page) DO UPDATE SET layouts = EXCLUDED.layouts, updated_at = now()`,
      [userId, page, layouts]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения раскладки' });
  }
});

// Add a scope to dictionary
app.post(
  '/api/discord/scopes',
  authenticateToken,
  requirePermission('settings', 'write'),
  async (req, res) => {
    try {
      const { name } = req.body || {};
      if (!name || typeof name !== 'string' || name.trim() === '')
        return res.status(400).json({ error: 'Некорректное имя scope' });
      await query('INSERT INTO discord_scopes(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
        name.trim(),
      ]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка добавления scope' });
    }
  }
);

// Delete a scope from dictionary
app.delete(
  '/api/discord/scopes/:name',
  authenticateToken,
  requirePermission('settings', 'write'),
  async (req, res) => {
    try {
      const name = decodeURIComponent(req.params.name || '');
      if (!name) return res.status(400).json({ error: 'Имя не указано' });
      await query('DELETE FROM discord_scopes WHERE name = $1', [name]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления scope' });
    }
  }
);

// List mappings
app.get(
  '/api/discord/scope-mappings',
  authenticateToken,
  requirePermission('settings', 'read'),
  async (req, res) => {
    try {
      const r = await query(
        'SELECT scope, value, account_type, position FROM discord_scope_mappings ORDER BY (position IS NULL), position, scope, value'
      );
      res.json(r.rows);
    } catch (e) {
      res.status(500).json({ error: 'Ошибка чтения маппингов' });
    }
  }
);

// Upsert mapping
app.post(
  '/api/discord/scope-mappings',
  authenticateToken,
  requirePermission('settings', 'write'),
  async (req, res) => {
    try {
      const { scope, value, accountType, position } = req.body || {};
      if (!scope || !accountType) return res.status(400).json({ error: 'Укажите scope и тип' });
      // Определим позицию по умолчанию, если не передали
      let pos = position;
      if (pos == null) {
        try {
          const m = await query('SELECT COALESCE(MAX(position), 0) AS max_pos FROM discord_scope_mappings');
          pos = Number(m.rows?.[0]?.max_pos || 0) + 1;
        } catch (_) {
          pos = null;
        }
      }
      await query(
        `INSERT INTO discord_scope_mappings(scope, value, account_type, position) VALUES ($1,$2,$3,$4)
         ON CONFLICT (scope, value) DO UPDATE SET account_type = EXCLUDED.account_type, position = COALESCE(EXCLUDED.position, discord_scope_mappings.position)`,
        [scope, value ?? null, accountType, pos]
      );
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка сохранения маппинга' });
    }
  }
);

// Delete mapping
app.delete(
  '/api/discord/scope-mappings',
  authenticateToken,
  requirePermission('settings', 'write'),
  async (req, res) => {
    try {
      const { scope, value } = req.query || {};
      if (!scope) return res.status(400).json({ error: 'Укажите scope' });
      await query('DELETE FROM discord_scope_mappings WHERE scope = $1 AND value IS NOT DISTINCT FROM $2', [
        scope,
        value ?? null,
      ]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления маппинга' });
    }
  }
);

app.post('/api/users', authenticateToken, requirePermission('users', 'write'), async (req, res) => {
  try {
    const { username, email, password, accountType, isActive, nickname } = req.body || {};
    if (!username || !password || !accountType)
      return res.status(400).json({ error: 'Необходимы username, password и accountType' });
    const id = `u_${Date.now()}`;
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    await query(
      `INSERT INTO users(id, username, email, nickname, auth_type, password_hash, account_type, is_active, created_at)
       VALUES($1,$2,$3,$4,'local',$5,$6,COALESCE($7, TRUE), now())`,
      [
        id,
        username,
        email || null,
        nickname || null,
        hash,
        accountType,
        typeof isActive === 'boolean' ? isActive : true,
      ]
    );
    const perms = await getPermissionsForTypeDb(accountType);
    res.json({
      success: true,
      user: {
        id,
        username,
        nickname: nickname || null,
        email,
        authType: 'local',
        accountType,
        isActive: isActive !== false,
        permissions: perms,
      },
    });
  } catch (error) {
    console.error('POST /api/users error:', error);
    res.status(500).json({ error: 'Ошибка создания пользователя' });
  }
});

app.delete(
  '/api/users/:id',
  authenticateToken,
  requirePermission('users', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      await query('DELETE FROM users WHERE id = $1', [id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Ошибка удаления пользователя' });
    }
  }
);

// ---------- Account Types CRUD ----------
app.get(
  '/api/account-types',
  authenticateToken,
  requirePermission('users', 'read'),
  async (req, res) => {
    try {
      const at = await query('SELECT name FROM account_types ORDER BY name');
      const result = [];
      for (const row of at.rows) {
        const perms = await query(
          'SELECT resource, level FROM account_type_permissions WHERE account_type = $1',
          [row.name]
        );
        const wtypes = await query(
          'SELECT warehouse_type FROM account_type_warehouse_types WHERE account_type = $1 ORDER BY warehouse_type',
          [row.name]
        );
        result.push({
          name: row.name,
          permissions: Object.fromEntries(perms.rows.map((p) => [p.resource, p.level])),
          allowedWarehouseTypes: wtypes.rows.map((r) => r.warehouse_type),
        });
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: 'Ошибка чтения типов учетной записи' });
    }
  }
);

app.post(
  '/api/account-types',
  authenticateToken,
  requirePermission('users', 'write'),
  async (req, res) => {
    try {
      const { name, permissions, allowedWarehouseTypes } = req.body || {};
      if (!name || typeof name !== 'string')
        return res.status(400).json({ error: 'Некорректное имя типа' });
      await query('INSERT INTO account_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
        name,
      ]);
      if (permissions && typeof permissions === 'object') {
        for (const [resource, level] of Object.entries(permissions)) {
          if (!level) continue;
          await query(
            `INSERT INTO account_type_permissions(account_type, resource, level) VALUES ($1,$2,$3)
           ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level`,
            [name, resource, level]
          );
        }
      }
      if (Array.isArray(allowedWarehouseTypes)) {
        // Очистим и запишем актуальные связи по типам склада
        await query('DELETE FROM account_type_warehouse_types WHERE account_type = $1', [name]);
        for (const wt of allowedWarehouseTypes) {
          if (wt && typeof wt === 'string') {
            await query(
              'INSERT INTO account_type_warehouse_types(account_type, warehouse_type) VALUES ($1,$2) ON CONFLICT (account_type, warehouse_type) DO NOTHING',
              [name, wt]
            );
          }
        }
      }
      res.json({ success: true });
    } catch (e) {
      console.error('POST /api/account-types error:', e);
      res.status(500).json({ error: 'Ошибка сохранения типа' });
    }
  }
);

app.put(
  '/api/account-types/:name',
  authenticateToken,
  requirePermission('users', 'write'),
  async (req, res) => {
    try {
      const currentName = decodeURIComponent(req.params.name || '');
      const { name, permissions, allowedWarehouseTypes } = req.body || {};
      if (!currentName) return res.status(400).json({ error: 'Имя не указано' });
      // Rename if needed
      if (name && name !== currentName) {
        await query('UPDATE account_types SET name = $1 WHERE name = $2', [name, currentName]);
      }
      const target = name || currentName;
      if (permissions && typeof permissions === 'object') {
        for (const [resource, level] of Object.entries(permissions)) {
          if (!level) continue;
          await query(
            `INSERT INTO account_type_permissions(account_type, resource, level) VALUES ($1,$2,$3)
           ON CONFLICT (account_type, resource) DO UPDATE SET level = EXCLUDED.level`,
            [target, resource, level]
          );
        }
      }
      if (Array.isArray(allowedWarehouseTypes)) {
        await query('DELETE FROM account_type_warehouse_types WHERE account_type = $1', [target]);
        for (const wt of allowedWarehouseTypes) {
          if (wt && typeof wt === 'string') {
            await query(
              'INSERT INTO account_type_warehouse_types(account_type, warehouse_type) VALUES ($1,$2) ON CONFLICT (account_type, warehouse_type) DO NOTHING',
              [target, wt]
            );
          }
        }
      }
      const perms = await query(
        'SELECT resource, level FROM account_type_permissions WHERE account_type = $1',
        [target]
      );
      const wtypes = await query(
        'SELECT warehouse_type FROM account_type_warehouse_types WHERE account_type = $1 ORDER BY warehouse_type',
        [target]
      );
      res.json({
        success: true,
        accountType: {
          name: target,
          permissions: Object.fromEntries(perms.rows.map((p) => [p.resource, p.level])),
          allowedWarehouseTypes: wtypes.rows.map((r) => r.warehouse_type),
        },
      });
    } catch (e) {
      console.error('PUT /api/account-types/:name error:', e);
      res.status(500).json({ error: 'Ошибка обновления типа' });
    }
  }
);

app.delete(
  '/api/account-types/:name',
  authenticateToken,
  requirePermission('users', 'write'),
  async (req, res) => {
    try {
      const name = decodeURIComponent(req.params.name || '');
      if (!name) return res.status(400).json({ error: 'Имя не указано' });
      await query('DELETE FROM account_type_permissions WHERE account_type = $1', [name]);
      await query('DELETE FROM account_types WHERE name = $1', [name]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления типа' });
    }
  }
);

// ---------- Warehouse CRUD ----------
app.get(
  '/api/warehouse',
  authenticateToken,
  requirePermission('warehouse', 'read'),
  async (req, res) => {
    try {
      // Получим список разрешенных типов склада для текущего типа учетной записи
      let allowedTypes = null;
      try {
        const ures = await query('SELECT account_type FROM users WHERE id = $1', [req.user.id]);
        const accType = ures.rows[0]?.account_type || null;
        if (accType) {
          const wres = await query(
            'SELECT warehouse_type FROM account_type_warehouse_types WHERE account_type = $1',
            [accType]
          );
          const arr = wres.rows.map((r) => r.warehouse_type).filter(Boolean);
          allowedTypes = arr; // может быть пустым массивом
        }
      } catch (_) {}

      let w;
      if (Array.isArray(allowedTypes) && allowedTypes.length > 0) {
        w = await query(
          'SELECT id, name, type, quantity, cost, currency, location, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items WHERE warehouse_type = ANY($1) ORDER BY created_at DESC',
          [allowedTypes]
        );
      } else {
        // Если список разрешенных типов пуст или не задан — ничего не показываем
        w = { rows: [] };
      }
      const items = w.rows.map((it) => ({
        id: it.id,
        name: it.name,
        type: it.type || null,
        quantity: Number(it.quantity) || 0,
        price: it.cost !== null && it.cost !== undefined ? Number(it.cost) : undefined,
        currency: it.currency || null,
        location: it.location || null,
        displayCurrencies: it.display_currencies || undefined,
        meta: it.meta || undefined,
        warehouseType: it.warehouse_type || null,
        ownerLogin: it.owner_login || null,
        createdAt: it.created_at ? new Date(it.created_at).toISOString() : undefined,
        updatedAt: it.updated_at ? new Date(it.updated_at).toISOString() : undefined,
      }));
      res.json(items);
    } catch (e) {
      res.status(500).json({ error: 'Ошибка чтения склада' });
    }
  }
);

app.post(
  '/api/warehouse',
  authenticateToken,
  requirePermission('warehouse', 'write'),
  async (req, res) => {
    try {
      const { id, name, type, quantity, price, currency, location, displayCurrencies, meta, warehouseType, ownerLogin } =
        req.body || {};
      if (!name) return res.status(400).json({ error: 'Название обязательно' });
      const newId = id || `w_${Date.now()}`;
      // Определяем текущего пользователя и его права
      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
      const isAdmin = me.account_type === 'Администратор' || perms?.users === 'write';
      const existing = await query('SELECT id, owner_login FROM warehouse_items WHERE id = $1', [newId]);
      if (existing.rowCount > 0) {
        const isOwner = existing.rows[0]?.owner_login && existing.rows[0].owner_login === me.username;
        if (!isAdmin && !isOwner) {
          return res.status(403).json({ error: 'Недостаточно прав для обновления товара' });
        }
      }
      const effectiveOwnerLogin = isAdmin ? (ownerLogin || me.username) : me.username;
      if (type)
        await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
          type,
        ]);
      if (location)
        await query(
          'INSERT INTO warehouse_locations(name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
          [location]
        );
      if (warehouseType)
        await query('INSERT INTO warehouse_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
          warehouseType,
        ]);
      const effCurrency = currency || (Array.isArray(displayCurrencies) && displayCurrencies.length > 0 ? displayCurrencies[0] : null);
      await query(
        `INSERT INTO warehouse_items(id, name, type, quantity, cost, currency, location, display_currencies, meta, warehouse_type, owner_login, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, quantity = EXCLUDED.quantity, cost = EXCLUDED.cost,
         currency = COALESCE($6, warehouse_items.currency), location = EXCLUDED.location, display_currencies = COALESCE($8, warehouse_items.display_currencies), meta = EXCLUDED.meta, warehouse_type = EXCLUDED.warehouse_type, owner_login = EXCLUDED.owner_login, updated_at = now()`,
        [
          newId,
          name,
          type || null,
          Number(quantity) || 0,
          price !== undefined ? Number(price) : null,
          effCurrency || null,
          location || null,
          displayCurrencies || null,
          meta ? JSON.stringify(meta) : null,
          warehouseType || null,
          effectiveOwnerLogin || null,
        ]
      );
      const row = (
        await query(
          'SELECT id, name, type, quantity, cost, currency, location, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items WHERE id = $1',
          [newId]
        )
      ).rows[0];
      try { app.locals.io.emit('warehouse:changed', { id: newId, action: existing.rowCount > 0 ? 'updated' : 'created' }); } catch (_) {}
      res.json({ success: true, item: row });
    } catch (e) {
      console.error('POST /api/warehouse error:', e);
      res.status(500).json({ error: 'Ошибка сохранения товара' });
    }
  }
);

app.put(
  '/api/warehouse/:id',
  authenticateToken,
  requirePermission('warehouse', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const { name, type, quantity, price, currency, location, displayCurrencies, meta, warehouseType, ownerLogin } =
        req.body || {};
      const exists = await query('SELECT 1 FROM warehouse_items WHERE id = $1', [id]);
      if (exists.rowCount === 0) return res.status(404).json({ error: 'Позиция не найдена' });
      // Allow update only for admin or owner of item
      try {
        const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
        if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
        const me = ures.rows[0];
        const perms = await getPermissionsForTypeDb(me.account_type);
        const isAdmin = me.account_type === 'Администратор' || perms.users === 'write';
        const itemRes = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [id]);
        const isOwner = itemRes.rows[0]?.owner_login && itemRes.rows[0].owner_login === me.username;
        if (!isAdmin && !isOwner) {
          return res.status(403).json({ error: 'Недостаточно прав для редактирования товара' });
        }
        var effectiveOwnerLogin = isAdmin ? (ownerLogin ?? itemRes.rows[0]?.owner_login ?? me.username) : (itemRes.rows[0]?.owner_login ?? me.username);
      } catch (_) {
        // if check fails unexpectedly, forbid
        return res.status(403).json({ error: 'Недостаточно прав' });
      }
      if (type)
        await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
          type,
        ]);
      if (location)
        await query(
          'INSERT INTO warehouse_locations(name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
          [location]
        );
      if (warehouseType)
        await query('INSERT INTO warehouse_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
          warehouseType,
        ]);
      const effCurrencyUpdate = currency || (Array.isArray(displayCurrencies) && displayCurrencies.length > 0 ? displayCurrencies[0] : null);
      await query(
        `UPDATE warehouse_items SET name = COALESCE($2,name), type = COALESCE($3,type), quantity = COALESCE($4,quantity), cost = $5,
        currency = COALESCE($6,currency), location = COALESCE($7,location), display_currencies = COALESCE($8, display_currencies), meta = $9, warehouse_type = COALESCE($10, warehouse_type), owner_login = COALESCE($11, owner_login), updated_at = now() WHERE id = $1`,
        [
          id,
          name || null,
          type || null,
          quantity !== undefined ? Number(quantity) : null,
          price !== undefined ? Number(price) : null,
          effCurrencyUpdate || null,
          location || null,
          displayCurrencies || null,
          meta ? JSON.stringify(meta) : null,
          warehouseType || null,
          effectiveOwnerLogin || null,
        ]
      );
      const row = (
        await query(
          'SELECT id, name, type, quantity, cost, currency, location, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items WHERE id = $1',
          [id]
        )
      ).rows[0];
      try { app.locals.io.emit('warehouse:changed', { id, action: 'updated' }); } catch (_) {}
      res.json({ success: true, item: row });
    } catch (e) {
      console.error('PUT /api/warehouse/:id error:', e);
      res.status(500).json({ error: 'Ошибка обновления товара' });
    }
  }
);

// Change quantity: allowed for admin or ownerLogin of item
app.patch('/api/warehouse/:id/quantity', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const { quantity } = req.body || {};
    if (quantity == null || isNaN(Number(quantity))) {
      return res.status(400).json({ error: 'Некорректное количество' });
    }
    const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
    if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
    const me = ures.rows[0];
    const itemRes = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [id]);
    if (itemRes.rowCount === 0) return res.status(404).json({ error: 'Позиция не найдена' });
    const isAdmin = me.account_type === 'Администратор';
    const isOwner = itemRes.rows[0].owner_login && itemRes.rows[0].owner_login === me.username;
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'Недостаточно прав для изменения количества' });
    }
    await query('UPDATE warehouse_items SET quantity = $2, updated_at = now() WHERE id = $1', [id, Number(quantity)]);
    try { app.locals.io.emit('warehouse:changed', { id, action: 'updated' }); } catch (_) {}
    res.json({ success: true });
  } catch (e) {
    console.error('PATCH /api/warehouse/:id/quantity error:', e);
    res.status(500).json({ error: 'Ошибка обновления количества' });
  }
});

app.delete(
  '/api/warehouse/:id',
  authenticateToken,
  requirePermission('warehouse', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      // Проверка прав владельца/админа
      const exists = await query('SELECT id, owner_login FROM warehouse_items WHERE id = $1', [id]);
      if (exists.rowCount === 0) return res.status(404).json({ error: 'Позиция не найдена' });
      const item = exists.rows[0];
      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
      const isAdmin = me.account_type === 'Администратор' || perms?.users === 'write';
      const isOwner = item.owner_login && item.owner_login === me.username;
      if (!isAdmin && !isOwner) {
        return res.status(403).json({ error: 'Недостаточно прав для удаления товара' });
      }
      await query('DELETE FROM warehouse_items WHERE id = $1', [id]);
      try { app.locals.io.emit('warehouse:changed', { id, action: 'deleted' }); } catch (_) {}
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления товара' });
    }
  }
);

// ---------- Showcase CRUD (uses warehouse permissions) ----------
app.get(
  '/api/showcase',
  authenticateToken,
  requirePermission('showcase', 'read'),
  async (req, res) => {
    try {
      const q = (req.query?.q || '').toString().trim();
      let scRes;
      if (q) {
        // Экранируем спецсимволы для ILIKE/ESCAPE
        const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
        scRes = await query(
          `SELECT s.id, s.warehouse_item_id, s.status, s.price, s.currency, s.meta, s.created_at, s.updated_at
           FROM showcase_items s
           LEFT JOIN warehouse_items w ON w.id = s.warehouse_item_id
           WHERE (
             -- Showcase fields
             s.id ILIKE $1 ESCAPE '\\' OR
             COALESCE(s.warehouse_item_id,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(s.status,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(s.currency,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(CAST(s.price AS TEXT),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(CAST(s.meta AS TEXT),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(TO_CHAR(s.created_at, 'YYYY-MM-DD HH24:MI:SS'),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(TO_CHAR(s.updated_at, 'YYYY-MM-DD HH24:MI:SS'),'') ILIKE $1 ESCAPE '\\' OR
             -- Warehouse joined fields
             COALESCE(w.id,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(w.name,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(w.type,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(CAST(w.quantity AS TEXT),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(CAST(w.cost AS TEXT),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(w.currency,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(w.location,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(CAST(w.display_currencies AS TEXT),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(CAST(w.meta AS TEXT),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(w.warehouse_type,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(w.owner_login,'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(TO_CHAR(w.created_at, 'YYYY-MM-DD HH24:MI:SS'),'') ILIKE $1 ESCAPE '\\' OR
             COALESCE(TO_CHAR(w.updated_at, 'YYYY-MM-DD HH24:MI:SS'),'') ILIKE $1 ESCAPE '\\'
           )
           ORDER BY s.created_at DESC`,
          [like]
        );
      } else {
        scRes = await query(
          'SELECT id, warehouse_item_id, status, price, currency, meta, created_at, updated_at FROM showcase_items ORDER BY created_at DESC'
        );
      }
      const items = scRes.rows.map((srow) => ({
        id: srow.id,
        warehouseItemId: srow.warehouse_item_id || null,
        status: srow.status || null,
        price: srow.price !== null && srow.price !== undefined ? Number(srow.price) : undefined,
        currency: srow.currency || null,
        meta: srow.meta || undefined,
        createdAt: srow.created_at ? new Date(srow.created_at).toISOString() : undefined,
        updatedAt: srow.updated_at ? new Date(srow.updated_at).toISOString() : undefined,
      }));
      res.json(items);
    } catch (e) {
      res.status(500).json({ error: 'Ошибка чтения витрины' });
    }
  }
);

app.post(
  '/api/showcase',
  authenticateToken,
  requirePermission('showcase', 'write'),
  async (req, res) => {
    try {
      const { id, warehouseItemId, status, price, currency, meta } = req.body || {};
      const newId = id || `s_${Date.now()}`;
      // Проверка: только админ или владелец связанного товарa может создавать/обновлять запись витрины
      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
      const isAdmin = me.account_type === 'Администратор' || perms?.users === 'write';
      if (warehouseItemId) {
        const w = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [warehouseItemId]);
        if (w.rowCount === 0) return res.status(400).json({ error: 'Связанный товар не найден' });
        const isOwner = w.rows[0]?.owner_login && w.rows[0].owner_login === me.username;
        if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Недостаточно прав для размещения товара на витрине' });
      } else if (!isAdmin) {
        // нет warehouseItemId — только админ может создавать такие записи
        return res.status(403).json({ error: 'Недостаточно прав для создания позиции витрины' });
      }
      if (status)
        await query(
          'INSERT INTO showcase_statuses(name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
          [status]
        );
      await query(
        `INSERT INTO showcase_items(id, warehouse_item_id, status, price, currency, meta, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (id) DO UPDATE SET warehouse_item_id = EXCLUDED.warehouse_item_id, status = EXCLUDED.status, price = EXCLUDED.price,
         currency = EXCLUDED.currency, meta = EXCLUDED.meta, updated_at = now()`,
        [
          newId,
          warehouseItemId || null,
          status || null,
          price !== undefined ? Number(price) : null,
          currency || null,
          meta ? JSON.stringify(meta) : null,
        ]
      );
      const row = (
        await query(
          'SELECT id, warehouse_item_id, status, price, currency, meta, created_at, updated_at FROM showcase_items WHERE id = $1',
          [newId]
        )
      ).rows[0];
      try { app.locals.io.emit('showcase:changed', { id: newId, action: 'created' }); } catch (_) {}
      res.json({ success: true, item: row });
    } catch (e) {
      console.error('POST /api/showcase error:', e);
      res.status(500).json({ error: 'Ошибка сохранения позиции витрины' });
    }
  }
);

app.put(
  '/api/showcase/:id',
  authenticateToken,
  requirePermission('showcase', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const { warehouseItemId, status, price, currency, meta } = req.body || {};
      const exists = await query('SELECT 1 FROM showcase_items WHERE id = $1', [id]);
      if (exists.rowCount === 0) return res.status(404).json({ error: 'Позиция не найдена' });
      // Проверка прав: админ или владелец связанного товара
      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
      const isAdmin = me.account_type === 'Администратор' || perms?.users === 'write';
      const current = await query('SELECT warehouse_item_id FROM showcase_items WHERE id = $1', [id]);
      const targetWid = warehouseItemId || current.rows[0]?.warehouse_item_id || null;
      if (targetWid) {
        const w = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [targetWid]);
        if (w.rowCount === 0) return res.status(400).json({ error: 'Связанный товар не найден' });
        const isOwner = w.rows[0]?.owner_login && w.rows[0].owner_login === me.username;
        if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Недостаточно прав для изменения позиции витрины' });
      } else if (!isAdmin) {
        return res.status(403).json({ error: 'Недостаточно прав для изменения позиции витрины' });
      }
      if (status)
        await query(
          'INSERT INTO showcase_statuses(name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
          [status]
        );
      await query(
        `UPDATE showcase_items SET warehouse_item_id = COALESCE($2, warehouse_item_id), status = COALESCE($3, status), price = $4,
        currency = COALESCE($5, currency), meta = $6, updated_at = now() WHERE id = $1`,
        [
          id,
          warehouseItemId || null,
          status || null,
          price !== undefined ? Number(price) : null,
          currency || null,
          meta ? JSON.stringify(meta) : null,
        ]
      );
      const row = (
        await query(
          'SELECT id, warehouse_item_id, status, price, currency, meta, created_at, updated_at FROM showcase_items WHERE id = $1',
          [id]
        )
      ).rows[0];
      try { app.locals.io.emit('showcase:changed', { id, action: 'updated' }); } catch (_) {}
      res.json({ success: true, item: row });
    } catch (e) {
      console.error('PUT /api/showcase/:id error:', e);
      res.status(500).json({ error: 'Ошибка обновления позиции витрины' });
    }
  }
);

app.delete(
  '/api/showcase/:id',
  authenticateToken,
  requirePermission('showcase', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      // Проверка прав: админ или владелец связанного товара
      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
      const isAdmin = me.account_type === 'Администратор' || perms?.users === 'write';
      const cur = await query('SELECT warehouse_item_id FROM showcase_items WHERE id = $1', [id]);
      if (cur.rowCount === 0) return res.status(404).json({ error: 'Позиция не найдена' });
      const wid = cur.rows[0]?.warehouse_item_id || null;
      if (wid) {
        const w = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [wid]);
        const isOwner = w.rows[0]?.owner_login && w.rows[0].owner_login === me.username;
        if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Недостаточно прав для удаления позиции витрины' });
      } else if (!isAdmin) {
        return res.status(403).json({ error: 'Недостаточно прав для удаления позиции витрины' });
      }
      await query('DELETE FROM showcase_items WHERE id = $1', [id]);
      try { app.locals.io.emit('showcase:changed', { id, action: 'deleted' }); } catch (_) {}
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления позиции витрины' });
    }
  }
);

// Remove all showcase entries by warehouse item id (helper for toggle)
app.delete(
  '/api/showcase/by-warehouse/:warehouseItemId',
  authenticateToken,
  requirePermission('showcase', 'write'),
  async (req, res) => {
    try {
      const wid = req.params.warehouseItemId;
      // Проверка прав: админ или владелец товара
      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
      const isAdmin = me.account_type === 'Администратор' || perms?.users === 'write';
      const w = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [wid]);
      if (w.rowCount === 0) return res.status(404).json({ error: 'Товар не найден' });
      const isOwner = w.rows[0]?.owner_login && w.rows[0].owner_login === me.username;
      if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Недостаточно прав для очистки витрины по товару' });
      await query('DELETE FROM showcase_items WHERE warehouse_item_id = $1', [wid]);
      try { app.locals.io.emit('showcase:changed', { warehouseItemId: wid, action: 'deleted_by_warehouse' }); } catch (_) {}
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления по товару' });
    }
  }
);

// ---------- Transactions CRUD ----------
app.get(
  '/api/transactions',
  authenticateToken,
  requirePermission('finance', 'read'),
  async (req, res) => {
    try {
      // Determine current user and privileges
      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
      const isAdmin = me.account_type === 'Администратор' || perms?.users === 'write' || perms?.finance === 'write';

      let t;
      if (isAdmin) {
        t = await query(
          'SELECT id, type, amount, currency, from_user, to_user, item_id, meta, created_at FROM transactions ORDER BY created_at DESC'
        );
      } else {
        t = await query(
          'SELECT id, type, amount, currency, from_user, to_user, item_id, meta, created_at FROM transactions WHERE from_user = $1 OR to_user = $1 ORDER BY created_at DESC',
          [me.id]
        );
      }
      const items = t.rows.map((r) => ({
        id: r.id,
        type: r.type,
        amount: Number(r.amount) || 0,
        currency: r.currency,
        from_user: r.from_user || null,
        to_user: r.to_user || null,
        item_id: r.item_id || null,
        meta: r.meta || undefined,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
      }));
      res.json(items);
    } catch (e) {
      res.status(500).json({ error: 'Ошибка чтения транзакций' });
    }
  }
);

app.post(
  '/api/transactions',
  authenticateToken,
  requirePermission('finance', 'write'),
  async (req, res) => {
    try {
      const { id, type, amount, currency, from_user, to_user, item_id, meta } = req.body || {};
      if (!type) return res.status(400).json({ error: 'Тип обязателен' });
      if (!currency) return res.status(400).json({ error: 'Валюта обязательна' });
      const newId = id || `t_${Date.now()}`;
      // Resolve from_user/to_user to user IDs if client passes username
      const resolveUserId = async (val) => {
        if (!val) return null;
        const r = await query('SELECT id FROM users WHERE id = $1 OR username = $1 LIMIT 1', [val]);
        return r.rowCount > 0 ? r.rows[0].id : null;
      };
      const fromUserId = await resolveUserId(from_user);
      const toUserId = await resolveUserId(to_user);
      if (type === 'outcome') {
        if (!toUserId) return res.status(400).json({ error: 'Получатель обязателен для исходящей транзакции' });
        if (fromUserId && toUserId && fromUserId === toUserId) return res.status(400).json({ error: 'Отправитель и получатель не могут совпадать' });
      }
      // Подготовим meta и статус
      let metaObj = {};
      try { metaObj = meta && typeof meta === 'object' ? meta : (meta ? JSON.parse(String(meta)) : {}); } catch (_) { metaObj = {}; }
      // Для исходящих транзакций создадим запрос на подтверждение получателем
      let financeReqId = null;
      if (type === 'outcome' && toUserId) {
        financeReqId = `fr_${Date.now()}`;
        metaObj.status = metaObj.status || 'В обработке';
        metaObj.financeRequestId = financeReqId;
      }
      await query(
        `INSERT INTO transactions(id, type, amount, currency, from_user, to_user, item_id, meta, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, amount = EXCLUDED.amount, currency = EXCLUDED.currency,
         from_user = EXCLUDED.from_user, to_user = EXCLUDED.to_user, item_id = EXCLUDED.item_id, meta = EXCLUDED.meta`,
        [
          newId,
          type,
          Number(amount) || 0,
          currency,
          fromUserId,
          toUserId,
          item_id || null,
          Object.keys(metaObj).length ? JSON.stringify(metaObj) : null,
        ]
      );
      // Если требуется — создадим finance_requests
      if (financeReqId) {
        await query(
          `CREATE TABLE IF NOT EXISTS finance_requests (
            id TEXT PRIMARY KEY,
            transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
            from_user TEXT REFERENCES users(id) ON DELETE SET NULL,
            to_user TEXT REFERENCES users(id) ON DELETE SET NULL,
            status TEXT NOT NULL DEFAULT 'В обработке',
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITHOUT TIME ZONE
          )`
        ).catch(() => {});
        await query(
          `INSERT INTO finance_requests(id, transaction_id, from_user, to_user, status, created_at)
           VALUES ($1,$2,$3,$4,'В обработке', now())
           ON CONFLICT (id) DO NOTHING`,
          [financeReqId, newId, fromUserId, toUserId]
        );
        try { app.locals.io.emit('finance_requests:changed', { id: financeReqId, action: 'created' }); } catch(_) {}
      }
      const row = (
        await query(
          'SELECT id, type, amount, currency, from_user, to_user, item_id, meta, created_at FROM transactions WHERE id = $1',
          [newId]
        )
      ).rows[0];
      try { app.locals.io.emit('transactions:changed', { id: newId, action: 'created' }); } catch (_) {}
      res.json({ success: true, item: row });
    } catch (e) {
      console.error('POST /api/transactions error:', e);
      res.status(500).json({ error: 'Ошибка сохранения транзакции' });
    }
  }
);

// ---------- Finance Requests workflow ----------
// Related to current user (as sender or recipient)
app.get('/api/finance-requests/related', authenticateToken, async (req, res) => {
  try {
    const me = (await query('SELECT id FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!me) return res.status(401).json({ error: 'Нет пользователя' });
    const rows = (
      await query(
        `SELECT fr.id, fr.transaction_id,
                fr.from_user, uf.username AS from_username,
                fr.to_user, ut.username AS to_username,
                fr.status, fr.created_at, fr.updated_at,
                t.amount, t.currency, t.type
         FROM finance_requests fr
         JOIN transactions t ON t.id = fr.transaction_id
         LEFT JOIN users uf ON uf.id = fr.from_user
         LEFT JOIN users ut ON ut.id = fr.to_user
         WHERE fr.from_user = $1 OR fr.to_user = $1
         ORDER BY fr.created_at DESC`,
        [me.id]
      )
    ).rows;
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения заявок по транзакциям' });
  }
});

// Confirm: only recipient (to_user) or admin (finance:write)
app.put('/api/finance-requests/:id/confirm', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const fr = (
      await query('SELECT id, transaction_id, from_user, to_user, status FROM finance_requests WHERE id = $1', [id])
    ).rows[0];
    if (!fr) return res.status(404).json({ error: 'Заявка не найдена' });
    if (fr.status === 'Выполнено') return res.json({ success: true });
    const me = (await query('SELECT id, account_type FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!me) return res.status(401).json({ error: 'Нет пользователя' });
    const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
    const isAdmin = me.account_type === 'Администратор' || perms?.finance === 'write';
    const isRecipient = fr.to_user === me.id;
    if (!isAdmin && !isRecipient) return res.status(403).json({ error: 'Недостаточно прав для подтверждения' });
    await query('UPDATE finance_requests SET status = $2, updated_at = now() WHERE id = $1', [id, 'Выполнено']);
    // Обновим meta транзакции: status -> Выполнено
    await query(
      `UPDATE transactions SET meta = COALESCE(meta, '{}'::jsonb) || '{"status":"Выполнено"}'::jsonb WHERE id = $1`,
      [fr.transaction_id]
    );
    try { app.locals.io.emit('finance_requests:changed', { id, action: 'updated' }); } catch(_) {}
    try { app.locals.io.emit('transactions:changed', { id: fr.transaction_id, action: 'updated' }); } catch(_) {}
    res.json({ success: true });
  } catch (e) {
    console.error('PUT /api/finance-requests/:id/confirm error:', e);
    res.status(500).json({ error: 'Ошибка подтверждения заявки' });
  }
});

// Cancel: recipient or admin
app.put('/api/finance-requests/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const fr = (
      await query('SELECT id, transaction_id, from_user, to_user, status FROM finance_requests WHERE id = $1', [id])
    ).rows[0];
    if (!fr) return res.status(404).json({ error: 'Заявка не найдена' });
    if (fr.status === 'Отменена') return res.json({ success: true });
    const me = (await query('SELECT id, account_type FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!me) return res.status(401).json({ error: 'Нет пользователя' });
    const perms = await getPermissionsForTypeDb(me.account_type).catch(() => ({}));
    const isAdmin = me.account_type === 'Администратор' || perms?.finance === 'write';
    const isRecipient = fr.to_user === me.id;
    if (!isAdmin && !isRecipient) return res.status(403).json({ error: 'Недостаточно прав для отмены' });
    // При отмене удаляем связанную транзакцию; каскадно удалится и запись finance_requests (ON DELETE CASCADE)
    await query('DELETE FROM transactions WHERE id = $1', [fr.transaction_id]);
    // На всякий случай пометим заявку как отменённую, если каскад не сработал (не критично, best-effort)
    await query('UPDATE finance_requests SET status = $2, updated_at = now() WHERE id = $1', [id, 'Отменена']).catch(() => {});
    // События для фронтенда: помечаем как удалённые
    try { app.locals.io.emit('finance_requests:changed', { id, action: 'deleted' }); } catch(_) {}
    try { app.locals.io.emit('transactions:changed', { id: fr.transaction_id, action: 'deleted' }); } catch(_) {}
    res.json({ success: true });
  } catch (e) {
    console.error('PUT /api/finance-requests/:id/cancel error:', e);
    res.status(500).json({ error: 'Ошибка отмены заявки' });
  }
});

app.put(
  '/api/transactions/:id',
  authenticateToken,
  requirePermission('finance', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const { type, amount, currency, from_user, to_user, item_id, meta } = req.body || {};
      const exists = await query('SELECT 1 FROM transactions WHERE id = $1', [id]);
      if (exists.rowCount === 0) return res.status(404).json({ error: 'Транзакция не найдена' });
      const resolveUserId = async (val) => {
        if (!val) return null;
        const r = await query('SELECT id FROM users WHERE id = $1 OR username = $1 LIMIT 1', [val]);
        return r.rowCount > 0 ? r.rows[0].id : null;
      };
      const fromUserId = await resolveUserId(from_user);
      const toUserId = await resolveUserId(to_user);
      await query(
        `UPDATE transactions SET type = COALESCE($2,type), amount = COALESCE($3,amount), currency = COALESCE($4,currency),
        from_user = COALESCE($5,from_user), to_user = COALESCE($6,to_user), item_id = COALESCE($7,item_id), meta = $8 WHERE id = $1`,
        [
          id,
          type || null,
          amount !== undefined ? Number(amount) : null,
          currency || null,
          fromUserId,
          toUserId,
          item_id || null,
          meta ? JSON.stringify(meta) : null,
        ]
      );
      const row = (
        await query(
          'SELECT id, type, amount, currency, from_user, to_user, item_id, meta, created_at FROM transactions WHERE id = $1',
          [id]
        )
      ).rows[0];
      try { app.locals.io.emit('transactions:changed', { id, action: 'updated' }); } catch (_) {}
      res.json({ success: true, item: row });
    } catch (e) {
      console.error('PUT /api/transactions/:id error:', e);
      res.status(500).json({ error: 'Ошибка обновления транзакции' });
    }
  }
);

app.delete(
  '/api/transactions/:id',
  authenticateToken,
  requirePermission('finance', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      await query('DELETE FROM transactions WHERE id = $1', [id]);
      try { app.locals.io.emit('transactions:changed', { id, action: 'deleted' }); } catch (_) {}
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления транзакции' });
    }
  }
);

// ---------- Directories CRUD (Stage 2) ----------
// Helper to load directories from tables
const loadDirectoriesFromDb = async () => {
  const result = {
    productTypes: [],
    showcaseStatuses: [],
    warehouseLocations: [],
    productNames: [],
    warehouseTypes: [],
  };
  try {
    const pt = await query('SELECT name FROM product_types ORDER BY name');
    result.productTypes = pt.rows.map((r) => r.name);
  } catch (_) {}
  try {
    const ss = await query('SELECT name FROM showcase_statuses ORDER BY name');
    result.showcaseStatuses = ss.rows.map((r) => r.name);
  } catch (_) {}
  try {
    const wl = await query('SELECT name FROM warehouse_locations ORDER BY name');
    result.warehouseLocations = wl.rows.map((r) => r.name);
  } catch (_) {}
  try {
    const pn = await query('SELECT name, type FROM product_names ORDER BY name');
    result.productNames = pn.rows.map((r) => ({ name: r.name, type: r.type || null }));
  } catch (_) {}
  try {
    const wt = await query('SELECT name FROM warehouse_types ORDER BY name');
    result.warehouseTypes = wt.rows.map((r) => r.name);
  } catch (_) {}
  return result;
};

app.get(
  '/api/directories',
  authenticateToken,
  requirePermission('directories', 'read'),
  async (req, res) => {
    try {
      const dirs = await loadDirectoriesFromDb();
      res.json(dirs);
    } catch (e) {
      res.status(500).json({ error: 'Ошибка чтения справочников' });
    }
  }
);

// Product Types
app.post(
  '/api/directories/product-types',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const { name } = req.body || {};
      if (!name || typeof name !== 'string')
        return res.status(400).json({ error: 'Некорректное имя типа' });
      await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
        name.trim(),
      ]);
      const dirs = await loadDirectoriesFromDb();
      res.json({ success: true, directories: dirs });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка сохранения типа' });
    }
  }
);

app.delete(
  '/api/directories/product-types/:name',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const name = decodeURIComponent(req.params.name || '');
      if (!name) return res.status(400).json({ error: 'Имя не указано' });
      await query('DELETE FROM product_types WHERE name = $1', [name]);
      const dirs = await loadDirectoriesFromDb();
      res.json({ success: true, directories: dirs });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления типа' });
    }
  }
);

// Showcase Statuses
app.post(
  '/api/directories/showcase-statuses',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const { name } = req.body || {};
      if (!name || typeof name !== 'string')
        return res.status(400).json({ error: 'Некорректное имя статуса' });
      await query('INSERT INTO showcase_statuses(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
        name.trim(),
      ]);
      const dirs = await loadDirectoriesFromDb();
      res.json({ success: true, directories: dirs });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка сохранения статуса' });
    }
  }
);

app.delete(
  '/api/directories/showcase-statuses/:name',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const name = decodeURIComponent(req.params.name || '');
      if (!name) return res.status(400).json({ error: 'Имя не указано' });
      await query('DELETE FROM showcase_statuses WHERE name = $1', [name]);
      const dirs = await loadDirectoriesFromDb();
      res.json({ success: true, directories: dirs });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления статуса' });
    }
  }
);

// Warehouse Locations
app.post(
  '/api/directories/warehouse-locations',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const { name } = req.body || {};
      if (!name || typeof name !== 'string')
        return res.status(400).json({ error: 'Некорректное имя локации' });
      await query(
        'INSERT INTO warehouse_locations(name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
        [name.trim()]
      );
      const dirs = await loadDirectoriesFromDb();
      res.json({ success: true, directories: dirs });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка сохранения локации' });
    }
  }
);

app.delete(
  '/api/directories/warehouse-locations/:name',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const name = decodeURIComponent(req.params.name || '');
      if (!name) return res.status(400).json({ error: 'Имя не указано' });
      await query('DELETE FROM warehouse_locations WHERE name = $1', [name]);
      const dirs = await loadDirectoriesFromDb();
      res.json({ success: true, directories: dirs });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления локации' });
    }
  }
);

// Warehouse Types
app.post(
  '/api/directories/warehouse-types',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const { name } = req.body || {};
      if (!name || typeof name !== 'string')
        return res.status(400).json({ error: 'Некорректное имя типа склада' });
      await query('INSERT INTO warehouse_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
        name.trim(),
      ]);
      const dirs = await loadDirectoriesFromDb();
      res.json({ success: true, directories: dirs });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка сохранения типа склада' });
    }
  }
);

app.delete(
  '/api/directories/warehouse-types/:name',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const name = decodeURIComponent(req.params.name || '');
      if (!name) return res.status(400).json({ error: 'Имя не указано' });
      await query('DELETE FROM warehouse_types WHERE name = $1', [name]);
      const dirs = await loadDirectoriesFromDb();
      res.json({ success: true, directories: dirs });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления типа склада' });
    }
  }
);

// Product Names
app.post(
  '/api/directories/product-names',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const { name, type } = req.body || {};
      if (!name || typeof name !== 'string')
        return res.status(400).json({ error: 'Некорректное имя' });
      if (type)
        await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
          type,
        ]);
      await query(
        'INSERT INTO product_names(name, type) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type',
        [name.trim(), type || null]
      );
      const dirs = await loadDirectoriesFromDb();
      res.json({ success: true, directories: dirs });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка сохранения наименования' });
    }
  }
);

app.put(
  '/api/directories/product-names/:name',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const currentName = decodeURIComponent(req.params.name || '');
      const { name, type } = req.body || {};
      if (!currentName) return res.status(400).json({ error: 'Имя не указано' });
      if (type)
        await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
          type,
        ]);
      if (name && name !== currentName) {
        // rename via delete+insert to keep PK uniqueness
        await query('DELETE FROM product_names WHERE name = $1', [currentName]);
        await query(
          'INSERT INTO product_names(name, type) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type',
          [name.trim(), type || null]
        );
      } else {
        await query('UPDATE product_names SET type = $2 WHERE name = $1', [
          currentName,
          type || null,
        ]);
      }
      const dirs = await loadDirectoriesFromDb();
      res.json({ success: true, directories: dirs });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка обновления наименования' });
    }
  }
);

app.delete(
  '/api/directories/product-names/:name',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const name = decodeURIComponent(req.params.name || '');
      if (!name) return res.status(400).json({ error: 'Имя не указано' });
      await query('DELETE FROM product_names WHERE name = $1', [name]);
      const dirs = await loadDirectoriesFromDb();
      res.json({ success: true, directories: dirs });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления наименования' });
    }
  }
);

// ---------- Currencies management ----------
app.get(
  '/api/system/currencies',
  authenticateToken,
  requirePermission('directories', 'read'),
  async (req, res) => {
    try {
      const s = await readSettingsMap();
      const baseCurrency = s['system.baseCurrency'] ?? 'aUEC';
      const cres = await query('SELECT code FROM currencies ORDER BY code');
      const codes = cres.rows.map((r) => r.code);
      const rres = await query('SELECT code, rate FROM currency_rates WHERE base_code = $1', [
        baseCurrency,
      ]);
      const rates = Object.fromEntries(rres.rows.map((r) => [r.code, Number(r.rate)]));
      res.json({ currencies: codes, baseCurrency, rates });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка чтения валют' });
    }
  }
);

app.put(
  '/api/system/currencies',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const { currencies, baseCurrency, rates } = req.body || {};
      if (!Array.isArray(currencies) || !currencies.length)
        return res.status(400).json({ error: 'Список валют пуст' });
      if (!baseCurrency || typeof baseCurrency !== 'string')
        return res.status(400).json({ error: 'Базовая валюта не указана' });

      // Read existing currencies
      const existingRes = await query('SELECT code FROM currencies');
      const existing = new Set(existingRes.rows.map((r) => r.code));
      const desired = new Set(currencies);

      // Upsert currencies
      for (const code of currencies) {
        if (typeof code === 'string' && code.trim() !== '') {
          await query('INSERT INTO currencies(code) VALUES ($1) ON CONFLICT (code) DO NOTHING', [
            code.trim(),
          ]);
        }
      }

      // Delete currencies that are no longer present (except baseCurrency which must exist)
      for (const ex of existing) {
        if (!desired.has(ex)) {
          await query('DELETE FROM currency_rates WHERE code = $1 OR base_code = $1', [ex]);
          await query('DELETE FROM currencies WHERE code = $1', [ex]);
        }
      }

      // Update baseCurrency in settings
      await query(
        `INSERT INTO settings(key, value) VALUES ('system.baseCurrency', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify(baseCurrency)]
      );

      // Upsert rates for base (only for allowed codes present in currencies list)
      if (rates && typeof rates === 'object') {
        const allowed = new Set((currencies || []).map((c) => String(c).trim()));
        for (const [code, rateVal] of Object.entries(rates)) {
          const codeStr = String(code).trim();
          if (!allowed.has(codeStr)) continue; // skip unknown currency codes to avoid FK errors
          // Accept both number and string with comma as decimal separator
          const parsed = parseFloat(String(rateVal).replace(',', '.'));
          const val = Number.isFinite(parsed) ? parsed : 0;
          if (val > 0) {
            await query(
              `INSERT INTO currency_rates(base_code, code, rate) VALUES ($1,$2,$3)
             ON CONFLICT (base_code, code) DO UPDATE SET rate = EXCLUDED.rate`,
              [baseCurrency, codeStr, val]
            );
          }
        }
      }
      // Ensure base/base = 1
      await query(
        `INSERT INTO currency_rates(base_code, code, rate) VALUES ($1, $1, 1)
       ON CONFLICT (base_code, code) DO UPDATE SET rate = 1`,
        [baseCurrency]
      );

      // Return fresh snapshot
      const cres = await query('SELECT code FROM currencies ORDER BY code');
      const codes = cres.rows.map((r) => r.code);
      const rres = await query('SELECT code, rate FROM currency_rates WHERE base_code = $1', [
        baseCurrency,
      ]);
      const outRates = Object.fromEntries(rres.rows.map((r) => [r.code, Number(r.rate)]));
      res.json({ success: true, currencies: codes, baseCurrency, rates: outRates });
    } catch (e) {
      console.error('PUT /api/system/currencies error:', e);
      res.status(500).json({ error: 'Ошибка сохранения валют' });
    }
  }
);

// Получение темы пользователя
app.get('/api/user/theme', authenticateToken, async (req, res) => {
  try {
    const result = await query('SELECT theme_preference FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      console.warn('GET /api/user/theme: user not found', { userId: req.user?.id });
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json({ theme: result.rows[0].theme_preference || 'light' });
  } catch (error) {
    console.error('Ошибка при получении темы пользователя:', error);
    res.status(500).json({ error: 'Ошибка сервера при получении темы' });
  }
});

// Обновление темы пользователя
app.put('/api/user/theme', authenticateToken, async (req, res) => {
  const { theme } = req.body;
  if (theme !== 'light' && theme !== 'dark') {
    return res.status(400).json({ error: 'Недопустимое значение темы. Допустимые значения: light, dark' });
  }

  try {
    const resUpdate = await query('UPDATE users SET theme_preference = $1 WHERE id = $2', [theme, req.user.id]);
    if (resUpdate.rowCount === 0) {
      console.warn('PUT /api/user/theme: user not found for update', { userId: req.user?.id });
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    console.log('PUT /api/user/theme: updated', { userId: req.user?.id, theme });
    res.json({ success: true, theme });
  } catch (error) {
    console.error('Ошибка при обновлении темы пользователя:', error);
    res.status(500).json({ error: 'Ошибка сервера при обновлении темы' });
  }
});

app.use(
  cors({
    origin: function (origin, callback) {
      // Разрешаем только FRONTEND_URL в проде + localhost/127.0.0.1 на любом порту
      const allowed = SERVER_CONFIG.FRONTEND_URL;
      const isLocalhost = !!(
        origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\\d+)?$/i.test(origin)
      );
      if (!allowed || allowed === '*') {
        return callback(null, true);
      }
      // Разрешаем также запросы без Origin (например, curl/health)
      if (!origin) return callback(null, true);
      if (origin === allowed || isLocalhost) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// Обработка preflight запросов
app.options('*', cors());

// legacy filesystem storage removed

const readSettingsMap = async () => {
  const map = {};
  try {
    const res = await query('SELECT key, value FROM settings');
    for (const r of res.rows) {
      map[r.key] = r.value;
    }
  } catch (_) {}
  return map;
};

const buildAggregatedData = async (userId) => {
  // Settings fallback (version, baseCurrency)
  const s = await readSettingsMap();
  const version = s['system.version'] ?? '1.0.0';
  const baseCurrency = s['system.baseCurrency'] ?? 'aUEC';

  // Currencies and rates from tables (fallback to settings if empty)
  let currencies = [];
  try {
    const cres = await query('SELECT code FROM currencies');
    currencies = cres.rows.map((r) => r.code);
  } catch (_) {}
  if (!Array.isArray(currencies) || currencies.length === 0) {
    currencies = s['system.currencies'] ?? ['aUEC', 'КП'];
  }
  let rates = {};
  try {
    const rres = await query('SELECT code, rate FROM currency_rates WHERE base_code = $1', [
      baseCurrency,
    ]);
    if (rres.rowCount > 0) {
      rates = Object.fromEntries(rres.rows.map((r) => [r.code, Number(r.rate)]));
    }
  } catch (_) {}
  if (Object.keys(rates).length === 0) {
    rates = s['system.rates'] ?? { aUEC: 1, КП: 0.9 };
  }
  const system = { version, currencies, baseCurrency, rates };

  // Directories from tables (fallback to settings)
  const productTypes = await (async () => {
    try {
      const r = await query('SELECT name FROM product_types');
      return r.rows.map((x) => x.name);
    } catch {
      return [];
    }
  })();
  const showcaseStatuses = await (async () => {
    try {
      const r = await query('SELECT name FROM showcase_statuses');
      return r.rows.map((x) => x.name);
    } catch {
      return [];
    }
  })();
  const warehouseLocations = await (async () => {
    try {
      const r = await query('SELECT name FROM warehouse_locations');
      return r.rows.map((x) => x.name);
    } catch {
      return [];
    }
  })();
  const warehouseTypes = await (async () => {
    try {
      const r = await query('SELECT name FROM warehouse_types');
      return r.rows.map((x) => x.name);
    } catch {
      return [];
    }
  })();
  const productNames = await (async () => {
    try {
      const r = await query('SELECT name, type FROM product_names');
      return r.rows.map((x) => ({ name: x.name, type: x.type || null }));
    } catch {
      return [];
    }
  })();
  const directories = {
    productTypes: productTypes.length
      ? productTypes
      : (s['directories.productTypes'] ?? ['Услуга', 'Товар']),
    showcaseStatuses: showcaseStatuses.length
      ? showcaseStatuses
      : (s['directories.showcaseStatuses'] ?? ['На витрине', 'Скрыт']),
    warehouseLocations: warehouseLocations.length
      ? warehouseLocations
      : (s['directories.warehouseLocations'] ?? ['Основной склад', 'Резервный склад']),
    warehouseTypes: warehouseTypes.length ? warehouseTypes : (s['directories.warehouseTypes'] ?? []),
    productNames,
    // accountTypes assembled from tables
    accountTypes: [],
  };
  try {
    const at = await query('SELECT name FROM account_types');
    for (const row of at.rows) {
      const perms = await query(
        'SELECT resource, level FROM account_type_permissions WHERE account_type = $1',
        [row.name]
      );
      const permObj = Object.fromEntries(perms.rows.map((p) => [p.resource, p.level]));
      let allowedWarehouseTypes = [];
      try {
        const wtypes = await query(
          'SELECT warehouse_type FROM account_type_warehouse_types WHERE account_type = $1 ORDER BY warehouse_type',
          [row.name]
        );
        allowedWarehouseTypes = wtypes.rows.map((r) => r.warehouse_type);
      } catch (_) {}
      directories.accountTypes.push({ name: row.name, permissions: permObj, allowedWarehouseTypes });
    }
  } catch (_) {}

  // Users from DB with derived permissions
  const users = [];
  try {
    const ures = await query(
      'SELECT id, username, email, nickname, auth_type, account_type, is_active, discord_id, discord_data, created_at, last_login FROM users'
    );
    for (const u of ures.rows) {
      const perms = await getPermissionsForTypeDb(u.account_type);
      let avatarUrl;
      if (u.auth_type === 'discord') {
        try {
          const d = typeof u.discord_data === 'object' ? u.discord_data : JSON.parse(u.discord_data || 'null');
          if (d && d.id && d.avatar) avatarUrl = `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png`;
        } catch (_) {}
      }
      users.push({
        id: u.id,
        username: u.username,
        nickname: u.nickname || null,
        email: u.email,
        authType: u.auth_type,
        accountType: u.account_type,
        permissions: perms,
        isActive: u.is_active !== false,
        discordId: u.discord_id || undefined,
        discordData: u.discord_data || undefined,
        avatarUrl,
        createdAt: u.created_at ? new Date(u.created_at).toISOString() : undefined,
        lastLogin: u.last_login ? new Date(u.last_login).toISOString() : undefined,
      });
    }
  } catch (_) {}

  // Warehouse (filtered по allowedWarehouseTypes текущего пользователя)
  const warehouse = [];
  let allowedTypes = null;
  try {
    if (userId) {
      const ures = await query('SELECT account_type FROM users WHERE id = $1', [userId]);
      const accType = ures.rows[0]?.account_type || null;
      if (accType) {
        const wres = await query('SELECT warehouse_type FROM account_type_warehouse_types WHERE account_type = $1', [accType]);
        allowedTypes = wres.rows.map((r) => r.warehouse_type).filter(Boolean);
      }
    }
  } catch (_) {}
  const showcaseItemsMap = new Map();
  try {
    const sc = await query('SELECT id, warehouse_item_id FROM showcase_items');
    for (const srow of sc.rows) {
      if (srow.warehouse_item_id) showcaseItemsMap.set(srow.warehouse_item_id, true);
    }
  } catch (_) {}
  try {
    let w;
    if (Array.isArray(allowedTypes) && allowedTypes.length > 0) {
      w = await query(
        'SELECT id, name, type, quantity, cost, currency, location, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items WHERE warehouse_type = ANY($1)',
        [allowedTypes]
      );
    } else {
      // Пустой или отсутствующий список — не возвращаем позиции склада
      w = { rows: [] };
    }
    for (const it of w.rows) {
      // Ensure meta is an object
      let metaObj = undefined;
      try {
        if (it.meta && typeof it.meta === 'string') metaObj = JSON.parse(it.meta);
        else if (it.meta && typeof it.meta === 'object') metaObj = it.meta;
      } catch (_) {}

      warehouse.push({
        id: it.id,
        name: it.name,
        type: it.type || null,
        productType: it.type || null,
        quantity: Number(it.quantity) || 0,
        cost: it.cost !== null && it.cost !== undefined ? Number(it.cost) : undefined,
        price: it.cost !== null && it.cost !== undefined ? Number(it.cost) : undefined,
        currency: it.currency || null,
        location: it.location || null,
        displayCurrencies: it.display_currencies || undefined,
        description: metaObj && metaObj.desc ? metaObj.desc : undefined,
        meta: metaObj || undefined,
        warehouseType: it.warehouse_type || null,
        ownerLogin: it.owner_login || null,
        showcaseStatus: showcaseItemsMap.has(it.id) ? 'На витрине' : 'Скрыт',
        createdAt: it.created_at ? new Date(it.created_at).toISOString() : undefined,
        updatedAt: it.updated_at ? new Date(it.updated_at).toISOString() : undefined,
      });
    }
  } catch (_) {}

  // Showcase
  const showcase = [];
  try {
    const sc = await query(
      'SELECT id, warehouse_item_id, status, price, currency, meta, created_at, updated_at FROM showcase_items'
    );
    for (const srow of sc.rows) {
      showcase.push({
        id: srow.id,
        warehouseItemId: srow.warehouse_item_id || null,
        status: srow.status || null,
        price: srow.price !== null && srow.price !== undefined ? Number(srow.price) : undefined,
        currency: srow.currency || null,
        meta: srow.meta || undefined,
        createdAt: srow.created_at ? new Date(srow.created_at).toISOString() : undefined,
        updatedAt: srow.updated_at ? new Date(srow.updated_at).toISOString() : undefined,
      });
    }
  } catch (_) {}

  // Transactions
  const transactions = [];
  try {
    const tres = await query(
      'SELECT id, type, amount, currency, from_user, to_user, item_id, meta, created_at FROM transactions'
    );
    for (const t of tres.rows) {
      const createdIso = t.created_at ? new Date(t.created_at).toISOString() : undefined;
      const desc = t.meta && t.meta.desc ? t.meta.desc : undefined;
      transactions.push({
        id: t.id,
        type: t.type,
        amount: Number(t.amount) || 0,
        currency: t.currency,
        from_user: t.from_user || null,
        to_user: t.to_user || null,
        item_id: t.item_id || null,
        meta: t.meta || undefined,
        createdAt: createdIso,
        date: createdIso,
        desc,
      });
    }
  } catch (_) {}

  // nextId kept for backward compatibility (not used with normalized tables)
  return { system, warehouse, users, transactions, showcase, directories, nextId: 1 };
};

// ---------- Helpers for normalized DB ----------
const getPermissionsForTypeDb = async (typeName) => {
  try {
    const res = await query(
      'SELECT resource, level FROM account_type_permissions WHERE account_type = $1',
      [typeName]
    );
    if (res.rows.length > 0) {
      return Object.fromEntries(res.rows.map((r) => [r.resource, r.level]));
    }
  } catch (_) {}
  // Fallback default minimal permissions
  return {
    finance: 'read',
    warehouse: 'read',
    showcase: 'read',
    users: 'none',
    directories: 'none',
    settings: 'none',
  };
}
;

const readDiscordEffective = async () => {
  try {
    const ds = await query(
      'SELECT enable, client_id, client_secret, redirect_uri, default_account_type, base_url FROM discord_settings WHERE id = 1'
    );
    const row = ds.rows[0] || {};
    // Read attribute mappings, supporting both schemas:
    // (A) New: columns (source, key, value, account_type, guild_id, set)
    // (B) Legacy: single JSONB column rule
    let attrRows = [];
    try {
      const a = await query(
        'SELECT source, key, value, account_type, guild_id, set FROM discord_attr_mappings'
      );
      attrRows = a.rows || [];
    } catch (e) {
      try {
        const a = await query('SELECT rule FROM discord_attr_mappings');
        attrRows = (a.rows || []).map((r) => {
          const rule = typeof r.rule === 'object' ? r.rule : safeJsonParse(r.rule);
          return {
            source: rule?.source,
            key: rule?.key,
            value: rule?.value,
            account_type: rule?.accountType || rule?.account_type,
            guild_id: rule?.guildId || rule?.guild_id,
            set: rule?.set || null,
          };
        });
      } catch (_) {
        attrRows = [];
      }
    }
    return {
      enable: !!row.enable,
      clientId: row.client_id || DISCORD_CONFIG.CLIENT_ID || '',
      clientSecret: row.client_secret || DISCORD_CONFIG.CLIENT_SECRET || '',
      redirectUri: row.redirect_uri || DISCORD_CONFIG.REDIRECT_URI || '',
      defaultAccountType: row.default_account_type || 'Гость',
      baseUrl: row.base_url || '',
      attributeMappings: attrRows || [],
      guildMappings: [],
    };
  } catch (_) {
    return {
      enable: false,
      clientId: DISCORD_CONFIG.CLIENT_ID || '',
      clientSecret: DISCORD_CONFIG.CLIENT_SECRET || '',
      redirectUri: DISCORD_CONFIG.REDIRECT_URI || '',
      defaultAccountType: 'Гость',
      baseUrl: '',
      attributeMappings: [],
      guildMappings: [],
    };
  }
};

// Discord OAuth routes
app.get('/auth/discord', async (req, res) => {
  try {
    // Load dynamic settings from data file if available
    const eff = await readDiscordEffective();
    // If explicit base URL stored in DB — use it directly
    if (eff.baseUrl && typeof eff.baseUrl === 'string' && eff.baseUrl.startsWith('http')) {
      return res.redirect(eff.baseUrl);
    }
    let clientId = eff.clientId || DISCORD_CONFIG.CLIENT_ID;
    let redirectUri = eff.redirectUri || DISCORD_CONFIG.REDIRECT_URI;
    // Determine scopes strictly from scope-mappings only

    // Валидация: если нет clientId или redirectUri — сообщим об ошибке
    if (!clientId || !redirectUri) {
      return res.status(400).json({
        error:
          'Discord OAuth не настроен: заполните Client ID и Redirect URI в системных параметрах',
      });
    }

    // Build scopes: only those present in scope-mappings; if none — standard 'identify' only
    const scopes = ['identify'];
    try {
      const sm = await query('SELECT DISTINCT scope FROM discord_scope_mappings');
      const mapped = sm.rows.map((r) => String(r.scope || '').trim()).filter(Boolean);
      if (mapped.length > 0) {
        for (const s of mapped) {
          if (s && !scopes.includes(s)) scopes.push(s);
        }
      }
    } catch (_) {}
    const scope = encodeURIComponent(scopes.join(' '));
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}`;
    res.redirect(discordAuthUrl);
  } catch (e) {
    console.error('Error building Discord auth URL', e);
    res.status(500).send('Discord auth not configured');
  }
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.redirect(`${SERVER_CONFIG.FRONTEND_URL}/?auth=error&message=No code provided`);
    }

    // Exchange code for token
    // Load dynamic settings (fallback to env)
    const eff = await readDiscordEffective();
    const clientId = eff.clientId || DISCORD_CONFIG.CLIENT_ID;
    const clientSecret = eff.clientSecret || DISCORD_CONFIG.CLIENT_SECRET;
    const redirectUri = eff.redirectUri || DISCORD_CONFIG.REDIRECT_URI;

    const tokenResponse = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept-Encoding': 'application/json',
        },
      }
    );

    // Get user info from Discord
    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenResponse.data.access_token}`,
        'Accept-Encoding': 'application/json',
      },
    });

    const discordUser = userResponse.data;

    // TEMP LOGGING (for debugging): granted scopes and email
    try {
      console.log('Discord OAuth callback — granted scopes:', tokenResponse?.data?.scope);
      console.log('Discord OAuth callback — user email:', discordUser?.email);
    } catch (_) {}

    // Read discord settings and account types from DB
    const discordSettings = eff;

    // Decide account type by default, then attribute mappings, then guild mappings
    let resolvedAccountType = discordSettings.defaultAccountType || 'Гость';
    // Optionally collect additional field overrides from matched rule
    let matchedSetPayload = null;

    // Parse granted scopes from token (space-delimited)
    const grantedScopes = new Set(
      typeof tokenResponse?.data?.scope === 'string'
        ? tokenResponse.data.scope.split(/\s+/).filter(Boolean)
        : []
    );

    // Fetch minimal additional data based on mapped scopes only
    try {
      // Read mapped scopes to restrict data fetching
      let mappedScopes = new Set();
      try {
        const sm2 = await query('SELECT DISTINCT scope FROM discord_scope_mappings');
        mappedScopes = new Set(sm2.rows.map((r) => String(r.scope || '').trim()).filter(Boolean));
      } catch (_) {}

      // Save scopes for auditing/debugging
      try {
        discordUser._scopes = Array.from(grantedScopes);
        discordUser._scopes_mapped = Array.from(grantedScopes).filter((s) => mappedScopes.has(s));
      } catch (_) {}

      // Fetch extra data for mapped+granted scopes
      // 1) Guilds list
      if (grantedScopes.has('guilds') && mappedScopes.has('guilds')) {
        const guildsResp = await axios.get('https://discord.com/api/users/@me/guilds', {
          headers: {
            Authorization: `Bearer ${tokenResponse.data.access_token}`,
            'Accept-Encoding': 'application/json',
          },
        });
        if (Array.isArray(guildsResp?.data)) {
          discordUser.guilds = guildsResp.data;
        }
      }

      // 2) Connections
      if (grantedScopes.has('connections') && mappedScopes.has('connections')) {
        const connResp = await axios.get('https://discord.com/api/users/@me/connections', {
          headers: {
            Authorization: `Bearer ${tokenResponse.data.access_token}`,
            'Accept-Encoding': 'application/json',
          },
        });
        if (Array.isArray(connResp?.data)) {
          discordUser.connections = connResp.data;
        }
      }
    } catch (_) {
      // ignore optional data retrieval failures
    }

    // 1) Attribute-based mappings
    const attrMappings = Array.isArray(discordSettings.attributeMappings)
      ? discordSettings.attributeMappings
      : [];
    for (const rule of attrMappings) {
      if (!rule || !rule.source || !rule.key || !rule.accountType) continue;
      try {
        if (rule.source === 'user') {
          const val = discordUser?.[rule.key];
          if (Array.isArray(val) && val.includes(rule.value)) {
            resolvedAccountType = rule.accountType;
            matchedSetPayload = rule.set && typeof rule.set === 'object' ? rule.set : null;
            break;
          }
          if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
            if (String(val) === String(rule.value)) {
              resolvedAccountType = rule.accountType;
              matchedSetPayload = rule.set && typeof rule.set === 'object' ? rule.set : null;
              break;
            }
          }
        } else if (rule.source === 'member' && rule.guildId) {
          const memberResp = await axios.get(
            `https://discord.com/api/users/@me/guilds/${rule.guildId}/member`,
            {
              headers: {
                Authorization: `Bearer ${tokenResponse.data.access_token}`,
                'Accept-Encoding': 'application/json',
              },
            }
          );
          if (memberResp && memberResp.status === 200) {
            const member = memberResp.data;
            const v = member?.[rule.key];
            if (Array.isArray(v) && v.includes(rule.value)) {
              resolvedAccountType = rule.accountType;
              matchedSetPayload = rule.set && typeof rule.set === 'object' ? rule.set : null;
              break;
            }
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
              if (String(v) === String(rule.value)) {
                resolvedAccountType = rule.accountType;
                matchedSetPayload = rule.set && typeof rule.set === 'object' ? rule.set : null;
                break;
              }
            }
          }
        }
      } catch (_) {
        // ignore failed attribute checks
      }
    }

    // Auto-register granted scopes into dictionary
    try {
      for (const s of grantedScopes) {
        await query('INSERT INTO discord_scopes(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [s]);
      }
    } catch (_) {}

    // 2) Scope-based mappings (presence and optional value checks)
    try {
      // Приоритет: сначала по явному порядку (position), потом значения (value), затем стабильная сортировка по scope
      const sm = await query(
        'SELECT scope, value, account_type FROM discord_scope_mappings ORDER BY (position IS NULL), position, (value IS NULL), scope'
      );
      for (const r of sm.rows) {
        if (!r || !r.scope) continue;
        const scopeName = String(r.scope);
        if (!grantedScopes.has(scopeName)) continue;
        let matched = false;
        if (r.value == null) {
          // presence-only mapping
          matched = true;
        } else {
          // value-aware mappings for known scopes
          if (scopeName === 'email') {
            const userEmail = discordUser?.email ? String(discordUser.email).trim().toLowerCase() : null;
            const expected = r?.value != null ? String(r.value).trim().toLowerCase() : null;
            if (userEmail && expected && userEmail === expected) matched = true;
          }
          if (scopeName === 'guilds') {
            try {
              const guildIdExpected = String(r.value).trim();
              const list = Array.isArray(discordUser?.guilds) ? discordUser.guilds : [];
              if (guildIdExpected && list.some((g) => String(g?.id) === guildIdExpected)) {
                matched = true;
              }
            } catch (_) {}
          }
          if (scopeName === 'connections') {
            try {
              const expectedType = String(r.value).trim().toLowerCase();
              const list = Array.isArray(discordUser?.connections) ? discordUser.connections : [];
              if (
                expectedType &&
                list.some((c) => String(c?.type || '').trim().toLowerCase() === expectedType)
              ) {
                matched = true;
              }
            } catch (_) {}
          }
          // можно расширить при необходимости для других скопов
        }
        if (matched) {
          resolvedAccountType = r.account_type;
          break;
        }
      }
    } catch (_) {}

    // (Removed) Guild membership mappings

    // Find or create user in DB
    let userRow = (await query('SELECT * FROM users WHERE discord_id = $1', [discordUser.id]))
      .rows[0];
    const isNewUser = !userRow;

    // Determine final account type and active flag with mapping overrides
    let targetAccountType = resolvedAccountType;
    let targetIsActive = true;
    if (matchedSetPayload && typeof matchedSetPayload === 'object') {
      if (
        typeof matchedSetPayload.accountType === 'string' &&
        matchedSetPayload.accountType.trim() !== ''
      ) {
        targetAccountType = matchedSetPayload.accountType.trim();
      }
      if (Object.prototype.hasOwnProperty.call(matchedSetPayload, 'isActive')) {
        targetIsActive = !!matchedSetPayload.isActive;
      }
      // permissions из set не храним на пользователе, права подтянутся по типу
    }

    // Helper to ensure unique username across DB
    const ensureUniqueUsernameDb = async (baseName) => {
      let name = baseName || 'discord_user';
      const exists = async (candidate) =>
        (await query('SELECT 1 FROM users WHERE username = $1 LIMIT 1', [candidate])).rowCount > 0;
      if (!(await exists(name))) return name;
      if (discordUser && discordUser.discriminator && discordUser.discriminator !== '0') {
        const withDisc = `${discordUser.username}#${discordUser.discriminator}`;
        if (!(await exists(withDisc))) return withDisc;
      }
      const tail =
        String(discordUser?.id || '')?.slice(-4) ||
        String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      let candidate = `${baseName}_${tail}`;
      if (!(await exists(candidate))) return candidate;
      let i = 2;
      while (await exists(`${candidate}_${i}`)) i++;
      return `${candidate}_${i}`;
    };

    if (!userRow) {
      const uniqueUsername = await ensureUniqueUsernameDb(discordUser.username);
      await query(
        `INSERT INTO users (id, username, email, auth_type, account_type, is_active, password_hash, discord_id, discord_data, created_at, last_login)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          `discord_${discordUser.id}`,
          uniqueUsername,
          discordUser.email || null,
          'discord',
          targetAccountType,
          targetIsActive,
          null,
          discordUser.id,
          JSON.stringify(discordUser),
          new Date(),
          new Date(),
        ]
      );
      userRow = (await query('SELECT * FROM users WHERE discord_id = $1', [discordUser.id]))
        .rows[0];
    } else {
      await query(
        `UPDATE users SET last_login = $1, discord_data = $2, account_type = $3, is_active = $4 WHERE id = $5`,
        [new Date(), JSON.stringify(discordUser), targetAccountType, targetIsActive, userRow.id]
      );
      userRow = (await query('SELECT * FROM users WHERE id = $1', [userRow.id])).rows[0];
    }

    // Generate JWT token
    const token = generateToken(userRow.id);

    res.redirect(`${SERVER_CONFIG.FRONTEND_URL}/?token=${token}&auth=success&newUser=${isNewUser}`);
  } catch (error) {
    console.error('Discord OAuth error:', error.response?.data || error.message);
    res.redirect(`${SERVER_CONFIG.FRONTEND_URL}/?auth=error&message=Authentication failed`);
  }
});

// Local authentication
app.post('/auth/login', async (req, res) => {
  try {
    console.log('Login request body:', req.body);

    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Необходимо указать имя пользователя и пароль',
      });
    }
    // Хэшируем введенный пароль для сравнения
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    console.log('Input password hash:', passwordHash);

    const ures = await query(
      `SELECT * FROM users WHERE username = $1 AND auth_type = 'local' AND is_active = true AND password_hash = $2`,
      [username, passwordHash]
    );
    const user = ures.rows[0];

    if (!user) {
      console.log('User not found or invalid credentials');
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    await query('UPDATE users SET last_login = $1 WHERE id = $2', [new Date(), user.id]);
    const token = generateToken(user.id);
    const perms = await getPermissionsForTypeDb(user.account_type);
    res.json({
      authToken: token,
      username: user.username,
      accountType: user.account_type,
      permissions: perms,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Data endpoints
app.get('/api/data', authenticateToken, async (req, res) => {
  try {
    const aggregated = await buildAggregatedData(req.user.id);
    res.json(aggregated);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка чтения данных' });
  }
});

app.post(
  '/api/data',
  authenticateToken,
  requirePermission('settings', 'write'),
  async (req, res) => {
    // Общая запись больше не поддерживается
    return res
      .status(405)
      .json({ error: 'Метод устарел. Используйте специализированные эндпоинты.' });
  }
);

// Users management
app.get('/api/users', authenticateToken, requirePermission('users', 'read'), async (req, res) => {
  try {
    const ures = await query(
      'SELECT id, username, email, nickname, auth_type, account_type, is_active, discord_id, discord_data, created_at, last_login FROM users'
    );
    const result = [];
    for (const u of ures.rows) {
      const perms = await getPermissionsForTypeDb(u.account_type);
      let avatarUrl;
      if (u.auth_type === 'discord') {
        try {
          const d = typeof u.discord_data === 'object' ? u.discord_data : JSON.parse(u.discord_data || 'null');
          if (d && d.id && d.avatar) {
            avatarUrl = `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png`;
          }
        } catch (_) {}
      }
      result.push({
        id: u.id,
        username: u.username,
        nickname: u.nickname || null,
        email: u.email,
        authType: u.auth_type,
        accountType: u.account_type,
        permissions: perms,
        isActive: u.is_active !== false,
        discordId: u.discord_id || undefined,
        avatarUrl,
        createdAt: u.created_at ? new Date(u.created_at).toISOString() : undefined,
        lastLogin: u.last_login ? new Date(u.last_login).toISOString() : undefined,
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Ошибка чтения пользователей' });
  }
});

app.put(
  '/api/users/:id',
  authenticateToken,
  requirePermission('users', 'write'),
  async (req, res) => {
    try {
      const id = req.params.id;
      const { username, email, accountType, isActive, nickname } = req.body || {};
      const ures = await query('SELECT * FROM users WHERE id = $1', [id]);
      if (ures.rowCount === 0) return res.status(404).json({ error: 'Пользователь не найден' });
      const dbUser = ures.rows[0];

      // Build dynamic update
      const fields = [];
      const values = [];
      let i = 1;
      if (typeof username === 'string' && username.trim() !== '') {
        if (dbUser.auth_type === 'discord') {
          // Forbid renaming discord-linked accounts
        } else {
          fields.push(`username = $${i++}`);
          values.push(username.trim());
        }
      }
      if (typeof email === 'string') {
        fields.push(`email = $${i++}`);
        values.push(email || null);
      }
      if (typeof nickname === 'string') {
        fields.push(`nickname = $${i++}`);
        values.push(nickname || null);
      }
      if (typeof accountType === 'string' && accountType.trim() !== '') {
        fields.push(`account_type = $${i++}`);
        values.push(accountType.trim());
      }
      if (typeof isActive === 'boolean') {
        fields.push(`is_active = $${i++}`);
        values.push(isActive);
      }
      if (fields.length === 0) return res.json({ success: true });
      values.push(id);
      await query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`, values);

      const updated = (
        await query(
          'SELECT id, username, email, auth_type, account_type, is_active FROM users WHERE id = $1',
          [id]
        )
      ).rows[0];
      const perms = await getPermissionsForTypeDb(updated.account_type);
      res.json({
        success: true,
        user: {
          id: updated.id,
          username: updated.username,
          email: updated.email,
          authType: updated.auth_type,
          accountType: updated.account_type,
          isActive: updated.is_active !== false,
          permissions: perms,
        },
      });
    } catch (error) {
      console.error('PUT /api/users/:id error:', error);
      res.status(500).json({ error: 'Ошибка обновления пользователя' });
    }
  }
);

// Change password
app.post('/api/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'Укажите текущий и новый пароль' });
    const ures = await query('SELECT id, password_hash, auth_type FROM users WHERE id = $1', [
      req.user.id,
    ]);
    if (ures.rowCount === 0) return res.status(404).json({ error: 'Пользователь не найден' });
    const user = ures.rows[0];
    if (user.auth_type !== 'local')
      return res.status(400).json({ error: 'Пароль можно менять только для локальных аккаунтов' });
    const currentHash = crypto.createHash('sha256').update(currentPassword).digest('hex');
    if (user.password_hash !== currentHash)
      return res.status(401).json({ error: 'Текущий пароль неверный' });
    const newHash = crypto.createHash('sha256').update(newPassword).digest('hex');
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
    res.json({ success: true, message: 'Пароль успешно изменен' });
  } catch (error) {
    console.error('POST /api/change-password error:', error);
    res.status(500).json({ error: 'Ошибка смены пароля' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Public: only whether Discord auth is enabled (no secrets)
app.get('/public/discord-enabled', async (req, res) => {
  try {
    let enable = false;
    try {
      const r = await query('SELECT enable FROM discord_settings WHERE id = 1');
      if (r.rows[0] && typeof r.rows[0].enable === 'boolean') enable = r.rows[0].enable;
    } catch (_) {}
    if (enable === false) {
      enable = !!(DISCORD_CONFIG.CLIENT_ID && DISCORD_CONFIG.REDIRECT_URI);
    }
    res.json({ enable });
  } catch (e) {
    // В случае ошибки — не раскрываем ничего, просто false
    res.json({ enable: false });
  }
});

// System: Discord settings (effective)
app.get(
  '/api/system/discord',
  authenticateToken,
  requirePermission('settings', 'read'),
  async (req, res) => {
    try {
      const eff = await readDiscordEffective();
      const effective = {
        enable: !!eff.enable,
        clientId: eff.clientId || '',
        clientSecret: eff.clientSecret || '',
        redirectUri: eff.redirectUri || '',
        // Return exactly what stored; do NOT compute fallback here
        baseUrl: eff.baseUrl || '',
      };
      res.json(effective);
    } catch (e) {
      res.status(500).json({ error: 'Ошибка чтения настроек Discord' });
    }
  }
);

// Update Discord settings and rewrite backend .env
app.put(
  '/api/system/discord',
  authenticateToken,
  requirePermission('settings', 'write'),
  async (req, res) => {
    try {
      const { enable, clientId, clientSecret, redirectUri, baseUrl: baseUrlIn } = req.body || {};
      const eff = await readDiscordEffective();
      const final = {
        enable: !!enable,
        clientId:
          typeof clientId === 'string' && clientId.trim() !== '' ? clientId : eff.clientId || '',
        clientSecret:
          typeof clientSecret === 'string' && clientSecret.trim() !== ''
            ? clientSecret
            : eff.clientSecret || '',
        redirectUri:
          typeof redirectUri === 'string' && redirectUri.trim() !== ''
            ? redirectUri
            : eff.redirectUri || '',
        defaultAccountType: eff.defaultAccountType || 'Гость',
      };
      // Base URL policy: only store explicitly provided non-empty string; else keep existing
      const baseUrl = (typeof baseUrlIn === 'string' && baseUrlIn.trim() !== '')
        ? baseUrlIn.trim()
        : (eff.baseUrl || '');
      // Ensure DB columns exist (light auto-migration)
      try {
        await query('ALTER TABLE discord_settings ADD COLUMN IF NOT EXISTS base_url text');
      } catch {}
      try {
        await query('ALTER TABLE discord_settings ADD COLUMN IF NOT EXISTS default_account_type text');
      } catch {}
      await query(
        `INSERT INTO discord_settings(id, enable, client_id, client_secret, redirect_uri, default_account_type, base_url)
       VALUES (1,$1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET enable = EXCLUDED.enable, client_id = EXCLUDED.client_id, client_secret = EXCLUDED.client_secret,
         redirect_uri = EXCLUDED.redirect_uri, default_account_type = EXCLUDED.default_account_type, base_url = EXCLUDED.base_url`,
        [final.enable, final.clientId, final.clientSecret, final.redirectUri, final.defaultAccountType, baseUrl]
      );

      // Rewrite backend .env with new values (preserve when incoming are empty)
      const envPath = path.resolve(__dirname, './.env');
      let envContent = '';
      try {
        envContent = await fs.readFile(envPath, 'utf8');
      } catch {}

      const getEnv = (content, key) => {
        const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
        return m ? m[1] : '';
      };
      const setEnv = (content, key, value) => {
        const line = `${key}=${value}\n`;
        const regex = new RegExp(`^${key}=.*$`, 'm');
        return content.match(regex)
          ? content.replace(regex, `${key}=${value}`)
          : content.endsWith('\n')
            ? content + line
            : content + '\n' + line;
      };

      const prevId = getEnv(envContent, 'DISCORD_CLIENT_ID');
      const prevSecret = getEnv(envContent, 'DISCORD_CLIENT_SECRET');
      const prevUri = getEnv(envContent, 'DISCORD_REDIRECT_URI');

      const finalId = final.clientId || prevId || '';
      const finalSecret = final.clientSecret || prevSecret || '';
      const finalUri = final.redirectUri || prevUri || '';

      envContent = setEnv(envContent, 'DISCORD_CLIENT_ID', finalId);
      envContent = setEnv(envContent, 'DISCORD_CLIENT_SECRET', finalSecret);
      envContent = setEnv(envContent, 'DISCORD_REDIRECT_URI', finalUri);
      await fs.writeFile(envPath, envContent, 'utf8');

      res.json({
        success: true,
        discord: {
          enable: final.enable,
          clientId: finalId,
          clientSecret: finalSecret,
          redirectUri: finalUri,
          baseUrl,
        },
      });
    } catch (e) {
      console.error('Update Discord settings failed:', e.message);
      res.status(500).json({ error: 'Ошибка сохранения настроек Discord' });
    }
  }
);

// Return current user profile by token
app.get('/auth/profile', authenticateToken, async (req, res) => {
  try {
    const ures = await query(
      'SELECT id, username, nickname, account_type, is_active, auth_type, discord_data FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = ures.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    const perms = await getPermissionsForTypeDb(user.account_type);
    let avatarUrl;
    if (user.auth_type === 'discord') {
      try {
        const d = typeof user.discord_data === 'object' ? user.discord_data : JSON.parse(user.discord_data || 'null');
        if (d && d.id && d.avatar) avatarUrl = `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png`;
      } catch (_) {}
    }
    res.json({
      id: user.id,
      username: user.username,
      nickname: user.nickname || null,
      accountType: user.account_type,
      permissions: perms,
      authType: user.auth_type,
      isActive: user.is_active !== false,
      avatarUrl,
    });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка получения профиля' });
  }
});

// Serve frontend build in production (if exists)
try {
  const distPath = path.resolve(__dirname, '../frontend/dist');
  app.use(express.static(distPath));
  // Also serve under subpath when app is published behind a prefix (e.g., /economy)
  app.use('/economy', express.static(distPath));
  // SPA fallback
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/auth') ||
      req.path.startsWith('/health')
    ) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
  // SPA fallback for prefixed path
  app.get('/economy/*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} catch (e) {
  // ignore if dist not found
}

// Lightweight DB sanity checks with warnings (no hard fail)
const checkDbAndWarn = async () => {
  const warns = [];
  const tryCount = async (sql) => {
    try {
      const r = await query(sql);
      return r.rowCount ?? 0;
    } catch {
      return -1;
    }
  };
  const tryFirst = async (sql, params = []) => {
    try {
      const r = await query(sql, params);
      return r.rows[0];
    } catch {
      return undefined;
    }
  };
  // Core tables presence (best-effort counts)
  const tables = [
    'users',
    'account_types',
    'account_type_permissions',
    'product_types',
    'showcase_statuses',
    'warehouse_locations',
    'currencies',
    'currency_rates',
    'warehouse_items',
    'showcase_items',
    'transactions',
    'settings',
    'discord_settings',
    'discord_scopes',
    'discord_scope_mappings',
    'user_layouts',
  ];
  for (const t of tables) {
    const c = await tryCount(`SELECT 1 FROM ${t} LIMIT 1`);
    if (c === -1) warns.push(`Таблица отсутствует или недоступна: ${t}`);
  }
  // Users/admin
  const usersCnt = await tryFirst('SELECT COUNT(1) AS c FROM users');
  if (!usersCnt || Number(usersCnt.c) === 0)
    warns.push('В БД нет пользователей. Будет недоступен вход (local).');
  // Account types
  const atCnt = await tryFirst('SELECT COUNT(1) AS c FROM account_types');
  if (!atCnt || Number(atCnt.c) === 0)
    warns.push('Справочник типов учетных записей пуст. Права будут дефолтными (минимальными).');
  // Currencies
  const s = await (async () => {
    const m = {};
    try {
      const rs = await query('SELECT key, value FROM settings');
      for (const r of rs.rows) m[r.key] = r.value;
    } catch {}
    return m;
  })();
  const baseCurrency = s['system.baseCurrency'] ?? 'aUEC';
  const codes = await (async () => {
    try {
      const rs = await query('SELECT code FROM currencies');
      return rs.rows.map((r) => r.code);
    } catch {
      return [];
    }
  })();
  if (!codes || codes.length === 0)
    warns.push('Таблица валют пуста: используйте Settings -> Валюты чтобы инициализировать.');
  const rateCnt = await tryFirst('SELECT COUNT(1) AS c FROM currency_rates WHERE base_code = $1', [
    baseCurrency,
  ]);
  if (!rateCnt || Number(rateCnt.c) === 0)
    warns.push(`Не заданы курсы валют для базовой валюты (${baseCurrency}).`);
  // Output
  if (warns.length) {
    console.warn('⚠️ Предупреждения инициализации:');
    for (const w of warns) console.warn(' -', w);
  } else {
    console.log('✅ Проверка БД: ок');
  }
};

// Initialize and start server
const startServer = async () => {
  // Auto-create Discord scopes tables
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS user_layouts (
        user_id text NOT NULL,
        page text NOT NULL,
        layouts jsonb NOT NULL,
        updated_at timestamp without time zone DEFAULT now(),
        PRIMARY KEY(user_id, page)
      )`
    );
    await query(
      `CREATE TABLE IF NOT EXISTS discord_scopes (
        name text PRIMARY KEY
      )`
    );
    await query(
      `CREATE TABLE IF NOT EXISTS discord_scope_mappings (
        scope text NOT NULL,
        value text,
        account_type text NOT NULL,
        PRIMARY KEY(scope, value)
      )`
    );
    // Seed defaults if empty
    const existing = await query('SELECT COUNT(1) AS c FROM discord_scopes');
    if (Number(existing.rows[0]?.c || 0) === 0) {
      const defaults = [
        'identify','email','connections','guilds','guilds.join','guilds.members.read',
        'guilds.channels.read','gdm.join','bot','rpc','rpc.notifications.read',
        'rpc.voice.read','rpc.voice.write','rpc.video.read','rpc.video.write',
        'rpc.screenshare.read','rpc.screenshare.write','rpc.activities.write',
        'webhook.incoming','messages.read','applications.builds.upload',
        'applications.builds.read','applications.commands','applications.store.update',
        'applications.entitlements','activities.read','activities.write',
        'activities.invites.write','relationships.read','relationships.write',
        'voice','dm_channels.read','role_connections.write','presences.read',
        'presences.write','openid','dm_channels.messages.read','dm_channels.messages.write',
        'gateway.connect','account.global_name.update','payment_sources.country_code',
        'sdk.social_layer_presence','sdk.social_layer','lobbies.write','application_identities.write'
      ];
      for (const s of defaults) {
        await query('INSERT INTO discord_scopes(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [s]);
      }
    }
  } catch (e) {
    console.warn('Не удалось инициализировать таблицы discord_scopes/mappings:', e.message);
  }
  // Ensure optional columns exist
  try {
    await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname text');
  } catch (e) {
    console.warn('Не удалось добавить колонку users.nickname:', e.message);
  }
  await checkDbAndWarn();
  server.listen(SERVER_CONFIG.PORT, SERVER_CONFIG.HOST, () => {
    console.log(`🚀 Server running on http://${SERVER_CONFIG.HOST}:${SERVER_CONFIG.PORT}`);
    console.log(`🌐 Frontend: ${SERVER_CONFIG.FRONTEND_URL}`);
  });
};

startServer().catch(console.error);
