const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const db = require('../services/db');

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  const result = authService.login(db, username, password);
  if (!result.success) return res.status(401).json({ error: result.error });
  authService.audit(db, result.user.id, result.user.username, 'login', username, '');
  res.json(result);
});

router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  authService.logout(db, token);
  res.json({ success: true });
});

router.get('/users', (req, res) => {
  res.json(authService.getUsers(db));
});

router.post('/users', (req, res) => {
  const { username, password, displayName, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  try {
    const user = authService.createUser(db, username, password, displayName, role);
    authService.audit(db, user.id, username, 'create_user', username, `角色: ${role || 'editor'}`);
    res.json({ success: true, user });
  } catch (e) {
    res.status(400).json({ error: '用户创建失败: ' + e.message });
  }
});

router.delete('/users/:id', (req, res) => {
  authService.deleteUser(db, req.params.id);
  res.json({ success: true });
});

router.get('/audit-logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(authService.getAuditLogs(db, limit));
});

module.exports = router;
