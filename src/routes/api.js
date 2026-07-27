const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execSync, execFile } = require('child_process');
const projectService = require('../services/projectService');
const shared = require('./shared');
const { mountJobRoutes } = require('./jobs');

// ── 项目 CRUD + 检测 + 交付 ──
router.use('/projects', require('./projects'));

// ── 后台任务进度 ──
mountJobRoutes(router);

// ── 批量导入 ──
router.use('/import', require('./import-export'));

// ── 设置 ──
router.get('/settings', (req, res) => res.json(shared.settings));
router.put('/settings', (req, res) => {
  if (req.body.keyword !== undefined) shared.settings.keyword = req.body.keyword;
  projectService.saveSettings(shared.settings);
  res.json({ success: true, settings: shared.settings });
});

// ── 交付历史 ──
router.get('/delivery-log', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(projectService.loadDeliveryLog().slice(0, limit));
});

// ── 导出 / 导入备份 ──
router.get('/export/backup', (req, res) => {
  const backup = { exportedAt: new Date().toISOString(), version: '2.1', projects: shared.projects, settings: shared.settings, deliveryLog: projectService.loadDeliveryLog() };
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent('项目档案管理器备份_' + new Date().toISOString().slice(0, 10))}.json"`);
  res.json(backup);
});

router.post('/import/backup', (req, res) => {
  const { projects: importedProjects, settings: importedSettings } = req.body;
  if (!Array.isArray(importedProjects)) return res.status(400).json({ error: '无效的备份数据' });
  const added = [];
  const crypto = require('crypto');
  for (const p of importedProjects) {
    if (shared.projects.some(ex => ex.name === p.name)) continue;
    p.id = crypto.randomUUID();
    if (!p.status) p.status = 'editing'; if (!p.memo) p.memo = '';
    shared.projects.push(p); added.push(p);
  }
  if (importedSettings && importedSettings.templates) {
    for (const t of importedSettings.templates) {
      if (!shared.settings.templates.some(ex => ex.name === t.name)) shared.settings.templates.push(t);
    }
  }
  projectService.saveProjects(shared.projects);
  projectService.saveSettings(shared.settings);
  res.json({ success: true, added: added.length, total: shared.projects.length });
});

// ── 文件夹浏览 ──
router.post('/pick-folder', (req, res) => {
  try {
    const os = require('os');
    const baseName = 'pam_pf_' + Date.now();
    const pickerVbs = path.join(os.tmpdir(), baseName + '_picker.vbs');
    const launcherVbs = path.join(os.tmpdir(), baseName + '_launcher.vbs');
    const resultFile = path.join(os.tmpdir(), baseName + '_res.txt');

    const picker = [
      'Set sa  = CreateObject("Shell.Application")',
      'Set f   = sa.BrowseForFolder(0, "Select Folder", 81, 0)',
      'If Not f Is Nothing Then',
      '  Set stm = CreateObject("ADODB.Stream")',
      '  stm.Type = 2 : stm.Charset = "utf-8" : stm.Open',
      '  stm.WriteText f.Self.Path, 0',
      '  stm.SaveToFile "' + resultFile.replace(/\\/g, '\\\\') + '", 2',
      '  stm.Close',
      'End If'
    ].join('\r\n');
    fs.writeFileSync(pickerVbs, picker, 'utf8');

    const launcher = [
      'Set ws = CreateObject("WScript.Shell")',
      'ws.Run "wscript.exe \"' + pickerVbs.replace(/\\/g, '\\\\') + '\"", 1, True'
    ].join('\r\n');
    fs.writeFileSync(launcherVbs, launcher, 'utf8');

    execSync('wscript.exe "' + launcherVbs + '"', { timeout: 120000 });

    let sel = '';
    if (fs.existsSync(resultFile)) {
      sel = fs.readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, '').trim();
      try { fs.unlinkSync(resultFile); } catch(e) {}
    }
    try { fs.unlinkSync(pickerVbs); } catch(e) {}
    try { fs.unlinkSync(launcherVbs); } catch(e) {}
    res.json({ success: true, path: sel });
  } catch(e) {
    res.json({ success: false, path: '', error: e.message || '超时或取消' });
  }
});

// ── 打开资源管理器 ──
router.post('/open-explorer', (req, res) => {
  const { path: p } = req.body;
  if (!p) return res.status(400).json({ error: '路径为空' });
  execFile('explorer.exe', [p], (err) => { if (err) console.error('explorer 失败:', p, err.message); });
  res.json({ success: true });
});

// ── 服务管理 ──
router.use('/server', require('./server'));

module.exports = router;
