const express = require('express');
const router = express.Router();
const projectService = require('../services/projectService');
const fileService = require('../services/fileService');
const importService = require('../services/importService');
const fs = require('fs');
const pathMod = require('path');

// 内存缓存
let projects = [];
let settings = { keyword: '项目归档资料', templates: [] };

// ---------- 任务管理器 ----------
const tasks = {}; // { taskId: { aborted: false } }
const sseClients = {}; // { taskId: [res, res, ...] }

function createTask() {
  const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  tasks[taskId] = { aborted: false };
  sseClients[taskId] = [];
  setTimeout(() => { delete tasks[taskId]; delete sseClients[taskId]; }, 600000); // 10分钟自动清理
  return taskId;
}

function sendSSE(taskId, data) {
  (sseClients[taskId] || []).forEach(client => {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

// 初始化：迁移旧数据并加载
projectService.migrateOldData();
projects = projectService.loadProjects();
// 补充旧数据缺失的 status 字段
projects.forEach(p => { if (!p.status) p.status = 'active'; });
settings = projectService.loadSettings();

// ==================== 项目 CRUD ====================

// 获取所有项目
router.get('/projects', (req, res) => {
  res.json(projects);
});

// 新建项目
router.post('/projects', (req, res) => {
  const { name, localDir, nasDir } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '项目名称不能为空' });
  }
  const project = {
    name: name.trim(),
    localDir: (localDir || '').trim(),
    nasDir: (nasDir || '').trim(),
    status: 'active'
  };
  projects.push(project);
  projectService.saveProjects(projects);
  res.json({ success: true, index: projects.length - 1, project });
});

// 编辑项目
router.put('/projects/:index', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) {
    return res.status(400).json({ error: '无效的项目索引' });
  }
  const { name, localDir, nasDir } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '项目名称不能为空' });
  }
  projects[idx] = {
    name: name.trim(),
    localDir: (localDir || '').trim(),
    nasDir: (nasDir || '').trim(),
    status: projects[idx].status || 'active'
  };
  projectService.saveProjects(projects);
  res.json({ success: true, project: projects[idx] });
});

// 删除项目
router.delete('/projects/:index', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) {
    return res.status(400).json({ error: '无效的项目索引' });
  }
  projects.splice(idx, 1);
  projectService.saveProjects(projects);
  res.json({ success: true });
});

// ==================== 项目检测与交付 ====================

// 检测关键词目录
router.get('/projects/:index/detect', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) {
    return res.status(400).json({ error: '无效的项目索引' });
  }
  const keyword = req.query.keyword || settings.keyword || '项目归档资料';
  const result = fileService.resolveEpisodeDirs(projects[idx], keyword);
  res.json(result);
});

// 获取待交付文件列表
router.get('/projects/:index/pending', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) {
    return res.status(400).json({ error: '无效的项目索引' });
  }
  const keyword = req.query.keyword || settings.keyword || '项目归档资料';
  const resolved = fileService.resolveEpisodeDirs(projects[idx], keyword);

  if (!resolved.relPath) {
    return res.json({ files: [], resolved });
  }

  const files = fileService.getPendingFiles(resolved.localEpDir, resolved.nasEpDir);
  res.json({ files, resolved });
});

// 复制文件到 NAS
router.post('/projects/:index/copy', async (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) {
    return res.status(400).json({ error: '无效的项目索引' });
  }

  const { fileNames, keyword, taskId } = req.body;
  const kw = keyword || settings.keyword || '项目归档资料';
  const resolved = fileService.resolveEpisodeDirs(projects[idx], kw);

  if (!resolved.relPath) {
    return res.status(400).json({ error: '未检测到关键词目录' });
  }

  if (!resolved.localExists) {
    return res.status(400).json({ error: '本地关键词目录不存在' });
  }

  // 确保 NAS 目标目录存在
  if (!fs.existsSync(resolved.nasEpDir)) {
    try { fs.mkdirSync(resolved.nasEpDir, { recursive: true }); }
    catch (err) { return res.status(400).json({ error: '无法创建 NAS 目录: ' + err.message }); }
  }

  // 初始化任务
  if (taskId && !tasks[taskId]) tasks[taskId] = { aborted: false, paused: false };

  // 逐文件复制，支持进度推送、暂停、取消
  const total = fileNames.length;
  const results = [];
  for (let i = 0; i < total; i++) {
    // 等待暂停恢复
    while (taskId && tasks[taskId] && tasks[taskId].paused && !tasks[taskId].aborted) {
      await new Promise(r => setTimeout(r, 300));
    }
    if (taskId && tasks[taskId] && tasks[taskId].aborted) break;
    const name = fileNames[i];
    try {
      fs.copyFileSync(pathMod.join(resolved.localEpDir, name), pathMod.join(resolved.nasEpDir, name));
      results.push({ name, success: true });
    } catch (err) {
      results.push({ name, success: false, error: err.message });
    }
    if (taskId) sendSSE(taskId, { type: 'progress', current: i + 1, total, file: name });
  }

  const ok = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;
  if (taskId) sendSSE(taskId, { type: 'complete', ok, fail, total, aborted: tasks[taskId] && tasks[taskId].aborted });
  res.json({ success: true, ok, fail, results, taskId });
});

