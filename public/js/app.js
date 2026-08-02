const api = {
  get: async u => (await fetch(u)).json(),
  post: async (u, d) => (await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })).json(),
  put: async (u, d) => (await fetch(u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })).json(),
  del: async u => (await fetch(u, { method: 'DELETE' })).json()
};

let projects = [], settings = {}, sel = -1, resolved = null, scanResults = [];
let nasDirModify = '', nasDir000 = '', localDirModify = '', localDir000 = '';
let batchSel = {}, collapsedGroups = { '✅ 已完成': true }, checkedModify = {}, checked000 = {};

window.onload = async function() {
  projects = await api.get('/api/projects');
  settings = await api.get('/api/settings');
  document.getElementById('keywordInput').value = settings.keyword || '项目归档资料';
  // 加载标签
  if (window.Features) {
    await window.Features.loadTags();
    // 为每个项目加载标签
    for (const p of projects) {
      try { p._tagObjs = await window.Features.getProjectTags(p.id); } catch(e) { p._tagObjs = []; }
    }
  }
  renderProjectList();
  refreshServerStatus();
};

function $(id) { return document.getElementById(id); }

// ==================== 工具函数 ====================
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function escAttr(s) { return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function setStatus(m) { $('statusText').textContent = m; }
function closeModal() { $('modalOverlay').style.display = 'none'; }
function copyText(text) { navigator.clipboard.writeText(text).catch(() => {}); setStatus('已复制'); }

function addLog(msg) {
  const t = new Date().toLocaleTimeString();
  const lc = $('logContent'); if (lc) lc.innerHTML += '<div>[' + t + '] ' + esc(msg) + '</div>';
  const lp = $('logPanel'); if (lp) lp.scrollTop = lp.scrollHeight;
}

function checkAll(listId, checked) {
  document.querySelectorAll('#' + listId + ' input[type=checkbox]').forEach(cb => cb.checked = checked);
}

// 获取勾选的 checkbox 对应的名称（取 span 文本，截到 ' (' 前）
function getCheckedNames(listId) {
  const cbs = document.querySelectorAll('#' + listId + ' input[type=checkbox]');
  const names = [];
  for (let i = 0; i < cbs.length; i++) {
    if (cbs[i].checked) names.push(cbs[i].nextElementSibling.textContent.split(' (')[0]);
  }
  return names;
}

// ==================== 批量操作 ====================
function updateBatchBar() {
  const keys = Object.keys(batchSel).filter(k => batchSel[k]);
  const bar = $('batchBar'), count = $('batchCount');
  if (keys.length) { bar.style.display = ''; count.textContent = '已选 ' + keys.length + ' 个'; }
  else { bar.style.display = 'none'; }
}
function batchSelectAll() {
  const search = ($('searchInput').value || '').toLowerCase();
  for (const p of projects) {
    if (search && p.name.toLowerCase().indexOf(search) < 0) continue;
    batchSel[p.id] = true;
  }
  renderProjectList();
}
function batchClear() { batchSel = {}; renderProjectList(); }
function toggleBatch(pid, ev) { ev.stopPropagation(); batchSel[pid] = !batchSel[pid]; updateBatchBar(); }

async function batchSetStatus() {
  const status = $('batchStatus').value;
  const keys = Object.keys(batchSel).filter(k => batchSel[k]);
  if (!keys.length) { alert('请先勾选项目'); return; }
  setStatus('正在更新 ' + keys.length + ' 个项目...');
  try {
    for (const id of keys) await api.put('/api/projects/' + id + '/status', { status });
    setStatus('已更新 ' + keys.length + ' 个项目');
    batchSel = {}; projects = await api.get('/api/projects'); renderProjectList();
    if (sel >= 0 && sel < projects.length) selectProject(sel);
  } catch (e) { setStatus('更新失败: ' + e.message); }
}

async function batchDelete() {
  const keys = Object.keys(batchSel).filter(k => batchSel[k]);
  if (!keys.length) { alert('请先勾选项目'); return; }
  if (!confirm('确定删除 ' + keys.length + ' 个项目？')) return;
  // 从后往前删避免索引错乱
  keys.sort((a, b) => projects.findIndex(p => p.id === b) - projects.findIndex(p => p.id === a));
  for (const id of keys) await api.del('/api/projects/' + id);
  batchSel = {}; projects = await api.get('/api/projects');
  if (sel >= projects.length) sel = projects.length - 1;
  renderProjectList();
  if (sel >= 0) selectProject(sel); else $('rightPanel').innerHTML = '<div class="empty">请从左侧选择项目，或新建项目</div>';
}

// ==================== 状态快速切换 ====================
let _statusTargetIdx = -1;
function toggleStatusMenu(e, pid, idx) {
  e.stopPropagation();
  _statusTargetIdx = idx;
  let drop = document.getElementById('statusDrop');
  let p = projects[idx];
  let options = [
    { value: 'editing', icon: '🔵', label: '剪辑中' },
    { value: 'modifying', icon: '🟠', label: '修改中' },
    { value: 'done', icon: '✅', label: '已完成' }
  ];
  drop.innerHTML = '';
  for (let i = 0; i < options.length; i++) {
    let opt = options[i];
    let o = document.createElement('div');
    o.className = 'so' + (p.status === opt.value ? ' sel' : '');
    o.textContent = opt.icon + ' ' + opt.label;
    o.onclick = (function(val) {
      return function(ev) { ev.stopPropagation(); setProjectStatus(_statusTargetIdx, val); };
    })(opt.value);
    drop.appendChild(o);
  }
  // 定位到按钮下方
  let btn = e.currentTarget;
  let rect = btn.getBoundingClientRect();
  drop.style.left = rect.left + 'px';
  drop.style.top = (rect.bottom + 2) + 'px';
  drop.classList.add('show');
}

async function setProjectStatus(idx, status) {
  let drop = document.getElementById('statusDrop');
  drop.classList.remove('show');
  const pid = projects[idx].id;
  await api.put('/api/projects/' + pid + '/status', { status });
  projects[idx].status = status;
  renderProjectList();
  if (sel === idx) selectProject(idx);
  toast('状态已更新', 'success');
}

// ==================== 右键菜单 ====================
function showContextMenu(e, idx) {
  selectProject(idx);
  let drop = document.getElementById('statusDrop');
  let p = projects[idx];
  drop.innerHTML = '';
  let actions = [
    { label: '✏️ 编辑项目', action: function() { showProjectDlg(idx); } },
    { label: '🎯 设置目标集数', action: function() { setEpisodeTarget(idx); } },
    { label: '🗑 删除项目', action: function() { delProject(); } },
    { label: '📂 打开本地目录', action: function() { openFolder(p.localDir); } },
    { label: '📂 打开NAS目录', action: function() { openFolder(p.nasDir); } },
    { label: '📋 复制NAS路径', action: function() { copyText(p.nasDir); } },
    { label: '📋 复制交付信息', action: function() { selectProject(idx); setTimeout(copyDeliveryMsg, 100); } }
  ];
  for (let i = 0; i < actions.length; i++) {
    let o = document.createElement('div');
    o.className = 'so';
    o.textContent = actions[i].label;
    o.onclick = (function(fn) { return function(ev) { ev.stopPropagation(); drop.classList.remove('show'); fn(); }; })(actions[i].action);
    drop.appendChild(o);
  }
  drop.style.left = e.clientX + 'px';
  drop.style.top = e.clientY + 'px';
  drop.classList.add('show');
}

// 点击其他地方关闭状态下拉 + 滚动/缩放时关闭
document.addEventListener('click', function(e) {
  if (!e.target.closest('.item-status')) {
    document.getElementById('statusDrop').classList.remove('show');
  }
});
document.addEventListener('scroll', function() {
  document.getElementById('statusDrop').classList.remove('show');
}, true);
window.addEventListener('resize', function() {
  document.getElementById('statusDrop').classList.remove('show');
});

// ==================== 搜索防抖 ====================
let _searchTimer = null;
function debounceSearch() {
  if (_searchTimer) clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function() { renderProjectList(); }, 200);
}

// ==================== 排序切换 ====================
let _sortBy = 'time'; // 'time' | 'name'
function toggleSort() {
  _sortBy = _sortBy === 'time' ? 'name' : 'time';
  let btn = document.getElementById('sortBtn');
  if (btn) btn.textContent = _sortBy === 'time' ? '🕐' : '🔤';
  renderProjectList();
}

function renderProjectList() {
  const list = $('projectList'), search = ($('searchInput').value || '').toLowerCase();
  list.innerHTML = '';

  // 标签筛选栏
  const existingFilter = document.getElementById('tagFilterBar');
  if (existingFilter && window.Features) {
    window.Features.renderTagFilter(existingFilter);
  }

  // 排序：按创建时间或名称
  const sorted = projects.map(function(p, i) { return { p: p, i: i }; });
  if (_sortBy === 'time') {
    sorted.sort(function(a, b) { return (b.p.createdAt || '').localeCompare(a.p.createdAt || ''); });
  } else {
    sorted.sort(function(a, b) { return a.p.name.localeCompare(b.p.name); });
  }

  const groups = { editing: [], modifying: [], done: [] };
  const tagFilter = window.Features ? window.Features.getTagFilter() : null;
  for (const item of sorted) {
    if (search && item.p.name.toLowerCase().indexOf(search) < 0) continue;
    if (tagFilter && (!item.p._tagObjs || !item.p._tagObjs.some(t => t.id === tagFilter))) continue;
    const g = item.p.status === 'done' ? 'done' : item.p.status === 'modifying' ? 'modifying' : 'editing';
    groups[g].push(item.i);
  }
  const groupConfig = [
    { label: '🔵 剪辑中', key: 'editing' },
    { label: '🟠 修改中', key: 'modifying' },
    { label: '✅ 已完成', key: 'done' }
  ];
  let total = 0, doneTotal = 0;
  for (const cfg of groupConfig) {
    renderGroup(list, cfg, groups[cfg.key]);
    total += groups[cfg.key].length;
    if (cfg.key === 'done') doneTotal = groups[cfg.key].length;
  }
  $('projectCount').textContent = projects.length;
  // 更新统计
  let statEl = document.getElementById('projectStats');
  if (statEl) statEl.textContent = '共 ' + total + ' 个 · ' + doneTotal + ' 已完成';
}

