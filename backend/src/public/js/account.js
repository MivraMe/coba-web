document.addEventListener('DOMContentLoaded', async () => {
  const user = await API.requireOnboarded();
  if (!user) return;
  setupNav(user);

  // Pre-fill profile
  document.getElementById('email').value = user.email;
  document.getElementById('recovery-email').value = user.recovery_email || '';
  document.getElementById('phone').value = user.phone || '';
  document.getElementById('notify-email').checked = user.notify_email;
  document.getElementById('notify-sms').checked = user.notify_sms;

  document.getElementById('form-profil').addEventListener('submit', handleProfil);
  document.getElementById('form-mdp').addEventListener('submit', handleMdp);
  document.getElementById('form-portail').addEventListener('submit', handlePortail);
  document.getElementById('form-notif').addEventListener('submit', handleNotif);
  document.getElementById('form-delete').addEventListener('submit', handleDelete);
});

async function handleProfil(e) {
  e.preventDefault();
  const alert = document.getElementById('alert-profil');
  const btn = document.getElementById('btn-profil');
  hideAlert(alert);
  setLoading(btn, true, 'Enregistrement…');

  const res = await API.request('PUT', '/compte/profil', {
    email: document.getElementById('email').value,
    recovery_email: document.getElementById('recovery-email').value || null,
  });
  setLoading(btn, false);
  if (!res) return;

  const data = await res.json();
  if (res.ok) {
    showAlert(alert, 'Profil mis à jour.', 'success');
  } else {
    showAlert(alert, data.error || 'Erreur lors de la mise à jour');
  }
}

async function handleMdp(e) {
  e.preventDefault();
  const alert = document.getElementById('alert-mdp');
  const btn = document.getElementById('btn-mdp');
  hideAlert(alert);

  const np = document.getElementById('new-pass').value;
  const cp = document.getElementById('confirm-pass').value;
  if (np !== cp) { showAlert(alert, 'Les mots de passe ne correspondent pas.'); return; }

  setLoading(btn, true, 'Modification…');
  const res = await API.request('PUT', '/compte/mot-de-passe', {
    current_password: document.getElementById('current-pass').value,
    new_password: np,
  });
  setLoading(btn, false);
  if (!res) return;

  const data = await res.json();
  if (res.ok) {
    showAlert(alert, 'Mot de passe modifié avec succès.', 'success');
    e.target.reset();
  } else {
    showAlert(alert, data.error || 'Erreur lors de la modification');
  }
}

async function handlePortail(e) {
  e.preventDefault();
  const alert = document.getElementById('alert-portail');
  const btn = document.getElementById('btn-portail');
  hideAlert(alert);
  setLoading(btn, true, 'Vérification…');

  const res = await API.request('PUT', '/compte/portail', {
    portal_username: document.getElementById('portal-user').value,
    portal_password: document.getElementById('portal-pass').value,
  });
  setLoading(btn, false);
  if (!res) return;

  const data = await res.json();
  if (res.ok) {
    showAlert(alert, 'Identifiants du portail mis à jour et données synchronisées.', 'success');
    e.target.reset();
  } else {
    showAlert(alert, data.error || 'Erreur lors de la mise à jour');
  }
}

async function handleNotif(e) {
  e.preventDefault();
  const alert = document.getElementById('alert-notif');
  const btn = document.getElementById('btn-notif');
  hideAlert(alert);
  setLoading(btn, true, 'Enregistrement…');

  const res = await API.request('PUT', '/compte/notifications', {
    phone: document.getElementById('phone').value || null,
    notify_email: document.getElementById('notify-email').checked,
    notify_sms: document.getElementById('notify-sms').checked,
  });
  setLoading(btn, false);
  if (!res) return;

  const data = await res.json();
  if (res.ok) {
    showAlert(alert, 'Préférences de notification enregistrées.', 'success');
  } else {
    showAlert(alert, data.error || 'Erreur lors de l\'enregistrement');
  }
}

async function handleDelete(e) {
  e.preventDefault();
  if (!confirm('Êtes-vous certain(e) de vouloir supprimer votre compte ? Cette action est irréversible.')) return;

  const alert = document.getElementById('alert-delete');
  const btn = document.getElementById('btn-delete');
  hideAlert(alert);
  setLoading(btn, true, 'Suppression…');

  const res = await API.request('DELETE', '/compte', {
    password: document.getElementById('delete-pass').value,
  });
  setLoading(btn, false);
  if (!res) return;

  const data = await res.json();
  if (res.ok) {
    API.logout();
  } else {
    showAlert(alert, data.error || 'Erreur lors de la suppression');
  }
}
