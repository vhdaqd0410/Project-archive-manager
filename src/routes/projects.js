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
  const { name, localDir, nasDir, memo, episodeTarget, episodeAssignments } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '项目名称不能为空' });
  const p = {
    id: crypto.randomUUID(),
    name: name.trim(),
    localDir: (localDir || '').trim(),
    nasDir: (nasDir || '').trim(),
    memo: (memo || '').trim(),
    status: 'editing',
    createdAt: new Date().toISOString(),
    episodeTarget: parseInt(episodeTarget) || 0,
    episodeAssignments: Array.isArray(episodeAssignments) ? episodeAssignments : []
  };
  shared.projects.push(p); projectService.saveProjects(shared.projects);
  res.json({ success: true, project: p });
});

router.put('/:id', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { name, localDir, nasDir, status, memo, episodeTarget, episodeAssignments } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '名称不能为空' });
  shared.projects[r.index] = {
    ...shared.projects[r.index],
    name: name.trim(),
    localDir: (localDir || '').trim(),
    nasDir: (nasDir || '').trim(),
    memo: memo !== undefined ? (memo || '').trim() : (shared.projects[r.index].memo || ''),
    episodeTarget: episodeTarget !== undefined ? (parseInt(episodeTarget) || 0) : (shared.projects[r.index].episodeTarget || 0),
    episodeAssignments: episodeAssignments !== undefined ? episodeAssignments : (shared.projects[r.index].episodeAssignments || []),
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

// ==================== 异步复制辅助函数 ====================
function yieldLoop() { return new Promise(r => setImmediate(r)); }

async function copyFilesAsync(list, localEpDir, nasEpDir, job) {
  let ok = 0, fail = 0, skip = 0, totalBytes = 0;
  for (let i = 0; i < list.length; i++) {
    if (job.cancel) break;
    // 每10个文件让出事件循环一次（平衡性能与响应）
    if (i % 10 === 0) await yieldLoop();
    const f = list[i];
    const src = path.join(localEpDir, f);
    const dst = path.join(nasEpDir, f);
    try {
      const srcStat = fs.statSync(src);
      if (fs.existsSync(dst) && fs.statSync(dst).size === srcStat.size) { skip++; updateJobProgress(job, i, f, 'skip'); continue; }
      // 大于10MB的文件用异步复制
      if (srcStat.size > 10 * 1024 * 1024) {
        await fs.promises.copyFile(src, dst);
        await yieldLoop();
      } else {
        fs.copyFileSync(src, dst);
      }
      totalBytes += srcStat.size; ok++;
      updateJobProgress(job, i, f, 'ok');
    } catch (e) { fail++; updateJobProgress(job, i, f, 'fail'); }
  }
  return { ok, fail, skip, totalBytes };
}

async function copyDirsAsync(batchNames, localBase, nasBase, job) {
  let ok = 0, fail = 0;
  const fsPromises = fs.promises;
  for (let i = 0; i < batchNames.length; i++) {
    if (job.cancel) break;
    if (i % 3 === 0) await yieldLoop();
    const name = batchNames[i];
    const src = path.join(localBase, name);
    const dst = path.join(nasBase, name);
    try {
      await fsPromises.cp(src, dst, { recursive: true, force: true });
      await yieldLoop();
      ok++;
      updateJobProgress(job, i, name, 'ok');
    } catch (e) { fail++; updateJobProgress(job, i, name, 'fail'); }
  }
  return { ok, fail };
}

// ==================== 复制 ====================
router.post('/:id/copy', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { fileNames, keyword } = req.body;
  const kw = keyword || shared.settings.keyword || '项目归档资料';
  const resolved = fileService.resolveEpisodeDirs(r.project, kw);
  if (!resolved.relPath) return res.status(400).json({ error: '未检测到关键词目录' });
  if (!resolved.localExists) return res.status(400).json({ error: '本地不存在' });
  if (!fs.existsSync(resolved.nasEpDir)) fs.mkdirSync(resolved.nasEpDir, { recursive: true });

  const list = Array.isArray(fileNames) ? fileNames : [];
  const job = createJob(r.project.id, r.project.name, list.length, '文件复制');
  job.startTime = Date.now();
  job.status = 'running';
  job.nasDir = resolved.nasEpDir;
  res.json({ success: true, jobId: job.id, totalItems: list.length });

  try {
    const result = await copyFilesAsync(list, resolved.localEpDir, resolved.nasEpDir, job);
    finishJob(job, job.cancel ? 'cancelled' : 'done', { nasDir: resolved.nasEpDir, totalBytes: result.totalBytes });
    projectService.addDeliveryLog(r.project.name, r.project.id, '文件复制', `关键词: ${kw}, 文件: ${list.length}`, result.ok, result.fail);
  } catch (e) { finishJob(job, 'error', { error: e.message }); }
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

router.post('/:id/modify-copy-batch', async (req, res) => {
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
  job.status = 'running';
  job.nasDir = nk;
  res.json({ success: true, jobId: job.id, totalItems: batchNames.length });

  try {
    const result = await copyDirsAsync(batchNames, lk, nk, job);
    finishJob(job, job.cancel ? 'cancelled' : 'done', { nasDir: nk });
    projectService.addDeliveryLog(p.name, p.id, '批次复制', `关键词: ${kw}, 批次: ${batchNames.join(', ')}`, result.ok, result.fail);
  } catch (e) { finishJob(job, 'error', { error: e.message }); }
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

// 从文件名中提取所有可能代表集号的数字（优先前几位，去重）
function extractEpisodeNumbers(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const nums = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) continue;
      const base = path.basename(e.name, path.extname(e.name));
      // 提取所有数字序列
      const matches = base.match(/\d+/g);
      if (!matches) continue;
      // 优先取第一个 1-4 位数字（集号通常在开头，如 01、第01、EP01）
      for (const m of matches) {
        const n = parseInt(m);
        if (n >= 1 && n <= 9999) { nums.push(n); break; }
      }
    }
  } catch (e) {}
  return [...new Set(nums)].sort((a, b) => a - b);
}

// 根据已有集数和目标集数，计算缺失区间
function findMissingEpisodes(foundNums, target) {
  if (!target || target <= 0) return [];
  const foundSet = new Set(foundNums);
  const missing = [];
  for (let i = 1; i <= target; i++) {
    if (!foundSet.has(i)) missing.push(i);
  }
  // 压缩为区间表示
  const ranges = [];
  if (!missing.length) return [];
  let start = missing[0], end = missing[0];
  for (let i = 1; i < missing.length; i++) {
    if (missing[i] === end + 1) { end = missing[i]; }
    else {
      ranges.push(start === end ? String(start) : start + '-' + end);
      start = missing[i]; end = missing[i];
    }
  }
  ranges.push(start === end ? String(start) : start + '-' + end);
  return {
    missingCount: missing.length,
    ranges,
    hasMissing: missing.length > 0,
  };
}

router.get('/:id/monitor', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const p = r.project;
  const target = p.episodeTarget || 0;
  const result = { episodeTarget: target, status: target > 0 ? '监控中' : '未设置目标集数' };

  // 关键词目录（初版交付）
  const kw = shared.settings.keyword || '项目归档资料';
  const resolved = fileService.resolveEpisodeDirs(p, kw);
  let foundNums = [];
  if (resolved.relPath && resolved.localExists) {
    result.archiveCount = countVideoFiles(resolved.localEpDir);
    result.archivePath = resolved.localEpDir;
    if (target > 0) {
      foundNums = extractEpisodeNumbers(resolved.localEpDir);
      result.archiveFoundNums = foundNums;
      result.archiveMissing = findMissingEpisodes(foundNums, target);
    }
  }
  // 按人员分组缺失（无论目录是否存在都计算）
  if (target > 0) {
    result.missingByPerson = getMissingByPerson(foundNums, target, p.episodeAssignments);
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
    if (kwCount >= target) { result.status = '可交付'; result.archiveReady = true; }
    result.modifyReady = (result.modifyCount || 0) > 0;
    result.d000Ready = (result.d000Count || 0) > 0;
  }

  res.json(result);
});