function renderGroup(list, cfg, indices) {
  const h = document.createElement('div');
  h.className = 'cat-label' + (collapsedGroups[cfg.label] ? ' folded' : '');
  h.innerHTML = '<span class="arr">▼</span> ' + cfg.label + ' (' + indices.length + ')';
  h.onclick = function() {
    this.classList.toggle('folded');
    collapsedGroups[cfg.label] = this.classList.contains('folded');
    refreshGroupItems(this);
  };
  list.appendChild(h);

  for (const idx of indices) {
    const p = projects[idx], s = p.status || 'editing';
    const d = document.createElement('div');
    d.className = 'item ' + s + (idx === sel ? ' sel' : '');
    const statusIcon = s === 'done' ? '✅' : s === 'modifying' ? '🟠' : '🔵';
    const statusTitle = s === 'done' ? '已完成' : s === 'modifying' ? '修改中' : '剪辑中';
    d.innerHTML =
      '<input type="checkbox" style="accent-color:#3b82f6;width:13px;height:13px;flex-shrink:0"'
      + (batchSel[p.id] ? ' checked' : '') + ' onclick="toggleBatch(\'' + p.id + '\',event)">'
      + '<span class="item-status">'
      + '<button class="status-btn" title="' + statusTitle + ' · 点击切换" onclick="toggleStatusMenu(event,\'' + p.id + '\',' + idx + ')">' + statusIcon + '</button>'
      + '</span>'
      + esc(p.name);
    d.onclick = (function(i) { return function() { selectProject(i); }; })(idx);
    // 右键菜单
    d.addEventListener('contextmenu', (function(i) {
      return function(e) { e.preventDefault(); showContextMenu(e, i); };
    })(idx));
    list.appendChild(d);
  }
  refreshGroupItems(h);
}

function refreshGroupItems(h) {
  const folded = h.classList.contains('folded');
  let e = h.nextElementSibling;
  while (e && !e.classList.contains('cat-label')) {
    e.style.display = folded ? 'none' : '';
    e = e.nextElementSibling;
  }
}

function selectProject(idx) {
  sel = idx; resolved = null; renderProjectList();
  const rp = $('rightPanel');
  if (idx < 0) { rp.innerHTML = '<div class="empty">请从左侧选择项目，或新建项目</div>'; return; }
  const p = projects[idx];
  rp.innerHTML =
    '<div class="card"><div class="card-hdr">📂 项目目录</div><div class="card-body"><div class="info-row"><span class="lbl">本地</span><span class="val" id="infoLocalDir">' + esc(p.localDir || '-') + '</span></div><div class="info-row"><span class="lbl">NAS</span><span class="val" id="infoNasDir">' + esc(p.nasDir || '-') + '<span id="nasStatus" style="margin-left:8px;font-size:11px"></span></span></div>' + (p.memo ? '<div class="info-row"><span class="lbl">备注</span><span class="val" style="color:#f59e0b">' + esc(p.memo) + '</span></div>' : '') + '</div></div>' +
    '<div class="card"><div class="card-hdr">🔍 关键词目录检测</div><div class="card-body"><div id="detectLocal" style="font-size:12px;color:#94a3b8">扫描中...</div><div id="detectNas" style="font-size:12px;color:#94a3b8">扫描中...</div><div id="detectSummary" style="font-size:12px;margin-top:4px"></div></div></div>' +
    '<div class="act-bar"><button class="btn btn-primary" id="btnOpenLocal">打开本地</button><button class="btn btn-primary" id="btnOpenNas">打开NAS</button><button class="btn btn-outline" id="btnCopyPath">复制NAS路径</button><button class="btn btn-outline" id="btnCopyMsg">复制交付信息</button><button class="btn btn-outline" id="btnTags">🏷️ 标签</button><button class="btn btn-outline" id="btnPreview">🎬 预览</button><button class="btn btn-outline" id="btnRollback">↩️ 回滚</button><button class="btn btn-outline" id="btnTemplate">📋 存模板</button></div>' +
    '<div class="card"><div class="card-hdr">⚠ 待交付文件 <span id="pendingCount" style="margin-left:8px">0</span></div><div class="card-body"><div class="pending-list" id="pendingList"></div><div class="act-bar"><button class="btn btn-sm btn-outline" id="btnRefresh">刷新</button><button class="btn btn-sm btn-outline" id="btnCheckAll">全选</button><button class="btn btn-sm btn-outline" id="btnUncheckAll">取消全选</button><button class="btn btn-sm btn-warn" id="btnCopy">复制选中到NAS</button></div></div></div>' +
    '<div class="card"><div class="card-hdr">🎬 上映单集版 · 修改交付 <span id="modifyCount" style="margin-left:8px">0</span></div><div class="card-body"><div id="modifyInfo" style="font-size:11px;color:#94a3b8">检测中...</div><div id="modifySummary" style="font-size:12px;margin:4px 0"></div><div class="pending-list" id="modifyList"></div><div class="act-bar"><button class="btn btn-sm btn-primary" id="btnModOpenLocal">打开本地</button><button class="btn btn-sm btn-primary" id="btnModOpenNas">打开NAS</button><button class="btn btn-sm btn-outline" id="btnModRefresh">刷新</button><button class="btn btn-sm btn-outline" id="btnModCheckAll">全选</button><button class="btn btn-sm btn-outline" id="btnModUncheckAll">取消全选</button><button class="btn btn-sm btn-outline" id="btnModCopyPath">复制路径</button><button class="btn btn-sm btn-warn" id="btnModCopy">复制选中到NAS</button></div></div></div>' +
    '<div class="card"><div class="card-hdr">📦 000交付 <span id="count000" style="margin-left:8px">0</span></div><div class="card-body"><div id="info000" style="font-size:11px;color:#94a3b8">检测中...</div><div id="summary000" style="font-size:12px;margin:4px 0"></div><div class="pending-list" id="list000"></div><div class="act-bar"><button class="btn btn-sm btn-primary" id="btn000OpenLocal">打开本地</button><button class="btn btn-sm btn-primary" id="btn000OpenNas">打开NAS</button><button class="btn btn-sm btn-outline" id="btn000Refresh">刷新</button><button class="btn btn-sm btn-outline" id="btn000CheckAll">全选</button><button class="btn btn-sm btn-outline" id="btn000UncheckAll">取消全选</button><button class="btn btn-sm btn-outline" id="btn000CopyPath">复制路径</button><button class="btn btn-sm btn-warn" id="btn000Copy">复制选中到NAS</button></div></div></div>' +
    '<div class="card"><div class="card-hdr">📋 运行日志</div><div class="card-body" id="logPanel" style="max-height:200px;overflow-y:auto;font-family:Consolas,monospace;font-size:11px;color:#64748b;padding:8px 12px"><div id="logContent">就绪</div></div></div>' +
    '<div class="card"><div class="card-hdr">📊 集数监控 <span id="monitorBadge" style="margin-left:8px;font-size:11px"></span><button onclick="manualRefreshMonitor()" title="手动刷新" style="margin-left:auto;padding:1px 6px;border:1px solid #475569;border-radius:4px;background:transparent;color:#94a3b8;font-size:11px;cursor:pointer;float:right">🔄</button><button onclick="setEpisodeTarget(sel)" title="快速设置目标集数" style="margin-left:4px;padding:1px 8px;border:1px solid #475569;border-radius:4px;background:transparent;color:#94a3b8;font-size:11px;cursor:pointer;float:right">🎯 设置</button></div><div class="card-body" id="monitorBody" style="font-size:12px;color:#94a3b8">未设置目标集数</div></div>' +
    '<div class="card"><div class="card-hdr">📜 最近交付记录</div><div class="card-body" id="historyContent" style="max-height:180px;overflow-y:auto;padding:4px 8px">加载中...</div></div>';
  bindEvents();
  refreshDetail();
  refreshModify();
  refresh000();
  refreshHistory();
  startAutoMonitor();
  // Electron: 自动开启目录监听
  if (window.electronAPI && window.electronAPI.isElectron && p.localDir) {
    window.electronAPI.sendMessage("stop-all-watch");
    window.electronAPI.sendMessage("start-watch", p.localDir, p.id);
  }
}

function bindEvents() {
  let b = $('btnOpenLocal'); if (b) b.onclick = () => { const p = (resolved && resolved.localEpDir) || (projects[sel] || {}).localDir; if (p) openFolder(p); };
  b = $('btnOpenNas'); if (b) b.onclick = () => { const p = (resolved && resolved.nasEpDir) || (projects[sel] || {}).nasDir; if (p) openFolder(p); };
  b = $('btnCopyPath'); if (b) b.onclick = () => copyText((resolved && resolved.nasEpDir) || projects[sel].nasDir);
  b = $('btnCopyMsg'); if (b) b.onclick = copyDeliveryMsg;
  b = $('btnRefresh'); if (b) b.onclick = refreshPending;
  b = $('btnCheckAll'); if (b) b.onclick = () => checkAll('pendingList', true);
  b = $('btnUncheckAll'); if (b) b.onclick = () => checkAll('pendingList', false);
  b = $('btnCopy'); if (b) b.onclick = copyPending;
  b = $('btnModRefresh'); if (b) b.onclick = refreshModify;
  b = $('btnModCheckAll'); if (b) b.onclick = () => checkAll('modifyList', true);
  b = $('btnModUncheckAll'); if (b) b.onclick = () => checkAll('modifyList', false);
  b = $('btnModCopy'); if (b) b.onclick = copyModifyBatches;
  b = $('btnModCopyPath'); if (b) b.onclick = () => copyCheckedPaths('modifyList', nasDirModify);
  b = $('btnModOpenLocal'); if (b) b.onclick = () => openCheckedDir('modifyList', localDirModify);
  b = $('btnModOpenNas'); if (b) b.onclick = () => openCheckedDir('modifyList', nasDirModify);
  b = $('btn000Refresh'); if (b) b.onclick = refresh000;
  b = $('btn000CheckAll'); if (b) b.onclick = () => checkAll('list000', true);
  b = $('btn000UncheckAll'); if (b) b.onclick = () => checkAll('list000', false);
  b = $('btn000Copy'); if (b) b.onclick = copy000Delivery;
  b = $('btn000CopyPath'); if (b) b.onclick = () => copyText(nasDir000);
  b = $('btn000OpenLocal'); if (b) b.onclick = () => openFolder(localDir000);
  b = $('btn000OpenNas'); if (b) b.onclick = () => openFolder(nasDir000);
  // 新功能按钮
  b = $('btnTags'); if (b) b.onclick = () => { if (window.Features && sel >= 0) window.Features.showTagManager(projects[sel].id); };
  b = $('btnPreview'); if (b) b.onclick = () => { if (window.Features && sel >= 0) window.Features.showFilePreview(projects[sel].id, $('keywordInput').value); };
  b = $('btnRollback'); if (b) b.onclick = () => { if (window.Features && sel >= 0) window.Features.showRollbackHistory(projects[sel].id); };
  b = $('btnTemplate'); if (b) b.onclick = () => { if (window.Features && sel >= 0) window.Features.saveAsTemplate(projects[sel]); };
}

