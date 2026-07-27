const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ---------- 递归查找含关键词的目录（BFS搜索，优先浅层）----------
function findKeywordDir(root, keyword) {
  if (!root || !fs.existsSync(root)) return null;
  try {
    const rootFull = path.resolve(root);

    function searchRecursive(dir, depth) {
      if (depth > 10) return null; // 安全深度限制
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return null; }

      // 第一遍：检查当前层级是否有匹配目录
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.includes(keyword)) {
          return path.join(dir, entry.name);
        }
      }
      // 第二遍：递归进入子目录
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
  } catch {
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
  } catch { return 0; }
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
  } catch { return []; }

  const nasNames = new Set();
  if (nasDir && fs.existsSync(nasDir)) {
    try {
      fs.readdirSync(nasDir).filter(f =>
        fs.statSync(path.join(nasDir, f)).isFile()
      ).forEach(f => nasNames.add(f));
    } catch { /* 忽略 NAS 读取错误 */ }
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
