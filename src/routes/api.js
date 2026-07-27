const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execSync, execFile } = require('child_process');
const crypto = require('crypto');
const projectService = require('../services/projectService');
const fileService = require('../services/fileService');
const importService = require('../services/importService');

let projects = [];
let settings = { keyword: '项目归档资料', templates: [] };

// ==================== 后台任务系统 ====================
const runningJobs = {};

function createJob(projectId, projectName, totalItems, type) {
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId, projectId, projectName, type, totalItems,
    current: 0, completed: 0, failed: 0, skipped: 0,
    status: 'pending', // pending | running | done | cancelled
    startTime: null, endTime: null,
    items: new Array(totalItems).fill({ name: '', state: 'pending' }),
    cancel: false
  };
  runningJobs[jobId] = job;
  // 最多保留 20 个已完成任务
  const keys = Object.keys(runningJobs);
  if (keys.length > 20) {
    const doneKeys = keys.filter(k => runningJobs[k].status === 'done');
    for (const k of doneKeys.slice(0, doneKeys.length - 5)) delete runningJobs[k];
  }
  return job;
}

function updateJobProgress(job, idx, itemName, result) {
  job.current = idx + 1;
  job.items[idx] = { name: itemName, state: result };
  if (result === 'ok') job.completed++;
  else if (result === 'skip') job.skipped++;
  else if (result === 'fail') job.failed++;
}

function finishJob(job, status, resultData) {
  job.status = status;
  job.endTime = Date.now();
  Object.assign(job, resultData);
}

// ==================== 任务状态查询 ====================
router.get('/jobs/:jobId', (req, res) => {
  const job = runningJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: '任务不存在或已过期' });
  res.json({
    id: job.id, projectName: job.projectName, type: job.type,
    totalItems: job.totalItems, current: job.current,
    completed: job.completed, failed: job.failed, skipped: job.skipped,
    status: job.status,
    currentItem: job.current <= job.totalItems ? (job.items[job.current - 1] || {}) : {},
    elapsed: job.startTime ? ((job.endTime || Date.now()) - job.startTime) : 0
  });
});

router.post('/jobs/:jobId/cancel', (req, res) => {
  const job = runningJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: '任务不存在' });
  if (job.status !== 'pending' && job.status !== 'running') {
    return res.status(400).json({ error: '任务已完成，无法取消' });
  }
  job.cancel = true;
  res.json({ success: true });
});

projects = projectService.loadProjects();
settings = projectService.loadSettings();
projects.forEach(p => {
  if (!p.status) p.status = 'editing';
  if (!p.id) p.id = crypto.randomUUID();
  if (!p.memo) p.memo = '';
});

// ==================== 项目 CRUD ====================
router.get('/projects', (req, res) => res.json(projects));

router.post('/projects', (req, res) => {
  const { name, localDir, nasDir, memo } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '项目名称不能为空' });
  const p = {
    id: crypto.randomUUID(),
    name: name.trim(),
    localDir: (localDir || '').trim(),
    nasDir: (nasDir || '').trim(),
    memo: (memo || '').trim(),
    status: 'editing'
  };
  projects.push(p); projectService.saveProjects(projects);
  res.json({ success: true, project: p });
});

router.put('/projects/:id', (req, res) => {
  const idx = findIndexById(req.params.id);
  if (idx < 0) return res.status(404).json({ error: '项目不存在' });
  const { name, localDir, nasDir, status, memo } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '名称不能为空' });
  projects[idx] = {
    ...projects[idx],
    name: name.trim(),
    localDir: (localDir || '').trim(),
    nasDir: (nasDir || '').trim(),
    memo: memo !== undefined ? (memo || '').trim() : (projects[idx].memo || ''),
    status: status || projects[idx].status || 'editing'
  };
  projectService.saveProjects(projects);
  res.json({ success: true, project: projects[idx] });
});

router.put('/projects/:id/status', (req, res) => {
  const idx = findIndexById(req.params.id);
  if (idx < 0) return res.status(404).json({ error: '项目不存在' });
  const { status } = req.body;
  if (!['editing', 'modifying', 'done'].includes(status)) return res.status(400).json({ error: '无效状态' });
  projects[idx].status = status; projectService.saveProjects(projects);
  res.json({ success: true });
});

