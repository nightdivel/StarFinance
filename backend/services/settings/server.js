const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { query } = require('../../db');
const { authenticateToken, requirePermission } = require('../../middleware/auth');
const { SERVER_CONFIG, DISCORD_CONFIG } = require('../../config/serverConfig');
const { createServiceApp } = require('../_shared/createServiceApp');

process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'settings-service';

const app = createServiceApp();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function readDiscordEffective() {
  try {
    const ds = await query(
      'SELECT enable, client_id, client_secret, redirect_uri, default_account_type, base_url FROM discord_settings WHERE id = 1'
    );
    const row = ds.rows[0] || {};

    let attrRows = [];
    try {
      const a = await query('SELECT source, key, value, account_type, guild_id, set FROM discord_attr_mappings');
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
}

// ---- Auth page background/icon (public + admin) ----
const AUTH_BG_NAME = 'auth-bg';
const AUTH_ICON_NAME = 'auth-icon';
const SYSTEM_FAVICON_NAME = 'system-favicon';
const BRANDING_TITLE_KEY = 'system.appTitle';
const DEFAULT_APP_TITLE = 'BLSK Star Finance';
const TELEGRAM_NEWS_ENABLED_KEY = 'system.telegramNews.enabled';
const TELEGRAM_NEWS_CHANNEL_KEY = 'system.telegramNews.channel';
const TELEGRAM_NEWS_SYNC_MINUTES_KEY = 'system.telegramNews.syncMinutes';
const TELEGRAM_NEWS_LAST_SYNC_KEY = 'system.telegramNews.lastSyncAt';
const DISCORD_NEWS_ENABLED_KEY = 'system.discordNews.enabled';
const DISCORD_NEWS_CHANNEL_KEY = 'system.discordNews.channel';
const DISCORD_NEWS_BOT_TOKEN_KEY = 'system.discordNews.botToken';
const DISCORD_NEWS_SYNC_MINUTES_KEY = 'system.discordNews.syncMinutes';
const DISCORD_NEWS_LAST_SYNC_KEY = 'system.discordNews.lastSyncAt';
const SYSTEM_MENU_ORDER_KEY = 'system.menuOrder';
const SYSTEM_MENU_ORDER_DEFAULT = [
  'news',
  'finance',
  'warehouse',
  'showcase',
  'requests',
  'users',
  'directories',
  'uex',
  'tools',
  'settings',
];
const DEFAULT_TELEGRAM_NEWS_CHANNEL = 'JamTVStarCitizen';
const DEFAULT_TELEGRAM_NEWS_SYNC_MINUTES = 15;
const DEFAULT_DISCORD_NEWS_CHANNEL = '';
const DEFAULT_DISCORD_NEWS_SYNC_MINUTES = 15;
const AUTH_PUBLIC_DIR = path.join(__dirname, '../../public');

async function readSettingValue(key, fallback = null) {
  try {
    const r = await query('SELECT value FROM settings WHERE key = $1', [key]);
    if (!r.rows[0]) return fallback;
    const v = r.rows[0].value;
    return v === undefined || v === null ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

async function writeSettingValue(key, value) {
  await query(
    `INSERT INTO settings(key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}

function normalizeTelegramChannel(input) {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_TELEGRAM_NEWS_CHANNEL;
  let s = raw.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').trim();
  if (s.startsWith('s/')) s = s.slice(2);
  s = s.replace(/\/.*/, '').trim();
  return s || DEFAULT_TELEGRAM_NEWS_CHANNEL;
}

function normalizeDiscordChannel(input) {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_DISCORD_NEWS_CHANNEL;
  return raw;
}

function normalizeMenuOrder(input) {
  const incoming = Array.isArray(input) ? input : [];
  const filtered = incoming.filter((k) => SYSTEM_MENU_ORDER_DEFAULT.includes(k));
  return [
    ...filtered,
    ...SYSTEM_MENU_ORDER_DEFAULT.filter((k) => !filtered.includes(k)),
  ];
}

async function readTelegramNewsSettings() {
  const enabledRaw = await readSettingValue(TELEGRAM_NEWS_ENABLED_KEY, true);
  const channelRaw = await readSettingValue(
    TELEGRAM_NEWS_CHANNEL_KEY,
    DEFAULT_TELEGRAM_NEWS_CHANNEL
  );
  const syncMinutesRaw = await readSettingValue(
    TELEGRAM_NEWS_SYNC_MINUTES_KEY,
    DEFAULT_TELEGRAM_NEWS_SYNC_MINUTES
  );
  const lastSyncAt = await readSettingValue(TELEGRAM_NEWS_LAST_SYNC_KEY, null);
  const syncMinutes = Math.max(1, Math.min(360, Number(syncMinutesRaw) || DEFAULT_TELEGRAM_NEWS_SYNC_MINUTES));
  return {
    enabled: !!enabledRaw,
    channel: normalizeTelegramChannel(channelRaw),
    syncMinutes,
    lastSyncAt: lastSyncAt || null,
  };
}

async function readDiscordNewsSettings() {
  const out = {
    enabled: false,
    channel: DEFAULT_DISCORD_NEWS_CHANNEL,
    botTokenConfigured: false,
    syncMinutes: DEFAULT_DISCORD_NEWS_SYNC_MINUTES,
    lastSyncAt: null,
  };
  try {
    const rows = (
      await query('SELECT key, value FROM settings WHERE key = ANY($1)', [
        [
          DISCORD_NEWS_ENABLED_KEY,
          DISCORD_NEWS_CHANNEL_KEY,
          DISCORD_NEWS_BOT_TOKEN_KEY,
          DISCORD_NEWS_SYNC_MINUTES_KEY,
          DISCORD_NEWS_LAST_SYNC_KEY,
        ],
      ])
    ).rows;
    for (const r of rows) {
      if (r.key === DISCORD_NEWS_ENABLED_KEY) {
        const v = r.value;
        out.enabled =
          typeof v === 'boolean' ? v : String(v).toLowerCase() === 'true';
      }
      if (r.key === DISCORD_NEWS_CHANNEL_KEY) {
        out.channel = normalizeDiscordChannel(r.value);
      }
      if (r.key === DISCORD_NEWS_BOT_TOKEN_KEY) {
        out.botTokenConfigured = !!String(r.value || '').trim();
      }
      if (r.key === DISCORD_NEWS_SYNC_MINUTES_KEY) {
        out.syncMinutes = Math.max(1, Math.min(360, Number(r.value) || DEFAULT_DISCORD_NEWS_SYNC_MINUTES));
      }
      if (r.key === DISCORD_NEWS_LAST_SYNC_KEY) {
        out.lastSyncAt = r.value || null;
      }
    }
  } catch (_) {}
  out.botTokenConfigured = out.botTokenConfigured || !!String(process.env.DISCORD_BOT_TOKEN || '').trim();
  return out;
}

async function getAuthBgFile() {
  try {
    const files = await fs.readdir(AUTH_PUBLIC_DIR).catch(() => []);
    const byName = new Map(files.map((n) => [String(n).toLowerCase(), n]));
    const preferred = ['auth-bg.webp', 'auth-bg.png', 'auth-bg.svg'];
    for (const name of preferred) {
      const actual = byName.get(name);
      if (actual) return path.join(AUTH_PUBLIC_DIR, actual);
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function getAuthIconFile() {
  try {
    const files = await fs.readdir(AUTH_PUBLIC_DIR).catch(() => []);
    const byName = new Map(files.map((n) => [String(n).toLowerCase(), n]));
    const preferred = ['auth-icon.webp', 'auth-icon.png', 'auth-icon.svg'];
    for (const name of preferred) {
      const actual = byName.get(name);
      if (actual) return path.join(AUTH_PUBLIC_DIR, actual);
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function getSystemFaviconFile() {
  try {
    const files = await fs.readdir(AUTH_PUBLIC_DIR).catch(() => []);
    const byName = new Map(files.map((n) => [String(n).toLowerCase(), n]));
    const preferred = ['system-favicon.webp', 'system-favicon.png', 'system-favicon.svg'];
    for (const name of preferred) {
      const actual = byName.get(name);
      if (actual) return path.join(AUTH_PUBLIC_DIR, actual);
    }
    return null;
  } catch (_) {
    return null;
  }
}

app.get('/public/auth/background', async (req, res) => {
  try {
    const filePath = await getAuthBgFile();
    if (!filePath) return res.json({ url: null, updatedAt: null });
    const stat = await fs.stat(filePath).catch(() => null);
    const fileName = path.basename(filePath);
    return res.json({ url: `/public/auth/background/file/${encodeURIComponent(fileName)}`, updatedAt: stat ? stat.mtimeMs : null });
  } catch (e) {
    return res.json({ url: null, updatedAt: null });
  }
});

app.get('/public/auth/icon', async (req, res) => {
  try {
    const filePath = await getAuthIconFile();
    if (!filePath) return res.json({ url: null, updatedAt: null });
    const stat = await fs.stat(filePath).catch(() => null);
    const fileName = path.basename(filePath);
    return res.json({ url: `/public/auth/icon/file/${encodeURIComponent(fileName)}`, updatedAt: stat ? stat.mtimeMs : null });
  } catch (e) {
    return res.json({ url: null, updatedAt: null });
  }
});

app.get('/public/system/branding', async (req, res) => {
  try {
    const rawTitle = await readSettingValue(BRANDING_TITLE_KEY, DEFAULT_APP_TITLE);
    const appTitle = String(rawTitle || DEFAULT_APP_TITLE).trim() || DEFAULT_APP_TITLE;
    const faviconPath = await getSystemFaviconFile();
    if (!faviconPath) {
      return res.json({ appTitle, faviconUrl: null, updatedAt: null });
    }
    const stat = await fs.stat(faviconPath).catch(() => null);
    const fileName = path.basename(faviconPath);
    return res.json({
      appTitle,
      faviconUrl: `/public/system/favicon/file/${encodeURIComponent(fileName)}`,
      updatedAt: stat ? stat.mtimeMs : null,
    });
  } catch (_) {
    return res.json({ appTitle: DEFAULT_APP_TITLE, faviconUrl: null, updatedAt: null });
  }
});

app.get('/public/auth/background/file/:name', async (req, res) => {
  try {
    const name = req.params.name;
    if (!/^auth-bg\.(png|svg|webp)$/i.test(name)) return res.status(404).end();
    const filePath = path.join(AUTH_PUBLIC_DIR, name);
    const exists = await fs.stat(filePath).catch(() => null);
    if (!exists) return res.status(404).end();
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).end();
  }
});

app.get('/public/auth/icon/file/:name', async (req, res) => {
  try {
    const name = req.params.name;
    if (!/^auth-icon\.(png|svg|webp)$/i.test(name)) return res.status(404).end();
    const filePath = path.join(AUTH_PUBLIC_DIR, name);
    const exists = await fs.stat(filePath).catch(() => null);
    if (!exists) return res.status(404).end();
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).end();
  }
});

app.get('/public/system/favicon/file/:name', async (req, res) => {
  try {
    const name = req.params.name;
    if (!/^system-favicon\.(png|svg|webp)$/i.test(name)) return res.status(404).end();
    const filePath = path.join(AUTH_PUBLIC_DIR, name);
    const exists = await fs.stat(filePath).catch(() => null);
    if (!exists) return res.status(404).end();
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).end();
  }
});

app.get('/api/system/branding', authenticateToken, requirePermission('settings', 'read'), async (req, res) => {
  try {
    const rawTitle = await readSettingValue(BRANDING_TITLE_KEY, DEFAULT_APP_TITLE);
    const appTitle = String(rawTitle || DEFAULT_APP_TITLE).trim() || DEFAULT_APP_TITLE;
    const faviconPath = await getSystemFaviconFile();
    const faviconUrl = faviconPath
      ? `/public/system/favicon/file/${encodeURIComponent(path.basename(faviconPath))}`
      : null;
    res.json({ appTitle, faviconUrl });
  } catch (_) {
    res.status(500).json({ error: 'Ошибка чтения брендирования' });
  }
});

app.put('/api/system/branding', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const titleRaw = req.body?.appTitle;
    const appTitle = String(titleRaw || '').trim();
    if (!appTitle) return res.status(400).json({ error: 'Название приложения не может быть пустым' });
    if (appTitle.length > 80) return res.status(400).json({ error: 'Название приложения слишком длинное (максимум 80)' });
    await writeSettingValue(BRANDING_TITLE_KEY, appTitle);
    res.json({ success: true, appTitle });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения названия приложения' });
  }
});

app.get('/api/system/menu-order', authenticateToken, requirePermission('settings', 'read'), async (req, res) => {
  try {
    const raw = await readSettingValue(SYSTEM_MENU_ORDER_KEY, SYSTEM_MENU_ORDER_DEFAULT);
    return res.json({ menuOrder: normalizeMenuOrder(raw) });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка чтения порядка меню' });
  }
});

app.put('/api/system/menu-order', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const menuOrder = normalizeMenuOrder(req.body?.menuOrder);
    await writeSettingValue(SYSTEM_MENU_ORDER_KEY, menuOrder);
    return res.json({ success: true, menuOrder });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка сохранения порядка меню' });
  }
});

app.put('/api/system/favicon', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const { dataUrl } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'Некорректные данные изображения' });
    }
    if (!dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Ожидается data:image/*;base64,...' });
    }
    const headerEnd = dataUrl.indexOf(',');
    if (headerEnd < 0) return res.status(400).json({ error: 'Неверный формат data URL' });
    const header = dataUrl.slice(0, headerEnd);
    const b64 = dataUrl.slice(headerEnd + 1);
    const mimeMatch = header.match(/^data:image\/([^;]+)(;.*)?;base64$/i);
    if (!mimeMatch) return res.status(400).json({ error: 'Неверный заголовок data URL (нет ;base64)' });
    const subtype = String(mimeMatch[1] || '').toLowerCase();
    const baseType = subtype.includes('+') ? subtype.split('+')[0] : subtype;
    let ext;
    if (baseType === 'png') ext = 'png';
    else if (baseType === 'webp') ext = 'webp';
    else if (baseType === 'svg' || subtype === 'svg+xml' || baseType === 'jpg' || baseType === 'psvg' || baseType === 'jfif') ext = 'svg';
    else return res.status(400).json({ error: 'Поддерживаются PNG/svg/WebP (base64)' });
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 15000 * 1024) return res.status(413).json({ error: 'Размер изображения превышает 15MB' });
    await fs.mkdir(AUTH_PUBLIC_DIR, { recursive: true }).catch(() => {});
    try {
      for (const e of ['png', 'svg', 'webp']) {
        const p = path.join(AUTH_PUBLIC_DIR, `${SYSTEM_FAVICON_NAME}.${e}`);
        await fs.unlink(p).catch(() => {});
      }
    } catch (_) {}
    const target = path.join(AUTH_PUBLIC_DIR, `${SYSTEM_FAVICON_NAME}.${ext}`);
    await fs.writeFile(target, buf);
    return res.json({ success: true, faviconUrl: `/public/system/favicon/file/${SYSTEM_FAVICON_NAME}.${ext}` });
  } catch (e) {
    console.error('PUT /api/system/favicon error:', e);
    return res.status(500).json({ error: 'Ошибка сохранения favicon' });
  }
});

app.delete('/api/system/favicon', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    for (const e of ['png', 'svg', 'webp']) {
      const p = path.join(AUTH_PUBLIC_DIR, `${SYSTEM_FAVICON_NAME}.${e}`);
      await fs.unlink(p).catch(() => {});
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка удаления favicon' });
  }
});

app.get('/api/system/telegram-news', authenticateToken, requirePermission('settings', 'read'), async (req, res) => {
  try {
    const cfg = await readTelegramNewsSettings();
    res.json(cfg);
  } catch (_) {
    res.status(500).json({ error: 'Ошибка чтения настроек Telegram-новостей' });
  }
});

app.put('/api/system/telegram-news', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    const channel = normalizeTelegramChannel(req.body?.channel);
    const syncMinutes = Math.max(1, Math.min(360, Number(req.body?.syncMinutes) || DEFAULT_TELEGRAM_NEWS_SYNC_MINUTES));
    await writeSettingValue(TELEGRAM_NEWS_ENABLED_KEY, enabled);
    await writeSettingValue(TELEGRAM_NEWS_CHANNEL_KEY, channel);
    await writeSettingValue(TELEGRAM_NEWS_SYNC_MINUTES_KEY, syncMinutes);
    const cfg = await readTelegramNewsSettings();
    res.json({ success: true, ...cfg });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения настроек Telegram-новостей' });
  }
});

app.get('/api/system/discord-news', authenticateToken, requirePermission('settings', 'read'), async (req, res) => {
  try {
    const cfg = await readDiscordNewsSettings();
    res.json(cfg);
  } catch (_) {
    res.status(500).json({ error: 'Ошибка чтения настроек Discord-новостей' });
  }
});

app.put('/api/system/discord-news', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    const channel = normalizeDiscordChannel(req.body?.channel);
    const botTokenInput = req.body?.botToken;
    const hasBotTokenInput = typeof botTokenInput === 'string';
    const botToken = hasBotTokenInput ? String(botTokenInput || '').trim() : null;
    const syncMinutes = Math.max(1, Math.min(360, Number(req.body?.syncMinutes) || DEFAULT_DISCORD_NEWS_SYNC_MINUTES));
    await writeSettingValue(DISCORD_NEWS_ENABLED_KEY, enabled);
    await writeSettingValue(DISCORD_NEWS_CHANNEL_KEY, channel);
    if (hasBotTokenInput && botToken) {
      await writeSettingValue(DISCORD_NEWS_BOT_TOKEN_KEY, botToken);
    }
    await writeSettingValue(DISCORD_NEWS_SYNC_MINUTES_KEY, syncMinutes);
    const cfg = await readDiscordNewsSettings();
    res.json({ success: true, ...cfg });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения настроек Discord-новостей' });
  }
});

app.put('/api/system/auth/background', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const { dataUrl } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'Некорректные данные изображения' });
    }
    if (!dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Ожидается data:image/*;base64,...' });
    }
    const headerEnd = dataUrl.indexOf(',');
    if (headerEnd < 0) return res.status(400).json({ error: 'Неверный формат data URL' });
    const header = dataUrl.slice(0, headerEnd);
    const b64 = dataUrl.slice(headerEnd + 1);
    const mimeMatch = header.match(/^data:image\/([^;]+)(;.*)?;base64$/i);
    if (!mimeMatch) return res.status(400).json({ error: 'Неверный заголовок data URL (нет ;base64)' });
    const subtype = String(mimeMatch[1] || '').toLowerCase();
    const baseType = subtype.includes('+') ? subtype.split('+')[0] : subtype;
    let ext;
    if (baseType === 'png') ext = 'png';
    else if (baseType === 'webp') ext = 'webp';
    else if (baseType === 'svg' || subtype === 'svg+xml' || baseType === 'jpg' || baseType === 'psvg' || baseType === 'jfif') ext = 'svg';
    else return res.status(400).json({ error: 'Поддерживаются PNG/svg/WebP (base64)' });
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 15000 * 1024) return res.status(413).json({ error: 'Размер изображения превышает 15MB' });
    await fs.mkdir(AUTH_PUBLIC_DIR, { recursive: true }).catch(() => {});
    try {
      for (const e of ['png', 'svg', 'webp']) {
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

app.delete('/api/system/auth/background', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    for (const e of ['png', 'svg', 'webp']) {
      const p = path.join(AUTH_PUBLIC_DIR, `${AUTH_BG_NAME}.${e}`);
      await fs.unlink(p).catch(() => {});
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка удаления фона' });
  }
});

app.put('/api/system/auth/icon', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const { dataUrl } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'Некорректные данные изображения' });
    }
    if (!dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Ожидается data:image/*;base64,...' });
    }
    const headerEnd = dataUrl.indexOf(',');
    if (headerEnd < 0) return res.status(400).json({ error: 'Неверный формат data URL' });
    const header = dataUrl.slice(0, headerEnd);
    const b64 = dataUrl.slice(headerEnd + 1);
    const mimeMatch = header.match(/^data:image\/([^;]+)(;.*)?;base64$/i);
    if (!mimeMatch) return res.status(400).json({ error: 'Неверный заголовок data URL (нет ;base64)' });
    const subtype = String(mimeMatch[1] || '').toLowerCase();
    const baseType = subtype.includes('+') ? subtype.split('+')[0] : subtype;
    let ext;
    if (baseType === 'png') ext = 'png';
    else if (baseType === 'webp') ext = 'webp';
    else if (baseType === 'svg' || subtype === 'svg+xml' || baseType === 'jpg' || baseType === 'psvg' || baseType === 'jfif') ext = 'svg';
    else return res.status(400).json({ error: 'Поддерживаются PNG/svg/WebP (base64)' });
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 15000 * 1024) return res.status(413).json({ error: 'Размер изображения превышает 15MB' });
    await fs.mkdir(AUTH_PUBLIC_DIR, { recursive: true }).catch(() => {});
    try {
      for (const e of ['png', 'svg', 'webp']) {
        const p = path.join(AUTH_PUBLIC_DIR, `${AUTH_ICON_NAME}.${e}`);
        await fs.unlink(p).catch(() => {});
      }
    } catch (_) {}
    const target = path.join(AUTH_PUBLIC_DIR, `${AUTH_ICON_NAME}.${ext}`);
    await fs.writeFile(target, buf);
    return res.json({ success: true, url: `/public/auth/icon/file/${AUTH_ICON_NAME}.${ext}` });
  } catch (e) {
    console.error('PUT /api/system/auth/icon error:', e);
    return res.status(500).json({ error: 'Ошибка сохранения иконки' });
  }
});

app.delete('/api/system/auth/icon', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    for (const e of ['png', 'svg', 'webp']) {
      const p = path.join(AUTH_PUBLIC_DIR, `${AUTH_ICON_NAME}.${e}`);
      await fs.unlink(p).catch(() => {});
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка удаления иконки' });
  }
});

// System: Discord settings (effective)
app.get('/api/system/discord', authenticateToken, requirePermission('settings', 'read'), async (req, res) => {
  try {
    const eff = await readDiscordEffective();
    const effective = {
      enable: !!eff.enable,
      clientId: eff.clientId || '',
      clientSecret: eff.clientSecret || '',
      redirectUri: eff.redirectUri || '',
      baseUrl: eff.baseUrl || '',
    };
    res.json(effective);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения настроек Discord' });
  }
});

// Update Discord settings and rewrite backend .env
app.put('/api/system/discord', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const { enable, clientId, clientSecret, redirectUri, baseUrl: baseUrlIn } = req.body || {};
    const eff = await readDiscordEffective();
    const final = {
      enable: !!enable,
      clientId: typeof clientId === 'string' && clientId.trim() !== '' ? clientId : eff.clientId || '',
      clientSecret: typeof clientSecret === 'string' && clientSecret.trim() !== '' ? clientSecret : eff.clientSecret || '',
      redirectUri: typeof redirectUri === 'string' && redirectUri.trim() !== '' ? redirectUri : eff.redirectUri || '',
      defaultAccountType: eff.defaultAccountType || 'Гость',
    };
    let baseUrl;
    if (baseUrlIn !== undefined) {
      baseUrl = typeof baseUrlIn === 'string' ? baseUrlIn.trim() : '';
    } else {
      baseUrl = eff.baseUrl || '';
    }
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

    const envPath = path.resolve(__dirname, '../../.env');
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
});

// Currencies config
app.get('/api/system/currencies', authenticateToken, requirePermission('directories', 'read'), async (req, res) => {
  try {
    const s = await (async () => {
      const map = {};
      try {
        const r = await query('SELECT key, value FROM settings');
        for (const row of r.rows) map[row.key] = row.value;
      } catch (_) {}
      return map;
    })();
    const baseCurrency = s['system.baseCurrency'] ?? 'aUEC';
    const cres = await query('SELECT code FROM currencies ORDER BY code');
    const codes = cres.rows.map((r) => r.code);
    const rres = await query('SELECT code, rate FROM currency_rates WHERE base_code = $1', [baseCurrency]);
    const rates = Object.fromEntries(rres.rows.map((r) => [r.code, Number(r.rate)]));
    res.json({ currencies: codes, baseCurrency, rates });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения валют' });
  }
});

app.put('/api/system/currencies', authenticateToken, requirePermission('directories', 'write'), async (req, res) => {
  try {
    const { currencies, baseCurrency, rates } = req.body || {};
    if (!Array.isArray(currencies) || !currencies.length)
      return res.status(400).json({ error: 'Список валют пуст' });
    if (!baseCurrency || typeof baseCurrency !== 'string')
      return res.status(400).json({ error: 'Базовая валюта не указана' });

    const existingRes = await query('SELECT code FROM currencies');
    const existing = new Set(existingRes.rows.map((r) => r.code));
    const desired = new Set(currencies);

    for (const code of currencies) {
      if (typeof code === 'string' && code.trim() !== '') {
        await query('INSERT INTO currencies(code) VALUES ($1) ON CONFLICT (code) DO NOTHING', [code.trim()]);
      }
    }

    for (const ex of existing) {
      if (!desired.has(ex)) {
        await query('DELETE FROM currency_rates WHERE code = $1 OR base_code = $1', [ex]);
        await query('DELETE FROM currencies WHERE code = $1', [ex]);
      }
    }

    await query(
      `INSERT INTO settings(key, value) VALUES ('system.baseCurrency', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(baseCurrency)]
    );

    if (rates && typeof rates === 'object') {
      const allowed = new Set((currencies || []).map((c) => String(c).trim()));
      for (const [code, rateVal] of Object.entries(rates)) {
        const codeStr = String(code).trim();
        if (!allowed.has(codeStr)) continue;
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

    await query(
      `INSERT INTO currency_rates(base_code, code, rate) VALUES ($1, $1, 1)
       ON CONFLICT (base_code, code) DO UPDATE SET rate = 1`,
      [baseCurrency]
    );

    const cres = await query('SELECT code FROM currencies ORDER BY code');
    const codes = cres.rows.map((r) => r.code);
    const rres = await query('SELECT code, rate FROM currency_rates WHERE base_code = $1', [baseCurrency]);
    const outRates = Object.fromEntries(rres.rows.map((r) => [r.code, Number(r.rate)]));
    res.json({ success: true, currencies: codes, baseCurrency, rates: outRates });
  } catch (e) {
    console.error('PUT /api/system/currencies error:', e);
    res.status(500).json({ error: 'Ошибка сохранения валют' });
  }
});

const port = Number(process.env.PORT || 3008);
http.createServer(app).listen(port, '0.0.0.0', () => {
  console.log(`[settings-service] listening on :${port}`);
});
