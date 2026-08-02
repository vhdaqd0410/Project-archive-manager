const express = require('express');
const router = express.Router();
const db = require('../services/db');

// 获取审计日志
router.get('/', (req, res) => {
  const filter = {
    username: req.query.username,
    action: req.query.action,
    limit: parseInt(req.query.limit) || 200,
  };
  const logs = db.getAuditLogs(filter);
  res.json(logs);
});

// 获取所有用户列表（用于筛选）
router.get('/users', (req, res) => {
  if (!db.isAvailable()) return res.json([]);
  const users = db.getDB().prepare('SELECT DISTINCT username FROM audit_logs WHERE username IS NOT NULL ORDER BY username').all();
  res.json(users.map(u => u.username));
});

module.exports = router;
