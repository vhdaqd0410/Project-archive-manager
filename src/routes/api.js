const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const projectService = require('../services/projectService');
const fileService = require('../services/fileService');
const importService = require('../services/importService');

let projects = [];
let settings = { keyword: '项目归档资料', templates: [] };

projectService.migrateOldData();
projects = projectService.loadProjects();
settings = projectService.loadSettings();
projects.forEach(p => { if (!p.status) p.status = 'editing'; });

// ==================== 项目 CRUD ====================
router.get('/projects', (req, res) => res.json(projects));

router.post('/projects', (req, res) => {
  const { name, localDir, nasDir } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '项目名称不能为空' });
  const p = { name: name.trim(), localDir: (localDir||'').trim(), nasDir: (nasDir||'').trim(), status: 'editing' };
  projects.push(p); projectService.saveProjects(projects);
  res.json({ success: true, index: projects.length - 1, project: p });
});

router.put('/projects/:index', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) return res.status(400).json({ error: '无效索引' });
  const { name, localDir, nasDir, status } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '名称不能为空' });
  projects[idx] = { name: name.trim(), localDir: (localDir||'').trim(), nasDir: (nasDir||'').trim(), status: status || projects[idx].status || 'active' };
  projectService.saveProjects(projects);
  res.json({ success: true, project: projects[idx] });
});

router.put('/projects/:index/status', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) return res.status(400).json({ error: '无效索引' });
  const { status } = req.body;
  if (!['editing', 'modifying', 'done'].includes(status)) return res.status(400).json({ error: '无效状态' });
  projects[idx].status = status; projectService.saveProjects(projects);
  res.json({ success: true });
});

router.delete('/projects/:index', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) return res.status(400).json({ error: '无效索引' });
  projects.splice(idx, 1); projectService.saveProjects(projects);
  res.json({ success: true });
});

// ==================== 检测 & 交付 ====================
router.get('/projects/:index/detect', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) return res.status(400).json({ error: '无效索引' });
  const keyword = req.query.keyword || settings.keyword || '项目归档资料';
  res.json(fileService.resolveEpisodeDirs(projects[idx], keyword));
});

router.get('/projects/:index/pending', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) return res.status(400).json({ error: '无效索引' });
  const keyword = req.query.keyword || settings.keyword || '项目归档资料';
  const r = fileService.resolveEpisodeDirs(projects[idx], keyword);
  if (!r.relPath) return res.json({ files: [], resolved: r });
  res.json({ files: fileService.getPendingFiles(r.localEpDir, r.nasEpDir), resolved: r });
});

router.post('/projects/:index/copy', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) return res.status(400).json({ error: '无效索引' });
  const { fileNames, keyword } = req.body;
  const kw = keyword || settings.keyword || '项目归档资料';
  const r = fileService.resolveEpisodeDirs(projects[idx], kw);
  if (!r.relPath) return res.status(400).json({ error: '未检测到关键词目录' });
  if (!r.localExists) return res.status(400).json({ error: '本地不存在' });
  if (!fs.existsSync(r.nasEpDir)) fs.mkdirSync(r.nasEpDir, { recursive: true });
  const results = [];
  let ok = 0, fail = 0;
  for (const f of (Array.isArray(fileNames) ? fileNames : [])) {
    try {
      fs.copyFileSync(path.join(r.localEpDir, f), path.join(r.nasEpDir, f));
      ok++; results.push({ file: f, success: true });
    } catch(e) { fail++; results.push({ file: f, success: false }); }
  }
  res.json({ success: true, ok, fail, results, nasDir: r.nasEpDir });
});

// ==================== 设置 ====================
router.get('/settings', (req, res) => res.json(settings));
router.put('/settings', (req, res) => {
  if (req.body.keyword !== undefined) settings.keyword = req.body.keyword;
  projectService.saveSettings(settings); res.json({ success: true, settings });
});

// ==================== 文件操作 ====================
router.post('/open-explorer', (req, res) => {
  const { path: p } = req.body;
  if (!p) return res.status(400).json({ error: '路径为空' });
  require('child_process').execFile('explorer.exe', [p]);
  res.json({ success: true });
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
    const p = { name: item.name.trim(), localDir: item.localDir.trim(), nasDir: (item.nasDir||'').trim(), status: 'editing' };
    projects.push(p); added.push(p);
  }
  projectService.saveProjects(projects);
  res.json({ success: true, added: added.length });
});

// ==================== 上映单集版 ====================
router.get('/projects/:index/modify-batches', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) return res.status(400).json({ error: '无效索引' });
  const keyword = req.query.keyword || '上映单集版';
  const p = projects[idx];
  const rel = fileService.findKeywordDir(p.localDir, keyword) || fileService.findKeywordDir(p.nasDir, keyword);
  if (!rel) return res.json({ found: false, keyword, batches: [] });
  const localKw = path.join(p.localDir, rel);
  const nasKw = path.join(p.nasDir, rel);
  const batches = [];
  if (fs.existsSync(localKw)) {
    const dirs = fs.readdirSync(localKw, { withFileTypes: true }).filter(d => d.isDirectory()).sort((a,b) => b.name.localeCompare(a.name));
    for (const d of dirs) {
      const lb = path.join(localKw, d.name);
      const nb = path.join(nasKw, d.name);
      const ne = fs.existsSync(nb);
      let lc = 0;
      function countFiles(dir) { if(!fs.existsSync(dir))return 0;let c=0;for(const e of fs.readdirSync(dir,{withFileTypes:true}))c+=e.isDirectory()?countFiles(path.join(dir,e.name)):1;return c; }
      try { lc = countFiles(lb); } catch {}
      batches.push({ name: d.name, localPath: lb, nasPath: nb, localFileCount: lc, nasExists: ne });
    }
  }
  res.json({ found: true, keyword, kwRelPath: rel, localKwDir: localKw, nasKwDir: nasKw, batches });
});

router.post('/projects/:index/modify-copy-batch', (req, res) => {
  const idx = parseInt(req.params.index);
  if (isNaN(idx) || idx < 0 || idx >= projects.length) return res.status(400).json({ error: '无效索引' });
  const { batchNames, keyword } = req.body;
  if (!Array.isArray(batchNames) || batchNames.length === 0) return res.status(400).json({ error: '请指定批次' });
  const kw = keyword || '上映单集版';
  const p = projects[idx];
  const rel = fileService.findKeywordDir(p.localDir, kw) || fileService.findKeywordDir(p.nasDir, kw);
  if (!rel) return res.status(400).json({ error: '未找到目录' });
  const lk = path.join(p.localDir, rel);
  const nk = path.join(p.nasDir, rel);
  if (!fs.existsSync(nk)) fs.mkdirSync(nk, { recursive: true });
  const results = [];
  let ok = 0, fail = 0;
  for (const name of batchNames) {
    try {
      fileService.copyDirRecursive(path.join(lk, name), path.join(nk, name));
      ok++; results.push({ name, success: true });
    } catch { fail++; results.push({ name, success: false }); }
  }
  res.json({ success: true, ok, fail, results, nasDir: nk });
});

// 递归复制
fileService.copyDirRecursive = function(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, e.name), dp = path.join(dst, e.name);
    e.isDirectory() ? fileService.copyDirRecursive(sp, dp) : fs.copyFileSync(sp, dp);
  }
};

// 统计文件数
function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let c = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }))
    c += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  return c;
}

module.exports = router;
