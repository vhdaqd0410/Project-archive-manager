const fs = require('fs');
const path = require('path');

/**
 * 扫描本地根目录，返回所有子文件夹信息
 * @param {string} localRoot 本地根目录
 * @param {string[]} existingNames 已存在的项目名列表（用于过滤）
 * @returns {{ candidates: { name: string, localDir: string }[], totalDirs: number, skipCount: number } | { error: string }}
 */
function scanLocalRoot(localRoot, existingNames = []) {
  if (!localRoot || !fs.existsSync(localRoot)) {
    return { error: '本地目录不存在或无法访问' };
  }

  const existingSet = new Set(existingNames);

  let subDirs;
  try {
    subDirs = fs.readdirSync(localRoot, { withFileTypes: true })
      .filter(d => d.isDirectory());
  } catch (err) {
    return { error: `读取目录失败: ${err.message}` };
  }

  const candidates = [];
  let skipCount = 0;

  for (const d of subDirs) {
    if (existingSet.has(d.name)) { skipCount++; continue; }
    candidates.push({ name: d.name, localDir: path.join(localRoot, d.name) });
  }

  return { localRoot, totalDirs: subDirs.length, skipCount, candidates };
}

module.exports = { scanLocalRoot };
