var api = {
  get: async u => (await fetch(u)).json(),
  post: async (u, d) => (await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })).json(),
  put: async (u, d) => (await fetch(u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })).json(),
  del: async u => (await fetch(u, { method: 'DELETE' })).json()
};

var projects = [], settings = {}, sel = -1, resolved = null, scanResults = [];
var nasDirModify = '', nasDir000 = '';
var localDirModify = '', localDir000 = '';
var batchSel = {};

window.onload = async function() {
  projects = await api.get('/api/projects');
  settings = await api.get('/api/settings');
  document.getElementById('keywordInput').value = settings.keyword || '项目归档资料';
  renderProjectList();
};

function $(id) { return document.getElementById(id); }

// ==================== 批量操作 ====================
function updateBatchBar() {
  var keys = Object.keys(batchSel).filter(function(k) { return batchSel[k]; });
  var bar = $('batchBar'), count = $('batchCount');
  if (keys.length > 0) { bar.style.display = ''; count.textContent = '已选 ' + keys.length + ' 个'; }
  else { bar.style.display = 'none'; }
}
function batchSelectAll() {
  var search = ($('searchInput').value || '').toLowerCase();
  for (var i = 0; i < projects.length; i++) { if (search && projects[i].name.toLowerCase().indexOf(search) < 0) continue; batchSel[i] = true; }
  renderProjectList();
}
function batchClear() { batchSel = {}; renderProjectList(); }
function toggleBatch(idx, ev) { ev.stopPropagation(); batchSel[idx] = !batchSel[idx]; updateBatchBar(); }
async function batchSetStatus() {
  var status = $('batchStatus').value;
  var keys = Object.keys(batchSel).filter(function(k) { return batchSel[k]; });
  if (keys.length === 0) { alert('请先勾选项目'); return; }
  for (var k = 0; k < keys.length; k++) await api.put('/api/projects/' + keys[k] + '/status', { status: status });
  batchSel = {}; projects = await api.get('/api/projects'); renderProjectList();
  if (sel >= 0 && sel < projects.length) selectProject(sel);
}
async function batchDelete() {
  var keys = Object.keys(batchSel).filter(function(k) { return batchSel[k]; });
  if (keys.length === 0) { alert('请先勾选项目'); return; }
  if (!confirm('确定删除 ' + keys.length + ' 个项目？')) return;
  keys.sort(function(a,b) { return b - a; });
  for (var k = 0; k < keys.length; k++) await api.del('/api/projects/' + keys[k]);
  batchSel = {}; projects = await api.get('/api/projects'); if (sel >= projects.length) sel = projects.length - 1;
  renderProjectList(); if (sel >= 0) selectProject(sel); else $('rightPanel').innerHTML = '<div class="empty">请从左侧选择项目，或新建项目</div>';
}

// ==================== 项目列表 ====================
function renderProjectList() {
  var list = $('projectList'), search = ($('searchInput').value || '').toLowerCase();
  list.innerHTML = '';
  var editing = [], modifying = [], done = [];
  for (var i = 0; i < projects.length; i++) {
    var p = projects[i];
    if (search && p.name.toLowerCase().indexOf(search) < 0) continue;
    (p.status === 'done' ? done.push(i) : p.status === 'modifying' ? modifying.push(i) : editing.push(i));
  }
  function group(label, indices) {
    var h = document.createElement('div'); h.className = 'cat-label';
    h.innerHTML = '<span class="arr">▼</span> ' + label + ' (' + indices.length + ')';
    h.onclick = function() { this.classList.toggle('folded'); refresh(this); };
    list.appendChild(h);
    for (var j = 0; j < indices.length; j++) {
      var idx = indices[j], p = projects[idx], s = p.status || 'editing';
      var d = document.createElement('div'); d.className = 'item ' + s + (idx === sel ? ' sel' : '');
      d.innerHTML = '<input type="checkbox" style="accent-color:#3b82f6;width:13px;height:13px;flex-shrink:0"' + (batchSel[idx] ? ' checked' : '') + ' onclick="toggleBatch(' + idx + ',event)"><span class="dot"></span>' + esc(p.name);
      d.onclick = (function(i) { return function() { selectProject(i); }; })(idx);
      list.appendChild(d);
    }
    refresh(h);
  }
  function refresh(h) { var f = h.classList.contains('folded'), e = h.nextElementSibling; while (e && !e.classList.contains('cat-label')) { e.style.display = f ? 'none' : ''; e = e.nextElementSibling; } }
  group('🔵 剪辑中', editing);
  group('🟠 修改中', modifying);
  group('✅ 已完成', done);
  $('projectCount').textContent = projects.length;
}

