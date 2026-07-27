const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const projectService = require('../services/projectService');
const fileService = require('../services/fileService');
const shared = require('./shared');
const { createJob, updateJobProgress, finishJob } = require('./jobs');

// ==================== CRUD ====================
router.get('/', (req, res) => res.json(shared.projects));

router.post('/', (req, res) => {
  const { name, localDir, nasDir, memo, episodeTarget } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '项目名称不能为空' });
  const p = {
    id: crypto.randomUUID(),
    name: name.trim(),
    localDir: (localDir || '').trim(),
    nasDir: (nasDir || '').trim(),
    memo: (memo || '').trim(),
    status: 'editing',
    createdAt: new Date().toISOString(),
    episodeTarget: parseInt(episodeTarget) || 0
  };
  shared.projects.push(p); projectService.saveProjects(shared.projects);
  res.json({ success: true, project: p });
});

router.put('/:id', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { name, localDir, nasDir, status, memo, episodeTarget } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '名称不能为空' });
  shared.projects[r.index] = {
    ...shared.projects[r.index],
    name: name.trim(),
    localDir: (localDir || '').trim(),
    nasDir: (nasDir || '').trim(),
    memo: memo !== undefined ? (memo || '').trim() : (shared.projects[r.index].memo || ''),
    episodeTarget: episodeTarget !== undefined ? (parseInt(episodeTarget) || 0) : (shared.projects[r.index].episodeTarget || 0),
    status: status || shared.projects[r.index].status || 'editing'
  };
  projectService.saveProjects(shared.projects);
  res.json({ success: true, project: shared.projects[r.index] });
});

router.put('/:id/status', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { status } = req.body;
  if (!['editing', 'modifying', 'done'].includes(status)) return res.status(400).json({ error: '无效状态' });
  shared.projects[r.index].status = status;
  projectService.saveProjects(shared.projects);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  shared.projects.splice(r.index, 1);
  projectService.saveProjects(shared.projects);
  res.json({ success: true });
});

// ==================== 检测 ====================
router.get('/:id/detect', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const keyword = req.query.keyword || shared.settings.keyword || '项目归档资料';
  res.json(fileService.resolveEpisodeDirs(r.project, keyword));
});

router.get('/:id/pending', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const keyword = req.query.keyword || shared.settings.keyword || '项目归档资料';
  const resolved = fileService.resolveEpisodeDirs(r.project, keyword);
  if (!resolved.relPath) return res.json({ files: [], resolved });
  res.json({ files: fileService.getPendingFiles(resolved.localEpDir, resolved.nasEpDir), resolved });
});

router.get('/:id/check-nas', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const nasDir = r.project.nasDir;
  const result = { accessible: false, path: nasDir, error: null };
  if (!nasDir) { result.error = 'NAS 路径未配置'; return res.json(result); }
  try {
    result.accessible = fs.existsSync(nasDir);
    if (!result.accessible) result.error = '路径不可访问（网络盘可能已断连）';
  } catch (e) { result.error = e.message; }
  res.json(result);
});

// ==================== 复制 ====================
router.post('/:id/copy', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { fileNames, keyword } = req.body;
  const kw = keyword || shared.settings.keyword || '项目归档资料';
  const resolved = fileService.resolveEpisodeDirs(r.project, kw);
  if (!resolved.relPath) return res.status(400).json({ error: '未检测到关键词目录' });
  if (!resolved.localExists) return res.status(400).json({ error: '本地不存在' });
  if (!fs.existsSync(resolved.nasEpDir)) fs.mkdirSync(resolved.nasEpDir, { recursive: true });

  const list = Array.isArray(fileNames) ? fileNames : [];
  const job = createJob(r.project.id, r.project.name, list.length, '单文件复制');
  job.startTime = Date.now();
  res.json({ success: true, jobId: job.id, totalItems: list.length });

  job.status = 'running';
  let ok = 0, fail = 0, skip = 0, totalBytes = 0;
  for (let i = 0; i < list.length; i++) {
    if (job.cancel) break;
    const f = list[i];
    const src = path.join(resolved.localEpDir, f);
    const dst = path.join(resolved.nasEpDir, f);
    try {
      const srcStat = fs.statSync(src);
      if (fs.existsSync(dst) && fs.statSync(dst).size === srcStat.size) { skip++; updateJobProgress(job, i, f, 'skip'); continue; }
      fs.copyFileSync(src, dst);
      totalBytes += srcStat.size; ok++;
      updateJobProgress(job, i, f, 'ok');
    } catch (e) { fail++; updateJobProgress(job, i, f, 'fail'); }
  }
  finishJob(job, job.cancel ? 'cancelled' : 'done', { nasDir: resolved.nasEpDir, totalBytes });
  projectService.addDeliveryLog(r.project.name, r.project.id, '单文件复制', `关键词: ${kw}, 文件数: ${list.length}`, ok, fail);
});

