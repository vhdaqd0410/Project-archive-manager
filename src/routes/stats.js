const express = require('express');
const router = express.Router();
const statsService = require('../services/statsService');
const projectService = require('../services/projectService');
const shared = require('./shared');

router.get('/', (req, res) => {
  const deliveryLogs = projectService.loadDeliveryLog();
  res.json(statsService.compute(shared.projects, deliveryLogs));
});

router.get('/delivery-trend', (req, res) => {
  const logs = projectService.loadDeliveryLog();
  const days = parseInt(req.query.days) || 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const filtered = logs.filter(l => new Date(l.time) > cutoff);
  const daily = {};
  for (const l of filtered) {
    const day = l.time.slice(0, 10);
    if (!daily[day]) daily[day] = { date: day, ok: 0, fail: 0 };
    daily[day].ok += (l.ok || 0);
    daily[day].fail += (l.fail || 0);
  }
  res.json(Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)));
});

// 按月份归纳项目（以初版交付日期为准）
// 初版交付 = delivery_logs 中 action='文件复制' 的记录
// 每个项目取最早一次"文件复制"日志时间作为初版交付日期，再按 YYYY-MM 分组
router.get('/by-month', (req, res) => {
  const logs = projectService.loadDeliveryLog(5000) || [];
  const projects = shared.projects || [];

  // 1) 找每个项目最早的"文件复制"记录（初版交付日期）
  const firstDeliveryByPid = {};
  for (const l of logs) {
    if (l.action !== '文件复制' || !l.projectId) continue;
    const prev = firstDeliveryByPid[l.projectId];
    if (!prev || l.time < prev.time) {
      firstDeliveryByPid[l.projectId] = { time: l.time, projectName: l.projectName, log: l };
    }
  }

  // 2) 构建项目信息映射（补全项目名、状态、集数等）
  const projMap = new Map();
  for (const p of projects) projMap.set(p.id, p);

  // 3) 按年月分组
  const months = {};
  const sortedPids = Object.keys(firstDeliveryByPid).sort((a, b) =>
    firstDeliveryByPid[a].time.localeCompare(firstDeliveryByPid[b].time));
  for (const pid of sortedPids) {
    const info = firstDeliveryByPid[pid];
    const ym = (info.time || '').slice(0, 7); // YYYY-MM
    if (!ym) continue;
    if (!months[ym]) months[ym] = { month: ym, count: 0, projects: [] };
    const p = projMap.get(pid) || {};
    months[ym].count++;
    months[ym].projects.push({
      id: pid,
      name: p.name || info.projectName || '(未知)',
      status: p.status || '',
      episodeTarget: p.episodeTarget || 0,
      firstDeliveryDate: info.time,
      deliveryDetail: info.log.detail || '',
    });
  }

  // 4) 按月份倒序输出（最新的月份在前）
  const result = Object.values(months).sort((a, b) => b.month.localeCompare(a.month));
  res.json({
    months: result,
    total: result.reduce((s, m) => s + m.count, 0),
    withoutDelivery: projects.filter(p => !firstDeliveryByPid[p.id]).map(p => ({
      id: p.id, name: p.name, status: p.status, episodeTarget: p.episodeTarget || 0,
    })),
  });
});

// 月度统计报告数据（供 API 和 Excel 导出共用）
function buildMonthlyReportData() {
  const logs = projectService.loadDeliveryLog(10000) || [];
  const projects = shared.projects || [];

  const firstDeliveryByPid = {};
  for (const l of logs) {
    if (l.action !== '文件复制' || !l.projectId) continue;
    const prev = firstDeliveryByPid[l.projectId];
    if (!prev || l.time < prev.time) firstDeliveryByPid[l.projectId] = l;
  }
  const monthFilesMap = {};
  const monthProjectSet = {};
  for (const l of logs) {
    const ym = (l.time || '').slice(0, 7);
    if (!ym) continue;
    if (!monthFilesMap[ym]) { monthFilesMap[ym] = { ok: 0, fail: 0 }; monthProjectSet[ym] = new Set(); }
    monthFilesMap[ym].ok += (l.ok || 0);
    monthFilesMap[ym].fail += (l.fail || 0);
  }
  for (const pid of Object.keys(firstDeliveryByPid)) {
    const ym = firstDeliveryByPid[pid].time.slice(0, 7);
    if (monthProjectSet[ym]) monthProjectSet[ym].add(pid);
  }
  const months = Object.keys(monthFilesMap).sort((a, b) => b.localeCompare(a)).map(ym => ({
    month: ym,
    projectCount: monthProjectSet[ym] ? monthProjectSet[ym].size : 0,
    fileOk: monthFilesMap[ym].ok,
    fileFail: monthFilesMap[ym].fail,
  }));

  const editorMap = {};
  for (const p of projects) {
    const assigns = p.episodeAssignments || [];
    for (const a of assigns) {
      const name = (a.name || '').trim();
      if (!name) continue;
      if (!editorMap[name]) editorMap[name] = { name, assignedEpisodes: 0, projectCount: 0, projects: [] };
      const epRange = (a.end || 0) - (a.start || 0) + 1;
      if (epRange > 0) editorMap[name].assignedEpisodes += epRange;
      if (!editorMap[name].projects.includes(p.name)) {
        editorMap[name].projects.push(p.name);
        editorMap[name].projectCount++;
      }
    }
  }
  const editors = Object.values(editorMap).sort((a, b) => b.assignedEpisodes - a.assignedEpisodes);

  return {
    months, editors,
    totalProjects: projects.length,
    totalEditors: editors.length,
    totalDeliveryOk: logs.reduce((s, l) => s + (l.ok || 0), 0),
  };
}

