const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- 配置路径 ----------
const configDir = path.join(os.homedir(), 'AppData', 'Roaming', 'ProjectDeliveryTool');
const projectsFile = path.join(configDir, 'projects.json');
const settingsFile = path.join(configDir, 'settings.json');

// ---------- 确保目录存在 ----------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------- 迁移旧数据 ----------
function migrateOldData() {
  ensureDir(configDir);

  // 如果新格式的 settings 已存在，跳过迁移
  const newSettingsPath = path.join(__dirname, '..', '..', 'data', 'settings.json');
  if (fs.existsSync(newSettingsPath)) return;

  // 读取旧 settings
  let oldSettings = null;
  if (fs.existsSync(settingsFile)) {
    try {
      oldSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    } catch { /* 忽略 */ }
  }

  // 读取旧 projects
  let oldProjects = [];
  if (fs.existsSync(projectsFile)) {
    try {
      const raw = fs.readFileSync(projectsFile, 'utf-8');
      if (raw.trim()) {
        oldProjects = JSON.parse(raw);
        if (!Array.isArray(oldProjects)) oldProjects = [oldProjects];
      }
    } catch { /* 忽略 */ }
  }

  // 写入新格式 projects
  const newProjects = oldProjects.map(p => ({
    name: p.Name || '',
    localDir: p.LocalDir || '',
    nasDir: p.NasDir || '',
    status: 'active'
  }));
  const dataDir = path.join(__dirname, '..', '..', 'data');
  ensureDir(dataDir);
  fs.writeFileSync(path.join(dataDir, 'projects.json'), JSON.stringify(newProjects, null, 2), 'utf-8');

  // 写入新格式 settings
  const newSettings = {
    keyword: (oldSettings && oldSettings.Keyword) || '项目归档资料',
    templates: []
  };
  fs.writeFileSync(newSettingsPath, JSON.stringify(newSettings, null, 2), 'utf-8');
}

// ---------- Project CRUD ----------
function getProjectsPath() {
  return path.join(__dirname, '..', '..', 'data', 'projects.json');
}

function getSettingsPath() {
  return path.join(__dirname, '..', '..', 'data', 'settings.json');
}

function loadProjects() {
  const p = getProjectsPath();
  ensureDir(path.dirname(p));
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveProjects(projects) {
  const p = getProjectsPath();
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(projects, null, 2), 'utf-8');
}

function loadSettings() {
  const p = getSettingsPath();
  ensureDir(path.dirname(p));
  if (!fs.existsSync(p)) {
    return { keyword: '项目归档资料', templates: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return { keyword: '项目归档资料', templates: [] };
  }
}

function saveSettings(settings) {
  const p = getSettingsPath();
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf-8');
}

// ---------- 导出 ----------
module.exports = {
  migrateOldData,
  loadProjects,
  saveProjects,
  loadSettings,
  saveSettings
};
