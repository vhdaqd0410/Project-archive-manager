const express = require('express');
const router = express.Router();
const path = require('path');
const reportService = require('../services/reportService');
const projectService = require('../services/projectService');
const shared = require('./shared');
const fs = require('fs');

router.get('/project/:id/excel', async (req, res) => {
  const r = shared.getProjectById(req.params.id);
  if (!r) return res.status(404).json({ error: '项目不存在' });

  // 获取该项目的交付日志
  const allLogs = projectService.loadDeliveryLog();
  const logs = allLogs.filter(l => l.projectId === req.params.id);

  try {
    const { filePath, fileName } = await reportService.generateExcel(r.project, logs, []);
    // 发送文件后删除临时文件
    res.download(filePath, fileName, (err) => {
      if (!err) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    });
  } catch (e) {
    res.status(500).json({ error: '报告生成失败: ' + e.message });
  }
});

// 导出所有项目概览
router.get('/overview/excel', async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('项目概览');
    ws.columns = [
      { header: '项目名称', key: 'name', width: 30 },
      { header: '状态', key: 'status', width: 12 },
      { header: '本地目录', key: 'localDir', width: 50 },
      { header: 'NAS目录', key: 'nasDir', width: 50 },
      { header: '目标集数', key: 'episodeTarget', width: 10 },
      { header: '备注', key: 'memo', width: 40 },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ];
    for (const p of shared.projects) {
      ws.addRow({
        name: p.name, status: p.status, localDir: p.localDir, nasDir: p.nasDir,
        episodeTarget: p.episodeTarget || 0, memo: p.memo || '', createdAt: p.createdAt || '',
      });
    }
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };

    const tempDir = require('../config').reports.tempDir;
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const fileName = `项目概览_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const filePath = path.join(tempDir, fileName);
    await wb.xlsx.writeFile(filePath);
    res.download(filePath, fileName, () => {
      try { fs.unlinkSync(filePath); } catch {}
    });
  } catch (e) {
    res.status(500).json({ error: '导出失败: ' + e.message });
  }
});

module.exports = router;