// ==================== 检测 ====================
async function checkNasStatus() {
  const el = $('nasStatus'); if (!el) return;
  if (sel < 0 || !projects[sel].nasDir) { el.innerHTML = ''; return; }
  el.innerHTML = ' 检测中...';
  try {
    const r = await api.get('/api/projects/' + projects[sel].id + '/check-nas');
    if (r.accessible) el.innerHTML = '<span style="color:#22c55e">✓ 可访问</span>';
    else el.innerHTML = '<span style="color:#ef4444">✗ ' + esc(r.error || '不可访问') + '</span>';
  } catch { el.innerHTML = '<span style="color:#ef4444">✗ 检测失败</span>'; }
}

async function refreshDetail() {
  if (sel < 0) return;
  checkNasStatus();
  try {
    const kw = $('keywordInput').value || '项目归档资料';
    resolved = await api.get('/api/projects/' + projects[sel].id + '/detect?keyword=' + encodeURIComponent(kw));
    const dl = $('detectLocal'), dn = $('detectNas'), ds = $('detectSummary');
    if (!resolved.relPath) {
      dl.textContent = '未找到含"' + kw + '"的子目录'; dn.textContent = ''; ds.textContent = '';
    } else {
      dl.innerHTML = esc(resolved.localEpDir) + ' <span style="color:' + (resolved.localExists ? '#22c55e' : '#ef4444') + '">[' + (resolved.localExists ? resolved.localCount + ' 个文件' : '不存在') + ']</span>';
      dn.innerHTML = esc(resolved.nasEpDir) + ' <span style="color:' + (resolved.nasExists ? '#22c55e' : '#94a3b8') + '">[' + (resolved.nasExists ? resolved.nasCount + ' 个文件' : '不存在') + ']</span>';
      const d = resolved.localCount - resolved.nasCount;
      if (d > 0) ds.innerHTML = '<span style="color:#f59e0b">⚠ 本地比NAS多 ' + d + ' 个文件</span>';
      else if (resolved.localExists && resolved.nasExists) ds.innerHTML = '<span style="color:#22c55e">✓ 文件一致</span>';
    }
    refreshPending();
  } catch (e) { const x = $('detectLocal'); if (x) x.textContent = '检测失败'; }
}

async function refreshPending() {
  const list = $('pendingList'); if (!list) return;
  list.innerHTML = '';
  if (!resolved || !resolved.relPath || !resolved.localExists) return;
  const data = await api.get('/api/projects/' + projects[sel].id + '/pending?keyword=' + encodeURIComponent($('keywordInput').value || '项目归档资料'));
  const files = data.files || [];
  let countLabel = files.length + ' 个';
  // 顺便取 monitor 数据展示缺集信息
  try {
    const mon = await api.get('/api/projects/' + projects[sel].id + '/monitor');
    if (mon.archiveMissing && mon.archiveMissing.hasMissing) {
      let ranges = mon.archiveMissing.ranges || [];
      let tip = ranges.length <= 6 ? ranges.join(', ') : ranges.slice(0, 5).join(', ') + '…';
      countLabel += ' <span style="color:#f97316;font-size:11px;font-weight:400">少' + mon.archiveMissing.missingCount + '集：' + tip + '</span>';
    }
  } catch(e) {}
  $('pendingCount').innerHTML = countLabel;
  if (!files.length) { list.innerHTML = '<div class="empty">没有待交付文件</div>'; return; }
  for (const f of files) {
    const d = document.createElement('div'); d.className = 'pi';
    d.innerHTML = '<input type="checkbox" checked><span>' + esc(f) + '</span>'; list.appendChild(d);
  }
}

async function copyPending() {
  const files = getCheckedNames('pendingList');
  if (!files.length) { alert('请先勾选'); return; }
  startProgress('复制文件', files.length);
  try {
    const r = await api.post('/api/projects/' + projects[sel].id + '/copy', {
      fileNames: files,
      keyword: $('keywordInput').value || '项目归档资料'
    });
    await pollJob(r.jobId);
    refreshDetail();
  } catch (e) { addLog('✗ 复制请求失败: ' + e.message); finishProgress('error', e.message); }
}

// ==================== 修改交付 ====================
async function refreshModify() {
  if (sel < 0) return;
  try {
    const data = await api.get('/api/projects/' + projects[sel].id + '/modify-batches?keyword=' + encodeURIComponent('上映单集版'));
    const mi = $('modifyInfo'), ms = $('modifySummary'), ml = $('modifyList'), mc = $('modifyCount');
    if (!mi) return;
    if (!data.found) { mi.textContent = '未找到"上映单集版"目录'; return; }
    mi.textContent = '本地: ' + data.localKwDir + '\nNAS: ' + data.nasKwDir;
    const batches = data.batches || [];
    let nc = 0;
    ml.innerHTML = '';
    for (const b of batches) {
      const d = document.createElement('div'); d.className = 'pi';
      const chk = checkedModify[b.name] ? true : !b.nasExists;
      d.innerHTML = '<input type="checkbox" ' + (chk ? 'checked' : '') + '><span>' + esc(b.name) + ' (' + b.localFileCount + '个) ' + (b.nasExists ? '[已交付]' : '[待交付]') + '</span>';
      ml.appendChild(d);
      if (!b.nasExists) nc++;
    }
    mc.textContent = nc + ' 待交付';
    ms.innerHTML = nc > 0 ? '<span style="color:#f59e0b">' + nc + ' 个批次待交付</span>' : '<span style="color:#22c55e">全部已交付</span>';
    nasDirModify = data.nasKwDir || '';
    localDirModify = data.localKwDir || '';
  } catch (e) { const el = $('modifyInfo'); if (el) el.textContent = '检测失败: ' + e.message; }
}

async function copyModifyBatches() {
  const names = getCheckedNames('modifyList');
  if (!names.length) { alert('请先勾选'); return; }
  for (const n of names) checkedModify[n] = true;
  startProgress('上映单集版交付', names.length);
  try {
    const r = await api.post('/api/projects/' + projects[sel].id + '/modify-copy-batch', { batchNames: names, keyword: '上映单集版' });
    await pollJob(r.jobId);
    refreshModify();
  } catch (e) { addLog('✗ 批量复制失败: ' + e.message); finishProgress('error', e.message); }
}

// ==================== 弹窗：项目 ====================
function showProjectDlg(editIdx) {
  const p = editIdx >= 0 ? projects[editIdx] : { name: '', localDir: '', nasDir: '', memo: '', status: 'editing' };
  const s = p.status || 'editing';
  let h = '';
  // 新建模式时显示模板选择
  if (editIdx < 0) {
    h += '<div class="fg" style="display:flex;gap:6px;align-items:center"><button class="btn btn-sm btn-accent" onclick="window.Features.showTemplatePicker(\'applyTemplateToDialog\')">📋 从模板创建</button><span style="font-size:11px;color:var(--text-muted)">或手动填写下方信息</span></div>';
  }
  h += '<div class="fg"><label>项目名称</label><input id="dlgName" value="' + escAttr(p.name) + '"></div>';
  h += '<div class="fg"><label>本地根目录</label><div class="ir"><input id="dlgLocal" value="' + escAttr(p.localDir) + '"><button class="btn btn-sm btn-outline" onclick="pickFolder(\'dlgLocal\')">浏览</button></div></div>';
  h += '<div class="fg"><label>NAS根目录</label><div class="ir"><input id="dlgNas" value="' + escAttr(p.nasDir) + '"><button class="btn btn-sm btn-outline" onclick="pickFolder(\'dlgNas\')">浏览</button></div></div>';
  h += '<div class="fg"><label>备注</label><textarea id="dlgMemo" style="width:100%;height:60px;border:1px solid #e2e8f0;border-radius:7px;padding:8px 12px;font-size:13px;outline:none;resize:vertical" placeholder="添加备注信息...">' + esc(p.memo || '') + '</textarea></div>';
  h += '<div class="fg"><label>目标集数（0=不监控）</label><input id="dlgEpisodeTarget" value="' + (p.episodeTarget || '') + '" type="number" min="0" placeholder="设定总集数"></div>';
  h += '<div class="fg"><label>集数分配 <span style="font-size:10px;color:#94a3b8">（人员 + 负责集数区间）</span></label><div id="dlgAssignList"></div><div style="display:flex;gap:4px;margin-top:4px"><button class="btn btn-sm btn-outline" onclick="addEpisodeAssign()">+ 添加人员</button></div><textarea id="dlgAssignPaste" placeholder="或直接粘贴格式：&#10;杨永芳：1-2，69-70&#10;程梦：3-4, 67-68&#10;张靖杰：5-6,65-66" style="width:100%;height:80px;margin-top:6px;padding:8px 10px;border:1px solid #475569;border-radius:7px;background:#1e293b;color:#e2e8f0;font-size:12px;resize:vertical;outline:none;font-family:Microsoft YaHei,sans-serif"></textarea><button class="btn btn-sm btn-accent" onclick="parseAssignPaste()" style="margin-top:4px">📋 解析粘贴内容</button></div>';
  h += '<div class="fg"><label>状态</label><select id="dlgStatus"><option value="editing"' + (s === 'editing' ? ' selected' : '') + '>🔵 剪辑中</option><option value="modifying"' + (s === 'modifying' ? ' selected' : '') + '>🟠 修改中</option><option value="done"' + (s === 'done' ? ' selected' : '') + '>✅ 已完成</option></select></div>';
  h += '<div class="modal-btns"><button class="btn btn-primary" onclick="saveProject(' + editIdx + ')">保存</button><button class="btn btn-outline" onclick="closeModal()">取消</button></div>';
  $('modalTitle').textContent = editIdx >= 0 ? '编辑项目' : '新建项目';
  $('modalBody').innerHTML = h;
  $('modalOverlay').style.display = 'flex';
  // 注入文件夹历史下拉
  ensureFolderDatalist('dlgLocal'); refreshFolderDatalist('dlgLocal');
  ensureFolderDatalist('dlgNas'); refreshFolderDatalist('dlgNas');
  // 初始化已有集数分配
  let assigns = p.episodeAssignments || [];
  for (let ai = 0; ai < assigns.length; ai++) {
    addEpisodeAssign(assigns[ai].name, assigns[ai].start, assigns[ai].end);
  }
}