// 月度统计报告：项目数、交付文件数、剪辑师产出
router.get('/monthly-report', (req, res) => {
  res.json(buildMonthlyReportData());
});

// Excel 月报导出
router.get('/monthly-report/export', async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const data = buildMonthlyReportData();
    const wb = new ExcelJS.Workbook();
    wb.creator = '项目档案管理器';
    wb.created = new Date();

    // Sheet 1: 月度统计
    const ws1 = wb.addWorksheet('月度统计');
    ws1.columns = [
      { header: '月份', key: 'month', width: 12 },
      { header: '交付项目数', key: 'projectCount', width: 14 },
      { header: '成功文件数', key: 'fileOk', width: 14 },
      { header: '失败文件数', key: 'fileFail', width: 14 },
    ];
    ws1.getRow(1).font = { bold: true };
    ws1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
    ws1.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    for (const m of data.months) ws1.addRow(m);
    ws1.addRow({ month: '合计', fileOk: data.totalDeliveryOk });

    // Sheet 2: 剪辑师产出
    const ws2 = wb.addWorksheet('剪辑师产出');
    ws2.columns = [
      { header: '姓名', key: 'name', width: 14 },
      { header: '应负责集数', key: 'assignedEpisodes', width: 14 },
      { header: '参与项目数', key: 'projectCount', width: 14 },
      { header: '项目列表', key: 'projects', width: 50 },
    ];
    ws2.getRow(1).font = { bold: true };
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
    ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    for (const e of data.editors) ws2.addRow({ ...e, projects: e.projects.join('、') });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="monthly-report.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(500).json({ error: '导出失败: ' + e.message });
  }
});

// 剪辑师工作台视图：按剪辑师分组展示项目和集数进度
router.get('/editor-view', (req, res) => {
  const projects = shared.projects || [];
  const logs = projectService.loadDeliveryLog(10000) || [];

  // 项目级已交付集数（从 delivery_logs 累计每个项目文件数 → 推算集数）
  const projectDeliveredCount = {};
  for (const l of logs) {
    if (!l.projectId) continue;
    projectDeliveredCount[l.projectId] = (projectDeliveredCount[l.projectId] || 0) + (l.ok || 0);
  }

  const editorMap = {};
  for (const p of projects) {
    const assigns = p.episodeAssignments || [];
    for (const a of assigns) {
      const name = (a.name || '').trim();
      if (!name) continue;
      if (!editorMap[name]) editorMap[name] = { name, projects: [], totalAssigned: 0, totalTarget: 0 };
      const epRange = (a.end || 0) - (a.start || 0) + 1;
      if (epRange > 0) editorMap[name].totalAssigned += epRange;
      editorMap[name].projects.push({
        projectId: p.id,
        projectName: p.name,
        status: p.status,
        episodeTarget: p.episodeTarget || 0,
        assignedRange: a.start + '-' + a.end,
        assignedCount: epRange > 0 ? epRange : 0,
        deliveredFiles: projectDeliveredCount[p.id] || 0,
      });
    }
  }

  // 每个剪辑师的总目标集数 = 所有项目 episodeTarget 之和（去重：同一项目只算一次）
  const editors = Object.values(editorMap).map(e => {
    const projectIds = new Set();
    let totalTarget = 0;
    for (const proj of e.projects) {
      if (!projectIds.has(proj.projectId)) {
        projectIds.add(proj.projectId);
        totalTarget += proj.episodeTarget || 0;
      }
    }
    return { ...e, totalTarget, projectCount: projectIds.size };
  }).sort((a, b) => b.totalAssigned - a.totalAssigned);

  res.json({ editors, totalEditors: editors.length });
});

module.exports = router;
