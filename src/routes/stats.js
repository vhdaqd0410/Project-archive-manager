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

// 项目交付日历视图
// 返回每个项目的预期交付日期（initialDeliveryDate 字段）+ 实际交付历史
// 项目可设置 expectedDeliveryDate；初版交付日期由 delivery_logs 推断
router.get('/calendar', (req, res) => {
  const projects = shared.projects || [];
  const logs = projectService.loadDeliveryLog(10000) || [];

  // 每个项目最早的"文件复制"记录作为初版交付日期
  const firstDeliveryByPid = {};
  for (const l of logs) {
    if (l.action !== '文件复制' || !l.projectId) continue;
    const prev = firstDeliveryByPid[l.projectId];
    if (!prev || l.time < prev.time) firstDeliveryByPid[l.projectId] = l.time;
  }

  // 按日期聚合所有交付事件
  const eventsByDate = {};
  for (const l of logs) {
    const day = (l.time || '').slice(0, 10);
    if (!day) continue;
    if (!eventsByDate[day]) eventsByDate[day] = [];
    eventsByDate[day].push({
      projectId: l.projectId,
      projectName: l.projectName,
      action: l.action,
      ok: l.ok || 0,
      fail: l.fail || 0,
    });
  }

  // 构建项目日历项：预期交付日期 + 实际交付日期
  const items = projects.map(p => {
    const firstDelivery = firstDeliveryByPid[p.id] || null;
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      expectedDate: p.expectedDeliveryDate || null,  // 可选字段
      firstDeliveryDate: firstDelivery,
      episodeTarget: p.episodeTarget || 0,
    };
  });

  res.json({
    items,
    events: eventsByDate,
    today: new Date().toISOString().slice(0, 10),
  });
});

// 数据可视化大屏聚合接口
// 一次性返回大屏所需全部数据，减少请求次数
router.get('/screen', (req, res) => {
  const projects = shared.projects || [];
  const logs = projectService.loadDeliveryLog(10000) || [];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // 1) 状态分布
  const statusDist = { editing: 0, modifying: 0, done: 0 };
  for (const p of projects) {
    if (statusDist[p.status] !== undefined) statusDist[p.status]++;
  }

  // 2) 最近 14 天交付趋势
  const dayMs = 24 * 60 * 60 * 1000;
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(now - i * dayMs).toISOString().slice(0, 10);
    let ok = 0, fail = 0;
    for (const l of logs) {
      if ((l.time || '').slice(0, 10) === day) { ok += (l.ok || 0); fail += (l.fail || 0); }
    }
    trend.push({ date: day, ok, fail });
  }

  // 3) 剪辑师产出（按交付文件数排序）
  const editorMap = {};
  for (const p of projects) {
    for (const a of (p.episodeAssignments || [])) {
      const name = (a.name || '').trim();
      if (!name) continue;
      if (!editorMap[name]) editorMap[name] = { name, projects: new Set(), episodes: 0 };
      editorMap[name].projects.add(p.name);
      const range = (a.end || 0) - (a.start || 0) + 1;
      if (range > 0) editorMap[name].episodes += range;
    }
  }
  const editors = Object.values(editorMap).map(e => ({
    name: e.name, projectCount: e.projects.size, episodes: e.episodes,
  })).sort((a, b) => b.episodes - a.episodes).slice(0, 10);

  // 4) 今日交付明细
  const todayDeliveries = logs.filter(l => (l.time || '').slice(0, 10) === today);

  // 5) 按月份交付项目数（最近 6 个月）
  const monthMs = 30 * dayMs;
  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now - i * monthMs);
    const ym = d.toISOString().slice(0, 7);
    const projSet = new Set();
    let files = 0;
    for (const l of logs) {
      if ((l.time || '').slice(0, 7) === ym) {
        if (l.projectId) projSet.add(l.projectId);
        files += (l.ok || 0);
      }
    }
    monthly.push({ month: ym, projectCount: projSet.size, files });
  }

  // 6) 总览数据
  const totalFiles = logs.reduce((s, l) => s + (l.ok || 0), 0);

  res.json({
    summary: {
      totalProjects: projects.length,
      editing: statusDist.editing,
      modifying: statusDist.modifying,
      done: statusDist.done,
      totalFiles,
      todayFiles: todayDeliveries.reduce((s, l) => s + (l.ok || 0), 0),
      todayProjects: new Set(todayDeliveries.map(l => l.projectId).filter(Boolean)).size,
    },
    statusDistribution: [
      { label: '剪辑中', value: statusDist.editing, color: '#3b82f6' },
      { label: '修改中', value: statusDist.modifying, color: '#f59e0b' },
      { label: '已完成', value: statusDist.done, color: '#22c55e' },
    ],
    deliveryTrend: trend,
    editorRanking: editors,
    monthlyTrend: monthly,
    todayDeliveries: todayDeliveries.slice(-20).reverse(),
    generatedAt: now.toISOString(),
  });
});

// ==================== 报告导出中心 ====================
// 支持 4 种报告：projects(项目档案) / delivery(交付历史) / editors(剪辑师绩效) / quality(质检报告)
// 格式：xlsx / csv / json

