const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const db = require('../services/db');
const config = require('../config');
const shared = require('./shared');

// 获取项目的复制操作历史
router.get('/:projectId', (req, res) => {
  const ops = db.getCopyOperations(req.params.projectId, config.rollback.maxRecords);
  res.json(ops.map(op => ({
    ...op,
    files: JSON.parse(op.files || '[]'),
  })));
});

// 回滚指定操作
router.post('/:operationId/undo', async (req, res) => {
  const op = db.getCopyOperation(req.params.operationId);
  if (!op) return res.status(404).json({ error: '操作记录不存在' });
  if (op.rolledBack) return res.status(400).json({ error: '该操作已回滚' });

  const files = JSON.parse(op.files || '[]');
  if (!files.length) return res.status(400).json({ error: '无可回滚文件' });

  let deleted = 0, failed = 0;
  const errors = [];

  for (const f of files) {
    try {
      if (f.isDir) {
        // 目录：递归删除
        await fsp.rm(f.path, { recursive: true, force: true });
      } else {
        // 文件：删除
        await fsp.unlink(f.path);
      }
      deleted++;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        failed++;
        errors.push(`${f.name}: ${e.message}`);
      } else {
        // 文件已不存在，视为成功
        deleted++;
      }
    }
  }

  db.markRolledBack(op.id);
  res.json({ success: true, deleted, failed, errors });
});

module.exports = router;
