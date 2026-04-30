document.addEventListener('DOMContentLoaded', () => {
  loadInvitations();

  document.getElementById('form-invitation').addEventListener('submit', handleInvite);
  document.getElementById('btn-copy-link').addEventListener('click', copyInviteLink);
});

async function handleInvite(e) {
  e.preventDefault();
  const alert = document.getElementById('alert-invitation');
  const btn = document.getElementById('btn-invite');
  const email = document.getElementById('invite-email').value.trim();
  hideAlert(alert);

  setLoading(btn, true, 'Envoi…');
  const res = await API.request('POST', '/invitations', { email });
  setLoading(btn, false);
  if (!res) return;

  const data = await res.json();
  if (!res.ok) {
    showAlert(alert, data.error || 'Erreur lors de l\'envoi de l\'invitation');
    return;
  }

  showAlert(alert, `Invitation envoyée à ${data.email}.`, 'success');
  document.getElementById('invite-email').value = '';

  const linkBlock = document.getElementById('invite-link-block');
  document.getElementById('invite-link-input').value = data.invite_url;
  linkBlock.style.display = '';

  loadInvitations();
}

function copyInviteLink() {
  const input = document.getElementById('invite-link-input');
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.getElementById('btn-copy-link');
    btn.textContent = 'Copié !';
    setTimeout(() => { btn.textContent = 'Copier'; }, 2000);
  });
}

async function loadInvitations() {
  const container = document.getElementById('invitations-list');
  if (!container) return;

  const data = await API.get('/invitations');
  if (!data || data.length === 0) {
    container.innerHTML = '';
    return;
  }

  const statusBadge = {
    'en attente': '<span class="badge badge-neutral">En attente</span>',
    'utilisée':   '<span class="badge badge-success">Utilisée</span>',
    'expirée':    '<span class="badge" style="background:var(--bg-3);color:var(--text-3)">Expirée</span>',
  };

  container.innerHTML = `
    <p class="text-sm" style="font-weight:500;margin-bottom:.6rem;color:var(--text-2)">Invitations envoyées</p>
    <div style="display:flex;flex-direction:column;gap:.5rem">
      ${data.map(inv => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.6rem .75rem;background:var(--bg-1);border:1px solid var(--border);border-radius:.4rem">
          <div style="min-width:0">
            <div style="font-size:.875rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${inv.email}</div>
            <div class="text-sm text-muted">${formatDate(inv.created_at)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:.5rem;flex-shrink:0">
            ${statusBadge[inv.status] || ''}
            ${inv.status === 'en attente' ? `<button class="btn btn-danger btn-sm" style="padding:.25rem .6rem;font-size:.75rem" onclick="revokeInvitation(${inv.id})">Révoquer</button>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function revokeInvitation(id) {
  if (!confirm('Révoquer cette invitation ?')) return;
  const data = await API.delete(`/invitations/${id}`);
  if (data && data.success) loadInvitations();
}
