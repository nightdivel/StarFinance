/* eslint-disable no-empty */
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const { query } = require('./db');
const { authenticateToken, generateToken, requirePermission } = require('./middleware/auth');
const { createBuildAggregatedData } = require('./buildAggregatedData');
const { createDataHelpers } = require('./dataHelpers');
const { createAppDataCache } = require('./appDataCache');
const { createDiscordOAuthHelpers } = require('./discordOAuthHelpers');
const { SERVER_CONFIG, DISCORD_CONFIG } = require('./config/serverConfig');

// Конфигурация multer для загрузки изображений
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public', 'uploads', 'news');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Разрешенные типы изображений
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Недопустимый тип файла. Разрешены: JPEG, PNG, GIF, WebP'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1
  }
});

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

function normalizeBasePath(p) {
  const s = String(p || '').trim();
  if (!s) return '';
  if (s === '/') return '';
  const withSlash = s.startsWith('/') ? s : `/${s}`;
  return withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

function detectPublicBasePath() {
  // Priority 1: explicit BASE_PATH (/economy)
  const explicit = normalizeBasePath(process.env.BASE_PATH || process.env.PUBLIC_BASE_PATH);
  if (explicit) return explicit;

  // Priority 2: FRONTEND_URL (may be https://host/economy)
  try {
    const fu = process.env.FRONTEND_URL;
    if (fu && typeof fu === 'string' && /^https?:\/\//i.test(fu)) {
      const u = new URL(fu);
      const p = normalizeBasePath(u.pathname);
      if (p) return p;
    }
  } catch {}

  // Priority 3: DISCORD_REDIRECT_URI (often contains /economy/auth/discord/callback)
  try {
    const ru = process.env.DISCORD_REDIRECT_URI;
    if (ru && typeof ru === 'string' && /^https?:\/\//i.test(ru)) {
      const u = new URL(ru);
      const p = String(u.pathname || '');
      const marker = '/auth/discord/callback';
      const idx = p.indexOf(marker);
      if (idx >= 0) {
        const prefix = normalizeBasePath(p.slice(0, idx));
        if (prefix) return prefix;
      }
      const full = normalizeBasePath(p);
      if (full) return full;
    }
  } catch {}

  return '';
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const TELEGRAM_NEWS_ENABLED_KEY = 'system.telegramNews.enabled';
const TELEGRAM_NEWS_CHANNEL_KEY = 'system.telegramNews.channel';
const TELEGRAM_NEWS_SYNC_MINUTES_KEY = 'system.telegramNews.syncMinutes';
const TELEGRAM_NEWS_LAST_SYNC_KEY = 'system.telegramNews.lastSyncAt';
const DISCORD_NEWS_ENABLED_KEY = 'system.discordNews.enabled';
const DISCORD_NEWS_CHANNEL_KEY = 'system.discordNews.channel';
const DISCORD_NEWS_CHANNEL_INPUT_KEY = 'system.discordNews.channelInput';
const DISCORD_NEWS_BOT_TOKEN_KEY = 'system.discordNews.botToken';
const DISCORD_NEWS_SYNC_MINUTES_KEY = 'system.discordNews.syncMinutes';
const DISCORD_NEWS_LAST_SYNC_KEY = 'system.discordNews.lastSyncAt';
const DISCORD_NEWS_OAUTH_ACCESS_TOKEN_KEY = 'system.discordNews.oauth.accessToken';
const DISCORD_NEWS_OAUTH_REFRESH_TOKEN_KEY = 'system.discordNews.oauth.refreshToken';
const DISCORD_NEWS_OAUTH_SCOPE_KEY = 'system.discordNews.oauth.scope';
const DISCORD_NEWS_OAUTH_TOKEN_TYPE_KEY = 'system.discordNews.oauth.tokenType';
const DISCORD_NEWS_OAUTH_EXPIRES_AT_KEY = 'system.discordNews.oauth.expiresAt';
const DEFAULT_TELEGRAM_NEWS_CHANNEL = 'JamTVStarCitizen';
const DEFAULT_TELEGRAM_NEWS_SYNC_MINUTES = 15;
const DEFAULT_DISCORD_NEWS_CHANNEL = '';
const DEFAULT_DISCORD_NEWS_SYNC_MINUTES = 15;
let telegramNewsSyncInProgress = false;
let telegramNewsLastRunAtMs = 0;
let discordNewsSyncInProgress = false;
const discordNewsOauthStates = new Map();

function normalizeTelegramChannel(input) {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_TELEGRAM_NEWS_CHANNEL;
  let s = raw.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').trim();
  if (s.startsWith('s/')) s = s.slice(2);
  s = s.replace(/\/.*/, '').trim();
  return s || DEFAULT_TELEGRAM_NEWS_CHANNEL;
}

function normalizeDiscordChannel(input) {
  const parsed = parseDiscordChannelReference(input);
  return parsed?.channelId || DEFAULT_DISCORD_NEWS_CHANNEL;
}

function parseDiscordChannelReference(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const hashless = raw.replace(/^#/, '').trim();
  if (/^\d{8,30}$/.test(hashless)) {
    return {
      channelId: hashless,
      guildId: '',
      messageId: '',
      source: 'id',
      input: raw,
    };
  }

  const normalizedUrl = /^https?:\/\//i.test(raw)
    ? raw
    : /discord(app)?\.com\//i.test(raw)
      ? `https://${raw}`
      : '';
  if (normalizedUrl) {
    try {
      const u = new URL(normalizedUrl);
      const host = String(u.hostname || '').toLowerCase();
      const hostOk =
        host === 'discord.com' ||
        host === 'www.discord.com' ||
        host === 'canary.discord.com' ||
        host === 'ptb.discord.com' ||
        host === 'discordapp.com';
      if (hostOk) {
        const parts = String(u.pathname || '')
          .split('/')
          .map((x) => x.trim())
          .filter(Boolean);
        // /channels/{guildOr@me}/{channelId}/{messageId?}
        if (parts[0] === 'channels' && parts[2] && /^\d{8,30}$/.test(parts[2])) {
          return {
            channelId: parts[2],
            guildId: parts[1] === '@me' ? '' : String(parts[1] || ''),
            messageId: /^\d{8,30}$/.test(String(parts[3] || '')) ? String(parts[3]) : '',
            source: 'url',
            input: raw,
          };
        }
      }
    } catch (_) {}
  }

  const fallback = raw.match(/discord(?:app)?\.com\/channels\/[^/]+\/(\d{8,30})/i);
  if (fallback?.[1]) {
    return {
      channelId: fallback[1],
      guildId: '',
      messageId: '',
      source: 'regex',
      input: raw,
    };
  }

  return null;
}

function detectNewsSourceFromContent(content) {
  const body = String(content || '');
  if (/telegram-source:/i.test(body)) return 'telegram';
  if (/discord-source:/i.test(body)) return 'discord';
  return 'local';
}

function ensureLocalNewsSourceMarker(content) {
  const body = String(content || '');
  if (/telegram-source:|discord-source:|news-source:local/i.test(body)) return body;
  return `${body}\n<!-- news-source:local -->`;
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeTelegramAssetUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return `https://t.me${s}`;
  return s;
}

function extractTelegramMediaUrls(sectionHtml) {
  const section = String(sectionHtml || '');
  const urls = new Set();

  // Keep only media that belongs to the message body/photo blocks,
  // and exclude reaction/emoji/service icons from Telegram UI.
  const mediaChunks = [];
  const photoWrapRegex = /<a[^>]*class="[^"]*tgme_widget_message_photo_wrap[^"]*"[^>]*>/gi;
  let m;
  while ((m = photoWrapRegex.exec(section)) !== null) {
    mediaChunks.push(m[0]);
  }

  const textBlockRegex = /<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/i;
  const textBlock = section.match(textBlockRegex)?.[1] || '';
  if (textBlock) mediaChunks.push(textBlock);

  for (const chunk of mediaChunks) {
    const styleUrlRegex = /(?:background-image|background)\s*:\s*url\((['"]?)([^'")]+)\1\)/gi;
    let s;
    while ((s = styleUrlRegex.exec(chunk)) !== null) {
      const normalized = normalizeTelegramAssetUrl(s[2]);
      if (!/^https?:\/\//i.test(normalized)) continue;
      if (/telegram\.org\/img\/emoji\//i.test(normalized)) continue;
      urls.add(normalized);
    }

    const srcRegex = /<(?:img|source)[^>]+(?:src|srcset)="([^"]+)"/gi;
    while ((s = srcRegex.exec(chunk)) !== null) {
      const normalized = normalizeTelegramAssetUrl(s[1]);
      if (!/^https?:\/\//i.test(normalized)) continue;
      if (/telegram\.org\/img\/emoji\//i.test(normalized)) continue;
      urls.add(normalized);
    }
  }

  return Array.from(urls).slice(0, 6);
}

function htmlToText(html) {
  const withBreaks = String(html || '').replace(/<br\s*\/?\s*>/gi, '\n');
  const noTags = withBreaks.replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(noTags)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildImportedNewsSummary(lines, title) {
  const cleanLines = Array.isArray(lines)
    ? lines.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const secondLine = cleanLines[1] || '';
  const thirdLine = cleanLines[2] || '';
  const combined = [secondLine, thirdLine].filter(Boolean).join(' ').trim();
  if (combined) {
    return `${combined} ...`.slice(0, 1000).trim();
  }
  return `${String(title || '').trim() || 'Новость'} ...`.slice(0, 1000).trim();
}

function parseTelegramPostsFromHtml(html, channel) {
  const normalizedChannel = normalizeTelegramChannel(channel);
  const chunks = String(html || '').split('<div class="tgme_widget_message_wrap').slice(1);
  const posts = [];

  for (const part of chunks) {
    const section = `<div class="tgme_widget_message_wrap${part}`;
    const urlMatch = section.match(/<a class="tgme_widget_message_date" href="([^"]+)"/i);
    const dateMatch = section.match(/<time[^>]*datetime="([^"]+)"/i);
    const textMatch = section.match(
      /<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/i
    );
    const mediaUrls = extractTelegramMediaUrls(section);

    const url = urlMatch?.[1] || '';
    if (!url.includes(`/t.me/${normalizedChannel}/`) && !url.includes(`/t.me/s/${normalizedChannel}/`)) {
      continue;
    }

    const rawMessageHtml = textMatch?.[1] || '';
    const fullText = htmlToText(rawMessageHtml);
    if (!fullText && mediaUrls.length === 0) continue;

    const lines = fullText
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
    if (lines.length === 0) lines.push('Пост из Telegram');

    const title = (lines[0] || '').slice(0, 255).trim();
    const summary = buildImportedNewsSummary(lines, title);
    const publishedAt = dateMatch?.[1] ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();
    const safeText = escapeHtml(fullText || title).replace(/\n/g, '<br/>');
    const mediaHtml = mediaUrls
      .map((mediaUrl) => `<p><img src="${escapeHtml(mediaUrl)}" alt="Telegram image" /></p>`)
      .join('');
    const safeUrl = escapeHtml(url);
    const content = `<div>${safeText}</div>${mediaHtml}<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Источник в Telegram</a></p><!-- telegram-source:${safeUrl} -->`;

    posts.push({ url, title, summary, content, publishedAt });
  }

  return posts;
}

function extractDiscordMediaUrls(message) {
  const urls = new Set();
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  for (const a of attachments) {
    const url = String(a?.url || '').trim();
    if (/^https?:\/\//i.test(url)) urls.add(url);
  }

  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  for (const e of embeds) {
    const image = String(e?.image?.url || '').trim();
    const thumbnail = String(e?.thumbnail?.url || '').trim();
    const video = String(e?.video?.url || '').trim();
    if (/^https?:\/\//i.test(image)) urls.add(image);
    if (/^https?:\/\//i.test(thumbnail)) urls.add(thumbnail);
    if (/^https?:\/\//i.test(video)) urls.add(video);
  }

  return Array.from(urls).slice(0, 8);
}

function discordMessageToPlainText(message) {
  const lines = [];
  const content = String(message?.content || '').trim();
  if (content) lines.push(content);

  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  for (const e of embeds) {
    const title = String(e?.title || '').trim();
    const description = String(e?.description || '').trim();
    if (title) lines.push(title);
    if (description) lines.push(description);
    const fields = Array.isArray(e?.fields) ? e.fields : [];
    for (const f of fields) {
      const name = String(f?.name || '').trim();
      const value = String(f?.value || '').trim();
      if (name) lines.push(name);
      if (value) lines.push(value);
    }
  }

  return lines.join('\n').trim();
}

function parseDiscordMessages(messages, channel) {
  const out = [];
  const normalizedChannel = normalizeDiscordChannel(channel);

  for (const message of Array.isArray(messages) ? messages : []) {
    const messageId = String(message?.id || '').trim();
    if (!messageId) continue;
    const isSystem = !!message?.system;
    if (isSystem) continue;

    const fullText = discordMessageToPlainText(message);
    const mediaUrls = extractDiscordMediaUrls(message);
    if (!fullText && mediaUrls.length === 0) continue;

    const lines = fullText
      .split('\n')
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    const authorName = String(message?.author?.global_name || message?.author?.username || 'Discord').trim();
    const titleBase = lines[0] || `Пост Discord: ${authorName}`;
    const title = titleBase.slice(0, 255).trim();
    const summary = buildImportedNewsSummary(lines, title);

    const guildId = String(message?.guild_id || '').trim();
    const messageUrl = guildId
      ? `https://discord.com/channels/${guildId}/${normalizedChannel}/${messageId}`
      : `https://discord.com/channels/@me/${normalizedChannel}/${messageId}`;
    const safeText = escapeHtml(fullText || title).replace(/\n/g, '<br/>');
    const mediaHtml = mediaUrls
      .map((mediaUrl) => `<p><img src="${escapeHtml(mediaUrl)}" alt="Discord media" /></p>`)
      .join('');
    const safeUrl = escapeHtml(messageUrl);
    const content = `<div>${safeText}</div>${mediaHtml}<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Источник в Discord</a></p><!-- discord-source:${normalizedChannel}:${messageId} -->`;

    out.push({
      id: messageId,
      channel: normalizedChannel,
      title,
      summary,
      content,
      publishedAt: message?.timestamp ? new Date(message.timestamp).toISOString() : new Date().toISOString(),
      url: messageUrl,
    });
  }

  return out;
}

async function readTelegramNewsSettingsDb() {
  const out = {
    enabled: true,
    channel: DEFAULT_TELEGRAM_NEWS_CHANNEL,
    syncMinutes: DEFAULT_TELEGRAM_NEWS_SYNC_MINUTES,
    lastSyncAt: null,
  };
  try {
    const rows = (
      await query('SELECT key, value FROM settings WHERE key = ANY($1)', [
        [
          TELEGRAM_NEWS_ENABLED_KEY,
          TELEGRAM_NEWS_CHANNEL_KEY,
          TELEGRAM_NEWS_SYNC_MINUTES_KEY,
          TELEGRAM_NEWS_LAST_SYNC_KEY,
        ],
      ])
    ).rows;
    for (const r of rows) {
      if (r.key === TELEGRAM_NEWS_ENABLED_KEY) {
        const v = r.value;
        out.enabled =
          typeof v === 'boolean' ? v : String(v).toLowerCase() === 'false' ? false : true;
      }
      if (r.key === TELEGRAM_NEWS_CHANNEL_KEY) {
        out.channel = normalizeTelegramChannel(r.value);
      }
      if (r.key === TELEGRAM_NEWS_SYNC_MINUTES_KEY) {
        out.syncMinutes = Math.max(1, Math.min(360, Number(r.value) || DEFAULT_TELEGRAM_NEWS_SYNC_MINUTES));
      }
      if (r.key === TELEGRAM_NEWS_LAST_SYNC_KEY) {
        out.lastSyncAt = r.value || null;
      }
    }
  } catch (_) {}
  return out;
}

async function readDiscordNewsSettingsDb() {
  const out = {
    enabled: false,
    channel: DEFAULT_DISCORD_NEWS_CHANNEL,
    channelId: '',
    botTokenConfigured: false,
    syncMinutes: DEFAULT_DISCORD_NEWS_SYNC_MINUTES,
    lastSyncAt: null,
    oauthConnected: false,
    oauthExpiresAt: null,
    oauthScope: '',
  };
  try {
    const rows = (
      await query('SELECT key, value FROM settings WHERE key = ANY($1)', [
        [
          DISCORD_NEWS_ENABLED_KEY,
          DISCORD_NEWS_CHANNEL_KEY,
          DISCORD_NEWS_CHANNEL_INPUT_KEY,
          DISCORD_NEWS_BOT_TOKEN_KEY,
          DISCORD_NEWS_SYNC_MINUTES_KEY,
          DISCORD_NEWS_LAST_SYNC_KEY,
          DISCORD_NEWS_OAUTH_ACCESS_TOKEN_KEY,
          DISCORD_NEWS_OAUTH_EXPIRES_AT_KEY,
          DISCORD_NEWS_OAUTH_SCOPE_KEY,
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
        out.channelId = normalizeDiscordChannel(r.value);
        if (!out.channel) out.channel = out.channelId;
      }
      if (r.key === DISCORD_NEWS_CHANNEL_INPUT_KEY) {
        out.channel = String(r.value || '').trim();
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
      if (r.key === DISCORD_NEWS_OAUTH_ACCESS_TOKEN_KEY) {
        out.oauthConnected = !!String(r.value || '').trim();
      }
      if (r.key === DISCORD_NEWS_OAUTH_EXPIRES_AT_KEY) {
        out.oauthExpiresAt = r.value || null;
      }
      if (r.key === DISCORD_NEWS_OAUTH_SCOPE_KEY) {
        out.oauthScope = String(r.value || '');
      }
    }
  } catch (_) {}
  out.botTokenConfigured = out.botTokenConfigured || !!String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!out.channel && out.channelId) out.channel = out.channelId;
  return out;
}

async function readDiscordNewsBotTokenDb() {
  try {
    const r = await query('SELECT value FROM settings WHERE key = $1 LIMIT 1', [DISCORD_NEWS_BOT_TOKEN_KEY]);
    return String(r?.rows?.[0]?.value || '').trim();
  } catch (_) {
    return '';
  }
}

async function readDiscordNewsOauthSettingsDb() {
  const out = {
    accessToken: '',
    refreshToken: '',
    scope: '',
    tokenType: '',
    expiresAt: null,
  };
  try {
    const rows = (
      await query('SELECT key, value FROM settings WHERE key = ANY($1)', [
        [
          DISCORD_NEWS_OAUTH_ACCESS_TOKEN_KEY,
          DISCORD_NEWS_OAUTH_REFRESH_TOKEN_KEY,
          DISCORD_NEWS_OAUTH_SCOPE_KEY,
          DISCORD_NEWS_OAUTH_TOKEN_TYPE_KEY,
          DISCORD_NEWS_OAUTH_EXPIRES_AT_KEY,
        ],
      ])
    ).rows;
    for (const r of rows) {
      if (r.key === DISCORD_NEWS_OAUTH_ACCESS_TOKEN_KEY) out.accessToken = String(r.value || '');
      if (r.key === DISCORD_NEWS_OAUTH_REFRESH_TOKEN_KEY) out.refreshToken = String(r.value || '');
      if (r.key === DISCORD_NEWS_OAUTH_SCOPE_KEY) out.scope = String(r.value || '');
      if (r.key === DISCORD_NEWS_OAUTH_TOKEN_TYPE_KEY) out.tokenType = String(r.value || '');
      if (r.key === DISCORD_NEWS_OAUTH_EXPIRES_AT_KEY) out.expiresAt = r.value || null;
    }
  } catch (_) {}
  return out;
}

function cleanupDiscordNewsOauthStates() {
  const now = Date.now();
  for (const [key, value] of discordNewsOauthStates.entries()) {
    if (!value || now - Number(value.createdAt || 0) > 10 * 60 * 1000) {
      discordNewsOauthStates.delete(key);
    }
  }
}

function issueDiscordNewsOauthState(userId) {
  cleanupDiscordNewsOauthStates();
  const nonce = crypto.randomBytes(24).toString('hex');
  const state = `syncnews:${nonce}`;
  discordNewsOauthStates.set(state, { userId: userId || null, createdAt: Date.now() });
  return state;
}

function consumeDiscordNewsOauthState(state) {
  cleanupDiscordNewsOauthStates();
  const rec = discordNewsOauthStates.get(state);
  if (!rec) return null;
  discordNewsOauthStates.delete(state);
  return rec;
}

async function writeTelegramNewsSetting(key, value) {
  await query(
    `INSERT INTO settings(key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}

async function writeDiscordNewsSetting(key, value) {
  await query(
    `INSERT INTO settings(key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}

async function clearDiscordNewsOauthSettings() {
  await writeDiscordNewsSetting(DISCORD_NEWS_OAUTH_ACCESS_TOKEN_KEY, null);
  await writeDiscordNewsSetting(DISCORD_NEWS_OAUTH_REFRESH_TOKEN_KEY, null);
  await writeDiscordNewsSetting(DISCORD_NEWS_OAUTH_SCOPE_KEY, null);
  await writeDiscordNewsSetting(DISCORD_NEWS_OAUTH_TOKEN_TYPE_KEY, null);
  await writeDiscordNewsSetting(DISCORD_NEWS_OAUTH_EXPIRES_AT_KEY, null);
}

async function ensureTelegramNewsAuthorId() {
  const technicalId = 'deleted_user';
  const technicalUsername = 'deleted_user';
  try {
    const existing = await query('SELECT id FROM users WHERE id = $1', [technicalId]);
    if (existing.rowCount > 0) return technicalId;

    const passwordHash = crypto
      .createHash('sha256')
      .update(`deleted:${technicalId}`)
      .digest('hex');

    await query(
      `INSERT INTO users (id, username, email, auth_type, password_hash, account_type, is_active, created_at)
       VALUES ($1, $2, NULL, 'local', $3, 'Гость', FALSE, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [technicalId, technicalUsername, passwordHash]
    );
    return technicalId;
  } catch (_) {
    const first = await query('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').catch(() => null);
    return first?.rows?.[0]?.id || null;
  }
}

async function syncTelegramNews({ force = false } = {}) {
  if (telegramNewsSyncInProgress) return { skipped: true, reason: 'busy' };
  telegramNewsSyncInProgress = true;
  try {
    const cfg = await readTelegramNewsSettingsDb();
    if (!force && !cfg.enabled) return { skipped: true, reason: 'disabled' };
    const channel = normalizeTelegramChannel(cfg.channel);
    const url = `https://t.me/s/${encodeURIComponent(channel)}`;
    const resp = await axios.get(url, {
      timeout: 25000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      },
    });

    const parsed = parseTelegramPostsFromHtml(resp.data, channel).slice(0, 25);
    if (parsed.length === 0) {
      await writeTelegramNewsSetting(TELEGRAM_NEWS_LAST_SYNC_KEY, new Date().toISOString());
      return { success: true, inserted: 0, checked: 0 };
    }

    const authorId = await ensureTelegramNewsAuthorId();
    if (!authorId) return { skipped: true, reason: 'no_author' };

    let inserted = 0;
    let updated = 0;
    for (const post of parsed.reverse()) {
      const markerOld = `Источник: ${post.url}`;
      const markerNew = `telegram-source:${post.url}`;
      const updExisting = await query(
        `UPDATE news
         SET title = $1,
             content = $2,
             summary = $3,
             published_at = $4
         WHERE content LIKE $5 OR content LIKE $6
         RETURNING *`,
        [post.title, post.content, post.summary, post.publishedAt, `%${markerOld}%`, `%${markerNew}%`]
      );
      if (updExisting.rowCount > 0) {
        updated += updExisting.rowCount;
        try {
          for (const row of updExisting.rows) {
            io.emit('news:changed', { action: 'update', news: row });
          }
        } catch (_) {}
        continue;
      }

      const ins = await query(
        `INSERT INTO news (title, content, summary, published_at, author_id)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (SELECT 1 FROM news WHERE content LIKE $6 OR content LIKE $7)
         RETURNING *`,
        [post.title, post.content, post.summary, post.publishedAt, authorId, `%${markerOld}%`, `%${markerNew}%`]
      );
      if (ins.rowCount > 0) {
        inserted += 1;
        try {
          io.emit('news:changed', { action: 'create', news: ins.rows[0] });
        } catch (_) {}
      }
    }

    await writeTelegramNewsSetting(TELEGRAM_NEWS_LAST_SYNC_KEY, new Date().toISOString());
    return { success: true, inserted, updated, checked: parsed.length, channel };
  } catch (e) {
    console.error('Telegram news sync failed:', e?.message || e);
    return { success: false, error: e?.message || 'sync_failed' };
  } finally {
    telegramNewsSyncInProgress = false;
  }
}

async function syncDiscordNews({ force = false } = {}) {
  if (discordNewsSyncInProgress) return { skipped: true, reason: 'busy' };
  discordNewsSyncInProgress = true;
  let oauth = {
    accessToken: '',
    refreshToken: '',
    scope: '',
    tokenType: '',
    expiresAt: null,
  };
  let authMode = '';
  try {
    const cfg = await readDiscordNewsSettingsDb();
    if (!force && !cfg.enabled) return { skipped: true, reason: 'disabled' };
    const channelSource = String(cfg.channel || cfg.channelId || '').trim();
    const parsedRef = parseDiscordChannelReference(channelSource);
    const channel = parsedRef?.channelId || '';
    if (!channel) {
      if (!channelSource) {
        return { success: false, error: 'channel_not_configured' };
      }
      return { success: false, error: 'invalid_channel_reference' };
    }

    const botTokenFromDb = await readDiscordNewsBotTokenDb();
    const botToken = String(process.env.DISCORD_BOT_TOKEN || botTokenFromDb || '').trim();
    if (!botToken) {
      return { success: false, error: 'discord_bot_token_required' };
    }
    oauth = await readDiscordNewsOauthSettingsDb();
    let authorization = '';
    const refreshDiscordOauthAccessToken = async () => {
      if (!oauth.refreshToken) return false;
      try {
        const eff = await readDiscordEffective();
        const clientId = eff.clientId || DISCORD_CONFIG.CLIENT_ID;
        const clientSecret = eff.clientSecret || DISCORD_CONFIG.CLIENT_SECRET;
        const redirectUri = eff.redirectUri || DISCORD_CONFIG.REDIRECT_URI;
        if (!clientId || !clientSecret || !redirectUri) return false;

        const refreshed = await axios.post(
          'https://discord.com/api/oauth2/token',
          new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: oauth.refreshToken,
            redirect_uri: redirectUri,
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
            timeout: 20000,
          }
        );

        const expiresInSec = Number(refreshed?.data?.expires_in) || 0;
        const refreshedExpiresAt = expiresInSec > 0
          ? new Date(Date.now() + expiresInSec * 1000).toISOString()
          : null;
        await writeDiscordNewsSetting(
          DISCORD_NEWS_OAUTH_ACCESS_TOKEN_KEY,
          refreshed?.data?.access_token || oauth.accessToken || null
        );
        await writeDiscordNewsSetting(
          DISCORD_NEWS_OAUTH_REFRESH_TOKEN_KEY,
          refreshed?.data?.refresh_token || oauth.refreshToken || null
        );
        await writeDiscordNewsSetting(
          DISCORD_NEWS_OAUTH_SCOPE_KEY,
          refreshed?.data?.scope || oauth.scope || null
        );
        await writeDiscordNewsSetting(
          DISCORD_NEWS_OAUTH_TOKEN_TYPE_KEY,
          refreshed?.data?.token_type || oauth.tokenType || null
        );
        await writeDiscordNewsSetting(DISCORD_NEWS_OAUTH_EXPIRES_AT_KEY, refreshedExpiresAt);
        oauth = await readDiscordNewsOauthSettingsDb();
        return !!String(oauth.accessToken || '').trim();
      } catch (refreshError) {
        console.warn('Discord OAuth refresh failed:', refreshError?.message || refreshError);
        return false;
      }
    };

    authorization = `Bot ${botToken}`;
    authMode = 'bot';

    const fetchMessages = async (authHeader) =>
      axios.get(`https://discord.com/api/v10/channels/${encodeURIComponent(channel)}/messages`, {
        params: { limit: 50 },
        timeout: 25000,
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'User-Agent': 'StarFinance Discord Sync/1.0',
        },
      });

    let resp;
    try {
      resp = await fetchMessages(authorization);
    } catch (requestError) {
      const status = Number(requestError?.response?.status) || 0;
      if (authMode === 'oauth' && (status === 401 || status === 403) && oauth.refreshToken) {
        const refreshed = await refreshDiscordOauthAccessToken();
        if (refreshed) {
          authorization = `Bearer ${oauth.accessToken}`;
          resp = await fetchMessages(authorization);
        } else {
          throw requestError;
        }
      } else {
        throw requestError;
      }
    }

    const parsed = parseDiscordMessages(resp.data, channel).slice(0, 50);
    if (parsed.length === 0) {
      await writeDiscordNewsSetting(DISCORD_NEWS_LAST_SYNC_KEY, new Date().toISOString());
      return { success: true, inserted: 0, updated: 0, checked: 0, channel, authMode };
    }

    const authorId = await ensureTelegramNewsAuthorId();
    if (!authorId) return { skipped: true, reason: 'no_author' };

    let inserted = 0;
    let updated = 0;
    for (const post of parsed.reverse()) {
      const markerNew = `discord-source:${post.channel}:${post.id}`;
      const markerLegacy = `discord-source:${post.id}`;
      const updExisting = await query(
        `UPDATE news
         SET title = $1,
             content = $2,
             summary = $3,
             published_at = $4
         WHERE content LIKE $5 OR content LIKE $6
         RETURNING *`,
        [post.title, post.content, post.summary, post.publishedAt, `%${markerNew}%`, `%${markerLegacy}%`]
      );
      if (updExisting.rowCount > 0) {
        updated += updExisting.rowCount;
        try {
          for (const row of updExisting.rows) {
            io.emit('news:changed', { action: 'update', news: row });
          }
        } catch (_) {}
        continue;
      }

      const ins = await query(
        `INSERT INTO news (title, content, summary, published_at, author_id)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (SELECT 1 FROM news WHERE content LIKE $6 OR content LIKE $7)
         RETURNING *`,
        [post.title, post.content, post.summary, post.publishedAt, authorId, `%${markerNew}%`, `%${markerLegacy}%`]
      );
      if (ins.rowCount > 0) {
        inserted += 1;
        try {
          io.emit('news:changed', { action: 'create', news: ins.rows[0] });
        } catch (_) {}
      }
    }

    await writeDiscordNewsSetting(DISCORD_NEWS_LAST_SYNC_KEY, new Date().toISOString());
    return {
      success: true,
      inserted,
      updated,
      checked: parsed.length,
      channel,
      channelInput: cfg.channel || '',
      authMode,
    };
  } catch (e) {
    const status = Number(e?.response?.status) || null;
    const apiBody = e?.response?.data;
    const apiMessage =
      (typeof apiBody?.message === 'string' && apiBody.message) ||
      (typeof apiBody?.error === 'string' && apiBody.error) ||
      e?.message ||
      'sync_failed';
    console.error('Discord news sync failed:', status || '', apiMessage);
    if (status === 401) {
      if (authMode === 'oauth') {
        try {
          await clearDiscordNewsOauthSettings();
        } catch (_) {}
        return { success: false, error: 'discord_oauth_channel_read_denied' };
      }
      return { success: false, error: 'discord_api_invalid_token' };
    }
    if (status === 403) {
      return { success: false, error: 'discord_api_missing_access' };
    }
    return { success: false, error: apiMessage || 'sync_failed' };
  } finally {
    discordNewsSyncInProgress = false;
  }
}

async function loadDirectoriesFromDb() {
  const productTypes = await (async () => {
    try {
      const r = await query('SELECT name FROM product_types ORDER BY name');
      return r.rows.map((x) => x.name);
    } catch {
      return [];
    }
  })();

  const showcaseStatuses = await (async () => {
    try {
      const r = await query('SELECT name FROM showcase_statuses ORDER BY name');
      return r.rows.map((x) => x.name);
    } catch {
      return [];
    }
  })();

  const warehouseTypes = await (async () => {
    try {
      const r = await query('SELECT name FROM warehouse_types ORDER BY name');
      return r.rows.map((x) => x.name);
    } catch {
      return [];
    }
  })();

  const productNames = await (async () => {
    try {
      const r = await query(
        `SELECT name, type, uex_id, uex_type, uex_section, uex_category_id,
                uex_category, uex_subcategory
         FROM product_names
         ORDER BY name`
      );
      return r.rows.map((x) => ({
        name: x.name,
        type: x.type || null,
        uexType: x.uex_type || null,
        section: x.uex_section || null,
        uexCategoryId: x.uex_category_id || null,
        uexCategory: x.uex_category || null,
        uexSubcategory: x.uex_subcategory || null,
        isUex: !!x.uex_id,
      }));
    } catch {
      try {
        const r = await query('SELECT name, type FROM product_names ORDER BY name');
        return r.rows.map((x) => ({
          name: x.name,
          type: x.type || null,
          uexType: null,
          section: null,
          uexCategoryId: null,
          uexCategory: null,
          uexSubcategory: null,
          isUex: false,
        }));
      } catch {
        return [];
      }
    }
  })();

  const categories = await (async () => {
    try {
      const fromNames = (
        await query(
          `SELECT DISTINCT uex_category_id, uex_category, uex_section
           FROM product_names
           WHERE uex_category_id IS NOT NULL OR uex_category IS NOT NULL`
        )
      ).rows.map((x) => ({
        id: x.uex_category_id || null,
        name: x.uex_category || null,
        section: x.uex_section || null,
      }));

      const fromTypes = (
        await query(`SELECT name, uex_category FROM product_types WHERE name IS NOT NULL`)
      ).rows.map((x) => ({
        id: null,
        name: x.name || null,
        section: x.uex_category || null,
      }));

      const all = [...fromNames, ...fromTypes];
      const seen = new Set();
      const result = [];
      for (const c of all) {
        const key = `${c.name || ''}__${c.section || ''}`;
        if (!c.name && !c.id) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(c);
      }
      return result;
    } catch {
      return [];
    }
  })();

  const accountTypes = [];
  try {
    const at = await query('SELECT name FROM account_types ORDER BY name');
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
      accountTypes.push({ name: row.name, permissions: permObj, allowedWarehouseTypes });
    }
  } catch (_) {}

  const uexSync = await (async () => {
    try {
      const r = await query(
        'SELECT resource, last_sync_at, last_uex_marker, meta FROM uex_sync_state ORDER BY last_sync_at DESC'
      );
      return r.rows;
    } catch {
      return [];
    }
  })();

  return {
    productTypes,
    showcaseStatuses,
    warehouseTypes,
    productNames,
    categories,
    accountTypes,
    uex_sync: uexSync,
  };
}

const app = express();
// behind reverse proxy (Caddy/Nginx) trust X-Forwarded-* to correctly detect https and client IP
app.set('trust proxy', 1);
const server = http.createServer(app);
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
  const isMutationMethod = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
  if (!isMutationMethod || !req.path.startsWith('/api/')) return next();

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
let appDataCache = null;
const invalidateAppDataCache = () => {
  try {
    appDataCache?.clear?.();
  } catch (_) {}
};
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

// CORS configuration (apply only to API/auth/public/health, not to static assets)
// Dev: разрешаем любые Origin. Prod: ограничиваем до FRONTEND_URL
const isProd = process.env.NODE_ENV === 'production';
let strictOrigin;
if (SERVER_CONFIG.FRONTEND_URL && SERVER_CONFIG.FRONTEND_URL !== '*') {
  try {
    // cors ожидает origin (scheme://host[:port]) без path
    strictOrigin = new URL(String(SERVER_CONFIG.FRONTEND_URL)).origin;
  } catch (_) {
    strictOrigin = SERVER_CONFIG.FRONTEND_URL;
  }
}
const corsOptions = {
  origin: isProd && strictOrigin ? strictOrigin : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['x-auth-token'],
};
app.use('/api', cors(corsOptions));
app.use('/auth', cors(corsOptions));
app.use('/public', cors(corsOptions));
app.use('/health', cors(corsOptions));

// ---- UEX API proxy and sync ----
// Base docs: https://uexcorp.space/api/documentation/
// Public base URL (same as in frontend): https://api.uexcorp.uk/2.0
const UEX_BASE_URL = (process.env.UEX_API_BASE_URL || 'https://api.uexcorp.space/2.0').replace(/\/$/, '');
const UEX_COMPANY_ID = process.env.UEX_COMPANY_ID || process.env.VITE_UEX_COMPANY_ID || null;
const UEX_AXIOS_TIMEOUT_MS = Number(process.env.UEX_AXIOS_TIMEOUT_MS || 120000);

function buildUexUrl(resource = '', pathPart = '', params = {}) {
  const base = (UEX_BASE_URL || '').replace(/\/$/, '');
  const res = String(resource || '').replace(/^\//, '').replace(/\/$/, '');
  const p = String(pathPart || '').replace(/^\//, '');
  const url = p ? `${base}/${res}/${p}` : `${base}/${res}`;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v.forEach((vv) => usp.append(k, String(vv)));
    else usp.append(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${url}?${qs}` : url;
}

// Simple GET proxy used by frontend UEX tool (uexApiService.js in proxy mode)
app.get('/api/uex', authenticateToken, async (req, res) => {
  try {
    const { resource, path: p, ...rest } = req.query || {};
    const resourceStr = String(resource || '').trim();
    if (!resourceStr) return res.status(400).json({ error: 'resource is required' });
    const url = buildUexUrl(resourceStr, p || '', rest);

    const token = req.headers['x-uex-token'] || process.env.UEX_API_TOKEN || process.env.VITE_UEX_API_TOKEN;
    const clientVersion = req.headers['x-uex-client-version'] || process.env.UEX_CLIENT_VERSION || process.env.VITE_UEX_CLIENT_VERSION;

    const baseHeaders = {
      Accept: 'application/json',
      ...(clientVersion ? { 'X-Client-Version': String(clientVersion) } : {}),
    };

    const attempts = [];
    if (token) {
      const t = String(token).trim();
      attempts.push({ ...baseHeaders, Authorization: `Bearer ${t}`, 'X-API-Key': t });
      attempts.push({ ...baseHeaders, 'X-API-Key': t });
      attempts.push({ ...baseHeaders, Authorization: `Token ${t}` });
    } else {
      attempts.push(baseHeaders);
    }

    let lastErr;
    for (const h of attempts) {
      try {
        const resp = await axios.get(url, { headers: h, timeout: UEX_AXIOS_TIMEOUT_MS });
        return res.status(resp.status).json(resp.data);
      } catch (e) {
        const status = e?.response?.status;
        if (status === 401 || status === 403) {
          lastErr = e;
          continue;
        }
        const body = e?.response?.data;
        return res.status(status || 500).json({ error: 'UEX proxy error', status, body });
      }
    }
    if (lastErr) {
      const status = lastErr?.response?.status || 401;
      const body = lastErr?.response?.data;
      return res.status(status).json({ error: 'UEX authorization failed', status, body });
    }
    return res.status(500).json({ error: 'UEX proxy failed' });
  } catch (e) {
    console.error('GET /api/uex error:', e);
    res.status(500).json({ error: 'Ошибка прокси UEX' });
  }
});

// Helper: upsert product_types and product_names from UEX payloads
// Новая структура номенклатуры: type/section/id_category/name
// uex_type: 'item' | 'service'
async function upsertUexDirectories({ categories, items }) {
  let productTypesCreated = 0;
  let productTypesUpdated = 0;
  let productNamesCreated = 0;
  let productNamesUpdated = 0;

  // Полное обновление UEX-данных:
  // перед обработкой свежего payload очищаем UEX-поля у ранее импортированных записей,
  // НО только если реально пришёл непустой список items. Если UEX вернул 0 позиций,
  // оставляем старые данные, чтобы не потерять существующую номенклатуру.
  if (Array.isArray(items) && items.length > 0) {
    try {
      // product_types: только UEX-секция (name остаётся — это локальный ключ типа)
      await query('UPDATE product_types SET uex_category = NULL');

      // product_names: только те записи, у которых есть признаки UEX-происхождения
      await query(
        `UPDATE product_names
         SET type = NULL,
             uex_id = NULL,
             uex_type = NULL,
             uex_section = NULL,
             uex_category_id = NULL,
             uex_category = NULL,
             uex_subcategory = NULL,
             uex_meta = NULL
         WHERE uex_id IS NOT NULL
            OR uex_type IS NOT NULL
            OR uex_category_id IS NOT NULL
            OR uex_category IS NOT NULL`
      );
    } catch (e) {
      console.error('upsertUexDirectories: failed to reset previous UEX data:', e);
    }
  }

  // Categories -> product_types (section как name) и карта категорий
  const categoryById = new Map();
  if (Array.isArray(categories)) {
    for (const cat of categories) {
      const catId =
        cat?.id != null
          ? String(cat.id)
          : cat?.uuid != null
          ? String(cat.uuid)
          : cat?.category_id != null
          ? String(cat.category_id)
          : null;
      const catName = (cat?.name || cat?.title || '').toString().trim();
      const section = (cat?.section || cat?.category || cat?.slug || '').toString().trim() || null;

      if (catId) {
        categoryById.set(catId, { id: catId, name: catName, section, raw: cat });
      }

      // Тип товара строим по разделу UEX (section)
      const typeName = section || catName;
      if (!typeName) continue;

      const uexCategory = catName; // само название категории сохраняем в uex_category для справки
      const { rowCount } = await query('SELECT 1 FROM product_types WHERE name = $1', [typeName]);
      if (rowCount === 0) {
        await query(
          'INSERT INTO product_types(name, uex_category) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
          [typeName, uexCategory]
        );
        productTypesCreated += 1;
      } else {
        await query('UPDATE product_types SET uex_category = COALESCE($2, uex_category) WHERE name = $1', [
          typeName,
          uexCategory,
        ]);
        productTypesUpdated += 1;
      }
    }
  }

  // Items -> product_names с новой структурой
  if (Array.isArray(items)) {
    for (const it of items) {
      const name = (it?.name || it?.title || '').toString().trim();
      if (!name) continue;

      console.log('Processing UEX item:', name, 'id:', it?.id);

      const catIdRaw =
        it?.id_category != null
          ? String(it.id_category)
          : it?.category_id != null
          ? String(it.category_id)
          : it?.categoryId != null
          ? String(it.categoryId)
          : null;
      const category = catIdRaw ? categoryById.get(catIdRaw) : null;
      const section = category?.section || (it?.section || it?.category_section || null);
      const sectionLc = section ? section.toString().toLowerCase() : '';

      // Правило: категории раздела Services -> услуги, остальные -> товары
      const uexType = sectionLc && (sectionLc === 'services' || sectionLc === 'service') ? 'service' : 'item';

      // Тип товара для product_names.type должен соответствовать справочнику product_types.
      // Используем тот же раздел, что и при записи в product_types (section, либо имя категории).
      const productTypeName = section || category?.name || null;

      const uexId = it?.id != null ? String(it.id) : it?.uuid != null ? String(it.uuid) : null;
      const uexCategoryId = catIdRaw;
      const uexCategory =
        category?.name ||
        (typeof it?.category === 'string' && it.category.trim() !== '' ? it.category.trim() : null) ||
        (typeof it?.category_name === 'string' && it.category_name.trim() !== '' ? it.category_name.trim() : null);
      const uexSubcategory = null;
      const meta = {
        uexId,
        uexType,
        uexSection: section,
        uexCategoryId,
        uexCategoryName: uexCategory,
        raw: it,
      };

      const existing = await query('SELECT name FROM product_names WHERE name = $1', [name]);
      if (existing.rowCount === 0) {
        await query(
          `INSERT INTO product_names(name, type, uex_id, uex_type, uex_section, uex_category_id, uex_category, uex_subcategory, uex_meta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (name) DO UPDATE SET
             type = EXCLUDED.type,
             uex_id = EXCLUDED.uex_id,
             uex_type = EXCLUDED.uex_type,
             uex_section = EXCLUDED.uex_section,
             uex_category_id = EXCLUDED.uex_category_id,
             uex_category = EXCLUDED.uex_category,
             uex_subcategory = EXCLUDED.uex_subcategory,
             uex_meta = EXCLUDED.uex_meta`,
          [
            name,
            productTypeName,
            uexId,
            uexType,
            section,
            uexCategoryId,
            uexCategory,
            uexSubcategory,
            meta,
          ]
        );
        productNamesCreated += 1;
      } else {
        await query(
          `UPDATE product_names
           SET type = COALESCE($2, type),
               uex_id = COALESCE($3, uex_id),
               uex_type = COALESCE($4, uex_type),
               uex_section = COALESCE($5, uex_section),
               uex_category_id = COALESCE($6, uex_category_id),
               uex_category = COALESCE($7, uex_category),
               uex_subcategory = COALESCE($8, uex_subcategory),
               uex_meta = $9
           WHERE name = $1`,
          [
            name,
            productTypeName,
            uexId,
            uexType,
            section,
            uexCategoryId,
            uexCategory,
            uexSubcategory,
            meta,
          ]
        );
        productNamesUpdated += 1;
      }
    }
  }

  return { productTypesCreated, productTypesUpdated, productNamesCreated, productNamesUpdated };
}

// Test endpoint for debugging
app.post('/api/uex/test', authenticateToken, requirePermission('directories', 'write'), async (req, res) => {
  console.log('[TEST] UEX test endpoint reached!');
  res.json({ success: true, message: 'Test endpoint working' });
});

// Proxy UEX sync requests to uex-service
app.post('/api/uex/sync-directories', authenticateToken, requirePermission('directories', 'write'), async (req, res) => {
  try {
    const uexServiceUrl = `http://uex-service:3007/api/uex/sync-directories`;
    const response = await axios.post(uexServiceUrl, req.body, {
      headers: {
        'Content-Type': 'application/json',
        ...(req.headers['x-uex-token'] ? { 'x-uex-token': req.headers['x-uex-token'] } : {}),
        ...(req.headers['x-uex-client-version'] ? { 'x-uex-client-version': req.headers['x-uex-client-version'] } : {}),
      },
      timeout: 10 * 60 * 1000, // 10 минут
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: 'Ошибка синхронизации UEX' });
  }
});

// Body parsers should be BEFORE routes so early-declared routes see req.body
// Note: base64 increases size by ~33%, so allow headroom for 15MB files
app.use(express.json({ limit: '32mb' }));
app.use(express.urlencoded({ extended: true, limit: '32mb' }));
app.use(duplicateMutationGuard);

// Request logging (after parsers so we can log body for POST/PUT)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  if ((req.method === 'POST' || req.method === 'PUT') && req.body !== undefined) {
    console.log('Request body:', req.body);
  }
  // Special logging for UEX sync
  if (req.url.includes('/api/uex')) {
    console.log('[UEX] Request detected:', req.method, req.url);
  }
  if (req.url === '/api/uex/sync-directories' && req.method === 'POST') {
    console.log('[UEX SYNC] Request detected!');
  }
  next();
});

// Ensure /api/data returns fresh state right after successful write operations.
app.use((req, res, next) => {
  const isMutationMethod = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
  const isApiRoute = req.path.startsWith('/api/');

  if (!isMutationMethod || !isApiRoute) {
    return next();
  }

  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      invalidateAppDataCache();
    }
  });

  next();
});

// ---- Auth page background (public GET, admin PUT/DELETE) ----
// Storage path: backend/public/auth-bg.<ext>
const AUTH_BG_NAME = 'auth-bg';
const AUTH_ICON_NAME = 'auth-icon';
const SYSTEM_FAVICON_NAME = 'system-favicon';
const BRANDING_TITLE_KEY = 'system.appTitle';
const DEFAULT_APP_TITLE = 'BLSK Star Finance';
const AUTH_PUBLIC_DIR = path.join(__dirname, 'public');
async function getAuthBgFile() {
  try {
    const files = await fs.readdir(AUTH_PUBLIC_DIR).catch(() => []);
    const byName = new Map(files.map((n) => [n.toLowerCase(), n]));
    // Deterministic priority to avoid picking legacy placeholders first.
    const preferred = ['auth-bg.webp', 'auth-bg.png', 'auth-bg.svg'];
    for (const name of preferred) {
      const actual = byName.get(name);
      if (actual) return path.join(AUTH_PUBLIC_DIR, actual);
    }
    return null;
  } catch (_) { return null; }
}
async function getAuthIconFile() {
  try {
    const files = await fs.readdir(AUTH_PUBLIC_DIR).catch(() => []);
    const byName = new Map(files.map((n) => [n.toLowerCase(), n]));
    // Deterministic priority to avoid picking legacy placeholders first.
    const preferred = ['auth-icon.webp', 'auth-icon.png', 'auth-icon.svg'];
    for (const name of preferred) {
      const actual = byName.get(name);
      if (actual) return path.join(AUTH_PUBLIC_DIR, actual);
    }
    return null;
  } catch (_) { return null; }
}

async function getSystemFaviconFile() {
  try {
    const files = await fs.readdir(AUTH_PUBLIC_DIR).catch(() => []);
    const byName = new Map(files.map((n) => [n.toLowerCase(), n]));
    const preferred = ['system-favicon.webp', 'system-favicon.png', 'system-favicon.svg'];
    for (const name of preferred) {
      const actual = byName.get(name);
      if (actual) return path.join(AUTH_PUBLIC_DIR, actual);
    }
    return null;
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
    const bp = detectPublicBasePath();
    const rel = `/public/auth/background/file/${encodeURIComponent(fileName)}`;
    return res.json({ url: `${bp}${rel}`, updatedAt: stat ? stat.mtimeMs : null });
  } catch (e) {
    return res.json({ url: null, updatedAt: null });
  }
});

// Public metadata endpoint for auth icon
app.get('/public/auth/icon', async (req, res) => {
  try {
    const filePath = await getAuthIconFile();
    if (!filePath) return res.json({ url: null, updatedAt: null });
    const stat = await fs.stat(filePath).catch(() => null);
    const fileName = path.basename(filePath);
    const bp = detectPublicBasePath();
    const rel = `/public/auth/icon/file/${encodeURIComponent(fileName)}`;
    return res.json({ url: `${bp}${rel}`, updatedAt: stat ? stat.mtimeMs : null });
  } catch (e) {
    return res.json({ url: null, updatedAt: null });
  }
});

app.get('/public/system/branding', async (req, res) => {
  try {
    const settingsMap = await readSettingsMap();
    const rawTitle = settingsMap[BRANDING_TITLE_KEY] ?? DEFAULT_APP_TITLE;
    const appTitle = String(rawTitle || DEFAULT_APP_TITLE).trim() || DEFAULT_APP_TITLE;
    const filePath = await getSystemFaviconFile();
    if (!filePath) return res.json({ appTitle, faviconUrl: null, updatedAt: null });
    const stat = await fs.stat(filePath).catch(() => null);
    const fileName = path.basename(filePath);
    const bp = detectPublicBasePath();
    const rel = `/public/system/favicon/file/${encodeURIComponent(fileName)}`;
    return res.json({ appTitle, faviconUrl: `${bp}${rel}`, updatedAt: stat ? stat.mtimeMs : null });
  } catch (e) {
    return res.json({ appTitle: DEFAULT_APP_TITLE, faviconUrl: null, updatedAt: null });
  }
});

// Public file sender
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

// Public file sender for auth icon
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
    const settingsMap = await readSettingsMap();
    const rawTitle = settingsMap[BRANDING_TITLE_KEY] ?? DEFAULT_APP_TITLE;
    const appTitle = String(rawTitle || DEFAULT_APP_TITLE).trim() || DEFAULT_APP_TITLE;
    const filePath = await getSystemFaviconFile();
    const bp = detectPublicBasePath();
    const faviconUrl = filePath
      ? `${bp}/public/system/favicon/file/${encodeURIComponent(path.basename(filePath))}`
      : null;
    return res.json({ appTitle, faviconUrl });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка чтения брендирования' });
  }
});

app.put('/api/system/branding', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const appTitle = String(req.body?.appTitle || '').trim();
    if (!appTitle) return res.status(400).json({ error: 'Название приложения не может быть пустым' });
    if (appTitle.length > 80) return res.status(400).json({ error: 'Название приложения слишком длинное (максимум 80)' });
    await query(
      `INSERT INTO settings(key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [BRANDING_TITLE_KEY, JSON.stringify(appTitle)]
    );
    return res.json({ success: true, appTitle });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка сохранения названия приложения' });
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
    const bp = detectPublicBasePath();
    const rel = `/public/system/favicon/file/${SYSTEM_FAVICON_NAME}.${ext}`;
    return res.json({ success: true, faviconUrl: `${bp}${rel}` });
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
    const header = dataUrl.slice(0, headerEnd); // e.g., data:image/svg;base64
    const b64 = dataUrl.slice(headerEnd + 1);
    const mimeMatch = header.match(/^data:image\/([^;]+)(;.*)?;base64$/i);
    if (!mimeMatch) return res.status(400).json({ error: 'Неверный заголовок data URL (нет ;base64)' });
    const subtype = String(mimeMatch[1] || '').toLowerCase();
    // Handle svg+xml case - extract base type before +
    const baseType = subtype.includes('+') ? subtype.split('+')[0] : subtype;
    // Normalize svg aliases
    let ext;
    if (baseType === 'png') ext = 'png';
    else if (baseType === 'webp') ext = 'webp';
    else if (baseType === 'svg' || subtype === 'svg+xml' || baseType === 'jpg' || baseType === 'psvg' || baseType === 'jfif') ext = 'svg';
    else return res.status(400).json({ error: 'Поддерживаются PNG/svg/WebP (base64)' });
    // Size limit ~15 MB (15000 KB)
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 15000 * 1024) return res.status(413).json({ error: 'Размер изображения превышает 15MB' });
    // Ensure dir
    await fs.mkdir(AUTH_PUBLIC_DIR, { recursive: true }).catch(() => {});
    // Remove previous variants
    try {
      for (const e of ['png','svg','webp']) {
        const p = path.join(AUTH_PUBLIC_DIR, `${AUTH_BG_NAME}.${e}`);
        await fs.unlink(p).catch(() => {});
      }
    } catch (_) {}
    const target = path.join(AUTH_PUBLIC_DIR, `${AUTH_BG_NAME}.${ext}`);
    await fs.writeFile(target, buf);
    const bp = detectPublicBasePath();
    const rel = `/public/auth/background/file/${AUTH_BG_NAME}.${ext}`;
    return res.json({ success: true, url: `${bp}${rel}` });
  } catch (e) {
    console.error('PUT /api/system/auth/background error:', e);
    return res.status(500).json({ error: 'Ошибка сохранения фона' });
  }
});

// Admin: delete background
app.delete('/api/system/auth/background', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    for (const e of ['png','svg','webp']) {
      const p = path.join(AUTH_PUBLIC_DIR, `${AUTH_BG_NAME}.${e}`);
      await fs.unlink(p).catch(() => {});
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка удаления фона' });
  }
});

// Admin: set icon. Body: { dataUrl: 'data:image/png;base64,...' }
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
    // Handle svg+xml case - extract base type before +
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
      for (const e of ['png','svg','webp']) {
        const p = path.join(AUTH_PUBLIC_DIR, `${AUTH_ICON_NAME}.${e}`);
        await fs.unlink(p).catch(() => {});
      }
    } catch (_) {}
    const target = path.join(AUTH_PUBLIC_DIR, `${AUTH_ICON_NAME}.${ext}`);
    await fs.writeFile(target, buf);
    const bp = detectPublicBasePath();
    const rel = `/public/auth/icon/file/${AUTH_ICON_NAME}.${ext}`;
    return res.json({ success: true, url: `${bp}${rel}` });
  } catch (e) {
    console.error('PUT /api/system/auth/icon error:', e);
    return res.status(500).json({ error: 'Ошибка сохранения иконки' });
  }
});

// Admin: delete icon
app.delete('/api/system/auth/icon', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    for (const e of ['png','svg','webp']) {
      const p = path.join(AUTH_PUBLIC_DIR, `${AUTH_ICON_NAME}.${e}`);
      await fs.unlink(p).catch(() => {});
    }
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка удаления иконки' });
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
    const w = (await query('SELECT id, owner_login, cost, currency, name FROM warehouse_items WHERE id = $1', [r.warehouse_item_id])).rows[0];
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
      [tid, amount, currency, fromId, toId, r.warehouse_item_id, JSON.stringify({ reqId: id, itemName: w.name })]
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
      const TECHNICAL_DELETED_USER_ID = 'deleted_user';
      const TECHNICAL_DELETED_USERNAME = 'deleted_user';
      await query('BEGIN');

      const source = await query('SELECT id, username FROM users WHERE id = $1 FOR UPDATE', [id]);
      if (source.rowCount === 0) {
        await query('ROLLBACK');
        return res.status(404).json({ error: 'Пользователь не найден' });
      }

      const sourceUser = source.rows[0];
      if (sourceUser.id === TECHNICAL_DELETED_USER_ID) {
        await query('ROLLBACK');
        return res.status(400).json({ error: 'Технического пользователя удалить нельзя' });
      }

      const passwordHash = crypto
        .createHash('sha256')
        .update(`deleted:${TECHNICAL_DELETED_USER_ID}`)
        .digest('hex');

      await query(
        `INSERT INTO users (id, username, email, auth_type, password_hash, account_type, is_active, created_at)
         VALUES ($1, $2, NULL, 'local', $3, 'Гость', FALSE, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [TECHNICAL_DELETED_USER_ID, TECHNICAL_DELETED_USERNAME, passwordHash]
      );

      await query('UPDATE transactions SET from_user = $1 WHERE from_user = $2', [
        TECHNICAL_DELETED_USER_ID,
        sourceUser.id,
      ]);
      await query('UPDATE transactions SET to_user = $1 WHERE to_user = $2', [
        TECHNICAL_DELETED_USER_ID,
        sourceUser.id,
      ]);
      await query(
        'UPDATE purchase_requests SET buyer_user_id = $1, buyer_username = $2 WHERE buyer_user_id = $3',
        [TECHNICAL_DELETED_USER_ID, TECHNICAL_DELETED_USERNAME, sourceUser.id]
      );
      await query('UPDATE purchase_request_logs SET actor_user_id = $1 WHERE actor_user_id = $2', [
        TECHNICAL_DELETED_USER_ID,
        sourceUser.id,
      ]);
      await query('UPDATE finance_requests SET from_user = $1 WHERE from_user = $2', [
        TECHNICAL_DELETED_USER_ID,
        sourceUser.id,
      ]);
      await query('UPDATE finance_requests SET to_user = $1 WHERE to_user = $2', [
        TECHNICAL_DELETED_USER_ID,
        sourceUser.id,
      ]);
      await query('UPDATE news SET author_id = $1 WHERE author_id = $2', [
        TECHNICAL_DELETED_USER_ID,
        sourceUser.id,
      ]);
      await query('UPDATE news_reads SET user_id = $1 WHERE user_id = $2', [
        TECHNICAL_DELETED_USER_ID,
        sourceUser.id,
      ]);
      await query('UPDATE warehouse_items SET owner_login = $1 WHERE owner_login = $2', [
        TECHNICAL_DELETED_USERNAME,
        sourceUser.username,
      ]);

      await query('DELETE FROM users WHERE id = $1', [sourceUser.id]);
      await query('COMMIT');
      res.json({ success: true, reassignedTo: TECHNICAL_DELETED_USER_ID });
    } catch (error) {
      try {
        await query('ROLLBACK');
      } catch (_) {}
      console.error('DELETE /api/users/:id error:', error);
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
      const meRes = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (meRes.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = meRes.rows[0];

      // Получим список разрешенных типов склада для текущего типа учетной записи
      let allowedTypes = null;
      try {
        const accType = me.account_type || null;
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
          'SELECT id, name, type, quantity, cost, currency, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items WHERE owner_login = $2 AND warehouse_type = ANY($1) ORDER BY created_at DESC',
          [allowedTypes, me.username]
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
      const { id, name, type, quantity, price, currency, displayCurrencies, meta, warehouseType, ownerLogin } =
        req.body || {};
      if (!name) return res.status(400).json({ error: 'Название обязательно' });
      const newId = id || `w_${Date.now()}`;
      // Определяем текущего пользователя и его права
      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];

      // Protect from duplicate insertions when creating a new item.
      if (!id) {
        const duplicate = await query(
          `SELECT id
             FROM warehouse_items
            WHERE owner_login = $1
              AND lower(btrim(name)) = lower(btrim($2))
              AND COALESCE(type, '') = COALESCE($3, '')
              AND COALESCE(warehouse_type, '') = COALESCE($4, '')
            LIMIT 1`,
          [me.username, String(name || ''), type || '', warehouseType || '']
        );

        if (duplicate.rowCount > 0) {
          return res.status(409).json({
            error: 'Товар уже существует. Дубликаты запрещены.',
            existingItemId: duplicate.rows[0].id,
          });
        }
      }

      const existing = await query('SELECT id, owner_login FROM warehouse_items WHERE id = $1', [newId]);
      if (existing.rowCount > 0) {
        const isOwner = existing.rows[0]?.owner_login && existing.rows[0].owner_login === me.username;
        if (!isOwner) {
          return res.status(403).json({ error: 'Недостаточно прав для обновления товара' });
        }
      }
      const effectiveOwnerLogin = me.username;
      if (type)
        await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
          type,
        ]);
      if (warehouseType)
        await query('INSERT INTO warehouse_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
          warehouseType,
        ]);
      const effCurrency = currency || (Array.isArray(displayCurrencies) && displayCurrencies.length > 0 ? displayCurrencies[0] : null);
      await query(
        `INSERT INTO warehouse_items(id, name, type, quantity, cost, currency, display_currencies, meta, warehouse_type, owner_login, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, quantity = EXCLUDED.quantity, cost = EXCLUDED.cost,
         currency = COALESCE($6, warehouse_items.currency), display_currencies = COALESCE($7, warehouse_items.display_currencies), meta = EXCLUDED.meta, warehouse_type = EXCLUDED.warehouse_type, owner_login = EXCLUDED.owner_login, updated_at = now()`,
        [
          newId,
          name,
          type || null,
          Number(quantity) || 0,
          price !== undefined ? Number(price) : null,
          effCurrency || null,
          displayCurrencies || null,
          meta ? JSON.stringify(meta) : null,
          warehouseType || null,
          effectiveOwnerLogin || null,
        ]
      );
      const row = (
        await query(
          'SELECT id, name, type, quantity, cost, currency, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items WHERE id = $1',
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
      const { name, type, quantity, price, currency, displayCurrencies, meta, warehouseType, ownerLogin } =
        req.body || {};
      const exists = await query('SELECT 1 FROM warehouse_items WHERE id = $1', [id]);
      if (exists.rowCount === 0) return res.status(404).json({ error: 'Позиция не найдена' });
      // Allow update only for admin or owner of item
      try {
        const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
        if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
        const me = ures.rows[0];
        const itemRes = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [id]);
        const isOwner = itemRes.rows[0]?.owner_login && itemRes.rows[0].owner_login === me.username;
        if (!isOwner) {
          return res.status(403).json({ error: 'Недостаточно прав для редактирования товара' });
        }
        var effectiveOwnerLogin = me.username;
      } catch (_) {
        // if check fails unexpectedly, forbid
        return res.status(403).json({ error: 'Недостаточно прав' });
      }
      if (type)
        await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
          type,
        ]);
      if (warehouseType)
        await query('INSERT INTO warehouse_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
          warehouseType,
        ]);
      const effCurrencyUpdate = currency || (Array.isArray(displayCurrencies) && displayCurrencies.length > 0 ? displayCurrencies[0] : null);
      await query(
        `UPDATE warehouse_items SET name = COALESCE($2,name), type = COALESCE($3,type), quantity = COALESCE($4,quantity), cost = $5,
        currency = COALESCE($6,currency), display_currencies = COALESCE($7, display_currencies), meta = $8, warehouse_type = COALESCE($9, warehouse_type), owner_login = COALESCE($10, owner_login), updated_at = now() WHERE id = $1`,
        [
          id,
          name || null,
          type || null,
          quantity !== undefined ? Number(quantity) : null,
          price !== undefined ? Number(price) : null,
          effCurrencyUpdate || null,
          displayCurrencies || null,
          meta ? JSON.stringify(meta) : null,
          warehouseType || null,
          effectiveOwnerLogin || null,
        ]
      );
      const row = (
        await query(
          'SELECT id, name, type, quantity, cost, currency, display_currencies, meta, warehouse_type, owner_login, created_at, updated_at FROM warehouse_items WHERE id = $1',
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
    const isOwner = itemRes.rows[0].owner_login && itemRes.rows[0].owner_login === me.username;
    if (!isOwner) {
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
      const isOwner = item.owner_login && item.owner_login === me.username;
      if (!isOwner) {
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
      let newId = id || null;
      // Проверка: только админ или владелец связанного товарa может создавать/обновлять запись витрины
      const ures = await query('SELECT id, username, account_type FROM users WHERE id = $1', [req.user.id]);
      if (ures.rowCount === 0) return res.status(401).json({ error: 'Нет пользователя' });
      const me = ures.rows[0];
      if (warehouseItemId) {
        const w = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [warehouseItemId]);
        if (w.rowCount === 0) return res.status(400).json({ error: 'Связанный товар не найден' });
        const isOwner = w.rows[0]?.owner_login && w.rows[0].owner_login === me.username;
        if (!isOwner) return res.status(403).json({ error: 'Недостаточно прав для размещения товара на витрине' });
      } else {
        return res.status(400).json({ error: 'warehouseItemId обязателен' });
      }

      // Idempotency: если id не задан, то для одного товара используем уже существующую запись витрины
      // и чистим возможные дубли (оставляем самую свежую)
      if (!newId) {
        const existing = await query(
          'SELECT id FROM showcase_items WHERE warehouse_item_id = $1 ORDER BY created_at DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT 1',
          [warehouseItemId]
        );
        const existingId = existing.rows[0]?.id || null;
        if (existingId) {
          newId = existingId;
          await query(
            'DELETE FROM showcase_items WHERE warehouse_item_id = $1 AND id <> $2',
            [warehouseItemId, existingId]
          );
        } else {
          newId = `s_${Date.now()}`;
        }
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
          warehouseItemId,
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
      const current = await query('SELECT warehouse_item_id FROM showcase_items WHERE id = $1', [id]);
      const targetWid = warehouseItemId || current.rows[0]?.warehouse_item_id || null;
      if (targetWid) {
        const w = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [targetWid]);
        if (w.rowCount === 0) return res.status(400).json({ error: 'Связанный товар не найден' });
        const isOwner = w.rows[0]?.owner_login && w.rows[0].owner_login === me.username;
        if (!isOwner) return res.status(403).json({ error: 'Недостаточно прав для изменения позиции витрины' });
      } else {
        return res.status(400).json({ error: 'warehouseItemId обязателен' });
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
      const cur = await query('SELECT warehouse_item_id FROM showcase_items WHERE id = $1', [id]);
      if (cur.rowCount === 0) return res.status(404).json({ error: 'Позиция не найдена' });
      const wid = cur.rows[0]?.warehouse_item_id || null;
      if (wid) {
        const w = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [wid]);
        const isOwner = w.rows[0]?.owner_login && w.rows[0].owner_login === me.username;
        if (!isOwner) return res.status(403).json({ error: 'Недостаточно прав для удаления позиции витрины' });
      } else {
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
      const w = await query('SELECT owner_login FROM warehouse_items WHERE id = $1', [wid]);
      if (w.rowCount === 0) return res.status(404).json({ error: 'Товар не найден' });
      const isOwner = w.rows[0]?.owner_login && w.rows[0].owner_login === me.username;
      if (!isOwner) return res.status(403).json({ error: 'Недостаточно прав для очистки витрины по товару' });
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

// ---------- News CRUD ----------
app.get('/api/system/telegram-news', authenticateToken, requirePermission('settings', 'read'), async (req, res) => {
  try {
    const cfg = await readTelegramNewsSettingsDb();
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения настроек Telegram-новостей' });
  }
});

app.get('/api/system/discord-news', authenticateToken, requirePermission('settings', 'read'), async (req, res) => {
  try {
    const cfg = await readDiscordNewsSettingsDb();
    res.json(cfg);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка чтения настроек Discord-новостей' });
  }
});

app.put('/api/system/discord-news', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    const channelInput = String(req.body?.channel || '').trim();
    const botTokenInput = req.body?.botToken;
    const hasBotTokenInput = typeof botTokenInput === 'string';
    const botToken = hasBotTokenInput ? String(botTokenInput || '').trim() : '';
    const parsedChannel = channelInput ? parseDiscordChannelReference(channelInput) : null;
    if (channelInput && !parsedChannel?.channelId) {
      return res.status(400).json({
        error: 'Некорректный адрес канала Discord',
        details: 'invalid_channel_reference',
      });
    }
    const channel = parsedChannel?.channelId || '';
    const syncMinutes = Math.max(
      1,
      Math.min(360, Number(req.body?.syncMinutes) || DEFAULT_DISCORD_NEWS_SYNC_MINUTES)
    );
    await writeDiscordNewsSetting(DISCORD_NEWS_ENABLED_KEY, enabled);
    await writeDiscordNewsSetting(DISCORD_NEWS_CHANNEL_KEY, channelInput || null);
    await writeDiscordNewsSetting(DISCORD_NEWS_CHANNEL_INPUT_KEY, channelInput || channel || null);
    if (hasBotTokenInput && botToken) {
      await writeDiscordNewsSetting(DISCORD_NEWS_BOT_TOKEN_KEY, botToken);
    }
    await writeDiscordNewsSetting(DISCORD_NEWS_SYNC_MINUTES_KEY, syncMinutes);
    const cfg = await readDiscordNewsSettingsDb();
    res.json({ success: true, ...cfg });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения настроек Discord-новостей' });
  }
});

app.put('/api/system/telegram-news', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const enabled = !!req.body?.enabled;
    const channel = normalizeTelegramChannel(req.body?.channel);
    const syncMinutes = Math.max(
      1,
      Math.min(360, Number(req.body?.syncMinutes) || DEFAULT_TELEGRAM_NEWS_SYNC_MINUTES)
    );
    await writeTelegramNewsSetting(TELEGRAM_NEWS_ENABLED_KEY, enabled);
    await writeTelegramNewsSetting(TELEGRAM_NEWS_CHANNEL_KEY, channel);
    await writeTelegramNewsSetting(TELEGRAM_NEWS_SYNC_MINUTES_KEY, syncMinutes);
    const cfg = await readTelegramNewsSettingsDb();
    res.json({ success: true, ...cfg });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения настроек Telegram-новостей' });
  }
});

app.post('/api/news/telegram/sync', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const result = await syncTelegramNews({ force: true });
    if (result?.success === false) {
      return res.status(500).json({ error: 'Ошибка синхронизации Telegram-новостей', details: result.error || null });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка синхронизации Telegram-новостей' });
  }
});

app.post('/api/news/discord/sync', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const result = await syncDiscordNews({ force: true });
    if (result?.success === false) {
      const details = result.error || null;
      let status = 500;
      if (details === 'channel_not_configured' || details === 'invalid_channel_reference') {
        status = 400;
      } else if (details === 'discord_auth_not_configured' || details === 'discord_bot_token_required') {
        status = 400;
      } else if (details === 'discord_api_invalid_token' || details === 'discord_oauth_channel_read_denied') {
        status = 401;
      } else if (details === 'discord_api_missing_access') {
        status = 403;
      }
      return res.status(status).json({ error: 'Ошибка синхронизации Discord-новостей', details });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({
      error: 'Ошибка синхронизации Discord-новостей',
      details: e?.message || 'internal_sync_error',
    });
  }
});

