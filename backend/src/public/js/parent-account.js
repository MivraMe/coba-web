document.addEventListener('DOMContentLoaded', async () => {
  const parent = await PARENT.requireAuth();
  if (!parent) return;

  const alert = document.getElementById('alert');

  // Setup nav
  const nav = document.getElementById('main-nav');
  if (nav) {
    const emailEl = nav.querySelector('.nav-email');
    if (emailEl) emailEl.textContent = `${parent.first_name} ${parent.last_name}`;
    nav.querySelectorAll('.nav-logout').forEach(el => el.addEventListener('click', () => PARENT.logout()));
  }

  // ── Charger les infos du compte ───────────────────────────────────────────

  document.getElementById('first-name').value = parent.first_name || '';
  document.getElementById('last-name').value = parent.last_name || '';
  document.getElementById('parent-email').value = parent.email || '';
  document.getElementById('parent-phone').value = parent.phone || '';
  document.getElementById('notif-email').checked = !!parent.notify_email;
  document.getElementById('notif-sms').checked = !!parent.notify_sms;

  // ── Enregistrer le profil ─────────────────────────────────────────────────

  document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const first_name = document.getElementById('first-name').value.trim();
    const last_name = document.getElementById('last-name').value.trim();
    const email = document.getElementById('parent-email').value.trim();
    const phone = document.getElementById('parent-phone').value.trim();

    hideAlert(alert);
    if (!first_name || !last_name || !email) { showAlert(alert, 'Prénom, nom et courriel sont obligatoires.'); return; }

    const btn = document.getElementById('save-profile-btn');
    setLoading(btn, true, 'Enregistrement…');

    const res = await PARENT.request('PUT', '/parent/account', { first_name, last_name, email, phone: phone || null });
    setLoading(btn, false, 'Enregistrer les modifications');
    if (!res) return;

    const data = await res.json();
    if (!res.ok) { showAlert(alert, data.error || 'Erreur lors de la sauvegarde'); return; }

    PARENT.setParent({ ...PARENT.getParent(), ...data });
    showAlert(alert, 'Profil mis à jour avec succès.', 'success');
  });

  // ── Changer le mot de passe ───────────────────────────────────────────────

  document.getElementById('save-password-btn').addEventListener('click', async () => {
    const current = document.getElementById('current-pass').value;
    const newPass = document.getElementById('new-pass').value;
    const newPass2 = document.getElementById('new-pass2').value;

    hideAlert(alert);
    if (!current || !newPass || !newPass2) { showAlert(alert, 'Veuillez remplir tous les champs.'); return; }
    if (newPass !== newPass2) { showAlert(alert, 'Les mots de passe ne correspondent pas.'); return; }
    if (newPass.length < 8) { showAlert(alert, 'Le nouveau mot de passe doit comporter au moins 8 caractères.'); return; }

    const btn = document.getElementById('save-password-btn');
    setLoading(btn, true, 'Modification…');

    const res = await PARENT.request('PUT', '/parent/account/password', { current_password: current, new_password: newPass });
    setLoading(btn, false, 'Changer le mot de passe');
    if (!res) return;

    const data = await res.json();
    if (!res.ok) { showAlert(alert, data.error || 'Erreur lors du changement de mot de passe'); return; }

    document.getElementById('current-pass').value = '';
    document.getElementById('new-pass').value = '';
    document.getElementById('new-pass2').value = '';
    showAlert(alert, 'Mot de passe modifié avec succès.', 'success');
  });

  // ── Notifications ────────────────────────────────────────────────────────────

  document.getElementById('save-notif-btn').addEventListener('click', async () => {
    const notify_email = document.getElementById('notif-email').checked;
    const notify_sms = document.getElementById('notif-sms').checked;

    if (notify_sms && !document.getElementById('parent-phone').value.trim()) {
      showAlert(alert, 'Ajoutez un numéro de téléphone pour activer les SMS.'); return;
    }

    const btn = document.getElementById('save-notif-btn');
    setLoading(btn, true, 'Enregistrement…');
    hideAlert(alert);

    const res = await PARENT.request('PUT', '/parent/account', { notify_email, notify_sms });
    setLoading(btn, false, 'Enregistrer les préférences');
    if (!res) return;

    const data = await res.json();
    if (!res.ok) { showAlert(alert, data.error || 'Erreur lors de la sauvegarde'); return; }

    PARENT.setParent({ ...PARENT.getParent(), notify_email: data.notify_email, notify_sms: data.notify_sms });
    showAlert(alert, 'Préférences de notifications enregistrées.', 'success');
  });

  // ── Enfants ───────────────────────────────────────────────────────────────

  await loadChildren();

  // Toggle formulaire d'ajout
  document.getElementById('toggle-add-child').addEventListener('click', () => {
    const form = document.getElementById('add-child-form');
    form.classList.toggle('open');
  });

  // Ajouter un enfant
  document.getElementById('add-child-btn').addEventListener('click', async () => {
    const code = document.getElementById('add-code').value.trim().toUpperCase();
    if (!code) { showAlert(alert, 'Entrez un code permanent.'); return; }

    const btn = document.getElementById('add-child-btn');
    setLoading(btn, true, 'Ajout…');
    hideAlert(alert);

    const res = await PARENT.request('POST', '/parent/children/add', { permanent_code: code });
    setLoading(btn, false, 'Ajouter');
    if (!res) return;

    const data = await res.json();
    if (!res.ok) { showAlert(alert, data.error || "Erreur lors de l'ajout"); return; }

    document.getElementById('add-code').value = '';
    document.getElementById('add-child-form').classList.remove('open');
    showAlert(alert, `${data.child.full_name || data.child.permanent_code} a été ajouté.`, 'success');
    await loadChildren();
  });
});

async function loadChildren() {
  const list = document.getElementById('children-list');
  list.innerHTML = '<div class="loading-overlay" style="position:relative;padding:1rem"><span class="spinner spinner-dark"></span></div>';

  const children = await PARENT.get('/parent/children');
  if (!children) { list.innerHTML = '<p class="text-sm text-muted">Erreur de chargement.</p>'; return; }

  if (children.length === 0) {
    list.innerHTML = '<p class="text-sm text-muted">Aucun enfant lié. Ajoutez un enfant ci-dessus.</p>';
    return;
  }

  list.innerHTML = children.map(child => {
    const name = child.full_name || child.permanent_code || '?';
    const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const photo = child.photo_base64
      ? `<img src="data:image/jpeg;base64,${child.photo_base64}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar',textContent:'${initials}'}));">`
      : `<div class="avatar">${initials}</div>`;

    return `<div class="child-row">
      ${photo}
      <div class="child-info">
        <div class="child-name">${escapeHtml(name)}</div>
        <div class="child-code">Code permanent : ${escapeHtml(child.permanent_code || '—')}</div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="removeChild(${child.id}, '${escapeAttr(name)}')">Retirer</button>
    </div>`;
  }).join('');
}

async function removeChild(childId, childName) {
  if (!confirm(`Voulez-vous vraiment retirer ${childName} de votre liste d'enfants ? Vous ne pourrez plus voir ses notes.`)) return;

  const alert = document.getElementById('alert');
  hideAlert(alert);

  const res = await PARENT.request('DELETE', `/parent/children/${childId}`);
  if (!res) return;

  const data = await res.json();
  if (!res.ok) { showAlert(alert, data.error || 'Erreur lors du retrait'); return; }

  showAlert(alert, `${childName} a été retiré de votre liste.`, 'success');
  await loadChildren();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
