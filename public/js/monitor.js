// ==================== 集数监控（自动刷新 + 达标通知）====================
let _monitorTimer = null;
let _monitorLastReady = false;
let _monitorNotifySent = {};
let _monitorLastStatus = '';        // 上次项目状态，切换时重置

function requestNotifyPermission() {
  if (window.electronAPI && window.electronAPI.isElectron) return;
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
}

function sendNotify(title, body) {
  if (typeof sendDesktopNotify === 'function') {
    sendDesktopNotify(title, body).catch(function() {});
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, icon: '/favicon.ico', tag: 'monitor' }); } catch(e) {}
}

// 开始轮询（剪辑中每30秒，修改中每60秒，已完成不轮询）
function startAutoMonitor() {
  stopAutoMonitor();
  requestNotifyPermission();
  const p = (sel >= 0 && sel < projects.length) ? projects[sel] : null;
  if (!p) return;
  let interval = 30000; // 默认30秒
  if (p.status === 'modifying') interval = 60000;
  else if (p.status === 'done') return; // 已完成不轮询
  _monitorLastReady = false;
  _monitorLastStatus = '';
  _monitorTimer = setInterval(function() {
    if (sel < 0 || sel >= projects.length) { stopAutoMonitor(); return; }
    refreshMonitor(true);
  }, interval);
}

function stopAutoMonitor() {
  if (_monitorTimer) { clearInterval(_monitorTimer); _monitorTimer = null; }
}

function manualRefreshMonitor() {
  if (sel < 0 || sel >= projects.length) return;
  refreshMonitor(false);
}

async function refreshMonitor(isAuto) {
  if (sel < 0 || sel >= projects.length) return;
  const mb = document.getElementById('monitorBody');
  if (!mb) return;
  try {
    const pid = projects[sel].id;
    if (!pid) { mb.textContent = '项目缺少ID'; return; }
    const res = await fetch('/api/projects/' + encodeURIComponent(pid) + '/monitor');
    if (!res.ok) { mb.textContent = '监控请求失败 HTTP ' + res.status; return; }
    const data = await res.json();
    const badge = document.getElementById('monitorBadge');
    const pStatus = data.projectStatus || 'editing';

    // 状态切换时重置通知标记
    if (_monitorLastStatus && _monitorLastStatus !== pStatus) {
      _monitorLastReady = false;
      _monitorNotifySent = {};
    }
    _monitorLastStatus = pStatus;

    if (!data.hasTarget) {
      mb.innerHTML =
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<span>目标集数：</span>' +
        '<input id="monitorQuickInput" type="number" min="1" placeholder="集数" style="width:70px;padding:3px 8px;border:1px solid #475569;border-radius:5px;background:#1e293b;color:#e2e8f0;font-size:12px;outline:none" onkeydown="if(event.key===\'Enter\')setEpisodeTarget(sel)">' +
        '<button onclick="setEpisodeTarget(sel)" style="padding:3px 10px;border:1px solid #3b82f6;border-radius:5px;background:#2563eb;color:#fff;font-size:12px;cursor:pointer">确定</button>' +
        '</div>';
      if (badge) badge.textContent = '未设置';
      return;
    }

    if (pStatus === 'editing') {
      renderEditingMonitor(mb, badge, data, isAuto);
    } else if (pStatus === 'modifying') {
      renderModifyingMonitor(mb, badge, data, isAuto);
    } else if (pStatus === 'done') {
      renderDoneMonitor(mb, badge, data, isAuto);
    }
  } catch (e) { mb.textContent = '监控加载失败：' + (e.message || '网络错误'); }
}

