/**
 * 简易日志系统
 * 支持控制台输出 + 可选的本地文件滚动存储
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

function writeFile(msg) {
  if (!config.logging.fileEnabled) return;
  try {
    const dir = config.logging.logDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(dir, `${today}.log`);
    fs.appendFileSync(logFile, msg + '\n', 'utf-8');
  } catch (_) { /* 文件写入失败不影响主流程 */ }
}

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
