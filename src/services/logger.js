/**
 * 简易日志系统
 * 支持控制台输出 + 可选的本地文件滚动存储（异步 writeStream，避免阻塞事件循环）
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const COLORS = { debug: '\x1b[36m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m', reset: '\x1b[0m' };

function timestamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function formatMsg(level, tag, ...args) {
  const ts = timestamp();
  const msgs = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  return { ts, tag, level, msg: `[${ts}] [${level.toUpperCase()}] [${tag}] ${msgs}` };
}

// ── 日志文件 writeStream 池（按日期一个文件，懒加载）──
const _streamCache = new Map(); // 'YYYY-MM-DD' -> { stream, lastUsed }
let _cleanupTimer = null;

function getStream(dayKey) {
  if (!config.logging.fileEnabled) return null;
  try {
    const dir = config.logging.logDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let entry = _streamCache.get(dayKey);
    if (!entry) {
      const logFile = path.join(dir, `${dayKey}.log`);
      const stream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf-8' });
      stream.on('error', (e) => { /* 写入失败不应中断主流程 */ });
      entry = { stream, lastUsed: Date.now() };
      _streamCache.set(dayKey, entry);
      // 每天最多保留 5 个日志文件
      pruneOldLogs(dir);
    }
    entry.lastUsed = Date.now();
    return entry.stream;
  } catch (_) { return null; }
}

// 清理过期日志文件（保留最近 maxFiles 个）
function pruneOldLogs(dir) {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort().reverse();
    const max = config.logging.maxFiles || 5;
    for (let i = max; i < files.length; i++) {
      try { fs.unlinkSync(path.join(dir, files[i])); } catch (_) {}
    }
  } catch (_) {}
}

// 每分钟检查一次：关闭超过 5 分钟未使用的 stream，跨日时换文件
function scheduleStreamMaintenance() {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [dayKey, entry] of _streamCache) {
      if (now - entry.lastUsed > 5 * 60 * 1000) {
        try { entry.stream.end(); } catch (_) {}
        _streamCache.delete(dayKey);
      }
    }
  }, 60 * 1000);
  if (_cleanupTimer.unref) _cleanupTimer.unref();
}

function writeFile(msg) {
  if (!config.logging.fileEnabled) return;
  const today = new Date().toISOString().slice(0, 10);
  const stream = getStream(today);
  if (!stream) return;
  // writeStream.write 是异步非阻塞的
  if (!stream.write(msg + '\n')) {
    // 缓冲区满，背压处理：等待 drain（不阻塞事件循环）
    stream.once('drain', () => {});
  }
}

if (config.logging.fileEnabled) scheduleStreamMaintenance();

function createLogger(tag) {
  return {
    debug(...args) {
      if (LEVELS[config.logging.level] > LEVELS.debug) return;
      const { msg } = formatMsg('debug', tag, ...args);
      if (config.logging.consoleEnabled) console.debug(`${COLORS.debug}${msg}${COLORS.reset}`);
      writeFile(msg);
    },
    info(...args) {
      if (LEVELS[config.logging.level] > LEVELS.info) return;
      const { msg } = formatMsg('info', tag, ...args);
      if (config.logging.consoleEnabled) console.log(`${COLORS.info}${msg}${COLORS.reset}`);
      writeFile(msg);
    },
    warn(...args) {
      if (LEVELS[config.logging.level] > LEVELS.warn) return;
      const { msg } = formatMsg('warn', tag, ...args);
      if (config.logging.consoleEnabled) console.warn(`${COLORS.warn}${msg}${COLORS.reset}`);
      writeFile(msg);
    },
    error(...args) {
      const { msg } = formatMsg('error', tag, ...args);
      if (config.logging.consoleEnabled) console.error(`${COLORS.error}${msg}${COLORS.reset}`);
      writeFile(msg);
    },
  };
}

module.exports = { createLogger };
