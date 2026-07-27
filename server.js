const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 37890;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', require('./src/routes/api'));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n✅ 项目档案管理器已启动: ${url}`);
  console.log(`📌 PID: ${process.pid}`);
  console.log(`🛑 Ctrl+C 停止\n`);
  if (!process.env.RESTARTED) {
    require('child_process').exec(`start "" "${url}"`);
  }
});

process.on('SIGINT', () => {
  console.log('\n🛑 正在关闭服务...');
  server.close(() => { console.log('✅ 已停止'); process.exit(0); });
});