function selectProject(idx) {
  sel = idx; resolved = null; renderProjectList();
  var rp = $('rightPanel');
  if (idx < 0) { rp.innerHTML = '<div class="empty">请从左侧选择项目，或新建项目</div>'; return; }
  var p = projects[idx];
  rp.innerHTML =
    '<div class="card"><div class="card-hdr">📂 项目目录</div><div class="card-body"><div class="info-row"><span class="lbl">本地</span><span class="val" id="infoLocalDir">' + esc(p.localDir||'-') + '</span></div><div class="info-row"><span class="lbl">NAS</span><span class="val" id="infoNasDir">' + esc(p.nasDir||'-') + '</span></div></div></div>' +
    '<div class="card"><div class="card-hdr">🔍 关键词目录检测</div><div class="card-body"><div id="detectLocal" style="font-size:12px;color:#94a3b8">扫描中...</div><div id="detectNas" style="font-size:12px;color:#94a3b8">扫描中...</div><div id="detectSummary" style="font-size:12px;margin-top:4px"></div></div></div>' +
    '<div class="act-bar"><button class="btn btn-primary" id="btnOpenLocal">打开本地</button><button class="btn btn-primary" id="btnOpenNas">打开NAS</button><button class="btn btn-outline" id="btnCopyPath">复制NAS路径</button><button class="btn btn-outline" id="btnCopyMsg">复制交付信息</button></div>' +
    '<div class="card"><div class="card-hdr">⚠ 待交付文件 <span id="pendingCount" style="margin-left:8px">0</span></div><div class="card-body"><div class="pending-list" id="pendingList"></div><div class="act-bar"><button class="btn btn-sm btn-outline" id="btnRefresh">刷新</button><button class="btn btn-sm btn-outline" id="btnCheckAll">全选</button><button class="btn btn-sm btn-outline" id="btnUncheckAll">取消全选</button><button class="btn btn-sm btn-warn" id="btnCopy">复制选中到NAS</button></div></div></div>' +
    '<div class="card"><div class="card-hdr">🎬 上映单集版 · 修改交付 <span id="modifyCount" style="margin-left:8px">0</span></div><div class="card-body"><div id="modifyInfo" style="font-size:11px;color:#94a3b8">检测中...</div><div id="modifySummary" style="font-size:12px;margin:4px 0"></div><div class="pending-list" id="modifyList"></div><div class="act-bar"><button class="btn btn-sm btn-primary" id="btnModOpenLocal">打开本地</button><button class="btn btn-sm btn-primary" id="btnModOpenNas">打开NAS</button><button class="btn btn-sm btn-outline" id="btnModRefresh">刷新</button><button class="btn btn-sm btn-outline" id="btnModCheckAll">全选</button><button class="btn btn-sm btn-outline" id="btnModUncheckAll">取消全选</button><button class="btn btn-sm btn-outline" id="btnModCopyPath">复制路径</button><button class="btn btn-sm btn-warn" id="btnModCopy">复制选中到NAS</button></div></div></div>' +
    '<div class="card"><div class="card-hdr">📦 000交付 <span id="count000" style="margin-left:8px">0</span></div><div class="card-body"><div id="info000" style="font-size:11px;color:#94a3b8">检测中...</div><div id="summary000" style="font-size:12px;margin:4px 0"></div><div class="pending-list" id="list000"></div><div class="act-bar"><button class="btn btn-sm btn-primary" id="btn000OpenLocal">打开本地</button><button class="btn btn-sm btn-primary" id="btn000OpenNas">打开NAS</button><button class="btn btn-sm btn-outline" id="btn000Refresh">刷新</button><button class="btn btn-sm btn-outline" id="btn000CheckAll">全选</button><button class="btn btn-sm btn-outline" id="btn000UncheckAll">取消全选</button><button class="btn btn-sm btn-outline" id="btn000CopyPath">复制路径</button><button class="btn btn-sm btn-warn" id="btn000Copy">复制选中到NAS</button></div></div></div>' +
    '<div class="card"><div class="card-hdr">📋 运行日志</div><div class="card-body" id="logPanel" style="max-height:200px;overflow-y:auto;font-family:Consolas,monospace;font-size:11px;color:#64748b;padding:8px 12px"><div id="logContent">就绪</div></div></div>';
  bindEvents();
  refreshDetail();
  refreshModify();
  refresh000();
}

