const express = require('express');
const router = express.Router();
const storageBackend = require('../services/storageBackend');
const db = require('../services/db');

router.get('/', (req, res) => {
  res.json(storageBackend.list());
});

router.post('/', (req, res) => {
  const { id, name, type, config } = req.body;
  if (!id || !name || !type) return res.status(400).json({ error: '缺少必要参数' });
  try {
    storageBackend.addBackend(db, id, name, type, config || {});
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/:id/test', async (req, res) => {
  const backend = storageBackend.get(req.params.id);
  if (!backend) return res.status(404).json({ error: '后端不存在' });
  try {
    const info = { name: backend.name, type: backend.type, available: true };
    res.json({ success: true, backend: info });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

module.exports = router;
