// ==================== 集数监控 ====================
async function refreshMonitor() {
  if (sel < 0) return;
  var mb = document.getElementById('monitorBody');
  if (!mb) return;
  try {
    var data = await api.get('/api/projects/' + sel + '/monitor');
    var badge = document.getElementById('monitorBadge');
    if (!data.episodeTarget || data.episodeTarget <= 0) {
      mb.innerHTML = '未设置目标集数（编辑项目可设定）';
      if (badge) badge.textContent = '';
      return;
    }

    var lines = [];
    lines.push('🎯 目标：' + data.episodeTarget + ' 集');
    if (data.archiveCount !== undefined) {
      var pct = data.progress || 0;
      var bar = '<div style="background:#e2e8f0;border-radius:3px;height:4px;margin:4px 0"><div style="background:linear-gradient(90deg,#3b82f6,#2563eb);width:' + pct + '%;height:100%;border-radius:3px"></div></div>';
      var statusText = data.archiveReady ? '<span style="color:#22c55e">✅ 已达标，可以交付！</span>' : '<span style="color:#f59e0b">' + data.archiveCount + ' / ' + data.episodeTarget + ' 集</span>';
      lines.push('📁 初版交付：' + statusText + bar);
      if (data.archiveReady) toast('🎉 初版交付集数已达标！', 'success');
    }
    if (data.modifyCount !== undefined) {
      var mStatus = data.modifyReady ? '<span style="color:#22c55e">✅ 有修改批次</span>' : '<span style="color:#94a3b8">暂无</span>';
      lines.push('🎬 修改交付（上映单集版）：' + data.modifyCount + ' 个视频 ' + mStatus);
      if (data.modifyReady) toast('📢 上映单集版有新的修改批次！', 'warn');
    }
    if (data.d000Count !== undefined) {
      var dStatus = data.d000Ready ? '<span style="color:#22c55e">✅ 可最终交付</span>' : '<span style="color:#94a3b8">暂无</span>';
      lines.push('📦 000交付：' + data.d000Count + ' 个视频 ' + dStatus);
      if (data.d000Ready) toast('📦 000交付已就绪！', 'success');
    }

    mb.innerHTML = lines.join('<br>');
    if (badge) {
      if (data.status === 'ready') badge.innerHTML = '<span style="color:#22c55e">✅ 就绪</span>';
      else badge.innerHTML = '<span style="color:#3b82f6">' + (data.progress || 0) + '%</span>';
    }
  } catch (e) { mb.textContent = '监控加载失败'; }
}
