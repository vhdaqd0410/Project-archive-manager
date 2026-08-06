// Electron 主进程 — 桌面应用
const { app, BrowserWindow, dialog, ipcMain, shell, Menu, Tray, globalShortcut, nativeTheme, Notification, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

// 统一从 package.json 读取版本号，避免多处硬编码
const APP_VERSION = require('../package.json').version;

// Windows 通知必须设置 AppUserModelId
if (process.platform === 'win32') {
  app.setAppUserModelId('com.pam.project-archive-manager');
}

const PORT = process.env.PORT || 37890;
let mainWindow = null;
let tray = null;
let serverProcess = null;
let activeWatchers = {};
let _globalHotkeyAccel = 'CmdOrCtrl+Shift+D'; // 默认全局热键

// ═══════════════════════════════════════════
//  程序化图标生成（无文件依赖，所有尺寸统一风格）
// ═══════════════════════════════════════════
function generateAppIcon(size) {
  // 调色板
  const C = {
    bgTop:    [59, 130, 246],   // #3B82F6 蓝
    bgBot:    [37, 99, 235],    // #2563EB 深蓝
    folder:   [255, 255, 255],  // 白色文件夹
    foldDark: [219, 234, 254],  // #DBEAFE 浅蓝文件夹阴影
    check:    [34, 197, 94],    // #22C55E 绿色对勾
    line:     [30, 64, 175],    // #1E40AF 深蓝线
  };

  const buf = Buffer.alloc(size * size * 4);
  const half = size / 2;
  const r = size * 0.20;                // 圆角半径
  const tabW = size * 0.28;             // 文件夹标签宽度
  const tabH = size * 0.15;             // 文件夹标签高度
  const bodyTop = tabH * 0.85;          // 文件夹主体顶部
  const foldPad = size * 0.08;          // 文件夹内边距

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mixCol(c1, c2, t) { return [lerp(c1[0],c2[0],t), lerp(c1[1],c2[1],t), lerp(c1[2],c2[2],t)]; }

  // 圆角矩形内部判定
  function inRoundRect(x, y, l, t, w, h, cr) {
    const cx = x - (l + w/2), cy = y - (t + h/2);
    const ax = Math.abs(cx) - (w/2 - cr), ay = Math.abs(cy) - (h/2 - cr);
    if (ax <= 0 && ay <= 0) return 1;                // 内部
    if (ax > 0 && ay > 0) return ax*ax + ay*ay <= cr*cr ? 1 : 0; // 圆角区
    if (ax > 0) return ax <= cr ? 1 : 0;
    if (ay > 0) return ay <= cr ? 1 : 0;
    return 1;
  }
  // 距离边缘的归一化距离（用于抗锯齿）
  function edgeDist(x, y, l, t, w, h, cr) {
    const cx = x - (l + w/2), cy = y - (t + h/2);
    const ax = Math.abs(cx) - (w/2 - cr), ay = Math.abs(cy) - (h/2 - cr);
    if (ax <= 0 && ay <= 0) return Math.min(
      w/2 - cr - Math.abs(cx),
      h/2 - cr - Math.abs(cy)
    );
    if (ax > 0 && ay > 0) return cr - Math.sqrt(ax*ax + ay*ay);
    if (ax > 0) return cr - ax;
    return cr - ay;
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      const x = px + 0.5, y = py + 0.5;

      // ── 背景圆角矩形 ──
      const bgDist = edgeDist(x, y, 0, 0, size, size, r);
      const bgAA = Math.min(1, Math.max(0, bgDist + 0.5));
      if (bgAA <= 0) { buf[i+3] = 0; continue; }

      const gradT = py / size;
      const bgCol = mixCol(C.bgTop, C.bgBot, gradT);
      buf[i] = bgCol[0]; buf[i+1] = bgCol[1]; buf[i+2] = bgCol[2];
      buf[i+3] = Math.round(Math.min(255, bgAA * 255));

      // ── 文件夹标签 ──
      const tabLeft = size * 0.20;
      const tabDist = edgeDist(x, y, tabLeft, 0, tabW + r*0.3, tabH, r*0.4);
      if (tabDist > -0.3) {
        const tAA = Math.min(1, Math.max(0, tabDist + 0.5));
        const tCol = mixCol(C.bgBot, [29,78,216], gradT);
        const alpha = Math.round(tAA * 255);
        if (alpha > 0) {
          buf[i] = Math.round(lerp(buf[i], tCol[0], alpha/255));
          buf[i+1] = Math.round(lerp(buf[i+1], tCol[1], alpha/255));
          buf[i+2] = Math.round(lerp(buf[i+2], tCol[2], alpha/255));
        }
      }

      // ── 文件夹主体（白色面板） ──
      const fL = foldPad, fT = bodyTop + foldPad * 0.5;
      const fW = size - foldPad * 2, fH = size - fT - foldPad * 1.2;
      const fDist = edgeDist(x, y, fL, fT, fW, fH, r * 0.6);
      if (fDist > -0.4) {
        const fAA = Math.min(1, Math.max(0, fDist + 0.5));
        const alpha = Math.round(fAA * 255);
        if (alpha > 0) {
          buf[i] = Math.round(lerp(buf[i], C.folder[0], alpha/255));
          buf[i+1] = Math.round(lerp(buf[i+1], C.folder[1], alpha/255));
          buf[i+2] = Math.round(lerp(buf[i+2], C.folder[2], alpha/255));
        }
      }

      // ── 对勾 ✓ ──
      const cx = size * 0.52, cy = size * 0.58;
      const cw = size * 0.20, ch = size * 0.12;
      // 对勾由两条线段组成：从 (cx-cw, cy) → (cx, cy+ch) → (cx+cw*1.3, cy-ch*0.5)
      const checkThick = Math.max(1, size * 0.06);
      const x1 = cx - cw, y1 = cy;
      const x2 = cx, y2 = cy + ch;
      const x3 = cx + cw * 1.25, y3 = cy - ch * 0.6;

      function distToSeg(px, py, ax, ay, bx, by) {
        const abx = bx - ax, aby = by - ay;
        const len2 = abx*abx + aby*aby;
        let t = ((px-ax)*abx + (py-ay)*aby) / len2;
        t = Math.max(0, Math.min(1, t));
        const dx = px - (ax + t*abx), dy = py - (ay + t*aby);
        return Math.sqrt(dx*dx + dy*dy);
      }

      const d1 = distToSeg(x, y, x1, y1, x2, y2);
      const d2 = distToSeg(x, y, x2, y2, x3, y3);
      const minD = Math.min(d1, d2);
      const cAA = Math.min(1, Math.max(0, (checkThick - minD) * 0.5 + 0.3));
      if (cAA > 0) {
        const alpha = Math.round(cAA * 220);
        buf[i] = Math.round(lerp(buf[i], C.check[0], alpha/255));
        buf[i+1] = Math.round(lerp(buf[i+1], C.check[1], alpha/255));
        buf[i+2] = Math.round(lerp(buf[i+2], C.check[2], alpha/255));
      }
    }
  }

  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// 生成各尺寸图标（缓存）
const _iconCache = {};
function getAppIcon(size) {
  if (!_iconCache[size]) _iconCache[size] = generateAppIcon(size);
  return _iconCache[size];
}

// 注册全局热键
function registerGlobalHotkey(accelerator) {
  try {
    globalShortcut.unregisterAll();
    if (accelerator) {
      _globalHotkeyAccel = accelerator;
      // 将用户友好的快捷键转为 Electron accelerator 格式
      const accel = accelerator.replace(/Ctrl/g, 'CmdOrCtrl').replace(/\s*\+\s*/g, '+');
      const ok = globalShortcut.register(accel, () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          if (!mainWindow.isVisible()) mainWindow.show();
          mainWindow.focus();
        }
      });
      if (!ok) console.error('[PAM] 全局快捷键注册失败:', accel);
      return ok;
    }
    return true;
  } catch (e) {
    console.error('[PAM] 全局快捷键异常:', e.message);
    return false;
  }
}

