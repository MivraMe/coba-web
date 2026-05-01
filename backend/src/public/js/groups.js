document.addEventListener('DOMContentLoaded', async () => {
  const user = await API.requireOnboarded();
  if (!user) return;
  setupNav(user);
  await loadGroups();
});

async function loadGroups() {
  const wrap = document.getElementById('groups-wrap');
  const groups = await API.get('/groupes');

  if (!groups || groups.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><p>Vous n\'êtes membre d\'aucun groupe.</p></div>';
    return;
  }

  // Group by school_year (already sorted DESC by backend)
  const byYear = {};
  for (const g of groups) {
    const y = g.school_year || 'Année inconnue';
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(g);
  }

  let html = '';
  for (const [year, list] of Object.entries(byYear)) {
    html += `<div class="year-section" style="margin-bottom:1.75rem">
      <div class="year-label">${year}</div>
      <div class="groups-list">
        ${list.map(renderGroupRow).join('')}
      </div>
    </div>`;
  }

  wrap.innerHTML = html;

  wrap.querySelectorAll('.group-row').forEach(row => {
    row.addEventListener('click', () => toggleGroupDetail(row));
  });
}

function renderGroupRow(g) {
  const memberText = g.total_students
    ? `${g.member_count} / ${g.total_students} membres`
    : `${g.member_count} membre(s)`;

  return `
    <div>
      <div class="group-row" data-group-id="${g.id}">
        <div class="group-row-left">
          <div class="group-row-code">${escapeHtml(g.course_code)}</div>
          <div class="group-row-name">${escapeHtml(g.course_name)}</div>
        </div>
        <div class="group-row-right">
          ${g.is_admin ? '<span class="badge badge-primary">Admin</span>' : ''}
          <span class="group-members-count">${memberText}</span>
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"
               class="chevron" style="transition:transform .2s;color:var(--text-3)">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/>
          </svg>
        </div>
      </div>
      <div class="group-detail" id="detail-${g.id}"></div>
    </div>`;
}

async function toggleGroupDetail(row) {
  const groupId = row.dataset.groupId;
  const detail = document.getElementById(`detail-${groupId}`);
  const chevron = row.querySelector('.chevron');
  const isOpen = detail.classList.contains('open');

  // Close all
  document.querySelectorAll('.group-row').forEach(r => r.classList.remove('open'));
  document.querySelectorAll('.group-detail').forEach(d => d.classList.remove('open'));
  document.querySelectorAll('.chevron').forEach(c => c.style.transform = '');

  if (!isOpen) {
    row.classList.add('open');
    detail.classList.add('open');
    chevron.style.transform = 'rotate(180deg)';
    if (!detail.dataset.loaded) {
      detail.innerHTML = '<div style="padding:.75rem 0"><span class="spinner spinner-dark"></span></div>';
      await loadGroupDetail(groupId, detail);
    }
  }
}

async function loadGroupDetail(groupId, detailEl) {
  const data = await API.get(`/groupes/${groupId}`);
  if (!data) { detailEl.innerHTML = '<p class="text-muted text-sm">Erreur de chargement.</p>'; return; }

  const { group, members } = data;
  detailEl.dataset.loaded = 'true';

  const memberRows = members.map(m => `
    <li class="member-row">
      <div>
        <span class="member-email">${escapeHtml(m.full_name || m.email)}</span>
        ${m.is_admin ? ' <span class="badge badge-primary">Admin</span>' : ''}
      </div>
      <div class="member-meta">
        Rejoint le ${new Date(m.joined_at).toLocaleDateString('fr-CA')}
        ${m.refreshed_at ? ` · Synchro ${new Date(m.refreshed_at).toLocaleDateString('fr-CA')}` : ''}
      </div>
    </li>`).join('');

  let adminForm = '';
  if (group.is_admin) {
    adminForm = `
      <hr class="divider">
      <details>
        <summary style="cursor:pointer;font-size:.875rem;font-weight:600;color:var(--primary)">
          Paramètres du groupe (admin)
        </summary>
        <div id="alert-group-${groupId}" class="alert alert-hidden mt-1"></div>
        <form class="group-edit-form" data-group-id="${groupId}" style="margin-top:.75rem">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Année scolaire</label>
              <input type="text" class="form-control ge-year" value="${escapeHtml(group.school_year)}" placeholder="2025-2026">
            </div>
            <div class="form-group">
              <label class="form-label">Nb. d'étudiants</label>
              <input type="number" class="form-control ge-total" value="${group.total_students || ''}" min="1" max="100" placeholder="Facultatif">
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Enregistrer</button>
        </form>
      </details>`;
  }

  detailEl.innerHTML = `<ul class="member-list">${memberRows}</ul>${adminForm}`;
  detailEl.querySelectorAll('.group-edit-form').forEach(form => {
    form.addEventListener('submit', handleGroupEdit);
  });
}

async function handleGroupEdit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const groupId = form.dataset.groupId;
  const alertEl = document.getElementById(`alert-group-${groupId}`);
  hideAlert(alertEl);

  const res = await API.request('PUT', `/groupes/${groupId}`, {
    school_year: form.querySelector('.ge-year').value || null,
    total_students: parseInt(form.querySelector('.ge-total').value) || null,
  });

  const data = await res.json();
  if (res && res.ok) {
    showAlert(alertEl, 'Enregistré.', 'success');
    // Mark detail as needing reload on next open
    const detailEl = document.getElementById(`detail-${groupId}`);
    if (detailEl) delete detailEl.dataset.loaded;
    await loadGroups();
  } else {
    showAlert(alertEl, data?.error || 'Erreur lors de l\'enregistrement.');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
