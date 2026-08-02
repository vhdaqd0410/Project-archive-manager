/**
 * SQLite 数据层 (Feature 5)
 * 替代 JSON 文件存储，提供 ACID 事务、复杂查询能力
 * 自动从 JSON 迁移数据，如果 better-sqlite3 不可用则回退到 JSON
 */
const config = require('../config');
const path = require('path');
const fs = require('fs');
const log = require('./logger').createLogger('db');

let db = null;
let available = false;

function init() {
  if (!config.database.enabled) { log.info('SQLite 未启用，使用 JSON 存储'); return null; }
  try {
    const Database = require('better-sqlite3');
    const dbPath = config.database.path;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    createTables();
    available = true;
    log.info('SQLite 已初始化:', dbPath);

    if (config.database.autoMigrate) migrateFromJSON();
    return db;
  } catch (e) {
    log.error('SQLite 初始化失败，回退到 JSON:', e.message);
    return null;
  }
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      localDir TEXT DEFAULT '',
      nasDir TEXT DEFAULT '',
      status TEXT DEFAULT 'editing',
      memo TEXT DEFAULT '',
      episodeTarget INTEGER DEFAULT 0,
      episodeAssignments TEXT DEFAULT '[]',
      createdAt TEXT,
      updatedAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS delivery_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL,
      projectName TEXT,
      projectId TEXT,
      action TEXT,
      detail TEXT,
      ok INTEGER DEFAULT 0,
      fail INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS file_checksums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projectId TEXT,
      filePath TEXT,
      fileName TEXT,
      sourceChecksum TEXT,
      destChecksum TEXT,
      verified INTEGER DEFAULT 0,
      verifiedAt TEXT,
      fileSize INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      displayName TEXT,
      passwordHash TEXT NOT NULL,
      role TEXT DEFAULT 'editor',
      createdAt TEXT DEFAULT (datetime('now')),
      lastLoginAt TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')),
      expiresAt TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT DEFAULT (datetime('now')),
      userId TEXT,
      username TEXT,
      action TEXT,
      target TEXT,
      detail TEXT
    );

    CREATE TABLE IF NOT EXISTS hooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      event TEXT NOT NULL,
      scriptPath TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      config TEXT DEFAULT '{}',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notification_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT DEFAULT (datetime('now')),
      channel TEXT,
      title TEXT,
      body TEXT,
      success INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS scheduler_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cron TEXT NOT NULL,
      action TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      lastRunAt TEXT,
      lastResult TEXT,
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS storage_backends (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      steps TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_instances (
      id TEXT PRIMARY KEY,
      definitionId TEXT NOT NULL,
      projectId TEXT NOT NULL,
      currentStep INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      context TEXT DEFAULT '{}',
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instanceId TEXT NOT NULL,
      stepIndex INTEGER,
      stepName TEXT,
      action TEXT,
      userId TEXT,
      username TEXT,
      result TEXT,
      time TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_tags (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#3b82f6',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_tag_map (
      projectId TEXT NOT NULL,
      tagId TEXT NOT NULL,
      PRIMARY KEY (projectId, tagId)
    );

    CREATE TABLE IF NOT EXISTS project_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS copy_operations (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      jobType TEXT,
      files TEXT DEFAULT '[]',
      nasDir TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      rolledBack INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS thumbnails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projectId TEXT,
      filePath TEXT,
      thumbnailPath TEXT,
      fileSize INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_delivery_logs_time ON delivery_logs(time DESC);
    CREATE INDEX IF NOT EXISTS idx_file_checksums_project ON file_checksums(projectId);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(time DESC);
    CREATE INDEX IF NOT EXISTS idx_workflow_instances_project ON workflow_instances(projectId);
    CREATE INDEX IF NOT EXISTS idx_copy_operations_project ON copy_operations(projectId);
    CREATE INDEX IF NOT EXISTS idx_thumbnails_project ON thumbnails(projectId);
  `);
}

function migrateFromJSON() {
  const projectsCount = db.prepare('SELECT COUNT(*) as c FROM projects').get();
  if (projectsCount.c > 0) { log.info('SQLite 已有数据，跳过迁移'); return; }

  const dataDir = config.dataDir;
  let migrated = 0;

  // 迁移 projects
  const pjFile = path.join(dataDir, 'projects.json');
  if (fs.existsSync(pjFile)) {
    try {
      const projects = JSON.parse(fs.readFileSync(pjFile, 'utf-8'));
      if (Array.isArray(projects) && projects.length) {
        const stmt = db.prepare(`INSERT OR REPLACE INTO projects
          (id, name, localDir, nasDir, status, memo, episodeTarget, episodeAssignments, createdAt, updatedAt)
          VALUES (@id, @name, @localDir, @nasDir, @status, @memo, @episodeTarget, @episodeAssignments, @createdAt, @updatedAt)`);
        const tx = db.transaction((items) => {
          for (const p of items) {
            stmt.run({
              id: p.id, name: p.name, localDir: p.localDir || '', nasDir: p.nasDir || '',
              status: p.status || 'editing', memo: p.memo || '',
              episodeTarget: p.episodeTarget || 0,
              episodeAssignments: JSON.stringify(p.episodeAssignments || []),
              createdAt: p.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
        });
        tx(projects);
        migrated += projects.length;
      }
    } catch (e) { log.warn('迁移 projects.json 失败:', e.message); }
  }

  // 迁移 settings
  const stFile = path.join(dataDir, 'settings.json');
  if (fs.existsSync(stFile)) {
    try {
      const settings = JSON.parse(fs.readFileSync(stFile, 'utf-8'));
      const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      const tx = db.transaction((obj) => {
        for (const [k, v] of Object.entries(obj)) stmt.run(k, JSON.stringify(v));
      });
      tx(settings);
    } catch (e) { log.warn('迁移 settings.json 失败:', e.message); }
  }

  // 迁移 delivery logs
  const dlFile = path.join(dataDir, 'delivery-log.json');
  if (fs.existsSync(dlFile)) {
    try {
      const logs = JSON.parse(fs.readFileSync(dlFile, 'utf-8'));
      if (Array.isArray(logs) && logs.length) {
        const stmt = db.prepare(`INSERT INTO delivery_logs
          (time, projectName, projectId, action, detail, ok, fail)
          VALUES (@time, @projectName, @projectId, @action, @detail, @ok, @fail)`);
        const tx = db.transaction((items) => {
          for (const l of items) stmt.run({
            time: l.time, projectName: l.projectName, projectId: l.projectId,
            action: l.action, detail: l.detail, ok: l.ok || 0, fail: l.fail || 0,
          });
        });
        tx(logs);
        migrated += logs.length;
      }
    } catch (e) { log.warn('迁移 delivery-log.json 失败:', e.message); }
  }

  if (migrated > 0) log.info(`从 JSON 迁移了 ${migrated} 条记录到 SQLite`);
}

// ── Helper: projects CRUD ──
function getProjects() {
  if (!available) return null;
  const rows = db.prepare('SELECT * FROM projects ORDER BY createdAt DESC').all();
  return rows.map(r => ({
    ...r,
    episodeAssignments: JSON.parse(r.episodeAssignments || '[]'),
  }));
}

function upsertProject(p) {
  if (!available) return;
  db.prepare(`INSERT OR REPLACE INTO projects
    (id, name, localDir, nasDir, status, memo, episodeTarget, episodeAssignments, createdAt, updatedAt)
    VALUES (@id, @name, @localDir, @nasDir, @status, @memo, @episodeTarget, @episodeAssignments, @createdAt, @updatedAt)`)
    .run({
      id: p.id, name: p.name, localDir: p.localDir || '', nasDir: p.nasDir || '',
      status: p.status || 'editing', memo: p.memo || '',
      episodeTarget: p.episodeTarget || 0,
      episodeAssignments: JSON.stringify(p.episodeAssignments || []),
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
}

function deleteProject(id) {
  if (!available) return;
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

function syncProjects(projects) {
  if (!available) return;
  const tx = db.transaction((items) => {
    db.prepare('DELETE FROM projects').run();
    for (const p of items) upsertProject(p);
  });
  tx(projects);
}

// ── Helper: settings ──
function getSetting(key, fallback) {
  if (!available) return fallback;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

function setSetting(key, value) {
  if (!available) return;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

function getAllSettings() {
  if (!available) return null;
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const r of rows) { try { obj[r.key] = JSON.parse(r.value); } catch {} }
  return obj;
}

// ── Helper: delivery logs ──
function getDeliveryLogs(limit) {
  if (!available) return null;
  return db.prepare('SELECT * FROM delivery_logs ORDER BY time DESC LIMIT ?').all(limit || 500);
}

function addDeliveryLog(entry) {
  if (!available) return;
  db.prepare(`INSERT INTO delivery_logs (time, projectName, projectId, action, detail, ok, fail)
    VALUES (@time, @projectName, @projectId, @action, @detail, @ok, @fail)`)
    .run(entry);
}

// ── Helper: tags ──
function getTags() {
  if (!available) return [];
  return db.prepare('SELECT * FROM project_tags ORDER BY name').all();
}
function addTag(tag) {
  if (!available) return;
  db.prepare('INSERT OR REPLACE INTO project_tags (id, name, color) VALUES (?, ?, ?)').run(tag.id, tag.name, tag.color || '#3b82f6');
}
function deleteTag(id) {
  if (!available) return;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM project_tags WHERE id = ?').run(id);
    db.prepare('DELETE FROM project_tag_map WHERE tagId = ?').run(id);
  });
  tx();
}
function getProjectTags(projectId) {
  if (!available) return [];
  return db.prepare(`SELECT t.* FROM project_tags t
    JOIN project_tag_map m ON t.id = m.tagId
    WHERE m.projectId = ? ORDER BY t.name`).all(projectId);
}
function setProjectTags(projectId, tagIds) {
  if (!available) return;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM project_tag_map WHERE projectId = ?').run(projectId);
    for (const tid of tagIds) db.prepare('INSERT OR IGNORE INTO project_tag_map (projectId, tagId) VALUES (?, ?)').run(projectId, tid);
  });
  tx();
}

// ── Helper: project templates ──
function getTemplates() {
  if (!available) return [];
  return db.prepare('SELECT * FROM project_templates ORDER BY createdAt DESC').all();
}
function getTemplate(id) {
  if (!available) return null;
  return db.prepare('SELECT * FROM project_templates WHERE id = ?').get(id);
}
function saveTemplate(t) {
  if (!available) return;
  db.prepare('INSERT OR REPLACE INTO project_templates (id, name, config, createdAt) VALUES (?, ?, ?, ?)').run(t.id, t.name, JSON.stringify(t.config || {}), t.createdAt || new Date().toISOString());
}
function deleteTemplate(id) {
  if (!available) return;
  db.prepare('DELETE FROM project_templates WHERE id = ?').run(id);
}

// ── Helper: copy operations (rollback) ──
function addCopyOperation(op) {
  if (!available) return;
  db.prepare(`INSERT INTO copy_operations (id, projectId, jobType, files, nasDir, createdAt, rolledBack)
    VALUES (@id, @projectId, @jobType, @files, @nasDir, @createdAt, 0)`).run(op);
}
function getCopyOperations(projectId, limit) {
  if (!available) return [];
  return db.prepare('SELECT * FROM copy_operations WHERE projectId = ? ORDER BY createdAt DESC LIMIT ?').all(projectId, limit || 20);
}
function getCopyOperation(id) {
  if (!available) return null;
  return db.prepare('SELECT * FROM copy_operations WHERE id = ?').get(id);
}
function markRolledBack(id) {
  if (!available) return;
  db.prepare('UPDATE copy_operations SET rolledBack = 1 WHERE id = ?').run(id);
}

// ── Helper: thumbnails ──
function getThumbnail(projectId, filePath) {
  if (!available) return null;
  return db.prepare('SELECT * FROM thumbnails WHERE projectId = ? AND filePath = ?').get(projectId, filePath);
}
function addThumbnail(rec) {
  if (!available) return;
  db.prepare('INSERT INTO thumbnails (projectId, filePath, thumbnailPath, fileSize) VALUES (?, ?, ?, ?)').run(rec.projectId, rec.filePath, rec.thumbnailPath, rec.fileSize || 0);
}

// ── Helper: audit logs ──
function getAuditLogs(filter) {
  if (!available) return [];
  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];
  if (filter && filter.username) { sql += ' AND username = ?'; params.push(filter.username); }
  if (filter && filter.action) { sql += ' AND action LIKE ?'; params.push('%' + filter.action + '%'); }
  sql += ' ORDER BY time DESC LIMIT ?';
  params.push(filter && filter.limit ? filter.limit : 200);
  return db.prepare(sql).all(...params);
}

module.exports = {
  init,
  getDB: () => db,
  isAvailable: () => available,
  close: () => {
    if (db) { try { db.close(); } catch (e) { /* ignore */ } db = null; available = false; }
  },
  getProjects,
  upsertProject,
  deleteProject,
  syncProjects,
  getSetting,
  setSetting,
  getAllSettings,
  getDeliveryLogs,
  addDeliveryLog,
  getTags, addTag, deleteTag, getProjectTags, setProjectTags,
  getTemplates, getTemplate, saveTemplate, deleteTemplate,
  addCopyOperation, getCopyOperations, getCopyOperation, markRolledBack,
  getThumbnail, addThumbnail,
  getAuditLogs,
};
