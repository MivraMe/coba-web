document.addEventListener('DOMContentLoaded', () => {
  loadInvitations();

  document.getElementById('form-invitation').addEventListener('submit', handleInvite);
  document.getElementById('btn-copy-link').addEventListener('click', () => copyToClipboard('invite-link-input', 'btn-copy-link'));
  document.getElementById('btn-create-link').addEventListener('click', handleCreateShareLink);
  document.getElementById('btn-copy-share-link').addEventListener('click', () => copyToClipboard('new-share-link-input', 'btn-copy-share-link'));
});

// ── Invitations par courriel ──────────────────────────────────────────────────

async function handleInvite(e) {
  e.preventDefault();
  const alertEl = document.getElementById('alert-invitation');
  const btn = document.getElementById('btn-invite');
  const email = document.getElementById('invite-email').value.trim();
  hideAlert(alertEl);

  setLoading(btn, true, 'Envoi…');
  const res = await API.request('POST', '/invitations', { email });
  setLoading(btn, false);
  if (!res) return;

  const data = await res.json();
  if (!res.ok) {
    showAlert(alertEl, data.error || 'Erreur lors de l\'envoi de l\'invitation');
    return;
  }

  showAlert(alertEl, `Invitation envoyée à ${data.email}.`, 'success');
  document.getElementById('invite-email').value = '';
  document.getElementById('invite-link-input').value = data.invite_url;
  document.getElementById('invite-link-block').style.display = '';

  loadInvitations();
}

// ── Liens de partage ──────────────────────────────────────────────────────────

async function handleCreateShareLink() {
  const alertEl = document.getElementById('alert-share-link');
  const btn = document.getElementById('btn-create-link');
  const expiresIn = document.getElementById('link-expires-in').value;
  hideAlert(alertEl);

  setLoading(btn, true, 'Création…');
  const res = await API.request('POST', '/invitations/link', {
    expires_in_days: expiresIn ? parseInt(expiresIn) : null,
  });
  setLoading(btn, false);
  if (!res) return;

  const data = await res.json();
  if (!res.ok) {
    showAlert(alertEl, data.error || 'Erreur lors de la création du lien');
    return;
  }

  const labelEl = document.getElementById('new-share-link-label');
  labelEl.textContent = data.expires_at
    ? `Nouveau lien — expire le ${new Date(data.expires_at).toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' })}`
    : 'Nouveau lien — sans expiration';

  document.getElementById('new-share-link-input').value = data.invite_url;
  document.getElementById('new-share-link-block').style.display = '';

  loadInvitations();
}

// ── Liste combinée ────────────────────────────────────────────────────────────

function invStatus(inv) {
  if (inv.email !== null) {
    if (inv.used_at) return { label: 'Utilisée', cls: 'badge-success' };
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) return { label: 'Expirée', cls: '' };
    return { label: 'En attente', cls: 'badge-neutral' };
  } else {
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) return { label: 'Expirée', cls: '' };
    if (inv.max_uses !== null && inv.use_count >= inv.max_uses) return { label: 'Épuisée', cls: '' };
    return { label: 'Active', cls: 'badge-success' };
  }
}

function isRevokable(inv) {
  const s = invStatus(inv).label;
  return s === 'En attente' || s === 'Active';
}

async function loadInvitations() {
  const data = await API.get('/invitations');
  if (!data) return;

  const emailInvs = data.filter(i => i.email !== null);
  const shareLinks = data.filter(i => i.email === null);

  renderEmailInvitations(emailInvs);
  renderShareLinks(shareLinks);
}

function renderEmailInvitations(list) {
  const container = document.getElementById('invitations-list');
  if (!container || list.length === 0) { if (container) container.innerHTML = ''; return; }

  container.innerHTML = `
    <p class="text-sm" style="font-weight:500;margin-bottom:.6rem;color:var(--text-2)">Invitations envoyées</p>
    <div style="display:flex;flex-direction:column;gap:.5rem">
      ${list.map(inv => {
        const { label, cls } = invStatus(inv);
        const badgeStyle = cls ? '' : 'background:var(--bg-3);color:var(--text-3)';
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.6rem .75rem;background:var(--bg-1);border:1px solid var(--border);border-radius:.4rem">
            <div style="min-width:0">
              <div style="font-size:.875rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${inv.email}</div>
              <div class="text-sm text-muted">${formatDate(inv.created_at)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:.5rem;flex-shrink:0">
              <span class="badge ${cls}" style="${badgeStyle}">${label}</span>
              ${isRevokable(inv) ? `<button class="btn btn-danger btn-sm" style="padding:.25rem .6rem;font-size:.75rem" onclick="revokeInvitation(${inv.id})">Révoquer</button>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>
  `;
}

function renderShareLinks(list) {
  const container = document.getElementById('share-links-list');
  if (!container || list.length === 0) { if (container) container.innerHTML = ''; return; }

  const baseUrl = window.location.origin;

  container.innerHTML = `
    <p class="text-sm" style="font-weight:500;margin-bottom:.6rem;color:var(--text-2)">Liens actifs</p>
    <div style="display:flex;flex-direction:column;gap:.5rem">
      ${list.map(inv => {
        const { label, cls } = invStatus(inv);
        const badgeStyle = cls ? '' : 'background:var(--bg-3);color:var(--text-3)';
        const expiry = inv.expires_at
          ? `Expire le ${new Date(inv.expires_at).toLocaleDateString('fr-CA', { month: 'short', day: 'numeric', year: 'numeric' })}`
          : 'Sans expiration';
        const uses = inv.max_uses !== null
          ? `${inv.use_count} / ${inv.max_uses} utilisations`
          : `${inv.use_count} utilisation${inv.use_count !== 1 ? 's' : ''}`;
        const linkUrl = `${baseUrl}/rejoindre?token=${inv.token}`;
        return `
          <div style="padding:.6rem .75rem;background:var(--bg-1);border:1px solid var(--border);border-radius:.4rem">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-bottom:.4rem">
              <div class="text-sm text-muted">${expiry} · ${uses}</div>
              <div style="display:flex;align-items:center;gap:.5rem;flex-shrink:0">
                <span class="badge ${cls}" style="${badgeStyle}">${label}</span>
                <button class="btn btn-secondary btn-sm" style="padding:.25rem .6rem;font-size:.75rem" onclick="copyShareLinkById('${inv.token}', this)">Copier</button>
                <button class="btn btn-danger btn-sm" style="padding:.25rem .6rem;font-size:.75rem" onclick="revokeInvitation(${inv.id})">Révoquer</button>
              </div>
            </div>
            <input type="text" value="${linkUrl}" readonly style="width:100%;font-size:.75rem;font-family:monospace;background:var(--bg-2);border:1px solid var(--border);border-radius:.3rem;padding:.3rem .5rem;color:var(--text-2)">
          </div>`;
      }).join('')}
    </div>
  `;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function copyToClipboard(inputId, btnId) {
  const val = document.getElementById(inputId).value;
  navigator.clipboard.writeText(val).then(() => {
    const btn = document.getElementById(btnId);
    const orig = btn.textContent;
    btn.textContent = 'Copié !';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

function copyShareLinkById(token, btn) {
  const url = `${window.location.origin}/rejoindre?token=${token}`;
  navigator.clipboard.writeText(url).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copié !';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

async function revokeInvitation(id) {
  if (!confirm('Révoquer cette invitation ?')) return;
  const data = await API.delete(`/invitations/${id}`);
  if (data && data.success) loadInvitations();
}
