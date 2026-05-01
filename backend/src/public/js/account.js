// ── Crop tool (compte page) ──────────────────────────────────────────────────
const acCrop = { img: null, zoom: 1, offsetX: 0, offsetY: 0, dragging: false, startX: 0, startY: 0, usePhoto: false, portalBase64: null };

function acInitCrop(base64) {
  acCrop.usePhoto = true;
  const src = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
  const img = new Image();
  img.onload = () => {
    acCrop.img = img;
    const canvas = document.getElementById('crop-canvas-compte');
    const size = canvas.width;
    const scale = Math.max(size / img.width, size / img.height);
    acCrop.zoom = scale;
    acCrop.offsetX = (size - img.width * scale) / 2;
    acCrop.offsetY = (size - img.height * scale) / 2;
    const zoomSlider = document.getElementById('crop-zoom-compte');
    zoomSlider.min = scale.toFixed(4);
    zoomSlider.max = (scale * 3).toFixed(4);
    zoomSlider.value = scale.toFixed(4);
    acRenderCrop();
    acSetupDrag();
  };
  img.src = src;
}

function acRenderCrop() {
  const canvas = document.getElementById('crop-canvas-compte');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  if (!acCrop.usePhoto || !acCrop.img) {
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.font = `bold ${Math.round(size / 2.8)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', size / 2, size / 2 + 2);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(acCrop.img, acCrop.offsetX, acCrop.offsetY,
    acCrop.img.width * acCrop.zoom, acCrop.img.height * acCrop.zoom);
  ctx.restore();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.stroke();
}

function acClamp() {
  const canvas = document.getElementById('crop-canvas-compte');
  if (!canvas || !acCrop.img) return;
  const size = canvas.width;
  acCrop.offsetX = Math.min(0, Math.max(size - acCrop.img.width * acCrop.zoom, acCrop.offsetX));
  acCrop.offsetY = Math.min(0, Math.max(size - acCrop.img.height * acCrop.zoom, acCrop.offsetY));
}

function acSetupDrag() {
  const canvas = document.getElementById('crop-canvas-compte');
  if (!canvas) return;
  canvas.addEventListener('mousedown', e => {
    acCrop.dragging = true;
    acCrop.startX = e.clientX - acCrop.offsetX;
    acCrop.startY = e.clientY - acCrop.offsetY;
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!acCrop.dragging) return;
    acCrop.offsetX = e.clientX - acCrop.startX;
    acCrop.offsetY = e.clientY - acCrop.startY;
    acClamp(); acRenderCrop();
  });
  window.addEventListener('mouseup', () => { acCrop.dragging = false; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0];
    acCrop.dragging = true;
    acCrop.startX = t.clientX - acCrop.offsetX;
    acCrop.startY = t.clientY - acCrop.offsetY;
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.touches[0];
    acCrop.offsetX = t.clientX - acCrop.startX;
    acCrop.offsetY = t.clientY - acCrop.startY;
    acClamp(); acRenderCrop();
  }, { passive: false });
  canvas.addEventListener('touchend', () => { acCrop.dragging = false; });
}

function acGetCropped(outputSize = 200) {
  if (!acCrop.usePhoto || !acCrop.img) return null;
  const src = document.getElementById('crop-canvas-compte');
  const scale = outputSize / src.width;
  const out = document.createElement('canvas');
  out.width = outputSize;
  out.height = outputSize;
  const ctx = out.getContext('2d');
  ctx.save();
  ctx.beginPath();
  ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(acCrop.img,
    acCrop.offsetX * scale, acCrop.offsetY * scale,
    acCrop.img.width * acCrop.zoom * scale, acCrop.img.height * acCrop.zoom * scale);
  ctx.restore();
  return out.toDataURL('image/jpeg', 0.88);
}
// ── End crop tool ────────────────────────────────────────────────────────────

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

  // Display profile name and code
  if (user.full_name) document.getElementById('profile-name-display').textContent = user.full_name;
  if (user.permanent_code) document.getElementById('profile-code-display').textContent = user.permanent_code;

  // Load current photo
  const photoData = await API.get('/compte/photo');
  if (photoData?.photo_base64) {
    acCrop.portalBase64 = photoData.photo_base64;
    acInitCrop(photoData.photo_base64);
  } else {
    acRenderCrop();
  }

  // Photo controls
  document.getElementById('crop-zoom-compte').addEventListener('input', e => {
    const newZoom = parseFloat(e.target.value);
    const canvas = document.getElementById('crop-canvas-compte');
    const size = canvas.width;
    const imgX = (size / 2 - acCrop.offsetX) / acCrop.zoom;
    const imgY = (size / 2 - acCrop.offsetY) / acCrop.zoom;
    acCrop.zoom = newZoom;
    acCrop.offsetX = size / 2 - imgX * newZoom;
    acCrop.offsetY = size / 2 - imgY * newZoom;
    acClamp(); acRenderCrop();
  });

  document.getElementById('photo-upload-compte').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => acInitCrop(ev.target.result);
    reader.readAsDataURL(file);
  });

  document.getElementById('btn-use-portal-photo').addEventListener('click', async () => {
    const btn = document.getElementById('btn-use-portal-photo');
    setLoading(btn, true, 'Chargement…');
    const data = await API.get('/compte/portail-photo');
    setLoading(btn, false);
    if (data?.photo_base64) {
      acInitCrop(data.photo_base64);
    } else {
      showAlert(document.getElementById('alert-photo'), data?.error || 'Aucune photo disponible sur le portail');
    }
  });

  document.getElementById('btn-remove-photo').addEventListener('click', () => {
    acCrop.usePhoto = false;
    acCrop.img = null;
    acRenderCrop();
  });

  document.getElementById('btn-save-photo').addEventListener('click', handleSavePhoto);

  document.getElementById('form-profil').addEventListener('submit', handleProfil);
  document.getElementById('form-mdp').addEventListener('submit', handleMdp);
  document.getElementById('form-portail').addEventListener('submit', handlePortail);
  document.getElementById('form-notif').addEventListener('submit', handleNotif);
  document.getElementById('form-delete').addEventListener('submit', handleDelete);
});

async function handleSavePhoto() {
  const alertEl = document.getElementById('alert-photo');
  const btn = document.getElementById('btn-save-photo');
  hideAlert(alertEl);
  setLoading(btn, true, 'Enregistrement…');

  let res;
  if (!acCrop.usePhoto || !acCrop.img) {
    res = await API.request('PUT', '/compte/photo', { clear: true });
  } else {
    const photo = acGetCropped();
    res = await API.request('PUT', '/compte/photo', { photo_base64: photo });
  }
  setLoading(btn, false);
  if (!res) return;
  const data = await res.json();
  if (res.ok) {
    showAlert(alertEl, 'Photo enregistrée.', 'success');
  } else {
    showAlert(alertEl, data.error || 'Erreur lors de l\'enregistrement');
  }
}

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