async function saveProject(editIdx) {
  const data = {
    name: $('dlgName').value.trim(),
    localDir: $('dlgLocal').value.trim(),
    nasDir: $('dlgNas').value.trim(),
    memo: $('dlgMemo') ? $('dlgMemo').value.trim() : '',
    episodeTarget: parseInt($('dlgEpisodeTarget').value) || 0,
    episodeAssignments: collectEpisodeAssignments(),
    status: $('dlgStatus').value
  };
  if (!data.name) { alert('请输入名称'); return; }
  let savedId;
  if (editIdx >= 0) {
    savedId = projects[editIdx].id;
    await api.put('/api/projects/' + savedId, data);
  } else {
    const r = await api.post('/api/projects', data);
    savedId = r.project ? r.project.id : null;
  }
  closeModal(); projects = await api.get('/api/projects');
  renderProjectList();
  // 通过 ID 重新定位项目（避免数组顺序变化导致选错）
  const newIdx = projects.findIndex(function(p) { return p.id === savedId; });
  selectProject(newIdx >= 0 ? newIdx : projects.length - 1);
}




function collectEpisodeAssignments() {
  let rows = document.querySelectorAll('#dlgAssignList .assign-row');
  let list = [];
  rows.forEach(function(r) {
    let name = (r.querySelector('.assign-name') || {}).value || '';
    let start = parseInt((r.querySelector('.assign-start') || {}).value) || 0;
    let end = parseInt((r.querySelector('.assign-end') || {}).value) || 0;
    if (name && start > 0 && end >= start) list.push({ name: name, start: start, end: end });
  });
  return list;
}

function addEpisodeAssign(name, start, end) {
  let list = document.getElementById('dlgAssignList'); if (!list) return;
  let div = document.createElement('div');
  div.className = 'assign-row';
  div.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:4px';
  div.innerHTML = '<input class="assign-name" placeholder="剪辑人员" value="' + escAttr(name||'') + '" style="flex:2;border:1px solid #475569;border-radius:5px;background:#1e293b;color:#e2e8f0;padding:4px 8px;font-size:12px;outline:none">' +
    '<span style="font-size:11px;color:#94a3b8">第</span><input class="assign-start" type="number" min="1" placeholder="1" value="' + (start||'') + '" style="width:55px;border:1px solid #475569;border-radius:5px;background:#1e293b;color:#e2e8f0;padding:4px 6px;font-size:12px;outline:none">' +
    '<span style="font-size:11px;color:#94a3b8">~</span><input class="assign-end" type="number" min="1" placeholder="70" value="' + (end||'') + '" style="width:55px;border:1px solid #475569;border-radius:5px;background:#1e293b;color:#e2e8f0;padding:4px 6px;font-size:12px;outline:none" oninput="syncEpisodeTargetFromAssignments()">' +
    '<span style="font-size:11px;color:#94a3b8">集</span>' +
    '<button onclick="this.parentElement.remove()" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;line-height:1">&times;</button>';
  list.appendChild(div);
  // 每次添加（含初始化）后自动更新目标集数
  syncEpisodeTargetFromAssignments();
}

// 从分配信息中提取最大集数，自动填入目标集数
function syncEpisodeTargetFromAssignments() {
  let rows = document.querySelectorAll('#dlgAssignList .assign-row');
  let maxEp = 0;
  rows.forEach(function(r) {
    let e = parseInt((r.querySelector('.assign-end') || {}).value) || 0;
    if (e > maxEp) maxEp = e;
  });
  if (maxEp > 0) {
    let targetEl = document.getElementById('dlgEpisodeTarget');
    if (targetEl && (!targetEl.value || parseInt(targetEl.value) < maxEp)) {
      targetEl.value = maxEp;
      targetEl.style.borderColor = '#22c55e';
      setTimeout(function() { targetEl.style.borderColor = ''; }, 1500);
    }
  }
}

// 解析粘贴的集数分配文本
// 格式："杨永芳：1-2，69-70\n程梦：3-4, 67-68"
function parseAssignPaste() {
  let el = document.getElementById('dlgAssignPaste'); if (!el) return;
  let raw = el.value.trim(); if (!raw) { toast('请先粘贴内容', 'warn'); return; }
  // 清空已有
  let list = document.getElementById('dlgAssignList');
  list.innerHTML = '';
  // 按行分割
  let lines = raw.split(/[\n\r]+/).filter(function(l) { return l.trim(); });
  let count = 0;
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li].trim();
    // 分割 人名：后面的部分
    let colonIdx = line.indexOf('：');
    if (colonIdx < 0) colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    let name = line.substring(0, colonIdx).trim();
    let rest = line.substring(colonIdx + 1).trim();
    if (!name || !rest) continue;
    // 解析集数区间：1-2，69-70 或 5-6,65-66
    let segs = rest.split(/[,，、]/);
    for (let si = 0; si < segs.length; si++) {
      let seg = segs[si].trim().replace(/[（(第]\s*第?/g, '').replace(/[\s集）/]/g, '');
      let dash = seg.indexOf('-');
      if (dash < 0) { dash = seg.indexOf('—'); }
      if (dash < 0) { dash = seg.indexOf('~'); }
      if (dash < 0) { dash = seg.indexOf('到'); }
      if (dash < 0) {
        // 单集：纯数字
        let n = parseInt(seg);
        if (!isNaN(n)) { addEpisodeAssign(name, n, n); count++; }
        continue;
      }
      let s = parseInt(seg.substring(0, dash));
      let e = parseInt(seg.substring(dash + 1));
      if (!isNaN(s) && !isNaN(e)) {
        addEpisodeAssign(name, Math.min(s, e), Math.max(s, e));
        count++;
      }
    }
  }
  if (count > 0) {
    toast('已识别 ' + lines.length + ' 人，' + count + ' 个区间', 'success');
    el.value = '';
    syncEpisodeTargetFromAssignments();
  } else {
    toast('未识别到有效格式', 'error');
  }
}

async function delProject() {
  if (sel < 0) return;
  if (!confirm('确定删除「' + projects[sel].name + '」？')) return;
  await api.del('/api/projects/' + projects[sel].id);
  projects = await api.get('/api/projects');
  if (sel >= projects.length) sel = projects.length - 1;
  renderProjectList(); selectProject(sel);
}

// ==================== 快速设置目标集数 ====================
async function setEpisodeTarget(idx) {
  if (idx < 0 || idx >= projects.length) return;
  let cur = projects[idx].episodeTarget || '';
  let val = prompt('请输入目标集数（当前：' + (cur || '未设置') + '）\n设定后集数监控卡片将实时追踪交付进度', cur);
  if (val === null) return;
  let num = parseInt(val);
  if (isNaN(num) || num < 0) { alert('请输入有效数字'); return; }
  await api.put('/api/projects/' + projects[idx].id, { episodeTarget: num, name: projects[idx].name });
  projects = await api.get('/api/projects');
  renderProjectList();
  selectProject(idx);
  toast('目标集数已设为 ' + num + ' 集', 'success');
}

// ==================== 弹窗：批量导入 ====================
function showImportDlg() {
  let h = '<div class="fg"><label>本地根目录</label><div class="ir"><input id="dlgImportRoot"><button class="btn btn-sm btn-outline" onclick="pickFolder(\'dlgImportRoot\')">浏览</button></div></div>';
  h += '<div class="fg"><label>部门模板</label><div id="dlgTplList"></div><button class="btn btn-sm btn-outline" onclick="addTpl()">+ 添加</button></div>';
  h += '<div style="margin:8px 0"><button class="btn btn-primary" onclick="doScan()">扫描子文件夹</button> <span id="dlgScanInfo" style="color:#94a3b8;font-size:12px"></span></div>';
  h += '<div id="dlgScanResult" style="max-height:260px;overflow:auto"></div>';
  h += '<div class="modal-btns"><button class="btn btn-accent" onclick="doImport()">导入选中</button><button class="btn btn-outline" onclick="closeModal()">关闭</button></div>';
  $('modalTitle').textContent = '批量导入项目';
  $('modalBody').innerHTML = h;
  $('modalOverlay').style.display = 'flex';
  // 注入文件夹历史下拉
  ensureFolderDatalist('dlgImportRoot'); refreshFolderDatalist('dlgImportRoot');
  const tpls = settings.templates || [];
  window._tplIdx = tpls.length;
  for (let i = 0; i < tpls.length; i++) addTplRow(tpls[i].name, tpls[i].path, i);
}

window._tplIdx = 0;
function addTpl() { addTplRow('', '', window._tplIdx++); }
function addTplRow(name, pathVal, idx) {
  const c = $('dlgTplList'), d = document.createElement('div'); d.className = 'ir'; d.style.marginBottom = '4px';
  const pid = 'tplPath_' + idx;
  d.innerHTML = '<input class="tpl-name" value="' + escAttr(name) + '" placeholder="部门名" style="width:80px"><input class="tpl-path" id="' + pid + '" value="' + escAttr(pathVal) + '" placeholder="NAS路径" style="flex:1"><button class="btn btn-sm btn-outline" onclick="pickFolder(\'' + pid + '\')">浏览</button><button class="btn btn-sm btn-outline" onclick="this.parentElement.remove()">✕</button>';
  c.appendChild(d);
  // 为新模板路径注入历史下拉
  ensureFolderDatalist(pid); refreshFolderDatalist(pid);
}

