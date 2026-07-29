const express = require('express');
const path = require('path');
const config = require('./src/config');
const app = express();
const PORT = config.server.port;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', require('./src/routes/api'));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n✅ 项目档案管理器已启动: ${url}`);
  console.log(`📌 PID: ${process.pid}`);
  // Electron 模式下不打印 Ctrl+C 提示
  if (!process.env.ELECTRON) console.log(`🛑 Ctrl+С 停止\n`);
});

process.on('SIGINT', () => {
  console.log('\n🛑 正在关闭服务...');
  server.close(() => { console.log('✅ 已停止'); process.exit(0); });
});
