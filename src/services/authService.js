/**
 * 用户认证服务 (Feature 9)
 * 支持：用户注册/登录/session 管理/操作审计
 * 单用户模式下可关闭认证
 */
const crypto = require('crypto');
const config = require('../config');
const log = require('./logger').createLogger('auth');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const testHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === testHash;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── 用户管理 ──
function getUsers(db) {
  if (!db || !db.isAvailable()) return [];
  return db.getDB().prepare('SELECT id, username, displayName, role, createdAt, lastLoginAt FROM users ORDER BY createdAt DESC').all();
}

function getUserByName(db, username) {
  if (!db || !db.isAvailable()) return null;
  return db.getDB().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function createUser(db, username, password, displayName, role) {
  if (!db || !db.isAvailable()) return null;
  const id = crypto.randomUUID();
  const passwordHash = hashPassword(password);
  db.getDB().prepare(`INSERT INTO users (id, username, displayName, passwordHash, role, createdAt)
    VALUES (?, ?, ?, ?, ?, datetime('now'))`).run(id, username, displayName || username, passwordHash, role || 'editor');
  log.info('用户已创建:', username);
  return { id, username, displayName: displayName || username, role: role || 'editor' };
}

function deleteUser(db, id) {
  if (!db || !db.isAvailable()) return;
  db.getDB().prepare('DELETE FROM users WHERE id = ?').run(id);
  db.getDB().prepare('DELETE FROM sessions WHERE userId = ?').run(id);
}

// ── 认证流程 ──
function login(db, username, password) {
  const user = getUserByName(db, username);
  if (!user) return { success: false, error: '用户不存在' };
  if (!verifyPassword(password, user.passwordHash)) return { success: false, error: '密码错误' };

  const token = generateToken();
  const expiresAt = new Date(Date.now() + config.auth.tokenExpiry).toISOString();
  db.getDB().prepare(`INSERT INTO sessions (token, userId, createdAt, expiresAt)
    VALUES (?, ?, datetime('now'), ?)`).run(token, user.id, expiresAt);
  db.getDB().prepare('UPDATE users SET lastLoginAt = datetime(\'now\') WHERE id = ?').run(user.id);

  log.info('用户登录:', username);
  return {
    success: true,
    token,
    user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
  };
}

function logout(db, token) {
  if (!db || !db.isAvailable()) return;
  db.getDB().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function verifyToken(db, token) {
  if (!config.auth.enabled) return { authenticated: true, user: { username: 'default', displayName: '默认用户', role: 'admin' } };
  if (!db || !db.isAvailable() || !token) return { authenticated: false };
  const session = db.getDB().prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return { authenticated: false };
  const expires = new Date(session.expiresAt);
  if (expires < new Date()) {
    db.getDB().prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return { authenticated: false };
  }
  const user = db.getDB().prepare('SELECT id, username, displayName, role FROM users WHERE id = ?').get(session.userId);
  return { authenticated: true, user };
}

// ── 中间件 ──
function middleware(db) {
  return (req, res, next) => {
    if (!config.auth.enabled) { req.user = { username: 'default', role: 'admin' }; return next(); }
    const token = req.headers.authorization?.replace('Bearer ', '');
    const result = verifyToken(db, token);
    if (!result.authenticated) return res.status(401).json({ error: '未认证' });
    req.user = result.user;
    next();
  };
}

// ── 审计日志 ──
function audit(db, userId, username, action, target, detail) {
  if (!db || !db.isAvailable()) return;
  try {
    db.getDB().prepare(`INSERT INTO audit_logs (time, userId, username, action, target, detail)
      VALUES (datetime('now'), ?, ?, ?, ?, ?)`)
      .run(userId || '', username || '', action, target || '', detail || '');
  } catch (e) { log.warn('审计日志写入失败:', e.message); }
}

function getAuditLogs(db, limit) {
  if (!db || !db.isAvailable()) return [];
  return db.getDB().prepare('SELECT * FROM audit_logs ORDER BY time DESC LIMIT ?').all(limit || 100);
}

module.exports = {
  hashPassword, verifyPassword, generateToken,
  getUsers, getUserByName, createUser, deleteUser,
  login, logout, verifyToken, middleware, audit, getAuditLogs,
};