async function doScan() {
  scanResults = []; $('dlgScanResult').innerHTML = '';
  const root = $('dlgImportRoot').value.trim(); if (!root) { alert('请输入本地根目录'); return; }
  // 保存模板
  const ns = document.querySelectorAll('#dlgTplList .tpl-name'), ps = document.querySelectorAll('#dlgTplList .tpl-path');
  const tpls = []; for (let i = 0; i < ns.length; i++) tpls.push({ name: ns[i].value.trim(), path: ps[i].value.trim() });
  await api.put('/api/import/templates', { templates: tpls }); settings.templates = tpls;
  // 扫描
  const r = await api.post('/api/import/scan', { localRoot: root });
  if (r.error) { alert(r.error); return; }
  scanResults = r.candidates || [];
  $('dlgScanInfo').textContent = '可导入 ' + scanResults.length + ' 个';
  for (const sr of scanResults) {
    const d = document.createElement('div'); d.className = 'pi';
    d.innerHTML = '<input type="checkbox" checked><span>' + esc(sr.name) + ' <span style="color:#94a3b8;font-size:11px">' + esc(sr.localDir) + '</span></span>';
    $('dlgScanResult').appendChild(d);
  }
}

async function doImport() {
  const items = []; const cbs = document.querySelectorAll('#dlgScanResult input[type=checkbox]');
  for (let i = 0; i < scanResults.length && i < cbs.length; i++) {
    if (cbs[i].checked) items.push({ name: scanResults[i].name, localDir: scanResults[i].localDir });
  }
  if (!items.length) { alert('请先勾选'); return; }
  const r = await api.post('/api/import/batch', { items });
  if (r.success) { alert('成功导入 ' + r.added + ' 个'); closeModal(); projects = await api.get('/api/projects'); renderProjectList(); }
}

// ==================== 000交付 ====================
async function refresh000() {
  if (sel < 0) return;
  try {
    const data = await api.get('/api/projects/' + projects[sel].id + '/modify-batches?keyword=' + encodeURIComponent('000交付'));
    const mi = $('info000'), ms = $('summary000'), ml = $('list000'), mc = $('count000');
    if (!mi) return;
    if (!data.found) { mi.textContent = '未找到"000交付"目录'; return; }
    mi.textContent = '本地: ' + data.localKwDir + '\nNAS: ' + data.nasKwDir;
    const batches = data.batches || [];
    let nc = 0;
    ml.innerHTML = '';
    for (const b of batches) {
      const d = document.createElement('div'); d.className = 'pi';
      const chk = checked000[b.name] ? true : !b.nasExists;
      d.innerHTML = '<input type="checkbox" ' + (chk ? 'checked' : '') + '><span>' + esc(b.name) + ' (' + b.localFileCount + '个) ' + (b.nasExists ? '[已交付]' : '[待交付]') + '</span>';
      ml.appendChild(d);
      if (!b.nasExists) nc++;
    }
    mc.textContent = nc + ' 待交付';
    ms.innerHTML = nc > 0 ? '<span style="color:#f59e0b">' + nc + ' 个文件夹待交付</span>' : '<span style="color:#22c55e">全部已交付</span>';
    nasDir000 = data.nasKwDir || '';
    localDir000 = data.localKwDir || '';
  } catch (e) { const el = $('info000'); if (el) el.textContent = '检测失败: ' + e.message; }
}

async function copy000Delivery() {
  const names = getCheckedNames('list000');
  if (!names.length) { alert('请先勾选'); return; }
  for (const n of names) checked000[n] = true;
  startProgress('000交付', names.length);
  try {
    const r = await api.post('/api/projects/' + projects[sel].id + '/modify-copy-batch', { batchNames: names, keyword: '000交付' });
    await pollJob(r.jobId);
    // 复制成功后改状态
    const job = await api.get('/api/jobs/' + r.jobId);
    if (job.completed > 0) {
      await api.put('/api/projects/' + projects[sel].id + '/status', { status: 'done' });
      projects = await api.get('/api/projects');
      renderProjectList();
      addLog('📌 项目状态已更新为「已完成」');
      toast('项目已移至「已完成」分组', 'success');
    }
    refresh000();
  } catch (e) { addLog('✗ 000交付失败: ' + e.message); finishProgress('error', e.message); }
}

// ==================== 进度条系统（重新设计：文件级列表 + 实时速度 + ETA + SSE驱动）====================
let _currentJobId = null;
let _pollTimer = null;
let _fsProgressBytes = 0;
let _jobStartTime = Date.now();
let _progFileListVisible = false;
let _progFileLog = []; // 记录每个文件的处理状态

function formatBytes(b) { return b >= 1073741824 ? (b/1073741824).toFixed(1)+'GB' : b>=1048576 ? (b/1048576).toFixed(1)+'MB' : b>=1024 ? (b/1024).toFixed(1)+'KB' : b+'B'; }
function formatETA(sec) { if (sec<=0) return ''; let m=Math.floor(sec/60),s=Math.floor(sec%60); return (m>0?m+'分':'')+s+'秒'; }

function startProgress(title, total) {
  _currentJobId = null;
  _progFileLog = [];
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  _jobStartTime = Date.now();
  let panel = document.getElementById('progressPanel');
  document.getElementById('progTitle').textContent = title;
  document.getElementById('progFill').style.width = '0%';
  document.getElementById('progPct').textContent = '0%';
  document.getElementById('progFile').textContent = '待启动';
  document.getElementById('progSpeed').textContent = '';
  document.getElementById('progETA').textContent = '';
  document.getElementById('progStats').textContent = '';
  document.getElementById('progFileList').innerHTML = '';
  document.getElementById('progBarWrap').className = 'prog-bar';
  panel.classList.add('show');
}

function toggleProgFileList() {
  _progFileListVisible = !_progFileListVisible;
  document.getElementById('progFileList').style.display = _progFileListVisible ? 'block' : 'none';
}

function renderProgFileList() {
  const list = document.getElementById('progFileList');
  if (!list) return;
  // 只显示最近的 50 条
  const items = _progFileLog.slice(-50);
  list.innerHTML = items.map(f => {
    const icon = f.status === 'ok' ? '✓' : f.status === 'skip' ? '⏭' : f.status === 'fail' ? '✗' : '→';
    const cls = f.status === 'current' ? 'current' : f.status;
    return `<div class="fi ${cls}"><span class="fi-icon">${icon}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span></div>`;
  }).join('');
  // 滚到底部
  list.scrollTop = list.scrollHeight;
}

function updateProgressUI(job) {
  let pct = job.totalItems > 0 ? Math.round(job.current / job.totalItems * 100) : 0;
  document.getElementById('progFill').style.width = pct + '%';
  document.getElementById('progPct').textContent = pct + '%';

  let item = job.currentItem || {};
  document.getElementById('progFile').textContent = (item.name || '...') + ' ' + (job.current || 0) + '/' + job.totalItems;

  // 记录文件状态
  if (item.name && item.status) {
    const lastEntry = _progFileLog[_progFileLog.length - 1];
    if (!lastEntry || lastEntry.name !== item.name || lastEntry.status !== item.status) {
      _progFileLog.push({ name: item.name, status: item.status });
      if (_progFileListVisible) renderProgFileList();
    }
  }

  // 速度 + ETA
  let elapsed = job.elapsed || (Date.now() - _jobStartTime);
  let speedText = '', etaText = '';
  if (elapsed > 500 && job.totalBytes > 0) {
    let mb = job.totalBytes / 1048576, sec = elapsed / 1000;
    speedText = (mb/sec).toFixed(1) + ' MB/s';
  }
  if (job.current > 0 && job.status === 'running') {
    let avgMs = elapsed / job.current;
    let remain = avgMs * (job.totalItems - job.current);
    etaText = formatETA(remain / 1000);
  }
  document.getElementById('progSpeed').textContent = speedText;
  document.getElementById('progETA').textContent = etaText;

  // 状态栏
  let stats = job.completed + ' ✓';
  if (job.skipped > 0) stats += ' · ' + job.skipped + ' ⏭';
  if (job.failed > 0) stats += ' · ' + job.failed + ' ✗';
  document.getElementById('progStats').textContent = stats;

  // 进度条状态样式
  let barWrap = document.getElementById('progBarWrap');
  if (job.status === 'done') {
    barWrap.className = 'prog-bar done';
    document.getElementById('progTitle').textContent = '✅ ' + job.projectName + ' 完成';
    document.getElementById('progETA').textContent = '用时 ' + formatETA(elapsed/1000);
    document.getElementById('jobIndicator').style.display = 'none';
    if (job.nasDir) { copyText(job.nasDir); toast('✅ 完成！NAS路径已复制', 'success'); }
    setTimeout(function() { document.getElementById('progressPanel').classList.remove('show'); }, 4000);
  } else if (job.status === 'cancelled') {
    barWrap.className = 'prog-bar';
    document.getElementById('progTitle').textContent = '⏸ 已取消';
    document.getElementById('jobIndicator').style.display = 'none';
    setTimeout(function() { document.getElementById('progressPanel').classList.remove('show'); }, 2000);
  } else if (job.status === 'error') {
    barWrap.className = 'prog-bar error';
    document.getElementById('progTitle').textContent = '❌ 出错';
    document.getElementById('jobIndicator').style.display = 'none';
  } else {
    barWrap.className = 'prog-bar';
    document.getElementById('progTitle').textContent = '📁 ' + job.projectName + ' · ' + job.type;
    document.getElementById('jobIndicator').style.display = 'flex';
    document.getElementById('jobIndicatorText').textContent = pct + '%';
  }
}

async function pollJob(jobId) {
  _currentJobId = jobId;
  if (_pollTimer) clearInterval(_pollTimer);
  _jobStartTime = Date.now();

  return new Promise(function(resolve) {
    _pollTimer = setInterval(async function() {
      try {
        let job = await api.get('/api/jobs/' + jobId);
        updateProgressUI(job);

        if (job.status === 'done' || job.status === 'cancelled' || job.status === 'error') {
          clearInterval(_pollTimer); _pollTimer = null; _currentJobId = null;
          document.getElementById('jobIndicator').style.display = 'none';
          let extra = '';
          if (job.status === 'done') { extra = '成功' + job.completed + (job.skipped>0?'/跳过'+job.skipped:'') + (job.failed>0?'/失败'+job.failed:''); addLog('✅ 完成：' + extra); }
          else if (job.status === 'cancelled') { addLog('⏸ 已取消'); }
          else { addLog('❌ 出错：' + (job.error||'')); }
          resolve(job);
        }
      } catch (e) { /* 继续 */ }
    }, 300);
  });
}

