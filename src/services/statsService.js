/**
 * 项目统计服务 (Feature 3)
 * 聚合项目数据，提供仪表盘所需的统计数据
 */
const log = require('./logger').createLogger('stats');
const config = require('../config');

let cache = null;
let cacheTime = 0;

function compute(projects, deliveryLogs) {
  const now = Date.now();
  if (cache && (now - cacheTime) < config.stats.cacheTTL) return cache;
  cacheTime = now;

  // 状态分布
  const statusDist = { editing: 0, initial: 0, modifying: 0, '000': 0, done: 0, archive: 0 };
  for (const p of projects) {
    if (statusDist[p.status] !== undefined) statusDist[p.status]++;
  }

  // 集数完成度（仅 editing 状态且有 episodeTarget 的项目）
  const progress = [];
  for (const p of projects) {
    if (p.episodeTarget > 0) {
      progress.push({
        id: p.id,
        name: p.name,
        status: p.status,
        target: p.episodeTarget,
        // 如果有 archiveCount 字段用之，否则显示 0
        current: p._archiveCount || 0,
        pct: p._archiveCount ? Math.min(100, Math.round(p._archiveCount / p.episodeTarget * 100)) : 0,
      });
    }
  }

  // 交付历史统计（最近 7 天）
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const recentLogs = (deliveryLogs || []).filter(l => new Date(l.time) > sevenDaysAgo);
  const dailyDelivery = {};
  for (const l of recentLogs) {
    const day = l.time.slice(0, 10);
    if (!dailyDelivery[day]) dailyDelivery[day] = { date: day, ok: 0, fail: 0 };
    dailyDelivery[day].ok += (l.ok || 0);
    dailyDelivery[day].fail += (l.fail || 0);
  }

  // 存储空间统计
  let totalEpisodes = 0;
  for (const p of projects) {
    totalEpisodes += (p._archiveCount || 0);
  }

  cache = {
    summary: {
      total: projects.length,
      editing: statusDist.editing,
      initial: statusDist.initial,
      modifying: statusDist.modifying,
      '000': statusDist['000'],
      done: statusDist.done,
      archive: statusDist.archive,
      totalEpisodes,
      todayDelivery: Object.values(dailyDelivery).filter(d => d.date === new Date().toISOString().slice(0, 10))
        .reduce((s, d) => s + d.ok, 0),
    },
    statusDistribution: [
      { label: '剪辑中', value: statusDist.editing, color: '#3b82f6' },
      { label: '初版交付', value: statusDist.initial, color: '#06b6d4' },
      { label: '修改中', value: statusDist.modifying, color: '#f59e0b' },
      { label: '000交付', value: statusDist['000'], color: '#a855f7' },
      { label: '已完成', value: statusDist.done, color: '#22c55e' },
      { label: '归档', value: statusDist.archive, color: '#64748b' },
    ],
    episodeProgress: progress,
    deliveryTrend: Object.values(dailyDelivery).sort((a, b) => a.date.localeCompare(b.date)),
    generatedAt: new Date().toISOString(),
  };
  return cache;
}

function invalidate() { cache = null; }

module.exports = { compute, invalidate };
