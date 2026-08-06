/**
 * 项目停滞监控 (Stall Watcher)
 * 定时扫描"剪辑中"项目，localDir 关键词目录超过阈值未更新则提醒
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('../config');
const shared = require('../routes/shared');
const fileService = require('./fileService');
const sse = require('./sseService');
const log = require('./logger').createLogger('stallWatcher');

let intervalTimer = null;
let initialTimer = null;
const cooldowns = new Map(); // projectId -> lastNotifyTime

function start() {
  if (!config.stallWatcher.enabled) { log.info('停滞监控未启用'); return; }
  // 延迟 60s 首扫，避免与 deliveryWatcher 启动竞争
  initialTimer = setTimeout(() => { scan(); initialTimer = null; }, 60000);
  intervalTimer = setInterval(scan, config.stallWatcher.intervalMs);
  log.info('停滞监控已启动，间隔', config.stallWatcher.intervalMs / 60000, '分钟');
}

function stop() {
  if (initialTimer) { clearTimeout(initialTimer); initialTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
  log.info('停滞监控已停止');
}

async function scan() {
  const editingProjects = shared.projects.filter(p => p.status === 'editing' && p.localDir);
  if (!editingProjects.length) return;
  const now = Date.now();
  const threshold = config.stallWatcher.stallThresholdMs;
  let stalled = 0;

  for (const p of editingProjects) {
    try {
      const lastUpdate = await getLastUpdateTime(p);
      if (!lastUpdate) continue;
      const stallMs = now - lastUpdate;
      if (stallMs <= threshold) continue;

      // 冷却检查
      const lastNotify = cooldowns.get(p.id) || 0;
      if (now - lastNotify < config.stallWatcher.cooldownMs) continue;

      const days = Math.floor(stallMs / (24 * 60 * 60 * 1000));
      const msg = `项目「${p.name}」已 ${days} 天未更新，目标 ${p.episodeTarget || '?'} 集`;
      log.info('停滞提醒:', msg);
      sse.pushNotification('⏰ 项目停滞提醒', msg, 'warn');
      cooldowns.set(p.id, now);
      stalled++;
    } catch (e) {
      log.warn('停滞检测失败', p.name, e.message);
    }
  }
  if (stalled > 0) log.info(`本轮检测到 ${stalled} 个停滞项目`);
}

// 获取项目关键词目录下最新文件 mtime（衡量产出活跃度）
async function getLastUpdateTime(p) {
  try {
    const kw = shared.settings.keyword || config.defaults.keyword;
    let scanDir = p.localDir;
    // 尝试找到关键词子目录（如"项目归档资料"），扫描其中的最新文件
    const rel = await fileService.findKeywordDir(p.localDir, kw);
    if (rel) scanDir = path.join(p.localDir, rel);

    let maxMtime = 0;
    const entries = await fsp.readdir(scanDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      try {
        const stat = await fsp.stat(path.join(scanDir, e.name));
        if (stat.mtimeMs > maxMtime) maxMtime = stat.mtimeMs;
      } catch (_) {}
    }
    return maxMtime;
  } catch (e) {
    return 0; // 目录不存在等，返回0（不触发）
  }
}

function resetCooldown(projectId) {
  cooldowns.delete(projectId);
}

module.exports = { start, stop, scan, resetCooldown };