function finishProgress(status, msg) {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  _currentJobId = null;
  document.getElementById('jobIndicator').style.display = 'none';
  document.getElementById('progTitle').textContent = '❌ ' + (msg || '失败');
  setTimeout(function() { document.getElementById('progressPanel').classList.remove('show'); }, 3000);
}

function cancelCurrentJob() {
  if (!_currentJobId) return;
  if (!confirm('确定取消？已完成部分保留。')) return;
  api.post('/api/jobs/' + _currentJobId + '/cancel', {});
}

function hideProgress() {
  document.getElementById('progressPanel').classList.remove('show');
  if (_currentJobId) toast('任务在后台继续，点击 ⏳ 查看进度', 'info');
}

// ==================== 后台任务面板 ====================
let _dashboardTimer = null;

function showDashboard() {
  let panel = document.getElementById('dashboardPanel');
  if (panel.classList.contains('show')) { panel.classList.remove('show'); if (_dashboardTimer) clearInterval(_dashboardTimer); return; }
  panel.classList.add('show');
  refreshDashboard();
  _dashboardTimer = setInterval(refreshDashboard, 1500);
}

async function refreshDashboard() {
  try {
    let jobs = await api.get('/api/jobs');
    let el = document.getElementById('dashboardBody');
    if (!el) return;
    if (!jobs.length) { el.innerHTML = '<div style="color:#94a3b8;font-size:12px;padding:8px">暂无后台任务</div>'; return; }
    let html = '';
    for (let j of jobs) {
      let pct = j.totalItems > 0 ? Math.round(j.current/j.totalItems*100) : 0;
      let elapsed = j.elapsed ? formatETA(j.elapsed/1000) : '';
      let bg = j.status==='done'?'#22c55e':j.status==='cancelled'?'#94a3b8':j.status==='error'?'#ef4444':'#3b82f6';
      html += '<div style="margin-bottom:8px;border-bottom:1px solid #334155;padding-bottom:6px">' +
        '<div style="display:flex;justify-content:space-between"><strong style="font-size:12px;color:#e2e8f0">' + esc(j.projectName||'') + '</strong><span style="font-size:10px;color:#94a3b8">' + esc(j.type) + '</span></div>' +
        '<div style="font-size:11px;color:#94a3b8">' + j.current + '/' + j.totalItems + ' · ' + j.completed + '✓ ' + (j.skipped>0?j.skipped+'跳过 ':'') + (j.failed>0?j.failed+'✗ ':'') + '</div>' +
        '<div style="background:#334155;border-radius:2px;height:3px;margin:3px 0"><div style="background:'+bg+';width:'+pct+'%;height:100%;border-radius:2px"></div></div>' +
        '<div style="font-size:10px;color:#64748b">' + pct + '% · ' + elapsed + '</div>' +
        (j.status==='error'?'<div style="font-size:10px;color:#ef4444">' + esc(j.error||'') + '</div>':'') +
        '</div>';
    }
    el.innerHTML = html;
    let badge = document.getElementById('dashboardBadge');
    if (badge) { let active = jobs.filter(function(j){return j.status==='running'}).length; badge.textContent = active>0?active:''; badge.style.display = active>0?'inline':'none'; }
  } catch(e) {}
}

// 点击标题栏任务指示器打开后台面板
document.addEventListener('DOMContentLoaded', function() {
  let ji = document.getElementById('jobIndicator');
  if (ji) ji.onclick = showDashboard;
});

// ==================== 刷新/切换警告 ====================
window.addEventListener('beforeunload', function(e) {
  if (_currentJobId) {
    e.preventDefault();
    e.returnValue = '有复制任务正在进行中！刷新或关闭页面会中断任务。';
    return e.returnValue;
  }
});

// selectProject 时检测后台任务
const _origSelectProject = selectProject;
selectProject = function(idx) {
  if (_currentJobId && idx !== sel) {
    if (!confirm('⏳ 后台任务正在进行中！\n\n切换项目不会中断后台复制任务，但右侧面板会变为新项目内容。\n点击标题栏的 ⏳ 指示器可以随时查看进度。\n\n确定要切换吗？')) return;
  }
  return _origSelectProject(idx);
};

// ==================== 交付历史 ====================
async function refreshHistory() {
  try {
    const logs = await api.get('/api/delivery-log?limit=20');
    const hc = $('historyContent'); if (!hc) return;
    if (!logs.length) { hc.innerHTML = '<div style="color:#94a3b8;font-size:11px">暂无记录</div>'; return; }
    hc.innerHTML = logs.map(l => {
      const t = new Date(l.time).toLocaleString('zh-CN');
      return '<div style="padding:2px 0;border-bottom:1px solid #f1f5f9;font-size:11px">' +
        '<span style="color:#64748b">' + t + '</span> ' +
        '<span style="color:#3b82f6">' + esc(l.projectName) + '</span> ' +
        esc(l.action) + ' ' +
        '<span style="color:' + (l.fail > 0 ? '#ef4444' : '#22c55e') + '">✓' + l.ok + '</span>' +
        (l.fail > 0 ? ' <span style="color:#ef4444">✗' + l.fail + '</span>' : '') +
        '</div>';
    }).join('');
  } catch { /* 静默处理 */ }
}

// ==================== 文件夹浏览（系统原生 Shell 对话框） ====================

try { _folderHistory = JSON.parse(localStorage.getItem('pam-folder-history') || '[]'); } catch(e) { _folderHistory = []; }

function saveFolderHistory(pathVal) {
  if (!pathVal || _folderHistory.includes(pathVal)) return;
  _folderHistory.unshift(pathVal);
  if (_folderHistory.length > 10) _folderHistory.length = 10;
  localStorage.setItem('pam-folder-history', JSON.stringify(_folderHistory));
}

// 为输入框添加历史 datalist（每个输入框一个，id = inputId + '_hist'）
function ensureFolderDatalist(inputId) {
  let input = document.getElementById(inputId);
  if (!input) return;
  let listId = inputId + '_hist';
  if (document.getElementById(listId)) return;
  let dl = document.createElement('datalist');
  dl.id = listId;
  document.body.appendChild(dl);
  input.setAttribute('list', listId);
}

function refreshFolderDatalist(inputId) {
  let listId = inputId + '_hist';
  let dl = document.getElementById(listId);
  if (!dl) return;
  dl.innerHTML = '';
  for (let i = 0; i < _folderHistory.length; i++) {
    let opt = document.createElement('option');
    opt.value = _folderHistory[i];
    dl.appendChild(opt);
  }
}

async function pickFolder(inputId) {
  try {
    let r;
    // Electron 环境：用原生对话框（稳定、不依赖 VBS）
    if (window.electronAPI && window.electronAPI.isElectron) {
      r = await window.electronAPI.pickFolder();
    } else {
      r = await api.post('/api/pick-folder', {});
    }
    if (r.success && r.path) {
      let el = document.getElementById(inputId);
      if (el) el.value = r.path;
      saveFolderHistory(r.path);
      refreshFolderDatalist(inputId);
    } else if (r.error) {
      toast('选择失败: ' + r.error, 'error');
    }
  } catch (er) {
    toast('选择失败: ' + (er.message || '未知错误'), 'error');
  }
}

// Electron 原生打开文件夹（稳定，不依赖 explorer.exe 命令行解析）
async function openFolder(dirPath) {
  if (!dirPath) return;
  if (window.electronAPI && window.electronAPI.isElectron) {
    await window.electronAPI.openExplorer(dirPath);
  } else {
    await api.post('/api/open-explorer', { path: dirPath });
  }
}

function copyCheckedPaths(listId, baseDir) {
  const names = getCheckedNames(listId);
  const paths = names.length ? names.map(n => baseDir + '\\' + n) : [baseDir];
  copyText(paths.join('\n'));
}

function openCheckedDir(listId, baseDir) {
  const names = getCheckedNames(listId);
  let dirs;
  if (names.length) {
    dirs = names.map(n => baseDir + '\\' + n);
  } else if (baseDir) {
    dirs = [baseDir];
  } else {
    return; // 无可用路径
  }
  for (const d of dirs) {
    if (d) openFolder(d);
  }
}

function copyDeliveryMsg() {
  if (sel < 0) return;
  const pathVal = (resolved && resolved.nasEpDir) || projects[sel].nasDir;
  const cnt = (resolved && resolved.nasCount) || 0;
  const d = new Date(), ds = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  copyText('交付通知：\n项目：' + projects[sel].name + '\n路径：' + pathVal + ' (' + cnt + ' 个)\n时间：' + ds);
}

function applyKeyword() {
  settings.keyword = $('keywordInput').value;
  api.put('/api/settings', { keyword: settings.keyword });
  refreshDetail();
}

// 从模板填充项目对话框
function applyTemplateToDialog(cfg) {
  if (!cfg) return;
  const set = (id, val) => { const el = $(id); if (el && val != null) el.value = val; };
  set('dlgLocal', cfg.localDir);
  set('dlgNas', cfg.nasDir);
  set('dlgMemo', cfg.memo);
  set('dlgEpisodeTarget', cfg.episodeTarget);
  if (cfg.episodeAssignments && cfg.episodeAssignments.length) {
    const list = document.getElementById('dlgAssignList');
    if (list) list.innerHTML = '';
    for (const a of cfg.episodeAssignments) addEpisodeAssign(a.name, a.start, a.end);
  }
  toast('模板字段已填入，请检查后保存', 'success');
}

// ==================== 服务状态 & 重启 ====================
async function refreshServerStatus() {
  let el = document.getElementById('serverIndicator');
  if (!el) return;
  try {
    let r = await api.get('/api/server/status');
    el.innerHTML = '<span style="color:#22c55e">🟢</span> 运行中'
      + ' <span style="color:#94a3b8;font-size:10px">PID ' + r.pid + ' · ' + r.uptime + '</span>';
    el.title = '启动时间: ' + r.startedAt + '\n端口: ' + r.port + '\n点击重启服务 · 右键关闭服务';
    el.style.cursor = 'pointer';
    el.onclick = function(e) { showServerMenu(e, r); };
    el.oncontextmenu = function(e) { e.preventDefault(); stopServer(); };
  } catch (e) {
    el.innerHTML = '<span style="color:#ef4444">🔴</span> 离线';
    el.title = '无法连接到服务';
    el.style.cursor = 'default';
    el.onclick = null;
  }
}

