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

// ── SSE 实时推送 (Feature 4) ──
router.use('/', require('./sse'));

// ── 项目统计仪表盘 (Feature 3) ──
router.use('/stats', require('./stats'));

// ── 归档报告导出 (Feature 2) ──
router.use('/reports', require('./reports'));

// ── 定时自动化 (Feature 7) ──
router.use('/scheduler', require('./scheduler'));

// ── 多通知渠道 (Feature 8) ──
router.use('/notify', require('./notify'));

// ── 插件/钩子系统 (Feature 10) ──
router.use('/hooks', require('./hooks'));

// ── 多存储后端 (Feature 11) ──
router.use('/storage', require('./storage'));

// ── 用户认证 (Feature 9) ──
router.use('/auth', require('./auth'));

// ── 工作流引擎 (Feature 12) ──
router.use('/workflow', require('./workflow'));

// ── 项目标签 ──
router.use('/tags', require('./tags'));

// ── 项目模板 ──
router.use('/templates', require('./templates'));

// ── 审计日志 ──
router.use('/audit-logs', require('./audit-logs'));

// ── 文件预览 ──
router.use('/preview', require('./preview'));

// ── 复制回滚 ──
router.use('/rollback', require('./rollback'));

// ── WebDAV ──
router.use('/webdav', require('./webdav'));

// ── 设置 ──
router.get('/settings', (req, res) => res.json(shared.settings));
router.put('/settings', async (req, res) => {
  if (req.body.keyword !== undefined) shared.settings.keyword = req.body.keyword;
  try {
    await projectService.saveSettings(shared.settings);
    res.json({ success: true, settings: shared.settings });
  } catch (e) {
    res.status(500).json({ error: '保存设置失败: ' + e.message });
  }
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

router.post('/import/backup', async (req, res) => {
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
  try {
    await projectService.saveProjects(shared.projects);
    await projectService.saveSettings(shared.settings);
    res.json({ success: true, added: added.length, total: shared.projects.length });
  } catch (e) {
    res.status(500).json({ error: '导入保存失败: ' + e.message });
  }
});

// ── 文件夹浏览 ──
router.post('/pick-folder', (req, res) => {
  // 安全模式：用环境变量传递结果路径，避免脚本注入
  const os = require('os');
  const resultFile = path.join(os.tmpdir(), 'pam_pf_' + Date.now() + '.txt');

  // 将 PS 脚本 Base64 编码，避免路径中包含特殊字符导致注入
  const psScript = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$fbd = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$fbd.Description = "选择文件夹"',
    '$fbd.ShowNewFolderButton = $true',
    'if ($fbd.ShowDialog() -eq "OK") {',
    '  [System.IO.File]::WriteAllText($env:PAM_RESULT_FILE, $fbd.SelectedPath, [System.Text.Encoding]::UTF8)',
    '}'
  ].join('\n');
  const psB64 = Buffer.from('\uFEFF' + psScript, 'utf16le').toString('base64');

  try {
    execSync(
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${psB64}`,
      { timeout: 120000, windowsHide: true, env: { ...process.env, PAM_RESULT_FILE: resultFile } }
    );

    let sel = '';
    if (fs.existsSync(resultFile)) {
      sel = fs.readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, '').trim();
      try { fs.unlinkSync(resultFile); } catch (e) { /* 清理失败忽略 */ }
    }
    res.json({ success: true, path: sel });
  } catch (e) {
    // 清理残留文件
    try { if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile); } catch (_) {}
    res.json({ success: false, path: '', error: e.message || '超时或取消' });
  }
});

// ── 打开资源管理器 ──
router.post('/open-explorer', (req, res) => {
  const { path: p } = req.body;
  if (!p) return res.status(400).json({ error: '路径为空' });
  // 路径规范化，防止目录遍历攻击
  const path = require('path');
  const normalized = path.resolve(p.replace(/\//g, '\\'));
  if (!fs.existsSync(normalized)) return res.status(400).json({ error: '路径不存在: ' + normalized });
  // 用 cmd /c start 避免包含中文/特殊字符的路径被 explorer 误解
  execFile('cmd.exe', ['/c', 'start', '', 'explorer.exe', normalized], (err) => {
    if (err) console.error('explorer 失败:', normalized, err.message);
  });
  res.json({ success: true });
});

// ── 服务管理 ──
router.use('/server', require('./server'));

module.exports = router;
