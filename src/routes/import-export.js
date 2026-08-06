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
router.get('/templates/:id', (req, res) => {
  const t = (shared.settings.templates || []).find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: '模板不存在' });
  res.json(t);
});
router.post('/templates', async (req, res) => {
  const { name, config } = req.body;
  if (!name) return res.status(400).json({ error: '模板名不能为空' });
  const tpl = { id: crypto.randomUUID(), name: name.trim(), config: config || {} };
  if (!shared.settings.templates) shared.settings.templates = [];
  shared.settings.templates.push(tpl);
  try {
    await projectService.saveSettings(shared.settings);
    res.json({ success: true, template: tpl });
  } catch (e) { res.status(500).json({ error: '保存失败: ' + e.message }); }
});
router.delete('/templates/:id', async (req, res) => {
  const arr = shared.settings.templates || [];
  const idx = arr.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '模板不存在' });
  arr.splice(idx, 1);
  try {
    await projectService.saveSettings(shared.settings);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: '删除失败: ' + e.message }); }
});
router.put('/templates', async (req, res) => {
  if (!Array.isArray(req.body.templates)) return res.status(400).json({ error: 'templates 必须是数组' });
  shared.settings.templates = req.body.templates;
  try {
    await projectService.saveSettings(shared.settings);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '保存失败: ' + e.message });
  }
});

// 批量导入
router.post('/batch', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items 不能为空' });
  const added = [];
  for (const item of items) {
    if (!item.name || !item.localDir) continue;
    if (shared.projects.some(p => p.name === item.name)) continue;
    shared.projects.push({ id: crypto.randomUUID(), name: item.name.trim(), localDir: item.localDir.trim(), nasDir: (item.nasDir || '').trim(), status: 'editing', createdAt: new Date().toISOString() });
    added.push(item);
  }
  try {
    await projectService.saveProjects(shared.projects);
    res.json({ success: true, added: added.length });
  } catch (e) {
    res.status(500).json({ error: '导入保存失败: ' + e.message });
  }
});

module.exports = router;