function showServerMenu(e, statusInfo) {
  e.stopPropagation();
  let drop = document.getElementById('statusDrop');
  drop.innerHTML = '';
  let items = [
    { label: '🔄 重启服务', action: restartServer },
    { label: '⏹ 关闭服务并退出', action: stopServer }
  ];
  for (let i = 0; i < items.length; i++) {
    let o = document.createElement('div');
    o.className = 'so';
    o.textContent = items[i].label;
    o.onclick = (function(fn) { return function(ev) { ev.stopPropagation(); drop.classList.remove('show'); fn(); }; })(items[i].action);
    drop.appendChild(o);
  }
  let rect = e.currentTarget.getBoundingClientRect();
  drop.style.left = rect.left + 'px';
  drop.style.top = (rect.bottom + 2) + 'px';
  drop.classList.add('show');
}

async function restartServer() {
  if (!confirm('确定要重启服务？\n重启后页面将自动刷新，请等待约 3 秒。')) return;
  try {
    let r = await api.post('/api/server/restart', {});
    toast(r.message || '服务重启中...', 'warn');
    let attempts = 0;
    let check = setInterval(function() {
      attempts++;
      document.getElementById('serverIndicator').innerHTML = '<span style="color:#f59e0b">🟡</span> 重启中 ' + attempts + '...';
      fetch('/api/server/status').then(function(res) {
        if (res.ok) { clearInterval(check); location.reload(); }
      }).catch(function() {});
      if (attempts > 15) { clearInterval(check); document.getElementById('serverIndicator').innerHTML = '<span style="color:#ef4444">🔴</span> 重启超时'; }
    }, 1000);
  } catch (e) { toast('重启失败: ' + e.message, 'error'); }
}

async function stopServer() {
  if (!confirm('确定要关闭服务？\n关闭后将自动退出本页面。\n如需重新使用请双击「启动.bat」。')) return;
  try {
    await api.post('/api/server/stop', {});
    toast('服务已关闭，页面即将退出', 'success');
    // 先关闭当前标签页
    setTimeout(function() { window.close(); }, 800);
    // 如果 close 失败（非 js 打开的窗口），显示提示
    setTimeout(function() {
      document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-size:18px;color:#94a3b8;font-family:sans-serif">✅ 服务已关闭，请关闭此页面<br><small style="font-size:13px">重新使用请双击「启动.bat」</small></div>';
    }, 1500);
  } catch (e) { toast('关闭失败: ' + e.message, 'error'); }
}

// 每 30 秒刷新一次服务状态
setInterval(refreshServerStatus, 30000);

// ==================== Toast 通知（替换 alert） ====================
function toast(msg, type) {
  type = type || 'info';
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const icons = { info: '💬', warn: '⚠️', error: '❌', success: '✅' };
  el.textContent = (icons[type] || '') + ' ' + msg;
  container.appendChild(el);
  setTimeout(function() { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(function() { el.remove(); }, 300); }, 3000);
}

// 覆盖全局 alert 为 toast（非阻断式）
window.alert = function(m) { toast(m, 'warn'); };

// ==================== 暗色主题 ====================
(function() {
  let saved = localStorage.getItem('pam-theme');
  if (saved === 'dark') document.body.classList.add('dark');
  let btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = saved === 'dark' ? '☀️' : '🌙';
})();
function toggleTheme() {
  let isDark = document.body.classList.toggle('dark');
  localStorage.setItem('pam-theme', isDark ? 'dark' : 'light');
  let btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = isDark ? '☀️' : '🌙';
}

// ==================== 导出/导入配置备份 ====================
async function exportBackup() {
  try {
    const res = await fetch('/api/export/backup');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const d = new Date();
    a.download = '项目档案管理器备份_' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('备份已导出', 'success');
  } catch (e) { toast('导出失败: ' + e.message, 'error'); }
}

async function importBackup(input) {
  const file = input.files[0];
  if (!file) return;
  if (!confirm('确定要导入备份数据？不会覆盖已存在的同名项目。')) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.projects) { toast('无效的备份文件', 'error'); return; }
    const r = await api.post('/api/import/backup', { projects: data.projects, settings: data.settings });
    if (r.success) {
      projects = await api.get('/api/projects');
      settings = await api.get('/api/settings');
      renderProjectList();
      toast('成功导入 ' + r.added + ' 个项目（共 ' + r.total + ' 个）', 'success');
    }
  } catch (e) { toast('导入失败: ' + e.message, 'error'); }
  input.value = '';
}

// ==================== 键盘快捷键（可自定义） ====================
// 默认快捷键定义
const DEFAULT_SHORTCUTS = {
  'new-project':     { label: '新建项目',        keys: 'Ctrl+N',       ctrl: true,  key: 'n',       global: false },
  'search-focus':    { label: '搜索项目',        keys: 'Ctrl+F',       ctrl: true,  key: 'f',       global: false },
  'refresh-panel':   { label: '刷新面板',        keys: 'F5',           ctrl: false, key: 'F5',      global: false },
  'delete-project':  { label: '删除项目',        keys: 'Delete',       ctrl: false, key: 'Delete',  global: false },
  'close-modal':     { label: '关闭弹窗',        keys: 'Escape',       ctrl: false, key: 'Escape',  global: false },
  'show-window':     { label: '呼出主窗口(全局)',  keys: 'Ctrl+Shift+D', ctrl: true,  key: 'd',       shift: true,  global: true  },
};

// 从 localStorage 加载快捷键
function loadShortcuts() {
  try {
    const saved = localStorage.getItem('pam-shortcuts');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed === 'object') return parsed;
    }
  } catch (_) {}
  return JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
}

// 保存快捷键到 localStorage
function saveShortcuts(sc) {
  localStorage.setItem('pam-shortcuts', JSON.stringify(sc));
}

// 格式化按键为显示文本
function formatKeyName(k) {
  const map = { Ctrl: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Win' };
  return map[k] || (k.length === 1 ? k.toUpperCase() : k);
}

let _currentShortcuts = loadShortcuts();

document.addEventListener('keydown', function(e) {
  // 快捷键捕获模式下不触发普通快捷键
  if (_capturingShortcutId) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const sc = _currentShortcuts;

  // Ctrl+N → 新建项目
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === sc['new-project'].key.toLowerCase()) {
    e.preventDefault(); showProjectDlg(-1); return;
  }
  // Ctrl+F → 搜索
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === sc['search-focus'].key.toLowerCase()) {
    e.preventDefault(); const s = document.getElementById('searchInput'); if (s) s.focus(); return;
  }
  // F5 → 刷新
  if (e.key === sc['refresh-panel'].key) {
    e.preventDefault(); if (sel >= 0) { refreshDetail(); refreshModify(); refresh000(); refreshHistory(); } return;
  }
  // Delete → 删除项目
  if (e.key === sc['delete-project'].key && sel >= 0) {
    e.preventDefault(); delProject(); return;
  }
  // Escape → 关闭弹窗
  if (e.key === sc['close-modal'].key) {
    e.preventDefault(); closeModal(); return;
  }
});

// 全局呼出窗口快捷键（即使在输入框中也能触发）
document.addEventListener('keydown', function(e) {
  if (_capturingShortcutId) return;
  const sc = _currentShortcuts;
  const sw = sc['show-window'];
  if (!sw) return;
  const matchKey = sw.key.toLowerCase() === e.key.toLowerCase();
  const needCtrl = sw.ctrl;
  const hasCtrl = e.ctrlKey || e.metaKey;
  const needShift = sw.shift;
  const hasShift = e.shiftKey;
  if (matchKey && hasCtrl === needCtrl && hasShift === needShift) {
    e.preventDefault();
    // 通过 Electron API 通知主进程呼出窗口
    if (window.electronAPI && window.electronAPI.isElectron) {
      window.electronAPI.sendMessage('global-show-window');
    }
    return;
  }
});

