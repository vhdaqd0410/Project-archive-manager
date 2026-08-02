const express = require('express');
const path = require('path');
const config = require('./src/config');
const app = express();
const PORT = config.server.port;
const HOST = config.server.host;

// ── 初始化所有服务 ──
const db = require('./src/services/db');
const sseService = require('./src/services/sseService');
const schedulerService = require('./src/services/schedulerService');
const storageBackend = require('./src/services/storageBackend');
const workflowService = require('./src/services/workflowService');

// 初始化 SQLite 数据库
db.init();
// 初始化 SSE 服务
sseService.init();
// 初始化存储后端
storageBackend.init(db);
// 初始化工作流模板
workflowService.init(db);
// 初始化定时调度
schedulerService.init(db);

// ── 中间件 ──
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── 认证中间件 (Feature 9) ──
const authService = require('./src/services/authService');
app.use(authService.middleware(db));

// ── 挂载路由 ──
app.use('/api', require('./src/routes/api'));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = app.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`\n✅ 项目档案管理器已启动: ${url}`);
  console.log(`📌 PID: ${process.pid}`);
  console.log(`🔒 仅监听 ${HOST}（局域网不可访问）`);
  if (db.isAvailable()) console.log(`💾 SQLite 数据库已启用`);
  if (!process.env.ELECTRON) console.log(`🛑 Ctrl+C 停止\n`);
});

// ── 优雅关闭 ──
function gracefulShutdown(signal) {
  console.log(`\n🛑 收到 ${signal}，正在关闭服务...`);
  let exited = false;

  // 5 秒超时强制退出
  const forceTimer = setTimeout(() => {
    if (!exited) { console.error('⚠️ 关闭超时，强制退出'); process.exit(1); }
  }, 5000);

  schedulerService.stopAll();
  server.close(() => {
    // 关闭数据库连接
    try { if (db.isAvailable()) db.close(); } catch (e) { /* ignore */ }
    clearTimeout(forceTimer);
    exited = true;
    console.log('✅ 已停止');
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = app;
