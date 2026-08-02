/**
 * 多通知渠道服务 (Feature 8)
 * 适配层设计：支持浏览器通知、系统通知、钉钉Webhook、企业微信Webhook、邮件
 * 渠道配置存储在 SQLite 或 settings 中
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const config = require('../config');
const log = require('./logger').createLogger('notify');
const sse = require('./sseService');

const sentHistory = new Map(); // 去重窗口

function send(title, body, level) {
  level = level || 'info';
  // 去重：同一 title+body 在窗口内只发一次
  const key = title + '|' + body;
  const now = Date.now();
  const last = sentHistory.get(key);
  if (last && (now - last) < config.notifications.dedupWindow) return;
  sentHistory.set(key, now);

  // 每次发送都清理过期记录（不仅限于 size > 100）
  const dedupWindow = config.notifications.dedupWindow;
  for (const [k, t] of sentHistory) {
    if (now - t > dedupWindow) sentHistory.delete(k);
  }
  // 硬上限保护
  if (sentHistory.size > 500) {
    const entries = [...sentHistory.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < entries.length - 200; i++) sentHistory.delete(entries[i][0]);
  }

  // 总是通过 SSE 推送给浏览器
  sse.pushNotification(title, body, level);

  // 加载已配置的渠道并分发
  const channels = getChannels();
  for (const ch of channels) {
    if (!ch.enabled) continue;
    try {
      switch (ch.type) {
        case 'dingtalk': sendDingTalk(ch.config, title, body); break;
        case 'wecom': sendWeCom(ch.config, title, body); break;
        case 'email': sendEmail(ch.config, title, body); break;
        // browser/system 由 SSE 处理，无需额外
      }
    } catch (e) { log.warn(`渠道 ${ch.type} 发送失败:`, e.message); }
  }
}

// ── 渠道管理 ──
function getChannels() {
  // 优先从数据库读取
  const db = require('./db');
  if (db.isAvailable()) {
    try {
      const rows = db.getDB().prepare('SELECT * FROM notification_channels').all();
      return rows.map(r => ({ ...r, config: JSON.parse(r.config || '{}'), enabled: !!r.enabled }));
    } catch { /* fallback */ }
  }
  // fallback: 从 settings 读
  const shared = require('../routes/shared');
  return shared.settings.notificationChannels || [];
}

function addChannel(db, id, name, type, channelConfig) {
  if (db && db.isAvailable()) {
    db.getDB().prepare(`INSERT OR REPLACE INTO notification_channels (id, name, type, config, enabled, createdAt)
      VALUES (?, ?, ?, ?, 1, datetime('now'))`).run(id, name, type, JSON.stringify(channelConfig));
  }
}

function updateChannel(db, id, enabled, channelConfig) {
  if (db && db.isAvailable()) {
    if (channelConfig !== undefined) {
      db.getDB().prepare('UPDATE notification_channels SET config = ? WHERE id = ?').run(JSON.stringify(channelConfig), id);
    }
    if (enabled !== undefined) {
      db.getDB().prepare('UPDATE notification_channels SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    }
  }
}

function deleteChannel(db, id) {
  if (db && db.isAvailable()) {
    db.getDB().prepare('DELETE FROM notification_channels WHERE id = ?').run(id);
  }
}

// ── 钉钉机器人 Webhook ──
function sendDingTalk(cfg, title, body) {
  if (!cfg.webhook) return;
  const url = new URL(cfg.webhook);
  const payload = JSON.stringify({
    msgtype: 'markdown',
    markdown: { title, text: `### ${title}\n\n${body}` },
  });
  const options = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  };
  const req = https.request(options, (res) => {
    log.info('钉钉通知已发送:', res.statusCode);
  });
  req.on('error', (e) => log.warn('钉钉通知失败:', e.message));
  req.write(payload);
  req.end();
}

// ── 企业微信机器人 Webhook ──
function sendWeCom(cfg, title, body) {
  if (!cfg.webhook) return;
  const url = new URL(cfg.webhook);
  const payload = JSON.stringify({
    msgtype: 'markdown',
    markdown: { content: `### ${title}\n\n${body}` },
  });
  const options = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  };
  const req = https.request(options, (res) => {
    log.info('企微通知已发送:', res.statusCode);
  });
  req.on('error', (e) => log.warn('企微通知失败:', e.message));
  req.write(payload);
  req.end();
}

// ── 邮件（需要 nodemailer，懒加载）──
function sendEmail(cfg, title, body) {
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort || 465,
      secure: cfg.secure !== false,
      auth: cfg.auth ? { user: cfg.auth.user, pass: cfg.auth.pass } : undefined,
    });
    transporter.sendMail({
      from: cfg.from,
      to: cfg.to,
      subject: title,
      text: body,
    }).then(() => log.info('邮件通知已发送')).catch(e => log.warn('邮件通知失败:', e.message));
  } catch (e) {
    log.warn('nodemailer 未安装，邮件通知不可用');
  }
}

module.exports = {
  send,
  getChannels,
  addChannel,
  updateChannel,
  deleteChannel,
};
