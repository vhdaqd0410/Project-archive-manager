const express = require('express');
const router = express.Router();
const backupService = require('../services/backupService');

// 列出所有备份
router.get('/', async (req, res) => {
  try {
    const list = await backupService.listBackups();
    res.json({ backups: list });
  } catch (e) { res.status(500).json({ error: '查询失败: ' + e.message }); }
});

// 立即备份
router.post('/', async (req, res) => {
  try {
    const latest = await backupService.backupNow();
    res.json({ success: true, backup: latest });
  } catch (e) { res.status(500).json({ error: '备份失败: ' + e.message }); }
});

// 恢复
router.post('/restore', async (req, res) => {
  const { backupName } = req.body;
  if (!backupName) return res.status(400).json({ error: '请提供备份文件名' });
  try {
    await backupService.restore(backupName);
    res.json({ success: true, message: '已恢复,请重启服务' });
  } catch (e) { res.status(500).json({ error: '恢复失败: ' + e.message }); }
});

module.exports = router;
