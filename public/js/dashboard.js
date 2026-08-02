/**
 * 项目统计仪表盘 (Feature 3)
 * 使用 Chart.js 渲染：状态分布饼图、集数进度柱状图、交付趋势线图
 */
(function() {
  'use strict';

  let charts = {};
  let dashboardVisible = false;

  async function loadStats() {
    try {
      const resp = await fetch('/api/stats');
      return await resp.json();
    } catch (e) { console.error('加载统计失败:', e); return null; }
  }

  async function toggleDashboard() {
    const panel = document.getElementById('dashboardPanel2');
    if (!panel) return;
    if (dashboardVisible) {
      panel.style.display = 'none';
      dashboardVisible = false;
      // 销毁图表释放内存
      Object.values(charts).forEach(function(c) { try { c.destroy(); } catch (e) {} });
      charts = {};
      return;
    }
    panel.style.display = 'block';
    dashboardVisible = true;
    await render();
  }

  async function render(data) {
    if (!data) data = await loadStats();
    if (!data) return;

    const panel = document.getElementById('dashboardPanel2');
    if (!panel) return;

    // 构建 HTML
    panel.innerHTML = `
      <div class="prog-hdr">
        <span class="title">📊 项目统计仪表盘</span>
        <button class="close-btn" onclick="window.toggleDashboard()">&times;</button>
      </div>
      <div style="padding:16px;overflow-y:auto;max-height:80vh">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
          <div style="background:#1e293b;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:28px;font-weight:700;color:#3b82f6">${data.summary.total}</div>
            <div style="font-size:11px;color:#94a3b8">项目总数</div>
          </div>
          <div style="background:#1e293b;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:28px;font-weight:700;color:#f59e0b">${data.summary.editing}</div>
            <div style="font-size:11px;color:#94a3b8">剪辑中</div>
          </div>
          <div style="background:#1e293b;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:28px;font-weight:700;color:#22c55e">${data.summary.done}</div>
            <div style="font-size:11px;color:#94a3b8">已完成</div>
          </div>
          <div style="background:#1e293b;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:28px;font-weight:700;color:#a855f7">${data.summary.todayDelivery}</div>
            <div style="font-size:11px;color:#94a3b8">今日交付</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div style="background:#1e293b;border-radius:8px;padding:16px">
            <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:8px">项目状态分布</div>
            <div style="position:relative;height:200px"><canvas id="statusChart"></canvas></div>
          </div>
          <div style="background:#1e293b;border-radius:8px;padding:16px">
            <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:8px">交付趋势 (近7天)</div>
            <div style="position:relative;height:200px"><canvas id="deliveryChart"></canvas></div>
          </div>
        </div>
        <div style="background:#1e293b;border-radius:8px;padding:16px">
          <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:8px">集数完成度</div>
          <div style="position:relative;height:300px"><canvas id="progressChart"></canvas></div>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#64748b;text-align:right">
          数据更新于 ${new Date(data.generatedAt).toLocaleString('zh-CN')}
        </div>
      </div>
    `;

    // 销毁旧图表
    Object.values(charts).forEach(function(c) { try { c.destroy(); } catch (e) {} });
    charts = {};

    // 状态分布饼图
    const sCtx = document.getElementById('statusChart');
    if (sCtx) {
      charts.status = new Chart(sCtx, {
        type: 'doughnut',
        data: {
          labels: data.statusDistribution.map(function(d) { return d.label; }),
          datasets: [{
            data: data.statusDistribution.map(function(d) { return d.value; }),
            backgroundColor: data.statusDistribution.map(function(d) { return d.color; }),
            borderWidth: 2,
            borderColor: '#1e293b',
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: '#cbd5e1', font: { size: 11 } } } },
        },
      });
    }

    // 交付趋势线图
    const dCtx = document.getElementById('deliveryChart');
    if (dCtx) {
      charts.delivery = new Chart(dCtx, {
        type: 'line',
        data: {
          labels: data.deliveryTrend.map(function(d) { return d.date.slice(5); }),
          datasets: [
            { label: '成功', data: data.deliveryTrend.map(function(d) { return d.ok; }), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', tension: 0.3, fill: true },
            { label: '失败', data: data.deliveryTrend.map(function(d) { return d.fail; }), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', tension: 0.3, fill: true },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } },
          scales: { x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(148,163,184,0.1)' } }, y: { ticks: { color: '#64748b' }, beginAtZero: true, grid: { color: 'rgba(148,163,184,0.1)' } } },
        },
      });
    }

    // 集数进度柱状图
    const pCtx = document.getElementById('progressChart');
    if (pCtx && data.episodeProgress && data.episodeProgress.length) {
      charts.progress = new Chart(pCtx, {
        type: 'bar',
        data: {
          labels: data.episodeProgress.map(function(p) { return p.name.slice(0, 10); }),
          datasets: [
            { label: '已完成', data: data.episodeProgress.map(function(p) { return p.current; }), backgroundColor: '#3b82f6' },
            { label: '目标', data: data.episodeProgress.map(function(p) { return p.target; }), backgroundColor: 'rgba(148,163,184,0.2)' },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#cbd5e1', font: { size: 11 } } } },
          scales: { x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(148,163,184,0.1)' } }, y: { ticks: { color: '#64748b' }, beginAtZero: true, grid: { color: 'rgba(148,163,184,0.1)' } } },
        },
      });
    }
  }

  // 暴露到全局
  window.toggleDashboard = toggleDashboard;
  window.renderDashboard = render;
})();
