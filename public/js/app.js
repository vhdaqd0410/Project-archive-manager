// ==================== API 工具 ====================
const api = {
  async get(url) { const r = await fetch(url); return r.json(); },
  async post(url, data) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return r.json();
  },
  async put(url, data) {
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return r.json();
  },
  async del(url) {
    const r = await fetch(url, { method: 'DELETE' });
    return r.json();
  }
};

// ==================== 状态 ====================
const state = {
  projects: [],
  selectedIndex: -1,
  settings: { keyword: '项目归档资料', templates: [] },
  currentResolved: null,     // 当前选中项目的 resolveEpisodeDirs 结果
  editingProject: null,       // 编辑模式：-1=新建, >=0=编辑该项目
  importCandidates: [],       // 批量导入候选列表
  importTemplates: []         // 批量导入弹窗中的模板快照
};

// ==================== DOM 引用 ====================
const $ = id => document.getElementById(id);
const el = {
  projectList: $('projectList'),
  projectCount: $('projectCount'),
  editProjectBtn: $('editProjectBtn'),
  deleteProjectBtn: $('deleteProjectBtn'),
  keywordInput: $('keywordInput'),
  emptyState: $('emptyState'),
  detailContent: $('detailContent'),
  infoLocalDir: $('infoLocalDir'),
  infoNasDir: $('infoNasDir'),
  detectLocal: $('detectLocal'),
  detectNas: $('detectNas'),
  detectSummary: $('detectSummary'),
  pendingList: $('pendingList'),
  pendingCount: $('pendingCount'),
  statusText: $('statusText'),
  // 弹窗
  projectModal: $('projectModal'),
  modalTitle: $('modalTitle'),
  formName: $('formName'),
  formLocalDir: $('formLocalDir'),
  formNasDir: $('formNasDir'),
  importModal: $('importModal'),
  importLocalRoot: $('importLocalRoot'),
  templateList: $('templateList'),
  scanSummary: $('scanSummary'),
  candidateList: $('candidateList'),
  batchOpsBar: $('batchOpsBar'),
  batchTemplateSelect: $('batchTemplateSelect'),
  // 搜索
  projectSearch: $('projectSearch'),
  // 修改交付
  modifyDetect: $('modifyDetect'),
  modifySummary: $('modifySummary'),
  modifyList: $('modifyList'),
  modifyCount: $('modifyCount')
};

// ==================== 初始化 ====================
async function init() {
  await loadProjects();
  await loadSettings();
  bindEvents();
}

async function loadProjects() {
  state.projects = await api.get('/api/projects');
  renderProjectList();
}

async function loadSettings() {
  state.settings = await api.get('/api/settings');
  el.keywordInput.value = state.settings.keyword || '项目归档资料';
}

// ==================== 项目列表渲染 ====================
function renderProjectList() {
  const searchTerm = (el.projectSearch.value || '').trim().toLowerCase();
  el.projectList.innerHTML = '';

  state.projects.forEach((p, i) => {
    if (searchTerm && !p.name.toLowerCase().includes(searchTerm)) return;
    const li = document.createElement('li');
    li.innerHTML = `<span class="item-icon">📁</span>${escHtml(p.name)}`;
    if (i === state.selectedIndex) li.classList.add('active');
    li.addEventListener('click', () => selectProject(i));
    el.projectList.appendChild(li);
  });
  el.projectCount.textContent = state.projects.length;
  el.editProjectBtn.disabled = state.selectedIndex < 0;
  el.deleteProjectBtn.disabled = state.selectedIndex < 0;
}

function selectProject(index) {
  state.selectedIndex = index;
  state.currentResolved = null;
  renderProjectList();
  if (index < 0) {
    el.emptyState.style.display = '';
    el.detailContent.style.display = 'none';
    return;
  }
  el.emptyState.style.display = 'none';
  el.detailContent.style.display = '';
  refreshDetail();
  refreshModify();
}

