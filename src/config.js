/**
 * 项目档案管理器 — 统一配置
 * 所有可调参数集中于此，支持环境变量覆盖
 */

const path = require('path');

module.exports = {
  // ── 服务器 ──
  server: {
    port: parseInt(process.env.PORT, 10) || 37890,
    host: process.env.HOST || 'localhost',
  },

  // ── 数据目录 ──
  dataDir: path.join(__dirname, '..', 'data'),

  // ── 默认设置 ──
  defaults: {
    keyword: '项目归档资料',
    maxLogEntries: 500,
    maxRunningJobs: 20,
    maxKeptDoneJobs: 5,
  },

  // ── 文件操作 ──
  fileOps: {
    largeFileThresholdBytes: 10 * 1024 * 1024, // 10MB 以上用异步复制
    searchMaxDepth: 10,                        // 关键词目录搜索深度
    yieldEveryN: 10,                           // 每 N 个文件让出事件循环
    dirYieldEveryN: 3,                         // 目录复制时每 N 个让出
  },

  // ── 视频文件扩展名 ──
  videoExtensions: new Set([
    '.mp4', '.avi', '.mkv', '.mov', '.wmv',
    '.flv', '.webm', '.m4v', '.ts',
  ]),

  // ── 项目有效状态 ──
  validStatuses: ['editing', 'modifying', 'done'],

  // ── 交付关键词 ──
  deliveryKeywords: {
    normal: '项目归档资料',
    modify: '上映单集版',
    archive: '000交付',
  },

  // ── 日志 ──
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    maxFileSize: 5 * 1024 * 1024,  // 5MB
    maxFiles: 5,
    logDir: path.join(__dirname, '..', 'logs'),
    consoleEnabled: true,
    fileEnabled: false,             // 默认关闭文件日志，可在生产开启
  },
};
