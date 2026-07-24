const fs = require('fs');
const path = require('path');

/**
 * 扫描本地根目录，返回所有子文件夹信息
 * @param {string} localRoot 本地根目录
 * @param {string[]} existingNames 已存在的项目名列表（用于过滤）
 * @returns {{ name, localDir, skipped }[]}
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
    if (existingSet.has(d.name)) {
      skipCount++;
      continue;
    }
    candidates.push({
      name: d.name,
      localDir: path.join(localRoot, d.name)
    });
  }

  return {
    localRoot,
    totalDirs: subDirs.length,
    skipCount,
    candidates
  };
}

/**
 * 获取部门模板列表
 * @returns {{ name: string, path: string }[]}
 */
function getTemplates(settings) {
  return settings.templates || [];
}

/**
 * 保存部门模板
 * @param {object} settings 当前设置对象
 * @param {{ name: string, path: string }[]} templates
 * @param {function} saveFn 保存函数
 */
function saveTemplates(settings, templates, saveFn) {
  settings.templates = templates;
  saveFn(settings);
  return settings.templates;
}

/**
 * 校验模板路径：去除末尾多余斜杠
 */
function normalizePath(p) {
  if (!p) return '';
  return p.replace(/[\\/]+$/, '');
}

module.exports = {
  scanLocalRoot,
  getTemplates,
  saveTemplates,
  normalizePath
};