// 呼出窗口（供 IPC 调用）
function showAndFocusWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
}

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
  return new Promise((resolve, reject) => {
    serverProcess = fork(path.join(__dirname, '..', 'server.js'), [], {
      env: { ...process.env, PORT: String(PORT), ELECTRON: '1' },
      silent: true, stdio: 'pipe'
    });
    let settled = false;
    const done = (ok, reason) => {
      if (settled) return;
      settled = true;
      ok ? resolve() : reject(new Error(reason || '服务启动失败'));
    };
    serverProcess.stdout.on('data', (d) => {
      const s = d.toString();
      process.stdout.write(s);
      if (s.includes('已启动')) done(true);
    });
    serverProcess.stderr.on('data', (d) => {
      const s = d.toString();
      process.stderr.write(s);
      if (s.includes('EADDRINUSE')) done(false, '端口 ' + PORT + ' 被占用，可能有另一个实例正在运行');
    });
    serverProcess.on('exit', (code) => {
      if (code !== 0) done(false, '服务进程异常退出 (code=' + code + ')');
    });
    serverProcess.on('error', (e) => done(false, '无法启动服务进程: ' + e.message));
    setTimeout(() => done(false, '服务启动超时'), 8000);
  });
}

// ── 启动失败 / 加载失败的兜底错误页 ──
function errorPageHtml(title, detail) {
  return '<!doctype html><meta charset="utf-8"><style>body{font-family:"Microsoft YaHei",sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;text-align:center}.box{max-width:520px;padding:32px;background:#1e293b;border-radius:14px;border:1px solid #334155}.icon{font-size:54px;margin-bottom:8px}h1{font-size:18px;margin:8px 0 4px;color:#f59e0b}p{color:#94a3b8;font-size:13px;line-height:1.6;margin:8px 0 18px}.code{background:#0f172a;padding:10px;border-radius:6px;font-family:Consolas,monospace;font-size:12px;color:#f87171;text-align:left;word-break:break-all;margin:10px 0}.btn{display:inline-block;background:#2563eb;color:#fff;border:none;border-radius:8px;padding:10px 22px;font-size:14px;cursor:pointer;margin:4px}.btn:hover{background:#1d4ed8}.btn.outline{background:transparent;border:1px solid #475569;color:#cbd5e1}</style><div class="box"><div class="icon">⚠️</div><h1>' + title + '</h1><p>项目档案管理器桌面版无法连接到后端服务。</p><div class="code">' + (detail || '').replace(/</g, '&lt;') + '</div><div><button class="btn" onclick="location.reload()">重试</button></div><p style="font-size:11px;margin-top:14px;color:#64748b">按 <kbd style="background:#0f172a;padding:1px 6px;border-radius:3px;border:1px solid #475569">Ctrl+Shift+I</kbd> 查看开发者工具 · 端口 ' + PORT + ' 可能被占用，请关闭其他正在运行的实例后重试。</p></div>';
}