// ==================== 详情面板刷新 ====================
async function refreshDetail() {
  if (state.selectedIndex < 0) return;
  const p = state.projects[state.selectedIndex];
  el.infoLocalDir.textContent = p.localDir || '(未设置)';
  el.infoLocalDir.title = p.localDir || '';
  el.infoNasDir.textContent = p.nasDir || '(未设置)';
  el.infoNasDir.title = p.nasDir || '';

  // 检测关键词目录
  el.detectLocal.textContent = '扫描中...';
  el.detectNas.textContent = '扫描中...';
  el.detectSummary.textContent = '';
  el.detectSummary.className = 'detect-summary';
  el.pendingList.innerHTML = '';
  el.pendingCount.textContent = '0';

  const keyword = el.keywordInput.value.trim() || '项目归档资料';
  const resolved = await api.get(`/api/projects/${state.selectedIndex}/detect?keyword=${encodeURIComponent(keyword)}`);
  state.currentResolved = resolved;

  if (!resolved.relPath) {
    el.detectLocal.textContent = `未找到含"${keyword}"的子目录`;
    el.detectNas.textContent = `未找到含"${keyword}"的子目录`;
  } else {
    el.detectLocal.textContent = resolved.localEpDir + (resolved.localExists ? `  [${resolved.localCount} 个文件]` : '  [无法访问/不存在]');
    el.detectLocal.style.color = resolved.localExists ? '#16a34a' : '#dc2626';
    el.detectNas.textContent = resolved.nasEpDir + (resolved.nasExists ? `  [${resolved.nasCount} 个文件]` : '  [无法访问/不存在]');
    el.detectNas.style.color = resolved.nasExists ? '#16a34a' : '#94a3b8';

    const diff = resolved.localCount - resolved.nasCount;
    if (diff > 0) {
      el.detectSummary.textContent = `本地比 NAS 多 ${diff} 个文件，需要交付`;
      el.detectSummary.className = 'detect-summary warn';
    } else if (resolved.localExists && resolved.nasExists) {
      el.detectSummary.textContent = '本地与 NAS 文件一致';
      el.detectSummary.className = 'detect-summary ok';
    }
  }

  // 待交付文件
  if (resolved.relPath && resolved.localExists) {
    const pending = await api.get(`/api/projects/${state.selectedIndex}/pending?keyword=${encodeURIComponent(keyword)}`);
    renderPendingList(pending.files || []);
  }
}

function renderPendingList(files) {
  el.pendingList.innerHTML = '';
  el.pendingCount.textContent = files.length;
  if (files.length === 0) {
    el.pendingList.innerHTML = '<div class="pending-empty">✅ 没有待交付文件</div>';
    return;
  }
  files.forEach(name => {
    const div = document.createElement('div');
    div.className = 'pending-item';
    div.innerHTML = `<input type="checkbox" checked><span class="pending-name">${escHtml(name)}</span>`;
    el.pendingList.appendChild(div);
  });
}

function getCheckedPendingFiles() {
  const checks = el.pendingList.querySelectorAll('input[type="checkbox"]');
  const names = [];
  checks.forEach(cb => { if (cb.checked) { const nameEl = cb.parentElement.querySelector('.pending-name'); if (nameEl) names.push(nameEl.textContent); } });
  return names;
}

function setAllPendingChecked(checked) {
  el.pendingList.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = checked; });
}

