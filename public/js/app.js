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
var _statusTargetIdx = -1;
function toggleStatusMenu(e, pid, idx) {
  e.stopPropagation();
  _statusTargetIdx = idx;
  var drop = document.getElementById('statusDrop');
  var p = projects[idx];
  var options = [
    { value: 'editing', icon: '🔵', label: '剪辑中' },
    { value: 'modifying', icon: '🟠', label: '修改中' },
    { value: 'done', icon: '✅', label: '已完成' }
  ];
  drop.innerHTML = '';
  for (var i = 0; i < options.length; i++) {
    var opt = options[i];
    var o = document.createElement('div');
    o.className = 'so' + (p.status === opt.value ? ' sel' : '');
    o.textContent = opt.icon + ' ' + opt.label;
    o.onclick = (function(val) {
      return function(ev) { ev.stopPropagation(); setProjectStatus(_statusTargetIdx, val); };
    })(opt.value);
    drop.appendChild(o);
  }
  // 定位到按钮下方
  var btn = e.currentTarget;
  var rect = btn.getBoundingClientRect();
  drop.style.left = rect.left + 'px';
  drop.style.top = (rect.bottom + 2) + 'px';
  drop.classList.add('show');
}

async function setProjectStatus(idx, status) {
  var drop = document.getElementById('statusDrop');
  drop.classList.remove('show');
  await api.put('/api/projects/' + idx + '/status', { status });
  projects[idx].status = status;
  renderProjectList();
  if (sel === idx) selectProject(idx);
  toast('状态已更新', 'success');
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

// ==================== 项目列表 ====================
function renderProjectList() {
  const list = $('projectList'), search = ($('searchInput').value || '').toLowerCase();
  list.innerHTML = '';
  const groups = { editing: [], modifying: [], done: [] };
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    if (search && p.name.toLowerCase().indexOf(search) < 0) continue;
    const g = p.status === 'done' ? 'done' : p.status === 'modifying' ? 'modifying' : 'editing';
    groups[g].push(i);
  }
  const groupConfig = [
    { label: '🔵 剪辑中', key: 'editing' },
    { label: '🟠 修改中', key: 'modifying' },
    { label: '✅ 已完成', key: 'done' }
  ];
  for (const cfg of groupConfig) renderGroup(list, cfg, groups[cfg.key], search);
  $('projectCount').textContent = projects.length;
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
    '<div class="act-bar"><button class="btn btn-primary" id="btnOpenLocal">打开本地</button><button class="btn btn-primary" id="btnOpenNas">打开NAS</button><button class="btn btn-outline" id="btnCopyPath">复制NAS路径</button><button class="btn btn-outline" id="btnCopyMsg">复制交付信息</button></div>' +
    '<div class="card"><div class="card-hdr">⚠ 待交付文件 <span id="pendingCount" style="margin-left:8px">0</span></div><div class="card-body"><div class="pending-list" id="pendingList"></div><div class="act-bar"><button class="btn btn-sm btn-outline" id="btnRefresh">刷新</button><button class="btn btn-sm btn-outline" id="btnCheckAll">全选</button><button class="btn btn-sm btn-outline" id="btnUncheckAll">取消全选</button><button class="btn btn-sm btn-warn" id="btnCopy">复制选中到NAS</button></div></div></div>' +
    '<div class="card"><div class="card-hdr">🎬 上映单集版 · 修改交付 <span id="modifyCount" style="margin-left:8px">0</span></div><div class="card-body"><div id="modifyInfo" style="font-size:11px;color:#94a3b8">检测中...</div><div id="modifySummary" style="font-size:12px;margin:4px 0"></div><div class="pending-list" id="modifyList"></div><div class="act-bar"><button class="btn btn-sm btn-primary" id="btnModOpenLocal">打开本地</button><button class="btn btn-sm btn-primary" id="btnModOpenNas">打开NAS</button><button class="btn btn-sm btn-outline" id="btnModRefresh">刷新</button><button class="btn btn-sm btn-outline" id="btnModCheckAll">全选</button><button class="btn btn-sm btn-outline" id="btnModUncheckAll">取消全选</button><button class="btn btn-sm btn-outline" id="btnModCopyPath">复制路径</button><button class="btn btn-sm btn-warn" id="btnModCopy">复制选中到NAS</button></div></div></div>' +
    '<div class="card"><div class="card-hdr">📦 000交付 <span id="count000" style="margin-left:8px">0</span></div><div class="card-body"><div id="info000" style="font-size:11px;color:#94a3b8">检测中...</div><div id="summary000" style="font-size:12px;margin:4px 0"></div><div class="pending-list" id="list000"></div><div class="act-bar"><button class="btn btn-sm btn-primary" id="btn000OpenLocal">打开本地</button><button class="btn btn-sm btn-primary" id="btn000OpenNas">打开NAS</button><button class="btn btn-sm btn-outline" id="btn000Refresh">刷新</button><button class="btn btn-sm btn-outline" id="btn000CheckAll">全选</button><button class="btn btn-sm btn-outline" id="btn000UncheckAll">取消全选</button><button class="btn btn-sm btn-outline" id="btn000CopyPath">复制路径</button><button class="btn btn-sm btn-warn" id="btn000Copy">复制选中到NAS</button></div></div></div>' +
    '<div class="card"><div class="card-hdr">📋 运行日志</div><div class="card-body" id="logPanel" style="max-height:200px;overflow-y:auto;font-family:Consolas,monospace;font-size:11px;color:#64748b;padding:8px 12px"><div id="logContent">就绪</div></div></div>' +
    '<div class="card"><div class="card-hdr">📜 最近交付记录</div><div class="card-body" id="historyContent" style="max-height:180px;overflow-y:auto;padding:4px 8px">加载中...</div></div>';
  bindEvents();
  refreshDetail();
  refreshModify();
  refresh000();
  refreshHistory();
}

