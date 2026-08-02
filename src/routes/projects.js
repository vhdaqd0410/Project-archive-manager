const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const projectService = require('../services/projectService');
const fileService = require('../services/fileService');
const shared = require('./shared');
const { createJob, updateJobProgress, finishJob } = require('./jobs');
const config = require('../config');
const { validate, presets } = require('../middleware/validate');
const sse = require('../services/sseService');
const verify = require('../services/verifyService');
const hooks = require('../services/hookService');
const db = require('../services/db');
const log = require('../services/logger').createLogger('projects');

// ==================== CRUD ====================
router.get('/', (req, res) => res.json(shared.projects));

router.post('/', validate({ name: presets.projectName }), async (req, res) => {
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
  shared.projects.push(p);
  try {
    await projectService.saveProjects(shared.projects);
    res.json({ success: true, project: p });
  } catch (e) {
    shared.projects.pop();
    res.status(500).json({ error: '保存失败: ' + e.message });
  }
});

router.put('/:id', validate({ name: presets.projectName }), async (req, res) => {
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
  try {
    await projectService.saveProjects(shared.projects);
    res.json({ success: true, project: shared.projects[r.index] });
  } catch (e) {
    res.status(500).json({ error: '保存失败: ' + e.message });
  }
});

router.put('/:id/status', validate({ status: presets.projectStatus }), async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { status } = req.body;
  shared.projects[r.index].status = status;
  try {
    await projectService.saveProjects(shared.projects);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '保存失败: ' + e.message });
  }
});

router.delete('/:id', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const removed = shared.projects.splice(r.index, 1)[0];
  try {
    await projectService.saveProjects(shared.projects);
    res.json({ success: true });
  } catch (e) {
    // 回滚
    shared.projects.splice(r.index, 0, removed);
    res.status(500).json({ error: '删除失败: ' + e.message });
  }
});

// ==================== 检测 ====================
router.get('/:id/detect', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const keyword = req.query.keyword || shared.settings.keyword || '项目归档资料';
  try {
    res.json(await fileService.resolveEpisodeDirs(r.project, keyword));
  } catch (e) {
    res.status(500).json({ error: '检测失败: ' + e.message });
  }
});

router.get('/:id/pending', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const keyword = req.query.keyword || shared.settings.keyword || '项目归档资料';
  try {
    const resolved = await fileService.resolveEpisodeDirs(r.project, keyword);
    if (!resolved.relPath) return res.json({ files: [], resolved });
    res.json({ files: await fileService.getPendingFiles(resolved.localEpDir, resolved.nasEpDir), resolved });
  } catch (e) {
    res.status(500).json({ error: '检测失败: ' + e.message });
  }
});

router.get('/:id/check-nas', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const nasDir = r.project.nasDir;
  const result = { accessible: false, path: nasDir, error: null };
  if (!nasDir) { result.error = 'NAS 路径未配置'; return res.json(result); }
  try {
    await fsp.access(nasDir);
    result.accessible = true;
  } catch (e) {
    result.error = '路径不可访问（网络盘可能已断连）';
  }
  res.json(result);
});

// ==================== 异步复制辅助函数 ====================
function yieldLoop() { return new Promise(r => setImmediate(r)); }

