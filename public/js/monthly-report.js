/**
 * 月度统计报告面板（Feature: 交付看板）
 * 复用 #dashboardPanel2 全屏容器展示
 */
window.MonthlyReport = (function () {
  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function fmtMonth(ym) {
    const parts = String(ym || '').split('-');
    return parts.length === 2 ? parts[0] + '年' + parseInt(parts[1], 10) + '月' : ym;
  }

  async function show() {
    const panel = document.getElementById('dashboardPanel2');
    if (!panel) return;
    panel.style.display = 'block';
    panel.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8">📊 加载中...</div>';
    try {
      const r = await (await fetch('/api/stats/monthly-report')).json();
      render(panel, r);
    } catch (e) {
      panel.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444">加载失败: ' + esc(e.message) + '</div>';
    }
  }

  function render(panel, data) {
    // 简易柱状图（max 文件数）
    const months = (data.months || []).slice(0, 12);
    const maxOk = Math.max(1, ...months.map(m => m.fileOk || 0));
    const barRows = months.map(m => {
      const pct = Math.round((m.fileOk || 0) / maxOk * 100);
      return '<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px">'
        + '<span style="width:80px;color:#cbd5e1">' + esc(fmtMonth(m.month)) + '</span>'
        + '<div style="flex:1;background:rgba(255,255,255,.05);border-radius:4px;height:18px;overflow:hidden">'
        + '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#3b82f6,#22c55e);transition:width .3s"></div></div>'
        + '<span style="width:120px;text-align:right;color:#22c55e">' + (m.fileOk || 0) + ' 文件 · ' + m.projectCount + ' 项目</span>'
        + '</div>';
    }).join('');

    const editorRows = (data.editors || []).map(e =>
      '<tr>'
      + '<td style="padding:6px 10px;color:#e2e8f0">' + esc(e.name) + '</td>'
      + '<td style="text-align:center;color:#22c55e;font-weight:600">' + e.assignedEpisodes + '</td>'
      + '<td style="text-align:center;color:#cbd5e1">' + e.projectCount + '</td>'
      + '<td style="font-size:11px;color:#94a3b8;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escAttr(e.projects.join('、')) + '">' + esc(e.projects.join('、')) + '</td>'
      + '</tr>'
    ).join('');

    panel.innerHTML =
      '<div style="padding:24px;max-height:88vh;overflow-y:auto">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">'
      + '<h2 style="margin:0;font-size:18px;color:#e2e8f0">📊 月度统计报告</h2>'
      + '<div style="display:flex;gap:6px;align-items:center">'
      + '<button onclick="window.MonthlyReport.exportExcel()" style="background:#22c55e;border:none;color:#fff;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px">📥 导出Excel</button>'
      + '<button onclick="document.getElementById(\'dashboardPanel2\').style.display=\'none\'" style="background:none;border:1px solid #475569;color:#94a3b8;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:16px">×</button>'
      + '</div></div>'
      // 汇总卡
      + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">'
      + '<div style="background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.3);border-radius:8px;padding:14px;text-align:center">'
      + '<div style="font-size:24px;font-weight:700;color:#3b82f6">' + (data.totalProjects || 0) + '</div>'
      + '<div style="font-size:11px;color:#94a3b8;margin-top:2px">项目总数</div></div>'
      + '<div style="background:rgba(168,85,247,.1);border:1px solid rgba(168,85,247,.3);border-radius:8px;padding:14px;text-align:center">'
      + '<div style="font-size:24px;font-weight:700;color:#a855f7">' + (data.totalEditors || 0) + '</div>'
      + '<div style="font-size:11px;color:#94a3b8;margin-top:2px">剪辑师人数</div></div>'
      + '<div style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:8px;padding:14px;text-align:center">'
      + '<div style="font-size:24px;font-weight:700;color:#22c55e">' + (data.totalDeliveryOk || 0) + '</div>'
      + '<div style="font-size:11px;color:#94a3b8;margin-top:2px">累计交付文件</div></div>'
      + '</div>'
      // 月度柱状图
      + '<div style="background:rgba(255,255,255,.03);border-radius:8px;padding:14px;margin-bottom:18px">'
      + '<div style="font-size:13px;color:#cbd5e1;margin-bottom:10px">📅 近 12 个月交付趋势</div>'
      + (barRows || '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px">暂无交付记录</div>')
      + '</div>'
      // 剪辑师产出表
      + '<div style="background:rgba(255,255,255,.03);border-radius:8px;padding:14px">'
      + '<div style="font-size:13px;color:#cbd5e1;margin-bottom:10px">👥 剪辑师产出统计（按应负责集数排序）</div>'
      + (editorRows
        ? '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="border-bottom:1px solid rgba(255,255,255,.1)">'
          + '<th style="text-align:left;padding:6px 10px;color:#94a3b8">姓名</th>'
          + '<th style="text-align:center;padding:6px 10px;color:#94a3b8">应负责集数</th>'
          + '<th style="text-align:center;padding:6px 10px;color:#94a3b8">参与项目</th>'
          + '<th style="text-align:left;padding:6px 10px;color:#94a3b8">项目列表</th>'
          + '</tr></thead><tbody>' + editorRows + '</tbody></table>'
        : '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px">暂无剪辑师分配记录</div>')
      + '</div>'
      + '</div>';
  }

  function escAttr(s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function exportExcel() {
    window.open('/api/stats/monthly-report/export', '_blank');
  }

  return { show: show, exportExcel: exportExcel };
})();