router.delete('/projects/:id', (req, res) => {
  const idx = findIndexById(req.params.id);
  if (idx < 0) return res.status(404).json({ error: '项目不存在' });
  projects.splice(idx, 1); projectService.saveProjects(projects);
  res.json({ success: true });
});

// ==================== 兼容旧索引路由 ====================
function findIndexById(id) {
  // 先按 id 查找
  const byId = projects.findIndex(p => p.id === id);
  if (byId >= 0) return byId;
  // 兼容旧数字索引
  const num = parseInt(id);
  if (!isNaN(num) && num >= 0 && num < projects.length) return num;
  return -1;
}

function getProjectById(id) {
  const idx = findIndexById(id);
  return idx >= 0 ? { project: projects[idx], index: idx } : null;
}

// ==================== 单文件复制（含进度） ====================
router.post('/projects/:id/copy', (req, res) => {
  const r = getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { fileNames, keyword } = req.body;
  const kw = keyword || settings.keyword || '项目归档资料';
  const resolved = fileService.resolveEpisodeDirs(r.project, kw);
  if (!resolved.relPath) return res.status(400).json({ error: '未检测到关键词目录' });
  if (!resolved.localExists) return res.status(400).json({ error: '本地不存在' });
  if (!fs.existsSync(resolved.nasEpDir)) fs.mkdirSync(resolved.nasEpDir, { recursive: true });

  const list = Array.isArray(fileNames) ? fileNames : [];
  const job = createJob(r.project.id, r.project.name, list.length, '单文件复制');
  job.startTime = Date.now();
  job.status = 'running';
  let ok = 0, fail = 0, skip = 0, totalBytes = 0;

  for (let i = 0; i < list.length; i++) {
    if (job.cancel) break;
    const f = list[i];
    const src = path.join(resolved.localEpDir, f);
    const dst = path.join(resolved.nasEpDir, f);
    try {
      const srcStat = fs.statSync(src);
      if (fs.existsSync(dst) && fs.statSync(dst).size === srcStat.size) {
        skip++;
        updateJobProgress(job, i, f, 'skip');
        continue;
      }
      fs.copyFileSync(src, dst);
      totalBytes += srcStat.size;
      ok++;
      updateJobProgress(job, i, f, 'ok');
    } catch (e) {
      console.error(`复制失败: ${f}`, e.message);
      fail++;
      updateJobProgress(job, i, f, 'fail');
    }
  }
  const finalStatus = job.cancel ? 'cancelled' : 'done';
  finishJob(job, finalStatus, { nasDir: resolved.nasEpDir, totalBytes });
  projectService.addDeliveryLog(r.project.name, r.project.id, '单文件复制', `关键词: ${kw}, 文件数: ${list.length}`, ok, fail);
  res.json({ success: true, jobId: job.id, totalItems: list.length });
});

// ==================== 检测 ====================
router.get('/projects/:id/detect', (req, res) => {
  const r = getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const keyword = req.query.keyword || settings.keyword || '项目归档资料';
  res.json(fileService.resolveEpisodeDirs(r.project, keyword));
});

router.get('/projects/:id/pending', (req, res) => {
  const r = getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const keyword = req.query.keyword || settings.keyword || '项目归档资料';
  const resolved = fileService.resolveEpisodeDirs(r.project, keyword);
  if (!resolved.relPath) return res.json({ files: [], resolved });
  res.json({ files: fileService.getPendingFiles(resolved.localEpDir, resolved.nasEpDir), resolved });
});

// ==================== 设置 ====================
router.get('/settings', (req, res) => res.json(settings));
router.put('/settings', (req, res) => {
  if (req.body.keyword !== undefined) settings.keyword = req.body.keyword;
  projectService.saveSettings(settings); res.json({ success: true, settings });
});

// ==================== NAS 连通性检测 ====================
router.get('/projects/:id/check-nas', (req, res) => {
  const r = getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const nasDir = r.project.nasDir;
  const result = { accessible: false, path: nasDir, error: null };
  if (!nasDir) {
    result.error = 'NAS 路径未配置';
    return res.json(result);
  }
  try {
    result.accessible = fs.existsSync(nasDir);
    if (!result.accessible) result.error = '路径不可访问（网络盘可能已断连）';
  } catch (e) {
    result.error = e.message;
  }
  res.json(result);
});

// ==================== 交付历史 ====================
router.get('/delivery-log', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const logs = projectService.loadDeliveryLog();
  res.json(logs.slice(0, limit));
});