// ==================== 事件绑定 ====================
function bindEvents() {
  // 关键字
  $('applyKeywordBtn').addEventListener('click', async () => {
    const kw = el.keywordInput.value.trim() || '项目归档资料';
    state.settings.keyword = kw;
    await api.put('/api/settings', { keyword: kw });
    refreshDetail();
  });

  // 项目操作
  $('addProjectBtn').addEventListener('click', () => openProjectModal(-1));
  $('editProjectBtn').addEventListener('click', () => {
    if (state.selectedIndex >= 0) openProjectModal(state.selectedIndex);
  });
  $('deleteProjectBtn').addEventListener('click', async () => {
    if (state.selectedIndex < 0) return;
    const p = state.projects[state.selectedIndex];
    if (!confirm(`确定删除项目「${p.name}」？（不会删除实际文件）`)) return;
    await api.del(`/api/projects/${state.selectedIndex}`);
    await loadProjects();
    if (state.selectedIndex >= state.projects.length) state.selectedIndex = state.projects.length - 1;
    if (state.selectedIndex >= 0) selectProject(state.selectedIndex);
    else { el.emptyState.style.display = ''; el.detailContent.style.display = 'none'; }
    renderProjectList();
  });
  $('batchImportBtn').addEventListener('click', () => openImportModal());

  // 操作按钮
  $('openLocalBtn').addEventListener('click', async () => {
    const p = getSelectedProject(); if (!p) return;
    const path = (state.currentResolved && state.currentResolved.localEpDir) || p.localDir;
    await api.post('/api/open-explorer', { path });
  });
  $('openNasBtn').addEventListener('click', async () => {
    const p = getSelectedProject(); if (!p) return;
    const path = (state.currentResolved && state.currentResolved.nasEpDir) || p.nasDir;
    await api.post('/api/open-explorer', { path });
  });
  $('copyPathBtn').addEventListener('click', () => {
    const p = getSelectedProject(); if (!p) return;
    const path = (state.currentResolved && state.currentResolved.nasEpDir) || p.nasDir;
    copyText(path);
    setStatus(`已复制 NAS 路径: ${path}`);
  });
  $('copyMsgBtn').addEventListener('click', () => {
    const p = getSelectedProject(); if (!p) return;
    const path = (state.currentResolved && state.currentResolved.nasEpDir) || p.nasDir;
    const countText = (state.currentResolved && state.currentResolved.nasExists) ? `  共 ${state.currentResolved.nasCount} 个文件` : '';
    const today = new Date().toISOString().slice(0, 10);
    const msg = `交付通知：\n项目：${p.name}\n存放路径：${path}${countText}\n交付时间：${today}`;
    copyText(msg);
    setStatus('已复制交付信息到剪贴板');
  });

  // 待交付操作
  $('refreshPendingBtn').addEventListener('click', () => refreshDetail());
  $('checkAllBtn').addEventListener('click', () => setAllPendingChecked(true));
  $('uncheckAllBtn').addEventListener('click', () => setAllPendingChecked(false));
  $('copySelectedBtn').addEventListener('click', async () => {
    if (state.selectedIndex < 0) return;
    const files = getCheckedPendingFiles();
    if (files.length === 0) { alert('请先勾选要复制的文件'); return; }
    const p = state.projects[state.selectedIndex];
    if (!state.currentResolved || !state.currentResolved.relPath) { alert('未检测到关键词目录'); return; }
    const keyword = el.keywordInput.value.trim() || '项目归档资料';
    try {
      const result = await api.post(`/api/projects/${state.selectedIndex}/copy`, { fileNames: files, keyword });
      if (result.success) {
        alert(`复制完成：成功 ${result.ok} 个，失败 ${result.fail} 个`);
        refreshDetail();
      } else {
        alert(`操作失败: ${result.error}`);
      }
    } catch (err) {
      alert('请求失败: ' + err.message);
    }
  });

  // ==================== 项目弹窗事件 ====================
  $('closeProjectModal').addEventListener('click', () => closeProjectModal());
  $('cancelProjectModal').addEventListener('click', () => closeProjectModal());
  $('projectModal').querySelector('.modal-overlay').addEventListener('click', () => closeProjectModal());
  $('saveProjectBtn').addEventListener('click', saveProject);

  // 表单自动填充项目名（新建时，输入本地目录后自动提取末级文件夹名）
  let nameUserEdited = false;
  el.formName.addEventListener('input', () => { nameUserEdited = true; });
  el.formLocalDir.addEventListener('input', () => {
    if (state.editingProject >= 0 || nameUserEdited) return;
    const leaf = el.formLocalDir.value.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    if (leaf) { el.formName.value = leaf; }
  });

  // ==================== 批量导入弹窗事件 ====================
  $('closeImportModal').addEventListener('click', () => closeImportModal());
  $('closeImportBtn').addEventListener('click', () => closeImportModal());
  $('importModal').querySelector('.modal-overlay').addEventListener('click', () => closeImportModal());
  $('scanBtn').addEventListener('click', doScan);
  $('addTemplateBtn').addEventListener('click', addTemplateRow);
  $('doImportBtn').addEventListener('click', doImport);
  $('selectAllCandidatesBtn').addEventListener('click', () => setAllCandidatesChecked(true));
  $('deselectAllCandidatesBtn').addEventListener('click', () => setAllCandidatesChecked(false));
  $('applyBatchTemplateBtn').addEventListener('click', applyBatchTemplate);

  // 项目搜索
  el.projectSearch.addEventListener('input', () => renderProjectList());

  // 修改交付
  $('modifyRefreshBtn').addEventListener('click', () => refreshModify());
  $('modifyCheckAllBtn').addEventListener('click', () => {
    el.modifyList.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
  });
  $('modifyUncheckBtn').addEventListener('click', () => {
    el.modifyList.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  });
  $('modifyCopyBtn').addEventListener('click', () => copyModifyBatches());
}