app.post('/api/news/discord/oauth/start', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    const eff = await readDiscordEffective();
    const clientId = eff.clientId || DISCORD_CONFIG.CLIENT_ID;
    const redirectUri = eff.redirectUri || DISCORD_CONFIG.REDIRECT_URI;
    if (!clientId || !redirectUri) {
      return res.status(400).json({
        error: 'Discord OAuth не настроен',
        details: 'missing_client_or_redirect_uri',
      });
    }

    const state = issueDiscordNewsOauthState(req.user?.id);
    const scopes = ['identify', 'guilds'];
    const url =
      `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      '&response_type=code' +
      `&scope=${encodeURIComponent(scopes.join(' '))}` +
      `&state=${encodeURIComponent(state)}` +
      '&prompt=consent';

    return res.json({ success: true, url, state });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка запуска OAuth Discord', details: e?.message || null });
  }
});

app.get('/api/news/discord/oauth/status', authenticateToken, requirePermission('settings', 'read'), async (req, res) => {
  try {
    const oauth = await readDiscordNewsOauthSettingsDb();
    const connected = !!String(oauth.accessToken || '').trim();
    return res.json({
      success: true,
      connected,
      expiresAt: oauth.expiresAt || null,
      scope: oauth.scope || '',
      tokenType: oauth.tokenType || '',
    });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка чтения статуса OAuth Discord', details: e?.message || null });
  }
});

app.delete('/api/news/discord/oauth/status', authenticateToken, requirePermission('settings', 'write'), async (req, res) => {
  try {
    await clearDiscordNewsOauthSettings();
    return res.json({ success: true, connected: false });
  } catch (e) {
    return res.status(500).json({ error: 'Ошибка отключения OAuth Discord', details: e?.message || null });
  }
});

// Get single news by ID
app.get('/api/news/:id', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const newsResult = await query(
      `SELECT n.*, 
              (SELECT COUNT(*) FROM news_reads WHERE news_id = n.id) as read_count
       FROM news n 
       WHERE n.id = $1`,
      [id]
    );

    if (newsResult.rows.length === 0) {
      return res.status(404).json({ error: 'Новость не найдена' });
    }

    const news = newsResult.rows[0];

    // Check if user has read this news
    const readResult = await query(
      'SELECT 1 FROM news_reads WHERE news_id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    res.json({
      ...news,
      readCount: parseInt(news.read_count) || 0,
      isRead: readResult.rows.length > 0,
      source: detectNewsSourceFromContent(news.content)
    });
  } catch (error) {
    console.error('GET /api/news/:id error:', error);
    res.status(500).json({ error: 'Ошибка загрузки новости' });
  }
});

// Get all news with pagination
app.get('/api/news', authenticateToken, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;
    const source = String(req.query.source || 'all').toLowerCase();

    let whereSql = '';
    let whereParams = [];
    if (source === 'telegram') {
      whereSql = 'WHERE n.content LIKE $1';
      whereParams = ['%telegram-source:%'];
    } else if (source === 'discord') {
      whereSql = 'WHERE n.content LIKE $1';
      whereParams = ['%discord-source:%'];
    } else if (source === 'local') {
      whereSql = 'WHERE n.content NOT LIKE $1 AND n.content NOT LIKE $2';
      whereParams = ['%telegram-source:%', '%discord-source:%'];
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM news n ${whereSql}`,
      whereParams
    );
    const total = parseInt(countResult.rows[0].total);

    // Get news list
    const dataParams = [...whereParams, limit, offset];
    const limitParamIdx = whereParams.length + 1;
    const offsetParamIdx = whereParams.length + 2;
    const newsResult = await query(
      `SELECT n.*, 
              (SELECT COUNT(*) FROM news_reads WHERE news_id = n.id) as read_count
       FROM news n 
       ${whereSql}
       ORDER BY n.published_at DESC 
       LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
      dataParams
    );

    const readNewsIds = new Set();
    try {
      const ids = newsResult.rows.map((n) => n.id).filter((x) => x !== null && x !== undefined);
      if (ids.length > 0) {
        const readRows = await query(
          'SELECT news_id FROM news_reads WHERE user_id = $1 AND news_id = ANY($2)',
          [req.user.id, ids]
        );
        for (const r of readRows.rows) {
          readNewsIds.add(r.news_id);
        }
      }
    } catch (_) {}

    const newsWithReadStatus = newsResult.rows.map((news) => ({
      ...news,
      readCount: parseInt(news.read_count) || 0,
      isRead: readNewsIds.has(news.id),
      source: detectNewsSourceFromContent(news.content)
    }));

    res.json({
      data: newsWithReadStatus,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('GET /api/news error:', error);
    res.status(500).json({ error: 'Ошибка загрузки новостей' });
  }
});

// Create news (admin only)
app.post('/api/news', authenticateToken, requirePermission('news', 'write'), async (req, res) => {
  try {
    const { title, content, summary, publishedAt } = req.body;

    // Валидация полей
    if (!title || title.length > 255) {
      return res.status(400).json({ error: 'Некорректный заголовок (макс. 255 символов)' });
    }
    if (!summary || summary.length > 1000) {
      return res.status(400).json({ error: 'Некорректное описание (макс. 1000 символов)' });
    }
    // Убрано ограничение на длину контента

    const contentWithSource = ensureLocalNewsSourceMarker(content);
    const result = await query(
      `INSERT INTO news (title, content, summary, published_at, author_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, contentWithSource, summary, publishedAt || new Date().toISOString(), req.user.id]
    );

    const news = result.rows[0];
    
    // Emit socket event
    io.emit('news:changed', { action: 'create', news });

    res.json(news);
  } catch (error) {
    console.error('POST /api/news error:', error);
    res.status(500).json({ error: 'Ошибка создания новости' });
  }
});