// ── 🔵 剪辑中：集数达标检测 ──
function renderEditingMonitor(mb, badge, data, isAuto) {
  const target = data.episodeTarget;
  const lines = [];
  const autoLabel = isAuto ? ' <span style="color:#64748b;font-size:10px;font-weight:400">(每30秒)</span>' : '';
  lines.push('🎯 目标集数：' + target + ' 集' + autoLabel);

  if (data.archiveCount !== undefined) {
    const pct = data.progress || 0;
    const barBg = pct >= 100 ? '#22c55e' : 'linear-gradient(90deg,#3b82f6,#2563eb)';
    const bar = '<div style="background:#334155;border-radius:3px;height:6px;margin:4px 0"><div style="background:' + barBg + ';width:' + pct + '%;height:100%;border-radius:3px"></div></div>';
    const st = data.archiveReady
      ? '<span style="color:#22c55e;font-weight:600">✅ 已达标，可交付！</span>'
      : '<span style="color:#f59e0b">' + data.archiveCount + ' / ' + target + ' 集</span>';
    lines.push('📦 归档交付：' + st + bar);

    if (data.archiveReady && !_monitorLastReady) {
      _monitorLastReady = true;
      stopAutoMonitor();
      toast('🎉 ' + projects[sel].name + ' 归档交付已达标！目标 ' + target + ' 集全部就绪', 'success');
      sendNotify('交付达标', projects[sel].name + ' 归档交付已达标（' + target + '集），可以交付了！');
      addLog('🎉 集数监控：交付达标！' + data.archiveCount + '/' + target + ' 集');
    } else if (!data.archiveReady) {
      _monitorLastReady = false;
    }

    if (data.archiveMissing && data.archiveMissing.hasMissing) {
      const ranges = data.archiveMissing.ranges || [];
      const tip = ranges.length <= 8 ? ranges.join(', ') : ranges.slice(0, 6).join(', ') + ' …等' + ranges.length + '处';
      lines.push('<span style="color:#f97316;font-size:11px">⚠ 缺少 ' + data.archiveMissing.missingCount + ' 集：' + tip + '</span>');
    }

    if (data.missingByPerson && data.missingByPerson.length > 0) {
      lines.push('<div style="margin-top:6px;font-size:11px;font-weight:600;color:#e2e8f0">📋 各剪辑人员缺失：</div>');
      for (const pinfo of data.missingByPerson) {
        const pbar = '<div style="background:#334155;border-radius:2px;height:3px;margin:2px 0"><div style="background:linear-gradient(90deg,#f59e0b,#f97316);width:' + pinfo.progress + '%;height:100%;border-radius:2px"></div></div>';
        const ptag = pinfo.missingCount <= 0
          ? '<span style="color:#22c55e">✓ 齐</span>'
          : '<span style="color:#f97316">少' + pinfo.missingCount + '集：' + pinfo.ranges.join(',') + '</span>';
        lines.push('<span style="color:#cbd5e1">  👤 ' + esc(pinfo.name) + '（第' + pinfo.start + '-' + pinfo.end + '集）</span> ' + ptag + pbar);
      }
    }
  }

  mb.innerHTML = lines.join('<br>');
  if (badge) {
    if (data.archiveReady) badge.innerHTML = '<span style="color:#22c55e">✓</span>';
    else badge.innerHTML = '<span style="color:#3b82f6">' + (data.progress || 0) + '%</span>';
  }
}

