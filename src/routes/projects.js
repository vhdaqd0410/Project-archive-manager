const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const projectService = require('../services/projectService');
const fileService = require('../services/fileService');
const shared = require('./shared');
const { createJob, updateJobProgress, finishJob } = require('./jobs');
const config = require('../config');
const { validate, presets } = require('../middleware/validate');

// ==================== CRUD ====================
router.get('/', (req, res) => res.json(shared.projects));

router.post('/', validate({ name: presets.projectName }), (req, res) => {
  const { name, localDir, nasDir, memo, episodeTarget, episodeAssignments } = req.body;
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

router.put('/:id', validate({ name: presets.projectName }), (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { name, localDir, nasDir, status, memo, episodeTarget, episodeAssignments } = req.body;
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

router.put('/:id/status', validate({ status: presets.projectStatus }), (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { status } = req.body;
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
  const { yieldEveryN, largeFileThresholdBytes } = config.fileOps;
  for (let i = 0; i < list.length; i++) {
    if (job.cancel) break;
    if (i % yieldEveryN === 0) await yieldLoop();
    const f = list[i];
    const src = path.join(localEpDir, f);
    const dst = path.join(nasEpDir, f);
    try {
      const srcStat = await fs.promises.stat(src);
      // 检查目标文件是否已经存在且大小一致
      let dstExists = false;
      try {
        const dstStat = await fs.promises.stat(dst);
        dstExists = dstStat.size === srcStat.size;
      } catch (_) { /* 目标不存在，需要复制 */ }
      if (dstExists) { skip++; updateJobProgress(job, i, f, 'skip'); continue; }
      // 大文件用异步复制，小文件可继续同步（经测试同步复制对小文件更快）
      if (srcStat.size > largeFileThresholdBytes) {
        await fs.promises.copyFile(src, dst);
        await yieldLoop();
      } else {
        await fs.promises.copyFile(src, dst);
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
  const { dirYieldEveryN } = config.fileOps;
  for (let i = 0; i < batchNames.length; i++) {
    if (job.cancel) break;
    if (i % dirYieldEveryN === 0) await yieldLoop();
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
  const kw = keyword || shared.settings.keyword || config.defaults.keyword;
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
  const keyword = req.query.keyword || config.deliveryKeywords.modify;
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
  const kw = keyword || config.deliveryKeywords.modify;
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
  const projectStatus = p.status || 'editing';

  const result = {
    episodeTarget: target,
    projectStatus,
    hasTarget: target > 0,
  };

  // ═══ 根据项目状态做不同检测 ═══

  if (projectStatus === 'editing') {
    // 🔵 剪辑中：检测关键词目录下的视频文件数 vs 目标集数
    const kw = shared.settings.keyword || config.defaults.keyword;
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
    if (target > 0) {
      result.missingByPerson = getMissingByPerson(foundNums, target, p.episodeAssignments);
      const kwCount = result.archiveCount || 0;
      result.progress = Math.min(100, Math.round(kwCount / target * 100));
      if (kwCount >= target) {
        result.status = '可交付';
        result.archiveReady = true;
      } else {
        result.status = '剪辑中 · ' + kwCount + '/' + target + '集';
      }
    } else {
      result.status = '未设置目标集数';
    }
  }

  else if (projectStatus === 'modifying') {
    // 🟠 修改中：检测"上映单集版"目录下待交付的修改批次
    const modifyRel = fileService.findKeywordDir(p.localDir, config.deliveryKeywords.modify)
                   || fileService.findKeywordDir(p.nasDir, config.deliveryKeywords.modify);
    result.modifyRelPath = modifyRel || null;
    if (modifyRel) {
      const localModifyDir = path.join(p.localDir, modifyRel);
      const nasModifyDir = path.join(p.nasDir, modifyRel);
      result.localModifyDir = localModifyDir;
      result.nasModifyDir = nasModifyDir;
      if (fs.existsSync(localModifyDir)) {
        // 列出所有日期批次目录
        let dirs = [];
        try {
          dirs = fs.readdirSync(localModifyDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .sort((a, b) => b.name.localeCompare(a.name));
        } catch (_) {}
        const batches = [];
        for (const d of dirs) {
          const nasDir = path.join(nasModifyDir, d.name);
          const hasNas = fs.existsSync(nasDir);
          const fileCount = fileService.countFilesRecursive(path.join(localModifyDir, d.name));
          const videoCount = countVideoFilesRecursive(path.join(localModifyDir, d.name));
          batches.push({
            name: d.name,
            fileCount,
            videoCount,
            nasExists: hasNas,
            pending: !hasNas,
          });
        }
        result.modifyBatches = batches;
        result.modifyPendingCount = batches.filter(b => b.pending).length;
        result.modifyTotalCount = batches.length;
        result.modifyReady = result.modifyPendingCount > 0;
        result.status = result.modifyPendingCount > 0
          ? result.modifyPendingCount + ' 个批次待交付'
          : '全部批次已交付';
        if (target > 0) {
          result.modifyVideoTotal = batches.reduce((s, b) => s + b.videoCount, 0);
        }
      }
    } else {
      result.status = '未找到修改交付目录';
    }
  }

  else if (projectStatus === 'done') {
    // ✅ 已完成：如果本地存在"000交付"目录，检测各版本达到多少集
    const d000Rel = fileService.findKeywordDir(p.localDir, config.deliveryKeywords.archive)
                 || fileService.findKeywordDir(p.nasDir, config.deliveryKeywords.archive);
    result.d000RelPath = d000Rel || null;
    if (d000Rel) {
      const localD000Dir = path.join(p.localDir, d000Rel);
      const nasD000Dir = path.join(p.nasDir, d000Rel);
      result.localD000Dir = localD000Dir;
      result.nasD000Dir = nasD000Dir;
      if (fs.existsSync(localD000Dir)) {
        let dirs = [];
        try {
          dirs = fs.readdirSync(localD000Dir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .sort((a, b) => b.name.localeCompare(a.name));
        } catch (_) {}
        const versions = [];
        for (const d of dirs) {
          const nasDir = path.join(nasD000Dir, d.name);
          const hasNas = fs.existsSync(nasDir);
          const videoCount = countVideoFilesRecursive(path.join(localD000Dir, d.name));
          const isComplete = target > 0 ? videoCount >= target : false;
          versions.push({
            name: d.name,
            videoCount,
            isComplete,
            nasExists: hasNas,
            pending: !hasNas,
            pct: target > 0 ? Math.min(100, Math.round(videoCount / target * 100)) : 0,
          });
        }
        result.d000Versions = versions;
        result.d000PendingCount = versions.filter(v => v.pending).length;
        result.d000CompleteCount = versions.filter(v => v.isComplete).length;
        result.status = target > 0
          ? result.d000CompleteCount + '/' + versions.length + ' 个版本已达标'
          : versions.length + ' 个交付版本';
        if (target > 0 && versions.length > 0 && result.d000CompleteCount === versions.length) {
          result.d000AllReady = true;
          result.status = '✅ 全部版本已达标可交付';
        }
      }
    } else {
      result.status = '未找到000交付目录';
    }
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
