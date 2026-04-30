const ALL_TABS = ['monitoring', 'users', 'tests', 'config', 'deploy'];

document.addEventListener('DOMContentLoaded', async () => {
  const user = await API.requireAuth();
  if (!user) return;
  if (user.role !== 'superadmin' && !user.is_admin) {
    window.location.href = '/dashboard';
    return;
  }
  setupNav(user);

  const isSuperAdmin = user.role === 'superadmin';

  // Hide config/deploy tabs for non-superadmin
  if (!isSuperAdmin) {
    document.querySelectorAll('.superadmin-only').forEach(el => el.classList.add('hidden'));
  }

  // Tab switching
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('hidden')) return;
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ALL_TABS.forEach(id => {
        document.getElementById(`tab-${id}`).classList.toggle('hidden', id !== btn.dataset.tab);
      });
      if (btn.dataset.tab === 'users') loadUsers();
      if (btn.dataset.tab === 'tests') loadTestsTab();
    });
  });

  const initLoaders = [loadStats(), loadSyncLog()];
  if (isSuperAdmin) initLoaders.push(loadConfig());
  await Promise.all(initLoaders);

  if (isSuperAdmin) {
    document.getElementById('config-form').addEventListener('submit', handleConfigSave);
    document.getElementById('deploy-btn').addEventListener('click', handleDeploy);
  }
  document.getElementById('users-refresh-btn').addEventListener('click', loadUsers);
  document.getElementById('notif-test-btn').addEventListener('click', handleNotifTest);
  document.getElementById('sync-test-btn').addEventListener('click', handleSyncTest);
  document.getElementById('portal-test-btn').addEventListener('click', handlePortalTest);
});

// ── MONITORING ────────────────────────────────────────────────────────────────

