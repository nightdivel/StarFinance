import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { CONFIG } from '../config.js';

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function generateAccessToken(userId) {
  return jwt.sign({ id: userId }, CONFIG.jwtSecret, { expiresIn: CONFIG.jwtExpiry });
}

export function generateRefreshToken(userId) {
  return jwt.sign({ id: userId, type: 'refresh' }, CONFIG.refreshSecret, {
    expiresIn: CONFIG.refreshExpiry,
  });
}

export async function storeRefreshToken(userId, refreshToken, { userAgent, ip } = {}) {
  const payload = jwt.decode(refreshToken, { json: true }) || {};
  const expiresAt = payload.exp ? new Date(payload.exp * 1000) : null;
  await pool.query(
    `INSERT INTO refresh_tokens (token_hash, user_id, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (token_hash) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         expires_at = EXCLUDED.expires_at,
         user_agent = COALESCE(EXCLUDED.user_agent, refresh_tokens.user_agent),
         ip = COALESCE(EXCLUDED.ip, refresh_tokens.ip),
         revoked_at = NULL,
         updated_at = now()`,
    [hashToken(refreshToken), userId, expiresAt, userAgent || null, ip || null]
  );
  return expiresAt;
}

export async function issueAuthTokens(userId, meta = {}) {
  const accessToken = generateAccessToken(userId);
  const refreshToken = generateRefreshToken(userId);
  const refreshExpiresAt = await storeRefreshToken(userId, refreshToken, meta);
  return { accessToken, refreshToken, refreshExpiresAt };
}

export async function verifyRefreshToken(refreshToken) {
  if (!refreshToken) {
    const error = new Error('Refresh-токен обязателен');
    error.statusCode = 400;
    throw error;
  }
  let payload;
  try {
    payload = jwt.verify(refreshToken, CONFIG.refreshSecret);
  } catch (error) {
    error.statusCode = 401;
    throw error;
  }
  if (!payload?.id) {
    const error = new Error('Некорректный payload refresh-токена');
    error.statusCode = 401;
    throw error;
  }
  const res = await pool.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [
    hashToken(refreshToken),
  ]);
  const record = res.rows[0];
  if (!record) {
    const error = new Error('Refresh-токен не найден или отозван');
    error.statusCode = 401;
    throw error;
  }
  if (record.revoked_at || (record.expires_at && new Date(record.expires_at) < new Date())) {
    await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hashToken(refreshToken)]);
    const error = new Error('Refresh-токен истёк или отозван');
    error.statusCode = 401;
    throw error;
  }
  return { userId: payload.id, record };
}

export async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) return;
  await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hashToken(refreshToken)]);
}
