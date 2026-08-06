/**
 * 功能15: 数据可视化大屏
 * 全屏展示项目统计、交付趋势、剪辑师产出等，适合会议/晨会投影
 */
(function() {
  'use strict';

  const api = window.api || { get: async u => (await fetch(u)).json() };
  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  let _el = null;
  let _charts = {};
  let _timer = null;
  let _data = null;

  async function show() {
    await load();
    document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
  }

  function hide() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    Object.values(_charts).forEach(c => { try { c.destroy(); } catch(e) {} });
    _charts = {};
    if (_el) { _el.remove(); _el = null; }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  async function load() {
    try {
      _data = await api.get('/api/stats/screen');
    } catch(e) {
      if (window.toast) window.toast('加载大屏数据失败', 'error');
      return;
    }
    if (!_el) createEl();
    renderData();
    // 每 60 秒自动刷新
    if (_timer) clearInterval(_timer);
    _timer = setInterval(load, 60000);
  }

  function createEl() {
    _el = document.createElement('div');
    _el.id = 'screenView';
    _el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:linear-gradient(135deg,#0a0e27 0%,#1a1f4e 100%);color:#e2e8f0;overflow-y:auto;font-family:system-ui,sans-serif';
    _el.innerHTML = `
      <div style="position:sticky;top:0;z-index:10;background:rgba(10,14,39,.85);backdrop-filter:blur(8px);padding:14px 24px;display:flex;align-items:center;border-bottom:1px solid rgba(59,130,246,.2)">
        <div style="font-size:22px;font-weight:700;background:linear-gradient(90deg,#3b82f6,#06b6d4);-webkit-background-clip:text;background-clip:text;color:transparent">📺 项目档案管理 · 数据大屏</div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:14px">
          <span id="screenTime" style="font-size:14px;color:#94a3b8"></span>
          <button onclick="window.ScreenView.hide()" style="background:rgba(239,68,68,.15);border:1px solid #ef4444;color:#ef4444;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:12px">✕ 退出</button>
        </div>
      </div>
      <div style="padding:20px 24px">
        <div id="screenKpis" style="display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin-bottom:18px"></div>
        <div style="display:grid;grid-template-columns:1.6fr 1fr;gap:14px;margin-bottom:14px">
          <div style="background:rgba(30,41,59,.5);border:1px solid rgba(59,130,246,.15);border-radius:12px;padding:14px">
            <div style="font-size:13px;font-weight:600;color:#94a3b8;margin-bottom:8px">📈 最近 14 天交付趋势</div>
            <canvas id="screenTrendChart" height="180"></canvas>
          </div>
          <div style="background:rgba(30,41,59,.5);border:1px solid rgba(59,130,246,.15);border-radius:12px;padding:14px">
            <div style="font-size:13px;font-weight:600;color:#94a3b8;margin-bottom:8px">📊 项目状态分布</div>
            <canvas id="screenStatusChart" height="180"></canvas>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
          <div style="background:rgba(30,41,59,.5);border:1px solid rgba(59,130,246,.15);border-radius:12px;padding:14px">
            <div style="font-size:13px;font-weight:600;color:#94a3b8;margin-bottom:8px">🏆 剪辑师产出 TOP10</div>
            <canvas id="screenEditorChart" height="220"></canvas>
          </div>
          <div style="background:rgba(30,41,59,.5);border:1px solid rgba(59,130,246,.15);border-radius:12px;padding:14px">
            <div style="font-size:13px;font-weight:600;color:#94a3b8;margin-bottom:8px">📅 近 6 个月交付</div>
            <canvas id="screenMonthlyChart" height="220"></canvas>
          </div>
          <div style="background:rgba(30,41,59,.5);border:1px solid rgba(59,130,246,.15);border-radius:12px;padding:14px;display:flex;flex-direction:column">
            <div style="font-size:13px;font-weight:600;color:#94a3b8;margin-bottom:8px">⚡ 今日交付动态</div>
            <div id="screenTodayList" style="flex:1;overflow-y:auto;font-size:11px;max-height:220px"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(_el);
    _el.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  }

  function renderData() {
    if (!_data || !_el) return;
    const s = _data.summary;
    // 时间
    const t = document.getElementById('screenTime');
    if (t) t.textContent = new Date().toLocaleString('zh-CN');

    // KPI
    const kpis = [
      { label: '项目总数', value: s.totalProjects, icon: '🎬', color: '#3b82f6' },
      { label: '剪辑中', value: s.editing, icon: '🔵', color: '#3b82f6' },
      { label: '修改中', value: s.modifying, icon: '🟠', color: '#f59e0b' },
      { label: '已完成', value: s.done, icon: '✅', color: '#22c55e' },
      { label: '今日交付文件', value: s.todayFiles, icon: '📦', color: '#06b6d4' },
      { label: '累计交付文件', value: s.totalFiles, icon: '📈', color: '#a855f7' },
    ];
    document.getElementById('screenKpis').innerHTML = kpis.map(k => `
      <div style="background:rgba(30,41,59,.5);border:1px solid ${k.color}33;border-radius:12px;padding:14px;text-align:center">
        <div style="font-size:24px;margin-bottom:4px">${k.icon}</div>
        <div style="font-size:26px;font-weight:700;color:${k.color}">${k.value}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:4px">${k.label}</div>
      </div>`).join('');

    // 趋势图
    drawTrend();
    drawStatus();
    drawEditors();
    drawMonthly();
    renderTodayList();
  }

  function drawTrend() {
    const ctx = document.getElementById('screenTrendChart');
    if (!ctx) return;
    if (_charts.trend) _charts.trend.destroy();
    const Chart = window.Chart;
    if (!Chart) return;
    _charts.trend = new Chart(ctx, {
      type: 'line',
      data: {
        labels: _data.deliveryTrend.map(d => d.date.slice(5)),
        datasets: [{
          label: '成功',
          data: _data.deliveryTrend.map(d => d.ok),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,.15)',
          fill: true, tension: 0.4, pointRadius: 3,
        }, {
          label: '失败',
          data: _data.deliveryTrend.map(d => d.fail),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,.1)',
          fill: true, tension: 0.4, pointRadius: 3,
        }],
      },
      options: chartOpts(true),
    });
  }

  function drawStatus() {
    const ctx = document.getElementById('screenStatusChart');
    if (!ctx) return;
    if (_charts.status) _charts.status.destroy();
    const Chart = window.Chart;
    if (!Chart) return;
    _charts.status = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: _data.statusDistribution.map(s => s.label),
        datasets: [{
          data: _data.statusDistribution.map(s => s.value),
          backgroundColor: _data.statusDistribution.map(s => s.color),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 } } },
        },
      },
    });
  }

  function drawEditors() {
    const ctx = document.getElementById('screenEditorChart');
    if (!ctx) return;
    if (_charts.editor) _charts.editor.destroy();
    const Chart = window.Chart;
    if (!Chart) return;
    const editors = _data.editorRanking;
    _charts.editor = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: editors.map(e => e.name),
        datasets: [{
          label: '负责集数',
          data: editors.map(e => e.episodes),
          backgroundColor: 'rgba(168,85,247,.7)',
          borderColor: '#a855f7',
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: gridStyle(),
      },
    });
  }

  function drawMonthly() {
    const ctx = document.getElementById('screenMonthlyChart');
    if (!ctx) return;
    if (_charts.monthly) _charts.monthly.destroy();
    const Chart = window.Chart;
    if (!Chart) return;
    _charts.monthly = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: _data.monthlyTrend.map(m => m.month),
        datasets: [{
          label: '交付项目数',
          data: _data.monthlyTrend.map(m => m.projectCount),
          backgroundColor: 'rgba(34,197,94,.7)',
          borderColor: '#22c55e',
          borderWidth: 1,
        }, {
          label: '交付文件数',
          data: _data.monthlyTrend.map(m => m.files),
          backgroundColor: 'rgba(6,182,212,.7)',
          borderColor: '#06b6d4',
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: gridStyle(),
      },
    });
  }

  function renderTodayList() {
    const el = document.getElementById('screenTodayList');
    if (!el) return;
    const list = _data.todayDeliveries || [];
    if (!list.length) {
      el.innerHTML = '<div style="color:#64748b;text-align:center;padding:20px">今日暂无交付</div>';
      return;
    }
    el.innerHTML = list.map(l => {
      const t = (l.time || '').slice(11, 16);
      return `<div style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.05);color:#cbd5e1">
        <span style="color:#64748b">${t}</span>
        <span style="margin-left:8px">${esc(l.projectName || '?')}</span>
        <span style="color:#22c55e;margin-left:6px">+${l.ok || 0}</span>
        ${l.fail ? '<span style="color:#ef4444;margin-left:4px">-' + l.fail + '</span>' : ''}
      </div>`;
    }).join('');
  }

  function chartOpts(legend) {
    return {
      responsive: true,
      plugins: { legend: { display: legend !== false, labels: { color: '#94a3b8' } } },
      scales: gridStyle(),
    };
  }
  function gridStyle() {
    return {
      x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,.1)' } },
      y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,.1)' } },
    };
  }

  window.ScreenView = { show, hide, load };
})();
