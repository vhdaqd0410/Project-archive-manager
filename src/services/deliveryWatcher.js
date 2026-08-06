/**
 * 交付监控服务 (Delivery Watcher)
 * 定时扫描"剪辑中"且设置了目标集数的项目，当本地关键词目录视频数达到目标时
 * 通过 SSE 推送 + 桌面通知提醒"可交付"，附带 quick-deliver 深链。
 *
 * 设计要点：
 * - 轻量：复用 fileService.countVideoFiles，单次只读目录元数据，不复制文件
 * - 冷却：同一项目两次提醒间隔不小于 cooldownMs，避免反复打扰
 * - 状态：只关心 status='editing' 的项目；状态变化后冷却自动重置
 */
const config = require('../config');
const log = require('./logger').createLogger('watcher');
const fileService = require('./fileService');
const sse = require('./sseService');

let timer = null;
let shared = null;        // 注入的 shared 模块（提供 projects 列表）
const lastNotified = new Map(); // projectId -> 上次提醒时间戳(ms)

function init(sharedModule) {
  shared = sharedModule;
  if (!config.deliveryWatcher || !config.deliveryWatcher.enabled) {
    log.info('交付监控未启用');
    return;
  }
  if (timer) return;
  const interval = config.deliveryWatcher.intervalMs;
  // 启动后延迟 30s 做首次扫描，避免与启动初始化抢资源
  setTimeout(() => scanOnce().catch(e => log.warn('首次扫描失败:', e.message)), 30 * 1000);
  timer = setInterval(() => scanOnce().catch(e => log.warn('扫描失败:', e.message)), interval);
  if (timer.unref) timer.unref();
  log.info('交付监控已启动，间隔', interval, 'ms');
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  lastNotified.clear();
}

async function scanOnce() {
  if (!shared || !shared.projects) return;
  const now = Date.now();
  const cooldown = (config.deliveryWatcher && config.deliveryWatcher.cooldownMs) || 0;
  const keyword = (shared.settings && shared.settings.keyword) || config.defaults.keyword;

  const editingProjects = shared.projects.filter(p =>
    p && p.status === 'editing' && p.episodeTarget && p.episodeTarget > 0
  );
  if (!editingProjects.length) return;

  for (const p of editingProjects) {
    try {
      const resolved = await fileService.resolveEpisodeDirs(p, keyword);
      if (!resolved.relPath || !resolved.localExists) continue;
      const videoCount = await countVideoFilesOnce(resolved.localEpDir);
      if (videoCount < p.episodeTarget) continue;

      // 达标 — 检查冷却
      const last = lastNotified.get(p.id) || 0;
      if (now - last < cooldown) continue;

      // 推送 SSE + 桌面通知
      const payload = {
        projectId: p.id,
        projectName: p.name,
        episodeTarget: p.episodeTarget,
        videoCount,
        nasDir: resolved.nasEpDir,
        localDir: resolved.localEpDir,
        keyword,
        time: new Date().toISOString(),
      };
      sse.broadcast('delivery_ready', payload);
      sse.pushNotification(
        '📦 可交付：' + p.name,
        '已集齐 ' + videoCount + '/' + p.episodeTarget + ' 集，点击立即交付',
        'success'
      );
      lastNotified.set(p.id, now);
      log.info('项目达标已提醒:', p.name, videoCount + '/' + p.episodeTarget);
    } catch (e) {
      log.warn('扫描项目失败:', p && p.name, e.message);
    }
  }
}

// 本地视频文件计数（与 routes/projects.js 中 countVideoFiles 保持一致）
const VIDEO_EXTS = config.videoExtensions;
async function countVideoFilesOnce(dir) {
  if (!dir) return 0;
  let count = 0;
  try {
    const fs = require('fs');
    for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (e.isFile() && VIDEO_EXTS.has(require('path').extname(e.name).toLowerCase())) count++;
    }
  } catch (_) {}
  return count;
}

// 项目状态变化时重置冷却（由 projects 路由调用）
function resetCooldown(projectId) {
  if (projectId) lastNotified.delete(projectId);
  else lastNotified.clear();
}

module.exports = { init, stop, scanOnce, resetCooldown };
