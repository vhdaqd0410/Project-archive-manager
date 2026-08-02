const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const shared = require('./shared');

// WebDAV PROPFIND — 列出目录内容
router.propfind('/:projectId/*', async (req, res) => {
  const projectId = req.params.projectId;
  const r = shared.getProjectById(projectId);
  if (!r) return res.status(404).send('Not Found');

  const relPath = req.params[0];
  const baseDir = req.query.nas === '1' ? r.project.nasDir : r.project.localDir;
  const fullPath = path.join(baseDir, relPath);

  if (!fs.existsSync(fullPath)) return res.status(404).send('Not Found');

  const stat = await fsp.stat(fullPath);
  const isDir = stat.isDirectory();

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<D:multistatus xmlns:D="DAV:">\n';

  if (isDir) {
    xml += renderProp(fullPath, '/' + relPath, true, stat);
    const entries = await fsp.readdir(fullPath, { withFileTypes: true });
    for (const e of entries) {
      const childPath = path.join(fullPath, e.name);
      const childStat = await fsp.stat(childPath);
      xml += renderProp(childPath, '/' + path.join(relPath, e.name), e.isDirectory(), childStat);
    }
  } else {
    xml += renderProp(fullPath, '/' + relPath, false, stat);
  }

  xml += '</D:multistatus>';
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.send(xml);
});

router.propfind('/:projectId', async (req, res) => {
  const projectId = req.params.projectId;
  const r = shared.getProjectById(projectId);
  if (!r) return res.status(404).send('Not Found');

  const baseDir = req.query.nas === '1' ? r.project.nasDir : r.project.localDir;
  if (!fs.existsSync(baseDir)) return res.status(404).send('Not Found');

  const stat = await fsp.stat(baseDir);
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<D:multistatus xmlns:D="DAV:">\n';
  xml += renderProp(baseDir, '/', true, stat);
  const entries = await fsp.readdir(baseDir, { withFileTypes: true });
  for (const e of entries) {
    const childPath = path.join(baseDir, e.name);
    const childStat = await fsp.stat(childPath);
    xml += renderProp(childPath, '/' + e.name, e.isDirectory(), childStat);
  }
  xml += '</D:multistatus>';
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.send(xml);
});

function renderProp(filePath, href, isDir, stat) {
  const lastModified = stat.mtime.toUTCString();
  const size = stat.size || 0;
  return `  <D:response>
    <D:href>${escapeXml(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(path.basename(filePath))}</D:displayname>
        <D:resourcetype>${isDir ? '<D:collection/>' : ''}</D:resourcetype>
        <D:getcontentlength>${size}</D:getcontentlength>
        <D:getlastmodified>${lastModified}</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>\n`;
}

function escapeXml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// WebDAV GET — 下载文件
router.get('/:projectId/*', (req, res) => {
  const r = shared.getProjectById(req.params.projectId);
  if (!r) return res.status(404).send('Not Found');
  const relPath = req.params[0];
  const baseDir = req.query.nas === '1' ? r.project.nasDir : r.project.localDir;
  const fullPath = path.join(baseDir, relPath);
  if (!fs.existsSync(fullPath)) return res.status(404).send('Not Found');
  res.sendFile(fullPath);
});

// WebDAV OPTIONS
router.options('/:projectId', (req, res) => {
  res.set({
    'DAV': '1, 2',
    'MS-Author-Via': 'DAV',
    'Allow': 'GET, HEAD, PROPFIND, OPTIONS',
  });
  res.send();
});

router.options('/:projectId/*', (req, res) => {
  res.set({
    'DAV': '1, 2',
    'MS-Author-Via': 'DAV',
    'Allow': 'GET, HEAD, PROPFIND, OPTIONS',
  });
  res.send();
});

module.exports = router;