function bindEvents() {
  var b = $('btnOpenLocal'); if (b) b.onclick = function() { if (resolved && resolved.localEpDir) api.post('/api/open-explorer', { path: resolved.localEpDir }); };
  b = $('btnOpenNas'); if (b) b.onclick = function() { if (resolved && resolved.nasEpDir) api.post('/api/open-explorer', { path: resolved.nasEpDir }); };
  b = $('btnCopyPath'); if (b) b.onclick = function() { copyText((resolved && resolved.nasEpDir) || projects[sel].nasDir); };
  b = $('btnCopyMsg'); if (b) b.onclick = copyDeliveryMsg;
  b = $('btnRefresh'); if (b) b.onclick = refreshPending;
  b = $('btnCheckAll'); if (b) b.onclick = function() { checkAll('pendingList', true); };
  b = $('btnUncheckAll'); if (b) b.onclick = function() { checkAll('pendingList', false); };
  b = $('btnCopy'); if (b) b.onclick = copyPending;
  b = $('btnModRefresh'); if (b) b.onclick = refreshModify;
  b = $('btnModCheckAll'); if (b) b.onclick = function() { checkAll('modifyList', true); };
  b = $('btnModUncheckAll'); if (b) b.onclick = function() { checkAll('modifyList', false); };
  b = $('btnModCopy'); if (b) b.onclick = copyModifyBatches;
  b = $('btnModCopyPath'); if (b) b.onclick = function() { copyCheckedPaths('modifyList', nasDirModify); };
  b = $('btnModOpenLocal'); if (b) b.onclick = function() { api.post('/api/open-explorer', { path: localDirModify }); };
  b = $('btnModOpenNas'); if (b) b.onclick = function() { api.post('/api/open-explorer', { path: nasDirModify }); };
  b = $('btn000Refresh'); if (b) b.onclick = refresh000;
  b = $('btn000CheckAll'); if (b) b.onclick = function() { checkAll('list000', true); };
  b = $('btn000UncheckAll'); if (b) b.onclick = function() { checkAll('list000', false); };
  b = $('btn000Copy'); if (b) b.onclick = copy000Delivery;
  b = $('btn000CopyPath'); if (b) b.onclick = function() { copyCheckedPaths('list000', nasDir000); };
  b = $('btn000OpenLocal'); if (b) b.onclick = function() { api.post('/api/open-explorer', { path: localDir000 }); };
  b = $('btn000OpenNas'); if (b) b.onclick = function() { api.post('/api/open-explorer', { path: nasDir000 }); };
}

// ==================== 异步日志逐条显示 ====================
async function logResults(results, prefix) {
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    addLog((r.success ? '✓' : '✗') + ' ' + (prefix || '') + (r.file || r.name || '?'));
    await new Promise(function(resolve) { setTimeout(resolve, 30); });
  }
}

