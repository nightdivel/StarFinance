import bcrypt from 'bcryptjs';
import { pool } from '../db.js';

export async function findUserByUsername(username) {
  const res = await pool.query(
    `SELECT id, username, email, password_hash, auth_type, account_type, is_active, nickname, discord_id, discord_data
     FROM users
     WHERE username = $1 AND auth_type = 'local' AND is_active = true`,
    [username]
  );
  return res.rows[0];
}

export async function findUserById(userId) {
  const res = await pool.query(
    'SELECT id, username, password_hash, auth_type, is_active FROM users WHERE id = $1',
    [userId]
  );
  return res.rows[0];
}

export async function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compare(password, passwordHash);
}

export async function getUserWithPermissions(userId) {
  if (!userId) return { user: null, permissions: {} };
  const u = await pool.query(
    'SELECT id, username, nickname, account_type, is_active, auth_type, discord_data FROM users WHERE id = $1',
    [userId]
  );
  const user = u.rows[0];
  if (!user || user.is_active === false) return { user: null, permissions: {} };
  const perms = await pool.query(
    'SELECT resource, level FROM account_type_permissions WHERE account_type = $1',
    [user.account_type]
  );
  const permissions = Object.fromEntries(perms.rows.map((r) => [r.resource, r.level]));
  return { user, permissions };
}

export async function listUsers() {
  const res = await pool.query(
    'SELECT id, username, email, nickname, auth_type, account_type, is_active, discord_id, discord_data, created_at, last_login FROM users'
  );
  return res.rows;
}

export async function createUser({ id, username, email, password, accountType, authType }) {
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  const newId = id || `u_${Date.now()}`;
  const res = await pool.query(
    `INSERT INTO users(id, username, email, password_hash, account_type, auth_type, is_active, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,true, now())
     ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, email = EXCLUDED.email,
       password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash),
       account_type = EXCLUDED.account_type, auth_type = EXCLUDED.auth_type
     RETURNING id`,
    [newId, username, email || null, passwordHash, accountType, authType || 'local']
  );
  return res.rows[0];
}

export async function updateUserPassword(userId, password) {
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}

export async function deleteUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}