// ==================== 文件操作 ====================
router.post('/open-explorer', (req, res) => {
  const { path: p } = req.body;
  if (!p) return res.status(400).json({ error: '路径为空' });
  // 使用 execFile 传参数数组，避免 shell 转义导致路径损坏
  execFile('explorer.exe', [p], (err) => {
    if (err) console.error(`打开资源管理器失败: ${p}`, err.message);
  });
  res.json({ success: true });
});

router.post('/pick-folder', (req, res) => {
  try {
    const os = require('os');
    const baseName = 'pam_pf_' + Date.now();
    const vbsFile = path.join(os.tmpdir(), baseName + '.vbs');
    const resultFile = path.join(os.tmpdir(), baseName + '_r.txt');

    const vbs = [
      'Set sa = CreateObject("Shell.Application")',
      'Set f  = sa.BrowseForFolder(0, "Select Folder", 81, 0)',
      'If Not f Is Nothing Then',
      '  Set fs = CreateObject("Scripting.FileSystemObject")',
      '  fs.CreateTextFile("' + resultFile.replace(/\\/g, '\\\\') + '", True).Write f.Self.Path',
      'End If'
    ].join('\r\n');
    fs.writeFileSync(vbsFile, vbs, 'utf8');

    // 独立启动：CMD 窗口最小化，wscript 的对话框有可见宿主不会闪退
    execSync('start "PickFolder" /min cmd /c wscript.exe "' + vbsFile + '"', { timeout: 3000 });

    // 轮询结果
    let tries = 0;
    const poll = () => {
      tries++;
      if (fs.existsSync(resultFile)) {
        const sel = fs.readFileSync(resultFile, 'utf8').trim();
        try { fs.unlinkSync(resultFile); } catch(e) {}
        try { fs.unlinkSync(vbsFile); } catch(e) {}
        return res.json({ success: true, path: sel });
      }
      if (tries > 90) {
        try { fs.unlinkSync(vbsFile); } catch(e) {}
        return res.json({ success: false, path: '', error: '超时或未选择' });
      }
      setTimeout(poll, 1000);
    };
    setTimeout(poll, 500);
  } catch(e) { res.json({ success: false, path: '', error: e.message }); }
});

// ==================== 批量导入 ====================
router.post('/import/scan', (req, res) => {
  const result = importService.scanLocalRoot(req.body.localRoot, projects.map(p => p.name));
  res.json(result);
});

router.get('/import/templates', (req, res) => res.json(settings.templates || []));
router.put('/import/templates', (req, res) => {
  if (!Array.isArray(req.body.templates)) return res.status(400).json({ error: 'templates 必须是数组' });
  settings.templates = req.body.templates; projectService.saveSettings(settings);
  res.json({ success: true });
});

router.post('/import/batch', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items 不能为空' });
  const added = [];
  for (const item of items) {
    if (!item.name || !item.localDir) continue;
    if (projects.some(p => p.name === item.name)) continue;
    const p = {
      id: crypto.randomUUID(),
      name: item.name.trim(),
      localDir: item.localDir.trim(),
      nasDir: (item.nasDir || '').trim(),
      status: 'editing'
    };
    projects.push(p); added.push(p);
  }
  projectService.saveProjects(projects);
  res.json({ success: true, added: added.length });
});

// ==================== 上映单集版 & 000交付 ====================

router.get('/projects/:id/modify-batches', (req, res) => {
  const r = getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const keyword = req.query.keyword || '上映单集版';
  const p = r.project;
  const rel = fileService.findKeywordDir(p.localDir, keyword) || fileService.findKeywordDir(p.nasDir, keyword);
  if (!rel) return res.json({ found: false, keyword, batches: [] });
  const localKw = path.join(p.localDir, rel);
  const nasKw = path.join(p.nasDir, rel);
  const batches = [];
  if (fs.existsSync(localKw)) {
    const dirs = fs.readdirSync(localKw, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name));
    for (const d of dirs) {
      const lb = path.join(localKw, d.name);
      const nb = path.join(nasKw, d.name);
      const ne = fs.existsSync(nb);
      const lc = fileService.countFilesRecursive(lb);
      batches.push({ name: d.name, localPath: lb, nasPath: nb, localFileCount: lc, nasExists: ne });
    }
  }
  res.json({ found: true, keyword, kwRelPath: rel, localKwDir: localKw, nasKwDir: nasKw, batches });
});