// ==================== 检测 ====================
async function refreshDetail() {
  if (sel < 0) return;
  try {
    var kw = $('keywordInput').value || '项目归档资料';
  resolved = await api.get('/api/projects/' + sel + '/detect?keyword=' + encodeURIComponent(kw));
  var dl = $('detectLocal'), dn = $('detectNas'), ds = $('detectSummary');
  if (!resolved.relPath) { dl.textContent = '未找到含"' + kw + '"的子目录'; dn.textContent = ''; ds.textContent = ''; }
  else {
    dl.innerHTML = esc(resolved.localEpDir) + ' <span style="color:' + (resolved.localExists ? '#22c55e' : '#ef4444') + '">[' + (resolved.localExists ? resolved.localCount + ' 个文件' : '不存在') + ']</span>';
    dn.innerHTML = esc(resolved.nasEpDir) + ' <span style="color:' + (resolved.nasExists ? '#22c55e' : '#94a3b8') + '">[' + (resolved.nasExists ? resolved.nasCount + ' 个文件' : '不存在') + ']</span>';
    var d = resolved.localCount - resolved.nasCount;
    if (d > 0) ds.innerHTML = '<span style="color:#f59e0b">⚠ 本地比NAS多 ' + d + ' 个文件</span>';
    else if (resolved.localExists && resolved.nasExists) ds.innerHTML = '<span style="color:#22c55e">✓ 文件一致</span>';
  }
  refreshPending();
  } catch(e) { var x = $('detectLocal'); if (x) x.textContent = '检测失败'; }
}

async function refreshPending() {
  var list = $('pendingList'); if (!list) return;
  list.innerHTML = '';
  if (!resolved || !resolved.relPath || !resolved.localExists) return;
  var data = await api.get('/api/projects/' + sel + '/pending?keyword=' + encodeURIComponent($('keywordInput').value || '项目归档资料'));
  var files = data.files || [];
  $('pendingCount').textContent = files.length + ' 个';
  if (files.length === 0) { list.innerHTML = '<div class="empty">没有待交付文件</div>'; return; }
  for (var i = 0; i < files.length; i++) {
    var d = document.createElement('div'); d.className = 'pi';
    d.innerHTML = '<input type="checkbox" checked><span>' + esc(files[i]) + '</span>'; list.appendChild(d);
  }
}

async function copyPending() {
  var cbs = document.querySelectorAll('#pendingList input[type=checkbox]');
  var files = []; for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) files.push(cbs[i].nextElementSibling.textContent);
  if (files.length === 0) { alert('请先勾选'); return; }
  addLog('📤 开始复制 ' + files.length + ' 个文件...');
  var r = await api.post('/api/projects/' + sel + '/copy', { fileNames: files, keyword: $('keywordInput').value || '项目归档资料' });
  if (r.results) await logResults(r.results, '');
  addLog('✅ 完成：' + (r.ok||0) + ' 成功 / ' + (r.fail||0) + ' 失败');
  if (r.nasDir) addLog('📍 NAS: ' + r.nasDir);
  setStatus('复制完成：成功 ' + (r.ok||0) + ' 个');
  refreshDetail();
}