// ==================== 项目弹窗 ====================
function openProjectModal(editIndex) {
  state.editingProject = editIndex;
  el.modalTitle.textContent = editIndex >= 0 ? '编辑项目' : '新建项目';
  if (editIndex >= 0) {
    const p = state.projects[editIndex];
    el.formName.value = p.name;
    el.formLocalDir.value = p.localDir;
    el.formNasDir.value = p.nasDir;
  } else {
    el.formName.value = '';
    el.formLocalDir.value = '';
    el.formNasDir.value = '';
  }
  el.projectModal.style.display = '';
}

function closeProjectModal() {
  el.projectModal.style.display = 'none';
}

async function saveProject() {
  const name = el.formName.value.trim();
  if (!name) { alert('请输入项目名称'); return; }
  const data = {
    name,
    localDir: el.formLocalDir.value.trim(),
    nasDir: el.formNasDir.value.trim()
  };
  if (state.editingProject >= 0) {
    await api.put(`/api/projects/${state.editingProject}`, data);
  } else {
    await api.post('/api/projects', data);
  }
  closeProjectModal();
  await loadProjects();
  if (state.editingProject >= 0) {
    state.selectedIndex = state.editingProject;
  } else {
    state.selectedIndex = state.projects.length - 1;
  }
  selectProject(state.selectedIndex);
}

// ==================== 批量导入弹窗 ====================
function openImportModal() {
  state.importCandidates = [];
  state.importTemplates = JSON.parse(JSON.stringify(state.settings.templates || []));
  el.importLocalRoot.value = '';
  el.candidateList.innerHTML = '';
  el.scanSummary.textContent = '';
  el.batchOpsBar.style.display = 'flex';
  renderTemplateList();
  renderCandidateList();
  el.importModal.style.display = '';
}

function closeImportModal() {
  el.importModal.style.display = 'none';
}

// 模板管理
function renderTemplateList() {
  el.templateList.innerHTML = '';
  state.importTemplates.forEach((t, i) => {
    const div = document.createElement('div');
    div.className = 'template-item';
    div.innerHTML = `
      <input class="template-name" value="${escHtml(t.name)}" placeholder="部门名" data-idx="${i}">
      <input class="template-path" value="${escHtml(t.path)}" placeholder="NAS 路径，例如 \\\\NAS\\部门1" data-idx="${i}">
      <button class="btn btn-sm btn-outline" data-action="del-template" data-idx="${i}">删除</button>
    `;
    el.templateList.appendChild(div);
  });

  // 绑定事件
  el.templateList.querySelectorAll('.template-name').forEach(inp => {
    inp.addEventListener('input', () => { state.importTemplates[inp.dataset.idx].name = inp.value; });
  });
  el.templateList.querySelectorAll('.template-path').forEach(inp => {
    inp.addEventListener('input', () => { state.importTemplates[inp.dataset.idx].path = inp.value; });
  });
  el.templateList.querySelectorAll('[data-action="del-template"]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.importTemplates.splice(parseInt(btn.dataset.idx), 1);
      renderTemplateList();
    });
  });
}

function addTemplateRow() {
  state.importTemplates.push({ name: '', path: '' });
  renderTemplateList();
}

