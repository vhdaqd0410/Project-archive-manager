/**
 * 数据自动备份服务
 * 每日定时备份 SQLite 数据库到 data/backups/，保留最近 N 份
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('../config');
const log = require('./logger').createLogger('backup');

const BACKUP_DIR = path.join(config.dataDir, 'backups');
const MAX_BACKUPS = 7;
let timer = null;

function start() {
  // 启动后 30s 执行首次检查
  setTimeout(checkAndBackup, 30000);
  // 每 6 小时检查一次
  timer = setInterval(checkAndBackup, 6 * 60 * 60 * 1000);
  log.info('数据备份服务已启动');
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

async function checkAndBackup() {
  if (!config.database.enabled) return;
  const dbPath = config.database.path;
  try {
    await fsp.access(dbPath);
  } catch (e) { return; }

  await fsp.mkdir(BACKUP_DIR, { recursive: true }).catch(() => {});
  const today = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(BACKUP_DIR, 'archive-' + today + '.db');

  // 今日已备份则跳过
  try {
    await fsp.access(backupPath);
    return;
  } catch (e) { /* 不存在,继续备份 */ }

  // 复制数据库（SQLite 用文件复制即可，应用层保证无写入冲突）
  await fsp.copyFile(dbPath, backupPath);
  log.info('已备份到', backupPath);

  // 清理超过 MAX_BACKUPS 的旧备份
  const files = await fsp.readdir(BACKUP_DIR);
  const backups = files.filter(f => f.startsWith('archive-') && f.endsWith('.db'))
    .sort().reverse();
  for (let i = MAX_BACKUPS; i < backups.length; i++) {
    await fsp.unlink(path.join(BACKUP_DIR, backups[i])).catch(() => {});
    log.info('清理旧备份', backups[i]);
  }
}

// 手动触发立即备份
async function backupNow() {
  await checkAndBackup();
  const files = await listBackups();
  return files[0] || null;
}

async function listBackups() {
  try {
    await fsp.mkdir(BACKUP_DIR, { recursive: true }).catch(() => {});
    const files = await fsp.readdir(BACKUP_DIR);
    return files.filter(f => f.startsWith('archive-') && f.endsWith('.db'))
      .sort().reverse()
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: stat.size, mtime: stat.mtime };
      });
  } catch (e) { return []; }
}

async function restore(backupName) {
  if (!backupName || !backupName.startsWith('archive-') || !backupName.endsWith('.db')) {
    throw new Error('无效的备份文件名');
  }
  const backupPath = path.join(BACKUP_DIR, backupName);
  await fsp.access(backupPath);
  const dbPath = config.database.path;
  // 先备份当前数据库（防止恢复后反悔）
  const currentBackup = path.join(BACKUP_DIR, 'archive-pre-restore-' + Date.now() + '.db');
  try { await fsp.copyFile(dbPath, currentBackup); } catch (_) {}
  await fsp.copyFile(backupPath, dbPath);
  log.info('已从', backupName, '恢复数据库');
  return true;
}

module.exports = { start, stop, backupNow, listBackups, restore, BACKUP_DIR };
