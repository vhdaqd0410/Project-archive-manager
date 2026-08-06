/**
 * SSE 客户端 (Feature 4)
 * 替代 300ms 轮询，接收服务端实时推送
 */
(function() {
  'use strict';

  let eventSource = null;
  let connected = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const RECONNECT_BASE = 1000;   // 1s
  const RECONNECT_MAX = 30000;   // 30s

  const handlers = {
    'connected': [],
    'job:progress': [],
    'job:complete': [],
    'episode:update': [],
    'project:update': [],
    'notification': [],
    'stats:update': [],
    'scheduler:run': [],
    'heartbeat': [],
  };

  function connect() {
    if (eventSource) {
      try { eventSource.close(); } catch (e) {}
      eventSource = null;
    }
    try {
      eventSource = new EventSource('/api/events');
      // 注意：connected 不在此处置位，等 onopen 真正建立后再置位，避免「假在线」导致 pollJob 降频
      reconnectAttempts = 0;

      Object.keys(handlers).forEach(function(eventName) {
        eventSource.addEventListener(eventName, function(e) {
          try {
            const data = JSON.parse(e.data);
            handlers[eventName].forEach(function(fn) {
              try { fn(data); } catch (err) { console.error('SSE handler error:', err); }
            });
          } catch (err) { console.error('SSE parse error:', err); }
        });
      });

      // 连接真正建立后才置位 connected 并更新指示器
      eventSource.onopen = function() {
        connected = true;
        reconnectAttempts = 0;
        const indicator = document.getElementById('serverIndicator');
        if (indicator) indicator.textContent = '🟢 实时连接';
      };

      eventSource.onerror = function() {
        connected = false;
        const indicator = document.getElementById('serverIndicator');
        if (indicator) indicator.textContent = '🔴 已断开，重连中...';
        // 必须先 close，否则浏览器 EventSource 会自动重连，与下方手动重连并存导致连接泄漏
        try { eventSource.close(); } catch (e) {}
        eventSource = null;
        // 指数退避重连：1s → 2s → 4s → 8s → 16s → 30s（上限）
        reconnectAttempts++;
        const delay = Math.min(RECONNECT_BASE * Math.pow(2, reconnectAttempts - 1), RECONNECT_MAX);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, delay);
      };
    } catch (e) {
      console.error('SSE 连接失败:', e);
      connected = false;
      // 降级为轮询模式
      reconnectAttempts++;
      const delay = Math.min(RECONNECT_BASE * Math.pow(2, reconnectAttempts - 1), RECONNECT_MAX);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, delay);
    }
  }

  function on(eventName, fn) {
    if (!handlers[eventName]) handlers[eventName] = [];
    handlers[eventName].push(fn);
  }

  function off(eventName, fn) {
    if (!handlers[eventName]) return;
    if (fn) {
      handlers[eventName] = handlers[eventName].filter(function(f) { return f !== fn; });
    } else {
      handlers[eventName] = [];
    }
  }

  function isConnected() { return connected; }

  // ── 注册默认处理器 ──

  // 任务进度
  on('job:progress', function(data) {
    if (typeof window !== 'undefined' && window._currentJobId && window._currentJobId === data.id) {
      updateProgressUI(data);
    }
    // 更新任务指示器
    const ji = document.getElementById('jobIndicator');
    const jit = document.getElementById('jobIndicatorText');
    if (ji && jit) {
      ji.style.display = 'flex';
      jit.textContent = data.completed + '/' + data.totalItems;
    }
  });

  // 任务完成
  on('job:complete', function(data) {
    if (typeof window !== 'undefined' && window._currentJobId && window._currentJobId === data.id) {
      // updateProgressUI 已处理 done/cancelled/error 状态样式
      updateProgressUI(data);
      // 立即 resolve pollJob 的 Promise，让 refreshDetail 尽快执行（不必等 2s 轮询兜底）
      if (typeof window._resolvePollJob === 'function') window._resolvePollJob(data);
    }
    // 如果有进度面板，隐藏
    setTimeout(function() {
      const ji = document.getElementById('jobIndicator');
      if (ji) ji.style.display = 'none';
    }, 3000);

    // 复制完成后刷新数据
    if (data.type && data.type.includes('复制')) {
      if (typeof refreshDetail === 'function' && typeof sel !== 'undefined' && sel >= 0) {
        refreshDetail();
      }
    }
  });

  // 集数更新
  on('episode:update', function(data) {
    if (typeof window !== 'undefined' && typeof sel !== 'undefined' && sel >= 0) {
      const cur = projects && projects[sel];
      if (cur && cur.id === data.projectId) {
        if (typeof refreshDetail === 'function') refreshDetail();
      }
    }
  });

  // 项目更新
  on('project:update', function(data) {
    if (data.action === 'copy_complete') {
      toast('复制完成: 成功 ' + (data.ok || 0) + ', 失败 ' + (data.fail || 0), 'success');
      if (typeof refreshDetail === 'function') refreshDetail();
    }
  });

  // 通知
  on('notification', function(data) {
    // 统一走 NotificationManager（内部已处理桌面通知 + toast + 历史）
    if (window.NotificationManager) {
      window.NotificationManager.notify(data.title, data.body, data.level || 'info');
      return;
    }
    // 兜底：浏览器通知 + toast
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(data.title, { body: data.body });
    }
    if (typeof toast === 'function') {
      toast(data.title + ': ' + data.body, data.level || 'info');
    }
  });

  // 统计更新
  on('stats:update', function(data) {
    if (typeof window.renderDashboard === 'function') {
      window.renderDashboard(data);
    }
  });

  // 自动连接
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }

  // 暴露到全局
  window.SSE = { connect: connect, on: on, off: off, isConnected: isConnected };
})();