async function loadStats() {
  const stats = await API.get('/admin/stats');
  if (!stats) return;

  document.getElementById('s-users').textContent = stats.user_count;
  document.getElementById('s-groups').textContent = stats.group_count;
  document.getElementById('s-assigns').textContent = stats.assignment_count;
  document.getElementById('s-email7').textContent = stats.notifications.email_7d;
  document.getElementById('s-sms7').textContent = stats.notifications.sms_7d;
  document.getElementById('s-errors').textContent = stats.sync_errors_24h;

  const sc = stats.scheduler;
  const dot = `<span class="status-dot ${sc.active ? 'green' : 'red'}"></span>`;
  const nextRun = sc.nextRunAt ? new Date(sc.nextRunAt).toLocaleTimeString('fr-CA') : '—';
  const lastRun = sc.lastRunAt ? new Date(sc.lastRunAt).toLocaleString('fr-CA') : 'Jamais';
  document.getElementById('scheduler-info').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:1.5rem">
      <div>${dot} <strong>${sc.active ? 'Actif' : 'Inactif'}</strong></div>
      <div>Intervalle : <strong>${sc.intervalMinutes ?? '—'} min</strong></div>
      <div>Prochain run estimé : <strong>${nextRun}</strong></div>
      <div>Dernier run : <strong>${lastRun}</strong></div>
    </div>`;
}

async function loadSyncLog() {
  const rows = await API.get('/admin/sync-log');
  const tbody = document.getElementById('sync-tbody');

  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-3);text-align:center">Aucune synchronisation enregistrée</td></tr>';
    document.getElementById('errors-list').textContent = 'Aucune erreur.';
    return;
  }

  // Last sync per group
  const lastByGroup = new Map();
  for (const r of rows) {
    if (!lastByGroup.has(r.group_course_code)) lastByGroup.set(r.group_course_code, r);
  }

  tbody.innerHTML = [...lastByGroup.values()].map(r => {
    const ok = r.success;
    const dot = `<span class="status-dot ${ok ? 'green' : 'red'}"></span>`;
    const date = r.finished_at ? new Date(r.finished_at).toLocaleString('fr-CA') : '—';
    return `<tr>
      <td><strong>${escapeHtml(r.group_course_code || '—')}</strong><br><small style="color:var(--text-3)">${escapeHtml(r.course_name || '')}</small></td>
      <td style="font-size:.85rem">${escapeHtml(r.user_email || '—')}</td>
      <td style="font-size:.85rem;white-space:nowrap">${date}</td>
      <td>${dot}${ok ? 'OK' : '<span style="color:var(--danger)">Erreur</span>'}</td>
      <td style="text-align:center">${r.new_scores > 0 ? `<strong style="color:var(--success)">+${r.new_scores}</strong>` : r.new_scores}</td>
    </tr>`;
  }).join('');

  // Errors in last 24h
  const errors24h = rows.filter(r => !r.success && new Date(r.started_at) > Date.now() - 86400000);
  const el = document.getElementById('errors-list');
  if (errors24h.length === 0) {
    el.textContent = 'Aucune erreur dans les dernières 24 h.';
  } else {
    el.innerHTML = errors24h.map(r => {
      const date = new Date(r.started_at).toLocaleString('fr-CA');
      return `<div style="padding:.5rem 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--danger);font-weight:600">${escapeHtml(r.group_course_code || '?')}</span>
        <span style="color:var(--text-3);font-size:.8rem;margin-left:.5rem">${date}</span><br>
        <span style="font-size:.85rem">${escapeHtml(r.error_message || 'Erreur inconnue')}</span>
      </div>`;
    }).join('');
  }
}

// ── CONFIG ────────────────────────────────────────────────────────────────────

async function loadConfig() {
  const config = await API.get('/admin/config');
  if (!config) return;
  const form = document.getElementById('config-form');
  for (const [key, val] of Object.entries(config)) {
    const el = form.elements[key];
    if (el) el.value = val;
  }
}

async function handleConfigSave(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const alertEl = document.getElementById('config-alert');
  hideAlert(alertEl);

  const body = {};
  for (const el of form.elements) {
    if (el.name) body[el.name] = el.value;
  }

  const btn = document.getElementById('config-save-btn');
  setLoading(btn, true, 'Sauvegarde…');
  const res = await API.request('POST', '/admin/config', body);
  setLoading(btn, false);

  if (res && res.ok) {
    showAlert(alertEl, 'Configuration sauvegardée.', 'success');
  } else {
    const data = res ? await res.json() : null;
    showAlert(alertEl, data?.error || 'Erreur lors de la sauvegarde.');
  }
}

// ── DEPLOY ────────────────────────────────────────────────────────────────────

function handleDeploy() {
  const btn = document.getElementById('deploy-btn');
  const output = document.getElementById('deploy-output');

  btn.disabled = true;
  output.textContent = '';
  output.classList.remove('hidden');

  const es = new EventSource('/api/admin/deploy');

  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'log') {
      output.textContent += msg.text;
      output.scrollTop = output.scrollHeight;
    } else if (msg.type === 'done' || msg.type === 'error') {
      if (msg.text) output.textContent += '\n' + msg.text + '\n';
      output.scrollTop = output.scrollHeight;
      es.close();
      btn.disabled = false;
    }
  };

  es.onerror = () => {
    output.textContent += '\n[Connexion SSE perdue]\n';
    es.close();
    btn.disabled = false;
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── USERS ─────────────────────────────────────────────────────────────────────

let _usersCache = [];

async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-3);text-align:center">Chargement…</td></tr>';
  const users = await API.get('/admin/users');
  if (!users) return;
  _usersCache = users;
  renderUsersTable(users);
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-3);text-align:center">Aucun utilisateur.</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const created = new Date(u.created_at).toLocaleDateString('fr-CA');
    const synced = u.last_synced ? new Date(u.last_synced).toLocaleString('fr-CA') : '—';
    const groups = u.groups.length > 0
      ? u.groups.map(g => `<span class="badge badge-neutral" style="margin:.1rem">${escapeHtml(g.course_code)}</span>`).join(' ')
      : '<span style="color:var(--text-3)">—</span>';
    const notif = [
      u.notify_email ? '✉️' : '<span style="color:var(--text-3)">✉</span>',
      u.notify_sms ? '📱' : '<span style="color:var(--text-3)">📵</span>',
    ].join(' ');

    let roleBadge, roleAction;
    if (u.role === 'superadmin') {
      roleBadge = '<span class="badge badge-warning">Superadmin</span>';
      roleAction = '';
    } else if (u.is_admin) {
      roleBadge = '<span class="badge badge-primary">Admin</span>';
      roleAction = `<button class="btn btn-sm btn-ghost" onclick="toggleAdmin(${u.id}, true)">Révoquer admin</button>`;
    } else {
      roleBadge = '<span style="color:var(--text-3);font-size:.85rem">Utilisateur</span>';
      roleAction = `<button class="btn btn-sm btn-ghost" onclick="toggleAdmin(${u.id}, false)">Promouvoir admin</button>`;
    }

    return `<tr>
      <td style="font-size:.85rem">${escapeHtml(u.email)}</td>
      <td style="font-size:.8rem;white-space:nowrap">${created}</td>
      <td style="font-size:.8rem;white-space:nowrap">${synced}</td>
      <td style="font-size:.8rem">${groups}</td>
      <td style="font-size:.85rem">${notif}</td>
      <td>${roleBadge}</td>
      <td style="display:flex;gap:.35rem;flex-wrap:wrap">
        ${roleAction}
        <button class="btn btn-sm btn-secondary" onclick="forceSync(${u.id})">Sync</button>
        <button class="btn btn-sm btn-secondary" onclick="resetPassword(${u.id})">Réinit. MDP</button>
        <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id}, '${escapeHtml(u.email)}')">Supprimer</button>
      </td>
    </tr>`;
  }).join('');
}

async function toggleAdmin(userId, currentlyAdmin) {
  const alertEl = document.getElementById('users-alert');
  hideAlert(alertEl);
  const res = await API.request('POST', `/admin/users/${userId}/toggle-admin`, {});
  const data = res ? await res.json() : null;
  if (data && data.ok) {
    showAlert(alertEl, `Rôle mis à jour : ${data.is_admin ? 'Admin' : 'Utilisateur standard'}.`, 'success');
    loadUsers();
  } else {
    showAlert(alertEl, data?.error || 'Erreur lors de la mise à jour du rôle.');
  }
}

async function forceSync(userId) {
  const alertEl = document.getElementById('users-alert');
  hideAlert(alertEl);
  const res = await API.request('POST', `/admin/users/${userId}/sync`, {});
  const data = res ? await res.json() : null;
  if (data && data.ok) {
    showAlert(alertEl, `Synchronisation effectuée. ${data.new_grades} nouvelles notes.`, 'success');
  } else {
    showAlert(alertEl, data?.error || 'Erreur lors de la synchronisation.');
  }
}

async function resetPassword(userId) {
  const alertEl = document.getElementById('users-alert');
  hideAlert(alertEl);
  if (!confirm('Générer un mot de passe temporaire ? Le mot de passe actuel sera remplacé.')) return;
  const res = await API.request('POST', `/admin/users/${userId}/reset-password`, {});
  const data = res ? await res.json() : null;
  if (data && data.ok) {
    showAlert(alertEl, `Mot de passe temporaire (affiché une seule fois) : ${data.temp_password}`, 'info');
  } else {
    showAlert(alertEl, data?.error || 'Erreur lors de la réinitialisation.');
  }
}

async function deleteUser(userId, email) {
  const alertEl = document.getElementById('users-alert');
  hideAlert(alertEl);
  if (!confirm(`Supprimer définitivement le compte « ${email} » ? Cette action est irréversible.`)) return;
  const res = await API.request('DELETE', `/admin/users/${userId}`);
  const data = res ? await res.json() : null;
  if (data && data.ok) {
    showAlert(alertEl, `Compte « ${escapeHtml(email)} » supprimé.`, 'success');
    loadUsers();
  } else {
    showAlert(alertEl, data?.error || 'Erreur lors de la suppression.');
  }
}

// ── TESTS ─────────────────────────────────────────────────────────────────────

async function loadTestsTab() {
  const [users, groups] = await Promise.all([
    API.get('/admin/users'),
    API.get('/admin/sync-log'),
  ]);

  if (users) {
    const sel = document.getElementById('notif-test-user');
    sel.innerHTML = users.map(u => `<option value="${u.id}">${escapeHtml(u.email)}</option>`).join('');
  }

  if (groups) {
    const groupCodes = new Map();
    for (const r of groups) {
      if (r.group_id && !groupCodes.has(r.group_id)) {
        groupCodes.set(r.group_id, r.group_course_code || String(r.group_id));
      }
    }
    const sel = document.getElementById('sync-test-group');
    const opts = [...groupCodes.entries()].map(([id, code]) =>
      `<option value="${id}">${escapeHtml(code)}</option>`
    ).join('');
    sel.innerHTML = `<option value="all">Tous les groupes</option>${opts}`;
  }
}

async function handleNotifTest() {
  const alertEl = document.getElementById('notif-test-alert');
  hideAlert(alertEl);
  const userId = document.getElementById('notif-test-user').value;
  const type = document.getElementById('notif-test-type').value;
  const message = document.getElementById('notif-test-msg').value.trim();
  const btn = document.getElementById('notif-test-btn');

  setLoading(btn, true, 'Envoi…');
  const res = await API.request('POST', '/admin/test/notification', { user_id: userId, type, message: message || undefined });
  setLoading(btn, false);
  const data = res ? await res.json() : null;

  if (data && data.ok) {
    const parts = [];
    if (data.results.email !== undefined) parts.push(`Courriel : ${data.results.email === 'ok' ? '✓' : '✗ ' + data.results.email}`);
    if (data.results.sms !== undefined) parts.push(`SMS : ${data.results.sms === 'ok' ? '✓' : '✗ ' + data.results.sms}`);
    showAlert(alertEl, parts.join(' | ') || 'Envoyé.', 'success');
  } else {
    showAlert(alertEl, data?.error || 'Erreur lors de l\'envoi.');
  }
}

async function handleSyncTest() {
  const alertEl = document.getElementById('sync-test-alert');
  hideAlert(alertEl);
  const groupId = document.getElementById('sync-test-group').value;
  const btn = document.getElementById('sync-test-btn');

  setLoading(btn, true, 'Synchro…');
  const res = await API.request('POST', '/admin/test/sync', { group_id: groupId });
  setLoading(btn, false);
  const data = res ? await res.json() : null;

  if (data && data.ok) {
    const msg = data.message || `${data.new_grades ?? 0} nouvelle(s) note(s) détectée(s).`;
    const errStr = data.errors && data.errors.length > 0 ? ` Erreurs : ${data.errors.join(', ')}` : '';
    showAlert(alertEl, msg + errStr, 'success');
  } else {
    showAlert(alertEl, data?.error || 'Erreur lors de la synchronisation.');
  }
}

async function handlePortalTest() {
  const alertEl = document.getElementById('portal-test-alert');
  const output = document.getElementById('portal-test-output');
  hideAlert(alertEl);
  output.classList.add('hidden');

  const username = document.getElementById('portal-test-user').value.trim();
  const password = document.getElementById('portal-test-pass').value;
  const btn = document.getElementById('portal-test-btn');

  if (!username || !password) {
    showAlert(alertEl, 'Identifiant et mot de passe requis.');
    return;
  }

  setLoading(btn, true, 'Test…');
  const res = await API.request('POST', '/admin/test/portal', { portal_username: username, portal_password: password });
  setLoading(btn, false);
  const data = res ? await res.json() : null;

  if (data && data.ok) {
    showAlert(alertEl, 'Connexion réussie.', 'success');
    output.textContent = JSON.stringify(data.data, null, 2);
    output.classList.remove('hidden');
  } else {
    const msg = data?.error || 'Erreur inconnue';
    const code = data?.code ? ` [${data.code}]` : '';
    showAlert(alertEl, msg + code);
    output.classList.add('hidden');
  }
}
