// ==================== 集数监控（自动刷新 + 达标通知）====================
var _monitorTimer = null;
var _monitorLastReady = false;       // 记录上次是否已达标，避免重复通知

// 请求桌面通知权限
function requestNotifyPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
}

// 发送桌面通知
function sendNotify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, icon: '/favicon.ico', tag: 'monitor' }); } catch(e) {}
}

// 开始/停止自动轮询（仅在未达标时轮询）
function startAutoMonitor() {
  stopAutoMonitor();
  _monitorLastReady = false;
  requestNotifyPermission();
  _monitorTimer = setInterval(function() {
    if (sel >= 0 && sel < projects.length && projects[sel].episodeTarget > 0) {
      refreshMonitor(true);
    }
  }, 5000);
}

function stopAutoMonitor() {
  if (_monitorTimer) { clearInterval(_monitorTimer); _monitorTimer = null; }
}

// 用户手动刷新（立即执行，不改变定时器）
function manualRefreshMonitor() {
  stopAutoMonitor();
  if (sel >= 0 && sel < projects.length && projects[sel].episodeTarget > 0) {
    refreshMonitor(false);
    startAutoMonitor();
  } else {
    refreshMonitor(false);
  }
}

async function refreshMonitor(isAuto) {
  if (sel < 0 || sel >= projects.length) return;
  var mb = document.getElementById('monitorBody');
  if (!mb) return;
  try {
    var pid = projects[sel].id;
    if (!pid) { mb.textContent = '项目缺少ID'; return; }
    var res = await fetch('/api/projects/' + encodeURIComponent(pid) + '/monitor');
    if (!res.ok) { mb.textContent = '监控请求失败 HTTP ' + res.status; return; }
    var data = await res.json();
    var badge = document.getElementById('monitorBadge');
    if (!data.episodeTarget || data.episodeTarget <= 0) {
      mb.innerHTML = '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<span>目标集数：</span>' +
        '<input id="monitorQuickInput" type="number" min="1" placeholder="集数" style="width:70px;padding:3px 8px;border:1px solid #475569;border-radius:5px;background:#1e293b;color:#e2e8f0;font-size:12px;outline:none" onkeydown="if(event.key===\'Enter\')setEpisodeTarget(sel)">' +
        '<button onclick="setEpisodeTarget(sel)" style="padding:3px 10px;border:1px solid #3b82f6;border-radius:5px;background:#2563eb;color:#fff;font-size:12px;cursor:pointer">确定</button>' +
        '</div>';
      if (badge) badge.textContent = '未设置';
      _monitorLastReady = false;
      return;
    }

    var lines = [];
    var autoLabel = isAuto ? ' <span style="color:#64748b;font-size:10px;font-weight:400">(每5秒)</span>' : '';
    lines.push('目标集数：' + data.episodeTarget + ' 集' + autoLabel);
    if (data.archiveCount !== undefined) {
      var pct = data.progress || 0;
      var bar = '<div style="background:#334155;border-radius:3px;height:4px;margin:4px 0"><div style="background:linear-gradient(90deg,#3b82f6,#2563eb);width:' + pct + '%;height:100%;border-radius:3px"></div></div>';
      var st = data.archiveReady ? '<span style="color:#22c55e">已达标，可交付！</span>' : '<span style="color:#f59e0b">' + data.archiveCount + ' / ' + data.episodeTarget + ' 集</span>';
      lines.push('📦 归档交付：' + st + bar);

      // 达标时停止自动轮询 + 发送通知
      if (data.archiveReady && !_monitorLastReady) {
        _monitorLastReady = true;
        stopAutoMonitor(); // 达标后不再轮询
        toast('🎉 归档交付已达标！目标 ' + data.episodeTarget + ' 集全部就绪', 'success');
        sendNotify('交付达标', projects[sel].name + ' 归档交付已达标（' + data.episodeTarget + '集）');
        addLog('🎉 集数监控：交付达标！' + data.archiveCount + '/' + data.episodeTarget + ' 集，已停止自动检测');
      } else if (!data.archiveReady) {
        _monitorLastReady = false;
      }

      // 缺少集数提示
      if (data.archiveMissing && data.archiveMissing.hasMissing) {
        var ranges = data.archiveMissing.ranges || [];
        var tip = '';
        if (ranges.length <= 8) {
          tip = ranges.join(', ');
        } else {
          tip = ranges.slice(0, 6).join(', ') + ' …等' + ranges.length + '处';
        }
        lines.push('<span style="color:#f97316;font-size:11px">⚠ 缺少 ' + data.archiveMissing.missingCount + ' 集：' + tip + '</span>');
      // 按人员分组显示缺失
      if (data.missingByPerson && data.missingByPerson.length > 0) {
        lines.push('<div style="margin-top:4px;font-size:11px"><span style="color:#e2e8f0">📋 各剪辑人员缺失：</span></div>');
        for (var pi = 0; pi < data.missingByPerson.length; pi++) {
          var pinfo = data.missingByPerson[pi];
          var pbar = '<div style="background:#334155;border-radius:2px;height:3px;margin:2px 0;width:100%"><div style="background:linear-gradient(90deg,#f59e0b,#f97316);width:' + pinfo.progress + '%;height:100%;border-radius:2px"></div></div>';
          var ptag = pinfo.missingCount <= 0 ? '<span style="color:#22c55e">✓ 齐</span>' : '<span style="color:#f97316">少' + pinfo.missingCount + '集：' + pinfo.ranges.join(',') + '</span>';
          lines.push('<span style="color:#cbd5e1">  👤 ' + esc(pinfo.name) + '（' + pinfo.start + '-' + pinfo.end + '集）</span> ' + ptag + pbar);
        }
      }
      }
    }
    if (data.modifyCount !== undefined) {
      var ms = data.modifyReady ? '<span style="color:#22c55e">有修改批次</span>' : '<span style="color:#94a3b8">暂无</span>';
      lines.push('🎬 修改交付：' + data.modifyCount + ' 个视频 ' + ms);
      if (data.modifyReady) toast('检测到新的修改批次！', 'warn');
    }
    if (data.d000Count !== undefined) {
      var ds = data.d000Ready ? '<span style="color:#22c55e">可交付</span>' : '<span style="color:#94a3b8">暂无</span>';
      lines.push('📦 000交付：' + data.d000Count + ' 个视频 ' + ds);
      if (data.d000Ready) toast('000交付就绪！', 'success');
    }

    mb.innerHTML = lines.join('<br>');
    if (badge) {
      if (data.status === '可交付') badge.innerHTML = '<span style="color:#22c55e">✓ 可交付</span>';
      else if (data.status === '监控中') badge.innerHTML = '<span style="color:#3b82f6">' + (data.progress || 0) + '%</span>';
      else badge.innerHTML = '<span style="color:#94a3b8">未设置</span>';
    }
  } catch (e) { mb.textContent = '监控加载失败：' + (e.message || '网络错误'); }
}
