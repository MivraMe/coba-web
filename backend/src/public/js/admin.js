const ALL_TABS = ['monitoring', 'users', 'tests', 'config', 'deploy', 'todo'];

document.addEventListener('DOMContentLoaded', async () => {
  const user = await API.requireAuth();
  if (!user) return;
  if (user.role !== 'superadmin' && !user.is_admin) {
    window.location.href = '/dashboard';
    return;
  }
  setupNav(user);

  const isSuperAdmin = user.role === 'superadmin';
  _isSuperAdminView = isSuperAdmin;

  // Hide config/deploy/todo-add tabs for non-superadmin
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
      if (btn.dataset.tab === 'todo') loadTodo();
    });
  });

  const initLoaders = [loadStats(), loadSyncLog()];
  if (isSuperAdmin) initLoaders.push(loadConfig(), loadTodo());
  await Promise.all(initLoaders);

  if (isSuperAdmin) {
    document.getElementById('config-form').addEventListener('submit', handleConfigSave);
    document.getElementById('deploy-btn').addEventListener('click', handleDeploy);
    document.getElementById('edit-modal-save').addEventListener('click', handleEditSave);
    document.getElementById('edit-modal-close').addEventListener('click', closeEditModal);
    document.getElementById('edit-modal-cancel').addEventListener('click', closeEditModal);
    initAdminCropListeners();
    document.getElementById('todo-add-btn').addEventListener('click', () => openTodoModal(null));
    document.getElementById('todo-modal-save').addEventListener('click', handleTodoSave);
    document.getElementById('todo-modal-close').addEventListener('click', closeTodoModal);
    document.getElementById('todo-modal-cancel').addEventListener('click', closeTodoModal);
  }
  document.getElementById('users-refresh-btn').addEventListener('click', loadUsers);
  document.getElementById('notif-test-btn').addEventListener('click', handleNotifTest);
  document.getElementById('sync-test-btn').addEventListener('click', handleSyncTest);
  document.getElementById('portal-test-btn').addEventListener('click', handlePortalTest);
  initPortalEndpointBtns();

  // TODO filter buttons (visible to all admins)
  document.querySelectorAll('[data-todo-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-todo-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _todoFilter = btn.dataset.todoFilter;
      renderTodoGrid();
    });
  });

  // Contact modal (visible to all admins)
  document.getElementById('contact-modal-send').addEventListener('click', handleContactSend);
  document.getElementById('contact-modal-close').addEventListener('click', closeContactModal);
  document.getElementById('contact-modal-cancel').addEventListener('click', closeContactModal);
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

// ── Admin photo crop ─────────────────────────────────────────────────────────
const admCrop = { img: null, zoom: 1, offsetX: 0, offsetY: 0, dragging: false, startX: 0, startY: 0, usePhoto: false, changed: false };

function admInitCrop(base64) {
  admCrop.usePhoto = true;
  const src = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
  const img = new Image();
  img.onload = () => {
    admCrop.img = img;
    const canvas = document.getElementById('admin-crop-canvas');
    const size = canvas.width;
    const scale = Math.max(size / img.width, size / img.height);
    admCrop.zoom = scale;
    admCrop.offsetX = (size - img.width * scale) / 2;
    admCrop.offsetY = (size - img.height * scale) / 2;
    const zsl = document.getElementById('admin-crop-zoom');
    zsl.min = scale.toFixed(4); zsl.max = (scale * 3).toFixed(4); zsl.value = scale.toFixed(4);
    admRenderCrop();
    admSetupDrag();
  };
  img.src = src;
}