async function copyFilesAsync(list, localEpDir, nasEpDir, job) {
  let ok = 0, fail = 0, skip = 0, totalBytes = 0;
  const { yieldEveryN, largeFileThresholdBytes } = config.fileOps;
  const verifyResults = [];
  const copiedFiles = []; // 记录已复制文件，用于回滚
  const incremental = config.incrementalSync.enabled;
  const mtimeTolerance = config.incrementalSync.mtimeTolerance;

  for (let i = 0; i < list.length; i++) {
    if (job.cancel) break;
    if (i % yieldEveryN === 0) await yieldLoop();
    const f = list[i];
    const src = path.join(localEpDir, f);
    const dst = path.join(nasEpDir, f);
    try {
      const srcStat = await fsp.stat(src);
      let shouldCopy = true;
      let dstExists = false;
      try {
        const dstStat = await fsp.stat(dst);
        dstExists = dstStat.size === srcStat.size;
        // 增量同步：mtime 也需要匹配
        if (dstExists && incremental) {
          const mtimeDiff = Math.abs(srcStat.mtimeMs - dstStat.mtimeMs);
          if (mtimeDiff > mtimeTolerance) {
            dstExists = false; // mtime 不同，需要重新复制
          }
        }
      } catch (_) {}
      if (dstExists) { skip++; updateJobProgress(job, i, f, 'skip'); sse.pushJobProgress(job); continue; }
      await fsp.copyFile(src, dst);
      // 同步 mtime 到目标文件
      try { await fsp.utimes(dst, srcStat.atime, srcStat.mtime); } catch (_) {}
      if (srcStat.size > largeFileThresholdBytes) await yieldLoop();

      copiedFiles.push({ name: f, path: dst, size: srcStat.size });

      // ── 文件完整性校验 (Feature 1) ──
      const verifyResult = await verify.verifyFile(src, dst);
      verifyResults.push(verifyResult);
      if (verifyResult.verified === false) {
        // 校验失败，自动重试
        for (let retry = 0; retry < config.verification.maxRetries; retry++) {
          log.warn(`校验失败，重试 ${retry + 1}/${config.verification.maxRetries}: ${f}`);
          await fsp.copyFile(src, dst);
          const retryResult = await verify.verifyFile(src, dst);
          if (retryResult.verified === true) { verifyResult.verified = true; break; }
        }
      }
      // 保存校验记录
      verify.saveChecksum(db, job.projectId, verifyResult);

      totalBytes += srcStat.size; ok++;
      updateJobProgress(job, i, f, 'ok');
      sse.pushJobProgress(job);
    } catch (e) { fail++; updateJobProgress(job, i, f, 'fail'); sse.pushJobProgress(job); }
  }
  return { ok, fail, skip, totalBytes, verifyResults, copiedFiles };
}

async function copyDirsAsync(batchNames, localBase, nasBase, job) {
  let ok = 0, fail = 0;
  const { dirYieldEveryN } = config.fileOps;
  for (let i = 0; i < batchNames.length; i++) {
    if (job.cancel) break;
    if (i % dirYieldEveryN === 0) await yieldLoop();
    const name = batchNames[i];
    const src = path.join(localBase, name);
    const dst = path.join(nasBase, name);
    try {
      await fsp.cp(src, dst, { recursive: true, force: true });
      await yieldLoop();
      ok++;
      updateJobProgress(job, i, name, 'ok');
      sse.pushJobProgress(job);
    } catch (e) { fail++; updateJobProgress(job, i, name, 'fail'); sse.pushJobProgress(job); }
  }
  return { ok, fail };
}

// ==================== 复制 ====================
router.post('/:id/copy', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { fileNames, keyword } = req.body;
  const kw = keyword || shared.settings.keyword || config.defaults.keyword;
  const resolved = await fileService.resolveEpisodeDirs(r.project, kw);
  if (!resolved.relPath) return res.status(400).json({ error: '未检测到关键词目录' });
  if (!resolved.localExists) return res.status(400).json({ error: '本地不存在' });

  // ── 执行 pre_copy 钩子 (Feature 10) ──
  const shouldContinue = await hooks.runHooks('pre_copy', {
    projectId: r.project.id, projectName: r.project.name,
    localDir: resolved.localEpDir, nasDir: resolved.nasEpDir,
    fileCount: Array.isArray(fileNames) ? fileNames.length : 0, keyword: kw,
  });
  if (!shouldContinue) return res.status(403).json({ error: 'pre_copy 钩子中止了操作' });

  await fsp.mkdir(resolved.nasEpDir, { recursive: true }).catch(() => {});

  const list = Array.isArray(fileNames) ? fileNames : [];
  const job = createJob(r.project.id, r.project.name, list.length, '文件复制');
  job.startTime = Date.now();
  job.status = 'running';
  job.nasDir = resolved.nasEpDir;
  res.json({ success: true, jobId: job.id, totalItems: list.length });

  try {
    const result = await copyFilesAsync(list, resolved.localEpDir, resolved.nasEpDir, job);
    finishJob(job, job.cancel ? 'cancelled' : 'done', { nasDir: resolved.nasEpDir, totalBytes: result.totalBytes });
    sse.pushJobComplete(job);
    projectService.addDeliveryLog(r.project.name, r.project.id, '文件复制', `关键词: ${kw}, 文件: ${list.length}`, result.ok, result.fail);

    // ── 记录复制操作（用于回滚）──
    if (result.copiedFiles && result.copiedFiles.length > 0) {
      const opId = crypto.randomUUID();
      db.addCopyOperation({
        id: opId, projectId: r.project.id, jobType: '文件复制',
        files: JSON.stringify(result.copiedFiles), nasDir: resolved.nasEpDir,
        createdAt: new Date().toISOString(),
      });
      sse.pushNotification({ type: 'copy_recorded', operationId: opId, fileCount: result.copiedFiles.length });
    }

    // ── 执行 post_copy 钩子 ──
    await hooks.runHooks('post_copy', {
      projectId: r.project.id, projectName: r.project.name,
      nasDir: resolved.nasEpDir, ok: result.ok, fail: result.fail,
      verifyResults: result.verifyResults,
    });
    sse.pushProjectUpdate('copy_complete', { id: r.project.id, ...result });
  } catch (e) { finishJob(job, 'error', { error: e.message }); sse.pushJobComplete(job); }
});

