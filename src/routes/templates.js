const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../services/db');

// 获取所有模板
router.get('/', (req, res) => {
  const templates = db.getTemplates();
  res.json(templates.map(t => ({ ...t, config: JSON.parse(t.config || '{}') })));
});

// 获取单个模板
router.get('/:id', (req, res) => {
  const t = db.getTemplate(req.params.id);
  if (!t) return res.status(404).json({ error: '模板不存在' });
  res.json({ ...t, config: JSON.parse(t.config || '{}') });
});

// 创建模板
router.post('/', (req, res) => {
  const { name, config } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '模板名不能为空' });
  const t = { id: crypto.randomUUID(), name: name.trim(), config: config || {} };
  db.saveTemplate(t);
  res.json({ success: true, template: t });
});

// 更新模板
router.put('/:id', (req, res) => {
  const { name, config } = req.body;
  const existing = db.getTemplate(req.params.id);
  if (!existing) return res.status(404).json({ error: '模板不存在' });
  db.saveTemplate({
    id: req.params.id,
    name: name || existing.name,
    config: config || JSON.parse(existing.config || '{}'),
    createdAt: existing.createdAt,
  });
  res.json({ success: true });
});

// 删除模板
router.delete('/:id', (req, res) => {
  db.deleteTemplate(req.params.id);
  res.json({ success: true });
});

module.exports = router;
