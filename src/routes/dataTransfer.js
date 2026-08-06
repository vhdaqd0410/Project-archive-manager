const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const projectService = require('../services/projectService');
const shared = require('./shared');
const log = require('../services/logger').createLogger('dataTransfer');

// 导出全部项目配置为 JSON（含人员分配、模板）
router.get('/export', (req, res) => {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    projects: shared.projects.map(p => ({
      id: p.id,
      name: p.name,
      localDir: p.localDir,
      nasDir: p.nasDir,
      memo: p.memo,
      status: p.status,
      episodeTarget: p.episodeTarget || 0,
      episodeAssignments: p.episodeAssignments || [],
      pinned: !!p.pinned,
      createdAt: p.createdAt,
    })),
    settings: {
      keyword: shared.settings.keyword,
      departments: shared.settings.departments,
      templates: shared.settings.templates || [],
    },
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="projects-export-' + Date.now() + '.json"');
  res.json(data);
});

// 导入 JSON 恢复项目（merge 模式：同名跳过，replace 模式：清空后导入）
router.post('/import', async (req, res) => {
  const { projects: importProjects, settings: importSettings, mode } = req.body;
  if (!Array.isArray(importProjects)) return res.status(400).json({ error: '数据格式错误: 缺少 projects' });

  const importMode = mode === 'replace' ? 'replace' : 'merge';
  let added = 0, skipped = 0;

  try {
    if (importMode === 'replace') {
      // 清空现有项目
      shared.projects.length = 0;
    }
    const existingNames = new Set(shared.projects.map(p => p.name));

    for (const p of importProjects) {
      if (!p.name) continue;
      if (importMode === 'merge' && existingNames.has(p.name)) { skipped++; continue; }
      const newProj = {
        id: p.id || crypto.randomUUID(),
        name: p.name,
        localDir: p.localDir || '',
        nasDir: p.nasDir || '',
        memo: p.memo || '',
        status: p.status || 'editing',
        episodeTarget: p.episodeTarget || 0,
        episodeAssignments: Array.isArray(p.episodeAssignments) ? p.episodeAssignments : [],
        pinned: !!p.pinned,
        createdAt: p.createdAt || new Date().toISOString(),
      };
      shared.projects.push(newProj);
      added++;
    }

    // 同步设置（不覆盖 departments，避免覆盖本地预设）
    if (importSettings) {
      if (importSettings.keyword) shared.settings.keyword = importSettings.keyword;
      if (Array.isArray(importSettings.templates)) shared.settings.templates = importSettings.templates;
    }

    await projectService.saveProjects(shared.projects);
    await projectService.saveSettings(shared.settings);
    log.info('导入完成: 新增', added, '跳过', skipped);
    res.json({ success: true, added, skipped, mode: importMode });
  } catch (e) {
    res.status(500).json({ error: '导入失败: ' + e.message });
  }
});

module.exports = router;
