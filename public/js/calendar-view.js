/**
 * 功能13: 项目交付日历视图
 * 按月历展示交付计划与历史，预期交付标黄、过期标红、已交付标绿
 */
(function() {
  'use strict';

  const api = window.api || {
    get: async u => (await fetch(u)).json(),
  };

  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function escAttr(s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  let _state = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),  // 0-based
    data: null,
  };

  async function load() {
    try {
      _state.data = await api.get('/api/stats/calendar');
    } catch(e) {
      _state.data = { items: [], events: {}, today: new Date().toISOString().slice(0, 10) };
    }
    render();
  }

  function render() {
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').textContent = '📅 交付日历';
    const body = document.getElementById('modalBody');

    const y = _state.year, m = _state.month;
    const monthLabel = y + '年' + (m + 1) + '月';
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    const startWeekday = (firstDay.getDay() + 6) % 7;  // 周一=0
    const daysInMonth = lastDay.getDate();
    const today = _state.data ? _state.data.today : '';

    // 聚合每日事件计数
    const events = (_state.data && _state.data.events) || {};
    const items = (_state.data && _state.data.items) || [];

    // 预期交付日期映射
    const expectedByDate = {};
    const firstDeliveryByDate = {};
    for (const it of items) {
      if (it.expectedDate) {
        const d = it.expectedDate.slice(0, 10);
        if (!expectedByDate[d]) expectedByDate[d] = [];
        expectedByDate[d].push(it);
      }
      if (it.firstDeliveryDate) {
        const d = it.firstDeliveryDate.slice(0, 10);
        if (!firstDeliveryByDate[d]) firstDeliveryByDate[d] = [];
        firstDeliveryByDate[d].push(it);
      }
    }

    // 生成日历格
    const weeks = Math.ceil((startWeekday + daysInMonth) / 7);
    let cells = '';
    const weekdays = '一二三四五六日';
    for (let i = 0; i < 7; i++) {
      cells += `<div class="cal-cell cal-head">${weekdays[i]}</div>`;
    }
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const dayNum = w * 7 + d - startWeekday + 1;
        if (dayNum < 1 || dayNum > daysInMonth) {
          cells += '<div class="cal-cell cal-empty"></div>';
        } else {
          const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
          const ev = events[dateStr] || [];
          const expected = expectedByDate[dateStr] || [];
          const delivered = firstDeliveryByDate[dateStr] || [];
          const isToday = dateStr === today;
          const isPast = dateStr < today;

          // 决定样式
          let cls = 'cal-cell';
          const badges = [];
          if (delivered.length) { cls += ' cal-delivered'; badges.push(`✅ ${delivered.length}`); }
          if (expected.length) {
            if (isPast && !delivered.length) { cls += ' cal-overdue'; badges.push(`⚠️ ${expected.length}`); }
            else { cls += ' cal-expected'; badges.push(`🎯 ${expected.length}`); }
          }
          if (ev.length && !delivered.length) { cls += ' cal-event'; badges.push(`📦 ${ev.length}`); }
          if (isToday) cls += ' cal-today';

          const tooltip = buildTooltip(expected, delivered, ev);
          cells += `<div class="${cls}" title="${escAttr(tooltip)}" onclick="window.CalendarView.showDay('${dateStr}')">
            <div class="cal-daynum">${dayNum}</div>
            ${badges.length ? '<div class="cal-badges">' + badges.map(b => `<span class="cal-badge">${b}</span>`).join('') + '</div>' : ''}
          </div>`;
        }
      }
    }

    const html = `
      <div id="calendarBody">
        <div class="cal-nav">
          <button class="btn btn-sm btn-outline" onclick="window.CalendarView.prev()">‹ 上月</button>
          <span style="font-size:16px;font-weight:600">${monthLabel}</span>
          <button class="btn btn-sm btn-outline" onclick="window.CalendarView.next()">下月 ›</button>
          <button class="btn btn-sm btn-outline" onclick="window.CalendarView.today()" style="margin-left:8px">今天</button>
          <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">
            <span style="color:#22c55e">●</span> 已交付
            <span style="color:#f59e0b;margin-left:6px">●</span> 预期交付
            <span style="color:#ef4444;margin-left:6px">●</span> 过期未交付
          </span>
        </div>
        <div class="cal-grid">${cells}</div>
        <div id="calDetail" style="margin-top:10px"></div>
      </div>
      <div class="modal-btns">
        <button class="btn btn-outline" onclick="window.closeModal()">关闭</button>
      </div>`;
    body.innerHTML = html;
    overlay.style.display = 'flex';
  }

  function buildTooltip(expected, delivered, events) {
    const lines = [];
    if (expected.length) lines.push('预期交付: ' + expected.map(p => p.name).join(', '));
    if (delivered.length) lines.push('已交付: ' + delivered.map(p => p.name).join(', '));
    if (events.length) lines.push(`交付事件 ${events.length} 条`);
    return lines.join('\n') || '无事件';
  }

  function showDay(dateStr) {
    const detail = document.getElementById('calDetail');
    if (!detail || !_state.data) return;
    const events = (_state.data.events[dateStr]) || [];
    const items = _state.data.items || [];
    const expected = items.filter(p => p.expectedDate && p.expectedDate.slice(0, 10) === dateStr);
    const delivered = items.filter(p => p.firstDeliveryDate && p.firstDeliveryDate.slice(0, 10) === dateStr);

    let html = `<div style="background:var(--bg-secondary);border-radius:8px;padding:10px;border:1px solid var(--border)">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px">📆 ${dateStr}</div>`;

    if (expected.length) {
      html += '<div style="font-size:12px;color:#f59e0b;margin-top:4px">🎯 预期交付：</div>';
      html += expected.map(p => `<div style="font-size:11px;padding:2px 0 2px 12px">• ${esc(p.name)} ${p.episodeTarget ? '(' + p.episodeTarget + '集)' : ''}</div>`).join('');
    }
    if (delivered.length) {
      html += '<div style="font-size:12px;color:#22c55e;margin-top:6px">✅ 已交付：</div>';
      html += delivered.map(p => `<div style="font-size:11px;padding:2px 0 2px 12px">• ${esc(p.name)}</div>`).join('');
    }
    if (events.length) {
      html += '<div style="font-size:12px;color:var(--text-muted);margin-top:6px">📦 交付事件：</div>';
      html += events.map(e => `<div style="font-size:11px;padding:2px 0 2px 12px">• ${esc(e.action)} - ${esc(e.projectName || '?')} (${e.ok}成功${e.fail ? '/' + e.fail + '失败' : ''})</div>`).join('');
    }
    if (!expected.length && !delivered.length && !events.length) {
      html += '<div style="font-size:12px;color:var(--text-muted);padding:6px 0">无事件</div>';
    }
    html += '</div>';
    detail.innerHTML = html;
  }

  function prev() {
    _state.month--;
    if (_state.month < 0) { _state.month = 11; _state.year--; }
    render();
  }
  function next() {
    _state.month++;
    if (_state.month > 11) { _state.month = 0; _state.year++; }
    render();
  }
  function goToday() {
    const d = new Date();
    _state.year = d.getFullYear();
    _state.month = d.getMonth();
    render();
  }

  async function show() {
    await load();
  }

  window.CalendarView = { show, prev, next, today: goToday, showDay };
})();
