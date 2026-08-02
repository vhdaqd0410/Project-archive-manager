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
    maxRunningJobs: 5,
    maxKeptDoneJobs: 5,
  },

  // ── 文件操作 ──
  fileOps: {
    largeFileThresholdBytes: 10 * 1024 * 1024,
    searchMaxDepth: 10,
    yieldEveryN: 10,
    dirYieldEveryN: 3,
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
    maxFileSize: 5 * 1024 * 1024,
    maxFiles: 5,
    logDir: path.join(__dirname, '..', 'logs'),
    consoleEnabled: true,
    fileEnabled: false,
  },

  // ── SQLite 数据库 (Feature 5) ──
  database: {
    path: path.join(__dirname, '..', 'data', 'archive.db'),
    // 设为 true 时启用 SQLite；false 则继续使用 JSON 文件
    enabled: true,
    // 启动时自动从 JSON 迁移数据到 SQLite（仅在 SQLite 为空时执行）
    autoMigrate: true,
  },

  // ── SSE 实时推送 (Feature 4) ──
  sse: {
    // 心跳间隔（毫秒），防止连接超时
    heartbeatInterval: 30000,
    // 最大连接数
    maxConnections: 50,
  },

  // ── 文件完整性校验 (Feature 1) ──
  verification: {
    // 校验算法：md5 / sha256
    algorithm: 'md5',
    // 是否对大文件跳过校验（> skipThresholdBytes），设为 0 则全部校验
    skipThresholdBytes: 2 * 1024 * 1024 * 1024, // 2GB
    // 校验失败时自动重试次数
    maxRetries: 1,
  },

  // ── 统计仪表盘 (Feature 3) ──
  stats: {
    // 统计缓存时间（毫秒），0 = 不缓存
    cacheTTL: 30000,
  },

  // ── 报告导出 (Feature 2) ──
  reports: {
    // 临时文件目录
    tempDir: path.join(__dirname, '..', 'data', 'reports'),
  },

  // ── 定时自动化 (Feature 7) ──
  scheduler: {
    // 是否启用
    enabled: true,
    // 默认检测间隔（cron 表达式）：每 30 分钟
    defaultCron: '*/30 * * * *',
  },

  // ── 多通知渠道 (Feature 8) ──
  notifications: {
    // 默认启用的渠道
    defaultChannels: ['browser'],
    // 通知去重时间窗口（毫秒），同一事件在窗口内只通知一次
    dedupWindow: 60000,
  },

  // ── 插件/钩子 (Feature 10) ──
  hooks: {
    enabled: true,
    // 钩子脚本目录
    scriptsDir: path.join(__dirname, '..', 'data', 'hooks'),
    // 脚本执行超时（毫秒）
    timeout: 30000,
  },

  // ── 多存储后端 (Feature 11) ──
  storage: {
    // 默认后端类型：local / s3 / cos / oss
    defaultBackend: 'local',
  },

  // ── 用户认证 (Feature 9) ──
  auth: {
    // 是否启用认证（单用户模式下可关闭）
    enabled: false,
    // session 密钥：优先从环境变量读取，否则生成随机密钥（每次启动不同，重启后旧 session 失效）
    secret: process.env.AUTH_SECRET || require('crypto').randomBytes(32).toString('hex'),
    // token 过期时间（毫秒），默认 7 天
    tokenExpiry: 7 * 24 * 60 * 60 * 1000,
  },

  // ── 工作流引擎 (Feature 12) ──
  workflow: {
    // 默认工作流模板 ID
    defaultTemplateId: 'standard',
  },

  // ── WebDAV 服务 ──
  webdav: {
    enabled: true,
    port: 37891,
    host: 'localhost',
    // 是否允许写入操作（false = 只读）
    writable: false,
  },

  // ── 文件预览 ──
  preview: {
    // 缩略图存放目录
    cacheDir: path.join(__dirname, '..', 'data', 'thumbnails'),
    // 缩略图尺寸
    width: 320,
    height: 180,
    // ffmpeg 路径（如果不在 PATH 中）
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  },

  // ── 增量同步 ──
  incrementalSync: {
    // 是否启用增量同步（对比 mtime + size）
    enabled: true,
    // mtime 容差（毫秒），小于此差异视为相同
    mtimeTolerance: 1000,
  },

  // ── 复制回滚 ──
  rollback: {
    // 最大保留的操作记录数
    maxRecords: 100,
    // 回滚时是否将文件移到回收站而非直接删除
    useTrash: true,
  },
};
