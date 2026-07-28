// Electron 主进程 — 桌面应用
const { app, BrowserWindow, dialog, ipcMain, shell, Menu, Tray, globalShortcut, nativeTheme } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

const PORT = process.env.PORT || 37890;
let mainWindow = null;
let tray = null;
let serverProcess = null;
let activeWatchers = {};

// 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

function startServer() {
  return new Promise((resolve) => {
    serverProcess = fork(path.join(__dirname, '..', 'server.js'), [], {
      env: { ...process.env, PORT: String(PORT), ELECTRON: '1' },
      silent: true, stdio: 'pipe'
    });
    serverProcess.stdout.on('data', (d) => {
      const s = d.toString();
      process.stdout.write(s);
      if (s.includes('已启动')) resolve();
    });
    serverProcess.stderr.on('data', (d) => process.stderr.write(d.toString()));
    setTimeout(() => resolve(), 4000);
  });
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建项目', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.executeJavaScript("showProjectDlg(-1)") },
        { type: 'separator' },
        { label: '从文件夹导入...', click: () => mainWindow?.webContents.executeJavaScript("triggerFileDialog()") },
        { type: 'separator' },
        { label: '导出备份', click: () => mainWindow?.webContents.executeJavaScript("exportBackup()") },
        { label: '导入备份', click: () => mainWindow?.webContents.executeJavaScript("importBackup()") },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => { app.isQuitting = true; app.quit(); } }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { label: '开发者工具', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: '放大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于项目档案管理器', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: '关于', message: '项目档案管理器 v2.4.0', detail: '项目档案交付 NAS 管理工具\nElectron 桌面版\n\n拖放文件夹到窗口即可导入\nCtrl+Shift+D 全局热键呼出' }) },
        { label: '打开数据目录', click: () => shell.openPath(path.join(__dirname, '..', 'data')) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, '..', 'public', 'favicon.ico');
    tray = new Tray(iconPath);
    const autoStart = app.getLoginItemSettings().openAtLogin;
    const ctx = Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { label: '隐藏窗口', click: () => { if (mainWindow) mainWindow.hide(); } },
      { type: 'separator' },
      { label: '开机自启', type: 'checkbox', checked: autoStart, click: (mi) => { app.setLoginItemSettings({ openAtLogin: mi.checked }); } },
      { type: 'separator' },
      { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip('项目档案管理器');
    tray.setContextMenu(ctx);
    tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  } catch (e) {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 960, minHeight: 620,
    title: '项目档案管理器',
    icon: (function(){ try { const ni = require('electron').nativeImage; const b = Buffer.alloc(1024); b.fill(59,0,341); b.fill(130,341,682); b.fill(246,682,1024); return ni.createFromBuffer(b, {width:16,height:16}); } catch(e) { return undefined; } })(),
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadURL('http://localhost:' + PORT);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    buildMenu();
  });

  // 拖放文件到窗口
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const fp = decodeURIComponent(url.replace(/^file:\/\/\//i, ''));
    if (fp && !fp.startsWith('http') && fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
      e.preventDefault();
      mainWindow.webContents.executeJavaScript(
        'if(typeof handleDropImport==="function")handleDropImport(' + JSON.stringify(fp) + ')'
      );
    }
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// 目录监听
function startWatch(dirPath, projectId) {
  if (activeWatchers[projectId] || !dirPath || !fs.existsSync(dirPath)) return;
  try {
    const w = fs.watch(dirPath, { recursive: true }, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(
          'if(typeof onFsChanged==="function")onFsChanged(' + JSON.stringify(projectId) + ')'
        );
      }
    });
    activeWatchers[projectId] = w;
  } catch (e) {}
}
function stopWatch(projectId) {
  if (activeWatchers[projectId]) { activeWatchers[projectId].close(); delete activeWatchers[projectId]; }
}
function stopAllWatches() {
  for (const id of Object.keys(activeWatchers)) { try { activeWatchers[id].close(); } catch (e) {} delete activeWatchers[id]; }
}

// IPC
ipcMain.handle('pick-folder', async () => {
  if (!mainWindow) return { success: false, path: '' };
  const r = await dialog.showOpenDialog(mainWindow, { title: '选择文件夹', properties: ['openDirectory'] });
  return { success: !r.canceled, path: r.canceled ? '' : r.filePaths[0] || '' };
});
ipcMain.handle('open-explorer', async (_e, dirPath) => {
  if (!dirPath) return { success: false, error: '路径为空' };
  const err = await shell.openPath(dirPath);
  return { success: !err, error: err || '' };
});
ipcMain.handle('drop-import', async (_e, dirPath) => {
  try { return { success: true, path: dirPath, name: path.basename(dirPath) }; } catch (e) { return { success: false, error: '路径无效' }; }
});
ipcMain.handle('select-folder-import', async () => {
  if (!mainWindow) return { success: false };
  const r = await dialog.showOpenDialog(mainWindow, { title: '选择项目文件夹', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { success: false };
  return { success: true, path: r.filePaths[0], name: path.basename(r.filePaths[0]) };
});
ipcMain.on('start-watch', (_e, dirPath, projectId) => startWatch(dirPath, projectId));
ipcMain.on('stop-watch', (_e, projectId) => stopWatch(projectId));
ipcMain.on('stop-all-watch', () => stopAllWatches());

// 生命周期
app.isQuitting = false;

// ==================== 自动更新 ====================
autoUpdater.on('update-available', (info) => {
  dialog.showMessageBox(mainWindow, {
    type: 'info', title: '发现新版本',
    message: '版本 ' + info.version + ' 可用',
    detail: '是否立即下载更新？',
    buttons: ['立即下载', '稍后']
  }).then(function(r) {
    if (r.response === 0) autoUpdater.downloadUpdate();
  });
});
autoUpdater.on('update-downloaded', () => {
  dialog.showMessageBox(mainWindow, {
    type: 'info', title: '更新已下载',
    message: '更新将在下次启动时安装',
    buttons: ['立即重启', '稍后']
  }).then(function(r) {
    if (r.response === 0) { autoUpdater.quitAndInstall(false, true); }
  });
});
autoUpdater.on('error', function() { /* 静默处理 */ });

app.whenReady().then(async () => {
  try { globalShortcut.register('CmdOrCtrl+Shift+D', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } }); } catch (e) {}
  await startServer();
  createTray();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  stopAllWatches();
  if (serverProcess) { serverProcess.kill('SIGTERM'); serverProcess = null; }
});
