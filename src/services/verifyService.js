/**
 * 文件完整性校验服务 (Feature 1)
 * 复制后计算源文件和目标文件的校验和（MD5/SHA256），确保归档文件完整
 */
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('../config');
const log = require('./logger').createLogger('verify');

const ALGO = config.verification.algorithm;

/**
 * 计算文件校验和（流式读取，不占用过多内存）
 */
async function computeChecksum(filePath) {
  const stat = await fsp.stat(filePath);
  // 大文件跳过校验
  if (config.verification.skipThresholdBytes > 0 && stat.size > config.verification.skipThresholdBytes) {
    log.info('文件过大，跳过校验:', path.basename(filePath), (stat.size / 1024 / 1024).toFixed(1) + 'MB');
    return null;
  }
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(ALGO);
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 校验单个文件：对比源和目标的校验和
 * @returns { verified, sourceChecksum, destChecksum, fileName, fileSize }
 */
async function verifyFile(srcPath, dstPath) {
  const fileName = path.basename(srcPath);
  try {
    const srcStat = await fsp.stat(srcPath);
    const dstStat = await fsp.stat(dstPath);

    // 快速检查：大小不一致直接标记失败
    if (srcStat.size !== dstStat.size) {
      return { verified: false, fileName, fileSize: srcStat.size, error: 'size_mismatch' };
    }

    const sourceChecksum = await computeChecksum(srcPath);
    if (sourceChecksum === null) {
      return { verified: null, fileName, fileSize: srcStat.size, error: 'skipped_large_file' };
    }
    const destChecksum = await computeChecksum(dstPath);

    const verified = sourceChecksum === destChecksum;
    if (!verified) {
      log.warn('校验失败:', fileName, '源=', sourceChecksum, '目标=', destChecksum);
    }
    return { verified, sourceChecksum, destChecksum, fileName, fileSize: srcStat.size };
  } catch (e) {
    log.error('校验异常:', fileName, e.message);
    return { verified: false, fileName, error: e.message };
  }
}

/**
 * 批量校验文件列表
 * @param {Array<{src, dst}>} files 文件对列表
 * @param {Function} onProgress 进度回调 (index, result)
 * @returns { ok, fail, skip, results }
 */
async function verifyBatch(files, onProgress) {
  let ok = 0, fail = 0, skip = 0;
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const { src, dst } = files[i];
    // 目标不存在则跳过
    try { await fsp.access(dst); } catch { skip++; results.push({ fileName: path.basename(src), verified: false, error: 'dest_not_found' }); continue; }
    const r = await verifyFile(src, dst);
    results.push(r);
    if (r.verified === true) ok++;
    else if (r.verified === false) fail++;
    else skip++;
    if (onProgress) onProgress(i, r);
  }
  return { ok, fail, skip, results };
}

/**
 * 将校验结果保存到数据库
 */
function saveChecksum(db, projectId, result) {
  if (!db || !db.isAvailable()) return;
  try {
    db.getDB().prepare(`INSERT INTO file_checksums
      (projectId, filePath, fileName, sourceChecksum, destChecksum, verified, verifiedAt, fileSize)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(projectId, '', result.fileName, result.sourceChecksum || '', result.destChecksum || '',
        result.verified ? 1 : 0, new Date().toISOString(), result.fileSize || 0);
  } catch (e) { log.warn('保存校验记录失败:', e.message); }
}

module.exports = {
  computeChecksum,
  verifyFile,
  verifyBatch,
  saveChecksum,
};
