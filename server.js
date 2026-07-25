const express = require('express');
const path = require('path');
const app = express();
const PORT = 37890;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', require('./src/routes/api'));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`项目档案管理器已启动: http://localhost:${PORT}`);
  require('child_process').exec(`start "" "http://localhost:${PORT}"`);
});