function showErrorPage(detail) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorPageHtml('服务启动失败', detail)));
}

// 安全的 IPC 消息发送辅助函数
function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建项目', accelerator: 'CmdOrCtrl+N', click: () => sendToRenderer('menu:new-project') },
        { type: 'separator' },
        { label: '从文件夹导入...', click: () => sendToRenderer('menu:import-folder') },
        { type: 'separator' },
        { label: '导出备份', click: () => sendToRenderer('menu:export-backup') },
        { label: '导入备份', click: () => sendToRenderer('menu:import-backup') },
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
        { label: '关于项目档案管理器', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: '关于', message: '项目档案管理器 v' + APP_VERSION, detail: '项目档案交付 NAS 管理工具\nElectron 桌面版\n\n拖放文件夹到窗口即可导入\nCtrl+Shift+D 全局热键呼出' }) },
        { label: '打开数据目录', click: () => shell.openPath(path.join(__dirname, '..', 'data')) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  try {
    const icon = getAppIcon(16);
    tray = new Tray(icon);
    const autoStart = app.getLoginItemSettings().openAtLogin;
    const ctx = Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { label: '隐藏窗口', click: () => { if (mainWindow) mainWindow.hide(); } },
      { type: 'separator' },
      { label: '开机自启', type: 'checkbox', checked: autoStart, click: (mi) => { app.setLoginItemSettings({ openAtLogin: mi.checked }); } },
      { type: 'separator' },
      { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip('项目档案管理器 — 运行中');
    tray.setContextMenu(ctx);
    tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  } catch (e) { console.error('[Tray] 创建托盘失败:', e.message); }
}

// 更新托盘 tooltip 显示未读通知数
function updateTrayUnread(count) {
  if (!tray) return;
  try {
    if (count > 0) {
      tray.setToolTip('项目档案管理器 — ' + count + ' 条未读通知');
    } else {
      tray.setToolTip('项目档案管理器 — 运行中');
    }
  } catch (e) {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 960, minHeight: 620,
    title: '项目档案管理器',
    icon: getAppIcon(256),
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadURL('http://localhost:' + PORT);

  // 加载失败兜底（例如服务未就绪）→ 显示错误页 + 重试
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // ABORTED（reload 等正常中断），忽略
    if (validatedURL && validatedURL.startsWith('data:')) return; // 错误页本身不再触发
    showErrorPage('页面加载失败: ' + (errorDescription || 'HTTP ' + errorCode));
  });

  // 开发模式：自动打开 DevTools 便于诊断
  if (process.env.PAM_DEV === '1' || process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    buildMenu();
  });

  // 拖放文件到窗口 — 改为发送 IPC 消息
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const fp = decodeURIComponent(url.replace(/^file:\/\/\//i, ''));
    if (fp && !fp.startsWith('http') && fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
      e.preventDefault();
      sendToRenderer('drop:import-folder', fp);
    }
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// 目录监听（300ms 防抖，避免大目录被刷爆）
const _watchDebounces = new Map(); // projectId -> timer
function startWatch(dirPath, projectId) {
  if (activeWatchers[projectId] || !dirPath || !fs.existsSync(dirPath)) return;
  try {
    const w = fs.watch(dirPath, { recursive: true }, () => {
      // 防抖：短时间内多个事件合并为一次推送
      const existing = _watchDebounces.get(projectId);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        _watchDebounces.delete(projectId);
        sendToRenderer('fs:changed', projectId);
      }, 300);
      if (t.unref) t.unref();
      _watchDebounces.set(projectId, t);
    });
    activeWatchers[projectId] = w;
  } catch (e) {}
}
function stopWatch(projectId) {
  if (activeWatchers[projectId]) { activeWatchers[projectId].close(); delete activeWatchers[projectId]; }
  const t = _watchDebounces.get(projectId);
  if (t) { clearTimeout(t); _watchDebounces.delete(projectId); }
}
function stopAllWatches() {
  for (const id of Object.keys(activeWatchers)) { try { activeWatchers[id].close(); } catch (e) {} delete activeWatchers[id]; }
  for (const [id, t] of _watchDebounces) { clearTimeout(t); }
  _watchDebounces.clear();
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
// IPC — 原生桌面通知
// 支持可选 action + payload：点击通知时把 action 派发回渲染进程（用于一键交付）
ipcMain.handle('show-notification', async (_e, { title, body, action, payload }) => {
  if (!Notification.isSupported()) return { success: false, error: '系统不支持通知' };
  try {
    const n = new Notification({ title, body, icon: getAppIcon(256) });
    n.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
        // 把点击动作与携带数据派发到渲染进程
        if (action) sendToRenderer('notification:click', { action, payload: payload || null });
      }
    });
    n.show();
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// IPC — 通知中心未读数（更新托盘 tooltip）
ipcMain.on('notification-unread', (_e, count) => {
  updateTrayUnread(count || 0);
});

// IPC — 设置相关
ipcMain.handle('get-settings', async () => {
  const autoStart = app.getLoginItemSettings().openAtLogin;
  return {
    autoStart,
    appVersion: app.getVersion(),
    platform: process.platform,
    isElectron: true,
  };
});

ipcMain.handle('set-auto-start', async (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
  // 同步更新托盘菜单
  if (tray) {
    const ctx = Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { label: '隐藏窗口', click: () => { if (mainWindow) mainWindow.hide(); } },
      { type: 'separator' },
      { label: '开机自启', type: 'checkbox', checked: !!enabled, click: (mi) => { app.setLoginItemSettings({ openAtLogin: mi.checked }); } },
      { type: 'separator' },
      { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(ctx);
  }
  return { success: true, autoStart: !!enabled };
});

ipcMain.on('start-watch', (_e, dirPath, projectId) => startWatch(dirPath, projectId));
ipcMain.on('stop-watch', (_e, projectId) => stopWatch(projectId));
ipcMain.on('stop-all-watch', () => stopAllWatches());

// 全局快捷键相关 IPC
ipcMain.on('global-show-window', () => showAndFocusWindow());
ipcMain.on('register-global-shortcut', (_e, accelerator) => registerGlobalHotkey(accelerator));

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
autoUpdater.on('error', function(err) { console.error('[autoUpdater] 更新失败:', err && err.message ? err.message : err); });

app.whenReady().then(async () => {
  registerGlobalHotkey(_globalHotkeyAccel);
  let serverError = null;
  try {
    await startServer();
  } catch (e) {
    serverError = e;
    console.error('[main] 服务启动失败:', e.message);
  }
  createWindow();
  // 服务启动失败时显式显示错误页（did-fail-load 也会兜底，这里即时反馈）
  if (serverError) showErrorPage(serverError.message);
  // 窗口创建后再初始化托盘（此时 mainWindow 已就绪）
  createTray();
  // 绑定最小化到托盘的气泡提示
  let trayHintShown = false;
  if (mainWindow && tray) {
    mainWindow.on('minimize', () => {
      if (!trayHintShown && tray) {
        try {
          tray.displayBalloon({
            title: '项目档案管理器',
            content: '已最小化到系统托盘，双击图标可恢复窗口',
          });
        } catch (_) { /* displayBalloon Windows 10+ 可能不支持，忽略 */ }
        trayHintShown = true;
      }
    });
  }
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
