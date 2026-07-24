const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ---------- 递归查找含关键词的目录 ----------
function findKeywordDir(root, keyword) {
  if (!root || !fs.existsSync(root)) return null;
  try {
    const rootFull = path.resolve(root);

    function searchRecursive(dir, depth) {
      if (depth > 10) return null; // 安全深度限制
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return null; }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name.includes(keyword)) {
            return path.join(dir, entry.name);
          }
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
  } catch {
    return null;
  }
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

    if (fs.existsSync(result.localEpDir)) {
      result.localExists = true;
      try {
        result.localCount = fs.readdirSync(result.localEpDir).filter(f =>
          fs.statSync(path.join(result.localEpDir, f)).isFile()
        ).length;
      } catch { result.localCount = 0; }
    }

    if (fs.existsSync(result.nasEpDir)) {
      result.nasExists = true;
      try {
        result.nasCount = fs.readdirSync(result.nasEpDir).filter(f =>
          fs.statSync(path.join(result.nasEpDir, f)).isFile()
        ).length;
      } catch { result.nasCount = 0; }
    }
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
    } catch { /* 忽略 */ }
  }

  return localFiles.filter(f => !nasNames.has(f));
}

// ---------- 复制文件到 NAS ----------
function copyFilesToNas(localEpDir, nasEpDir, fileNames) {
  // 确保目标目录存在
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

module.exports = {
  findKeywordDir,
  resolveEpisodeDirs,
  getPendingFiles,
  copyFilesToNas,
  openExplorer
};