// ── 🟠 修改中：修改批次待交付 ──
function renderModifyingMonitor(mb, badge, data, isAuto) {
  const lines = [];
  const target = data.episodeTarget;
  const autoLabel = isAuto ? ' <span style="color:#64748b;font-size:10px;font-weight:400">(每60秒)</span>' : '';

  if (target > 0) lines.push('🎯 目标集数：' + target + ' 集' + autoLabel);

  if (data.modifyBatches) {
    const pending = data.modifyPendingCount;
    const total = data.modifyTotalCount;
    lines.push('<div style="font-weight:600;color:#e2e8f0">🎬 修改交付批次（' + total + '个，' + pending + '个待交付）</div>');
    for (const b of data.modifyBatches) {
      const icon = b.pending ? '🟡' : '✅';
      const tag = b.pending ? '<span style="color:#f59e0b">待交付</span>' : '<span style="color:#22c55e">已交付</span>';
      lines.push('<span style="color:#cbd5e1">  ' + icon + ' ' + esc(b.name) + ' · ' + b.videoCount + '视频 ' + tag + '</span>');
    }
    if (pending === 0) {
      _monitorLastReady = true;
      lines.push('<span style="color:#22c55e;margin-top:4px">✅ 全部批次已交付</span>');
    } else {
      if (total - pending > 0) {
        lines.push('<span style="color:#94a3b8;font-size:11px">已交付 ' + (total - pending) + ' 个，剩余 ' + pending + ' 个</span>');
      }
      const key = 'modify-' + projects[sel].id;
      if (!_monitorNotifySent[key]) {
        _monitorNotifySent[key] = true;
        toast('检测到 ' + pending + ' 个修改批次待交付', 'warn');
      }
    }
  } else if (data.modifyRelPath) {
    lines.push('本地修改目录存在，暂无待交付批次');
  } else {
    lines.push('<span style="color:#94a3b8">未找到"上映单集版"目录</span>');
  }

  if (data.modifyVideoTotal > 0) {
    lines.push('<span style="color:#94a3b8;font-size:11px">修改交付共 ' + data.modifyVideoTotal + ' 个视频文件</span>');
  }

  mb.innerHTML = lines.join('<br>');
  if (badge) {
    const pending = data.modifyPendingCount || 0;
    if (pending > 0) badge.innerHTML = '<span style="color:#f59e0b">' + pending + '</span>';
    else badge.innerHTML = '<span style="color:#22c55e">✓</span>';
  }
}

// ── ✅ 已完成：000交付各版本集数达标检测 ──
function renderDoneMonitor(mb, badge, data, isAuto) {
  const lines = [];
  const target = data.episodeTarget;

  if (target > 0) lines.push('🎯 目标集数：' + target + ' 集');

  if (data.d000Versions && data.d000Versions.length > 0) {
    const complete = data.d000CompleteCount;
    const total = data.d000Versions.length;
    lines.push('<div style="font-weight:600;color:#e2e8f0">📦 000交付 · ' + total + '个版本</div>');
    for (const v of data.d000Versions) {
      const icon = v.isComplete ? '✅' : '🟡';
      const pctText = target > 0 ? ' · ' + v.videoCount + '/' + target + '集' : ' · ' + v.videoCount + '视频';
      const tag = v.nasExists ? '<span style="color:#22c55e">已交付</span>' : '<span style="color:#f59e0b">待交付</span>';
      const pbar = target > 0
        ? '<div style="background:#334155;border-radius:2px;height:3px;margin:2px 0"><div style="background:' + (v.isComplete ? '#22c55e' : '#f59e0b') + ';width:' + v.pct + '%;height:100%;border-radius:2px"></div></div>'
        : '';
      lines.push('<span style="color:#cbd5e1">  ' + icon + ' ' + esc(v.name) + pctText + ' ' + tag + '</span>' + pbar);
    }

    if (data.d000AllReady) {
      _monitorLastReady = true;
      lines.push('<span style="color:#22c55e;font-weight:600;margin-top:4px">✅ 全部版本已达标！</span>');
    }
  } else if (data.d000RelPath) {
    lines.push('本地000交付目录存在，暂无交付版本');
  } else {
    lines.push('<span style="color:#94a3b8">未找到"000交付"目录</span>');
  }

  mb.innerHTML = lines.join('<br>');
  if (badge) {
    const complete = data.d000CompleteCount || 0;
    if (complete >= (data.d000Versions || []).length && complete > 0) {
      badge.innerHTML = '<span style="color:#22c55e">✓</span>';
    } else {
      badge.innerHTML = '<span style="color:#94a3b8">' + (complete || '0') + '</span>';
    }
  }
}
