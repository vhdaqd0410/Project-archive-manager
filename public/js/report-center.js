/**
 * 功能24: 数据导出报告中心
 * 统一导出项目档案/交付历史/剪辑师绩效/质检报告，支持 xlsx/csv/json
 */
(function() {
  'use strict';

  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  const reports = [
    {
      id: 'projects',
      name: '项目档案',
      icon: '🎬',
      desc: '所有项目的完整档案：名称、状态、目录、集数、人员、备注',
      fields: ['项目名', '状态', '本地目录', 'NAS目录', '目标集数', '剪辑人员', '备注', '创建时间'],
    },
    {
      id: 'delivery',
      name: '交付历史',
      icon: '📦',
      desc: '所有交付操作记录：时间、项目、操作类型、成功/失败文件数',
      fields: ['时间', '项目名', '操作', '详情', '成功数', '失败数'],
    },
    {
      id: 'editors',
      name: '剪辑师绩效',
      icon: '👥',
      desc: '按剪辑师聚合：负责项目数、集数、项目列表',
      fields: ['剪辑师', '负责项目数', '负责集数', '项目列表'],
    },
    {
      id: 'quality',
      name: '质检报告',
      icon: '✅',
      desc: '文件完整性校验记录：项目、文件、校验状态、大小',
      fields: ['项目ID', '文件路径', '文件名', '校验状态', '文件大小', '校验时间'],
    },
  ];

  const formats = [
    { id: 'xlsx', name: 'Excel', icon: '📊', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { id: 'csv', name: 'CSV', icon: '📃', mime: 'text/csv' },
    { id: 'json', name: 'JSON', icon: '⚙️', mime: 'application/json' },
  ];

  let _selectedReport = 'projects';
  let _selectedFormat = 'xlsx';

  function show() {
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').textContent = '📥 报告导出中心';
    const body = document.getElementById('modalBody');

    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">1. 选择报告类型</div>
          <div id="reportTypes" style="display:flex;flex-direction:column;gap:6px">
            ${reports.map(r => `
              <div class="report-card ${r.id === _selectedReport ? 'selected' : ''}" data-id="${r.id}" onclick="window.ReportCenter.selectReport('${r.id}')"
                style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all .15s;background:${r.id === _selectedReport ? 'rgba(59,130,246,.08)' : 'var(--bg-secondary)'};border-color:${r.id === _selectedReport ? 'var(--primary)' : 'var(--border)'}">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:18px">${r.icon}</span>
                  <span style="font-size:13px;font-weight:600">${r.name}</span>
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${r.desc}</div>
              </div>`).join('')}
          </div>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">2. 选择导出格式</div>
          <div id="reportFormats" style="display:flex;gap:8px;margin-bottom:14px">
            ${formats.map(f => `
              <div class="format-card ${f.id === _selectedFormat ? 'selected' : ''}" data-id="${f.id}" onclick="window.ReportCenter.selectFormat('${f.id}')"
                style="flex:1;padding:10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;text-align:center;transition:all .15s;background:${f.id === _selectedFormat ? 'rgba(59,130,246,.08)' : 'var(--bg-secondary)'};border-color:${f.id === _selectedFormat ? 'var(--primary)' : 'var(--border)'}">
                <div style="font-size:20px">${f.icon}</div>
                <div style="font-size:12px;font-weight:600;margin-top:2px">${f.name}</div>
              </div>`).join('')}
          </div>
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">3. 字段预览</div>
          <div id="reportFields" style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:10px;min-height:80px">
            ${renderFields(_selectedReport)}
          </div>
        </div>
      </div>
      <div style="margin-top:14px;background:rgba(59,130,246,.05);border:1px solid rgba(59,130,246,.2);border-radius:8px;padding:10px;font-size:11px;color:var(--text-muted)">
        💡 <strong>说明</strong>：Excel 含数据 + 摘要两个 Sheet；CSV 含 UTF-8 BOM（Excel 直接打开不乱码）；JSON 含 rows + summary。
        导出后浏览器会自动下载到默认下载目录。
      </div>
      <div class="modal-btns" style="margin-top:14px">
        <button class="btn btn-outline" onclick="window.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="window.ReportCenter.export()" style="background:var(--primary);color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">📥 立即导出</button>
      </div>`;
    overlay.style.display = 'flex';
  }

  function renderFields(reportId) {
    const r = reports.find(x => x.id === reportId);
    if (!r) return '';
    return '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
      r.fields.map(f => `<span style="background:rgba(59,130,246,.1);color:#3b82f6;padding:2px 8px;border-radius:4px;font-size:11px">${esc(f)}</span>`).join('') +
      '</div>';
  }

  function selectReport(id) {
    _selectedReport = id;
    // 更新选中样式
    document.querySelectorAll('.report-card').forEach(el => {
      const selected = el.dataset.id === id;
      el.classList.toggle('selected', selected);
      el.style.background = selected ? 'rgba(59,130,246,.08)' : 'var(--bg-secondary)';
      el.style.borderColor = selected ? 'var(--primary)' : 'var(--border)';
    });
    document.getElementById('reportFields').innerHTML = renderFields(id);
  }

  function selectFormat(id) {
    _selectedFormat = id;
    document.querySelectorAll('.format-card').forEach(el => {
      const selected = el.dataset.id === id;
      el.classList.toggle('selected', selected);
      el.style.background = selected ? 'rgba(59,130,246,.08)' : 'var(--bg-secondary)';
      el.style.borderColor = selected ? 'var(--primary)' : 'var(--border)';
    });
  }

  async function exportReport() {
    const url = `/api/stats/report/${_selectedReport}?format=${_selectedFormat}`;
    try {
      if (window.toast) window.toast('⏳ 正在生成报告...', 'info');
      const r = await fetch(url);
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: 'HTTP ' + r.status }));
        throw new Error(err.error || '导出失败');
      }
      const blob = await r.blob();
      // 触发下载
      const a = document.createElement('a');
      const contentDisp = r.headers.get('Content-Disposition') || '';
      const m = contentDisp.match(/filename="?([^"]+)"?/);
      const filename = m ? m[1] : `${_selectedReport}-report.${_selectedFormat}`;
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
      if (window.toast) window.toast('✅ 已导出: ' + filename, 'success');
      if (window.closeModal) window.closeModal();
    } catch(e) {
      if (window.toast) window.toast('导出失败: ' + e.message, 'error');
    }
  }

  window.ReportCenter = { show, selectReport, selectFormat, export: exportReport };
})();
