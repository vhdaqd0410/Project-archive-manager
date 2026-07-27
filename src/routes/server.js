const express = require('express');
const router = express.Router();
const path = require('path');
const serverStartTime = Date.now();
const PORT = process.env.PORT || 37890;

router.get('/status', (req, res) => {
  const uptime = Math.floor((Date.now() - serverStartTime) / 1000);
  const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60), s = uptime % 60;
  const uptimeStr = (h > 0 ? h + '时' : '') + (m > 0 ? m + '分' : '') + s + '秒';
  res.json({ running: true, pid: process.pid, port: PORT, uptime: uptimeStr, startedAt: new Date(serverStartTime).toLocaleString('zh-CN') });
});

router.post('/restart', (req, res) => {
  res.json({ success: true, message: '服务即将重启，3 秒后刷新...' });
  setTimeout(() => {
    const serverPath = path.join(__dirname, '..', '..', 'server.js');
    const child = require('child_process').spawn('node', [serverPath], {
      detached: true, stdio: 'inherit',
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, RESTARTED: '1' }
    });
    child.unref();
    process.exit(0);
  }, 1500);
});

router.post('/stop', (req, res) => {
  res.json({ success: true, message: '服务正在关闭...' });
  setTimeout(() => process.exit(0), 200);
});

module.exports = router;
