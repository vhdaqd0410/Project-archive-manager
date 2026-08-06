const fs = require('fs');
const path = require('path');
const config = require('../config');
const log = require('./logger').createLogger('projectService');

// ---------- 统一数据目录 ----------
const dataDir = config.dataDir;
const projectsFile = path.join(dataDir, 'projects.json');
const settingsFile = path.join(dataDir, 'settings.json');
const deliveryLogFile = path.join(dataDir, 'delivery-log.json');

// ---------- SQLite 引用（延迟加载） ----------
let db = null;
function getDB() {
  if (db === null) db = require('./db');
  return db;
}

// ---------- 默认设置 ----------
const DEFAULT_SETTINGS = { keyword: config.defaults.keyword, templates: [] };

// ---------- 工具函数（JSON 模式 fallback，仅在 SQLite 不可用时使用） ----------
// 注意：readJSON 使用同步 I/O，但仅作为 SQLite 降级路径，正常模式下不会执行
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
  const tmpFile = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, filePath);
  } catch (e) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    throw e;
  }
}

let _writeQueue = Promise.resolve();
function serializedWrite(writeFn) {
  let resolveSelf, rejectSelf;
  const result = new Promise((res, rej) => { resolveSelf = res; rejectSelf = rej; });
  _writeQueue = _writeQueue.then(() => {
    try { writeFn(); resolveSelf(); }
    catch (e) { rejectSelf(e); }
  });
  _writeQueue = _writeQueue.catch(() => {});
  return result;
}

// ---------- Project CRUD ----------
function loadProjects() {
  // 优先使用 SQLite
  const database = getDB();
  if (database.isAvailable()) {
    const result = database.getProjects();
    if (result) return result;
  }
  // fallback to JSON
  return readJSON(projectsFile, []);
}

function saveProjects(projects) {
  const snapshot = [...projects];
  // 优先使用 SQLite
  const database = getDB();
  if (database.isAvailable()) {
    try {
      database.syncProjects(snapshot);
      return Promise.resolve();
    } catch (e) {
      log.error('SQLite 保存失败，回退到 JSON:', e.message);
    }
  }
  // fallback to JSON
  return serializedWrite(() => writeJSON(projectsFile, snapshot));
}

// 单项目增量保存：避免每次状态切换都全表 DELETE+INSERT
// 性能：O(1) 数据库操作；并发安全：仅更新对应行
function saveProject(project) {
  const database = getDB();
  if (database.isAvailable()) {
    try {
      database.upsertProject(project);
      return Promise.resolve();
    } catch (e) {
      log.error('SQLite 单项目保存失败，回退到 JSON 全量:', e.message);
    }
  }
  // fallback to JSON：load -> upsert -> write
  const all = loadProjects();
  const idx = all.findIndex(p => p.id === project.id);
  if (idx >= 0) all[idx] = project; else all.push(project);
  return serializedWrite(() => writeJSON(projectsFile, all));
}

// 单项目删除
function removeProject(id) {
  const database = getDB();
  if (database.isAvailable()) {
    try {
      database.deleteProject(id);
      return Promise.resolve();
    } catch (e) {
      log.error('SQLite 删除失败，回退到 JSON:', e.message);
    }
  }
  const all = loadProjects().filter(p => p.id !== id);
  return serializedWrite(() => writeJSON(projectsFile, all));
}

function loadSettings() {
  const database = getDB();
  if (database.isAvailable()) {
    const result = database.getAllSettings();
    if (result && Object.keys(result).length > 0) {
      return { ...DEFAULT_SETTINGS, ...result };
    }
  }
  return { ...DEFAULT_SETTINGS, ...readJSON(settingsFile, DEFAULT_SETTINGS) };
}

function saveSettings(settings) {
  const snapshot = { ...settings };
  const database = getDB();
  if (database.isAvailable()) {
    try {
      // 使用事务保证原子性：要么全部写入成功，要么全部回滚
      const dbRaw = database.getDB();
      const txn = dbRaw.transaction(() => {
        for (const [k, v] of Object.entries(snapshot)) database.setSetting(k, v);
      });
      txn();
      return Promise.resolve();
    } catch (e) {
      log.error('SQLite 保存设置失败（事务已回退）:', e.message);
      // 事务回滚后 SQLite 中数据未变更，安全回退到 JSON
    }
  }
  return serializedWrite(() => writeJSON(settingsFile, snapshot));
}

// ---------- 交付历史 ----------
const MAX_LOG_ENTRIES = config.defaults.maxLogEntries;

function loadDeliveryLog() {
  const database = getDB();
  if (database.isAvailable()) {
    const result = database.getDeliveryLogs(MAX_LOG_ENTRIES);
    if (result) return result;
  }
  return readJSON(deliveryLogFile, []);
}

function addDeliveryLog(projectName, projectId, action, detail, ok, fail) {
  const entry = {
    time: new Date().toISOString(),
    projectName, projectId, action, detail, ok: ok || 0, fail: fail || 0,
  };
  const database = getDB();
  if (database.isAvailable()) {
    try {
      database.addDeliveryLog(entry);
      return Promise.resolve();
    } catch (e) {
      log.error('SQLite 写入交付日志失败:', e.message);
    }
  }
  // fallback to JSON
  const logs = loadDeliveryLog();
  logs.unshift(entry);
  if (logs.length > MAX_LOG_ENTRIES) logs.length = MAX_LOG_ENTRIES;
  return serializedWrite(() => writeJSON(deliveryLogFile, logs));
}

module.exports = {
  loadProjects, saveProjects, saveProject, removeProject,
  loadSettings, saveSettings,
  loadDeliveryLog, addDeliveryLog,
};
