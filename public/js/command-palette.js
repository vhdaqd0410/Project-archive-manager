/**
 * 功能14: 命令面板（Ctrl+K）
 * 仿 VSCode 命令面板：模糊搜索项目 + 命令
 */
(function() {
  'use strict';

  let _overlay = null;
  let _input = null;
  let _list = null;
  let _items = [];
  let _activeIdx = 0;

  // 命令注册
  const commands = [
    { id: 'new', label: '新建项目', icon: '➕', hint: 'Ctrl+N', action: () => safeCall(() => window.showProjectForm && window.showProjectForm()) },
    { id: 'kanban', label: '打开看板视图', icon: '🗂️', hint: '', action: () => safeCall(() => window.showKanban && window.showKanban()) },
    { id: 'dashboard', label: '统计仪表盘', icon: '📊', hint: '', action: () => safeCall(() => window.toggleDashboard && window.toggleDashboard()) },
    { id: 'monthly', label: '月度统计报告', icon: '📈', hint: '', action: () => safeCall(() => window.MonthlyReport && window.MonthlyReport.show()) },
    { id: 'editor', label: '剪辑师工作台', icon: '👥', hint: '', action: () => safeCall(() => window.showEditorView && window.showEditorView()) },
    { id: 'calendar', label: '交付日历', icon: '📅', hint: '', action: () => safeCall(() => window.CalendarView && window.CalendarView.show()) },
    { id: 'screen', label: '可视化大屏', icon: '📺', hint: '', action: () => safeCall(() => window.ScreenView && window.ScreenView.show()) },
    { id: 'settings', label: '设置', icon: '⚙️', hint: '', action: () => safeCall(() => window.showSettings && window.showSettings()) },
    { id: 'refresh', label: '刷新项目列表', icon: '🔄', hint: 'F5', action: () => safeCall(() => window.refreshProjects && window.refreshProjects()) },
  ];

  function safeCall(fn) {
    try { fn(); } catch(e) { console.error('命令执行失败:', e); if (window.toast) window.toast('命令执行失败: ' + e.message, 'error'); }
  }

  function buildItems() {
    const items = [];
    // 项目
    const projects = (typeof window.getProjects === 'function' ? window.getProjects() : (window.projects || []));
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      const idx = i;
      items.push({
        type: 'project',
        id: p.id,
        label: p.name,
        sub: p.status + (p.episodeTarget ? ' · ' + p.episodeTarget + '集' : ''),
        icon: '🎬',
        action: () => {
          // 选中该项目
          if (typeof window.selectProjectByIndex === 'function') {
            window.selectProjectByIndex(idx);
          } else if (typeof window.selectProject === 'function') {
            window.selectProject(idx);
          }
        },
      });
    }
    // 命令
    for (const c of commands) {
      items.push({
        type: 'command',
        id: c.id,
        label: c.label,
        sub: c.hint || '',
        icon: c.icon,
        action: c.action,
      });
    }
    return items;
  }

  // 简单模糊匹配：query 字符依次出现在 label 中
  function fuzzyMatch(text, query) {
    if (!query) return true;
    text = text.toLowerCase();
    query = query.toLowerCase();
    let ti = 0;
    for (let i = 0; i < query.length; i++) {
      const found = text.indexOf(query[i], ti);
      if (found < 0) return false;
      ti = found + 1;
    }
    return true;
  }

  function score(text, query) {
    if (!query) return 0;
    text = text.toLowerCase();
    query = query.toLowerCase();
    if (text === query) return 1000;
    if (text.startsWith(query)) return 500;
    if (text.includes(query)) return 200;
    // 模糊匹配得分：连续匹配越多越好
    let score = 0, ti = 0, consecutive = 0;
    for (let i = 0; i < query.length; i++) {
      const found = text.indexOf(query[i], ti);
      if (found < 0) return -1;
      if (found === ti) consecutive++; else consecutive = 0;
      score += 10 + consecutive * 5;
      ti = found + 1;
    }
    return score;
  }

  function filter(query) {
    if (!query) return _items.slice(0, 30);
    const scored = [];
    for (const it of _items) {
      const s = score(it.label, query);
      if (s >= 0) scored.push({ it, s });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, 30).map(x => x.it);
  }

  function ensureCreated() {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.id = 'cmdPaletteOverlay';
    _overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:10000;display:none;align-items:flex-start;justify-content:center;padding-top:15vh';
    _overlay.innerHTML = `
      <div id="cmdPalette" style="width:90%;max-width:560px;background:var(--bg-primary,#1e293b);border:1px solid var(--border,#334155);border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.4);overflow:hidden">
        <div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-light,#1e293b)">
          <span style="font-size:16px;color:#64748b;margin-right:10px">🔍</span>
          <input id="cmdInput" placeholder="输入项目名或命令... (↑↓ 选择, Enter 执行, Esc 关闭)" style="flex:1;background:transparent;border:none;outline:none;color:var(--text,#e2e8f0);font-size:15px" autocomplete="off">
          <kbd style="font-size:10px;color:#64748b;border:1px solid #334155;border-radius:4px;padding:1px 6px">Esc</kbd>
        </div>
        <div id="cmdList" style="max-height:50vh;overflow-y:auto"></div>
      </div>`;
    document.body.appendChild(_overlay);

    _input = _overlay.querySelector('#cmdInput');
    _list = _overlay.querySelector('#cmdList');

    _input.addEventListener('input', () => {
      _activeIdx = 0;
      renderList();
    });
    _input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); _activeIdx = Math.min(_activeIdx + 1, _list.children.length - 1); updateActive(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); _activeIdx = Math.max(_activeIdx - 1, 0); updateActive(); }
      else if (e.key === 'Enter') { e.preventDefault(); executeActive(); }
      else if (e.key === 'Escape') { e.preventDefault(); hide(); }
    });
    _overlay.addEventListener('click', (e) => { if (e.target === _overlay) hide(); });
  }

  function renderList() {
    const query = _input.value.trim();
    const filtered = filter(query);
    if (!filtered.length) {
      _list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">无匹配项</div>';
      return;
    }
    _list.innerHTML = filtered.map((it, i) => `
      <div class="cmd-item ${i === _activeIdx ? 'active' : ''}" data-idx="${i}" style="display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border-light,rgba(255,255,255,.04))">
        <span style="font-size:16px;width:20px;text-align:center">${it.icon}</span>
        <div style="flex:1;overflow:hidden">
          <div style="color:var(--text,#e2e8f0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(it.label)}</div>
          ${it.sub ? '<div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(it.sub) + '</div>' : ''}
        </div>
        ${it.type === 'project' ? '<span style="font-size:10px;color:#3b82f6;border:1px solid #3b82f6;border-radius:3px;padding:0 4px">项目</span>' : '<span style="font-size:10px;color:#64748b;border:1px solid #475569;border-radius:3px;padding:0 4px">命令</span>'}
      </div>`).join('');
    // 绑定点击
    _list.querySelectorAll('.cmd-item').forEach(el => {
      const idx = parseInt(el.dataset.idx);
      el.addEventListener('mouseenter', () => { _activeIdx = idx; updateActive(); });
      el.addEventListener('click', () => { _activeIdx = idx; executeActive(); });
    });
  }

  function updateActive() {
    _list.querySelectorAll('.cmd-item').forEach((el, i) => {
      el.classList.toggle('active', i === _activeIdx);
      el.style.background = i === _activeIdx ? 'var(--bg-secondary,rgba(59,130,246,.1))' : '';
    });
    // 滚动可见
    const active = _list.querySelector('.cmd-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function executeActive() {
    const query = _input.value.trim();
    const filtered = filter(query);
    const item = filtered[_activeIdx];
    if (item) {
      hide();
      setTimeout(() => { try { item.action(); } catch(e) { console.error(e); } }, 50);
    }
  }

  function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function show() {
    ensureCreated();
    _items = buildItems();
    _input.value = '';
    _activeIdx = 0;
    _overlay.style.display = 'flex';
    renderList();
    setTimeout(() => _input.focus(), 50);
  }

  function hide() {
    if (_overlay) _overlay.style.display = 'none';
  }

  function toggle() {
    if (_overlay && _overlay.style.display === 'flex') hide();
    else show();
  }

  // 全局快捷键 Ctrl+K
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      toggle();
    }
  });

  window.CommandPalette = { show, hide, toggle };
})();
