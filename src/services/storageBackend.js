/**
 * 多存储后端抽象 (Feature 11)
 * 统一接口：list / copy / delete / exists / stat
 * 实现：LocalBackend（本地/NAS）、S3Backend（S3 兼容存储）
 * 扩展：可添加 OSSBackend / COSBackend 等
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('../config');
const log = require('./logger').createLogger('storage');

// ── 后端接口定义 ──
// list(dir) -> [{ name, isDir, size }]
// copy(srcPath, dstPath) -> { ok, size }
// exists(filePath) -> boolean
// stat(filePath) -> { size, mtime }
// delete(filePath) -> void

class LocalBackend {
  constructor(cfg = {}) {
    this.name = cfg.name || 'local';
    this.type = 'local';
  }

  async list(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const result = [];
    for (const e of entries) {
      try {
        const stat = e.isFile() ? await fsp.stat(path.join(dir, e.name)) : null;
        result.push({ name: e.name, isDir: e.isDirectory(), size: stat ? stat.size : 0 });
      } catch { result.push({ name: e.name, isDir: e.isDirectory(), size: 0 }); }
    }
    return result;
  }

  async copy(src, dst) {
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(src, dst);
    const stat = await fsp.stat(src);
    return { ok: true, size: stat.size };
  }

  async exists(p) {
    try { await fsp.access(p); return true; } catch { return false; }
  }

  async stat(p) {
    const s = await fsp.stat(p);
    return { size: s.size, mtime: s.mtime };
  }

  async delete(p) {
    await fsp.unlink(p);
  }

  async mkdir(dir) {
    await fsp.mkdir(dir, { recursive: true });
  }
}

class S3Backend {
  /**
   * cfg: { name, endpoint, region, accessKeyId, secretAccessKey, bucket }
   * 使用 AWS S3 兼容 API（支持 MinIO / 阿里 OSS / 腾讯 COS 等）
   */
  constructor(cfg) {
    this.name = cfg.name || 's3';
    this.type = 's3';
    this.cfg = cfg;
    this._client = null;
  }

  _getClient() {
    if (this._client) return this._client;
    try {
      const { S3Client } = require('@aws-sdk/client-s3');
      this._client = new S3Client({
        endpoint: this.cfg.endpoint,
        region: this.cfg.region || 'auto',
        credentials: {
          accessKeyId: this.cfg.accessKeyId,
          secretAccessKey: this.cfg.secretAccessKey,
        },
        forcePathStyle: true,
      });
      return this._client;
    } catch (e) {
      log.error('AWS SDK 未安装，S3 后端不可用。请运行 npm install @aws-sdk/client-s3');
      throw new Error('S3 backend requires @aws-sdk/client-s3');
    }
  }

  async list(prefix) {
    const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
    const client = this._getClient();
    const cmd = new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: prefix });
    const resp = await client.send(cmd);
    return (resp.Contents || []).map(o => ({
      name: o.Key, isDir: false, size: o.Size || 0,
    }));
  }

  async copy(src, dst) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const { createReadStream, statSync } = require('fs');
    const client = this._getClient();
    // 流式上传，避免大文件 OOM
    const stat = statSync(src);
    const body = createReadStream(src);
    await client.send(new PutObjectCommand({
      Bucket: this.cfg.bucket, Key: dst, Body: body, ContentLength: stat.size,
    }));
    return { ok: true, size: stat.size };
  }

  async exists(key) {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    const client = this._getClient();
    try {
      await client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return true;
    } catch { return false; }
  }

  async stat(key) {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    const client = this._getClient();
    const resp = await client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    return { size: resp.ContentLength || 0, mtime: resp.LastModified };
  }

  async delete(key) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const client = this._getClient();
    await client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  async mkdir() { /* S3 无目录概念，no-op */ }
}

// ── 后端注册表 ──
const backends = {};
const DEFAULT_BACKEND = config.storage.defaultBackend;

function register(id, type, cfg) {
  switch (type) {
    case 'local': backends[id] = new LocalBackend(cfg); break;
    case 's3': backends[id] = new S3Backend(cfg); break;
    default: throw new Error('未知的后端类型: ' + type);
  }
  log.info(`存储后端已注册: ${id} (${type})`);
}

function get(id) {
  if (id) return backends[id];
  return backends[DEFAULT_BACKEND] || backends[Object.keys(backends)[0]];
}

function list() {
  return Object.entries(backends).map(([id, b]) => ({ id, name: b.name, type: b.type }));
}

// ── 初始化默认后端 ──
function init(db) {
  // 始终注册默认本地后端
  register('default', 'local', { name: '本地存储' });

  // 从数据库加载已配置的后端
  if (db && db.isAvailable()) {
    try {
      const rows = db.getDB().prepare('SELECT * FROM storage_backends WHERE enabled = 1').all();
      for (const row of rows) {
        const cfg = JSON.parse(row.config || '{}');
        register(row.id, row.type, { name: row.name, ...cfg });
      }
      log.info(`已加载 ${rows.length} 个存储后端`);
    } catch (e) { log.warn('加载存储后端失败:', e.message); }
  }
}

function addBackend(db, id, name, type, cfg) {
  if (db && db.isAvailable()) {
    db.getDB().prepare(`INSERT OR REPLACE INTO storage_backends (id, name, type, config, enabled, createdAt)
      VALUES (?, ?, ?, ?, 1, datetime('now'))`).run(id, name, type, JSON.stringify(cfg));
  }
  register(id, type, { name, ...cfg });
}

module.exports = { LocalBackend, S3Backend, register, get, list, init, addBackend };