// ==================== 修改 / 000 交付 ====================
router.get('/:id/modify-batches', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const keyword = req.query.keyword || config.deliveryKeywords.modify;
  const p = r.project;
  const rel = (await fileService.findKeywordDir(p.localDir, keyword)) || (await fileService.findKeywordDir(p.nasDir, keyword));
  if (!rel) return res.json({ found: false, keyword, batches: [] });
  const localKw = path.join(p.localDir, rel);
  const nasKw = path.join(p.nasDir, rel);
  const batches = [];
  try {
    const entries = await fsp.readdir(localKw, { withFileTypes: true });
    const dirs = entries.filter(d => d.isDirectory()).sort((a, b) => b.name.localeCompare(a.name));
    for (const d of dirs) {
      batches.push({
        name: d.name, localPath: path.join(localKw, d.name), nasPath: path.join(nasKw, d.name),
        localFileCount: await fileService.countFilesRecursive(path.join(localKw, d.name)),
        nasExists: fs.existsSync(path.join(nasKw, d.name))
      });
    }
  } catch (e) {
    // 目录不可读，返回空
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
  const rel = (await fileService.findKeywordDir(p.localDir, kw)) || (await fileService.findKeywordDir(p.nasDir, kw));
  if (!rel) return res.status(400).json({ error: '未找到目录' });
  const lk = path.join(p.localDir, rel), nk = path.join(p.nasDir, rel);
  await fsp.mkdir(nk, { recursive: true }).catch(() => {});

  // ── 执行 pre_batch 钩子 ──
  const shouldContinue = await hooks.runHooks('pre_batch', {
    projectId: p.id, projectName: p.name,
    localDir: lk, nasDir: nk,
    batchNames, keyword: kw,
  });
  if (!shouldContinue) return res.status(403).json({ error: 'pre_batch 钩子中止了操作' });

  const job = createJob(p.id, p.name, batchNames.length, kw + '交付');
  job.startTime = Date.now();
  job.status = 'running';
  job.nasDir = nk;
  res.json({ success: true, jobId: job.id, totalItems: batchNames.length });

  try {
    const result = await copyDirsAsync(batchNames, lk, nk, job);
    finishJob(job, job.cancel ? 'cancelled' : 'done', { nasDir: nk });
    sse.pushJobComplete(job);
    projectService.addDeliveryLog(p.name, p.id, '批次复制', `关键词: ${kw}, 批次: ${batchNames.join(', ')}`, result.ok, result.fail);

    // ── 记录复制操作（用于回滚）──
    if (result.ok > 0) {
      const opId = crypto.randomUUID();
      const copiedDirs = batchNames.map(n => ({ name: n, path: path.join(nk, n), isDir: true }));
      db.addCopyOperation({
        id: opId, projectId: p.id, jobType: kw + '交付',
        files: JSON.stringify(copiedDirs), nasDir: nk,
        createdAt: new Date().toISOString(),
      });
    }

    // ── 执行 post_batch 钩子 ──
    await hooks.runHooks('post_batch', {
      projectId: p.id, projectName: p.name,
      nasDir: nk, ok: result.ok, fail: result.fail,
    });
    sse.pushProjectUpdate('copy_complete', { id: p.id, ...result });
  } catch (e) { finishJob(job, 'error', { error: e.message }); sse.pushJobComplete(job); }
});

