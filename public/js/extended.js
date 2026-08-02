/**
 * 扩展功能管理面板 (Features 7-12)
 * 在设置弹窗中管理定时自动化、通知渠道、钩子、存储、用户、工作流
 */
(function() {
  'use strict';

  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch('/api' + path, opts);
    return r.json();
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // 用于 onclick 属性内的 JS 字符串上下文，额外转义引号和反斜杠
  function escAttr(s) {
    return esc(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/\\/g, '&#92;');
  }

  async function showExtTab(tab) {
    const panel = document.getElementById('extPanel');
    if (!panel) return;
    panel.innerHTML = '<div style="text-align:center;color:#94a3b8">加载中...</div>';
    try {
      switch (tab) {
        case 'scheduler': await renderScheduler(panel); break;
        case 'notify': await renderNotify(panel); break;
        case 'hooks': await renderHooks(panel); break;
        case 'storage': await renderStorage(panel); break;
        case 'auth': await renderAuth(panel); break;
        case 'workflow': await renderWorkflow(panel); break;
      }
    } catch (e) {
      panel.innerHTML = '<div style="color:#ef4444">加载失败: ' + esc(e.message) + '</div>';
    }
  }

  // ── 定时自动化 ──
  async function renderScheduler(panel) {
    const tasks = await api('GET', '/scheduler');
    let html = '<div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">' +
      '<span style="font-weight:600;color:#334155">定时任务 (' + tasks.length + ')</span>' +
      '<button class="btn btn-sm btn-primary" onclick="window._extAddScheduler()" style="font-size:11px">+ 新建</button>' +
    '</div>';
    if (!tasks.length) { html += '<div style="color:#94a3b8">暂无定时任务</div>'; }
    else {
      html += '<div style="border:1px solid #e2e8f0;border-radius:7px;overflow:hidden">';
      for (const t of tasks) {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:12px">' +
          '<div><span style="font-weight:600;color:#334155">' + esc(t.name) + '</span> ' +
          '<span style="color:#64748b;font-family:monospace">' + esc(t.cron) + '</span>' +
          '<br><span style="color:#94a3b8;font-size:10px">动作: ' + esc(t.action) + (t.lastRun ? ' | 上次: ' + esc(t.lastRun) : '') + '</span></div>' +
          '<div style="display:flex;gap:4px">' +
            '<button class="btn btn-sm btn-outline" onclick="window._extRunScheduler(\'' + escAttr(t.id) + '\')" style="font-size:10px">运行</button>' +
            '<button class="btn btn-sm btn-danger" onclick="window._extDelScheduler(\'' + escAttr(t.id) + '\')" style="font-size:10px">删除</button>' +
          '</div>' +
        '</div>';
      }
      html += '</div>';
    }
    panel.innerHTML = html;
  }

  window._extAddScheduler = function() {
    const name = prompt('任务名称:');
    if (!name) return;
    const cron = prompt('Cron 表达式 (如 */30 * * * * = 每30分钟):');
    if (!cron) return;
    const action = prompt('动作 (detect_episodes / check_nas):', 'detect_episodes');
    api('POST', '/scheduler', { id: 'task-' + Date.now(), name, cron, action, config: {} })
      .then(() => showExtTab('scheduler')).catch(e => alert('失败: ' + e.message));
  };
  window._extRunScheduler = function(id) {
    api('POST', '/scheduler/' + id + '/run').then(() => { toast('任务已触发', 'success'); showExtTab('scheduler'); });
  };
  window._extDelScheduler = function(id) {
    if (!confirm('确定删除?')) return;
    api('DELETE', '/scheduler/' + id).then(() => showExtTab('scheduler'));
  };

  // ── 通知渠道 ──
  async function renderNotify(panel) {
    const channels = await api('GET', '/notify/channels');
    let html = '<div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">' +
      '<span style="font-weight:600;color:#334155">通知渠道 (' + channels.length + ')</span>' +
      '<div style="display:flex;gap:4px">' +
        '<button class="btn btn-sm btn-outline" onclick="window._extTestNotify()" style="font-size:11px">测试</button>' +
        '<button class="btn btn-sm btn-primary" onclick="window._extAddNotify()" style="font-size:11px">+ 新建</button>' +
      '</div></div>';
    if (!channels.length) { html += '<div style="color:#94a3b8">暂无通知渠道，通知将仅通过浏览器推送</div>'; }
    else {
      html += '<div style="border:1px solid #e2e8f0;border-radius:7px;overflow:hidden">';
      for (const ch of channels) {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:12px">' +
          '<div><span style="font-weight:600;color:#334155">' + esc(ch.name) + '</span> ' +
          '<span style="color:#3b82f6;background:#dbeafe;border-radius:3px;padding:1px 4px;font-size:10px">' + esc(ch.type) + '</span>' +
          (ch.enabled ? '' : ' <span style="color:#94a3b8">(已禁用)</span>') + '</div>' +
          '<div style="display:flex;gap:4px">' +
            '<button class="btn btn-sm btn-outline" onclick="window._extToggleNotify(\'' + escAttr(ch.id) + '\',' + !ch.enabled + ')" style="font-size:10px">' + (ch.enabled ? '禁用' : '启用') + '</button>' +
            '<button class="btn btn-sm btn-danger" onclick="window._extDelNotify(\'' + escAttr(ch.id) + '\')" style="font-size:10px">删除</button>' +
          '</div></div>';
      }
      html += '</div>';
    }
    panel.innerHTML = html;
  }

  window._extAddNotify = function() {
    const name = prompt('渠道名称:');
    if (!name) return;
    const type = prompt('类型 (dingtalk / wecom / email):', 'dingtalk');
    if (!type) return;
    const webhook = prompt('Webhook URL' + (type === 'email' ? ' (留空)' : '') + ':');
    api('POST', '/notify/channels', { id: 'ch-' + Date.now(), name, type, config: { webhook } })
      .then(() => showExtTab('notify'));
  };
  window._extToggleNotify = function(id, enabled) {
    api('PUT', '/notify/channels/' + id, { enabled }).then(() => showExtTab('notify'));
  };
  window._extDelNotify = function(id) {
    if (!confirm('确定删除?')) return;
    api('DELETE', '/notify/channels/' + id).then(() => showExtTab('notify'));
  };
  window._extTestNotify = function() {
    api('POST', '/notify/test', { title: '测试通知', body: '来自项目档案管理器的测试消息' })
      .then(() => toast('测试通知已发送', 'success'));
  };

  // ── 钩子 ──
  async function renderHooks(panel) {
    const hooks = await api('GET', '/hooks');
    const events = await api('GET', '/hooks/events');
    let html = '<div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">' +
      '<span style="font-weight:600;color:#334155">钩子 (' + hooks.length + ')</span>' +
      '<button class="btn btn-sm btn-primary" onclick="window._extAddHook(' + JSON.stringify(events).replace(/"/g, '&quot;') + ')" style="font-size:11px">+ 新建</button>' +
    '</div>';
    if (!hooks.length) { html += '<div style="color:#94a3b8">暂无钩子。钩子可在文件复制前后执行自定义脚本。</div>'; }
    else {
      html += '<div style="border:1px solid #e2e8f0;border-radius:7px;overflow:hidden">';
      for (const h of hooks) {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:12px">' +
          '<div><span style="font-weight:600;color:#334155">' + esc(h.name) + '</span> ' +
          '<span style="color:#3b82f6;background:#dbeafe;border-radius:3px;padding:1px 4px;font-size:10px">' + esc(h.event) + '</span>' +
          '<br><span style="color:#94a3b8;font-size:10px">脚本: ' + esc(h.scriptPath) + (h.enabled ? '' : ' (已禁用)') + '</span></div>' +
          '<button class="btn btn-sm btn-danger" onclick="window._extDelHook(\'' + escAttr(h.id) + '\')" style="font-size:10px">删除</button>' +
        '</div>';
      }
      html += '</div>';
    }
    html += '<div style="margin-top:8px;font-size:10px;color:#94a3b8">事件: ' + events.join(', ') + '</div>';
    panel.innerHTML = html;
  }

  window._extAddHook = function(events) {
    const name = prompt('钩子名称:');
    if (!name) return;
    const event = prompt('事件 (' + events.join(', ') + '):', 'post_copy');
    if (!event) return;
    const scriptPath = prompt('脚本路径 (如 copy-done.bat):');
    if (!scriptPath) return;
    api('POST', '/hooks', { id: 'hook-' + Date.now(), name, event, scriptPath, config: {} })
      .then(() => showExtTab('hooks'));
  };
  window._extDelHook = function(id) {
    if (!confirm('确定删除?')) return;
    api('DELETE', '/hooks/' + id).then(() => showExtTab('hooks'));
  };

  // ── 存储后端 ──
  async function renderStorage(panel) {
    const backends = await api('GET', '/storage');
    let html = '<div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">' +
      '<span style="font-weight:600;color:#334155">存储后端 (' + backends.length + ')</span>' +
      '<button class="btn btn-sm btn-primary" onclick="window._extAddStorage()" style="font-size:11px">+ 新建</button>' +
    '</div>';
    html += '<div style="border:1px solid #e2e8f0;border-radius:7px;overflow:hidden">';
    for (const b of backends) {
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:12px">' +
        '<div><span style="font-weight:600;color:#334155">' + esc(b.name) + '</span> ' +
        '<span style="color:#3b82f6;background:#dbeafe;border-radius:3px;padding:1px 4px;font-size:10px">' + esc(b.type) + '</span></div>' +
        '<button class="btn btn-sm btn-outline" onclick="window._extTestStorage(\'' + escAttr(b.id) + '\')" style="font-size:10px">测试</button>' +
      '</div>';
    }
    html += '</div>';
    html += '<div style="margin-top:8px;font-size:10px;color:#94a3b8">S3 类型需要安装 @aws-sdk/client-s3</div>';
    panel.innerHTML = html;
  }

  window._extAddStorage = function() {
    const name = prompt('后端名称:');
    if (!name) return;
    const type = prompt('类型 (local / s3):', 'local');
    if (!type) return;
    const cfg = type === 's3' ? prompt('S3 配置 (JSON):', '{"endpoint":"","region":"auto","accessKeyId":"","secretAccessKey":"","bucket":""}') : '{}';
    api('POST', '/storage', { id: 'be-' + Date.now(), name, type, config: JSON.parse(cfg) })
      .then(() => showExtTab('storage')).catch(e => alert('失败: ' + e.message));
  };
  window._extTestStorage = function(id) {
    api('GET', '/storage/' + id + '/test').then(r => {
      toast(r.success ? '连接成功' : '连接失败: ' + (r.error || ''), r.success ? 'success' : 'error');
    });
  };

  // ── 用户认证 ──
  async function renderAuth(panel) {
    const users = await api('GET', '/auth/users');
    let html = '<div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">' +
      '<span style="font-weight:600;color:#334155">用户 (' + users.length + ')</span>' +
      '<button class="btn btn-sm btn-primary" onclick="window._extAddUser()" style="font-size:11px">+ 新建</button>' +
    '</div>';
    if (!users.length) { html += '<div style="color:#94a3b8">暂无用户。认证未启用，所有操作默认以管理员身份执行。</div>'; }
    else {
      html += '<div style="border:1px solid #e2e8f0;border-radius:7px;overflow:hidden">';
      for (const u of users) {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:12px">' +
          '<div><span style="font-weight:600;color:#334155">' + esc(u.displayName || u.username) + '</span> ' +
          '<span style="color:#64748b;font-size:10px">@' + esc(u.username) + ' (' + esc(u.role) + ')</span></div>' +
          '<button class="btn btn-sm btn-danger" onclick="window._extDelUser(\'' + escAttr(u.id) + '\')" style="font-size:10px">删除</button>' +
        '</div>';
      }
      html += '</div>';
    }
    panel.innerHTML = html;
  }

  window._extAddUser = function() {
    const username = prompt('用户名:');
    if (!username) return;
    const password = prompt('密码:');
    if (!password) return;
    const displayName = prompt('显示名称:', username);
    const role = prompt('角色 (admin / reviewer / editor):', 'editor');
    api('POST', '/auth/users', { username, password, displayName, role })
      .then(() => showExtTab('auth')).catch(e => alert('失败: ' + e.message));
  };
  window._extDelUser = function(id) {
    if (!confirm('确定删除?')) return;
    api('DELETE', '/auth/users/' + id).then(() => showExtTab('auth'));
  };

  // ── 工作流 ──
  async function renderWorkflow(panel) {
    const defs = await api('GET', '/workflow/definitions');
    let html = '<div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">' +
      '<span style="font-weight:600;color:#334155">工作流模板 (' + defs.length + ')</span>' +
    '</div>';
    html += '<div style="border:1px solid #e2e8f0;border-radius:7px;overflow:hidden">';
    for (const d of defs) {
      html += '<div style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:12px">' +
        '<div style="font-weight:600;color:#334155">' + esc(d.name) + '</div>' +
        '<div style="font-size:10px;color:#94a3b8;margin-top:4px">' +
          d.steps.map(function(s, i) { return (i + 1) + '.' + esc(s.name); }).join(' → ') +
        '</div>' +
      '</div>';
    }
    html += '</div>';
    html += '<div style="margin-top:8px;font-size:10px;color:#94a3b8">在项目详情页可启动工作流实例</div>';
    panel.innerHTML = html;
  }

  // 暴露到全局
  window.showExtTab = showExtTab;
})();
