/**
 * 归档工作流引擎 (Feature 12)
 * 基于状态机的可配置多步骤流程
 * 标准流程：检测 → 审核 → 复制 → 完整性校验 → 通知 → 标记完成
 * 每个步骤可配置执行条件、执行人、超时
 */
const crypto = require('crypto');
const config = require('../config');
const log = require('./logger').createLogger('workflow');

// ── 标准工作流模板 ──
const STANDARD_TEMPLATE = {
  id: config.workflow.defaultTemplateId,
  name: '标准归档流程',
  steps: [
    { index: 0, name: '检测', action: 'detect', auto: true, description: '检测关键词目录和集数' },
    { index: 1, name: '审核', action: 'review', auto: false, roles: ['admin', 'reviewer'], description: '人工审核归档内容' },
    { index: 2, name: '复制', action: 'copy', auto: true, description: '复制文件到 NAS' },
    { index: 3, name: '校验', action: 'verify', auto: true, description: '校验文件完整性' },
    { index: 4, name: '通知', action: 'notify', auto: true, description: '发送完成通知' },
    { index: 5, name: '完成', action: 'complete', auto: true, description: '标记项目为已完成' },
  ],
};

function init(db) {
  if (!db || !db.isAvailable()) return;
  // 注册标准模板
  try {
    const existing = db.getDB().prepare('SELECT id FROM workflow_definitions WHERE id = ?').get(STANDARD_TEMPLATE.id);
    if (!existing) {
      db.getDB().prepare(`INSERT INTO workflow_definitions (id, name, steps, config, createdAt)
        VALUES (?, ?, ?, '{}', datetime('now'))`)
        .run(STANDARD_TEMPLATE.id, STANDARD_TEMPLATE.name, JSON.stringify(STANDARD_TEMPLATE.steps));
      log.info('标准工作流模板已注册');
    }
  } catch (e) { log.warn('初始化工作流模板失败:', e.message); }
}

function getDefinitions(db) {
  if (!db || !db.isAvailable()) return [STANDARD_TEMPLATE];
  const rows = db.getDB().prepare('SELECT * FROM workflow_definitions ORDER BY createdAt DESC').all();
  return rows.map(r => ({ id: r.id, name: r.name, steps: JSON.parse(r.steps), config: JSON.parse(r.config || '{}') }));
}

function getDefinition(db, id) {
  if (!db || !db.isAvailable()) return id === STANDARD_TEMPLATE.id ? STANDARD_TEMPLATE : null;
  const row = db.getDB().prepare('SELECT * FROM workflow_definitions WHERE id = ?').get(id);
  if (!row) return null;
  return { id: row.id, name: row.name, steps: JSON.parse(row.steps), config: JSON.parse(row.config || '{}') };
}

/**
 * 为项目创建工作流实例
 */
function createInstance(db, definitionId, projectId) {
  if (!db || !db.isAvailable()) return null;
  const def = getDefinition(db, definitionId);
  if (!def) return null;

  const instanceId = crypto.randomUUID();
  db.getDB().prepare(`INSERT INTO workflow_instances
    (id, definitionId, projectId, currentStep, status, context, createdAt, updatedAt)
    VALUES (?, ?, ?, 0, 'pending', '{}', datetime('now'), datetime('now'))`)
    .run(instanceId, definitionId, projectId);

  addHistory(db, instanceId, 0, def.steps[0]?.name, 'created', null, null, `工作流已创建: ${def.name}`);
  log.info(`工作流实例已创建: ${instanceId}, 项目: ${projectId}`);
  return { id: instanceId, definitionId, projectId, currentStep: 0, status: 'pending', context: {} };
}

/**
 * 推进工作流到下一步
 */
function advance(db, instanceId, userId, username, result) {
  if (!db || !db.isAvailable()) return null;
  const inst = getInstance(db, instanceId);
  if (!inst) return null;
  const def = getDefinition(db, inst.definitionId);
  if (!def) return null;

  const currentStep = def.steps[inst.currentStep];
  if (!currentStep) return null;

  // 记录历史
  addHistory(db, instanceId, inst.currentStep, currentStep.name, 'advance', userId, username, JSON.stringify(result));

  const nextStepIndex = inst.currentStep + 1;
  if (nextStepIndex >= def.steps.length) {
    // 工作流完成
    db.getDB().prepare(`UPDATE workflow_instances SET status = 'completed', currentStep = ?, updatedAt = datetime('now') WHERE id = ?`)
      .run(nextStepIndex - 1, instanceId);
    log.info(`工作流已完成: ${instanceId}`);
    return { ...inst, status: 'completed', currentStep: nextStepIndex - 1 };
  }

  db.getDB().prepare(`UPDATE workflow_instances SET currentStep = ?, status = 'running', updatedAt = datetime('now') WHERE id = ?`)
    .run(nextStepIndex, instanceId);
  log.info(`工作流已推进到步骤 ${nextStepIndex}: ${def.steps[nextStepIndex].name}`);
  return { ...inst, currentStep: nextStepIndex, status: 'running' };
}

/**
 * 回退到上一步
 */
function rollback(db, instanceId, userId, username, reason) {
  if (!db || !db.isAvailable()) return null;
  const inst = getInstance(db, instanceId);
  if (!inst || inst.currentStep === 0) return null;
  const def = getDefinition(db, inst.definitionId);
  const prevStep = def.steps[inst.currentStep - 1];
  addHistory(db, instanceId, inst.currentStep, def.steps[inst.currentStep]?.name, 'rollback', userId, username, reason);
  db.getDB().prepare(`UPDATE workflow_instances SET currentStep = currentStep - 1, status = 'running', updatedAt = datetime('now') WHERE id = ?`)
    .run(instanceId);
  log.info(`工作流已回退到步骤 ${inst.currentStep - 1}: ${prevStep?.name}`);
  return { ...inst, currentStep: inst.currentStep - 1, status: 'running' };
}

function getInstance(db, instanceId) {
  if (!db || !db.isAvailable()) return null;
  const row = db.getDB().prepare('SELECT * FROM workflow_instances WHERE id = ?').get(instanceId);
  if (!row) return null;
  return {
    id: row.id, definitionId: row.definitionId, projectId: row.projectId,
    currentStep: row.currentStep, status: row.status,
    context: JSON.parse(row.context || '{}'), createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function getInstancesByProject(db, projectId) {
  if (!db || !db.isAvailable()) return [];
  const rows = db.getDB().prepare('SELECT * FROM workflow_instances WHERE projectId = ? ORDER BY createdAt DESC').all(projectId);
  return rows.map(r => ({
    id: r.id, definitionId: r.definitionId, projectId: r.projectId,
    currentStep: r.currentStep, status: r.status,
    context: JSON.parse(r.context || '{}'), createdAt: r.createdAt, updatedAt: r.updatedAt,
  }));
}

function addHistory(db, instanceId, stepIndex, stepName, action, userId, username, result) {
  if (!db || !db.isAvailable()) return;
  db.getDB().prepare(`INSERT INTO workflow_history (instanceId, stepIndex, stepName, action, userId, username, result, time)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .run(instanceId, stepIndex, stepName || '', action, userId || '', username || '', result || '');
}

function getHistory(db, instanceId) {
  if (!db || !db.isAvailable()) return [];
  return db.getDB().prepare('SELECT * FROM workflow_history WHERE instanceId = ? ORDER BY time ASC').all(instanceId);
}

module.exports = {
  STANDARD_TEMPLATE,
  init,
  getDefinitions,
  getDefinition,
  createInstance,
  advance,
  rollback,
  getInstance,
  getInstancesByProject,
  getHistory,
};