// 扫描
async function doScan() {
  const localRoot = el.importLocalRoot.value.trim();
  if (!localRoot) { alert('请输入本地根目录'); return; }

  // 保存模板
  await api.put('/api/import/templates', { templates: state.importTemplates });
  state.settings.templates = state.importTemplates;

  const result = await api.post('/api/import/scan', { localRoot });
  if (result.error) { alert(result.error); return; }

  state.importCandidates = (result.candidates || []).map(c => ({
    ...c,
    nasDir: '',
    checked: true,
    templateIndex: -1
  }));

  el.scanSummary.textContent = `共 ${result.totalDirs} 个子文件夹，已跳过 ${result.skipCount} 个已有项目，可导入 ${result.candidates.length} 个`;
  renderCandidateList();
}

function renderCandidateList() {
  el.candidateList.innerHTML = '';
  if (state.importCandidates.length === 0) {
    el.candidateList.innerHTML = '<div class="pending-empty">暂无候选项目，请先扫描</div>';
    return;
  }

  state.importCandidates.forEach((c, i) => {
    const nasPreview = c.nasDir || (c.templateIndex >= 0 && state.importTemplates[c.templateIndex]
      ? (state.importTemplates[c.templateIndex].path.replace(/[\\/]+$/, '') + '\\' + c.name)
      : '(未设置)');

    const div = document.createElement('div');
    div.className = 'candidate-item';
    div.innerHTML = `
      <input type="checkbox" ${c.checked ? 'checked' : ''} data-idx="${i}">
      <span class="cand-name" title="${escHtml(c.name)}">${escHtml(c.name)}</span>
      <span class="cand-local" title="${escHtml(c.localDir)}">${escHtml(c.localDir)}</span>
      <select data-idx="${i}" style="width:120px">
        <option value="-1">选择部门...</option>
        ${state.importTemplates.map((t, ti) => `<option value="${ti}" ${c.templateIndex === ti ? 'selected' : ''}>${escHtml(t.name || `模板${ti + 1}`)}</option>`).join('')}
      </select>
      <span class="cand-nas" title="${escHtml(nasPreview)}">${escHtml(nasPreview)}</span>
    `;
    el.candidateList.appendChild(div);
  });

  // 绑定事件
  el.candidateList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      state.importCandidates[cb.dataset.idx].checked = cb.checked;
    });
  });
  el.candidateList.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.idx);
      state.importCandidates[idx].templateIndex = parseInt(sel.value);
      if (state.importCandidates[idx].templateIndex >= 0) {
        state.importCandidates[idx].nasDir = (state.importTemplates[state.importCandidates[idx].templateIndex].path || '').replace(/[\\/]+$/, '') + '\\' + state.importCandidates[idx].name;
      } else {
        state.importCandidates[idx].nasDir = '';
      }
      renderCandidateList();
    });
  });

  // 更新批量操作模板下拉
  el.batchTemplateSelect.innerHTML = '<option value="">选择模板...</option>' +
    state.importTemplates.map((t, i) => `<option value="${i}">${escHtml(t.name || `模板${i + 1}`)}</option>`).join('');
}

function setAllCandidatesChecked(checked) {
  state.importCandidates.forEach(c => { c.checked = checked; });
  el.candidateList.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = checked; });
}

function applyBatchTemplate() {
  const ti = parseInt(el.batchTemplateSelect.value);
  if (isNaN(ti) || ti < 0) { alert('请先选择一个模板'); return; }
  const template = state.importTemplates[ti];
  const basePath = (template.path || '').replace(/[\\/]+$/, '');
  state.importCandidates.forEach(c => {
    if (c.checked) {
      c.templateIndex = ti;
      c.nasDir = basePath + '\\' + c.name;
    }
  });
  renderCandidateList();
}

async function doImport() {
  const items = state.importCandidates.filter(c => c.checked).map(c => ({
    name: c.name,
    localDir: c.localDir,
    nasDir: c.nasDir
  }));
  if (items.length === 0) { alert('请先勾选要导入的项目'); return; }

  // 保存模板
  await api.put('/api/import/templates', { templates: state.importTemplates });
  state.settings.templates = state.importTemplates;

  const result = await api.post('/api/import/batch', { items });
  if (result.success) {
    alert(`成功导入 ${result.added} 个项目`);
    closeImportModal();
    await loadProjects();
    if (state.projects.length > 0 && state.selectedIndex < 0) {
      state.selectedIndex = 0;
      selectProject(0);
    }
  } else {
    alert(`导入失败: ${result.error}`);
  }
}

