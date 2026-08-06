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
const deliveryWatcher = require('../services/deliveryWatcher');
const qualityService = require('../services/qualityService');
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
    await projectService.saveProject(p);
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
  const updated = {
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
    await projectService.saveProject(updated);
    shared.projects[r.index] = updated;
    res.json({ success: true, project: updated });
  } catch (e) {
    res.status(500).json({ error: '保存失败: ' + e.message });
  }
});

router.put('/:id/status', validate({ status: presets.projectStatus }), async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { status } = req.body;
  const updated = { ...shared.projects[r.index], status };
  try {
    await projectService.saveProject(updated);
    shared.projects[r.index].status = status;
    // 状态变化后重置交付监控冷却，避免遗留状态影响
    deliveryWatcher.resetCooldown(req.params.id);
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
    await projectService.removeProject(removed.id);
    res.json({ success: true });
  } catch (e) {
    // 回滚内存
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

// 000 交付：直接读项目根目录的文件（本地有、NAS 无）
router.get('/:id/root-pending', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const p = r.project;
  try {
    const files = await fileService.getPendingFiles(p.localDir, p.nasDir);
    res.json({ files, localDir: p.localDir, nasDir: p.nasDir });
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

// 000 交付：直接复制项目根目录的文件（无需搜索关键词目录）
router.post('/:id/copy-root', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { fileNames } = req.body;
  const p = r.project;
  if (!p.localDir) return res.status(400).json({ error: '本地目录未配置' });

  await fsp.mkdir(p.nasDir, { recursive: true }).catch(() => {});

  const list = Array.isArray(fileNames) ? fileNames : [];
  const job = createJob(p.id, p.name, list.length, '000交付');
  job.startTime = Date.now();
  job.status = 'running';
  job.nasDir = p.nasDir;
  res.json({ success: true, jobId: job.id, totalItems: list.length });

  try {
    const result = await copyFilesAsync(list, p.localDir, p.nasDir, job);
    finishJob(job, job.cancel ? 'cancelled' : 'done', { nasDir: p.nasDir, totalBytes: result.totalBytes });
    sse.pushJobComplete(job);
    projectService.addDeliveryLog(p.name, p.id, '000交付', `根目录文件: ${list.length}`, result.ok, result.fail);

    if (result.copiedFiles && result.copiedFiles.length > 0) {
      const opId = crypto.randomUUID();
      db.addCopyOperation({
        id: opId, projectId: p.id, jobType: '000交付',
        files: JSON.stringify(result.copiedFiles), nasDir: p.nasDir,
        createdAt: new Date().toISOString(),
      });
    }

    sse.pushProjectUpdate('copy_complete', { id: p.id, ...result });
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

// ==================== 一键交付（监控通知点击触发）====================
// 行为：1) 扫描关键词目录下待复制文件 2) 异步复制到 NAS 3) 状态改为 'initial' 4) 返回 NAS 目录供前端复制到剪贴板
router.post('/:id/quick-deliver', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const p = r.project;
  const kw = req.body.keyword || shared.settings.keyword || config.defaults.keyword;
  const resolved = await fileService.resolveEpisodeDirs(p, kw);
  if (!resolved.relPath) return res.status(400).json({ error: '未检测到关键词目录（' + kw + '）' });
  if (!resolved.localExists) return res.status(400).json({ error: '本地目录不存在' });

  // 获取待复制文件列表（本地有、NAS 无）
  const pending = await fileService.getPendingFiles(resolved.localEpDir, resolved.nasEpDir);
  const list = (pending || []).map(f => f.name);
  if (!list.length) {
    // 没有新增文件：仅更新状态
    const updated = { ...p, status: 'initial' };
    try {
      await projectService.saveProject(updated);
      shared.projects[r.index].status = 'initial';
      deliveryWatcher.resetCooldown(p.id);
      sse.pushProjectUpdate('status_changed', { id: p.id, status: 'initial' });
      return res.json({
        success: true, skipped: true, message: '无新增文件，状态已更新为「初版交付」',
        nasDir: resolved.nasEpDir, projectName: p.name,
      });
    } catch (e) { return res.status(500).json({ error: '状态更新失败: ' + e.message }); }
  }

  await fsp.mkdir(resolved.nasEpDir, { recursive: true }).catch(() => {});
  const job = createJob(p.id, p.name, list.length, '一键交付');
  job.startTime = Date.now();
  job.status = 'running';
  job.nasDir = resolved.nasEpDir;
  res.json({
    success: true, jobId: job.id, totalItems: list.length,
    nasDir: resolved.nasEpDir, projectName: p.name,
  });

  try {
    const result = await copyFilesAsync(list, resolved.localEpDir, resolved.nasEpDir, job);
    finishJob(job, job.cancel ? 'cancelled' : 'done', { nasDir: resolved.nasEpDir, totalBytes: result.totalBytes });
    sse.pushJobComplete(job);

    // 写交付日志 + 复制记录
    projectService.addDeliveryLog(p.name, p.id, '文件复制', `关键词: ${kw}, 文件: ${list.length} (一键交付)`, result.ok, result.fail);
    if (result.copiedFiles && result.copiedFiles.length > 0) {
      const opId = crypto.randomUUID();
      db.addCopyOperation({
        id: opId, projectId: p.id, jobType: '文件复制',
        files: JSON.stringify(result.copiedFiles), nasDir: resolved.nasEpDir,
        createdAt: new Date().toISOString(),
      });
    }

    // 状态改为 'initial'（初版交付）
    const updated = { ...p, status: 'initial' };
    await projectService.saveProject(updated);
    shared.projects[r.index].status = 'initial';
    deliveryWatcher.resetCooldown(p.id);

    sse.pushProjectUpdate('quick_delivered', {
      id: p.id, projectName: p.name, nasDir: resolved.nasEpDir,
      ok: result.ok, fail: result.fail, status: 'initial',
    });
    sse.pushNotification(
      '✅ 交付完成：' + p.name,
      '已复制 ' + result.ok + ' 个文件到 NAS\n路径已复制到剪贴板',
      'success'
    );

    // ── 执行 post_copy 钩子 ──
    await hooks.runHooks('post_copy', {
      projectId: p.id, projectName: p.name,
      nasDir: resolved.nasEpDir, ok: result.ok, fail: result.fail,
      verifyResults: result.verifyResults,
    });
  } catch (e) {
    finishJob(job, 'error', { error: e.message });
    sse.pushJobComplete(job);
  }
});

// 交付历史（用于对比分析）
router.get('/:id/copy-history', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  try {
    const ops = db.getCopyOperations(r.project.id, 30);
    const list = ops.map(op => {
      let files = [];
      try { files = JSON.parse(op.files || '[]'); } catch (_) {}
      return {
        id: op.id,
        jobType: op.jobType,
        nasDir: op.nasDir,
        createdAt: op.createdAt,
        rolledBack: !!op.rolledBack,
        fileCount: files.length,
        files: files.map(f => f.name || (typeof f === 'string' ? f : '')),
      };
    });
    res.json({ history: list });
  } catch (e) { res.status(500).json({ error: '查询失败: ' + e.message }); }
});

// ==================== 项目交付时间轴 ====================
router.get('/:id/timeline', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const p = r.project;

  const events = [];
  // 1. 项目创建
  if (p.createdAt) {
    events.push({
      time: p.createdAt,
      type: 'create',
      title: '📁 项目创建',
      detail: '项目「' + p.name + '」创建',
      icon: '📁',
      color: '#3b82f6',
    });
  }

  // 2. 交付日志（按时间顺序）
  const deliveryLogs = db.getDeliveryLogsByProject(p.id, 500) || [];
  for (const l of deliveryLogs) {
    let title = '📋 ' + (l.action || '交付');
    let icon = '📋', color = '#22c55e';
    if (l.fail > 0 && l.ok === 0) { icon = '❌'; color = '#ef4444'; }
    else if (l.fail > 0) { icon = '⚠️'; color = '#f59e0b'; }
    events.push({
      time: l.time,
      type: 'delivery',
      title: title,
      detail: l.detail || '',
      ok: l.ok, fail: l.fail,
      icon: icon, color: color,
    });
  }

  // 3. 复制操作（从 copy_operations 表）
  const copyOps = db.getCopyOperations(p.id, 100) || [];
  for (const op of copyOps) {
    let fileCount = 0;
    try { fileCount = JSON.parse(op.files || '[]').length; } catch (_) {}
    events.push({
      time: op.createdAt,
      type: 'copy',
      title: '📦 复制操作',
      detail: '复制 ' + fileCount + ' 个文件到 NAS',
      fileCount: fileCount,
      nasDir: op.nasDir,
      icon: '📦', color: '#8b5cf6',
    });
  }

  // 4. 审计日志（状态变更等）
  const auditLogs = db.getAuditLogsByProject(p.id, 100) || [];
  for (const l of auditLogs) {
    events.push({
      time: l.time,
      type: 'audit',
      title: '🔧 ' + (l.action || '操作'),
      detail: l.detail || '',
      username: l.username,
      icon: '🔧', color: '#64748b',
    });
  }

  // 按时间排序
  events.sort((a, b) => new Date(a.time) - new Date(b.time));

  // 统计摘要
  const summary = {
    totalEvents: events.length,
    totalDeliveries: deliveryLogs.length,
    totalOk: deliveryLogs.reduce((s, l) => s + (l.ok || 0), 0),
    totalFail: deliveryLogs.reduce((s, l) => s + (l.fail || 0), 0),
    firstEvent: events[0] ? events[0].time : null,
    lastEvent: events.length ? events[events.length - 1].time : null,
    duration: (events.length >= 2)
      ? (new Date(events[events.length - 1].time) - new Date(events[0].time))
      : 0,
  };

  res.json({ project: { id: p.id, name: p.name, status: p.status, episodeTarget: p.episodeTarget }, events, summary });
});

// ==================== 交付前质量检查 ====================
router.post('/:id/quality-check', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { fileNames, keyword } = req.body;
  const kw = keyword || shared.settings.keyword || config.defaults.keyword;
  try {
    const resolved = await fileService.resolveEpisodeDirs(r.project, kw);
    if (!resolved.relPath || !resolved.localExists) {
      return res.status(400).json({ error: '未检测到关键词目录或本地不存在' });
    }
    const list = Array.isArray(fileNames) ? fileNames : [];
    const result = await qualityService.checkFiles(resolved.localEpDir, list);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: '质量检查失败: ' + e.message });
  }
});