function admRenderCrop() {
  const canvas = document.getElementById('admin-crop-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  if (!admCrop.usePhoto || !admCrop.img) {
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = `bold ${Math.round(size / 2.8)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', size / 2, size / 2 + 2);
    return;
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(admCrop.img, admCrop.offsetX, admCrop.offsetY, admCrop.img.width * admCrop.zoom, admCrop.img.height * admCrop.zoom);
  ctx.restore();
  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2); ctx.stroke();
}

function admClamp() {
  const canvas = document.getElementById('admin-crop-canvas');
  if (!canvas || !admCrop.img) return;
  const size = canvas.width;
  admCrop.offsetX = Math.min(0, Math.max(size - admCrop.img.width * admCrop.zoom, admCrop.offsetX));
  admCrop.offsetY = Math.min(0, Math.max(size - admCrop.img.height * admCrop.zoom, admCrop.offsetY));
}

let _admDragSetup = false;
function admSetupDrag() {
  if (_admDragSetup) return;
  _admDragSetup = true;
  const canvas = document.getElementById('admin-crop-canvas');
  canvas.addEventListener('mousedown', e => {
    admCrop.dragging = true;
    admCrop.startX = e.clientX - admCrop.offsetX; admCrop.startY = e.clientY - admCrop.offsetY;
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!admCrop.dragging) return;
    admCrop.offsetX = e.clientX - admCrop.startX; admCrop.offsetY = e.clientY - admCrop.startY;
    admClamp(); admRenderCrop();
  });
  window.addEventListener('mouseup', () => { admCrop.dragging = false; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0]; admCrop.dragging = true;
    admCrop.startX = t.clientX - admCrop.offsetX; admCrop.startY = t.clientY - admCrop.offsetY;
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.touches[0];
    admCrop.offsetX = t.clientX - admCrop.startX; admCrop.offsetY = t.clientY - admCrop.startY;
    admClamp(); admRenderCrop();
  }, { passive: false });
  canvas.addEventListener('touchend', () => { admCrop.dragging = false; });
}

function admGetCropped(outputSize = 200) {
  if (!admCrop.usePhoto || !admCrop.img) return null;
  const src = document.getElementById('admin-crop-canvas');
  const scale = outputSize / src.width;
  const out = document.createElement('canvas');
  out.width = outputSize; out.height = outputSize;
  const ctx = out.getContext('2d');
  ctx.save();
  ctx.beginPath(); ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(admCrop.img, admCrop.offsetX * scale, admCrop.offsetY * scale,
    admCrop.img.width * admCrop.zoom * scale, admCrop.img.height * admCrop.zoom * scale);
  ctx.restore();
  return out.toDataURL('image/jpeg', 0.88);
}

function initAdminCropListeners() {
  document.getElementById('admin-crop-zoom').addEventListener('input', e => {
    const newZoom = parseFloat(e.target.value);
    const canvas = document.getElementById('admin-crop-canvas');
    const size = canvas.width;
    const imgX = (size / 2 - admCrop.offsetX) / admCrop.zoom;
    const imgY = (size / 2 - admCrop.offsetY) / admCrop.zoom;
    admCrop.zoom = newZoom;
    admCrop.offsetX = size / 2 - imgX * newZoom; admCrop.offsetY = size / 2 - imgY * newZoom;
    admClamp(); admRenderCrop();
    admCrop.changed = true;
  });
  document.getElementById('admin-photo-upload').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { admInitCrop(ev.target.result); admCrop.changed = true; };
    reader.readAsDataURL(file);
  });
  document.getElementById('admin-btn-remove-photo').addEventListener('click', () => {
    admCrop.usePhoto = false; admCrop.img = null; admCrop.changed = true; admRenderCrop();
  });
}
// ── End admin crop ────────────────────────────────────────────────────────────

// Avatar initiales colorées
const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#eab308','#22c55e','#14b8a6','#0ea5e9','#3b82f6'];
function avatarColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function avatarInitials(fullName, email) {
  if (fullName) {
    const parts = fullName.trim().split(/\s+/);
    return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

let _usersCache = [];

async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-3);text-align:center">Chargement…</td></tr>';
  const users = await API.get('/admin/users');
  if (!users) return;
  _usersCache = users;
  renderUsersTable(users);
}

let _isSuperAdminView = false;

function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-3);text-align:center">Aucun utilisateur.</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const created = new Date(u.created_at).toLocaleDateString('fr-CA');
    const synced = u.last_synced
      ? `<span style="display:block;color:var(--text-3);font-size:.75rem">Dernière synchro</span>${new Date(u.last_synced).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' })}`
      : '—';
    const groups = u.groups.length > 0
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:.2rem">${
          u.groups.map(g => `<span class="badge badge-neutral" title="${escapeHtml(g.course_name)}">${escapeHtml(g.course_code)}</span>`).join('')
        }</div>`
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

    const editBtn = _isSuperAdminView
      ? `<button class="btn btn-sm btn-secondary" onclick="openEditModal(${u.id})" title="Modifier">✏️</button>`
      : '';

    // Admin de groupe viewing superadmin: only show "Contacter"
    let actionsHtml;
    if (!_isSuperAdminView && u.role === 'superadmin') {
      actionsHtml = `<button class="btn btn-sm btn-ghost" onclick="openContactModal(${u.id}, '${escapeHtml(u.email)}')">Contacter</button>`;
    } else {
      actionsHtml = `
        ${editBtn}
        ${roleAction}
        <button class="btn btn-sm btn-secondary" onclick="forceSync(${u.id})">Sync</button>
        ${u.role !== 'superadmin' ? `<button class="btn btn-sm btn-secondary" onclick="resetPassword(${u.id})">Réinit. MDP</button>` : ''}
        ${u.role !== 'superadmin' ? `<button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id}, '${escapeHtml(u.email)}')">Supprimer</button>` : ''}
      `;
    }

    const initials = avatarInitials(u.full_name, u.email);
    const avatarBg = avatarColor(u.email);
    const avatarHtml = u.photo_base64
      ? `<img src="data:image/jpeg;base64,${u.photo_base64}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;flex-shrink:0;display:block" alt="">`
      : `<div style="width:34px;height:34px;border-radius:50%;background:${avatarBg};color:#fff;font-size:.72rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;user-select:none">${escapeHtml(initials)}</div>`;
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:.6rem">
          ${avatarHtml}
          <div style="min-width:0">
            ${u.full_name ? `<div style="font-weight:600;font-size:.85rem;line-height:1.2">${escapeHtml(u.full_name)}</div>` : ''}
            <div style="font-size:.78rem;color:var(--text-3)">${escapeHtml(u.email)}</div>
            ${u.invited_by_email ? `<div style="color:var(--text-3);font-size:.72rem;margin-top:.1rem">Invité par ${escapeHtml(u.invited_by_email)}</div>` : ''}
          </div>
        </div>
      </td>
      <td style="font-size:.8rem;white-space:nowrap">${created}</td>
      <td style="font-size:.8rem">${synced}</td>
      <td style="font-size:.8rem">${groups}</td>
      <td style="font-size:.85rem">${notif}</td>
      <td>${roleBadge}</td>
      <td style="display:flex;gap:.35rem;flex-wrap:wrap">
        ${actionsHtml}
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
    const pwd = escapeHtml(data.temp_password);
    const smsNote = data.sms_sent ? ' — SMS envoyé.' : '';
    alertEl.className = 'alert alert-info';
    alertEl.classList.remove('hidden');
    alertEl.innerHTML = `Mot de passe temporaire (une seule fois)${smsNote} : <strong>${pwd}</strong> ` +
      `<button onclick="navigator.clipboard.writeText('${pwd}').then(()=>this.textContent='✓')" ` +
      `style="border:none;background:none;cursor:pointer;font-size:.95rem" title="Copier">📋</button>`;
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

let _portalTestEndpoint = 'notes';

function initPortalEndpointBtns() {
  document.querySelectorAll('.portal-ep-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.portal-ep-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _portalTestEndpoint = btn.dataset.ep;
    });
  });
}

async function handlePortalTest() {
  const alertEl = document.getElementById('portal-test-alert');
  const resultEl = document.getElementById('portal-test-result');
  const output = document.getElementById('portal-test-output');
  const profileCard = document.getElementById('portal-test-profile-card');
  hideAlert(alertEl);
  resultEl.classList.add('hidden');
  profileCard.classList.add('hidden');

  const username = document.getElementById('portal-test-user').value.trim();
  const password = document.getElementById('portal-test-pass').value;
  const btn = document.getElementById('portal-test-btn');
  const ep = _portalTestEndpoint;

  if (!username || !password) {
    showAlert(alertEl, 'Identifiant et mot de passe requis.');
    return;
  }

  setLoading(btn, true, 'Test…');
  const res = await API.request('POST', '/admin/test/portal', { portal_username: username, portal_password: password, endpoint: ep });
  setLoading(btn, false);
  const data = res ? await res.json() : null;

  if (!data || !data.ok) {
    const msg = data?.error || 'Erreur inconnue';
    const code = data?.code ? ` [${data.code}]` : '';
    showAlert(alertEl, msg + code);
    return;
  }

  showAlert(alertEl, `/${ep} — réponse reçue.`, 'success');
  resultEl.classList.remove('hidden');

  // For profile / onboarding: show profile card + sanitized JSON (hide raw photo)
  const profile = ep === 'profile' ? data.data
    : ep === 'onboarding' ? data.data?.profile
    : null;

  if (profile) {
    const photoEl = document.getElementById('portal-test-photo');
    const noPhotoEl = document.getElementById('portal-test-no-photo');
    document.getElementById('portal-test-name').textContent = profile.full_name || '—';
    document.getElementById('portal-test-code').textContent = profile.permanent_code || '';
    if (profile.photo_base64) {
      const src = profile.photo_base64.startsWith('data:') ? profile.photo_base64 : `data:image/jpeg;base64,${profile.photo_base64}`;
      photoEl.src = src;
      photoEl.style.display = 'block';
      noPhotoEl.style.display = 'none';
    } else {
      photoEl.style.display = 'none';
      noPhotoEl.style.display = 'flex';
    }
    profileCard.style.display = 'flex';
    profileCard.classList.remove('hidden');
  }

  // Sanitize photo from JSON output (too large to display raw)
  const sanitized = JSON.parse(JSON.stringify(data.data));
  if (ep === 'profile' && sanitized.photo_base64) sanitized.photo_base64 = `[base64 ${Math.round(sanitized.photo_base64.length * 0.75 / 1024)} KB]`;
  if (ep === 'onboarding' && sanitized.profile?.photo_base64) sanitized.profile.photo_base64 = `[base64 ${Math.round(sanitized.profile.photo_base64.length * 0.75 / 1024)} KB]`;

  output.textContent = JSON.stringify(sanitized, null, 2);
}

// ── MODAL ÉDITION UTILISATEUR ─────────────────────────────────────────────────

async function openEditModal(userId) {
  const user = _usersCache.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('edit-user-id').value = user.id;
  document.getElementById('edit-full-name').value = user.full_name || '';
  document.getElementById('edit-email').value = user.email;
  document.getElementById('edit-password').value = '';
  document.getElementById('edit-phone').value = user.phone || '';
  document.getElementById('edit-role').value = user.role || 'user';
  document.getElementById('edit-portal-user').value = user.portal_username || '';
  document.getElementById('edit-portal-pass').value = '';
  document.getElementById('edit-notify-email').checked = !!user.notify_email;
  document.getElementById('edit-notify-sms').checked = !!user.notify_sms;
  hideAlert(document.getElementById('edit-modal-alert'));

  // Display name hint in photo section
  document.getElementById('edit-user-name-display').textContent = user.full_name || user.email;

  // Reset crop state
  admCrop.img = null; admCrop.usePhoto = false; admCrop.changed = false;
  admRenderCrop();

  document.getElementById('edit-user-modal').classList.remove('hidden');

  // Load user photo asynchronously
  const photoData = await API.get(`/admin/users/${userId}/photo`);
  if (photoData?.photo_base64) {
    admInitCrop(photoData.photo_base64);
  }
}

function closeEditModal() {
  document.getElementById('edit-user-modal').classList.add('hidden');
}

async function handleEditSave() {
  const alertEl = document.getElementById('edit-modal-alert');
  hideAlert(alertEl);
  const userId = document.getElementById('edit-user-id').value;
  const btn = document.getElementById('edit-modal-save');

  const body = {
    email: document.getElementById('edit-email').value.trim(),
    full_name: document.getElementById('edit-full-name').value.trim() || null,
    phone: document.getElementById('edit-phone').value.trim() || null,
    notify_email: document.getElementById('edit-notify-email').checked,
    notify_sms: document.getElementById('edit-notify-sms').checked,
    role: document.getElementById('edit-role').value,
    portal_username: document.getElementById('edit-portal-user').value.trim() || null,
  };
  const pwd = document.getElementById('edit-password').value;
  if (pwd) body.password = pwd;
  const portalPwd = document.getElementById('edit-portal-pass').value;
  if (portalPwd) body.portal_password = portalPwd;
  if (admCrop.changed) {
    body.photo_base64 = admCrop.usePhoto && admCrop.img ? admGetCropped() : null;
  }

  setLoading(btn, true, 'Sauvegarde…');
  const res = await API.request('PATCH', `/admin/users/${userId}`, body);
  setLoading(btn, false);
  const data = res ? await res.json() : null;

  if (data && data.ok) {
    closeEditModal();
    showAlert(document.getElementById('users-alert'), 'Utilisateur mis à jour.', 'success');
    loadUsers();
  } else {
    showAlert(alertEl, data?.error || 'Erreur lors de la sauvegarde.');
  }
}

// ── MODAL CONTACTER ───────────────────────────────────────────────────────────

let _contactTargetId = null;

function openContactModal(userId, email) {
  _contactTargetId = userId;
  document.getElementById('contact-modal-email').textContent = email;
  document.getElementById('contact-modal-msg').value = '';
  document.getElementById('contact-modal-channel').value = 'email';
  hideAlert(document.getElementById('contact-modal-alert'));
  document.getElementById('contact-modal').classList.remove('hidden');
}

function closeContactModal() {
  document.getElementById('contact-modal').classList.add('hidden');
}

async function handleContactSend() {
  const alertEl = document.getElementById('contact-modal-alert');
  hideAlert(alertEl);
  const message = document.getElementById('contact-modal-msg').value.trim();
  const channel = document.getElementById('contact-modal-channel').value;
  if (!message) { showAlert(alertEl, 'Le message est requis.'); return; }
  const btn = document.getElementById('contact-modal-send');
  setLoading(btn, true, 'Envoi…');
  const res = await API.request('POST', `/admin/users/${_contactTargetId}/contact`, { message, channel });
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

// ── TODO ──────────────────────────────────────────────────────────────────────

let _todoItems = [];
let _todoFilter = 'all';

async function loadTodo() {
  const grid = document.getElementById('todo-grid');
  if (!grid) return;
  grid.innerHTML = '<div style="color:var(--text-3);padding:.5rem">Chargement…</div>';
  const items = await API.get('/admin/todo');
  if (!items) return;
  _todoItems = items;
  renderTodoGrid();
}

function renderTodoGrid() {
  const grid = document.getElementById('todo-grid');
  if (!grid) return;
  const filtered = _todoFilter === 'all'
    ? _todoItems
    : _todoItems.filter(i => i.status === _todoFilter);
  if (filtered.length === 0) {
    grid.innerHTML = '<div style="color:var(--text-3);padding:.5rem">Aucun élément.</div>';
    return;
  }
  const badgeClass = { 'Planifié': 'badge-neutral', 'En cours': 'badge-primary', 'Complété': 'badge-success', 'Annulé': 'badge-danger' };
  const priorityColor = { 'Haute': 'var(--danger)', 'Normale': 'var(--text-2)', 'Basse': 'var(--text-3)' };
  grid.innerHTML = filtered.map(item => {
    const bc = badgeClass[item.status] || 'badge-neutral';
    const pc = priorityColor[item.priority] || 'var(--text-2)';
    const actions = _isSuperAdminView ? `
      <div style="display:flex;gap:.4rem;margin-top:.25rem">
        <button class="btn btn-sm btn-secondary" onclick="openTodoModal(${item.id})" title="Modifier">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="deleteTodoItem(${item.id})" title="Supprimer">🗑️</button>
      </div>` : '';
    return `<div class="todo-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem">
        <div class="todo-card-title">${escapeHtml(item.title)}</div>
        <span style="font-size:.7rem;color:${pc};white-space:nowrap;font-weight:600;flex-shrink:0">${escapeHtml(item.priority)}</span>
      </div>
      <span class="badge ${bc}">${escapeHtml(item.status)}</span>
      <div class="todo-card-desc">${escapeHtml(item.description)}</div>
      ${actions}
    </div>`;
  }).join('');
}

function openTodoModal(id) {
  const item = id ? _todoItems.find(i => i.id === id) : null;
  document.getElementById('todo-modal-id').value = id || '';
  document.getElementById('todo-modal-title-input').value = item ? item.title : '';
  document.getElementById('todo-modal-desc').value = item ? item.description : '';
  document.getElementById('todo-modal-status').value = item ? item.status : 'Planifié';
  document.getElementById('todo-modal-priority').value = item ? item.priority : 'Normale';
  document.getElementById('todo-modal-heading').textContent = id ? 'Modifier l\'élément' : 'Nouvel élément';
  hideAlert(document.getElementById('todo-modal-alert'));
  document.getElementById('todo-modal').classList.remove('hidden');
}

function closeTodoModal() {
  document.getElementById('todo-modal').classList.add('hidden');
}

async function handleTodoSave() {
  const alertEl = document.getElementById('todo-modal-alert');
  hideAlert(alertEl);
  const id = document.getElementById('todo-modal-id').value;
  const body = {
    title: document.getElementById('todo-modal-title-input').value.trim(),
    description: document.getElementById('todo-modal-desc').value.trim(),
    status: document.getElementById('todo-modal-status').value,
    priority: document.getElementById('todo-modal-priority').value,
  };
  if (!body.title) { showAlert(alertEl, 'Le titre est requis.'); return; }
  const btn = document.getElementById('todo-modal-save');
  setLoading(btn, true, 'Sauvegarde…');
  const res = id
    ? await API.request('PATCH', `/admin/todo/${id}`, body)
    : await API.request('POST', '/admin/todo', body);
  setLoading(btn, false);
  const data = res ? await res.json() : null;
  if (data && data.ok) { closeTodoModal(); loadTodo(); }
  else showAlert(alertEl, data?.error || 'Erreur lors de la sauvegarde.');
}

async function deleteTodoItem(id) {
  if (!confirm('Supprimer cet élément ?')) return;
  const res = await API.request('DELETE', `/admin/todo/${id}`);
  const data = res ? await res.json() : null;
  if (data && data.ok) loadTodo();
  else showAlert(document.getElementById('todo-modal-alert') || document.getElementById('users-alert'), data?.error || 'Erreur.');
}
