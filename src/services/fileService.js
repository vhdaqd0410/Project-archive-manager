const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');
const log = require('./logger').createLogger('fileService');

// ---------- 递归查找含关键词的目录（BFS搜索，优先浅层）----------
function findKeywordDir(root, keyword) {
  if (!root || !fs.existsSync(root)) return null;
  try {
    const rootFull = path.resolve(root);

    function searchRecursive(dir, depth) {
      if (depth > config.fileOps.searchMaxDepth) return null;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch (e) { log.warn('读取目录失败:', dir, e.message); return null; }

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.includes(keyword)) {
          return path.join(dir, entry.name);
        }
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const found = searchRecursive(path.join(dir, entry.name), depth + 1);
          if (found) return found;
        }
      }
      return null;
    }

    const found = searchRecursive(rootFull, 0);
    if (!found) return null;
    return found.substring(rootFull.length).replace(/\\/g, '/').replace(/^\//, '');
  } catch (e) {
    log.warn('findKeywordDir 异常:', root, keyword, e.message);
    return null;
  }
}

// ---------- 统计目录中的文件数 ----------
function countFilesInDir(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  try {
    return fs.readdirSync(dirPath).filter(f =>
      fs.statSync(path.join(dirPath, f)).isFile()
    ).length;
  } catch (e) {
    log.warn('countFilesInDir 失败:', dirPath, e.message);
    return 0;
  }
}

// ---------- 递归统计文件数 ----------
function countFilesRecursive(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return 0;
  let count = 0;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        count += countFilesRecursive(path.join(dirPath, entry.name));
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
function resolveEpisodeDirs(project, keyword) {
  const localRoot = project.localDir;
  const nasRoot = project.nasDir;
  const rel = findKeywordDir(localRoot, keyword) || findKeywordDir(nasRoot, keyword);

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
    result.localExists = fs.existsSync(result.localEpDir);
    result.nasExists = fs.existsSync(result.nasEpDir);
    result.localCount = result.localExists ? countFilesInDir(result.localEpDir) : 0;
    result.nasCount = result.nasExists ? countFilesInDir(result.nasEpDir) : 0;
  }

  return result;
}

// ---------- 获取待交付文件（本地有、NAS 无）----------
function getPendingFiles(localDir, nasDir) {
  if (!localDir || !fs.existsSync(localDir)) return [];

  let localFiles = [];
  try {
    localFiles = fs.readdirSync(localDir).filter(f =>
      fs.statSync(path.join(localDir, f)).isFile()
    );
  } catch (e) {
    log.warn('getPendingFiles 读取本地目录失败:', localDir, e.message);
    return [];
  }

  const nasNames = new Set();
  if (nasDir && fs.existsSync(nasDir)) {
    try {
      fs.readdirSync(nasDir).filter(f =>
        fs.statSync(path.join(nasDir, f)).isFile()
      ).forEach(f => nasNames.add(f));
    } catch (e) {
      log.warn('getPendingFiles 读取NAS目录失败:', nasDir, e.message);
    }
  }

  return localFiles.filter(f => !nasNames.has(f));
}

// ---------- 复制文件到 NAS ----------
function copyFilesToNas(localEpDir, nasEpDir, fileNames) {
  if (!fs.existsSync(nasEpDir)) {
    fs.mkdirSync(nasEpDir, { recursive: true });
  }

  const results = [];
  for (const name of fileNames) {
    const src = path.join(localEpDir, name);
    const dst = path.join(nasEpDir, name);
    try {
      fs.copyFileSync(src, dst);
      results.push({ name, success: true });
    } catch (err) {
      results.push({ name, success: false, error: err.message });
    }
  }
  return results;
}

// ---------- 打开资源管理器 ----------
function openExplorer(dirPath) {
  return new Promise((resolve, reject) => {
    execFile('explorer.exe', [dirPath], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ---------- 递归计数文件 ----------
function countFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return 0;
  let c = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      c += entry.isDirectory() ? countFilesRecursive(path.join(dir, entry.name)) : 1;
    }
  } catch (e) { console.error(`[fileService] countFiles 失败: ${dir}`, e.message); }
  return c;
}

// ---------- 递归复制目录 ----------
function copyDirRecursive(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

module.exports = {
  findKeywordDir,
  resolveEpisodeDirs,
  getPendingFiles,
  copyFilesToNas,
  openExplorer,
  countFilesRecursive,
  copyDirRecursive
};
