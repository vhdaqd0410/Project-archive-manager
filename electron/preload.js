// Electron preload：暴露安全的 IPC 桥接到渲染进程
const { contextBridge, ipcRenderer } = require('electron');

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
  // 监听主进程消息
  onMessage: (channel, callback) => ipcRenderer.on(channel, (_e, ...args) => callback(...args)),
  // 发送消息
  sendMessage: (channel, data) => ipcRenderer.send(channel, data)
});