function bindEvents() {
  let b = $('btnOpenLocal'); if (b) b.onclick = () => { const p = (resolved && resolved.localEpDir) || (projects[sel] || {}).localDir; if (p) api.post('/api/open-explorer', { path: p }); };
  b = $('btnOpenNas'); if (b) b.onclick = () => { const p = (resolved && resolved.nasEpDir) || (projects[sel] || {}).nasDir; if (p) api.post('/api/open-explorer', { path: p }); };
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
  b = $('btn000OpenLocal'); if (b) b.onclick = () => api.post('/api/open-explorer', { path: localDir000 });
  b = $('btn000OpenNas'); if (b) b.onclick = () => api.post('/api/open-explorer', { path: nasDir000 });
}

// ==================== 检测 ====================
async function checkNasStatus() {
  const el = $('nasStatus'); if (!el) return;
  if (sel < 0 || !projects[sel].nasDir) { el.innerHTML = ''; return; }
  el.innerHTML = ' 检测中...';
  try {
    const r = await api.get('/api/projects/' + sel + '/check-nas');
    if (r.accessible) el.innerHTML = '<span style="color:#22c55e">✓ 可访问</span>';
    else el.innerHTML = '<span style="color:#ef4444">✗ ' + esc(r.error || '不可访问') + '</span>';
  } catch { el.innerHTML = '<span style="color:#ef4444">✗ 检测失败</span>'; }
}