// ==================== 修改交付 ====================
async function refreshModify() {
  if (sel < 0) return;
  try {
    var data = await api.get('/api/projects/' + sel + '/modify-batches?keyword=' + encodeURIComponent('上映单集版'));
    var mi = $('modifyInfo'), ms = $('modifySummary'), ml = $('modifyList'), mc = $('modifyCount');
    if (!mi) return;
    if (!data.found) { mi.textContent = '未找到"上映单集版"目录'; return; }
    mi.textContent = '本地: ' + data.localKwDir + '\nNAS: ' + data.nasKwDir;
    var batches = data.batches || [], nc = 0;
    ml.innerHTML = '';
    for (var i = 0; i < batches.length; i++) {
      var b = batches[i];
      var d = document.createElement('div'); d.className = 'pi';
      d.innerHTML = '<input type="checkbox" ' + (b.nasExists ? '' : 'checked') + '><span>' + esc(b.name) + ' (' + b.localFileCount + '个) ' + (b.nasExists ? '[已交付]' : '[待交付]') + '</span>';
      ml.appendChild(d);
      if (!b.nasExists) nc++;
    }
    mc.textContent = nc + ' 待交付';
    ms.innerHTML = nc > 0 ? '<span style="color:#f59e0b">' + nc + ' 个批次待交付</span>' : '<span style="color:#22c55e">全部已交付</span>';
    nasDirModify = data.nasKwDir || "; localDirModify = data.localKwDir || ";
  } catch(e) { ($('modifyInfo')||{}).textContent = '检测失败: ' + e.message; }
}

async function copyModifyBatches() {
  var cbs = document.querySelectorAll('#modifyList input[type=checkbox]');
  var names = []; for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) names.push(cbs[i].nextElementSibling.textContent.split(' (')[0]);
  if (names.length === 0) { alert('请先勾选'); return; }
  addLog('📤 开始复制 ' + names.length + ' 个批次...');
  var r = await api.post('/api/projects/' + sel + '/modify-copy-batch', { batchNames: names, keyword: '上映单集版' });
  if (r.results) await logResults(r.results, '');
  addLog('✅ 完成：' + (r.ok||0) + ' 成功 / ' + (r.fail||0) + ' 失败');
  if (r.nasDir) addLog('📍 NAS: ' + r.nasDir);
  setStatus('完成：' + (r.ok||0) + ' 成功');
  refreshModify();
}

// ==================== 弹窗：项目 ====================
function showProjectDlg(editIdx) {
  var p = editIdx >= 0 ? projects[editIdx] : { name: '', localDir: '', nasDir: '', status: 'editing' };
  var h = '<div class="fg"><label>项目名称</label><input id="dlgName" value="' + escAttr(p.name) + '"></div>';
  h += '<div class="fg"><label>本地根目录（从资源管理器地址栏复制）</label><input id="dlgLocal" value="' + escAttr(p.localDir) + '"></div>';
  h += '<div class="fg"><label>NAS根目录（从地址栏复制）</label><input id="dlgNas" value="' + escAttr(p.nasDir) + '"></div>';
  var s = p.status || 'editing';
  h += '<div class="fg"><label>状态</label><select id="dlgStatus"><option value="editing"' + (s==='editing'?' selected':'') + '>🔵 剪辑中</option><option value="modifying"' + (s==='modifying'?' selected':'') + '>🟠 修改中</option><option value="done"' + (s==='done'?' selected':'') + '>✅ 已完成</option></select></div>';
  h += '<div class="modal-btns"><button class="btn btn-primary" onclick="saveProject(' + editIdx + ')">保存</button><button class="btn btn-outline" onclick="closeModal()">取消</button></div>';
  $('modalTitle').textContent = editIdx >= 0 ? '编辑项目' : '新建项目';
  $('modalBody').innerHTML = h;
  $('modalOverlay').style.display = 'flex';
}

async function saveProject(editIdx) {
  var data = { name: $('dlgName').value.trim(), localDir: $('dlgLocal').value.trim(), nasDir: $('dlgNas').value.trim(), status: $('dlgStatus').value };
  if (!data.name) { alert('请输入名称'); return; }
  if (editIdx >= 0) await api.put('/api/projects/' + editIdx, data);
  else await api.post('/api/projects', data);
  closeModal(); projects = await api.get('/api/projects');
  renderProjectList(); selectProject(editIdx >= 0 ? editIdx : projects.length - 1);
}

async function delProject() { if (sel < 0) return; if (!confirm('确定删除「' + projects[sel].name + '」？')) return; await api.del('/api/projects/' + sel); projects = await api.get('/api/projects'); if (sel >= projects.length) sel = projects.length - 1; renderProjectList(); selectProject(sel); }

