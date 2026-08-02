/**
 * 插件/钩子系统 (Feature 10)
 * 在文件复制前/后插入钩子点，执行用户配置的外部脚本
 * 钩子事件：pre_copy, post_copy, pre_batch, post_batch, on_verify_fail
 */
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const config = require('../config');
const log = require('./logger').createLogger('hooks');

const HOOK_EVENTS = ['pre_copy', 'post_copy', 'pre_batch', 'post_batch', 'on_verify_fail', 'on_episode_ready'];

function getHooks(db, event) {
  if (!config.hooks.enabled) return [];
  // 优先从数据库
  if (db && db.isAvailable()) {
    try {
      const rows = db.getDB().prepare('SELECT * FROM hooks WHERE enabled = 1 AND event = ?').all(event);
      return rows;
    } catch { /* fallback */ }
  }
  // fallback: 从 settings 读取
  const shared = require('../routes/shared');
  return (shared.settings.hooks || []).filter(h => h.enabled && h.event === event);
}

/**
 * 执行钩子
 * @param {string} event 事件名
 * @param {object} context 上下文数据（项目信息、文件列表等）
 * @returns {Promise<boolean>} 是否继续（false = 中止操作）
 */
async function runHooks(event, context) {
  const db = require('./db');
  const hooks = getHooks(db, event);
  if (!hooks.length) return true;

  const scriptsDir = config.hooks.scriptsDir;
  if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });

  for (const hook of hooks) {
    try {
      const shouldContinue = await executeScript(hook, event, context, scriptsDir);
      if (!shouldContinue) {
        log.info(`钩子 ${hook.name} 返回中止信号，停止后续操作`);
        return false;
      }
    } catch (e) {
      log.error(`钩子 ${hook.name || hook.id} 执行失败:`, e.message);
      // 钩子失败不阻断主流程（可配置）
    }
  }
  return true;
}

function executeScript(hook, event, context, scriptsDir) {
  return new Promise((resolve) => {
    const scriptPath = path.isAbsolute(hook.scriptPath) ? hook.scriptPath : path.join(scriptsDir, hook.scriptPath);
    if (!fs.existsSync(scriptPath)) {
      log.warn(`钩子脚本不存在: ${scriptPath}`);
      resolve(true); // 脚本不存在不阻断
      return;
    }

    const ext = path.extname(scriptPath).toLowerCase();
    let cmd, args;

    // 根据扩展名选择执行器
    if (ext === '.js' || ext === '.mjs') {
      cmd = process.execPath;
      args = [scriptPath];
    } else if (ext === '.ps1') {
      cmd = 'powershell.exe';
      args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
    } else if (ext === '.bat' || ext === '.cmd') {
      cmd = 'cmd.exe';
      args = ['/c', scriptPath];
    } else if (ext === '.py') {
      cmd = 'python';
      args = [scriptPath];
    } else {
      // 拒绝未知扩展名，防止命令注入
      log.warn(`不支持的钩子脚本扩展名: ${ext}，已跳过: ${scriptPath}`);
      resolve(true);
      return;
    }

    const env = { ...process.env, HOOK_EVENT: event, HOOK_CONTEXT: JSON.stringify(context) };

    log.info(`执行钩子: ${hook.name || hook.id}, 脚本: ${scriptPath}`);
    execFile(cmd, args, {
      timeout: config.hooks.timeout,
      env,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (stdout) log.info(`钩子输出: ${stdout.slice(0, 500)}`);
      if (stderr) log.warn(`钩子错误输出: ${stderr.slice(0, 500)}`);

      if (err) {
        // 退出码 1 = 中止操作；其他错误码 = 警告但继续
        if (err.code === 1) {
          resolve(false);
        } else {
          log.warn(`钩子退出码 ${err.code}，继续执行`);
          resolve(true);
        }
      } else {
        resolve(true);
      }
    });
  });
}

// ── 钩子 CRUD ──
function addHook(db, id, name, event, scriptPath, hookConfig) {
  if (db && db.isAvailable()) {
    db.getDB().prepare(`INSERT OR REPLACE INTO hooks (id, name, event, scriptPath, enabled, config, createdAt)
      VALUES (?, ?, ?, ?, 1, ?, datetime('now'))`).run(id, name, event, scriptPath, JSON.stringify(hookConfig || {}));
  }
}

function updateHook(db, id, enabled, scriptPath, hookConfig) {
  if (db && db.isAvailable()) {
    if (scriptPath !== undefined) db.getDB().prepare('UPDATE hooks SET scriptPath = ? WHERE id = ?').run(scriptPath, id);
    if (hookConfig !== undefined) db.getDB().prepare('UPDATE hooks SET config = ? WHERE id = ?').run(JSON.stringify(hookConfig), id);
    if (enabled !== undefined) db.getDB().prepare('UPDATE hooks SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  }
}

function deleteHook(db, id) {
  if (db && db.isAvailable()) {
    db.getDB().prepare('DELETE FROM hooks WHERE id = ?').run(id);
  }
}

function listHooks(db) {
  if (db && db.isAvailable()) {
    const rows = db.getDB().prepare('SELECT * FROM hooks ORDER BY createdAt DESC').all();
    return rows.map(r => ({ ...r, config: JSON.parse(r.config || '{}'), enabled: !!r.enabled }));
  }
  const shared = require('../routes/shared');
  return shared.settings.hooks || [];
}

module.exports = { HOOK_EVENTS, runHooks, getHooks, addHook, updateHook, deleteHook, listHooks };