async function refreshDetail() {
  if (sel < 0) return;
  checkNasStatus();
  try {
    const kw = $('keywordInput').value || '项目归档资料';
    resolved = await api.get('/api/projects/' + sel + '/detect?keyword=' + encodeURIComponent(kw));
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
  const data = await api.get('/api/projects/' + sel + '/pending?keyword=' + encodeURIComponent($('keywordInput').value || '项目归档资料'));
  const files = data.files || [];
  $('pendingCount').textContent = files.length + ' 个';
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
    const r = await api.post('/api/projects/' + sel + '/copy', {
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
    const data = await api.get('/api/projects/' + sel + '/modify-batches?keyword=' + encodeURIComponent('上映单集版'));
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
    const r = await api.post('/api/projects/' + sel + '/modify-copy-batch', { batchNames: names, keyword: '上映单集版' });
    await pollJob(r.jobId);
    refreshModify();
  } catch (e) { addLog('✗ 批量复制失败: ' + e.message); finishProgress('error', e.message); }
}

// ==================== 弹窗：项目 ====================
function showProjectDlg(editIdx) {
  const p = editIdx >= 0 ? projects[editIdx] : { name: '', localDir: '', nasDir: '', memo: '', status: 'editing' };
  const s = p.status || 'editing';
  let h = '<div class="fg"><label>项目名称</label><input id="dlgName" value="' + escAttr(p.name) + '"></div>';
  h += '<div class="fg"><label>本地根目录</label><div class="ir"><input id="dlgLocal" value="' + escAttr(p.localDir) + '"><button class="btn btn-sm btn-outline" onclick="pickFolder(\'dlgLocal\')">浏览</button></div></div>';
  h += '<div class="fg"><label>NAS根目录</label><div class="ir"><input id="dlgNas" value="' + escAttr(p.nasDir) + '"><button class="btn btn-sm btn-outline" onclick="pickFolder(\'dlgNas\')">浏览</button></div></div>';
  h += '<div class="fg"><label>备注</label><textarea id="dlgMemo" style="width:100%;height:60px;border:1px solid #e2e8f0;border-radius:7px;padding:8px 12px;font-size:13px;outline:none;resize:vertical" placeholder="添加备注信息...">' + esc(p.memo || '') + '</textarea></div>';
  h += '<div class="fg"><label>状态</label><select id="dlgStatus"><option value="editing"' + (s === 'editing' ? ' selected' : '') + '>🔵 剪辑中</option><option value="modifying"' + (s === 'modifying' ? ' selected' : '') + '>🟠 修改中</option><option value="done"' + (s === 'done' ? ' selected' : '') + '>✅ 已完成</option></select></div>';
  h += '<div class="modal-btns"><button class="btn btn-primary" onclick="saveProject(' + editIdx + ')">保存</button><button class="btn btn-outline" onclick="closeModal()">取消</button></div>';
  $('modalTitle').textContent = editIdx >= 0 ? '编辑项目' : '新建项目';
  $('modalBody').innerHTML = h;
  $('modalOverlay').style.display = 'flex';
}

async function saveProject(editIdx) {
  const data = {
    name: $('dlgName').value.trim(),
    localDir: $('dlgLocal').value.trim(),
    nasDir: $('dlgNas').value.trim(),
    memo: $('dlgMemo') ? $('dlgMemo').value.trim() : '',
    status: $('dlgStatus').value
  };
  if (!data.name) { alert('请输入名称'); return; }
  if (editIdx >= 0) await api.put('/api/projects/' + editIdx, data);
  else await api.post('/api/projects', data);
  closeModal(); projects = await api.get('/api/projects');
  renderProjectList(); selectProject(editIdx >= 0 ? editIdx : projects.length - 1);
}

async function delProject() {
  if (sel < 0) return;
  if (!confirm('确定删除「' + projects[sel].name + '」？')) return;
  await api.del('/api/projects/' + sel);
  projects = await api.get('/api/projects');
  if (sel >= projects.length) sel = projects.length - 1;
  renderProjectList(); selectProject(sel);
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
  const tpls = settings.templates || [];
  window._tplIdx = tpls.length; // 避免新建行 ID 与已有行冲突
  for (let i = 0; i < tpls.length; i++) addTplRow(tpls[i].name, tpls[i].path, i);
}

window._tplIdx = 0;
function addTpl() { addTplRow('', '', window._tplIdx++); }
function addTplRow(name, pathVal, idx) {
  const c = $('dlgTplList'), d = document.createElement('div'); d.className = 'ir'; d.style.marginBottom = '4px';
  d.innerHTML = '<input class="tpl-name" value="' + escAttr(name) + '" placeholder="部门名" style="width:80px"><input class="tpl-path" id="tplPath_' + idx + '" value="' + escAttr(pathVal) + '" placeholder="NAS路径" style="flex:1"><button class="btn btn-sm btn-outline" onclick="pickFolder(\'tplPath_' + idx + '\')">浏览</button><button class="btn btn-sm btn-outline" onclick="this.parentElement.remove()">✕</button>';
  c.appendChild(d);
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
    const data = await api.get('/api/projects/' + sel + '/modify-batches?keyword=' + encodeURIComponent('000交付'));
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
    const r = await api.post('/api/projects/' + sel + '/modify-copy-batch', { batchNames: names, keyword: '000交付' });
    await pollJob(r.jobId);
    // 复制成功后改状态
    const job = await api.get('/api/jobs/' + r.jobId);
    if (job.completed > 0) {
      await api.put('/api/projects/' + sel + '/status', { status: 'done' });
      projects = await api.get('/api/projects');
      renderProjectList();
      addLog('📌 项目状态已更新为「已完成」');
      toast('项目已移至「已完成」分组', 'success');
    }
    refresh000();
  } catch (e) { addLog('✗ 000交付失败: ' + e.message); finishProgress('error', e.message); }
}

// ==================== 进度条系统 ====================
var _currentJobId = null;
var _pollTimer = null;

function startProgress(title, total) {
  _currentJobId = null;
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  const panel = document.getElementById('progressPanel');
  document.getElementById('progTitle').textContent = title;
  document.getElementById('progFill').style.width = '0%';
  document.getElementById('progStats').textContent = '0 / ' + total;
  document.getElementById('progCurrent').textContent = '启动中...';
  document.getElementById('progSpeed').textContent = '';
  panel.classList.add('show');
}

function updateProgressUI(job) {
  const pct = job.totalItems > 0 ? Math.round(job.current / job.totalItems * 100) : 0;
  document.getElementById('progFill').style.width = pct + '%';
  document.getElementById('progStats').textContent = job.completed + ' ✓ / ' + job.totalItems + ' 总';
  const item = job.currentItem || {};
  const name = item.name || '';
  document.getElementById('progCurrent').textContent = (job.current + '/' + job.totalItems) + (name ? ' ' + name : '');
  if (job.elapsed && job.totalItems > 0) {
    const rate = job.current > 0 ? (job.elapsed / job.current / 1000).toFixed(1) : 0;
    document.getElementById('progSpeed').textContent = rate > 0 ? rate + '秒/个' : '';
  }
  if (job.status === 'done') {
    document.getElementById('progTitle').textContent = '✅ 完成';
    document.getElementById('jobIndicator').style.display = 'none';
    if (job.failed > 0) {
      document.getElementById('progStats').textContent += ' | ' + job.failed + ' ✗';
    }
  } else if (job.status === 'cancelled') {
    document.getElementById('progTitle').textContent = '⏸ 已取消';
    document.getElementById('jobIndicator').style.display = 'none';
  } else {
    // 运行中：更新标题栏任务指示器
    document.getElementById('progTitle').textContent = '📁 ' + job.projectName + ' — ' + job.type;
    var jInd = document.getElementById('jobIndicator');
    jInd.style.display = 'flex';
    document.getElementById('jobIndicatorText').textContent = job.current + '/' + job.totalItems;
    jInd.title = '项目: ' + job.projectName + '\n任务: ' + job.type + '\n点击显示进度面板';
  }
  if (job.failed > 0 && job.status === 'running') {
    document.getElementById('progStats').style.color = '#d97706';
  }
}

async function pollJob(jobId) {
  _currentJobId = jobId;
  if (_pollTimer) clearInterval(_pollTimer);

  return new Promise(function(resolve, reject) {
    _pollTimer = setInterval(async function() {
      try {
        const job = await api.get('/api/jobs/' + jobId);
        updateProgressUI(job);

        if (job.status === 'done') {
          clearInterval(_pollTimer);
          _pollTimer = null;
          _currentJobId = null;
          document.getElementById('jobIndicator').style.display = 'none';
          const skipped = job.skipped || 0;
          addLog('✅ 完成：' + job.completed + ' 成功' + (skipped > 0 ? ' / ' + skipped + ' 跳过' : '') + ' / ' + job.failed + ' 失败');
          setStatus('完成：成功 ' + job.completed);
          updateProgressUI(Object.assign({}, job, { status: 'done' }));
          // 自动复制 NAS 路径
          if (job.nasDir) {
            copyText(job.nasDir);
            addLog('📋 已自动复制 NAS 路径: ' + job.nasDir);
            toast('✅ 完成！NAS 路径已复制到剪贴板', 'success');
          }
          setTimeout(function() { document.getElementById('progressPanel').classList.remove('show'); }, 3000);
          resolve(job);
        } else if (job.status === 'cancelled') {
          clearInterval(_pollTimer);
          _pollTimer = null;
          _currentJobId = null;
          document.getElementById('jobIndicator').style.display = 'none';
          addLog('⏸ 任务已取消');
          setStatus('已取消');
          updateProgressUI(Object.assign({}, job, { status: 'cancelled' }));
          setTimeout(function() { document.getElementById('progressPanel').classList.remove('show'); }, 1500);
          resolve(job);
        }
      } catch (e) { /* 继续轮询 */ }
    }, 500);
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
  if (!confirm('确定要取消当前复制任务？\n已完成的部分不会被撤销。')) return;
  api.post('/api/jobs/' + _currentJobId + '/cancel', {});
  document.getElementById('progCurrent').textContent = '正在取消...';
}

function hideProgress() {
  document.getElementById('progressPanel').classList.remove('show');
  if (_currentJobId) {
    document.getElementById('jobIndicator').style.display = 'flex';
    toast('任务在后台继续运行，点击标题栏 ⏳ 可查看进度', 'info');
  }
}

// ==================== 刷新/切换警告 ====================
window.addEventListener('beforeunload', function(e) {
  if (_currentJobId) {
    e.preventDefault();
    e.returnValue = '有复制任务正在进行中！刷新或关闭页面会中断任务。';
    return e.returnValue;
  }
});

// selectProject 时检测后台任务
var _origSelectProject = selectProject;
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

// ==================== 文件夹浏览（系统原生） ====================
async function pickFolder(inputId) {
  try {
    // 尝试使用 File System Access API（Chrome 86+ / Edge 86+）
    if (window.showDirectoryPicker) {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      const el = document.getElementById(inputId);
      if (el) {
        const confirmPath = prompt('已将文件夹"' + handle.name + '"加入选择。\n请在此粘贴完整路径（在资源管理器地址栏 Ctrl+C 复制后在此 Ctrl+V）：', handle.name);
        if (confirmPath) {
          el.value = confirmPath.trim();
          toast('已设置路径', 'success');
        }
      }
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return; // 用户取消
  }

  // 回退方案：后端辅助（Powershell）
  try {
    const r = await api.post('/api/pick-folder', {});
    if (r.success && r.path) {
      const el = document.getElementById(inputId);
      if (el) { el.value = r.path; toast('已选择路径', 'success'); }
      else toast('未找到输入框: ' + inputId, 'error');
    } else if (r.error) {
      const manualPath = prompt('浏览文件夹失败，请手动粘贴路径\n（在资源管理器地址栏 Ctrl+C 后在此 Ctrl+V）', '');
      if (manualPath) {
        const el = document.getElementById(inputId);
        if (el) el.value = manualPath.trim();
      }
    }
  } catch (e) {
    const manualPath = prompt('浏览失败: ' + (e.message || '未知') + '\n请手动粘贴路径', '');
    if (manualPath) {
      const el = document.getElementById(inputId);
      if (el) el.value = manualPath.trim();
    }
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
    if (d) api.post('/api/open-explorer', { path: d });
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

// ==================== 服务状态 & 重启 ====================
async function refreshServerStatus() {
  var el = document.getElementById('serverIndicator');
  if (!el) return;
  try {
    var r = await api.get('/api/server/status');
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
  var drop = document.getElementById('statusDrop');
  drop.innerHTML = '';
  var items = [
    { label: '🔄 重启服务', action: restartServer },
    { label: '⏹ 关闭服务并退出', action: stopServer }
  ];
  for (var i = 0; i < items.length; i++) {
    var o = document.createElement('div');
    o.className = 'so';
    o.textContent = items[i].label;
    o.onclick = (function(fn) { return function(ev) { ev.stopPropagation(); drop.classList.remove('show'); fn(); }; })(items[i].action);
    drop.appendChild(o);
  }
  var rect = e.currentTarget.getBoundingClientRect();
  drop.style.left = rect.left + 'px';
  drop.style.top = (rect.bottom + 2) + 'px';
  drop.classList.add('show');
}

async function restartServer() {
  if (!confirm('确定要重启服务？\n重启后页面将自动刷新，请等待约 3 秒。')) return;
  try {
    var r = await api.post('/api/server/restart', {});
    toast(r.message || '服务重启中...', 'warn');
    var attempts = 0;
    var check = setInterval(function() {
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
  var saved = localStorage.getItem('pam-theme');
  if (saved === 'dark') document.body.classList.add('dark');
  var btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = saved === 'dark' ? '☀️' : '🌙';
})();
function toggleTheme() {
  var isDark = document.body.classList.toggle('dark');
  localStorage.setItem('pam-theme', isDark ? 'dark' : 'light');
  var btn = document.getElementById('themeToggle');
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

// ==================== 键盘快捷键 ====================
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); showProjectDlg(-1); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); var s = document.getElementById('searchInput'); if (s) s.focus(); }
  }
  if (e.key === 'F5') { e.preventDefault(); if (sel >= 0) { refreshDetail(); refreshModify(); refresh000(); refreshHistory(); } }
  if (e.key === 'Delete' && sel >= 0) { e.preventDefault(); delProject(); }
  if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
});

// ==================== 请求超时封装 (2分钟) ====================
var _apiFetch = async function(url, options) {
  options = options || {};
  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 120000);
  try {
    var res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
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