// ==================== 项目待办事项 ====================
// 获取项目 todo 列表
router.get('/:id/todos', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  res.json({ todos: db.getProjectTodos(req.params.id) });
});

// 新增 todo
router.post('/:id/todos', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { text, priority } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: '请输入待办内容' });
  const todo = {
    id: crypto.randomUUID(),
    projectId: req.params.id,
    text: text.trim(),
    priority: parseInt(priority) || 0,
    createdAt: new Date().toISOString(),
  };
  db.addProjectTodo(todo);
  res.json({ success: true, todo });
});

// 更新 todo (完成/取消完成/编辑文本)
router.put('/:id/todos/:todoId', (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { done, text, priority } = req.body;
  const updates = {};
  if (done !== undefined) updates.done = !!done;
  if (text !== undefined) updates.text = text.trim();
  if (priority !== undefined) updates.priority = parseInt(priority) || 0;
  db.updateProjectTodo(req.params.todoId, updates);
  res.json({ success: true });
});

// 删除 todo
router.delete('/:id/todos/:todoId', (req, res) => {
  db.deleteProjectTodo(req.params.todoId);
  res.json({ success: true });
});

// ==================== 置顶/收藏 ====================
router.put('/:id/pin', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const pinned = !!req.body.pinned;
  const updated = { ...shared.projects[r.index], pinned };
  try {
    await projectService.saveProject(updated);
    shared.projects[r.index].pinned = pinned;
    res.json({ success: true, pinned });
  } catch (e) { res.status(500).json({ error: '操作失败: ' + e.message }); }
});

