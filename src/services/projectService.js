const fs = require('fs');
const path = require('path');
const config = require('../config');

// ---------- 统一数据目录 ----------
const dataDir = config.dataDir;
const projectsFile = path.join(dataDir, 'projects.json');
const settingsFile = path.join(dataDir, 'settings.json');

// ---------- 默认设置 ----------
const DEFAULT_SETTINGS = { keyword: config.defaults.keyword, templates: [] };

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
  // 原子写入：先写临时文件，再重命名，避免写入中途崩溃损坏数据
  const tmpFile = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, filePath);
  } catch (e) {
    console.error(`[projectService] 写入 ${filePath} 失败:`, e.message);
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

// ---------- 简易互斥锁（序列化写入，避免并发问题）----------
let _writeQueue = Promise.resolve();

function serializedWrite(writeFn) {
  _writeQueue = _writeQueue.then(() => new Promise((resolve) => {
    try { writeFn(); } catch (e) { console.error('[projectService] 序列化写入异常:', e.message); }
    resolve();
  }));
  return _writeQueue;
}

// ---------- Project CRUD ----------
function loadProjects() {
  return readJSON(projectsFile, []);
}

function saveProjects(projects) {
  // 浅拷贝一份快照，避免串行化期间外部修改
  const snapshot = [...projects];
  serializedWrite(() => writeJSON(projectsFile, snapshot));
}

function loadSettings() {
  return readJSON(settingsFile, DEFAULT_SETTINGS);
}

function saveSettings(settings) {
  const snapshot = { ...settings };
  serializedWrite(() => writeJSON(settingsFile, snapshot));
}

// ---------- 交付历史 ----------
const deliveryLogFile = path.join(dataDir, 'delivery-log.json');
const MAX_LOG_ENTRIES = config.defaults.maxLogEntries;

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
  serializedWrite(() => writeJSON(deliveryLogFile, logs));
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
