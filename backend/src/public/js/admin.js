document.addEventListener('DOMContentLoaded', async () => {
  const user = await API.requireAuth();
  if (!user) return;
  if (!user.is_admin) {
    window.location.href = '/dashboard';
    return;
  }
  setupNav(user);

  // Tab switching
  document.querySelectorAll('.admin-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ['monitoring', 'config', 'deploy'].forEach(id => {
        document.getElementById(`tab-${id}`).classList.toggle('hidden', id !== btn.dataset.tab);
      });
    });
  });

  await Promise.all([loadStats(), loadSyncLog(), loadConfig()]);

  document.getElementById('config-form').addEventListener('submit', handleConfigSave);
  document.getElementById('deploy-btn').addEventListener('click', handleDeploy);
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
