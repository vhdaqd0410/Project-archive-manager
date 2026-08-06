// Electron preload：暴露安全的 IPC 桥接到渲染进程
const { contextBridge, ipcRenderer } = require('electron');

// 所有允许的安全 IPC 通道白名单
const ALLOWED_RECEIVE_CHANNELS = [
  'menu:new-project',
  'menu:import-folder',
  'menu:export-backup',
  'menu:import-backup',
  'menu:command-palette',
  'menu:kanban',
  'menu:calendar',
  'menu:screen',
  'menu:dashboard',
  'menu:monthly',
  'menu:report-center',
  'menu:pause-all-jobs',
  'menu:resume-all-jobs',
  'menu:cancel-all-jobs',
  'menu:refresh',
  'menu:backup-now',
  'drop:import-folder',
  'fs:changed',
  'notification:click',
];

const ALLOWED_SEND_CHANNELS = [
  'start-watch',
  'stop-watch',
  'stop-all-watch',
  'global-show-window',
  'register-global-shortcut',
  'notification-unread',
];

contextBridge.exposeInMainWorld('electronAPI', {
  // 文件夹选择（原生对话框）
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  // 打开资源管理器
  openExplorer: (dirPath) => ipcRenderer.invoke('open-explorer', dirPath),
  // 拖放文件夹导入
  dropImport: (dirPath) => ipcRenderer.invoke('drop-import', dirPath),
  // 是否 Electron
  isElectron: true,
  // 平台
  platform: process.platform,
  // 监听主进程消息（仅允许白名单通道）
  onMessage: (channel, callback) => {
    if (ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      const subscription = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
    return () => {};
  },
  // 发送消息给主进程
  sendMessage: (channel, data) => {
    if (ALLOWED_SEND_CHANNELS.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  // ── 新增：原生桌面通知（支持点击动作派发）──
  showNotification: (title, body, options) => ipcRenderer.invoke('show-notification', {
    title, body,
    action: options && options.action || undefined,
    payload: options && options.payload || undefined,
  }),
  // ── 新增：应用设置 ──
  getAppSettings: () => ipcRenderer.invoke('get-settings'),
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),
  // ── 新增：全局快捷键 ──
  setGlobalHotkey: (accelerator) => {
    if (ALLOWED_SEND_CHANNELS.includes('register-global-shortcut')) {
      ipcRenderer.send('register-global-shortcut', accelerator);
    }
  },
});
