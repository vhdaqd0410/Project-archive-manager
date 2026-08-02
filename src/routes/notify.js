const express = require('express');
const router = express.Router();
const notifyService = require('../services/notifyService');
const db = require('../services/db');

router.get('/channels', (req, res) => {
  res.json(notifyService.getChannels());
});

router.post('/channels', (req, res) => {
  const { id, name, type, config } = req.body;
  if (!id || !name || !type) return res.status(400).json({ error: '缺少必要参数' });
  notifyService.addChannel(db, id, name, type, config || {});
  res.json({ success: true });
});

router.put('/channels/:id', (req, res) => {
  const { enabled, config } = req.body;
  notifyService.updateChannel(db, req.params.id, enabled, config);
  res.json({ success: true });
});

router.delete('/channels/:id', (req, res) => {
  notifyService.deleteChannel(db, req.params.id);
  res.json({ success: true });
});

// 测试发送
router.post('/test', (req, res) => {
  const { title, body } = req.body;
  notifyService.send(title || '测试通知', body || '这是一条来自项目档案管理器的测试通知', 'info');
  res.json({ success: true });
});

module.exports = router;