router.get('/report/:type', async (req, res) => {
  const type = req.params.type;
  const format = (req.query.format || 'xlsx').toLowerCase();
  const validTypes = ['projects', 'delivery', 'editors', 'quality'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: '未知报告类型: ' + type + '，支持: ' + validTypes.join(', ') });
  }
  const validFormats = ['xlsx', 'csv', 'json'];
  if (!validFormats.includes(format)) {
    return res.status(400).json({ error: '未知格式: ' + format + '，支持: ' + validFormats.join(', ') });
  }

  try {
    const data = buildReportData(type);
    const baseName = type + '-report-' + new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.json"`);
      return res.json({ type, generatedAt: new Date().toISOString(), rows: data.rows, summary: data.summary });
    }

    if (format === 'csv') {
      const csv = toCSV(data.rows);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
      // BOM 让 Excel 正确识别 UTF-8
      return res.send('\ufeff' + csv);
    }

    // xlsx
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = '项目档案管理器';
    wb.created = new Date();
    const ws = wb.addWorksheet(data.sheetName || '报告');
    if (data.rows.length) {
      const keys = Object.keys(data.rows[0]);
      ws.columns = keys.map(k => ({ header: k, key: k, width: 18 }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
      for (const row of data.rows) ws.addRow(row);
    }
    // 摘要 sheet
    if (data.summary) {
      const ws2 = wb.addWorksheet('摘要');
      ws2.columns = [{ header: '指标', key: 'k', width: 24 }, { header: '值', key: 'v', width: 24 }];
      ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
      for (const [k, v] of Object.entries(data.summary)) ws2.addRow({ k, v: String(v) });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  } catch (e) {
    console.error('[stats] 报告导出失败:', e);
    res.status(500).json({ error: '导出失败: ' + e.message });
  }
});

// 构建各类报告数据
function buildReportData(type) {
  const projects = shared.projects || [];
  const logs = projectService.loadDeliveryLog(10000) || [];
  const now = new Date().toISOString();

  if (type === 'projects') {
    const rows = projects.map(p => ({
      项目名: p.name,
      状态: p.status === 'editing' ? '剪辑中' : p.status === 'modifying' ? '修改中' : '已完成',
      本地目录: p.localDir || '',
      NAS目录: p.nasDir || '',
      目标集数: p.episodeTarget || 0,
      剪辑人员: (p.episodeAssignments || []).map(a => a.name + (a.start ? `(${a.start}-${a.end})` : '')).join('、'),
      备注: (p.memo || '').slice(0, 100),
      创建时间: p.createdAt || '',
    }));
    return {
      sheetName: '项目档案',
      rows,
      summary: {
        总项目数: rows.length,
        剪辑中: rows.filter(r => r.状态 === '剪辑中').length,
        修改中: rows.filter(r => r.状态 === '修改中').length,
        已完成: rows.filter(r => r.状态 === '已完成').length,
        导出时间: now,
      },
    };
  }

  if (type === 'delivery') {
    const rows = logs.slice().reverse().map(l => ({
      时间: l.time || '',
      项目名: l.projectName || '',
      操作: l.action || '',
      详情: (l.detail || '').slice(0, 100),
      成功数: l.ok || 0,
      失败数: l.fail || 0,
    }));
    const totalOk = logs.reduce((s, l) => s + (l.ok || 0), 0);
    const totalFail = logs.reduce((s, l) => s + (l.fail || 0), 0);
    return {
      sheetName: '交付历史',
      rows,
      summary: {
        总记录数: logs.length,
        总成功文件: totalOk,
        总失败文件: totalFail,
        首次交付: logs[0] ? logs[0].time : '无',
        最近交付: logs.length ? logs[logs.length - 1].time : '无',
        导出时间: now,
      },
    };
  }

  if (type === 'editors') {
    const editorMap = {};
    for (const p of projects) {
      for (const a of (p.episodeAssignments || [])) {
        const name = (a.name || '').trim();
        if (!name) continue;
        if (!editorMap[name]) editorMap[name] = { name, projects: new Set(), episodes: 0 };
        editorMap[name].projects.add(p.name);
        const range = (a.end || 0) - (a.start || 0) + 1;
        if (range > 0) editorMap[name].episodes += range;
      }
    }
    const rows = Object.values(editorMap).map(e => ({
      剪辑师: e.name,
      负责项目数: e.projects.size,
      负责集数: e.episodes,
      项目列表: Array.from(e.projects).join('、'),
    })).sort((a, b) => b.负责集数 - a.负责集数);
    return {
      sheetName: '剪辑师绩效',
      rows,
      summary: {
        总剪辑师数: rows.length,
        总负责集数: rows.reduce((s, r) => s + r.负责集数, 0),
        导出时间: now,
      },
    };
  }

  if (type === 'quality') {
    // 基于 file_checksums 表
    let rows = [];
    try {
      const db = require('../services/db');
      rows = (db.getFileChecksums ? db.getFileChecksums() : []).map(c => ({
        项目ID: c.projectId || '',
        文件路径: c.filePath || '',
        文件名: c.fileName || '',
        校验状态: c.verified ? '通过' : '失败',
        文件大小: c.fileSize || 0,
        校验时间: c.verifiedAt || '',
      }));
    } catch (e) {}
    const verified = rows.filter(r => r.校验状态 === '通过').length;
    const failed = rows.filter(r => r.校验状态 === '失败').length;
    return {
      sheetName: '质检报告',
      rows,
      summary: {
        总校验文件: rows.length,
        通过: verified,
        失败: failed,
        通过率: rows.length ? (verified / rows.length * 100).toFixed(1) + '%' : 'N/A',
        导出时间: now,
      },
    };
  }
}

// CSV 转换
function toCSV(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [keys.join(',')];
  for (const r of rows) {
    lines.push(keys.map(k => escape(r[k])).join(','));
  }
  return lines.join('\r\n');
}

module.exports = router;
