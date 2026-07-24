const express = require('express');
const path = require('path');
const apiRouter = require('./src/routes/api');

const app = express();
const PORT = 37890;

// 解析 JSON body
app.use(express.json());

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));

// API 路由
app.use('/api', apiRouter);

// SPA fallback（所有非 API 请求返回 index.html）
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`项目档案管理器已启动: http://localhost:${PORT}`);
  // 自动打开浏览器
  const { exec } = require('child_process');
  const platform = process.platform;
  const url = `http://localhost:${PORT}`;
  if (platform === 'win32') {
    exec(`start "" "${url}"`);
  } else if (platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
});
