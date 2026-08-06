const express = require('express');
const path = require('path');
const fs = require('fs');
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
const deliveryWatcher = require('./src/services/deliveryWatcher');
const stallWatcher = require('./src/services/stallWatcher');
const backupService = require('./src/services/backupService');

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
// 初始化交付监控（注入 shared 模块以读取 projects 列表）
deliveryWatcher.init(require('./src/routes/shared'));
// 初始化停滞监控
stallWatcher.start();
// 初始化数据备份服务
backupService.start();

// ── 中间件 ──
app.use(express.json({ limit: '50mb' }));

// 静态前端目录：使用原始桌面版（public/，HTML+JS 单文件版本）
const publicDir = path.join(__dirname, 'public');
const staticDir = publicDir;
app.use(express.static(staticDir, {
  etag: false,
  lastModified: false,
  setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store'); }
}));

// ── 认证中间件 (Feature 9) ──
const authService = require('./src/services/authService');
app.use(authService.middleware(db));

// ── 挂载路由 ──
app.use('/api', require('./src/routes/api'));

// SPA fallback（禁用缓存，确保始终加载最新页面）
// 使用与静态资源相同的根目录，避免 dist-web 已构建却仍回退到 public 的 bug
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(staticDir, 'index.html'));
});

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
  deliveryWatcher.stop();
  stallWatcher.stop();
  backupService.stop();
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
