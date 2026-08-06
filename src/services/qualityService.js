/**
 * 交付前质量检查服务
 * 检查规则:
 *  1. 文件名集数检测:文件名是否含数字(集数标识)
 *  2. 文件大小过小:< minFileSize 视为异常(可能是半成品)
 *  3. 视频时长过短:用 ffprobe 读时长 < minDurationSec 视为未剪完
 *  4. 视频编码/分辨率:可选,读取流信息
 */
const { execFile } = require('child_process');
const path = require('path');
const fsp = require('fs').promises;
const config = require('../config');
const log = require('./logger').createLogger('quality');

// 检查规则配置(可从 config 读取,这里给默认值)
const RULES = {
  minFileSize: 5 * 1024 * 1024,     // 小于 5MB 视为异常
  minDurationSec: 60,                // 小于 60 秒视为异常
  checkDuration: true,               // 是否调用 ffprobe 检查时长
  episodeRegex: /(\d+)/,             // 文件名至少含一个数字
};

/**
 * 对单个文件执行质量检查
 * @param {string} filePath 本地文件完整路径
 * @param {string} fileName 文件名
 * @returns {object} { ok, warnings, errors, duration, size, codec, resolution }
 */
async function checkFile(filePath, fileName) {
  const result = {
    name: fileName,
    ok: true,
    warnings: [],
    errors: [],
    size: 0,
    duration: 0,
    codec: '',
    resolution: '',
  };

  // 1. 文件大小
  try {
    const stat = await fsp.stat(filePath);
    result.size = stat.size;
    if (stat.size < RULES.minFileSize) {
      result.errors.push('文件过小: ' + (stat.size / 1024).toFixed(0) + 'KB (小于 ' + (RULES.minFileSize / 1024 / 1024) + 'MB)');
      result.ok = false;
    }
  } catch (e) {
    result.errors.push('无法读取文件: ' + e.message);
    result.ok = false;
    return result;
  }

  // 2. 文件名集数检测
  if (!RULES.episodeRegex.test(fileName)) {
    result.warnings.push('文件名未含集数标识');
  }

  // 3. 视频文件用 ffprobe 读时长/编码
  const ext = path.extname(fileName).toLowerCase();
  const isVideo = config.videoExtensions.has(ext);
  if (!isVideo) {
    // 非视频文件只做大小检查
    return result;
  }

  if (RULES.checkDuration) {
    try {
      const probe = await probeVideo(filePath);
      if (probe) {
        result.duration = probe.duration;
        result.codec = probe.codec;
        result.resolution = probe.resolution;
        if (probe.duration > 0 && probe.duration < RULES.minDurationSec) {
          result.errors.push('时长过短: ' + probe.duration.toFixed(0) + '秒 (小于 ' + RULES.minDurationSec + '秒)');
          result.ok = false;
        }
        if (!probe.codec) {
          result.warnings.push('无法读取视频编码');
        }
      }
    } catch (e) {
      // ffprobe 不可用或失败,只警告不阻塞
      result.warnings.push('视频信息读取失败: ' + e.message);
    }
  }

  return result;
}

/**
 * 用 ffprobe 读取视频信息(时长/编码/分辨率)
 */
function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = config.preview.ffmpegPath;
    // ffprobe 通常和 ffmpeg 同目录
    const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height:format=duration',
      '-of', 'json',
      filePath,
    ];
    execFile(ffprobePath, args, { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) { reject(err); return; }
      try {
        const data = JSON.parse(stdout);
        const stream = (data.streams || [])[0] || {};
        const duration = parseFloat(data.format?.duration || 0);
        resolve({
          duration,
          codec: stream.codec_name || '',
          resolution: (stream.width && stream.height) ? (stream.width + 'x' + stream.height) : '',
        });
      } catch (e) { reject(e); }
    });
  });
}

/**
 * 批量检查文件
 * @param {string} localDir 本地目录
 * @param {string[]} fileNames 待检查文件名列表
 * @returns {object} { total, ok, warning, error, results, summary }
 */
async function checkFiles(localDir, fileNames) {
  const list = Array.isArray(fileNames) ? fileNames : [];
  const results = [];
  let okCount = 0, warnCount = 0, errCount = 0;

  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const fullPath = path.join(localDir, f);
    try {
      const r = await checkFile(fullPath, f);
      results.push(r);
      if (!r.ok) errCount++;
      else if (r.warnings.length > 0) warnCount++;
      else okCount++;
    } catch (e) {
      results.push({ name: f, ok: false, errors: ['检查异常: ' + e.message], warnings: [], size: 0, duration: 0 });
      errCount++;
    }
    // 每 5 个让出事件循环,避免阻塞
    if (i % 5 === 0) await new Promise(r => setImmediate(r));
  }

  return {
    total: list.length,
    ok: okCount,
    warning: warnCount,
    error: errCount,
    results,
    summary: {
      passed: okCount + ' 个通过',
      warnings: warnCount + ' 个有警告',
      errors: errCount + ' 个有问题',
      canDeliver: errCount === 0,
    },
  };
}

module.exports = { checkFile, checkFiles, probeVideo, RULES };
