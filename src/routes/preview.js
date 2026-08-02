const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');
const db = require('../services/db');
const shared = require('./shared');
const fileService = require('../services/fileService');

// 获取项目目录下的视频文件列表（带文件信息）
router.get('/:id/files', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const keyword = req.query.keyword || shared.settings.keyword || '项目归档资料';
  try {
    const resolved = await fileService.resolveEpisodeDirs(r.project, keyword);
    if (!resolved.relPath || !resolved.localExists) return res.json({ files: [] });
    const entries = await fsp.readdir(resolved.localEpDir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!config.videoExtensions.has(ext)) continue;
      const fullPath = path.join(resolved.localEpDir, e.name);
      const stat = await fsp.stat(fullPath);
      files.push({
        name: e.name,
        path: fullPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        ext: ext,
      });
    }
    res.json({ files, dir: resolved.localEpDir });
  } catch (e) {
    res.status(500).json({ error: '获取文件列表失败: ' + e.message });
  }
});

// 生成或获取缩略图
router.get('/:id/thumbnail', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: '缺少 path 参数' });

  // 检查缓存
  const cached = db.getThumbnail(r.project.id, filePath);
  if (cached && fs.existsSync(cached.thumbnailPath)) {
    return res.sendFile(cached.thumbnailPath);
  }

  // 确保缓存目录存在
  const cacheDir = config.preview.cacheDir;
  await fsp.mkdir(cacheDir, { recursive: true });

  const thumbPath = path.join(cacheDir, `${r.project.id}_${Date.now()}.jpg`);

  // 尝试用 ffmpeg 生成缩略图
  const ffmpeg = config.preview.ffmpegPath;
  const args = [
    '-i', filePath,
    '-ss', '00:00:01',
    '-frames:v', '1',
    '-vf', `scale=${config.preview.width}:${config.preview.height}:force_original_aspect_ratio=decrease`,
    '-q:v', '5',
    '-y',
    thumbPath,
  ];

  execFile(ffmpeg, args, { timeout: 15000, windowsHide: true }, async (err) => {
    if (err) {
      // ffmpeg 不可用，返回默认占位图
      return res.status(404).json({ error: '无法生成缩略图（ffmpeg 可能未安装）' });
    }
    if (fs.existsSync(thumbPath)) {
      db.addThumbnail({ projectId: r.project.id, filePath, thumbnailPath: thumbPath });
      res.sendFile(thumbPath);
    } else {
      res.status(500).json({ error: '缩略图生成失败' });
    }
  });
});

module.exports = router;
