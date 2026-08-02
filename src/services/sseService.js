/**
 * SSE 实时推送服务 (Feature 4)
 * 替代前端 300ms 轮询，服务端主动推送事件
 * 支持：任务进度、集数变化、NAS 连通性、通知消息
 */
const config = require('../config');
const log = require('./logger').createLogger('sse');

const clients = new Set();
let heartbeatTimer = null;

function init() {
  if (heartbeatTimer) return;
  const interval = config.sse.heartbeatInterval;
  heartbeatTimer = setInterval(() => {
    if (clients.size === 0) return;
    broadcast('heartbeat', { time: Date.now(), clients: clients.size });
  }, interval);
  log.info('SSE 服务已启动，心跳间隔', interval, 'ms');
}

function addClient(res) {
  if (clients.size >= config.sse.maxConnections) {
    res.status(503).json({ error: 'SSE 连接数已达上限' });
    return false;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
  clients.add(res);
  log.info('SSE 客户端已连接，当前连接数:', clients.size);

  res.on('close', () => {
    clients.delete(res);
    log.info('SSE 客户端已断开，当前连接数:', clients.size);
  });
  return true;
}

function send(client, event, data) {
  try {
    client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    clients.delete(client);
  }
}

function broadcast(event, data) {
  if (clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.write(payload); }
    catch (e) { clients.delete(client); }
  }
}

// ── 事件类型快捷方法 ──
function pushJobProgress(job) {
  broadcast('job:progress', {
    id: job.id,
    type: job.type,
    current: job.current,
    totalItems: job.totalItems,
    completed: job.completed,
    failed: job.failed,
    skipped: job.skipped,
    status: job.status,
    elapsed: job.startTime ? ((job.endTime || Date.now()) - job.startTime) : 0,
  });
}

function pushJobComplete(job) {
  broadcast('job:complete', {
    id: job.id,
    type: job.type,
    status: job.status,
    completed: job.completed,
    failed: job.failed,
    skipped: job.skipped,
    totalBytes: job.totalBytes || 0,
    elapsed: job.startTime ? (job.endTime - job.startTime) : 0,
  });
}

function pushEpisodeUpdate(projectId, data) {
  broadcast('episode:update', { projectId, ...data });
}

function pushProjectUpdate(action, project) {
  broadcast('project:update', { action, project });
}

function pushNotification(title, body, level) {
  broadcast('notification', { title, body, level: level || 'info', time: Date.now() });
}

function pushStats(data) {
  broadcast('stats:update', data);
}

module.exports = {
  init,
  addClient,
  broadcast,
  pushJobProgress,
  pushJobComplete,
  pushEpisodeUpdate,
  pushProjectUpdate,
  pushNotification,
  pushStats,
};
