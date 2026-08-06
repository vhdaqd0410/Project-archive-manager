// ==================== 统一通知系统 ====================
// 桌面通知 + 应用内 toast + 通知中心 + 历史记录（统一入口）
// 挂载 window.NotificationManager，供 app/monitor/sse 等模块复用
(function() {
  'use strict';

  var STORAGE_KEY = 'pam_notifications';
  var MAX_HISTORY = 50;
  var LEVEL_ICONS = { info: '💬', success: '✅', warn: '⚠️', error: '❌' };
  var LEVEL_COLORS = { info: '#3b82f6', success: '#22c55e', warn: '#f59e0b', error: '#ef4444' };

  // 模块加载时从 localStorage 恢复历史
  var _history = [];
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) _history = JSON.parse(raw) || [];
  } catch (e) { _history = []; }

  function _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_history)); } catch (e) {}
  }

  // 文本转义，防止注入
  function _esc(s) {
    var div = document.createElement('div');
    div.textContent = (s == null ? '' : String(s));
    return div.innerHTML;
  }

  function _genId() {
    return 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function _formatTime(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return _esc(iso);
      var now = new Date();
      var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
      var sameDay = d.toDateString() === now.toDateString();
      var hh = pad(d.getHours());
      var mm = pad(d.getMinutes());
      if (sameDay) return hh + ':' + mm;
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hh + ':' + mm;
    } catch (e) { return _esc(iso); }
  }

  // 桌面通知：优先 electronAPI，失败降级浏览器 Notification
  function _desktopNotify(title, body) {
    if (window.electronAPI && window.electronAPI.showNotification) {
      try {
        var p = window.electronAPI.showNotification(title, body);
        if (p && typeof p.catch === 'function') {
          p.catch(function() { _browserNotify(title, body); });
        }
        return;
      } catch (e) { /* 降级浏览器通知 */ }
    }
    _browserNotify(title, body);
  }

  function _browserNotify(title, body) {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      try {
        Notification.requestPermission().then(function() {
          if (Notification.permission === 'granted') {
            try { new Notification(title, { body: body, icon: '/favicon.ico', tag: 'pam-notify' }); } catch (e) {}
          }
        });
      } catch (e) {}
      return;
    }
    if (Notification.permission === 'granted') {
      try { new Notification(title, { body: body, icon: '/favicon.ico', tag: 'pam-notify' }); } catch (e) {}
    }
  }

  // 通知主进程托盘未读数
  function _notifyUnread() {
    try {
      if (window.electronAPI && window.electronAPI.sendMessage) {
        window.electronAPI.sendMessage('notification-unread', unreadCount());
      }
    } catch (e) {}
  }

  function _isCenterOpen() {
    var center = document.getElementById('notifyCenter');
    return !!(center && center.style.display !== 'none' && center.style.display !== '');
  }

  function unreadCount() {
    var n = 0;
    for (var i = 0; i < _history.length; i++) {
      if (!_history[i].read) n++;
    }
    return n;
  }

  // 统一通知入口：level ∈ 'info'|'success'|'warn'|'error'（默认 info）
  function notify(title, body, level) {
    level = level || 'info';
    if (LEVEL_ICONS[level] == null) level = 'info';
    var item = {
      id: _genId(),
      title: title,
      body: body || '',
      level: level,
      time: new Date().toISOString(),
      read: false
    };
    _history.unshift(item);
    if (_history.length > MAX_HISTORY) _history = _history.slice(0, MAX_HISTORY);
    _save();

    // 桌面通知
    _desktopNotify(title, body);

    // 应用内 toast
    if (typeof window.toast === 'function') {
      window.toast(title + (body ? '：' + body : ''), level);
    }

    // 更新 UI
    renderBadge();
    if (_isCenterOpen()) renderCenter();

    // 通知主进程托盘
    _notifyUnread();
    return item.id;
  }

  function markRead(id) {
    var changed = false;
    for (var i = 0; i < _history.length; i++) {
      if (_history[i].id === id && !_history[i].read) {
        _history[i].read = true;
        changed = true;
        break;
      }
    }
    if (!changed) return;
    _save();
    renderBadge();
    if (_isCenterOpen()) renderCenter();
    _notifyUnread();
  }

  function markAllRead() {
    var changed = false;
    for (var i = 0; i < _history.length; i++) {
      if (!_history[i].read) { _history[i].read = true; changed = true; }
    }
    if (!changed) return;
    _save();
    renderBadge();
    renderCenter();
    _notifyUnread();
  }

  function clearAll() {
    if (_history.length === 0) return;
    _history = [];
    _save();
    renderBadge();
    renderCenter();
    _notifyUnread();
  }

  function getHistory() {
    return _history.slice();
  }

  // 切换通知中心面板显示
  function toggleCenter() {
    var center = document.getElementById('notifyCenter');
    if (!center) return;
    if (center.style.display === 'none' || center.style.display === '') {
      center.style.display = 'flex';
      renderCenter();
    } else {
      center.style.display = 'none';
    }
  }

  // 渲染通知中心列表
  function renderCenter() {
    var body = document.getElementById('notifyCenterBody');
    if (!body) return;
    if (_history.length === 0) {
      body.innerHTML = '<div style="padding:30px 14px;text-align:center;color:#64748b;font-size:12px">📭 暂无通知</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < _history.length; i++) {
      var it = _history[i];
      var icon = LEVEL_ICONS[it.level] || LEVEL_ICONS.info;
      var titleStyle = it.read
        ? 'color:#94a3b8;font-weight:400'
        : 'color:#e2e8f0;font-weight:600';
      var dot = it.read ? '' : '<span style="display:inline-block;width:7px;height:7px;background:#ef4444;border-radius:50%;margin-right:6px;vertical-align:middle"></span>';
      html +=
        '<div onclick="window.NotificationManager.markRead(\'' + _esc(it.id) + '\')" style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer;transition:background .15s" onmouseover="this.style.background=\'rgba(255,255,255,.04)\'" onmouseout="this.style.background=\'transparent\'">' +
          '<div style="display:flex;align-items:flex-start;gap:8px">' +
            '<span style="font-size:14px;line-height:1.4">' + icon + '</span>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="' + titleStyle + ';font-size:12px;line-height:1.4;word-break:break-all">' + dot + _esc(it.title) + '</div>' +
              (it.body ? '<div style="color:#94a3b8;font-size:11px;line-height:1.4;margin-top:2px;word-break:break-all">' + _esc(it.body) + '</div>' : '') +
              '<div style="color:#475569;font-size:10px;margin-top:3px">' + _formatTime(it.time) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    }
    body.innerHTML = html;
  }

  // 更新未读角标
  function renderBadge() {
    var badge = document.getElementById('notifyBadge');
    if (!badge) return;
    var n = unreadCount();
    if (n > 0) {
      badge.style.display = 'block';
      badge.textContent = n > 99 ? '99+' : String(n);
    } else {
      badge.style.display = 'none';
      badge.textContent = '0';
    }
  }

  // DOMContentLoaded 后刷新角标
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderBadge);
  } else {
    renderBadge();
  }

  window.NotificationManager = {
    notify: notify,
    markRead: markRead,
    markAllRead: markAllRead,
    clearAll: clearAll,
    getHistory: getHistory,
    unreadCount: unreadCount,
    toggleCenter: toggleCenter,
    renderCenter: renderCenter,
    renderBadge: renderBadge
  };
})();
