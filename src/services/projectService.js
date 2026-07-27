const fs = require('fs');
const path = require('path');

// ---------- 统一数据目录 ----------
const dataDir = path.join(__dirname, '..', '..', 'data');
const projectsFile = path.join(dataDir, 'projects.json');
const settingsFile = path.join(dataDir, 'settings.json');

// ---------- 默认设置 ----------
const DEFAULT_SETTINGS = { keyword: '项目归档资料', templates: [] };

// ---------- 工具函数 ----------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error(`[projectService] 读取 ${filePath} 失败:`, e.message);
    return fallback;
  }
}

function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error(`[projectService] 写入 ${filePath} 失败:`, e.message);
  }
}

// ---------- Project CRUD ----------
function loadProjects() {
  return readJSON(projectsFile, []);
}

function saveProjects(projects) {
  writeJSON(projectsFile, projects);
}

function loadSettings() {
  return readJSON(settingsFile, DEFAULT_SETTINGS);
}

function saveSettings(settings) {
  writeJSON(settingsFile, settings);
}

// ---------- 交付历史 ----------
const deliveryLogFile = path.join(dataDir, 'delivery-log.json');
const MAX_LOG_ENTRIES = 500;

function loadDeliveryLog() {
  return readJSON(deliveryLogFile, []);
}

function addDeliveryLog(projectName, projectId, action, detail, ok, fail) {
  const logs = loadDeliveryLog();
  logs.unshift({
    time: new Date().toISOString(),
    projectName,
    projectId,
    action,
    detail,
    ok,
    fail
  });
  // 保留最近 500 条
  if (logs.length > MAX_LOG_ENTRIES) logs.length = MAX_LOG_ENTRIES;
  writeJSON(deliveryLogFile, logs);
}

// ---------- 导出 ----------
module.exports = {
  loadProjects,
  saveProjects,
  loadSettings,
  saveSettings,
  loadDeliveryLog,
  addDeliveryLog
};
