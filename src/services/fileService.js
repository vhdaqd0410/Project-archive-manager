const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');
const log = require('./logger').createLogger('fileService');

// ---------- 递归查找含关键词的目录（BFS搜索，优先浅层）----------
async function findKeywordDir(root, keyword) {
  if (!root) return null;
  try {
    await fsp.access(root).catch(() => { throw new Error('not accessible'); });
    const rootFull = path.resolve(root);

    async function searchRecursive(dir, depth) {
      if (depth > config.fileOps.searchMaxDepth) return null;
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
      catch (e) { log.warn('读取目录失败:', dir, e.message); return null; }

      // 第一轮：浅层优先匹配
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.includes(keyword)) {
          return path.join(dir, entry.name);
        }
      }
      // 第二轮：递归子目录
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const found = await searchRecursive(path.join(dir, entry.name), depth + 1);
          if (found) return found;
        }
      }
      return null;
    }

    const found = await searchRecursive(rootFull, 0);
    if (!found) return null;
    return found.substring(rootFull.length).replace(/\\/g, '/').replace(/^\//, '');
  } catch (e) {
    log.warn('findKeywordDir 异常:', root, keyword, e.message);
    return null;
  }
}

// ---------- 统计目录中的文件数 ----------
async function countFilesInDir(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath);
    let count = 0;
    for (const name of entries) {
      try {
        const stat = await fsp.stat(path.join(dirPath, name));
        if (stat.isFile()) count++;
      } catch (_) { /* 单个文件 stat 失败忽略 */ }
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

// ---------- 获取待交付文件（本地有、NAS 无）----------
async function getPendingFiles(localDir, nasDir) {
  if (!localDir) return [];

  let localFiles = [];
  try {
    const entries = await fsp.readdir(localDir);
    for (const name of entries) {
      try {
        const stat = await fsp.stat(path.join(localDir, name));
        if (stat.isFile()) localFiles.push(name);
      } catch (_) { /* 单文件 stat 失败忽略 */ }
    }
  } catch (e) {
    log.warn('getPendingFiles 读取本地目录失败:', localDir, e.message);
    return [];
  }

  const nasNames = new Set();
  if (nasDir) {
    try {
      const entries = await fsp.readdir(nasDir);
      for (const name of entries) {
        try {
          const stat = await fsp.stat(path.join(nasDir, name));
          if (stat.isFile()) nasNames.add(name);
        } catch (_) { /* 单文件 stat 失败忽略 */ }
      }
    } catch (e) {
      log.warn('getPendingFiles 读取NAS目录失败:', nasDir, e.message);
    }
  }

  return localFiles.filter(f => !nasNames.has(f));
}

module.exports = {
  findKeywordDir,
  resolveEpisodeDirs,
  getPendingFiles,
  countFilesRecursive,
};
