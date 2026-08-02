const express = require('express');
const router = express.Router();
const workflowService = require('../services/workflowService');
const db = require('../services/db');
const shared = require('./shared');

router.get('/definitions', (req, res) => {
  res.json(workflowService.getDefinitions(db));
});

router.get('/instances/project/:projectId', (req, res) => {
  res.json(workflowService.getInstancesByProject(db, req.params.projectId));
});

router.post('/instances', (req, res) => {
  const { definitionId, projectId } = req.body;
  if (!definitionId || !projectId) return res.status(400).json({ error: '缺少参数' });
  const inst = workflowService.createInstance(db, definitionId, projectId);
  if (!inst) return res.status(400).json({ error: '创建失败' });
  res.json({ success: true, instance: inst });
});

router.get('/instances/:id', (req, res) => {
  const inst = workflowService.getInstance(db, req.params.id);
  if (!inst) return res.status(404).json({ error: '工作流实例不存在' });
  const def = workflowService.getDefinition(db, inst.definitionId);
  const history = workflowService.getHistory(db, req.params.id);
  res.json({ instance: inst, definition: def, history });
});

router.post('/instances/:id/advance', (req, res) => {
  const { result } = req.body;
  const updated = workflowService.advance(db, req.params.id, req.user?.id, req.user?.username, result);
  if (!updated) return res.status(400).json({ error: '推进失败' });
  res.json({ success: true, instance: updated });
});

router.post('/instances/:id/rollback', (req, res) => {
  const { reason } = req.body;
  const updated = workflowService.rollback(db, req.params.id, req.user?.id, req.user?.username, reason);
  if (!updated) return res.status(400).json({ error: '回退失败' });
  res.json({ success: true, instance: updated });
});

module.exports = router;
