/**
 * 新增功能前端模块
 * 标签 / 模板 / 审计日志 / 文件预览 / 复制回滚 / WebDAV
 */
(function() {
  'use strict';

  const api = window.api || {
    get: async u => (await fetch(u)).json(),
    post: async (u, d) => (await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })).json(),
    put: async (u, d) => (await fetch(u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })).json(),
    del: async u => (await fetch(u, { method: 'DELETE' })).json()
  };

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function escAttr(s) { return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function toast(msg, type) { if (window.toast) window.toast(msg, type); }

  // ==================== 标签管理 ====================
  let _allTags = [];
  let _projectTagFilter = null;

  async function loadTags() {
    try { _allTags = await api.get('/api/tags'); } catch(e) { _allTags = []; }
    return _allTags;
  }

  async function getProjectTags(projectId) {
    try { return await api.get('/api/tags/project/' + projectId); } catch(e) { return []; }
  }

  async function setProjectTags(projectId, tagIds) {
    return api.put('/api/tags/project/' + projectId, { tagIds });
  }

  function renderTagBadges(tags) {
    if (!tags || !tags.length) return '';
    return tags.map(t => `<span class="tag-badge" style="background:${t.color || '#3b82f6'}20;color:${t.color || '#3b82f6'};border:1px solid ${t.color || '#3b82f6'}40">${esc(t.name)}</span>`).join('');
  }

  function showTagManager(projectId) {
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').textContent = '🏷️ 标签管理';
    let html = '<div style="margin-bottom:12px">';
    html += '<div style="display:flex;gap:6px;margin-bottom:8px">';
    html += '<input id="tagNewName" placeholder="新标签名" style="flex:1;height:34px;border:1px solid var(--border);border-radius:7px;padding:0 12px;font-size:13px;background:var(--input-bg);color:var(--text)">';
    html += '<input id="tagNewColor" type="color" value="#3b82f6" style="width:40px;height:34px;border:none;border-radius:6px;cursor:pointer;background:none">';
    html += '<button class="btn btn-primary" onclick="window.Features.createTag()">+ 创建</button>';
    html += '</div>';
    html += '<div id="tagAllList" style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:12px"></div>';
    html += '</div>';
    html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">项目标签（勾选分配给当前项目）</div>';
    html += '<div id="tagProjectList" style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px"></div>';
    html += '<div class="modal-btns"><button class="btn btn-primary" onclick="window.Features.saveProjectTags(\'' + projectId + '\')">保存</button><button class="btn btn-outline" onclick="window.closeModal()">取消</button></div>';
    document.getElementById('modalBody').innerHTML = html;
    overlay.style.display = 'flex';
    refreshTagManager(projectId);
  }

  async function refreshTagManager(projectId) {
    await loadTags();
    const projectTags = await getProjectTags(projectId);
    const projectTagIds = new Set(projectTags.map(t => t.id));

    const allList = document.getElementById('tagAllList');
    if (allList) {
      allList.innerHTML = _allTags.length ? _allTags.map(t => `
        <div style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--border-light)">
          <span style="width:12px;height:12px;border-radius:3px;background:${t.color || '#3b82f6'};flex-shrink:0"></span>
          <span style="flex:1;font-size:13px">${esc(t.name)}</span>
          <span style="font-size:10px;color:var(--text-muted)">${t.projectCount || 0}项目</span>
          <button class="btn btn-sm btn-outline" style="color:#ef4444;border-color:#ef444430" onclick="window.Features.deleteTag('${t.id}')">✕</button>
        </div>`).join('') : '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:12px">暂无标签</div>';
    }

    const projList = document.getElementById('tagProjectList');
    if (projList) {
      projList.innerHTML = _allTags.length ? _allTags.map(t => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border-light)">
          <input type="checkbox" class="tag-cb" data-id="${t.id}" ${projectTagIds.has(t.id) ? 'checked' : ''} style="accent-color:#3b82f6;width:16px;height:16px">
          <span style="width:14px;height:14px;border-radius:3px;background:${t.color || '#3b82f6'};flex-shrink:0"></span>
          <span style="flex:1;font-size:13px">${esc(t.name)}</span>
        </div>`).join('') : '<div style="padding:12px;text-align:center;color:var(--text-muted);font-size:12px">请先创建标签</div>';
    }
  }

  async function createTag() {
    const name = document.getElementById('tagNewName').value.trim();
    const color = document.getElementById('tagNewColor').value;
    if (!name) { toast('请输入标签名', 'warn'); return; }
    await api.post('/api/tags', { name, color });
    toast('标签已创建', 'success');
    document.getElementById('tagNewName').value = '';
    const projectId = document.getElementById('tagProjectList') ? document.querySelector('[onclick^="window.Features.saveProjectTags"]')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1] : null;
    if (projectId) refreshTagManager(projectId);
  }

  async function deleteTag(id) {
    if (!confirm('确定删除此标签？将从所有项目中移除。')) return;
    await api.del('/api/tags/' + id);
    toast('标签已删除', 'success');
    const saveBtn = document.querySelector('[onclick^="window.Features.saveProjectTags"]');
    if (saveBtn) {
      const pid = saveBtn.getAttribute('onclick').match(/'([^']+)'/)[1];
      refreshTagManager(pid);
    }
  }

  async function saveProjectTags(projectId) {
    const cbs = document.querySelectorAll('.tag-cb');
    const tagIds = [];
    cbs.forEach(cb => { if (cb.checked) tagIds.push(cb.dataset.id); });
    await setProjectTags(projectId, tagIds);
    toast('标签已保存', 'success');
    window.closeModal();
    if (typeof window.renderProjectList === 'function') window.renderProjectList();
  }

  // 标签筛选
  function renderTagFilter(container) {
    if (!container) return;
    if (!_allTags.length) { container.innerHTML = ''; return; }
    let html = '<div style="display:flex;gap:4px;flex-wrap:wrap;padding:4px 10px;border-bottom:1px solid var(--border-light)">';
    html += `<button class="btn btn-sm ${!_projectTagFilter ? 'btn-primary' : 'btn-outline'}" style="font-size:10px;padding:2px 8px" onclick="window.Features.setTagFilter(null)">全部</button>`;
    for (const t of _allTags) {
      const active = _projectTagFilter === t.id;
      html += `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}" style="font-size:10px;padding:2px 8px;border-color:${t.color}40" onclick="window.Features.setTagFilter('${t.id}')">${esc(t.name)}</button>`;
    }
    html += '</div>';
    container.innerHTML = html;
  }

  function setTagFilter(tagId) {
    _projectTagFilter = tagId;
    if (typeof window.renderProjectList === 'function') window.renderProjectList();
  }

  function getTagFilter() { return _projectTagFilter; }

  // ==================== 项目模板 ====================
  async function showTemplatePicker(callback) {
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').textContent = '📋 从模板创建';
    let templates = [];
    try { templates = await api.get('/api/import/templates'); } catch(e) {}
    let html = '';
    if (!templates.length) {
      html = '<div style="padding:20px;text-align:center;color:var(--text-muted)">暂无模板。<br>在项目编辑中可以保存当前项目为模板。</div>';
    } else {
      html = '<div style="max-height:300px;overflow-y:auto">';
      for (const t of templates) {
        const cfg = t.config || {};
        html += `<div style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between" onclick="window.Features.applyTemplate('${t.id}','${callback}')">`;
        html += `<div style="flex:1;cursor:pointer"><div style="font-weight:600;font-size:13px">${esc(t.name)}</div>`;
        html += `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">`;
        if (cfg.episodeTarget) html += `🎯 ${cfg.episodeTarget}集 `;
        if (cfg.nasDir) html += `📁 ${esc(cfg.nasDir)} `;
        if (cfg.tags && cfg.tags.length) html += `🏷️ ${cfg.tags.length}标签`;
        html += `</div></div>`;
        html += `<button class="btn btn-sm btn-outline" style="color:#ef4444;border-color:#ef444430;padding:2px 8px;font-size:11px" onclick="event.stopPropagation();window.Features.deleteTemplate('${t.id}','${callback}')">✕</button>`;
        html += `</div>`;
      }
      html += '</div>';
    }
    html += `<div class="modal-btns"><button class="btn btn-outline" onclick="window.closeModal()">取消</button></div>`;
    document.getElementById('modalBody').innerHTML = html;
    overlay.style.display = 'flex';
  }

  async function deleteTemplate(id, callback) {
    if (!confirm('确定删除此模板？')) return;
    try {
      await api.del('/api/import/templates/' + id);
      toast('模板已删除', 'success');
      showTemplatePicker(callback);
    } catch(e) { toast('删除失败: ' + e.message, 'error'); }
  }

  async function applyTemplate(templateId, callback) {
    try {
      const t = await api.get('/api/import/templates/' + templateId);
      const cfg = t.config || {};
      window.closeModal();
      if (window[callback]) window[callback](cfg);
      toast('模板已应用', 'success');
    } catch(e) { toast('应用模板失败: ' + e.message, 'error'); }
  }

  async function saveAsTemplate(projectData) {
    const name = prompt('模板名称', projectData.name + ' 模板');
    if (!name) return;
    const config = {
      localDir: projectData.localDir,
      nasDir: projectData.nasDir,
      episodeTarget: projectData.episodeTarget,
      episodeAssignments: projectData.episodeAssignments,
      memo: projectData.memo,
    };
    await api.post('/api/import/templates', { name, config });
    toast('模板已保存', 'success');
  }

  // ==================== 审计日志查看器 ====================
  async function showAuditLogs() {
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').textContent = '📜 操作日志';
    let html = '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">';
    html += '<input id="auditUser" placeholder="用户名筛选" style="height:30px;border:1px solid var(--border);border-radius:6px;padding:0 10px;font-size:12px;background:var(--input-bg);color:var(--text);width:120px">';
    html += '<input id="auditAction" placeholder="操作类型" style="height:30px;border:1px solid var(--border);border-radius:6px;padding:0 10px;font-size:12px;background:var(--input-bg);color:var(--text);width:120px">';
    html += '<button class="btn btn-sm btn-primary" onclick="window.Features.refreshAuditLogs()">查询</button>';
    html += '</div>';
    html += '<div id="auditLogBody" style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;font-size:12px"></div>';
    html += '<div class="modal-btns"><button class="btn btn-outline" onclick="window.closeModal()">关闭</button></div>';
    document.getElementById('modalBody').innerHTML = html;
    overlay.style.display = 'flex';
    refreshAuditLogs();
  }

  async function refreshAuditLogs() {
    const body = document.getElementById('auditLogBody');
    if (!body) return;
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">加载中...</div>';
    let url = '/api/audit-logs?limit=200';
    const user = document.getElementById('auditUser')?.value.trim();
    const action = document.getElementById('auditAction')?.value.trim();
    if (user) url += '&username=' + encodeURIComponent(user);
    if (action) url += '&action=' + encodeURIComponent(action);
    try {
      const logs = await api.get(url);
      if (!logs.length) { body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">暂无日志</div>'; return; }
      body.innerHTML = logs.map(l => {
        const t = new Date(l.time).toLocaleString('zh-CN');
        return `<div style="padding:8px 10px;border-bottom:1px solid var(--border-light)">
          <span style="color:var(--text-muted);font-size:10px">${t}</span>
          <span style="color:#3b82f6;margin-left:6px">${esc(l.username || '系统')}</span>
          <span style="margin-left:6px">${esc(l.action || '')}</span>
          ${l.target ? `<span style="color:var(--text-muted);margin-left:6px">→ ${esc(l.target)}</span>` : ''}
          ${l.detail ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(l.detail)}</div>` : ''}
        </div>`;
      }).join('');
    } catch(e) { body.innerHTML = '<div style="padding:20px;color:#ef4444">加载失败: ' + esc(e.message) + '</div>'; }
  }

  // ==================== 文件预览 ====================
  let _previewCache = {};

  async function showFilePreview(projectId, keyword) {
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').textContent = '🎬 文件预览';
    let html = '<div id="previewBody" style="max-height:500px;overflow-y:auto"><div style="padding:20px;text-align:center;color:var(--text-muted)">加载中...</div></div>';
    html += '<div class="modal-btns"><button class="btn btn-outline" onclick="window.closeModal()">关闭</button></div>';
    document.getElementById('modalBody').innerHTML = html;
    overlay.style.display = 'flex';

    try {
      const data = await api.get(`/api/preview/${projectId}/files?keyword=${encodeURIComponent(keyword || '项目归档资料')}`);
      const body = document.getElementById('previewBody');
      if (!data.files || !data.files.length) {
        body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">未找到视频文件</div>';
        return;
      }
      body.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">' +
        data.files.map(f => {
          const sizeStr = f.size > 1073741824 ? (f.size/1073741824).toFixed(1)+'GB' : f.size > 1048576 ? (f.size/1048576).toFixed(1)+'MB' : (f.size/1024).toFixed(0)+'KB';
          // 悬停懒加载缩略图，点击放大预览
          return `<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;cursor:pointer" data-pid="${escAttr(projectId)}" data-path="${escAttr(f.path)}" onmouseenter="window.Features.openThumbnail(this.dataset.pid,this.dataset.path,this)" onclick="window.Features.zoomThumbnail(this)">
            <div style="height:100px;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;position:relative">
              <span style="font-size:32px">🎬</span>
              <div class="thumb-loading" style="position:absolute;bottom:4px;right:4px;font-size:10px;color:var(--text-muted);background:rgba(0,0,0,.6);padding:1px 5px;border-radius:3px">${sizeStr}</div>
            </div>
            <div style="padding:6px 8px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</div>
          </div>`;
        }).join('') + '</div>';
    } catch(e) {
      document.getElementById('previewBody').innerHTML = '<div style="padding:20px;color:#ef4444">加载失败: ' + esc(e.message) + '</div>';
    }
  }

  async function openThumbnail(projectId, filePath, container) {
    const imgDiv = container.querySelector('div:first-child');
    if (imgDiv.dataset.loaded) return;
    imgDiv.dataset.loading = '1';
    imgDiv.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">⏳ 生成中...</span>';
    try {
      const url = `/api/preview/${projectId}/thumbnail?path=${encodeURIComponent(filePath)}`;
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        const imgUrl = URL.createObjectURL(blob);
        imgDiv.innerHTML = `<img src="${imgUrl}" style="width:100%;height:100px;object-fit:cover" alt="缩略图">`;
        imgDiv.dataset.loaded = '1';
      } else {
        imgDiv.innerHTML = '<span style="font-size:24px">🎬</span><div style="position:absolute;bottom:4px;left:4px;font-size:9px;color:#f59e0b">无缩略图</div>';
        imgDiv.dataset.loaded = 'fail';
      }
    } catch(e) {
      imgDiv.innerHTML = '<span style="font-size:24px">🎬</span>';
      imgDiv.dataset.loaded = 'fail';
    } finally {
      delete imgDiv.dataset.loading;
    }
  }

  // 点击放大预览（已加载的缩略图弹大图）
  function zoomThumbnail(container) {
    const img = container.querySelector('div:first-child img');
    if (!img) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:20px';
    const big = document.createElement('img');
    big.src = img.src;
    big.style.cssText = 'max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.5)';
    overlay.appendChild(big);
    // Esc 关闭
    const onKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    overlay.onclick = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    document.body.appendChild(overlay);
  }

  // ==================== 复制回滚 ====================
  async function showRollbackHistory(projectId) {
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').textContent = '↩️ 复制回滚';
    let html = '<div id="rollbackBody" style="max-height:450px;overflow-y:auto"><div style="padding:20px;text-align:center;color:var(--text-muted)">加载中...</div></div>';
    html += '<div class="modal-btns"><button class="btn btn-outline" onclick="window.closeModal()">关闭</button></div>';
    document.getElementById('modalBody').innerHTML = html;
    overlay.style.display = 'flex';

    try {
      const ops = await api.get('/api/rollback/' + projectId);
      const body = document.getElementById('rollbackBody');
      if (!ops.length) { body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">暂无复制操作记录</div>'; return; }
      body.innerHTML = ops.map(op => {
        const t = new Date(op.createdAt).toLocaleString('zh-CN');
        const files = op.files || [];
        const rolledBack = op.rolledBack;
        return `<div style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;${rolledBack ? 'opacity:.5' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <span style="font-size:12px;font-weight:600">${esc(op.jobType || '复制')}</span>
              <span style="font-size:11px;color:var(--text-muted);margin-left:6px">${t}</span>
              <span style="font-size:11px;color:var(--text-muted);margin-left:6px">${files.length}个文件</span>
            </div>
            ${rolledBack
              ? '<span style="font-size:11px;color:#94a3b8">已回滚</span>'
              : `<button class="btn btn-sm btn-warn" onclick="window.Features.doRollback('${op.id}')">↩️ 回滚</button>`
            }
          </div>
          ${files.length ? '<div style="margin-top:6px;font-size:10px;color:var(--text-muted);max-height:60px;overflow-y:auto">' + files.map(f => esc(f.name)).join(', ') + '</div>' : ''}
        </div>`;
      }).join('');
    } catch(e) {
      document.getElementById('rollbackBody').innerHTML = '<div style="padding:20px;color:#ef4444">加载失败: ' + esc(e.message) + '</div>';
    }
  }

  async function doRollback(opId) {
    if (!confirm('⚠️ 确定回滚此操作？\n\n将删除本次复制到 NAS 的所有文件。\n此操作不可撤销！')) return;
    try {
      const r = await api.post('/api/rollback/' + opId + '/undo', {});
      if (r.success) {
        toast(`回滚完成：删除 ${r.deleted} 个文件` + (r.failed > 0 ? `，${r.failed} 个失败` : ''), r.failed > 0 ? 'warn' : 'success');
        // 刷新列表
        const body = document.getElementById('rollbackBody');
        if (body) {
          const projectId = document.querySelector('[onclick^="window.Features.showRollbackHistory"]')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
          if (projectId) showRollbackHistory(projectId);
        }
      } else {
        toast('回滚失败: ' + (r.error || '未知错误'), 'error');
      }
    } catch(e) { toast('回滚失败: ' + e.message, 'error'); }
  }

  // ==================== WebDAV 信息 ====================
  function showWebDAVInfo() {
    const overlay = document.getElementById('modalOverlay');
    document.getElementById('modalTitle').textContent = '🌐 WebDAV 服务';
    const port = 37891;
    const projects = window.projects || [];
    let html = '<div style="font-size:13px;line-height:1.8">';
    html += '<p style="color:var(--text-muted);font-size:12px">WebDAV 允许你通过网络协议挂载项目目录。可在文件管理器中"映射网络驱动器"。</p>';
    html += '<div style="background:var(--bg-secondary);border-radius:8px;padding:10px;margin:10px 0">';
    html += '<div style="font-size:12px;font-weight:600;margin-bottom:4px">服务地址</div>';
    html += `<code style="font-size:11px;color:#3b82f6">http://localhost:${port}/api/webdav/PROJECT_ID</code>`;
    html += '</div>';
    html += '<div style="font-size:12px;font-weight:600;margin-bottom:6px">可用项目</div>';
    html += '<div style="max-height:250px;overflow-y:auto;border:1px solid var(--border);border-radius:8px">';
    for (const p of projects) {
      const localUrl = `http://localhost:${port}/api/webdav/${p.id}`;
      const nasUrl = `http://localhost:${port}/api/webdav/${p.id}?nas=1`;
      html += `<div style="padding:8px 10px;border-bottom:1px solid var(--border-light)">
        <div style="font-weight:600;font-size:12px">${esc(p.name)}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">本地: <code>${localUrl}</code></div>
        <div style="font-size:10px;color:var(--text-muted)">NAS: <code>${nasUrl}</code></div>
      </div>`;
    }
    html += '</div>';
    html += '<p style="font-size:11px;color:var(--text-muted);margin-top:8px">💡 在 Windows 资源管理器中右键"此电脑" → "映射网络驱动器" → 输入上述地址</p>';
    html += '</div>';
    html += '<div class="modal-btns"><button class="btn btn-outline" onclick="window.closeModal()">关闭</button></div>';
    document.getElementById('modalBody').innerHTML = html;
    overlay.style.display = 'flex';
  }

  // ==================== 导出 ====================
  window.Features = {
    loadTags,
    getProjectTags,
    setProjectTags,
    renderTagBadges,
    renderTagFilter,
    setTagFilter,
    getTagFilter,
    showTagManager,
    createTag,
    deleteTag,
    saveProjectTags,
    showTemplatePicker,
    applyTemplate,
    saveAsTemplate,
    deleteTemplate,
    showAuditLogs,
    refreshAuditLogs,
    showFilePreview,
    openThumbnail,
    zoomThumbnail,
    showRollbackHistory,
    doRollback,
    showWebDAVInfo,
  };

  // ==================== 待交付列表悬停缩略图预览 ====================
  let _thumbFloat = null;
  let _thumbReq = 0;
  window.thumbHover = function(el, event) {
    const pid = el.dataset.pid;
    const filePath = el.dataset.path;
    if (!pid || !filePath) return;
    if (!_thumbFloat) {
      _thumbFloat = document.createElement('div');
      _thumbFloat.style.cssText = 'position:fixed;z-index:9998;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,.3);pointer-events:none;max-width:360px;display:none';
      document.body.appendChild(_thumbFloat);
    }
    const x = event.clientX + 16;
    const y = event.clientY + 16;
    _thumbFloat.style.left = Math.min(x, window.innerWidth - 380) + 'px';
    _thumbFloat.style.top = Math.min(y, window.innerHeight - 220) + 'px';
    _thumbFloat.style.display = 'block';
    _thumbFloat.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:12px">⏳ 生成缩略图...</div>';
    const reqId = ++_thumbReq;
    fetch('/api/preview/' + pid + '/thumbnail?path=' + encodeURIComponent(filePath))
      .then(r => r.ok ? r.blob() : Promise.reject(new Error('http')))
      .then(blob => {
        if (reqId !== _thumbReq || !_thumbFloat) return;
        const url = URL.createObjectURL(blob);
        _thumbFloat.innerHTML = '<img src="' + url + '" style="max-width:340px;max-height:200px;border-radius:4px;display:block">';
      })
      .catch(() => {
        if (reqId !== _thumbReq || !_thumbFloat) return;
        _thumbFloat.innerHTML = '<div style="font-size:11px;color:#f59e0b;padding:12px">🎬 无缩略图<br><span style="color:var(--text-muted);font-size:10px">需安装 ffmpeg</span></div>';
      });
  };
  window.thumbHide = function() {
    if (_thumbFloat) _thumbFloat.style.display = 'none';
    _thumbReq++;
  };
})();