// ==================== 修改交付（上映单集版） ====================
async function refreshModify() {
  if (state.selectedIndex < 0) return;
  const keyword = '上映单集版';

  try {
    const result = await api.get(`/api/projects/${state.selectedIndex}/modify-batches?keyword=${encodeURIComponent(keyword)}`);
    if (!result.found) {
      el.modifyDetect.innerHTML = `<span class="detect-value" style="color:#94a3b8">未找到含"${escHtml(keyword)}"的目录</span>`;
      el.modifySummary.textContent = '';
      el.modifyList.innerHTML = '';
      el.modifyCount.textContent = '0';
      return;
    }

    const batches = result.batches || [];
    el.modifyDetect.innerHTML = `<span class="detect-value">本地: ${escHtml(result.localKwDir)}</span><br><span class="detect-value">NAS: ${escHtml(result.nasKwDir)}</span>`;

    const newBatches = batches.filter(b => !b.nasExists);
    el.modifyCount.textContent = newBatches.length;
    el.modifySummary.className = 'detect-summary';
    if (batches.length === 0) {
      el.modifySummary.textContent = '暂无修改批次';
    } else if (newBatches.length > 0) {
      el.modifySummary.textContent = `${newBatches.length} 个批次待交付`;
      el.modifySummary.className = 'detect-summary warn';
    } else {
      el.modifySummary.textContent = '✅ 所有批次已交付';
      el.modifySummary.className = 'detect-summary ok';
    }

    renderModifyBatchList(batches);
  } catch (err) {
    el.modifyDetect.innerHTML = '<span class="detect-value" style="color:#dc2626">检测失败</span>';
  }
}

function renderModifyBatchList(batches) {
  el.modifyList.innerHTML = '';
  if (batches.length === 0) {
    el.modifyList.innerHTML = '<div class="pending-empty">📭 暂无修改批次</div>';
    return;
  }
  batches.forEach(b => {
    const div = document.createElement('div');
    div.className = 'pending-item';
    const status = b.nasExists
      ? '<span style="color:#16a34a;font-size:11px;margin-left:auto">✅ 已交付</span>'
      : '<span style="color:#d97706;font-size:11px;margin-left:auto">⚠️ 待交付</span>';
    div.innerHTML = `<input type="checkbox" ${b.nasExists ? '' : 'checked'}><span class="pending-name">📁 ${escHtml(b.name)} <span style="color:#94a3b8;font-size:11px">(${b.localFileCount} 个文件)</span></span>${status}`;
    el.modifyList.appendChild(div);
  });
}

async function copyModifyBatches() {
  if (state.selectedIndex < 0) return;
  const checks = el.modifyList.querySelectorAll('input[type="checkbox"]');
  const batchNames = [];
  checks.forEach(cb => {
    if (cb.checked) {
      const nameEl = cb.parentElement.querySelector('.pending-name');
      if (nameEl) {
        const text = nameEl.textContent.replace('📁 ', '').split(' (')[0];
        batchNames.push(text);
      }
    }
  });
  if (batchNames.length === 0) { alert('请先勾选要交付的批次'); return; }
  const keyword = '上映单集版';
  try {
    const result = await api.post(`/api/projects/${state.selectedIndex}/modify-copy-batch`, { batchNames, keyword });
    if (result.success) {
      alert(`复制完成：成功 ${result.ok} 个批次，失败 ${result.fail} 个`);
      refreshModify();
    } else {
      alert(`操作失败: ${result.error}`);
    }
  } catch (err) {
    alert('请求失败: ' + err.message);
  }
}

// ==================== 工具函数 ====================
function getSelectedProject() {
  if (state.selectedIndex < 0 || state.selectedIndex >= state.projects.length) return null;
  return state.projects[state.selectedIndex];
}

function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {
    // 降级方案
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

function setStatus(msg) {
  el.statusText.textContent = msg;
  setTimeout(() => { if (el.statusText.textContent === msg) el.statusText.textContent = ''; }, 4000);
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ==================== 键盘快捷键 ====================
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === 'Escape') {
    closeProjectModal();
    closeImportModal();
  }
});

// ==================== 启动 ====================
init();
