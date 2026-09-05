(function () {
  'use strict';

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    return res.json();
  }

  // ---- Bot control page ----
  const msg = document.getElementById('bot-msg');
  const logView = document.getElementById('log-view');

  async function refreshLog() {
    if (!logView) return;
    try {
      const res = await fetch('/api/bot/log?limit=400');
      const data = await res.json();
      logView.textContent = (data.log || []).join('\n') || 'لا يوجد سجل بعد.';
      logView.scrollTop = logView.scrollHeight;
      const count = document.getElementById('log-count');
      if (count) count.textContent = `${data.log.length} سطر`;
    } catch (e) {
      logView.textContent = 'تعذر تحميل السجل.';
    }
  }

  async function handleBotAction(action, btn) {
    if (!window.BOT_ROUTES) return;
    const route = window.BOT_ROUTES[action];
    if (!route) return;
    if (action === 'restart' && !confirm('هل تريد إعادة تشغيل البوت؟')) return;
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = 'جاري التنفيذ...';
    const result = await post(route, {});
    if (msg) {
      msg.textContent = result.message || (result.success ? 'تم بنجاح' : 'فشل');
      msg.style.color = result.success ? 'var(--success)' : 'var(--danger)';
    }
    setTimeout(() => location.reload(), action === 'restart' ? 1600 : 900);
  }

  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const btnRestart = document.getElementById('btn-restart');
  if (btnStart) btnStart.onclick = () => handleBotAction('start', btnStart);
  if (btnStop) btnStop.onclick = () => handleBotAction('stop', btnStop);
  if (btnRestart) btnRestart.onclick = () => handleBotAction('restart', btnRestart);

  const btnRefreshLog = document.getElementById('btn-refresh-log');
  if (btnRefreshLog) btnRefreshLog.onclick = refreshLog;
  const btnClearLog = document.getElementById('btn-clear-log');
  if (btnClearLog) {
    btnClearLog.onclick = () => { if (logView) logView.textContent = ''; };
  }

  // Auto-refresh log every 5s on bot page
  if (window.BOT_ROUTES && logView) {
    refreshLog();
    setInterval(refreshLog, 5000);
  }

  // ---- Config page ----
  const btnSaveConfig = document.getElementById('btn-save-config');
  const configEditor = document.getElementById('config-editor');
  const configMsg = document.getElementById('config-msg');
  if (btnSaveConfig && configEditor) {
    btnSaveConfig.onclick = async () => {
      try {
        const parsed = JSON.parse(configEditor.value);
        const result = await post('/api/config', parsed);
        configMsg.textContent = result.message || (result.success ? 'تم الحفظ' : 'فشل');
        configMsg.style.color = result.success ? 'var(--success)' : 'var(--danger)';
      } catch (e) {
        configMsg.textContent = 'خطأ في صيغة JSON: ' + e.message;
        configMsg.style.color = 'var(--danger)';
      }
    };
  }

  // ---- Members search ----
  const memberSearch = document.getElementById('member-search');
  const memberTable = document.getElementById('member-table');
  if (memberSearch && memberTable) {
    memberSearch.oninput = () => {
      const q = memberSearch.value.trim().toLowerCase();
      const rows = memberTable.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = !q || text.includes(q) ? '' : 'none';
      });
    };
  }

  // ---- Settings page ----
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const settingsEditor = document.getElementById('settings-editor');
  const settingsMsg = document.getElementById('settings-msg');
  if (btnSaveSettings && settingsEditor) {
    btnSaveSettings.onclick = async () => {
      try {
        const parsed = JSON.parse(settingsEditor.value);
        const result = await post('/api/settings', parsed);
        settingsMsg.textContent = result.message || 'تم الحفظ';
        settingsMsg.style.color = result.success ? 'var(--success)' : 'var(--danger)';
      } catch (e) {
        settingsMsg.textContent = 'خطأ في صيغة JSON: ' + e.message;
        settingsMsg.style.color = 'var(--danger)';
      }
    };
  }

  // ---- Role permissions editor ----
  function readPermissionEditor() {
    const roles = [];
    document.querySelectorAll('.role-perm-block').forEach(block => {
      const name = block.querySelector('[data-field="name"]')?.value || '';
      const roleId = block.querySelector('[data-field="roleId"]')?.value || '';
      const perms = [];
      block.querySelectorAll('.perm-check:checked').forEach(cb => perms.push(cb.value));
      roles.push({ roleId, name, permissions: perms });
    });
    return roles;
  }

  // Assign data-role-idx to each block (use DOM order)
  document.querySelectorAll('.role-perm-block').forEach((block, i) => {
    block.setAttribute('data-role-idx', String(i));
  });

  // When a block's inputs use data-idx, map them to the block's index
  document.querySelectorAll('.role-perm-block').forEach((block, i) => {
    block.querySelectorAll('[data-field], .perm-check').forEach(el => {
      // re-write data-idx to match the block index
      el.setAttribute('data-idx', String(i));
      el.dataset.idx = String(i); // ensure
    });
  });

  const btnSavePerms = document.getElementById('btn-save-perms');
  const permMsg = document.getElementById('perm-msg');
  if (btnSavePerms) {
    btnSavePerms.onclick = async () => {
      try {
        const roles = readPermissionEditor();
        const res = await fetch('/api/settings');
        const config = await res.json();
        config.permissions.roles = roles;
        const result = await post('/api/settings', config);
        if (permMsg) {
          permMsg.textContent = result.message || 'تم حفظ الصلاحيات';
          permMsg.style.color = result.success ? 'var(--success)' : 'var(--danger)';
        }
      } catch (e) {
        if (permMsg) {
          permMsg.textContent = 'خطأ: ' + e.message;
          permMsg.style.color = 'var(--danger)';
        }
      }
    };
  }

  function addRoleBlock() {
    const permEditor = document.getElementById('perm-editor');
    if (!permEditor) return;
    const idx = permEditor.querySelectorAll('.role-perm-block').length;
    const checks = Object.keys(window.__PERM_ITEMS || {}).map(p =>
      `<label class="check"><input type="checkbox" class="perm-check" data-idx="${idx}" value="${p}" /><span><code>${p}</code></span></label>`
    ).join('');
    const div = document.createElement('div');
    div.className = 'role-perm-block';
    div.setAttribute('data-role-idx', idx);
    div.innerHTML = `
      <div class="role-perm-head">
        <input type="text" class="input" data-field="name" data-idx="${idx}" placeholder="اسم الرتبة" />
        <input type="text" class="input mono" data-field="roleId" data-idx="${idx}" placeholder="Role ID" />
        <button type="button" class="btn btn-danger btn-sm" data-remove-role>🗑️</button>
      </div>
      <div class="perms-checks">${checks}</div>`;
    permEditor.appendChild(div);
    wireRemoveButton(div.querySelector('[data-remove-role]'));
    // close the add button? keep
  }

  function wireRemoveButton(btn) {
    if (!btn) return;
    btn.onclick = () => {
      const block = btn.closest('.role-perm-block');
      if (block) block.remove();
      if (permMsg) {
        permMsg.textContent = 'تمت إزالة الرتبة — اضغط "حفظ الصلاحيات" للتأكيد.';
        permMsg.style.color = 'var(--warning)';
      }
    };
  }

  document.querySelectorAll('[data-remove-role]').forEach(wireRemoveButton);

  const btnAddRole = document.getElementById('btn-add-role');
  if (btnAddRole) {
    btnAddRole.onclick = addRoleBlock;
  }

  // Expose permission list to JS for dynamic add
  try {
    const permText = document.querySelector('[data-perm-items]')?.getAttribute('data-perm-items') || '';
    if (permText) window.__PERM_ITEMS = JSON.parse(permText);
  } catch (e) {}

})();

