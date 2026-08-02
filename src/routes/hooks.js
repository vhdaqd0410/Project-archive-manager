const express = require('express');
const router = express.Router();
const hookService = require('../services/hookService');
const db = require('../services/db');

router.get('/', (req, res) => {
  res.json(hookService.listHooks(db));
});

router.get('/events', (req, res) => {
  res.json(hookService.HOOK_EVENTS);
});

router.post('/', (req, res) => {
  const { id, name, event, scriptPath, config } = req.body;
  if (!id || !name || !event || !scriptPath) return res.status(400).json({ error: '缺少必要参数' });
  hookService.addHook(db, id, name, event, scriptPath, config || {});
  res.json({ success: true });
});

router.put('/:id', (req, res) => {
  const { enabled, scriptPath, config } = req.body;
  hookService.updateHook(db, req.params.id, enabled, scriptPath, config);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  hookService.deleteHook(db, req.params.id);
  res.json({ success: true });
});

module.exports = router;