// ==================== 克隆项目 ====================
router.post('/:id/clone', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const { newName } = req.body;
  if (!newName || !newName.trim()) return res.status(400).json({ error: '请输入新项目名' });
  const src = r.project;
  const cloned = {
    id: crypto.randomUUID(),
    name: newName.trim(),
    localDir: src.localDir || '',
    nasDir: src.nasDir || '',
    memo: src.memo || '',
    status: 'editing',
    createdAt: new Date().toISOString(),
    episodeTarget: src.episodeTarget || 0,
    episodeAssignments: Array.isArray(src.episodeAssignments) ? src.episodeAssignments : [],
    pinned: false,
  };
  shared.projects.push(cloned);
  try {
    await projectService.saveProject(cloned);
    res.json({ success: true, project: cloned });
  } catch (e) {
    shared.projects.pop();
    res.status(500).json({ error: '克隆失败: ' + e.message }); }
});

// ==================== NAS ↔ 本地文件对账 ====================
router.get('/:id/reconcile', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const keyword = req.query.keyword || shared.settings.keyword || config.defaults.keyword;
  try {
    const resolved = await fileService.resolveEpisodeDirs(r.project, keyword);
    if (!resolved.relPath) return res.json({ found: false, message: '未检测到关键词目录' });
    if (!resolved.localExists) return res.json({ found: false, message: '本地关键词目录不存在' });
    const localMap = new Map();
    for (const e of await fsp.readdir(resolved.localEpDir, { withFileTypes: true })) {
      if (e.isFile()) {
        const stat = await fsp.stat(path.join(resolved.localEpDir, e.name));
        localMap.set(e.name, { size: stat.size, mtime: stat.mtimeMs });
      }
    }
    const nasMap = new Map();
    if (resolved.nasExists) {
      for (const e of await fsp.readdir(resolved.nasEpDir, { withFileTypes: true })) {
        if (e.isFile()) {
          try {
            const stat = await fsp.stat(path.join(resolved.nasEpDir, e.name));
            nasMap.set(e.name, { size: stat.size, mtime: stat.mtimeMs });
          } catch (_) { nasMap.set(e.name, { size: -1, mtime: 0 }); }
        }
      }
    }
    const localOnly = [], nasOnly = [], sizeMismatch = [], mtimeMismatch = [], matched = [];
    for (const [name, l] of localMap) {
      const n = nasMap.get(name);
      if (!n) { localOnly.push(name); continue; }
      if (l.size !== n.size) { sizeMismatch.push({ name, localSize: l.size, nasSize: n.size }); continue; }
      if (Math.abs(l.mtime - n.mtime) > config.incrementalSync.mtimeTolerance) {
        mtimeMismatch.push({ name, localMtime: l.mtime, nasMtime: n.mtime });
      } else { matched.push(name); }
    }
    for (const [name] of nasMap) { if (!localMap.has(name)) nasOnly.push(name); }
    res.json({
      found: true, keyword,
      localEpDir: resolved.localEpDir, nasEpDir: resolved.nasEpDir,
      localCount: localMap.size, nasCount: nasMap.size, matched: matched.length,
      localOnly, nasOnly, sizeMismatch, mtimeMismatch,
      summary: { pending: localOnly.length + sizeMismatch.length + mtimeMismatch.length, extra: nasOnly.length },
    });
  } catch (e) { res.status(500).json({ error: '对账失败: ' + e.message }); }
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
