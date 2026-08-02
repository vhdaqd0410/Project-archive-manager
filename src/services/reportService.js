/**
 * 归档报告导出服务 (Feature 2)
 * 生成 Excel 格式的归档清单，含文件列表、大小、校验码
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const config = require('../config');
const log = require('./logger').createLogger('report');

async function generateExcel(project, deliveryLogs, verifyResults) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = '项目档案管理器';
  wb.created = new Date();

  // ── Sheet 1: 项目概览 ──
  const ws1 = wb.addWorksheet('项目概览');
  ws1.columns = [
    { header: '项目名称', key: 'name', width: 30 },
    { header: '状态', key: 'status', width: 12 },
    { header: '本地目录', key: 'localDir', width: 50 },
    { header: 'NAS目录', key: 'nasDir', width: 50 },
    { header: '目标集数', key: 'episodeTarget', width: 10 },
    { header: '备注', key: 'memo', width: 40 },
    { header: '创建时间', key: 'createdAt', width: 22 },
  ];
  ws1.addRow({
    name: project.name,
    status: project.status,
    localDir: project.localDir,
    nasDir: project.nasDir,
    episodeTarget: project.episodeTarget || 0,
    memo: project.memo || '',
    createdAt: project.createdAt || '',
  });
  // 样式
  ws1.getRow(1).font = { bold: true };
  ws1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
  ws1.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // ── Sheet 2: 交付历史 ──
  if (deliveryLogs && deliveryLogs.length) {
    const ws2 = wb.addWorksheet('交付历史');
    ws2.columns = [
      { header: '时间', key: 'time', width: 22 },
      { header: '操作', key: 'action', width: 16 },
      { header: '详情', key: 'detail', width: 50 },
      { header: '成功数', key: 'ok', width: 10 },
      { header: '失败数', key: 'fail', width: 10 },
    ];
    for (const l of deliveryLogs) {
      ws2.addRow({
        time: l.time, action: l.action, detail: l.detail,
        ok: l.ok || 0, fail: l.fail || 0,
      });
    }
    ws2.getRow(1).font = { bold: true };
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
    ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  }

  // ── Sheet 3: 文件校验记录 ──
  if (verifyResults && verifyResults.length) {
    const ws3 = wb.addWorksheet('文件校验');
    ws3.columns = [
      { header: '文件名', key: 'fileName', width: 40 },
      { header: '大小(字节)', key: 'fileSize', width: 14 },
      { header: '源MD5', key: 'sourceChecksum', width: 36 },
      { header: '目标MD5', key: 'destChecksum', width: 36 },
      { header: '校验结果', key: 'verified', width: 12 },
    ];
    for (const r of verifyResults) {
      ws3.addRow({
        fileName: r.fileName,
        fileSize: r.fileSize || 0,
        sourceChecksum: r.sourceChecksum || '-',
        destChecksum: r.destChecksum || '-',
        verified: r.verified === true ? '通过' : r.verified === false ? '失败' : '跳过',
      });
    }
    ws3.getRow(1).font = { bold: true };
    ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
    ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  }

  // ── 写入文件 ──
  const tempDir = config.reports.tempDir;
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const fileName = `归档报告_${project.name}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const filePath = path.join(tempDir, fileName);
  await wb.xlsx.writeFile(filePath);
  log.info('报告已生成:', filePath);
  return { filePath, fileName };
}

module.exports = { generateExcel };
