const express = require('express');
const router = express.Router();
const schedulerService = require('../services/schedulerService');
const db = require('../services/db');

router.get('/', (req, res) => {
  res.json(schedulerService.getTasks());
});

router.post('/', (req, res) => {
  const { id, name, cron, action, config } = req.body;
  if (!id || !name || !cron || !action) return res.status(400).json({ error: '缺少必要参数' });
  const ok = schedulerService.registerTask(id, name, cron, action, config || {});
  if (!ok) return res.status(400).json({ error: '无效的 cron 表达式' });
  // 持久化
  if (db.isAvailable()) {
    db.getDB().prepare(`INSERT OR REPLACE INTO scheduler_tasks (id, name, cron, action, config, enabled, createdAt)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`).run(id, name, cron, action, JSON.stringify(config || {}));
  }
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  schedulerService.unregisterTask(req.params.id);
  if (db.isAvailable()) {
    db.getDB().prepare('DELETE FROM scheduler_tasks WHERE id = ?').run(req.params.id);
  }
  res.json({ success: true });
});

router.post('/:id/run', async (req, res) => {
  const tasks = schedulerService.getTasks();
  const t = tasks.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  await schedulerService.executeTask(t.id, t.name, t.action, t.config || {});
  res.json({ success: true, lastResult: t.lastResult });
});

module.exports = router;