// ==================== 文件操作 ====================

// 打开资源管理器
router.post('/open-explorer', async (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) {
    return res.status(400).json({ error: '路径为空' });
  }
  try {
    await fileService.openExplorer(dirPath);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== 设置管理 ====================

// 获取设置
router.get('/settings', (req, res) => {
  res.json(settings);
});

// 更新设置（关键词等）
router.put('/settings', (req, res) => {
  if (req.body.keyword !== undefined) {
    settings.keyword = req.body.keyword;
  }
  projectService.saveSettings(settings);
  res.json({ success: true, settings });
});

// ==================== 批量导入 ====================

// 扫描本地根目录
router.post('/import/scan', (req, res) => {
  const { localRoot } = req.body;
  const existingNames = projects.map(p => p.name);
  const result = importService.scanLocalRoot(localRoot, existingNames);
  res.json(result);
});

// 获取部门模板
router.get('/import/templates', (req, res) => {
  res.json(settings.templates || []);
});

// 保存部门模板
router.put('/import/templates', (req, res) => {
  const { templates } = req.body;
  if (!Array.isArray(templates)) {
    return res.status(400).json({ error: 'templates 必须是数组' });
  }
  settings.templates = templates;
  projectService.saveSettings(settings);
  res.json({ success: true, templates: settings.templates });
});

// 批量导入项目
router.post('/import/batch', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items 不能为空' });
  }

  const added = [];
  for (const item of items) {
    if (!item.name || !item.localDir) continue;
    // 检查重名
    if (projects.some(p => p.name === item.name)) continue;
    const project = {
      name: item.name.trim(),
      localDir: (item.localDir || '').trim(),
      nasDir: (item.nasDir || '').trim(),
      status: 'active'
    };
    projects.push(project);
    added.push(project);
  }

  projectService.saveProjects(projects);
  res.json({ success: true, added: added.length, projects: added });
});

// ==================== 上映单集版 - 修改交付 ====================
// 列出上映单集版下的所有子文件夹（修改批次），整个文件夹复制到NAS

router.get('/projects/:index/modify-batches', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) {
    return res.status(400).json({ error: '无效的项目索引' });
  }
  const keyword = req.query.keyword || '上映单集版';
  const p = projects[idx];
  const fs = require('fs');
  const pathMod = require('path');

  const rel = fileService.findKeywordDir(p.localDir, keyword) || fileService.findKeywordDir(p.nasDir, keyword);
  if (!rel) return res.json({ found: false, keyword, batches: [] });

  const localKwDir = pathMod.join(p.localDir, rel);
  const nasKwDir = pathMod.join(p.nasDir, rel);
  const nasKwExists = fs.existsSync(nasKwDir);

  const batches = [];
  if (fs.existsSync(localKwDir)) {
    try {
      const dirs = fs.readdirSync(localKwDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .sort((a, b) => b.name.localeCompare(a.name));

      for (const d of dirs) {
        const localBatchDir = pathMod.join(localKwDir, d.name);
        const nasBatchDir = pathMod.join(nasKwDir, d.name);
        const nasBatchExists = nasKwExists && fs.existsSync(nasBatchDir);

        let localFileCount = 0, nasFileCount = 0;
        try { localFileCount = countFiles(localBatchDir); } catch {}
        if (nasBatchExists) {
          try { nasFileCount = countFiles(nasBatchDir); } catch {}
        }
        batches.push({ name: d.name, localPath: localBatchDir, nasPath: nasBatchDir, localFileCount, nasExists: nasBatchExists, nasFileCount });
      }
    } catch {}
  }

  res.json({ found: true, keyword, kwRelPath: rel, localKwDir, nasKwDir, batches });
});