// Update news (admin only)
app.put('/api/news/:id', authenticateToken, requirePermission('news', 'write'), async (req, res) => {
  try {
    const id = req.params.id;
    const { title, content, summary, publishedAt } = req.body;

    // Валидация полей
    if (!title || title.length > 255) {
      return res.status(400).json({ error: 'Некорректный заголовок (макс. 255 символов)' });
    }
    if (!summary || summary.length > 1000) {
      return res.status(400).json({ error: 'Некорректное описание (макс. 1000 символов)' });
    }
    // Убрано ограничение на длину контента

    const contentWithSource = ensureLocalNewsSourceMarker(content);
    const result = await query(
      `UPDATE news 
       SET title = $1, content = $2, summary = $3, published_at = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [title, contentWithSource, summary, publishedAt, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Новость не найдена' });
    }

    const news = result.rows[0];
    
    // Emit socket event
    io.emit('news:changed', { action: 'update', news });

    res.json(news);
  } catch (error) {
    console.error('PUT /api/news/:id error:', error);
    res.status(500).json({ error: 'Ошибка обновления новости' });
  }
});

// Delete news (admin only)
app.delete('/api/news/:id', authenticateToken, requirePermission('news', 'write'), async (req, res) => {
  try {
    const id = req.params.id;

    const result = await query('DELETE FROM news WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Новость не найдена' });
    }

    // Delete related read records
    await query('DELETE FROM news_reads WHERE news_id = $1', [id]);

    const news = result.rows[0];
    
    // Emit socket event
    io.emit('news:changed', { action: 'delete', newsId: id });

    res.json({ message: 'Новость удалена', news });
  } catch (error) {
    console.error('DELETE /api/news/:id error:', error);
    res.status(500).json({ error: 'Ошибка удаления новости' });
  }
});

// Mark news as read
app.post('/api/news/:id/read', authenticateToken, async (req, res) => {
  try {
    const newsId = req.params.id;
    const userId = req.user.id;

    // Check if news exists
    const newsResult = await query('SELECT id FROM news WHERE id = $1', [newsId]);
    if (newsResult.rows.length === 0) {
      return res.status(404).json({ error: 'Новость не найдена' });
    }

    // Insert or update read record
    await query(
      `INSERT INTO news_reads (news_id, user_id, read_at) 
       VALUES ($1, $2, NOW()) 
       ON CONFLICT (news_id, user_id) 
       DO UPDATE SET read_at = NOW()`,
      [newsId, userId]
    );

    res.json({ message: 'Новость отмечена как прочитанная' });
  } catch (error) {
    console.error('POST /api/news/:id/read error:', error);
    res.status(500).json({ error: 'Ошибка отметки о прочтении' });
  }
});

// Get users who read the news
app.get('/api/news/:id/read-users', authenticateToken, requirePermission('news', 'read'), async (req, res) => {
  try {
    const newsId = req.params.id;

    const usersResult = await query(
      `SELECT u.id, u.username, u.nickname, nr.read_at
       FROM news_reads nr
       JOIN users u ON nr.user_id = u.id
       WHERE nr.news_id = $1
       ORDER BY nr.read_at DESC`,
      [newsId]
    );

    res.json({ data: usersResult.rows });
  } catch (error) {
    console.error('GET /api/news/:id/read-users error:', error);
    res.status(500).json({ error: 'Ошибка загрузки списка ознакомившихся' });
  }
});

// Clear read users list (admin only)
app.delete('/api/news/:id/read-users', authenticateToken, requirePermission('news', 'write'), async (req, res) => {
  try {
    const newsId = req.params.id;

    await query('DELETE FROM news_reads WHERE news_id = $1', [newsId]);

    res.json({ message: 'Список ознакомившихся очищен' });
  } catch (error) {
    console.error('DELETE /api/news/:id/read-users error:', error);
    res.status(500).json({ error: 'Ошибка очистки списка' });
  }
});

// Upload image for news (admin only)
app.post('/api/news/upload-image', authenticateToken, requirePermission('news', 'write'), upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не загружен' });
    }

    // Проверка размера файла (дополнительная проверка)
    if (req.file.size > 5 * 1024 * 1024) {
      // Удаляем файл если он слишком большой
      await fs.unlink(req.file.path);
      return res.status(400).json({ error: 'Размер файла превышает 5MB' });
    }

    // Возвращаем URL относительно сервера
    const imageUrl = `/uploads/news/${req.file.filename}`;
    
    res.json({ url: imageUrl });
  } catch (error) {
    console.error('POST /api/news/upload-image error:', error);
    
    // Удаляем файл в случае ошибки
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting file after upload error:', unlinkError);
      }
    }
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Размер файла превышает 5MB' });
    }
    if (error.message.includes('Недопустимый тип файла')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Ошибка загрузки изображения' });
  }
});

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
      try {
        app.locals.io.emit('transactions:changed', { id, action: 'deleted' });
      } catch (_) {}
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления транзакции' });
    }
  }
);

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

      // Локальное создание номенклатуры: работаем только с name и type, UEX-поля не трогаем
      await query(
        `INSERT INTO product_names(name, type)
         VALUES ($1,$2)
         ON CONFLICT (name) DO UPDATE SET
           type = EXCLUDED.type`,
        [name.trim(), type || null]
      );
      let dirs = null;
      try {
        dirs = await loadDirectoriesFromDb();
      } catch (err) {
        // Не ломаем добавление из-за ошибки при сборе справочников (например, Discord)
        console.error('loadDirectoriesFromDb failed after product-names insert:', err);
      }
      if (dirs) {
        res.json({ success: true, directories: dirs });
      } else {
        res.json({ success: true });
      }
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
      const { name, type, section, uexType, uexCategoryId } = req.body || {};
      if (!currentName) return res.status(400).json({ error: 'Имя не указано' });
      if (type)
        await query('INSERT INTO product_types(name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [
          type,
        ]);
      if (name && name !== currentName) {
        // Простое переименование: обновляем name и type, UEX-поля не трогаем
        const newName = name.trim();
        await query(
          `UPDATE product_names
           SET name = $2,
               type = COALESCE($3, type)
           WHERE name = $1`,
          [currentName, newName, type || null]
        );
      } else {
        // Обновление типа / UEX-полей без смены имени
        await query(
          `UPDATE product_names
           SET type            = COALESCE($2, type),
               uex_type        = COALESCE($3, uex_type),
               uex_section     = COALESCE($4, uex_section),
               uex_category_id = COALESCE($5, uex_category_id)
           WHERE name = $1`,
          [
            currentName,
            type || null,
            uexType || null,
            section || null,
            uexCategoryId || null,
          ]
        );
      }

      // Как и в POST-хендлере, не даём ошибке сборки директорий
      // ломать сам факт обновления записи.
      let dirs = null;
      try {
        dirs = await loadDirectoriesFromDb();
      } catch (err) {
        console.error('loadDirectoriesFromDb failed after product-names update:', err);
      }
      if (dirs) {
        res.json({ success: true, directories: dirs });
      } else {
        res.json({ success: true });
      }
    } catch (e) {
      res.status(500).json({ error: 'Ошибка обновления наименования' });
    }
  }
);

// Delete uex sync record
app.delete(
  '/api/directories/uex_sync/:resource',
  authenticateToken,
  requirePermission('directories', 'write'),
  async (req, res) => {
    try {
      const resource = decodeURIComponent(req.params.resource || '');
      if (!resource) return res.status(400).json({ error: 'Ресурс не указан' });
      
      await query('DELETE FROM uex_sync_state WHERE resource = $1', [resource]);
      const dirs = await loadDirectoriesFromDb();
      res.json({ success: true, directories: dirs });
    } catch (e) {
      res.status(500).json({ error: 'Ошибка удаления записи uex_sync' });
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

// Product Names with UEX fields (read-only view)
app.get(
  '/api/directories/product-names-uex',
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
    // Глобальный CORS: разрешаем любые Origin
    origin: function (_origin, callback) {
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// Обработка preflight запросов
app.options('*', cors());

// legacy filesystem storage removed

const { readSettingsMap, getPermissionsForTypeDb, getPermissionsForTypesDb } = createDataHelpers({ query });

appDataCache = createAppDataCache({
  ttlMs: Number(process.env.APP_DATA_CACHE_TTL_MS) || 2000,
  maxKeys: Number(process.env.APP_DATA_CACHE_MAX_KEYS) || 200,
});

let buildAggregatedData;
buildAggregatedData = createBuildAggregatedData({ query, readSettingsMap, getPermissionsForTypesDb });

const { readDiscordEffective, getDiscordCallbackPathFromRedirect, getDiscordFrontendBaseFromRedirect } =
  createDiscordOAuthHelpers({ query, DISCORD_CONFIG, SERVER_CONFIG, safeJsonParse });

app.get('/auth/discord', async (req, res) => {
  try {
    const eff = await readDiscordEffective();
    if (eff.baseUrl && typeof eff.baseUrl === 'string' && eff.baseUrl.startsWith('http')) {
      return res.redirect(eff.baseUrl);
    }

    const clientId = eff.clientId || DISCORD_CONFIG.CLIENT_ID;
    const redirectUri = eff.redirectUri || DISCORD_CONFIG.REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return res.status(400).json({
        error:
          'Discord OAuth не настроен: заполните Client ID и Redirect URI в системных параметрах',
      });
    }

    const scopes = ['identify'];
    try {
      const sm = await query('SELECT DISTINCT scope FROM discord_scope_mappings');
      const mapped = sm.rows.map((r) => String(r.scope || '').trim()).filter(Boolean);
      for (const s of mapped) {
        if (s && !scopes.includes(s)) scopes.push(s);
      }
    } catch (_) {}

    const scope = encodeURIComponent(scopes.join(' '));
    const discordAuthUrl =
      `https://discord.com/api/oauth2/authorize?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code&scope=${scope}`;

    res.redirect(discordAuthUrl);
  } catch (e) {
    console.error('Error building Discord auth URL', e);
    res.status(500).send('Discord auth not configured');
  }
});

// Register Discord callback route based on Redirect URI from system settings
(async () => {
  try {
    const effInit = await readDiscordEffective().catch(() => ({}));
    const redirectUriInit = effInit.redirectUri || DISCORD_CONFIG.REDIRECT_URI;
    const callbackPath = getDiscordCallbackPathFromRedirect(redirectUriInit);

    app.get(callbackPath, async (req, res) => {
      try {
        const { code } = req.query;
        const state = String(req.query?.state || '');

        if (!code) {
          return res.redirect(
            `${SERVER_CONFIG.FRONTEND_URL}/?auth=error&message=No code provided`
          );
        }

        const eff = await readDiscordEffective();
        const clientId = eff.clientId || DISCORD_CONFIG.CLIENT_ID;
        const clientSecret = eff.clientSecret || DISCORD_CONFIG.CLIENT_SECRET;
        const redirectUri = eff.redirectUri || DISCORD_CONFIG.REDIRECT_URI;
        const frontendBase = getDiscordFrontendBaseFromRedirect(redirectUri);

        const tokenResponse = await axios.post(
          'https://discord.com/api/oauth2/token',
          new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Accept': 'application/json',
            },
          }
        );

        const syncOauthState = consumeDiscordNewsOauthState(state);
        if (syncOauthState) {
          const expiresInSec = Number(tokenResponse?.data?.expires_in) || 0;
          const expiresAt = expiresInSec > 0
            ? new Date(Date.now() + expiresInSec * 1000).toISOString()
            : null;
          await writeDiscordNewsSetting(
            DISCORD_NEWS_OAUTH_ACCESS_TOKEN_KEY,
            tokenResponse?.data?.access_token || null
          );
          await writeDiscordNewsSetting(
            DISCORD_NEWS_OAUTH_REFRESH_TOKEN_KEY,
            tokenResponse?.data?.refresh_token || null
          );
          await writeDiscordNewsSetting(
            DISCORD_NEWS_OAUTH_SCOPE_KEY,
            tokenResponse?.data?.scope || null
          );
          await writeDiscordNewsSetting(
            DISCORD_NEWS_OAUTH_TOKEN_TYPE_KEY,
            tokenResponse?.data?.token_type || null
          );
          await writeDiscordNewsSetting(DISCORD_NEWS_OAUTH_EXPIRES_AT_KEY, expiresAt);
          return res.redirect(`${frontendBase}/?discordSyncOAuth=success`);
        }

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
          headers: {
            Authorization: `Bearer ${tokenResponse.data.access_token}`,
            'Accept': 'application/json',
          },
        });

        const discordUser = userResponse.data;
        const discordSettings = eff;

        let resolvedAccountType = discordSettings.defaultAccountType || 'Гость';
        let matchedSetPayload = null;

        const grantedScopes = new Set(
          typeof tokenResponse?.data?.scope === 'string'
            ? tokenResponse.data.scope.split(/\s+/).filter(Boolean)
            : []
        );

        try {
          let mappedScopes = new Set();
          try {
            const sm2 = await query('SELECT DISTINCT scope FROM discord_scope_mappings');
            mappedScopes = new Set(
              sm2.rows.map((r) => String(r.scope || '').trim()).filter(Boolean)
            );
          } catch (_) {}

          try {
            discordUser._scopes = Array.from(grantedScopes);
            discordUser._scopes_mapped = Array.from(grantedScopes).filter((s) =>
              mappedScopes.has(s)
            );
          } catch (_) {}

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

          // Scope-based account type mapping with priority by position
          try {
            const scopeRows = (
              await query(
                'SELECT scope, value, account_type, position FROM discord_scope_mappings ORDER BY (position IS NULL), position, scope, value'
              )
            ).rows;
            if (Array.isArray(scopeRows)) {
              for (const r of scopeRows) {
                const scopeName = String(r.scope || '').trim();
                if (!scopeName) continue;
                if (!grantedScopes.has(scopeName)) continue;

                const ruleValue = r.value == null ? null : String(r.value);
                let match = false;

                if (scopeName === 'email') {
                  const email = discordUser?.email;
                  if (typeof email === 'string') {
                    if (!ruleValue || String(email) === ruleValue) match = true;
                  }
                } else if (scopeName === 'guilds') {
                  const guilds = Array.isArray(discordUser.guilds)
                    ? discordUser.guilds
                    : [];
                  if (guilds.length) {
                    if (!ruleValue) {
                      match = true;
                    } else {
                      match = guilds.some((g) => String(g.id) === ruleValue);
                    }
                  }
                } else if (scopeName === 'connections') {
                  const connections = Array.isArray(discordUser.connections)
                    ? discordUser.connections
                    : [];
                  if (connections.length) {
                    if (!ruleValue) {
                      match = true;
                    } else {
                      match = connections.some(
                        (c) =>
                          String(c.id) === ruleValue ||
                          String(c.name) === ruleValue ||
                          String(c.type) === ruleValue
                      );
                    }
                  }
                } else {
                  const val = discordUser?.[scopeName];
                  if (Array.isArray(val)) {
                    if (!ruleValue) {
                      match = true;
                    } else {
                      match = val.map((v) => String(v)).includes(ruleValue);
                    }
                  } else if (
                    typeof val === 'string' ||
                    typeof val === 'number' ||
                    typeof val === 'boolean'
                  ) {
                    if (!ruleValue || String(val) === ruleValue) match = true;
                  }
                }

                if (match) {
                  // Берём тип учётной записи из последнего успешно сработавшего правила
                  if (r.account_type) {
                    resolvedAccountType = r.account_type;
                  }
                }
              }
            }
          } catch (_) {}
        } catch (_) {}

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
                matchedSetPayload =
                  rule.set && typeof rule.set === 'object' ? rule.set : null;
                break;
              }
              if (
                typeof val === 'string' ||
                typeof val === 'number' ||
                typeof val === 'boolean'
              ) {
                if (String(val) === String(rule.value)) {
                  resolvedAccountType = rule.accountType;
                  matchedSetPayload =
                    rule.set && typeof rule.set === 'object' ? rule.set : null;
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
                  matchedSetPayload =
                    rule.set && typeof rule.set === 'object' ? rule.set : null;
                  break;
                }
                if (
                  typeof v === 'string' ||
                  typeof v === 'number' ||
                  typeof v === 'boolean'
                ) {
                  if (String(v) === String(rule.value)) {
                    resolvedAccountType = rule.accountType;
                    matchedSetPayload =
                      rule.set && typeof rule.set === 'object' ? rule.set : null;
                    break;
                  }
                }
              }
            }
          } catch (_) {}
        }

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
          const discordDisplayName =
            (typeof discordUser?.global_name === 'string' && discordUser.global_name.trim()) ||
            (typeof discordUser?.username === 'string' && discordUser.username.trim()) ||
            'discord_user';
          const discordNickname = discordDisplayName;
          await query(
            `INSERT INTO users (id, username, email, nickname, auth_type, account_type, is_active, password_hash, discord_id, discord_data, created_at, last_login)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              `discord_${discordUser.id}`,
              uniqueUsername,
              discordUser.email || null,
              discordNickname,
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

        res.redirect(
          `${frontendBase}/?token=${token}&auth=success&newUser=${isNewUser}`
        );
      } catch (error) {
        console.error('Discord OAuth error:', error.response?.data || error.message);
        try {
          if (String(req.query?.state || '').startsWith('syncnews:')) {
            const details =
              (typeof error?.response?.data?.message === 'string' && error.response.data.message) ||
              (typeof error?.message === 'string' && error.message) ||
              'OAuth failed';
            const frontendBase = getDiscordFrontendBaseFromRedirect(
              (await readDiscordEffective()).redirectUri || DISCORD_CONFIG.REDIRECT_URI
            );
            return res.redirect(
              `${frontendBase}/?discordSyncOAuth=error&message=${encodeURIComponent(details)}`
            );
          }
          const status = error?.response?.status;
          const body = error?.response?.data;
          const errCode =
            (body && typeof body.error === 'string' && body.error) ||
            (body && (body.code !== undefined && String(body.code))) ||
            (status ? `http_${status}` : 'unknown');
          const errDesc =
            (body && typeof body.error_description === 'string' && body.error_description) ||
            (body && typeof body.message === 'string' && body.message) ||
            (typeof error?.message === 'string' && error.message) ||
            'Authentication failed';
          const url = `${SERVER_CONFIG.FRONTEND_URL}/?auth=error&message=${encodeURIComponent('Authentication failed')}` +
            `&err=${encodeURIComponent(errCode)}` +
            `&desc=${encodeURIComponent(errDesc)}`;
          res.redirect(url);
        } catch (_) {
          res.redirect(
            `${SERVER_CONFIG.FRONTEND_URL}/?auth=error&message=Authentication failed`
          );
        }
      }
    });
  } catch (e) {
    console.error('Failed to init Discord callback route:', e);
  }
})();

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

    // Сначала ищем пользователя без проверки is_active
    const ures = await query(
      `SELECT * FROM users WHERE username = $1 AND auth_type = 'local' AND password_hash = $2`,
      [username, passwordHash]
    );
    const user = ures.rows[0];

    if (!user) {
      console.log('User not found or invalid credentials');
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    // Проверяем статус пользователя
    if (!user.is_active) {
      console.log('User is blocked:', username);
      return res.status(403).json({ error: 'Ваш аккаунт заблокирован. Обратитесь к администратору.' });
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

app.get('/api/data', authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    const cacheKey = `data:${userId || 'anonymous'}`;
    const aggregated = await appDataCache.getOrSetPromise(cacheKey, async () =>
      buildAggregatedData(userId)
    );
    res.json(aggregated);
  } catch (error) {
    console.error('Error in /api/data:', error);
    // Добавляем детальную информацию об ошибке для отладки
    res.status(500).json({ 
      error: 'Ошибка чтения данных',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
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
      "SELECT id, username, email, nickname, auth_type, account_type, is_active, discord_id, discord_data, created_at, last_login FROM users WHERE id <> 'deleted_user'"
    );
    const result = [];

    const defaultPermissions = {
      finance: 'read',
      warehouse: 'read',
      showcase: 'read',
      users: 'none',
      directories: 'none',
      settings: 'none',
    };
    const permissionsByType = await getPermissionsForTypesDb(ures.rows.map((u) => u.account_type));
    for (const t of new Set(ures.rows.map((u) => u.account_type).filter(Boolean))) {
      if (!permissionsByType.has(t)) permissionsByType.set(t, { ...defaultPermissions });
    }

    for (const u of ures.rows) {
      const perms = permissionsByType.get(u.account_type) || { ...defaultPermissions };
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
    try {
      const r = await query('SELECT enable FROM discord_settings WHERE id = 1');
      if (r && r.rowCount > 0) {
        // Если запись существует, строго уважаем значение из БД
        const enable = !!r.rows[0].enable;
        return res.json({ enable });
      }
    } catch (_) {}
    // Если записи нет, определяем включенность по наличию конфигурации в окружении
    const enable = !!(DISCORD_CONFIG.CLIENT_ID && DISCORD_CONFIG.REDIRECT_URI);
    return res.json({ enable });
  } catch (e) {
    // В случае ошибки — не раскрываем ничего, просто false
    return res.json({ enable: false });
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
      // Base URL policy: if provided (even empty string), store as-is; if not provided, keep existing
      let baseUrl;
      if (baseUrlIn !== undefined) {
        baseUrl = (typeof baseUrlIn === 'string') ? baseUrlIn.trim() : '';
      } else {
        baseUrl = eff.baseUrl || '';
      }
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

// Serve backend public files (auth background/icon)
try {
  const publicPath = path.resolve(__dirname, 'public');
  app.use('/public', express.static(publicPath));
} catch (e) {
  console.error('Failed to serve public directory:', e);
}

// Serve uploaded files (news images)
try {
  const uploadsPath = path.resolve(__dirname, 'public', 'uploads');
  app.use('/uploads', express.static(uploadsPath));
} catch (e) {
  console.error('Failed to serve uploads directory:', e);
}

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
  const TABLES_ORDER = [
    'users',
    'account_types',
    'account_type_permissions',
    'product_types',
    'showcase_statuses',
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
  for (const t of TABLES_ORDER) {
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
        position integer,
        PRIMARY KEY(scope, value)
      )`
    );
    // Backward compatibility: ensure column exists if table was created earlier without it
    try {
      await query('ALTER TABLE discord_scope_mappings ADD COLUMN IF NOT EXISTS position integer');
    } catch (e) {
      // ignore
    }
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

    // Telegram channel ingestion loop for news.
    setTimeout(async () => {
      try {
        await syncTelegramNews();
      } catch (_) {}
    }, 15000);

    setInterval(async () => {
      try {
        const cfg = await readTelegramNewsSettingsDb();
        const intervalMs = Math.max(1, Number(cfg.syncMinutes) || DEFAULT_TELEGRAM_NEWS_SYNC_MINUTES) * 60 * 1000;
        const now = Date.now();
        if (now - telegramNewsLastRunAtMs < intervalMs) return;
        telegramNewsLastRunAtMs = now;
        await syncTelegramNews();
      } catch (_) {}
    }, 60 * 1000);
  });
};

startServer().catch(console.error);