// ==================== 弹窗：批量导入 ====================
function showImportDlg() {
  var h = '<div class="fg"><label>本地根目录（从地址栏复制）</label><input id="dlgImportRoot"></div>';
  h += '<div class="fg"><label>部门模板</label><div id="dlgTplList"></div><button class="btn btn-sm btn-outline" onclick="addTpl()">+ 添加</button></div>';
  h += '<div style="margin:8px 0"><button class="btn btn-primary" onclick="doScan()">扫描子文件夹</button> <span id="dlgScanInfo" style="color:#94a3b8;font-size:12px"></span></div>';
  h += '<div id="dlgScanResult" style="max-height:260px;overflow:auto"></div>';
  h += '<div class="modal-btns"><button class="btn btn-accent" onclick="doImport()">导入选中</button><button class="btn btn-outline" onclick="closeModal()">关闭</button></div>';
  $('modalTitle').textContent = '批量导入项目';
  $('modalBody').innerHTML = h;
  $('modalOverlay').style.display = 'flex';
  for (var i = 0; i < (settings.templates || []).length; i++) addTplRow(settings.templates[i].name, settings.templates[i].path, i);
}

window._tplIdx = 0;
function addTpl() { addTplRow('', '', window._tplIdx++); }
function addTplRow(name, path, idx) {
  var c = $('dlgTplList'), d = document.createElement('div'); d.className = 'ir'; d.style.marginBottom = '4px';
  d.innerHTML = '<input class="tpl-name" value="' + escAttr(name) + '" placeholder="部门名" style="width:80px"><input class="tpl-path" value="' + escAttr(path) + '" placeholder="NAS路径" style="flex:1"><button class="btn btn-sm btn-outline" onclick="this.parentElement.remove()">X</button>';
  c.appendChild(d);
}

async function doScan() {
  scanResults = []; $('dlgScanResult').innerHTML = '';
  var root = $('dlgImportRoot').value.trim(); if (!root) { alert('请输入本地根目录'); return; }
  // 保存模板
  var ns = document.querySelectorAll('#dlgTplList .tpl-name'), ps = document.querySelectorAll('#dlgTplList .tpl-path');
  var tpls = []; for (var i = 0; i < ns.length; i++) tpls.push({ name: ns[i].value.trim(), path: ps[i].value.trim() });
  await api.put('/api/import/templates', { templates: tpls }); settings.templates = tpls;
  // 扫描
  var r = await api.post('/api/import/scan', { localRoot: root });
  if (r.error) { alert(r.error); return; }
  scanResults = r.candidates || [];
  $('dlgScanInfo').textContent = '可导入 ' + scanResults.length + ' 个';
  for (var i = 0; i < scanResults.length; i++) {
    var d = document.createElement('div'); d.className = 'pi';
    d.innerHTML = '<input type="checkbox" checked><span>' + esc(scanResults[i].name) + ' <span style="color:#94a3b8;font-size:11px">' + esc(scanResults[i].localDir) + '</span></span>';
    $('dlgScanResult').appendChild(d);
  }
}

async function doImport() {
  var cbs = document.querySelectorAll('#dlgScanResult input[type=checkbox]');
  var items = []; for (var i = 0; i < scanResults.length && i < cbs.length; i++) if (cbs[i].checked) items.push({ name: scanResults[i].name, localDir: scanResults[i].localDir });
  if (items.length === 0) { alert('请先勾选'); return; }
  var r = await api.post('/api/import/batch', { items: items });
  if (r.success) { alert('成功导入 ' + r.added + ' 个'); closeModal(); projects = await api.get('/api/projects'); renderProjectList(); }
}