router.post('/projects/:index/modify-copy-batch', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) {
    return res.status(400).json({ error: '无效的项目索引' });
  }
  const { batchNames, keyword } = req.body;
  if (!Array.isArray(batchNames) || batchNames.length === 0) {
    return res.status(400).json({ error: '请指定要复制的批次' });
  }
  const kw = keyword || '上映单集版';
  const p = projects[idx];
  const fs = require('fs');
  const pathMod = require('path');

  const rel = fileService.findKeywordDir(p.localDir, kw) || fileService.findKeywordDir(p.nasDir, kw);
  if (!rel) return res.status(400).json({ error: '未找到含"' + kw + '"的目录' });

  const localKwDir = pathMod.join(p.localDir, rel);
  const nasKwDir = pathMod.join(p.nasDir, rel);

  if (!fs.existsSync(nasKwDir)) {
    try { fs.mkdirSync(nasKwDir, { recursive: true }); }
    catch (err) { return res.status(400).json({ error: '无法创建NAS目录: ' + err.message }); }
  }

  const results = [];
  for (const batchName of batchNames) {
    const src = pathMod.join(localKwDir, batchName);
    const dst = pathMod.join(nasKwDir, batchName);
    if (!fs.existsSync(src)) { results.push({ name: batchName, success: false, error: '本地批次不存在' }); continue; }
    try {
      copyDirRecursive(src, dst);
      const fileCount = countFiles(dst);
      results.push({ name: batchName, success: true, fileCount });
    } catch (err) {
      results.push({ name: batchName, success: false, error: err.message });
    }
  }
  const ok = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;
  res.json({ success: true, ok, fail, results });
});

function copyDirRecursive(src, dst) {
  const fs = require('fs');
  const pathMod = require('path');
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const sp = pathMod.join(src, entry.name);
    const dp = pathMod.join(dst, entry.name);
    entry.isDirectory() ? copyDirRecursive(sp, dp) : fs.copyFileSync(sp, dp);
  }
}

function countFiles(dir) {
  const fs = require('fs');
  const pathMod = require('path');
  if (!fs.existsSync(dir)) return 0;
  let c = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) e.isDirectory() ? c += countFiles(pathMod.join(dir, e.name)) : c++;
  return c;
}

// ==================== 任务进度 SSE ====================
router.get('/task-progress/:taskId', (req, res) => {
  const { taskId } = req.params;
  // 自动初始化（前端可能先连 SSE 再发复制请求）
  if (!sseClients[taskId]) {
    sseClients[taskId] = [];
    tasks[taskId] = { aborted: false, paused: false };
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  sseClients[taskId].push(res);
  req.on('close', () => {
    sseClients[taskId] = (sseClients[taskId] || []).filter(c => c !== res);
  });
});

router.post('/task-cancel/:taskId', (req, res) => {
  const { taskId } = req.params;
  if (tasks[taskId]) {
    tasks[taskId].aborted = true;
    sendSSE(taskId, { type: 'cancelled' });
    res.json({ success: true });
  } else {
    res.json({ success: false, error: '任务不存在' });
  }
});

router.post('/task-pause/:taskId', (req, res) => {
  const { taskId } = req.params;
  if (tasks[taskId]) {
    tasks[taskId].paused = !tasks[taskId].paused;
    sendSSE(taskId, { type: tasks[taskId].paused ? 'paused' : 'resumed' });
    res.json({ success: true, paused: tasks[taskId].paused });
  } else {
    res.json({ success: false, error: '任务不存在' });
  }
});

router.put('/projects/:index/status', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) {
    return res.status(400).json({ error: '无效的项目索引' });
  }
  const { status } = req.body;
  if (!['active', 'done'].includes(status)) {
    return res.status(400).json({ error: '状态值无效' });
  }
  projects[idx].status = status;
  projectService.saveProjects(projects);
  res.json({ success: true, status });
});

module.exports = router;