router.post('/projects/:id/modify-copy-batch', (req, res) => {
  const r = getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { batchNames, keyword } = req.body;
  if (!Array.isArray(batchNames) || batchNames.length === 0) return res.status(400).json({ error: '请指定批次' });
  const kw = keyword || '上映单集版';
  const p = r.project;
  const rel = fileService.findKeywordDir(p.localDir, kw) || fileService.findKeywordDir(p.nasDir, kw);
  if (!rel) return res.status(400).json({ error: '未找到目录' });
  const lk = path.join(p.localDir, rel);
  const nk = path.join(p.nasDir, rel);
  if (!fs.existsSync(nk)) fs.mkdirSync(nk, { recursive: true });

  const job = createJob(p.id, p.name, batchNames.length, kw + '交付');
  job.startTime = Date.now();
  job.status = 'running';
  let ok = 0, fail = 0;

  for (let i = 0; i < batchNames.length; i++) {
    if (job.cancel) break;
    const name = batchNames[i];
    try {
      fileService.copyDirRecursive(path.join(lk, name), path.join(nk, name));
      ok++;
      updateJobProgress(job, i, name, 'ok');
    } catch(e) {
      console.error(`复制批次失败: ${name}`, e.message);
      fail++;
      updateJobProgress(job, i, name, 'fail');
    }
  }
  const finalStatus = job.cancel ? 'cancelled' : 'done';
  finishJob(job, finalStatus, { nasDir: nk });
  projectService.addDeliveryLog(p.name, p.id, '批次复制', `关键词: ${kw}, 批次: ${batchNames.join(', ')}`, ok, fail);
  res.json({ success: true, jobId: job.id, totalItems: batchNames.length });
});

// ==================== 导出/导入配置 ====================
router.get('/export/backup', (req, res) => {
  const backup = {
    exportedAt: new Date().toISOString(),
    version: '2.0',
    projects,
    settings,
    deliveryLog: projectService.loadDeliveryLog()
  };
  const filename = `项目档案管理器备份_${new Date().toISOString().slice(0,10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.json(backup);
});

router.post('/import/backup', (req, res) => {
  const { projects: importedProjects, settings: importedSettings } = req.body;
  if (!Array.isArray(importedProjects)) return res.status(400).json({ error: '无效的备份数据' });
  const added = [];
  for (const p of importedProjects) {
    if (projects.some(ex => ex.name === p.name)) continue;
    p.id = crypto.randomUUID();
    if (!p.status) p.status = 'editing';
    if (!p.memo) p.memo = '';
    projects.push(p);
    added.push(p);
  }
  if (importedSettings && importedSettings.templates) {
    for (const t of importedSettings.templates) {
      if (!settings.templates.some(ex => ex.name === t.name)) settings.templates.push(t);
    }
  }
  projectService.saveProjects(projects);
  projectService.saveSettings(settings);
  res.json({ success: true, added: added.length, total: projects.length });
});

// ==================== 服务管理 ====================
const serverStartTime = Date.now();
const SERVER_PORT = process.env.PORT || 37890;

router.get('/server/status', (req, res) => {
  const uptime = Math.floor((Date.now() - serverStartTime) / 1000);
  const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60), s = uptime % 60;
  const uptimeStr = (h > 0 ? h + '时' : '') + (m > 0 ? m + '分' : '') + s + '秒';
  res.json({ running: true, pid: process.pid, port: SERVER_PORT, uptime: uptimeStr, startedAt: new Date(serverStartTime).toLocaleString('zh-CN') });
});

router.post('/server/restart', (req, res) => {
  res.json({ success: true, message: '服务即将重启，页面将在 3 秒后自动刷新...' });
  // 1.5秒后启动新进程并退出当前进程
  setTimeout(() => {
    const serverPath = path.join(__dirname, '..', '..', 'server.js');
    const child = require('child_process').spawn('node', [serverPath], {
      detached: true,
      stdio: 'inherit',
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, RESTARTED: '1' }
    });
    child.unref();
    process.exit(0);
  }, 1500);
});

router.post('/server/stop', (req, res) => {
  res.json({ success: true, message: '服务正在关闭...' });
  setTimeout(() => {
    console.log('🛑 收到网页端关闭指令，正在退出...');
    process.exit(0);
  }, 200);
});

module.exports = router;