// ==================== 请求超时封装 (2分钟) ====================
async function _apiFetch(url, options) {
  options = options || {};
  let controller = new AbortController();
  let timeout = setTimeout(function() { controller.abort(); }, 120000);
  try {
    let res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时（120秒）');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
};
api.get = async function(u) { return _apiFetch(u); };
api.post = async function(u, d) { return _apiFetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
api.put = async function(u, d) { return _apiFetch(u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }); };
api.del = async function(u) { return _apiFetch(u, { method: 'DELETE' }); };

// ==================== 全局错误兜底 ====================
window.addEventListener('error', function(e) {
  console.error('JS错误:', e.message, e.filename, '行', e.lineno);
  toast('发生错误: ' + e.message, 'error');
});
window.addEventListener('unhandledrejection', function(e) {
  console.error('未处理Promise错误:', e.reason);
  toast('操作失败: ' + (e.reason && e.reason.message || '未知错误'), 'error');
});

// ==================== Electron 桌面功能 ====================

// 拖放文件夹导入
async function handleDropImport(dirPath) {
  try {
    const r = await window.electronAPI.dropImport(dirPath);
    if (!r.success) { toast(r.error || "导入失败", "error"); return; }
    const existing = projects.find(p => p.localDir === r.path);
    if (existing) { toast("项目已存在: " + existing.name, "warn"); return; }
    showProjectDlg(-1);
    setTimeout(() => {
      const nm = document.getElementById("dlgName"); if (nm) nm.value = r.name;
      const ld = document.getElementById("dlgLocal"); if (ld) ld.value = r.path;
      saveFolderHistory(r.path);
      toast("已识别项目: " + r.name, "success");
    }, 300);
  } catch (er) { toast("拖放导入失败: " + er.message, "error"); }
}

// 菜单触发文件夹选择导入
async function triggerFileDialog() {
  if (!window.electronAPI || !window.electronAPI.isElectron) { toast("请在桌面版使用", "warn"); return; }
  const r = await window.electronAPI.pickFolder();
  if (r.success && r.path) handleDropImport(r.path);
}

// 文件系统变更回调（防抖 1.5s）
let _fsChangedTimer = null;
function onFsChanged(projectId) {
  if (_fsChangedTimer) clearTimeout(_fsChangedTimer);
  _fsChangedTimer = setTimeout(() => {
    if (sel >= 0 && projects[sel] && projects[sel].id === projectId) {
      refreshDetail();
      manualRefreshMonitor();
      addLog("文件变化已自动刷新");
    }
    _fsChangedTimer = null;
  }, 1500);
}

// 注册安全的 Electron IPC 消息监听
if (window.electronAPI && window.electronAPI.isElectron) {
  window.electronAPI.onMessage('menu:new-project', () => showProjectDlg(-1));
  window.electronAPI.onMessage('menu:import-folder', () => triggerFileDialog());
  window.electronAPI.onMessage('menu:export-backup', () => exportBackup());
  window.electronAPI.onMessage('menu:import-backup', () => document.getElementById('importFileInput').click());
  window.electronAPI.onMessage('drop:import-folder', (fp) => handleDropImport(fp));
  window.electronAPI.onMessage('fs:changed', (projectId) => onFsChanged(projectId));
}

// ==================== 设置弹窗 ====================
async function showSettings() {
  const mTitle = document.getElementById('modalTitle');
  const mBody = document.getElementById('modalBody');
  const mOverlay = document.getElementById('modalOverlay');
  
  mTitle.textContent = '⚙️ 应用设置';
  
  let autoStartChecked = false;
  let appVersion = '';
  // 如果是 Electron 桌面版，读取原生设置
  if (window.electronAPI && window.electronAPI.isElectron) {
    try {
      const s = await window.electronAPI.getAppSettings();
      autoStartChecked = s.autoStart;
      appVersion = s.appVersion || '';
    } catch (e) { /* 忽略 */ }
  }
  
  mBody.innerHTML = 
    '<div class="fg">' +
      '<label>开机自启</label>' +
      '<div style="display:flex;align-items:center;gap:8px;padding:6px 0">' +
        '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;font-weight:400;color:#334155">' +
          '<input type="checkbox" id="setAutoStart" ' + (autoStartChecked ? 'checked' : '') + ' style="accent-color:#3b82f6;width:16px;height:16px">' +
          ' 系统启动时自动运行项目档案管理器' +
        '</label>' +
      '</div>' +
    '</div>' +
    '<div class="fg">' +
      '<label>主题</label>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-outline" onclick="toggleTheme()">🌙 切换暗色/亮色主题</button>' +
      '</div>' +
    '</div>' +
    '<div class="fg">' +
      '<label>键盘快捷键 <span style="font-size:10px;color:#94a3b8">（点击右侧按钮重新绑定）</span></label>' +
      '<div id="shortcutList" style="border:1px solid #e2e8f0;border-radius:7px;overflow:hidden">' +
      '</div>' +
    '</div>' +
    '<div class="fg">' +
      '<label>数据管理</label>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
        '<button class="btn btn-outline" onclick="exportBackup()">📥 导出备份</button>' +
        '<button class="btn btn-outline" onclick="document.getElementById(\'importFileInput\').click()">📤 导入备份</button>' +
        '<button class="btn btn-outline" onclick="openFolder(\'' + (window.electronAPI && window.electronAPI.isElectron ? 'electron-data' : 'data') + '\')">📂 打开数据目录</button>' +
      '</div>' +
    '</div>' +
    (appVersion ? '<div class="fg"><label>版本</label><span style="font-size:13px;color:#64748b">v' + esc(appVersion) + '</span></div>' : '') +
    '<div class="fg">' +
      '<label>扩展功能</label>' +
      '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">' +
        '<button class="btn btn-sm btn-outline" onclick="window.showExtTab(\'scheduler\')" style="font-size:11px">定时自动化</button>' +
        '<button class="btn btn-sm btn-outline" onclick="window.showExtTab(\'notify\')" style="font-size:11px">通知渠道</button>' +
        '<button class="btn btn-sm btn-outline" onclick="window.showExtTab(\'hooks\')" style="font-size:11px">钩子</button>' +
        '<button class="btn btn-sm btn-outline" onclick="window.showExtTab(\'storage\')" style="font-size:11px">存储后端</button>' +
        '<button class="btn btn-sm btn-outline" onclick="window.showExtTab(\'auth\')" style="font-size:11px">用户</button>' +
        '<button class="btn btn-sm btn-outline" onclick="window.showExtTab(\'workflow\')" style="font-size:11px">工作流</button>' +
        '<button class="btn btn-sm btn-outline" onclick="window.Features.showAuditLogs()" style="font-size:11px">📜 操作日志</button>' +
        '<button class="btn btn-sm btn-outline" onclick="window.Features.showWebDAVInfo()" style="font-size:11px">🌐 WebDAV</button>' +
      '</div>' +
      '<div id="extPanel" style="min-height:100px;border:1px solid #e2e8f0;border-radius:7px;padding:12px;font-size:12px;color:#64748b">点击上方按钮管理扩展功能</div>' +
    '</div>' +
    '<div class="fg" style="margin-bottom:0">' +
      '<label>关于</label>' +
      '<p style="font-size:12px;color:#64748b;line-height:1.6">项目档案管理器<br>项目档案交付 NAS 管理工具<br>支持初版交付、修改交付、000交付<br>集数监控 · 桌面通知 · 托盘最小化</p>' +
    '</div>';
  
  // 绑定设置变化
  setTimeout(() => {
    const cb = document.getElementById('setAutoStart');
    if (cb) {
      cb.onchange = async function() {
        if (window.electronAPI && window.electronAPI.isElectron) {
          const r = await window.electronAPI.setAutoStart(this.checked);
          if (r.success) toast('开机自启已' + (this.checked ? '开启' : '关闭'), 'success');
          else toast('设置失败: ' + (r.error || '未知错误'), 'error');
        } else {
          toast('请在桌面版使用此功能', 'warn');
          this.checked = !this.checked;
        }
      };
    }
    // 渲染快捷键列表
    renderShortcutList();
  }, 100);
  
  mOverlay.style.display = 'flex';
}

// ── 快捷键列表渲染 ──
function renderShortcutList() {
  const container = document.getElementById('shortcutList');
  if (!container) return;
  const sc = _currentShortcuts;
  let html = '';
  for (const [id, def] of Object.entries(sc)) {
    const isGlobal = def.global;
    html +=
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">' +
        '<span style="color:#334155">' + esc(def.label) + (isGlobal ? ' <span style="font-size:10px;color:#3b82f6;background:#dbeafe;border-radius:3px;padding:1px 4px">全局</span>' : '') + '</span>' +
        '<button class="btn btn-sm btn-outline" id="sc-btn-' + id + '" style="font-family:Consolas,monospace;min-width:80px;text-align:center" onclick="captureShortcut(\'' + id + '\')">' + esc(def.keys) + '</button>' +
      '</div>';
  }
  html +=
    '<div style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#94a3b8">💡 全局快捷键可在任何应用中呼出主窗口</div>' +
    '<div style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">' +
      '<span style="color:#334155">恢复默认</span>' +
      '<button class="btn btn-sm btn-outline" style="font-family:Consolas,monospace;float:right" onclick="resetShortcuts()">🔄 重置</button>' +
    '</div>';
  container.innerHTML = html;
}

// ── 捕获快捷键 ──
let _capturingShortcutId = null;

function captureShortcut(id) {
  const btn = document.getElementById('sc-btn-' + id);
  if (!btn) return;
  if (_capturingShortcutId === id) {
    // 取消捕获
    _capturingShortcutId = null;
    btn.textContent = _currentShortcuts[id].keys;
    btn.style.borderColor = '';
    btn.style.background = '';
    return;
  }
  // 开始捕获
  _capturingShortcutId = id;
  btn.textContent = '按下按键...';
  btn.style.borderColor = '#3b82f6';
  btn.style.background = '#eff6ff';
}

// 全局快捷键捕获（设置弹窗打开期间有效）
document.addEventListener('keydown', function _scCapture(e) {
  if (!_capturingShortcutId) return;
  e.preventDefault();
  e.stopPropagation();

  const id = _capturingShortcutId;
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const alt = e.altKey;

  // 忽略纯修饰键
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

  const key = e.key;
  // 组合键用于全局快捷键（Ctrl+Shift+X 等）
  const parts = [];
  if (ctrl) parts.push('Ctrl');
  if (alt) parts.push('Alt');
  if (shift) parts.push('Shift');
  if (key.length === 1) parts.push(key.toUpperCase());
  else parts.push(key);

  const isGlobal = _currentShortcuts[id] && _currentShortcuts[id].global;

  _currentShortcuts[id] = {
    ..._currentShortcuts[id],
    keys: parts.join('+'),
    ctrl: ctrl,
    key: key,
    shift: shift,
    alt: alt,
    global: isGlobal,
  };
  saveShortcuts(_currentShortcuts);

  // 如果是全局快捷键，通知 Electron 主进程重新注册
  if (isGlobal && window.electronAPI && window.electronAPI.isElectron) {
    window.electronAPI.sendMessage('register-global-shortcut', _currentShortcuts[id].keys);
  }

  _capturingShortcutId = null;
  renderShortcutList();
  toast('快捷键已更新：' + _currentShortcuts[id].keys, 'success');
}, true);

// ── 重置快捷键 ──
function resetShortcuts() {
  if (!confirm('确定恢复到默认快捷键设置？')) return;
  _currentShortcuts = JSON.parse(JSON.stringify(DEFAULT_SHORTCUTS));
  saveShortcuts(_currentShortcuts);
  renderShortcutList();
  // 通知 Electron 重置全局快捷键
  if (window.electronAPI && window.electronAPI.isElectron) {
    const sw = _currentShortcuts['show-window'];
    if (sw && sw.global) {
      window.electronAPI.sendMessage('register-global-shortcut', sw.keys);
    }
  }
  toast('快捷键已恢复默认', 'success');
}
async function sendDesktopNotify(title, body) {
  // 优先使用 Electron 原生通知
  if (window.electronAPI && window.electronAPI.isElectron && window.electronAPI.showNotification) {
    try {
      await window.electronAPI.showNotification(title, body);
      return;
    } catch (e) { /* 降级到浏览器通知 */ }
  }
  // 浏览器通知降级
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: '/favicon.ico', tag: 'pam-notify' }); } catch (e) {}
  }
}

// 请求通知权限（页面加载时调用）
async function requestNotifyPermission() {
  if (window.electronAPI && window.electronAPI.isElectron) return; // Electron 不需要浏览器权限
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}
