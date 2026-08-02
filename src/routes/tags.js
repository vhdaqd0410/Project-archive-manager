const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../services/db');
const shared = require('./shared');
const projectService = require('../services/projectService');

// 获取所有标签
router.get('/', (req, res) => {
  const tags = db.getTags();
  // 附加每个标签的项目数
  const result = tags.map(t => {
    const count = db.isAvailable()
      ? db.getDB().prepare('SELECT COUNT(*) as c FROM project_tag_map WHERE tagId = ?').get(t.id).c
      : 0;
    return { ...t, projectCount: count };
  });
  res.json(result);
});

// 创建标签
router.post('/', (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '标签名不能为空' });
  const tag = { id: crypto.randomUUID(), name: name.trim(), color: color || '#3b82f6' };
  db.addTag(tag);
  res.json({ success: true, tag });
});

// 删除标签
router.delete('/:id', (req, res) => {
  db.deleteTag(req.params.id);
  res.json({ success: true });
});

// 更新标签
router.put('/:id', (req, res) => {
  const { name, color } = req.body;
  if (!db.isAvailable()) return res.json({ success: false });
  const dbConn = db.getDB();
  const existing = dbConn.prepare('SELECT * FROM project_tags WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '标签不存在' });
  dbConn.prepare('UPDATE project_tags SET name = ?, color = ? WHERE id = ?')
    .run(name || existing.name, color || existing.color, req.params.id);
  res.json({ success: true });
});

// 获取项目的标签
router.get('/project/:projectId', (req, res) => {
  res.json(db.getProjectTags(req.params.projectId));
});

// 设置项目的标签
router.put('/project/:projectId', async (req, res) => {
  const { tagIds } = req.body;
  if (!Array.isArray(tagIds)) return res.status(400).json({ error: 'tagIds 必须是数组' });
  db.setProjectTags(req.params.projectId, tagIds);
  res.json({ success: true });
});

module.exports = router;
