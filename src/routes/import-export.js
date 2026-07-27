const express = require('express');
const router = express.Router();
const importService = require('../services/importService');
const projectService = require('../services/projectService');
const shared = require('./shared');
const crypto = require('crypto');

// 扫描本地目录
router.post('/scan', (req, res) => {
  res.json(importService.scanLocalRoot(req.body.localRoot, shared.projects.map(p => p.name)));
});

// 部门模板（作为 /import/templates 使用）
router.get('/templates', (req, res) => res.json(shared.settings.templates || []));
router.put('/templates', (req, res) => {
  if (!Array.isArray(req.body.templates)) return res.status(400).json({ error: 'templates 必须是数组' });
  shared.settings.templates = req.body.templates;
  projectService.saveSettings(shared.settings);
  res.json({ success: true });
});

// 批量导入
router.post('/batch', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items 不能为空' });
  const added = [];
  for (const item of items) {
    if (!item.name || !item.localDir) continue;
    if (shared.projects.some(p => p.name === item.name)) continue;
    shared.projects.push({ id: crypto.randomUUID(), name: item.name.trim(), localDir: item.localDir.trim(), nasDir: (item.nasDir || '').trim(), status: 'editing' });
    added.push(item);
  }
  projectService.saveProjects(shared.projects);
  res.json({ success: true, added: added.length });
});

module.exports = router;
