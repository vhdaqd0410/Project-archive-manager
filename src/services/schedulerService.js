/**
 * 定时自动化服务 (Feature 7)
 * 使用 node-cron 定时执行：检测集数、自动复制、连通性检查
 */
const cron = require('node-cron');
const config = require('../config');
const log = require('./logger').createLogger('scheduler');

const tasks = {}; // id -> { cron, task, action, config, lastRun, lastResult }

function init(db) {
  if (!config.scheduler.enabled) { log.info('定时调度未启用'); return; }
  // 从数据库加载已保存的定时任务
  if (db && db.isAvailable()) {
    try {
      const rows = db.getDB().prepare('SELECT * FROM scheduler_tasks WHERE enabled = 1').all();
      for (const row of rows) {
        registerTask(row.id, row.name, row.cron, row.action, JSON.parse(row.config || '{}'));
      }
      log.info(`已加载 ${rows.length} 个定时任务`);
    } catch (e) { log.warn('加载定时任务失败:', e.message); }
  }
  // 注册默认任务：每 30 分钟检测所有项目集数
  if (Object.keys(tasks).length === 0) {
    registerTask('default-detect', '定时检测集数', config.scheduler.defaultCron, 'detect_episodes', {});
    log.info('已注册默认定时任务: 每30分钟检测集数');
  }
}

function registerTask(id, name, cronExpr, action, taskConfig) {
  // 取消已有任务
  if (tasks[id] && tasks[id].task) tasks[id].task.stop();

  if (!cron.validate(cronExpr)) {
    log.error('无效的 cron 表达式:', cronExpr);
    return false;
  }

  const task = cron.schedule(cronExpr, () => executeTask(id, name, action, taskConfig));
  tasks[id] = { id, name, cron: cronExpr, task, action, config: taskConfig, lastRun: null, lastResult: null };
  log.info(`定时任务已注册: ${name} (${cronExpr})`);
  return true;
}

function unregisterTask(id) {
  if (tasks[id]) {
    if (tasks[id].task) tasks[id].task.stop();
    delete tasks[id];
    log.info('定时任务已移除:', id);
  }
}

function getTasks() {
  return Object.values(tasks).map(t => ({
    id: t.id, name: t.name, cron: t.cron, action: t.action,
    lastRun: t.lastRun, lastResult: t.lastResult,
  }));
}

async function executeTask(id, name, action, taskConfig) {
  const t = tasks[id];
  if (!t) return;
  t.lastRun = new Date().toISOString();
  log.info(`执行定时任务: ${name} (${action})`);

  try {
    let result;
    // action 执行器需要访问 shared 状态和 fileService
    // 通过事件系统或直接 require 来获取
    const shared = require('../routes/shared');
    const fileService = require('./fileService');
    const sse = require('./sseService');
    const notify = require('./notifyService');

    switch (action) {
      case 'detect_episodes': {
        const keyword = shared.settings.keyword || config.defaults.keyword;
        const updates = [];
        // 快照迭代，避免用户同时增删项目导致跳过/重复
        const projects = [...shared.projects];
        for (const p of projects) {
          try {
            const resolved = await fileService.resolveEpisodeDirs(p, keyword);
            if (resolved.relPath && resolved.localExists) {
              const count = await fileService.countFilesInDir(resolved.localEpDir);
              updates.push({ projectId: p.id, name: p.name, count, target: p.episodeTarget });
              sse.pushEpisodeUpdate(p.id, { archiveCount: count, archivePath: resolved.localEpDir });
              // 达标通知
              if (p.episodeTarget > 0 && count >= p.episodeTarget && p.status === 'editing') {
                notify.send('集数达标', `${p.name} 已达到 ${p.episodeTarget} 集目标`, 'success');
              }
            }
          } catch (e) { log.warn('检测项目失败:', p.name, e.message); }
        }
        result = { action, checked: updates.length, updates };
        break;
      }
      case 'check_nas': {
        const fsp = require('fs').promises;
        let ok = 0, fail = 0;
        const projects = [...shared.projects];
        for (const p of projects) {
          if (!p.nasDir) continue;
          try { await fsp.access(p.nasDir); ok++; }
          catch { fail++; notify.send('NAS 不可达', `${p.name} 的 NAS 路径不可访问`, 'warning'); }
        }
        result = { action, ok, fail };
        break;
      }
      default:
        result = { action, error: 'unknown_action' };
    }

    t.lastResult = JSON.stringify(result);
    sse.broadcast('scheduler:run', { id, name, result });
    log.info(`定时任务完成: ${name}`, JSON.stringify(result).slice(0, 200));
  } catch (e) {
    t.lastResult = JSON.stringify({ error: e.message });
    log.error(`定时任务失败: ${name}`, e.message);
  }
}

function stopAll() {
  for (const t of Object.values(tasks)) {
    if (t.task) t.task.stop();
  }
  log.info('所有定时任务已停止');
}

module.exports = { init, registerTask, unregisterTask, getTasks, executeTask, stopAll };