// ==================== 000交付 ====================
async function refresh000() {
  if (sel < 0) return;
  try {
    var data = await api.get('/api/projects/' + sel + '/modify-batches?keyword=' + encodeURIComponent('000交付'));
  var mi = $('info000'), ms = $('summary000'), ml = $('list000'), mc = $('count000');
  if (!mi) return;
  if (!data.found) { mi.textContent = '未找到"000交付"目录'; return; }
  mi.textContent = '本地: ' + data.localKwDir + '\nNAS: ' + data.nasKwDir;
  var batches = data.batches || [], nc = 0;
  ml.innerHTML = '';
  for (var i = 0; i < batches.length; i++) {
    var b = batches[i];
    var d = document.createElement('div'); d.className = 'pi';
    d.innerHTML = '<input type="checkbox" ' + (b.nasExists ? '' : 'checked') + '><span>' + esc(b.name) + ' (' + b.localFileCount + '个) ' + (b.nasExists ? '[已交付]' : '[待交付]') + '</span>';
    ml.appendChild(d);
    if (!b.nasExists) nc++;
  }
  mc.textContent = nc + ' 待交付';
  ms.innerHTML = nc > 0 ? '<span style="color:#f59e0b">' + nc + ' 个文件夹待交付</span>' : '<span style="color:#22c55e">全部已交付</span>';
    nasDir000 = data.nasKwDir || "; localDir000 = data.localKwDir || ";
  } catch(e) { ($('info000')||{}).textContent = '检测失败: ' + e.message; }
}

async function copy000Delivery() {
  var cbs = document.querySelectorAll('#list000 input[type=checkbox]');
  var names = []; for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) names.push(cbs[i].nextElementSibling.textContent.split(' (')[0]);
  if (names.length === 0) { alert('请先勾选'); return; }
  addLog('📤 开始复制 ' + names.length + ' 个文件夹...');
  var r = await api.post('/api/projects/' + sel + '/modify-copy-batch', { batchNames: names, keyword: '000交付' });
  if (r.results) await logResults(r.results, '');
  addLog('✅ 完成：' + (r.ok||0) + ' 成功 / ' + (r.fail||0) + ' 失败');
  if (r.nasDir) addLog('📍 NAS: ' + r.nasDir);
  setStatus('完成：' + (r.ok||0) + ' 成功');
  refresh000();
}

// ==================== 工具 ====================
function closeModal() { $('modalOverlay').style.display = 'none'; }
function setStatus(m) { $('statusText').textContent = m; }
function addLog(msg) { var t = new Date().toLocaleTimeString(); var lc = $('logContent'); if (lc) lc.innerHTML += '<div>[' + t + '] ' + esc(msg) + '</div>'; var lp = $('logPanel'); if (lp) lp.scrollTop = lp.scrollHeight; }
function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function escAttr(s) { return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function checkAll(listId, checked) { var cbs = document.querySelectorAll('#' + listId + ' input[type=checkbox]'); for (var i = 0; i < cbs.length; i++) cbs[i].checked = checked; }
function copyText(text) { navigator.clipboard.writeText(text).catch(function() {}); setStatus('已复制'); }
function copyCheckedPaths(listId, baseDir) {
  var cbs = document.querySelectorAll('#' + listId + ' input[type=checkbox]');
  var paths = [];
  for (var i = 0; i < cbs.length; i++) if (cbs[i].checked) {
    var name = cbs[i].nextElementSibling.textContent.split(' (')[0];
    paths.push(baseDir + '\\' + name);
  }
  if (paths.length === 0) paths.push(baseDir);
  copyText(paths.join('\n'));
}
function copyDeliveryMsg() {
  if (sel < 0) return;
  var path = (resolved && resolved.nasEpDir) || projects[sel].nasDir;
  var cnt = (resolved && resolved.nasCount) || 0;
  var d = new Date(), ds = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  copyText('交付通知：\n项目：' + projects[sel].name + '\n路径：' + path + ' (' + cnt + ' 个)\n时间：' + ds);
}
function pad(n) { return n < 10 ? '0' + n : n; }
function applyKeyword() { settings.keyword = $('keywordInput').value; api.put('/api/settings', { keyword: settings.keyword }); refreshDetail(); }