// ==================== 修改 / 000 交付 ====================
router.get('/:id/modify-batches', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const keyword = req.query.keyword || '上映单集版';
  const p = r.project;
  const rel = fileService.findKeywordDir(p.localDir, keyword) || fileService.findKeywordDir(p.nasDir, keyword);
  if (!rel) return res.json({ found: false, keyword, batches: [] });
  const localKw = path.join(p.localDir, rel);
  const nasKw = path.join(p.nasDir, rel);
  const batches = [];
  if (fs.existsSync(localKw)) {
    const dirs = fs.readdirSync(localKw, { withFileTypes: true }).filter(d => d.isDirectory()).sort((a, b) => b.name.localeCompare(a.name));
    for (const d of dirs) {
      batches.push({
        name: d.name, localPath: path.join(localKw, d.name), nasPath: path.join(nasKw, d.name),
        localFileCount: fileService.countFilesRecursive(path.join(localKw, d.name)),
        nasExists: fs.existsSync(path.join(nasKw, d.name))
      });
    }
  }
  res.json({ found: true, keyword, kwRelPath: rel, localKwDir: localKw, nasKwDir: nasKw, batches });
});

router.post('/:id/modify-copy-batch', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { batchNames, keyword } = req.body;
  if (!Array.isArray(batchNames) || !batchNames.length) return res.status(400).json({ error: '请指定批次' });
  const kw = keyword || '上映单集版';
  const p = r.project;
  const rel = fileService.findKeywordDir(p.localDir, kw) || fileService.findKeywordDir(p.nasDir, kw);
  if (!rel) return res.status(400).json({ error: '未找到目录' });
  const lk = path.join(p.localDir, rel), nk = path.join(p.nasDir, rel);
  if (!fs.existsSync(nk)) fs.mkdirSync(nk, { recursive: true });

  const job = createJob(p.id, p.name, batchNames.length, kw + '交付');
  job.startTime = Date.now();
  res.json({ success: true, jobId: job.id, totalItems: batchNames.length });

  job.status = 'running';
  let ok = 0, fail = 0;
  for (let i = 0; i < batchNames.length; i++) {
    if (job.cancel) break;
    try { fileService.copyDirRecursive(path.join(lk, batchNames[i]), path.join(nk, batchNames[i])); ok++; updateJobProgress(job, i, batchNames[i], 'ok'); }
    catch (e) { fail++; updateJobProgress(job, i, batchNames[i], 'fail'); }
  }
  finishJob(job, job.cancel ? 'cancelled' : 'done', { nasDir: nk });
  projectService.addDeliveryLog(p.name, p.id, '批次复制', `关键词: ${kw}, 批次: ${batchNames.join(', ')}`, ok, fail);
});

// ==================== 集数监控 ====================
const VIDEO_EXTS = new Set(['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts']);

function countVideoFiles(dir) {
  if (!dir || !fs.existsSync(dir)) return 0;
  let count = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) count++;
    }
  } catch (e) {}
  return count;
}

function countVideoFilesRecursive(dir) {
  if (!dir || !fs.existsSync(dir)) return 0;
  let count = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) count += countVideoFilesRecursive(path.join(dir, e.name));
      else if (VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) count++;
    }
  } catch (e) {}
  return count;
}

router.get('/:id/monitor', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const p = r.project;
  const target = p.episodeTarget || 0;
  const result = { episodeTarget: target, status: target > 0 ? 'progress' : '无目标' };

  // 关键词目录（初版交付）
  const kw = shared.settings.keyword || '项目归档资料';
  const resolved = fileService.resolveEpisodeDirs(p, kw);
  if (resolved.relPath && resolved.localExists) {
    result.archiveCount = countVideoFiles(resolved.localEpDir);
    result.archivePath = resolved.localEpDir;
  }

  // 上映单集版（修改交付）
  const modifyRel = fileService.findKeywordDir(p.localDir, '上映单集版') || fileService.findKeywordDir(p.nasDir, '上映单集版');
  if (modifyRel && fs.existsSync(path.join(p.localDir, modifyRel))) {
    result.modifyCount = countVideoFilesRecursive(path.join(p.localDir, modifyRel));
    result.modifyPath = path.join(p.localDir, modifyRel);
  }

  // 000交付
  const d000Rel = fileService.findKeywordDir(p.localDir, '000交付') || fileService.findKeywordDir(p.nasDir, '000交付');
  if (d000Rel && fs.existsSync(path.join(p.localDir, d000Rel))) {
    result.d000Count = countVideoFilesRecursive(path.join(p.localDir, d000Rel));
    result.d000Path = path.join(p.localDir, d000Rel);
  }

  // 判断达标
  if (target > 0) {
    const kwCount = result.archiveCount || 0;
    result.progress = Math.min(100, Math.round(kwCount / target * 100));
    if (kwCount >= target) { result.status = 'ready'; result.archiveReady = true; }
    result.modifyReady = (result.modifyCount || 0) > 0;
    result.d000Ready = (result.d000Count || 0) > 0;
  }

  res.json(result);
});

module.exports = router;
