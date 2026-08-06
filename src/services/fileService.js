const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');
const log = require('./logger').createLogger('fileService');

// ---------- 递归查找含关键词的目录（DFS + 兄弟节点并发，浅层优先）----------
async function findKeywordDir(root, keyword) {
  if (!root) return null;
  try {
    await fsp.access(root).catch(() => { throw new Error('not accessible'); });
    const rootFull = path.resolve(root);

    // 限制并发数，避免 NAS 大目录同时打开过多句柄
    const MAX_CONCURRENCY = 6;

    async function searchRecursive(dir, depth) {
      if (depth > config.fileOps.searchMaxDepth) return null;
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
      catch (e) { log.warn('读取目录失败:', dir, e.message); return null; }

      // 第一轮：浅层优先匹配（同步检查，命中即返回）
      const subdirs = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name.includes(keyword)) return path.join(dir, entry.name);
          subdirs.push(entry);
        }
      }
      if (subdirs.length === 0) return null;

      // 第二轮：兄弟子目录并发递归，任一命中即短路返回
      let result = null;
      let idx = 0;
      async function worker() {
        while (idx < subdirs.length && !result) {
          const i = idx++;
          const sub = path.join(dir, subdirs[i].name);
          const r = await searchRecursive(sub, depth + 1);
          if (r && !result) result = r;
        }
      }
      const workers = [];
      for (let i = 0; i < Math.min(MAX_CONCURRENCY, subdirs.length); i++) workers.push(worker());
      await Promise.all(workers);
      return result;
    }

    const found = await searchRecursive(rootFull, 0);
    if (!found) return null;
    return found.substring(rootFull.length).replace(/\\/g, '/').replace(/^\//, '');
  } catch (e) {
    log.warn('findKeywordDir 异常:', root, keyword, e.message);
    return null;
  }
}

// ---------- 统计目录中的文件数（复用 withFileTypes，避免逐个 stat）----------
async function countFilesInDir(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      //Dirent.isFile() 已由 readdir 获取，无需再 stat
      if (entry.isFile()) count++;
    }
    return count;
  } catch (e) {
    log.warn('countFilesInDir 失败:', dirPath, e.message);
    return 0;
  }
}

// ---------- 递归统计文件数 ----------
async function countFilesRecursive(dirPath) {
  if (!dirPath) return 0;
  let count = 0;
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += await countFilesRecursive(path.join(dirPath, entry.name));
      } else if (entry.isFile()) {
        count++;
      }
    }
  } catch (e) {
    log.warn('countFilesRecursive 失败:', dirPath, e.message);
  }
  return count;
}

// ---------- 解析关键词目录（本地 + NAS）----------
async function resolveEpisodeDirs(project, keyword) {
  const localRoot = project.localDir;
  const nasRoot = project.nasDir;
  const rel = (await findKeywordDir(localRoot, keyword)) || (await findKeywordDir(nasRoot, keyword));

  const result = {
    relPath: rel,
    localEpDir: null,
    nasEpDir: null,
    localExists: false,
    nasExists: false,
    localCount: 0,
    nasCount: 0
  };

  if (rel) {
    result.localEpDir = path.join(localRoot, rel);
    result.nasEpDir = path.join(nasRoot, rel);
    try { await fsp.access(result.localEpDir); result.localExists = true; } catch (_) {}
    try { await fsp.access(result.nasEpDir); result.nasExists = true; } catch (_) {}
    if (result.localExists) result.localCount = await countFilesInDir(result.localEpDir);
    if (result.nasExists) result.nasCount = await countFilesInDir(result.nasEpDir);
  }

  return result;
}

// ---------- 获取待交付文件（本地有、NAS 无），返回 {name, size} ----------
// 优化：Dirent 已能判断 isFile，不再对每个文件做冗余 stat；仅本地文件按需取 size
async function getPendingFiles(localDir, nasDir) {
  if (!localDir) return [];

  let localFiles = [];
  try {
    const entries = await fsp.readdir(localDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      // 仅本地文件需要 size 用于前端展示，批量 stat 仍较重；先取 size，失败用 0
      let size = 0;
      try { size = (await fsp.stat(path.join(localDir, e.name))).size; } catch (_) {}
      localFiles.push({ name: e.name, size });
    }
  } catch (e) {
    log.warn('getPendingFiles 读取本地目录失败:', localDir, e.message);
    return [];
  }

  const nasNames = new Set();
  if (nasDir) {
    try {
      // NAS 侧只需文件名集合做差集，Dirent.isFile 已足够，无需逐文件 stat
      const entries = await fsp.readdir(nasDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile()) nasNames.add(e.name);
      }
    } catch (e) {
      log.warn('getPendingFiles 读取NAS目录失败:', nasDir, e.message);
    }
  }

  return localFiles.filter(f => !nasNames.has(f.name));
}

module.exports = {
  findKeywordDir,
  resolveEpisodeDirs,
  getPendingFiles,
  countFilesRecursive,
};
