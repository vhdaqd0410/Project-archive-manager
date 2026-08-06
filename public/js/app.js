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
  const lc = $('logContent');
  if (lc) {
    // 用 appendChild 代替 innerHTML+=，避免整段重新序列化
    const div = document.createElement('div');
    const ts = document.createElement('span');
    ts.textContent = '[' + t + '] ';
    div.appendChild(ts);
    const txt = document.createElement('span');
    txt.textContent = msg; // textContent 自动转义，等价于 esc()
    div.appendChild(txt);
    lc.appendChild(div);
  }
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
  try {
    const r = await api.put('/api/projects/' + pid + '/status', { status });
    if (r && r.error) { toast('状态更新失败: ' + r.error, 'error'); return; }
    projects[idx].status = status;
    renderProjectList();
    if (sel === idx) selectProject(idx);
    toast('状态已更新', 'success');
  } catch (e) { toast('状态更新失败: ' + (e.message || '未知错误'), 'error'); }
}

// ==================== 右键菜单 ====================
function showContextMenu(e, idx) {
  selectProject(idx);
  let drop = document.getElementById('statusDrop');
  let p = projects[idx];
  drop.innerHTML = '';
  let actions = [
    { label: '✏️ 编辑项目', action: function() { showProjectDlg(idx); } },
    { label: p.pinned ? '📍 取消置顶' : '📌 置顶', action: function() { togglePin(idx); } },
    { label: '📋 克隆项目', action: function() { cloneProject(idx); } },
    { label: '🎯 设置目标集数', action: function() { setEpisodeTarget(idx); } },
    { label: '🔍 NAS对账', action: function() { selectProject(idx); setTimeout(showReconcile, 100); } },
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
  sorted.sort(function(a, b) {
    if (a.p.pinned !== b.p.pinned) return a.p.pinned ? -1 : 1;
    if (_sortBy === 'time') return (b.p.createdAt || '').localeCompare(a.p.createdAt || '');
    return a.p.name.localeCompare(b.p.name);
  });

  const groups = { editing: [], modifying: [], done: [] };
  const tagFilter = window.Features ? window.Features.getTagFilter() : null;
  for (const item of sorted) {
    if (search && item.p.name.toLowerCase().indexOf(search) < 0) continue;
    if (tagFilter && (!item.p._tagObjs || !item.p._tagObjs.some(t => t.id === tagFilter))) continue;
    const s = item.p.status;
    // 已移除的状态（initial/000/archive）归到「剪辑中」分组，避免项目丢失
    const g = groups[s] !== undefined ? s : 'editing';
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
      + (p.pinned ? '<span style="margin-right:2px" title="已置顶">📌</span>' : '') + esc(p.name);
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
  if (typeof recordRecentAction === 'function') recordRecentAction('view', p.name, p.id);
  rp.innerHTML =
    '<div class="card"><div class="card-hdr">📂 项目目录</div><div class="card-body"><div class="info-row"><span class="lbl">本地</span><span class="val" id="infoLocalDir">' + esc(p.localDir || '-') + '</span></div><div class="info-row"><span class="lbl">NAS</span><span class="val" id="infoNasDir">' + esc(p.nasDir || '-') + '<span id="nasStatus" style="margin-left:8px;font-size:11px"></span></span></div>' + (p.memo ? '<div class="info-row"><span class="lbl">备注</span><span class="val" style="color:#f59e0b">' + esc(p.memo) + '</span></div>' : '') + '</div></div>' +
    '<div class="card"><div class="card-hdr">🔍 关键词目录检测</div><div class="card-body"><div id="detectLocal" style="font-size:12px;color:#94a3b8">扫描中...</div><div id="detectNas" style="font-size:12px;color:#94a3b8">扫描中...</div><div id="detectSummary" style="font-size:12px;margin-top:4px"></div></div></div>' +
    '<div class="act-bar"><button class="btn btn-primary" id="btnOpenLocal">打开本地</button><button class="btn btn-primary" id="btnOpenNas">打开NAS</button><button class="btn btn-outline" id="btnCopyPath">复制NAS路径</button><button class="btn btn-outline" id="btnCopyMsg">复制交付信息</button><button class="btn btn-outline" id="btnTags">🏷️ 标签</button><button class="btn btn-outline" id="btnPreview">🎬 预览</button><button class="btn btn-outline" id="btnRollback">↩️ 回滚</button><button class="btn btn-outline" id="btnTemplate">📋 存模板</button><button class="btn btn-outline" id="btnHistory" onclick="showCopyHistory()">📊 历史</button><button class="btn btn-outline" id="btnTimeline" onclick="showTimeline()">🕐 时间轴</button><button class="btn btn-outline" id="btnTodo" onclick="showTodos()">✅ 待办</button></div>' +
    '<div class="card"><div class="card-hdr">⚠ 待交付文件 <span id="pendingCount" style="margin-left:8px">0</span></div><div class="card-body"><div class="pending-list" id="pendingList"></div><div class="act-bar"><button class="btn btn-sm btn-outline" id="btnRefresh">刷新</button><button class="btn btn-sm btn-outline" id="btnCheckAll">全选</button><button class="btn btn-sm btn-outline" id="btnUncheckAll">取消全选</button><button class="btn btn-sm btn-accent" id="btnQuickCopy" onclick="quickCopyAll()">⚡ 全部复制</button><button class="btn btn-sm btn-outline" id="btnQuality" onclick="runQualityCheck()">🔍 质检</button><button class="btn btn-sm btn-warn" id="btnCopy">复制选中到NAS</button></div></div></div>' +
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
  const videoExts = new Set(['.mp4','.avi','.mkv','.mov','.wmv','.flv','.webm','.m4v','.ts']);
  const baseDir = (resolved.localEpDir || '').replace(/[\\/]+$/, '');
  for (const f of files) {
    const d = document.createElement('div'); d.className = 'pi';
    const ext = (f.slice(f.lastIndexOf('.')) || '').toLowerCase();
    if (videoExts.has(ext)) {
      const fullPath = baseDir + '\\' + f;
      d.innerHTML = '<input type="checkbox" checked>' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(f) + '</span>' +
        '<span class="thumb-icon" style="cursor:pointer;color:#3b82f6" data-pid="' + escAttr(projects[sel].id) + '" data-path="' + escAttr(fullPath) + '" onmouseenter="window.thumbHover(this,event)" onmouseleave="window.thumbHide()">🎬</span>';
    } else {
      d.innerHTML = '<input type="checkbox" checked><span>' + esc(f) + '</span>';
    }
    list.appendChild(d);
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
  // 新建模式时显示快捷创建 + 模板选择
  if (editIdx < 0) {
    const depts = (settings.departments || []);
    let deptOpts = '<option value="">选择部门...</option>';
    for (const d of depts) deptOpts += '<option value="' + escAttr(d.id) + '">' + esc(d.name) + '</option>';
    h += '<div style="background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.2);border-radius:8px;padding:10px;margin-bottom:10px">'
      + '<div style="font-size:12px;color:#3b82f6;margin-bottom:6px">⚡ 快速创建（选部门自动拼接本地/NAS路径）</div>'
      + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'
      + '<select id="dlgDept" onchange="applyDeptShortcut()" style="background:#1e293b;border:1px solid #475569;color:#e2e8f0;border-radius:5px;padding:5px 8px;font-size:12px;outline:none">' + deptOpts + '</select>'
      + '<input id="dlgDeptName" placeholder="项目名（如 H0133-xxx）" oninput="applyDeptShortcut()" style="flex:1;min-width:180px;background:#1e293b;border:1px solid #475569;color:#e2e8f0;border-radius:5px;padding:5px 8px;font-size:12px;outline:none">'
      + '<input id="dlgDeptMonth" placeholder="月份(如8月)" oninput="applyDeptShortcut()" style="display:none;width:80px;background:#1e293b;border:1px solid #475569;color:#e2e8f0;border-radius:5px;padding:5px 8px;font-size:12px;outline:none">'
      + '</div><div id="dlgDeptPreview" style="font-size:11px;color:#94a3b8;margin-top:6px"></div></div>';
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
  if (typeof recordRecentAction === 'function') recordRecentAction('edit', data.name, savedId);
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
let _pollResolve = null;       // pollJob 当前 Promise 的 resolve，用于重入时释放旧 Promise
let _progHideTimer = null;     // 进度面板自动隐藏定时器，新任务启动时需清理
let _fsProgressBytes = 0;
let _jobStartTime = Date.now();
let _progFileListVisible = false;
let _progFileLog = []; // 记录每个文件的处理状态（截断到 200 条，防内存膨胀）
const _progFileLogMax = 200;

function formatBytes(b) { return b >= 1073741824 ? (b/1073741824).toFixed(1)+'GB' : b>=1048576 ? (b/1048576).toFixed(1)+'MB' : b>=1024 ? (b/1024).toFixed(1)+'KB' : b+'B'; }
function formatETA(sec) { if (sec<=0) return ''; let m=Math.floor(sec/60),s=Math.floor(sec%60); return (m>0?m+'分':'')+s+'秒'; }

// 终结旧的轮询任务：释放悬挂的 Promise，清理定时器（避免 pollJob 重入时旧 await 永久挂起）
function _abortPolling(result) {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  if (_pollResolve) { const r = _pollResolve; _pollResolve = null; r(result || { status: 'superseded' }); }
}

function startProgress(title, total) {
  // 终结任何残留的轮询/隐藏定时器，避免新任务被旧定时器干扰
  _abortPolling();
  if (_progHideTimer) { clearTimeout(_progHideTimer); _progHideTimer = null; }
  _currentJobId = null;
  window._currentJobId = null;
  _progFileLog = [];
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
  // 运行中显示旋转图标，让用户明确感知系统在复制大文件（避免 current 长时间不变误以为卡住）
  let prefix = (job.status === 'running' && item.name) ? '⏳ ' : '';
  document.getElementById('progFile').textContent = prefix + (item.name || '...') + ' ' + (job.current || 0) + '/' + job.totalItems;

  // 记录文件状态（截断到 200 条，防长任务内存膨胀）
  if (item.name && item.status) {
    const lastEntry = _progFileLog[_progFileLog.length - 1];
    if (!lastEntry || lastEntry.name !== item.name || lastEntry.status !== item.status) {
      _progFileLog.push({ name: item.name, status: item.status });
      if (_progFileLog.length > _progFileLogMax) _progFileLog = _progFileLog.slice(-_progFileLogMax);
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
    _progHideTimer = setTimeout(function() { document.getElementById('progressPanel').classList.remove('show'); _progHideTimer = null; }, 4000);
  } else if (job.status === 'cancelled') {
    barWrap.className = 'prog-bar';
    document.getElementById('progTitle').textContent = '⏸ 已取消';
    document.getElementById('jobIndicator').style.display = 'none';
    _progHideTimer = setTimeout(function() { document.getElementById('progressPanel').classList.remove('show'); _progHideTimer = null; }, 2000);
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
  // 终结任何残留的旧轮询：释放旧 Promise，避免旧 await 永久挂起
  _abortPolling();
  _currentJobId = jobId;
  window._currentJobId = jobId; // 同步给 SSE 模块（实时进度推送）
  _jobStartTime = Date.now();

  // 暴露给 SSE 模块：SSE 收到 job:complete 时立即 resolve（不等 2s 轮询），让 refreshDetail 尽快执行
  window._resolvePollJob = function(job) {
    if (_currentJobId !== jobId) return; // 已被新任务接管
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    _currentJobId = null; window._currentJobId = null;
    document.getElementById('jobIndicator').style.display = 'none';
    let extra = '';
    if (job.status === 'done') { extra = '成功' + job.completed + (job.skipped>0?'/跳过'+job.skipped:'') + (job.failed>0?'/失败'+job.failed:''); addLog('✅ 完成：' + extra); }
    else if (job.status === 'cancelled') { addLog('⏸ 已取消'); }
    else { addLog('❌ 出错：' + (job.error||'')); }
    if (_pollResolve) { const r = _pollResolve; _pollResolve = null; r(job); }
  };

  return new Promise(function(resolve) {
    _pollResolve = resolve;
    // SSE 在线时降频轮询到 2s（仅作兜底，主进度由 SSE 推送）；SSE 断线时 300ms 高频轮询
    const sseOnline = !!(window.SSE && window.SSE.isConnected());
    const interval = sseOnline ? 2000 : 300;
    _pollTimer = setInterval(async function() {
      // 已被新任务接管，停止当前轮询（不调 resolve，新任务自己会处理）
      if (_currentJobId !== jobId) { clearInterval(_pollTimer); _pollTimer = null; return; }
      try {
        let job = await api.get('/api/jobs/' + jobId);
        // await 期间可能已被新任务接管，再次校验
        if (_currentJobId !== jobId) { clearInterval(_pollTimer); _pollTimer = null; return; }
        updateProgressUI(job);

        if (job.status === 'done' || job.status === 'cancelled' || job.status === 'error') {
          if (window._resolvePollJob) window._resolvePollJob(job);
        }
      } catch (e) { /* 继续 */ }
    }, interval);
  });
}

function finishProgress(status, msg) {
  _abortPolling({ status: status || 'error' });
  _currentJobId = null;
  window._currentJobId = null;
  document.getElementById('jobIndicator').style.display = 'none';
  document.getElementById('progTitle').textContent = '❌ ' + (msg || '失败');
  if (_progHideTimer) { clearTimeout(_progHideTimer); }
  _progHideTimer = setTimeout(function() { document.getElementById('progressPanel').classList.remove('show'); _progHideTimer = null; }, 3000);
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
  // SSE 已有 job:progress 推送，轮询放宽到 5s 仅作兜底
  _dashboardTimer = setInterval(refreshDashboard, 5000);
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
  if (!dirPath) { toast('路径为空', 'warn'); return; }
  try {
    if (window.electronAPI && window.electronAPI.isElectron) {
      const r = await window.electronAPI.openExplorer(dirPath);
      if (r && r.success === false) toast('打开失败: ' + (r.error || '路径不存在或不可访问'), 'error');
    } else {
      const r = await api.post('/api/open-explorer', { path: dirPath });
      if (r && r.success === false) toast('打开失败: ' + (r.error || '路径不存在'), 'error');
    }
  } catch (e) { toast('打开失败: ' + (e.message || '未知错误'), 'error'); }
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

// 暴露给命令面板等外部模块使用
window.getProjects = function() { return projects; };
window.selectProjectByIndex = function(idx) { if (idx >= 0 && idx < projects.length) selectProject(idx); };

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
// ==================== 项目导出/导入 (JSON) ====================
async function exportProjects() {
  try {
    const res = await fetch('/api/transfer/export');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const d = new Date();
    a.download = '项目导出_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出 ' + projects.length + ' 个项目', 'success');
  } catch (e) { toast('导出失败: ' + e.message, 'error'); }
}

async function importBackup(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.projects) { toast('无效的文件', 'error'); return; }
    const mode = confirm('点"确定"=合并模式(同名跳过)\n点"取消"=替换模式(清空后导入)') ? 'merge' : 'replace';
    if (mode === 'replace' && !confirm('⚠️ 替换模式会清空当前所有项目！确认继续？')) { input.value = ''; return; }
    const r = await api.post('/api/transfer/import', { projects: data.projects, settings: data.settings, mode });
    if (r.success) {
      projects = await api.get('/api/projects');
      settings = await api.get('/api/settings');
      renderProjectList();
      toast('导入成功: 新增 ' + r.added + ' 个, 跳过 ' + r.skipped + ' 个', 'success');
    }
  } catch (e) { toast('导入失败: ' + e.message, 'error'); }
  input.value = '';
}

// ==================== 数据库备份管理 ====================
async function showBackupManager() {
  $('modalTitle').textContent = '💾 数据库备份';
  $('modalBody').innerHTML = '<div id="backupList" style="padding:20px;text-align:center;color:#94a3b8">加载中...</div>'
    + '<div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">关闭</button></div>';
  $('modalOverlay').style.display = 'flex';
  await refreshBackupList();
}

async function refreshBackupList() {
  try {
    const r = await api.get('/api/backup');
    const list = r.backups || [];
    const body = document.getElementById('backupList');
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<div style="padding:30px;text-align:center;color:#94a3b8">暂无备份<br><button class="btn btn-primary" onclick="createBackupNow()" style="margin-top:10px">立即创建备份</button></div>';
      return;
    }
    body.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
      + '<span style="font-size:12px;color:#94a3b8">共 ' + list.length + ' 份备份（自动保留最近 7 份）</span>'
      + '<button class="btn btn-sm btn-primary" onclick="createBackupNow()">+ 立即备份</button></div>'
      + '<div style="max-height:300px;overflow-y:auto">'
      + list.map(function(b) {
          const size = b.size > 1048576 ? (b.size/1048576).toFixed(1)+'MB' : (b.size/1024).toFixed(0)+'KB';
          const time = new Date(b.mtime).toLocaleString('zh-CN');
          return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06)">'
            + '<div><div style="font-size:12px;color:#e2e8f0">' + esc(b.name) + '</div>'
            + '<div style="font-size:10px;color:#94a3b8">' + time + ' · ' + size + '</div></div>'
            + '<button class="btn btn-sm btn-warn" onclick="restoreBackup(\'' + escAttr(b.name) + '\')">恢复</button></div>';
        }).join('')
      + '</div>';
  } catch (e) {
    document.getElementById('backupList').innerHTML = '<div style="color:#ef4444">加载失败: ' + esc(e.message) + '</div>';
  }
}

async function createBackupNow() {
  try {
    const r = await api.post('/api/backup', {});
    if (r.success) { toast('备份已创建', 'success'); refreshBackupList(); }
    else toast('备份失败', 'error');
  } catch (e) { toast('备份失败: ' + e.message, 'error'); }
}

async function restoreBackup(name) {
  if (!confirm('⚠️ 确定从「' + name + '」恢复数据库？\n\n当前数据库会被覆盖（恢复前会自动备份当前状态）。\n恢复后需重启服务。')) return;
  try {
    const r = await api.post('/api/backup/restore', { backupName: name });
    if (r.success) toast('已恢复,请重启服务生效', 'success');
    else toast('恢复失败', 'error');
  } catch (e) { toast('恢复失败: ' + e.message, 'error'); }
}

// ==================== 剪辑师工作台 ====================
async function showEditorView() {
  const panel = document.getElementById('dashboardPanel2');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8">👥 加载中...</div>';
  try {
    const r = await (await fetch('/api/stats/editor-view')).json();
    renderEditorView(panel, r);
  } catch (e) {
    panel.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444">加载失败: ' + esc(e.message) + '</div>';
  }
}

function renderEditorView(panel, data) {
  const editors = data.editors || [];
  const cards = editors.map(function(e) {
    const projectsHtml = e.projects.map(function(p) {
      return '<div style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.05);font-size:11px;cursor:pointer" onclick="jumpToProject(\'' + p.projectId + '\')">'
        + '<div style="display:flex;justify-content:space-between;align-items:center">'
        + '<span style="color:#e2e8f0">' + esc(p.projectName) + '</span>'
        + '<span style="font-size:10px;color:#94a3b8">' + (p.status === 'done' ? '✅' : p.status === 'modifying' ? '🟠' : '🔵') + ' 第' + esc(p.assignedRange) + '集</span>'
        + '</div></div>';
    }).join('');
    return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;margin-bottom:12px">'
      + '<div style="padding:12px 14px;background:rgba(59,130,246,.06);border-bottom:1px solid rgba(59,130,246,.2)">'
      + '<div style="display:flex;justify-content:space-between;align-items:center">'
      + '<div><span style="font-size:14px;font-weight:600;color:#e2e8f0">' + esc(e.name) + '</span>'
      + '<span style="font-size:11px;color:#94a3b8;margin-left:8px">' + e.projectCount + ' 个项目</span></div>'
      + '<div style="font-size:12px;color:#22c55e">负责 ' + e.totalAssigned + ' 集</div></div></div>'
      + '<div style="max-height:200px;overflow-y:auto">' + projectsHtml + '</div></div>';
  }).join('');

  panel.innerHTML =
    '<div style="padding:24px;max-height:88vh;overflow-y:auto">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">'
    + '<h2 style="margin:0;font-size:18px;color:#e2e8f0">👥 剪辑师工作台</h2>'
    + '<button onclick="document.getElementById(\'dashboardPanel2\').style.display=\'none\'" style="background:none;border:1px solid #475569;color:#94a3b8;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:16px">×</button>'
    + '</div>'
    + (cards || '<div style="padding:30px;text-align:center;color:#94a3b8">暂无剪辑师分配记录</div>')
    + '</div>';
}

function jumpToProject(pid) {
  const idx = projects.findIndex(function(p) { return p.id === pid; });
  if (idx >= 0) {
    document.getElementById('dashboardPanel2').style.display = 'none';
    selectProject(idx);
  }
}

// ==================== 最近操作快捷区 ====================
let _recentActions = [];
function recordRecentAction(type, name, projectId) {
  _recentActions.unshift({ type: type, name: name, projectId: projectId, time: Date.now() });
  if (_recentActions.length > 8) _recentActions.pop();
  renderRecentBar();
}

function renderRecentBar() {
  const bar = document.getElementById('recentBar');
  if (!bar) return;
  if (!_recentActions.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.innerHTML = '<span style="font-size:11px;color:#94a3b8;margin-right:6px;white-space:nowrap">最近:</span>'
    + _recentActions.slice(0, 5).map(function(a) {
        const icon = a.type === 'deliver' ? '📦' : a.type === 'edit' ? '✏️' : a.type === 'copy' ? '📋' : '•';
        return '<span style="font-size:11px;color:#cbd5e1;cursor:pointer;padding:2px 8px;background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.2);border-radius:10px;white-space:nowrap" onclick="jumpToProject(\'' + a.projectId + '\')" title="' + escAttr(a.time ? new Date(a.time).toLocaleTimeString('zh-CN') : '') + '">' + icon + ' ' + esc(a.name) + '</span>';
      }).join('');
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
  window.electronAPI.onMessage('menu:export-backup', () => exportProjects());
  window.electronAPI.onMessage('menu:import-backup', () => document.getElementById('importFileInput').click());
  window.electronAPI.onMessage('drop:import-folder', (fp) => handleDropImport(fp));
  window.electronAPI.onMessage('fs:changed', (projectId) => onFsChanged(projectId));
  // 托盘快捷菜单
  window.electronAPI.onMessage('menu:command-palette', () => window.CommandPalette && window.CommandPalette.toggle());
  window.electronAPI.onMessage('menu:kanban', () => window.showKanban && window.showKanban());
  window.electronAPI.onMessage('menu:calendar', () => window.CalendarView && window.CalendarView.show());
  window.electronAPI.onMessage('menu:screen', () => window.ScreenView && window.ScreenView.show());
  window.electronAPI.onMessage('menu:dashboard', () => window.toggleDashboard && window.toggleDashboard());
  window.electronAPI.onMessage('menu:monthly', () => window.MonthlyReport && window.MonthlyReport.show());
  window.electronAPI.onMessage('menu:report-center', () => window.ReportCenter && window.ReportCenter.show());
  window.electronAPI.onMessage('menu:pause-all-jobs', () => batchJobControl('pause'));
  window.electronAPI.onMessage('menu:resume-all-jobs', () => batchJobControl('resume'));
  window.electronAPI.onMessage('menu:cancel-all-jobs', () => batchJobControl('cancel'));
  window.electronAPI.onMessage('menu:refresh', () => refreshProjects());
  window.electronAPI.onMessage('menu:backup-now', () => backupNow());
}

// 批量任务控制（暂停/恢复/取消所有运行中任务）
function batchJobControl(action) {
  const jobs = (typeof window.getJobs === 'function' ? window.getJobs() : []);
  let count = 0;
  for (const j of jobs) {
    if (j.status === 'running' || j.status === 'paused') {
      if (action === 'pause' && j.status === 'running') { j.paused = true; j.status = 'paused'; count++; }
      else if (action === 'resume' && j.status === 'paused') { j.paused = false; j.status = 'running'; count++; }
      else if (action === 'cancel') { j.cancel = true; count++; }
    }
  }
  const label = action === 'pause' ? '暂停' : action === 'resume' ? '恢复' : '取消';
  toast(label + ' ' + count + ' 个任务');
}

// 立即备份数据库
async function backupNow() {
  try {
    const r = await (await fetch('/api/backup/create', { method: 'POST' })).json();
    if (r.success) toast('💾 数据库已备份: ' + (r.file || ''), 'success');
    else toast('备份失败: ' + (r.error || ''), 'error');
  } catch(e) { toast('备份请求失败: ' + e.message, 'error'); }
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
        '<button class="btn btn-outline" onclick="showBackupManager()">💾 数据库备份</button>' +
        '<button class="btn btn-outline" onclick="exportProjects()">📥 导出项目JSON</button>' +
        '<button class="btn btn-outline" onclick="document.getElementById(\'importFileInput\').click()">📤 导入项目JSON</button>' +
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

// ==================== 部门快捷创建 ====================
function applyDeptShortcut() {
  const deptId = $('dlgDept') ? $('dlgDept').value : '';
  const name = $('dlgDeptName') ? $('dlgDeptName').value.trim() : '';
  const month = $('dlgDeptMonth') ? $('dlgDeptMonth').value.trim() : '';
  const depts = settings.departments || [];
  const dept = depts.find(function(d) { return d.id === deptId; });
  if (!dept) {
    if ($('dlgDeptMonth')) $('dlgDeptMonth').style.display = 'none';
    if ($('dlgDeptPreview')) $('dlgDeptPreview').innerHTML = '';
    return;
  }
  if ($('dlgDeptMonth')) $('dlgDeptMonth').style.display = dept.needMonth ? '' : 'none';
  if (!name) {
    if ($('dlgDeptPreview')) $('dlgDeptPreview').innerHTML = '<span style="color:#f59e0b">请输入项目名</span>';
    return;
  }
  const localDir = dept.localRoot + '\\' + name;
  let nasDir = dept.nasRoot;
  if (dept.needMonth && month) nasDir += '\\' + month;
  nasDir += '\\' + name;
  if ($('dlgDeptPreview')) {
    $('dlgDeptPreview').innerHTML = '📁 本地: ' + esc(localDir) + '<br>🌐 NAS: ' + esc(nasDir);
  }
  if ($('dlgName')) $('dlgName').value = name;
  if ($('dlgLocal')) $('dlgLocal').value = localDir;
  if ($('dlgNas')) $('dlgNas').value = nasDir;
}

// ==================== 项目置顶 ====================
async function togglePin(idx) {
  const p = projects[idx];
  try {
    await api.put('/api/projects/' + p.id + '/pin', { pinned: !p.pinned });
    p.pinned = !p.pinned;
    renderProjectList();
    toast(p.pinned ? '📌 已置顶' : '已取消置顶', 'success');
  } catch (e) { toast('操作失败: ' + e.message, 'error'); }
}

// ==================== 克隆项目 ====================
async function cloneProject(idx) {
  const newName = prompt('克隆项目，输入新项目名：', projects[idx].name + '（副本）');
  if (!newName || !newName.trim()) return;
  try {
    const r = await api.post('/api/projects/' + projects[idx].id + '/clone', { newName: newName.trim() });
    if (r.error) { toast('克隆失败: ' + r.error, 'error'); return; }
    projects = await api.get('/api/projects');
    renderProjectList();
    const newIdx = projects.findIndex(function(p) { return p.id === r.project.id; });
    if (newIdx >= 0) selectProject(newIdx);
    toast('项目已克隆', 'success');
  } catch (e) { toast('克隆失败: ' + e.message, 'error'); }
}

// ==================== NAS ↔ 本地对账 ====================
async function showReconcile() {
  if (sel < 0) { toast('请先选择项目', 'info'); return; }
  const pid = projects[sel].id;
  $('modalTitle').textContent = '🔍 NAS ↔ 本地对账 · ' + projects[sel].name;
  $('modalBody').innerHTML = '<div style="padding:30px;text-align:center;color:#94a3b8">扫描中...</div>';
  $('modalOverlay').style.display = 'flex';
  try {
    const kw = $('keywordInput').value || '项目归档资料';
    const r = await api.get('/api/projects/' + pid + '/reconcile?keyword=' + encodeURIComponent(kw));
    renderReconcile(r);
  } catch (e) {
    $('modalBody').innerHTML = '<div style="padding:20px;color:#ef4444">对账失败: ' + esc(e.message) + '</div>';
  }
}

function renderReconcile(r) {
  if (!r.found) {
    $('modalBody').innerHTML = '<div style="padding:30px;text-align:center;color:#94a3b8">' + esc(r.message || '未找到关键词目录') + '</div>';
    return;
  }
  function _list(title, items, color) {
    if (!items.length) return '';
    return '<div style="margin-bottom:12px"><div style="font-size:12px;color:' + color + ';margin-bottom:4px">' + title + ' (' + items.length + ')</div>'
      + '<div style="max-height:120px;overflow-y:auto;border:1px solid rgba(255,255,255,.1);border-radius:6px;font-size:11px;font-family:Consolas,monospace">'
      + items.map(function(i) { return '<div style="padding:3px 8px;border-bottom:1px solid rgba(255,255,255,.05);color:#cbd5e1">' + esc(i) + '</div>'; }).join('')
      + '</div></div>';
  }
  const sizeItems = r.sizeMismatch.map(function(i) { return i.name + ' (本地' + (i.localSize/1048576).toFixed(1) + 'MB / NAS ' + (i.nasSize/1048576).toFixed(1) + 'MB)'; });
  $('modalBody').innerHTML =
    '<div style="margin-bottom:14px">'
    + '<div style="font-size:12px;color:#94a3b8;margin-bottom:4px">关键词目录: ' + esc(r.keyword) + '</div>'
    + '<div style="font-size:11px;color:#64748b;margin-bottom:10px">本地: ' + esc(r.localEpDir) + '<br>NAS: ' + esc(r.nasEpDir) + '</div>'
    + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">'
    + '<div style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:6px;padding:8px;text-align:center"><div style="font-size:20px;font-weight:700;color:#22c55e">' + r.matched + '</div><div style="font-size:10px;color:#94a3b8">一致</div></div>'
    + '<div style="background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.3);border-radius:6px;padding:8px;text-align:center"><div style="font-size:20px;font-weight:700;color:#3b82f6">' + r.localOnly.length + '</div><div style="font-size:10px;color:#94a3b8">待交付</div></div>'
    + '<div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:6px;padding:8px;text-align:center"><div style="font-size:20px;font-weight:700;color:#f59e0b">' + r.sizeMismatch.length + '</div><div style="font-size:10px;color:#94a3b8">大小不同</div></div>'
    + '<div style="background:rgba(168,85,247,.1);border:1px solid rgba(168,85,247,.3);border-radius:6px;padding:8px;text-align:center"><div style="font-size:20px;font-weight:700;color:#a855f7">' + r.mtimeMismatch.length + '</div><div style="font-size:10px;color:#94a3b8">时间不同</div></div>'
    + '</div></div>'
    + _list('待交付（本地有 NAS 无）', r.localOnly, '#3b82f6')
    + _list('大小不一致（需重新复制）', sizeItems, '#f59e0b')
    + _list('mtime 不一致（增量同步会重传）', r.mtimeMismatch.map(function(i) { return i.name; }), '#a855f7')
    + _list('NAS 多余（NAS 有本地无）', r.nasOnly, '#ef4444')
    + '<div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">关闭</button></div>';
}

// ==================== 一键全部复制 ====================
// 跳过勾选步骤，自动检测并复制全部待交付文件
async function quickCopyAll() {
  if (sel < 0) { toast('请先选择项目', 'info'); return; }
  if (!confirm('将自动检测并复制全部待交付文件到 NAS，确认继续？')) return;
  setStatus('正在检测待复制文件...');
  try {
    const kw = $('keywordInput').value || '项目归档资料';
    const data = await api.get('/api/projects/' + projects[sel].id + '/pending?keyword=' + encodeURIComponent(kw));
    const files = data.files || [];
    if (!files.length) { toast('没有待交付文件', 'info'); setStatus('就绪'); return; }
    addLog('⚡ 一键复制：检测到 ' + files.length + ' 个文件');
    startProgress('一键复制 ' + files.length + ' 个文件', files.length);
    const r = await api.post('/api/projects/' + projects[sel].id + '/copy', {
      fileNames: files,
      keyword: kw
    });
    await pollJob(r.jobId);
    refreshDetail();
  } catch (e) {
    addLog('✗ 一键复制失败: ' + e.message);
    finishProgress('error', e.message);
  }
}

// ==================== 交付历史对比 ====================
let _copyHistoryData = [];

async function showCopyHistory() {
  if (sel < 0) { toast('请先选择项目', 'info'); return; }
  const pid = projects[sel].id;
  $('modalTitle').textContent = '📊 交付历史 · ' + projects[sel].name;
  $('modalBody').innerHTML = '<div style="padding:30px;text-align:center;color:#94a3b8">加载中...</div>';
  $('modalOverlay').style.display = 'flex';
  try {
    const r = await api.get('/api/projects/' + pid + '/copy-history');
    _copyHistoryData = r.history || [];
    renderCopyHistory();
  } catch (e) {
    $('modalBody').innerHTML = '<div style="padding:20px;color:#ef4444">加载失败: ' + esc(e.message) + '</div>';
  }
}

// ==================== 交付前质量检查 ====================
async function runQualityCheck() {
  if (sel < 0) { toast('请先选择项目', 'info'); return; }
  const pid = projects[sel].id;
  // 取待交付文件列表
  const checked = getCheckedNames('pendingList');
  let files = checked;
  if (!files.length) {
    // 没勾选就检查全部待交付文件
    try {
      const r = await api.get('/api/projects/' + pid + '/pending');
      files = (r.files || []).map(function(f) { return f.name; });
    } catch (e) { toast('获取文件列表失败', 'error'); return; }
  }
  if (!files.length) { toast('没有待检查的文件', 'info'); return; }

  $('modalTitle').textContent = '🔍 质量检查 · ' + projects[sel].name;
  $('modalBody').innerHTML = '<div style="padding:30px;text-align:center;color:#94a3b8">🔬 正在检查 ' + files.length + ' 个文件...<br><div style="margin-top:10px;font-size:11px">读取视频时长可能需要几秒</div></div>';
  $('modalOverlay').style.display = 'flex';

  try {
    const r = await api.post('/api/projects/' + pid + '/quality-check', { fileNames: files });
    renderQualityResult(r);
  } catch (e) {
    $('modalBody').innerHTML = '<div style="padding:30px;text-align:center;color:#ef4444">检查失败: ' + esc(e.message) + '</div>';
  }
}

function renderQualityResult(data) {
  const results = data.results || [];
  const s = data.summary || {};
  const canDeliver = data.summary && data.summary.canDeliver;

  const summaryBg = canDeliver
    ? 'linear-gradient(135deg,rgba(34,197,94,.1),rgba(34,197,94,.05))'
    : 'linear-gradient(135deg,rgba(239,68,68,.1),rgba(245,158,11,.05))';
  const summaryBorder = canDeliver ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)';
  const summaryIcon = canDeliver ? '✅' : '⚠️';
  const summaryText = canDeliver ? '全部通过,可以交付' : '存在问题,请检查后再交付';

  const summaryHtml =
    '<div style="padding:14px;background:' + summaryBg + ';border:1px solid ' + summaryBorder + ';border-radius:10px;margin-bottom:14px">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
    + '<span style="font-size:20px">' + summaryIcon + '</span>'
    + '<span style="font-size:14px;font-weight:600;color:#e2e8f0">' + summaryText + '</span></div>'
    + '<div style="display:flex;gap:16px;font-size:12px">'
    + '<span style="color:#22c55e">✓ ' + s.passed + '</span>'
    + '<span style="color:#f59e0b">⚠ ' + s.warnings + '</span>'
    + '<span style="color:#ef4444">✗ ' + s.errors + '</span>'
    + '<span style="color:#94a3b8">共 ' + data.total + '</span></div></div>';

  const listHtml = results.map(function(r) {
    const statusIcon = !r.ok ? '❌' : (r.warnings.length > 0 ? '⚠️' : '✅');
    const statusColor = !r.ok ? '#ef4444' : (r.warnings.length > 0 ? '#f59e0b' : '#22c55e');
    const sizeStr = r.size > 1048576 ? (r.size/1048576).toFixed(1)+'MB' : (r.size/1024).toFixed(0)+'KB';
    const durationStr = r.duration > 0 ? r.duration.toFixed(0)+'秒' : '-';
    const resolution = r.resolution ? ' · ' + r.resolution : '';
    return '<div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px">'
      + '<div style="display:flex;align-items:center;justify-content:space-between">'
      + '<div style="flex:1;min-width:0"><span style="margin-right:6px">' + statusIcon + '</span><span style="color:#e2e8f0">' + esc(r.name) + '</span></div>'
      + '<div style="font-size:10px;color:#64748b;white-space:nowrap">' + sizeStr + ' · ' + durationStr + resolution + '</div></div>'
      + (r.errors.length > 0 ? '<div style="color:#ef4444;font-size:11px;margin-top:4px;padding-left:22px">错误: ' + r.errors.map(esc).join('; ') + '</div>' : '')
      + (r.warnings.length > 0 ? '<div style="color:#f59e0b;font-size:11px;margin-top:4px;padding-left:22px">警告: ' + r.warnings.map(esc).join('; ') + '</div>' : '')
      + '</div>';
  }).join('');

  $('modalBody').innerHTML =
    '<div style="padding:8px 4px;max-height:70vh;overflow-y:auto">'
    + summaryHtml
    + '<div>' + listHtml + '</div>'
    + '</div>'
    + '<div class="modal-btns">'
    + (canDeliver ? '<button class="btn btn-primary" onclick="closeModal();copyPending()">✅ 继续交付</button>' : '')
    + '<button class="btn btn-outline" onclick="closeModal()">关闭</button></div>';
}

// ==================== 项目待办事项 ====================
let _todoList = [];
async function showTodos() {
  if (sel < 0) { toast('请先选择项目', 'info'); return; }
  const pid = projects[sel].id;
  $('modalTitle').textContent = '✅ 待办事项 · ' + projects[sel].name;
  $('modalBody').innerHTML = '<div style="padding:30px;text-align:center;color:#94a3b8">加载中...</div>';
  $('modalOverlay').style.display = 'flex';
  try {
    const r = await api.get('/api/projects/' + pid + '/todos');
    _todoList = r.todos || [];
    renderTodos();
  } catch (e) {
    $('modalBody').innerHTML = '<div style="padding:30px;text-align:center;color:#ef4444">加载失败: ' + esc(e.message) + '</div>';
  }
}

function renderTodos() {
  const todos = _todoList;
  const pending = todos.filter(function(t) { return !t.done; });
  const done = todos.filter(function(t) { return t.done; });

  const todoItems = todos.map(function(t) {
    const checkIcon = t.done ? '☑️' : '⬜';
    const textStyle = t.done ? 'color:#64748b;text-decoration:line-through' : 'color:#e2e8f0';
    const priorityBadge = t.priority > 0 ? '<span style="color:#ef4444;font-size:10px;margin-right:4px">★</span>' : '';
    return '<div style="display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.05)" data-tid="' + t.id + '">'
      + '<span style="cursor:pointer;font-size:16px;margin-right:8px" onclick="toggleTodo(\'' + t.id + '\',' + (t.done ? 0 : 1) + ')">' + checkIcon + '</span>'
      + '<div style="flex:1;font-size:13px;' + textStyle + '">' + priorityBadge + esc(t.text) + '</div>'
      + '<button onclick="deleteTodo(\'' + t.id + '\')" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px;padding:0 4px">×</button>'
      + '</div>';
  }).join('');

  const summary = pending.length > 0
    ? '<span style="color:#f59e0b">' + pending.length + ' 待办</span>'
    : '<span style="color:#22c55e">✓ 全部完成</span>';

  $('modalBody').innerHTML =
    '<div style="padding:16px">'
    + '<div style="display:flex;gap:8px;margin-bottom:16px">'
    + '<input id="todoInput" type="text" placeholder="新增待办事项..." style="flex:1;padding:8px 12px;background:rgba(30,41,59,.6);border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e2e8f0;font-size:13px" onkeydown="if(event.key===\'Enter\')addTodo()">'
    + '<button class="btn btn-sm btn-primary" onclick="addTodo()">+ 添加</button></div>'
    + '<div style="margin-bottom:8px;font-size:12px">' + summary + (done.length ? ' · <span style="color:#94a3b8">' + done.length + ' 已完成</span>' : '') + '</div>'
    + '<div style="max-height:400px;overflow-y:auto">' + (todoItems || '<div style="padding:30px;text-align:center;color:#94a3b8">暂无待办事项</div>') + '</div>'
    + '</div>'
    + '<div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">关闭</button></div>';

  const input = document.getElementById('todoInput');
  if (input) input.focus();
}

async function addTodo() {
  if (sel < 0) return;
  const pid = projects[sel].id;
  const input = document.getElementById('todoInput');
  const text = (input.value || '').trim();
  if (!text) return;
  try {
    const r = await api.post('/api/projects/' + pid + '/todos', { text: text, priority: 0 });
    if (r.success) {
      _todoList.push(r.todo);
      _todoList.sort(function(a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0); });
      renderTodos();
    }
  } catch (e) { toast('添加失败: ' + e.message, 'error'); }
}

async function toggleTodo(id, done) {
  if (sel < 0) return;
  const pid = projects[sel].id;
  try {
    await api.put('/api/projects/' + pid + '/todos/' + id, { done: !!done });
    const t = _todoList.find(function(x) { return x.id === id; });
    if (t) { t.done = !!done; t.completedAt = done ? new Date().toISOString() : null; }
    _todoList.sort(function(a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0); });
    renderTodos();
  } catch (e) { toast('更新失败: ' + e.message, 'error'); }
}

async function deleteTodo(id) {
  if (sel < 0) return;
  const pid = projects[sel].id;
  try {
    await api.del('/api/projects/' + pid + '/todos/' + id);
    _todoList = _todoList.filter(function(x) { return x.id !== id; });
    renderTodos();
  } catch (e) { toast('删除失败: ' + e.message, 'error'); }
}

// ==================== 看板视图 ====================
let _kanbanVisible = false;
function showKanban() {
  let panel = document.getElementById('kanbanPanel');
  if (!panel) {
    // 动态创建看板面板
    const div = document.createElement('div');
    div.id = 'kanbanPanel';
    div.style.cssText = 'position:fixed;top:50px;left:0;right:0;bottom:0;background:rgba(15,23,42,.97);z-index:100;display:none;padding:16px;overflow-y:auto';
    document.body.appendChild(div);
    panel = document.getElementById('kanbanPanel');
  }
  if (_kanbanVisible) {
    panel.style.display = 'none';
    _kanbanVisible = false;
    return;
  }
  _kanbanVisible = true;
  panel.style.display = 'block';
  renderKanban();
}

function renderKanban() {
  const panel = document.getElementById('kanbanPanel');
  const search = ($('searchInput') ? $('searchInput').value : '').toLowerCase();
  const groups = { editing: [], modifying: [], done: [] };
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    if (search && p.name.toLowerCase().indexOf(search) < 0) continue;
    const s = (p.status && groups[p.status] !== undefined) ? p.status : 'editing';
    groups[s].push({ p: p, idx: i });
  }

  const columns = [
    { key: 'editing', label: '🔵 剪辑中', color: '#3b82f6', bg: 'rgba(59,130,246,.06)' },
    { key: 'modifying', label: '🟠 修改中', color: '#f59e0b', bg: 'rgba(245,158,11,.06)' },
    { key: 'done', label: '✅ 已完成', color: '#22c55e', bg: 'rgba(34,197,94,.06)' },
  ];

  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    + '<h2 style="margin:0;font-size:18px;color:#e2e8f0">🗂️ 看板视图 <span style="font-size:12px;color:#94a3b8;font-weight:400">拖拽卡片可切换状态</span></h2>'
    + '<button onclick="showKanban()" style="background:none;border:1px solid #475569;color:#94a3b8;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:16px">×</button></div>'
    + '<div style="display:flex;gap:12px;min-height:400px">'
    + columns.map(function(col) {
        const cards = groups[col.key];
        const cardsHtml = cards.map(function(item) {
          const p = item.p;
          const pinIcon = p.pinned ? '📌 ' : '';
          const targetInfo = p.episodeTarget ? '目标 ' + p.episodeTarget + ' 集' : '';
          const assigns = (p.episodeAssignments || []).slice(0, 2).map(function(a) { return a.name; }).join('、');
          return '<div draggable="true" data-pid="' + p.id + '" data-idx="' + item.idx + '" '
            + 'style="background:rgba(30,41,59,.7);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px;margin-bottom:8px;cursor:move;transition:all .15s" '
            + 'onmouseover="this.style.borderColor=\'' + col.color + '\'" onmouseout="this.style.borderColor=\'rgba(255,255,255,.08)\'" '
            + 'onclick="kanbanCardClick(' + item.idx + ')">'
            + '<div style="font-size:13px;color:#e2e8f0;font-weight:500;margin-bottom:4px">' + pinIcon + esc(p.name) + '</div>'
            + (targetInfo ? '<div style="font-size:11px;color:#94a3b8">' + targetInfo + '</div>' : '')
            + (assigns ? '<div style="font-size:11px;color:#64748b;margin-top:2px">👥 ' + esc(assigns) + '</div>' : '')
            + '</div>';
        }).join('');
        return '<div data-col="' + col.key + '" '
          + 'style="flex:1;background:' + col.bg + ';border:1px solid ' + col.color + '20;border-radius:10px;padding:10px;min-height:400px;transition:background .2s" '
          + 'ondragover="event.preventDefault();this.style.background=\'' + col.color + '15\'" '
          + 'ondragleave="this.style.background=\'' + col.bg + '\'" '
          + 'ondrop="kanbanDrop(event,\'' + col.key + '\')">'
          + '<div style="font-size:13px;font-weight:600;color:' + col.color + ';margin-bottom:10px;padding:4px 8px">'
          + col.label + ' <span style="color:#94a3b8;font-weight:400">(' + cards.length + ')</span></div>'
          + cardsHtml
          + '</div>';
      }).join('')
    + '</div>';

  // 绑定 dragstart
  panel.querySelectorAll('[draggable=true]').forEach(function(card) {
    card.addEventListener('dragstart', function(e) {
      e.dataTransfer.setData('text/plain', card.dataset.pid);
      card.style.opacity = '0.5';
    });
    card.addEventListener('dragend', function() { card.style.opacity = '1'; });
  });
}

function kanbanCardClick(idx) {
  showKanban(); // 关闭看板
  selectProject(idx);
}

async function kanbanDrop(e, newStatus) {
  e.preventDefault();
  const pid = e.dataTransfer.getData('text/plain');
  if (!pid) return;
  const idx = projects.findIndex(function(p) { return p.id === pid; });
  if (idx < 0) return;
  const p = projects[idx];
  if ((p.status || 'editing') === newStatus) { renderKanban(); return; }
  try {
    const r = await api.put('/api/projects/' + pid + '/status', { status: newStatus });
    if (r && r.error) { toast('切换失败: ' + r.error, 'error'); renderKanban(); return; }
    projects[idx].status = newStatus;
    toast(p.name + ' → ' + (newStatus === 'done' ? '已完成' : newStatus === 'modifying' ? '修改中' : '剪辑中'), 'success');
    renderKanban();
    renderProjectList();
  } catch (e) { toast('切换失败: ' + e.message, 'error'); renderKanban(); }
}

// ==================== 项目交付时间轴 ====================
async function showTimeline() {
  if (sel < 0) { toast('请先选择项目', 'info'); return; }
  const pid = projects[sel].id;
  const pname = projects[sel].name;
  $('modalTitle').textContent = '🕐 时间轴 · ' + pname;
  $('modalBody').innerHTML = '<div style="padding:30px;text-align:center;color:#94a3b8">加载中...</div>';
  $('modalOverlay').style.display = 'flex';
  try {
    const r = await api.get('/api/projects/' + pid + '/timeline');
    renderTimeline(r);
  } catch (e) {
    $('modalBody').innerHTML = '<div style="padding:30px;text-align:center;color:#ef4444">加载失败: ' + esc(e.message) + '</div>';
  }
}

function renderTimeline(data) {
  const events = data.events || [];
  const s = data.summary || {};
  if (!events.length) {
    $('modalBody').innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8">暂无时间轴记录</div>';
    return;
  }
  const fmtDate = function(t) {
    const d = new Date(t);
    return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
  };
  const fmtDuration = function(ms) {
    if (!ms) return '0';
    const days = Math.floor(ms/86400000);
    const hrs = Math.floor((ms%86400000)/3600000);
    if (days > 0) return days + '天' + hrs + '小时';
    if (hrs > 0) return hrs + '小时';
    const mins = Math.floor((ms%3600000)/60000);
    return mins + '分钟';
  };

  const summaryHtml =
    '<div style="display:flex;gap:12px;flex-wrap:wrap;padding:14px;background:linear-gradient(135deg,rgba(59,130,246,.08),rgba(139,92,246,.08));border:1px solid rgba(59,130,246,.2);border-radius:10px;margin-bottom:18px">'
    + '<div style="flex:1;min-width:120px"><div style="font-size:10px;color:#94a3b8">总事件</div><div style="font-size:18px;font-weight:600;color:#e2e8f0">' + s.totalEvents + '</div></div>'
    + '<div style="flex:1;min-width:120px"><div style="font-size:10px;color:#94a3b8">交付次数</div><div style="font-size:18px;font-weight:600;color:#22c55e">' + s.totalDeliveries + '</div></div>'
    + '<div style="flex:1;min-width:120px"><div style="font-size:10px;color:#94a3b8">成功/失败</div><div style="font-size:14px;font-weight:600;color:#e2e8f0"><span style="color:#22c55e">' + s.totalOk + '</span> / <span style="color:#ef4444">' + s.totalFail + '</span></div></div>'
    + '<div style="flex:1;min-width:120px"><div style="font-size:10px;color:#94a3b8">总耗时</div><div style="font-size:14px;font-weight:600;color:#f59e0b">' + fmtDuration(s.duration) + '</div></div>'
    + '</div>';

  const timelineHtml = events.map(function(ev, i) {
    const isLast = i === events.length - 1;
    return '<div style="display:flex;position:relative;padding-bottom:18px">'
      + '<div style="display:flex;flex-direction:column;align-items:center;width:36px;flex-shrink:0">'
      + '<div style="width:28px;height:28px;border-radius:50%;background:' + ev.color + '20;border:2px solid ' + ev.color + ';display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;z-index:1">' + ev.icon + '</div>'
      + (isLast ? '' : '<div style="width:2px;flex:1;background:linear-gradient(to bottom,' + ev.color + '60,transparent);margin-top:2px"></div>')
      + '</div>'
      + '<div style="flex:1;padding-left:10px">'
      + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">'
      + '<span style="font-size:13px;font-weight:600;color:#e2e8f0">' + esc(ev.title) + '</span>'
      + '<span style="font-size:10px;color:#64748b;white-space:nowrap">' + fmtDate(ev.time) + '</span>'
      + '</div>'
      + (ev.detail ? '<div style="font-size:11px;color:#94a3b8;margin-bottom:4px">' + esc(ev.detail) + '</div>' : '')
      + (ev.ok !== undefined ? '<div style="font-size:11px"><span style="color:#22c55e">✓ ' + ev.ok + ' 成功</span>' + (ev.fail > 0 ? ' <span style="color:#ef4444;margin-left:8px">✗ ' + ev.fail + ' 失败</span>' : '') + '</div>' : '')
      + (ev.nasDir ? '<div style="font-size:10px;color:#64748b;margin-top:2px;word-break:break-all">📁 ' + esc(ev.nasDir) + '</div>' : '')
      + '</div></div>';
  }).join('');

  $('modalBody').innerHTML =
    '<div style="padding:8px 4px;max-height:70vh;overflow-y:auto">'
    + summaryHtml
    + '<div>' + timelineHtml + '</div>'
    + '</div>'
    + '<div class="modal-btns"><button class="btn btn-outline" onclick="closeModal()">关闭</button></div>';
}

function renderCopyHistory() {
  if (!_copyHistoryData.length) {
    $('modalBody').innerHTML = '<div style="padding:30px;text-align:center;color:#94a3b8">暂无交付历史记录</div>';
    return;
  }
  // 选项下拉
  const opts = _copyHistoryData.map((h, i) =>
    '<option value="' + i + '">' + esc(h.createdAt) + ' · ' + esc(h.jobType) + ' · ' + h.fileCount + ' 文件</option>'
  ).join('');
  // 历史列表
  const listHtml = _copyHistoryData.map(h => {
    const filesPreview = (h.files || []).slice(0, 5).join(', ') + ((h.files || []).length > 5 ? ' 等 ' + h.files.length + ' 个' : '');
    return '<div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center">'
      + '<span style="color:#e2e8f0">' + esc(h.createdAt) + '</span>'
      + (h.rolledBack ? '<span style="color:#ef4444;font-size:10px;border:1px solid #ef4444;padding:1px 5px;border-radius:3px">已回滚</span>' : '')
      + '</div>'
      + '<div style="color:#94a3b8;margin-top:3px">' + esc(h.jobType) + ' · ' + h.fileCount + ' 文件</div>'
      + (filesPreview ? '<div style="color:#64748b;font-size:11px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escAttr(filesPreview) + '">' + esc(filesPreview) + '</div>' : '')
      + '</div>';
  }).join('');

  $('modalBody').innerHTML =
    '<div style="margin-bottom:14px;padding:12px;background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.2);border-radius:8px">'
    + '<div style="font-size:12px;color:#cbd5e1;margin-bottom:8px">🔍 选择两次交付进行对比</div>'
    + '<div style="display:flex;gap:8px;align-items:center">'
    + '<select id="histA" style="flex:1;background:#1e293b;border:1px solid #475569;color:#e2e8f0;padding:6px 8px;border-radius:5px;font-size:12px">' + opts + '</select>'
    + '<span style="color:#94a3b8;font-size:11px">vs</span>'
    + '<select id="histB" style="flex:1;background:#1e293b;border:1px solid #475569;color:#e2e8f0;padding:6px 8px;border-radius:5px;font-size:12px">' + opts + '</select>'
    + '<button class="btn btn-sm btn-primary" onclick="compareCopyHistory()">对比</button>'
    + '</div>'
    + '<div id="histCompareResult" style="margin-top:10px"></div>'
    + '</div>'
    + '<div style="font-size:12px;color:#94a3b8;margin-bottom:6px">📋 历史记录（' + _copyHistoryData.length + ' 条）</div>'
    + '<div style="max-height:280px;overflow-y:auto">' + listHtml + '</div>';
}

function compareCopyHistory() {
  if (!_copyHistoryData.length) return;
  const aIdx = parseInt(document.getElementById('histA').value);
  const bIdx = parseInt(document.getElementById('histB').value);
  const box = document.getElementById('histCompareResult');
  if (isNaN(aIdx) || isNaN(bIdx)) { box.innerHTML = '<div style="color:#f59e0b;font-size:11px">请选择两次交付</div>'; return; }
  if (aIdx === bIdx) { box.innerHTML = '<div style="color:#f59e0b;font-size:11px">请选择两次不同的交付</div>'; return; }
  const opA = _copyHistoryData[aIdx];
  const opB = _copyHistoryData[bIdx];
  const setA = new Set(opA.files || []);
  const setB = new Set(opB.files || []);
  const added = (opB.files || []).filter(f => !setA.has(f));
  const removed = (opA.files || []).filter(f => !setB.has(f));
  const common = (opA.files || []).filter(f => setB.has(f));
  // 较早 vs 较晚：用时间顺序展示
  const earlier = opA.createdAt < opB.createdAt ? opA : opB;
  const later = opA.createdAt < opB.createdAt ? opB : opA;
  const earlierSet = new Set(earlier.files || []);
  const laterSet = new Set(later.files || []);
  const realAdded = (later.files || []).filter(f => !earlierSet.has(f));
  const realRemoved = (earlier.files || []).filter(f => !laterSet.has(f));

  function fileList(arr, color) {
    if (!arr.length) return '<div style="color:#64748b;font-size:11px;padding:4px 0">无</div>';
    return '<div style="max-height:100px;overflow-y:auto;font-size:11px;font-family:Consolas,monospace">' + arr.map(f => '<div style="color:' + color + ';padding:1px 0">' + esc(f) + '</div>').join('') + '</div>';
  }

  box.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">'
    + '<div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:6px;padding:8px">'
    + '<div style="font-size:11px;color:#22c55e;margin-bottom:4px">➕ 新增（' + realAdded.length + '）</div>'
    + fileList(realAdded, '#22c55e') + '</div>'
    + '<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:6px;padding:8px">'
    + '<div style="font-size:11px;color:#ef4444;margin-bottom:4px">➖ 消失（' + realRemoved.length + '）</div>'
    + fileList(realRemoved, '#ef4444') + '</div>'
    + '</div>'
    + '<div style="font-size:11px;color:#94a3b8;margin-top:8px">较早：' + esc(earlier.createdAt) + ' (' + earlier.fileCount + ' 文件) → 较晚：' + esc(later.createdAt) + ' (' + later.fileCount + ' 文件)</div>'
    + '<div style="font-size:11px;color:#64748b;margin-top:2px">共同文件：' + common.length + ' 个</div>';
}