// 按剪辑人员分组统计缺失集数
function getMissingByPerson(foundNums, target, assignments) {
  if (!assignments || !assignments.length || !target) return [];
  const foundSet = new Set(foundNums);
  const result = [];
  for (const asgn of assignments) {
    if (!asgn.name || !asgn.name.trim()) continue;
    const missing = [];
    for (let ep = asgn.start; ep <= asgn.end; ep++) {
      if (ep < 1 || ep > target) continue;
      if (!foundSet.has(ep)) missing.push(ep);
    }
    if (missing.length > 0) {
      // 压缩区间
      const ranges = [];
      let s = missing[0], e2 = missing[0];
      for (let i = 1; i < missing.length; i++) {
        if (missing[i] === e2 + 1) { e2 = missing[i]; }
        else { ranges.push(s === e2 ? String(s) : s + '-' + e2); s = missing[i]; e2 = missing[i]; }
      }
      ranges.push(s === e2 ? String(s) : s + '-' + e2);
      result.push({
        name: asgn.name.trim(),
        start: asgn.start, end: asgn.end,
        missingCount: missing.length,
        ranges,
        progress: Math.round((asgn.end - asgn.start + 1 - missing.length) / (asgn.end - asgn.start + 1) * 100)
      });
    }
  }
  result.sort((a, b) => b.missingCount - a.missingCount);
  return result;
}

module.exports = router;