// ==================== 集数监控 ====================
// 使用 config 中的统一视频扩展名集合，避免重复定义
const VIDEO_EXTS = config.videoExtensions;

async function countVideoFiles(dir) {
  if (!dir) return 0;
  let count = 0;
  try {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      if (e.isFile() && VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) count++;
    }
  } catch (_) {}
  return count;
}

async function countVideoFilesRecursive(dir) {
  if (!dir) return 0;
  let count = 0;
  try {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) count += await countVideoFilesRecursive(path.join(dir, e.name));
      else if (VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) count++;
    }
  } catch (_) {}
  return count;
}

// 从文件名中提取所有可能代表集号的数字（优先前几位，去重）
async function extractEpisodeNumbers(dir) {
  if (!dir) return [];
  const nums = [];
  try {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
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
  } catch (_) {}
  return [...new Set(nums)].sort((a, b) => a - b);
}

// 根据已有集数和目标集数，计算缺失区间
// 始终返回统一的对象结构 { missingCount, ranges, hasMissing }
function findMissingEpisodes(foundNums, target) {
  if (!target || target <= 0) return { missingCount: 0, ranges: [], hasMissing: false };
  const foundSet = new Set(foundNums);
  const missing = [];
  for (let i = 1; i <= target; i++) {
    if (!foundSet.has(i)) missing.push(i);
  }
  // 压缩为区间表示
  const ranges = [];
  if (!missing.length) return { missingCount: 0, ranges: [], hasMissing: false };
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

router.get('/:id/monitor', async (req, res) => {
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
    const resolved = await fileService.resolveEpisodeDirs(p, kw);
    let foundNums = [];
    if (resolved.relPath && resolved.localExists) {
      result.archiveCount = await countVideoFiles(resolved.localEpDir);
      result.archivePath = resolved.localEpDir;
      if (target > 0) {
        foundNums = await extractEpisodeNumbers(resolved.localEpDir);
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
    const modifyRel = (await fileService.findKeywordDir(p.localDir, config.deliveryKeywords.modify))
                   || (await fileService.findKeywordDir(p.nasDir, config.deliveryKeywords.modify));
    result.modifyRelPath = modifyRel || null;
    if (modifyRel) {
      const localModifyDir = path.join(p.localDir, modifyRel);
      const nasModifyDir = path.join(p.nasDir, modifyRel);
      result.localModifyDir = localModifyDir;
      result.nasModifyDir = nasModifyDir;
      let dirs = [];
      try {
        const entries = await fsp.readdir(localModifyDir, { withFileTypes: true });
        dirs = entries.filter(d => d.isDirectory()).sort((a, b) => b.name.localeCompare(a.name));
      } catch (_) {}
      const batches = [];
      for (const d of dirs) {
        const nasDir = path.join(nasModifyDir, d.name);
        const hasNas = fs.existsSync(nasDir);
        const fileCount = await fileService.countFilesRecursive(path.join(localModifyDir, d.name));
        const videoCount = await countVideoFilesRecursive(path.join(localModifyDir, d.name));
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
    } else {
      result.status = '未找到修改交付目录';
    }
  }

  else if (projectStatus === 'done') {
    // ✅ 已完成：如果本地存在"000交付"目录，检测各版本达到多少集
    const d000Rel = (await fileService.findKeywordDir(p.localDir, config.deliveryKeywords.archive))
                 || (await fileService.findKeywordDir(p.nasDir, config.deliveryKeywords.archive));
    result.d000RelPath = d000Rel || null;
    if (d000Rel) {
      const localD000Dir = path.join(p.localDir, d000Rel);
      const nasD000Dir = path.join(p.nasDir, d000Rel);
      result.localD000Dir = localD000Dir;
      result.nasD000Dir = nasD000Dir;
      let dirs = [];
      try {
        const entries = await fsp.readdir(localD000Dir, { withFileTypes: true });
        dirs = entries.filter(d => d.isDirectory()).sort((a, b) => b.name.localeCompare(a.name));
      } catch (_) {}
      const versions = [];
      for (const d of dirs) {
        const nasDir = path.join(nasD000Dir, d.name);
        const hasNas = fs.existsSync(nasDir);
        const videoCount = await countVideoFilesRecursive(path.join(localD000Dir, d.name));
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
