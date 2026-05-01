let currentStep = 1;
let discoveredCourses = [];
let newGroups = [];
let totalAssignmentsCount = 0;

// ── Crop tool state ──────────────────────────────────────────────────────────
const cropState = { img: null, zoom: 1, offsetX: 0, offsetY: 0, dragging: false, startX: 0, startY: 0, usePhoto: false };

function initCropTool(base64) {
  cropState.usePhoto = true;
  const src = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
  const img = new Image();
  img.onload = () => {
    cropState.img = img;
    const canvas = document.getElementById('crop-canvas');
    const size = canvas.width;
    const scale = Math.max(size / img.width, size / img.height);
    cropState.zoom = scale;
    cropState.offsetX = (size - img.width * scale) / 2;
    cropState.offsetY = (size - img.height * scale) / 2;
    const zoomSlider = document.getElementById('crop-zoom');
    zoomSlider.min = scale.toFixed(4);
    zoomSlider.max = (scale * 3).toFixed(4);
    zoomSlider.value = scale.toFixed(4);
    renderCrop('crop-canvas');
    setupCropDrag(canvas);
  };
  img.src = src;
}

function renderCrop(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);

  if (!cropState.usePhoto || !cropState.img) {
    ctx.fillStyle = 'var(--bg-2, #e2e8f0)';
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
  ctx.drawImage(cropState.img, cropState.offsetX, cropState.offsetY,
    cropState.img.width * cropState.zoom, cropState.img.height * cropState.zoom);
  ctx.restore();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.stroke();
}

function clampCropOffset(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !cropState.img) return;
  const size = canvas.width;
  const scaledW = cropState.img.width * cropState.zoom;
  const scaledH = cropState.img.height * cropState.zoom;
  cropState.offsetX = Math.min(0, Math.max(size - scaledW, cropState.offsetX));
  cropState.offsetY = Math.min(0, Math.max(size - scaledH, cropState.offsetY));
}

function setupCropDrag(canvas) {
  const canvasId = canvas.id;
  canvas.addEventListener('mousedown', e => {
    cropState.dragging = true;
    cropState.startX = e.clientX - cropState.offsetX;
    cropState.startY = e.clientY - cropState.offsetY;
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!cropState.dragging) return;
    cropState.offsetX = e.clientX - cropState.startX;
    cropState.offsetY = e.clientY - cropState.startY;
    clampCropOffset(canvasId);
    renderCrop(canvasId);
  });
  window.addEventListener('mouseup', () => { cropState.dragging = false; canvas.style.cursor = 'grab'; });
  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0];
    cropState.dragging = true;
    cropState.startX = t.clientX - cropState.offsetX;
    cropState.startY = t.clientY - cropState.offsetY;
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.touches[0];
    cropState.offsetX = t.clientX - cropState.startX;
    cropState.offsetY = t.clientY - cropState.startY;
    clampCropOffset(canvasId);
    renderCrop(canvasId);
  }, { passive: false });
  canvas.addEventListener('touchend', () => { cropState.dragging = false; });
}

function getCroppedBase64(canvasId, outputSize = 200) {
  if (!cropState.usePhoto || !cropState.img) return null;
  const src = document.getElementById(canvasId);
  const scale = outputSize / src.width;
  const out = document.createElement('canvas');
  out.width = outputSize;
  out.height = outputSize;
  const ctx = out.getContext('2d');
  ctx.save();
  ctx.beginPath();
  ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(cropState.img,
    cropState.offsetX * scale, cropState.offsetY * scale,
    cropState.img.width * cropState.zoom * scale, cropState.img.height * cropState.zoom * scale);
  ctx.restore();
  return out.toDataURL('image/jpeg', 0.88);
}
// ── End crop tool ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const user = await API.requireAuth();
  if (!user) return;
  if (user.role === 'superadmin') { window.location.href = '/admin'; return; }
  if (user.onboarding_completed) { window.location.href = '/dashboard'; return; }

  // Restore step from DB
  currentStep = Math.max(1, user.onboarding_step || 1);
  showStep(currentStep);
  updateStepsBar(currentStep);

  // Step 1 + photo
  document.getElementById('form-1').addEventListener('submit', handleStep1);

  document.getElementById('crop-zoom').addEventListener('input', e => {
    const newZoom = parseFloat(e.target.value);
    const canvas = document.getElementById('crop-canvas');
    const size = canvas.width;
    const imgX = (size / 2 - cropState.offsetX) / cropState.zoom;
    const imgY = (size / 2 - cropState.offsetY) / cropState.zoom;
    cropState.zoom = newZoom;
    cropState.offsetX = size / 2 - imgX * newZoom;
    cropState.offsetY = size / 2 - imgY * newZoom;
    clampCropOffset('crop-canvas');
    renderCrop('crop-canvas');
  });

  document.getElementById('photo-upload').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => initCropTool(ev.target.result);
    reader.readAsDataURL(file);
  });

  document.getElementById('btn-no-photo').addEventListener('click', () => {
    cropState.usePhoto = false;
    cropState.img = null;
    renderCrop('crop-canvas');
  });

  document.getElementById('btn-1-continue').addEventListener('click', async () => {
    const photo = getCroppedBase64('crop-canvas');
    if (photo) {
      await API.request('PUT', '/compte/photo', { photo_base64: photo });
    }
    renderDiscovery(discoveredCourses, totalAssignmentsCount);
    goToStep(2);
  });

  // Step 2
  document.getElementById('btn-2').addEventListener('click', () => {
    const hasNewGroups = newGroups.length > 0;
    if (hasNewGroups) {
      renderNewGroupsForm();
      goToStep(3);
    } else {
      goToStep(4);
    }
  });

  // Step 3
  document.getElementById('btn-3').addEventListener('click', handleStep3);
  document.getElementById('btn-3-skip').addEventListener('click', () => skipStep(3));

  // Step 4
  document.getElementById('form-4').addEventListener('submit', handleStep4);
  document.getElementById('btn-4-skip').addEventListener('click', () => skipStep(4));

  // Step 5
  document.getElementById('btn-5').addEventListener('click', handleStep5);
});

async function handleStep1(e) {
  e.preventDefault();
  const alert = document.getElementById('alert-1');
  const btn = document.getElementById('btn-1');
  hideAlert(alert);
  setLoading(btn, true, 'Vérification…');

  const res = await API.request('POST', '/onboarding/portail', {
    portal_username: document.getElementById('portal-user').value,
    portal_password: document.getElementById('portal-pass').value,
  });
  setLoading(btn, false);
  if (!res) return;

  const data = await res.json();
  if (!res.ok) {
    const msgs = {
      INVALID_CREDENTIALS: 'Identifiants incorrects. Veuillez vérifier votre nom d\'utilisateur et mot de passe.',
      PORTAL_SLOW: data.error,
      SESSION_EXPIRED: data.error,
      PORTAL_UNREACHABLE: 'Le portail est inaccessible. Veuillez réessayer plus tard.',
    };
    showAlert(alert, msgs[data.code] || data.error || 'Erreur de connexion au portail');
    return;
  }

  discoveredCourses = data.courses || [];
  newGroups = discoveredCourses.filter(c => c.is_new);
  totalAssignmentsCount = data.total_assignments || 0;

  // Show profile info + photo crop before going to step 2
  const profile = data.profile || {};
  if (profile.full_name || profile.permanent_code || profile.photo_base64) {
    const infoEl = document.getElementById('profile-info');
    infoEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:.75rem;padding:.75rem;background:var(--bg-2);border-radius:.5rem">
        <svg width="18" height="18" fill="none" stroke="var(--success,#22c55e)" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <div>
          ${profile.full_name ? `<div style="font-weight:600">${escapeHtml(profile.full_name)}</div>` : ''}
          ${profile.permanent_code ? `<div class="text-muted text-sm">${escapeHtml(profile.permanent_code)}</div>` : ''}
        </div>
      </div>`;
    if (profile.photo_base64) {
      initCropTool(profile.photo_base64);
    } else {
      renderCrop('crop-canvas');
    }
    document.getElementById('profile-section').classList.remove('hidden');
    document.getElementById('btn-1').classList.add('hidden');
  } else {
    renderDiscovery(discoveredCourses, totalAssignmentsCount);
    goToStep(2);
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderDiscovery(courses, totalAssignments) {
  const container = document.getElementById('courses-discovery');
  const summary = document.getElementById('discovery-summary');
  summary.textContent = `${totalAssignments} évaluation(s) importée(s)`;

  // Group by school_year
  const byYear = {};
  for (const c of courses) {
    const y = c.school_year || 'Année inconnue';
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(c);
  }

  let html = '';
  for (const [year, list] of Object.entries(byYear).sort((a, b) => b[0].localeCompare(a[0]))) {
    html += `<div class="year-section"><div class="year-label">${year}</div><ul class="course-list">`;
    for (const c of list) {
      const badge = c.is_new
        ? `<span class="badge badge-primary">Nouveau groupe</span>`
        : `<span class="badge badge-neutral">${fr(c.member_count, 'membre', 'membres')}</span>`;
      html += `<li class="course-item">
        <div>
          <div class="course-info">${c.course_code} — ${c.course_name}</div>
        </div>
        ${badge}
      </li>`;
    }
    html += `</ul></div>`;
  }
  container.innerHTML = html || '<p class="text-muted">Aucun cours trouvé.</p>';
}

function renderNewGroupsForm() {
  const container = document.getElementById('new-groups-list');
  let html = '';
  for (const g of newGroups) {
    html += `
      <div class="group-config-card" data-group-id="${g.group_id || ''}">
        <h3>${g.course_code} — ${g.course_name}</h3>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Année scolaire</label>
            <input type="text" class="form-control gc-year" value="${g.school_year || ''}" placeholder="2025-2026">
          </div>
          <div class="form-group">
            <label class="form-label">Nb. d'étudiants <span class="text-muted">(facultatif)</span></label>
            <input type="number" class="form-control gc-total" min="1" max="100" placeholder="Ex. 30">
          </div>
        </div>
      </div>`;
  }
  container.innerHTML = html || '<p class="text-muted">Aucun nouveau groupe à configurer.</p>';
}

async function handleStep3() {
  const alert = document.getElementById('alert-3');
  hideAlert(alert);
  const cards = document.querySelectorAll('.group-config-card');
  const groups = Array.from(cards).map(card => ({
    group_id: card.dataset.groupId || null,
    school_year: card.querySelector('.gc-year').value || null,
    total_students: parseInt(card.querySelector('.gc-total').value) || null,
  }));

  const res = await API.request('POST', '/onboarding/groupes', { groups });
  if (!res || !res.ok) {
    showAlert(alert, 'Erreur lors de l\'enregistrement des groupes');
    return;
  }
  goToStep(4);
}

async function handleStep4(e) {
  e.preventDefault();
  const alert = document.getElementById('alert-4');
  const btn = document.getElementById('btn-4');
  hideAlert(alert);
  setLoading(btn, true, 'Enregistrement…');

  const res = await API.request('POST', '/onboarding/notifications', {
    recovery_email: document.getElementById('recovery-email').value || null,
    phone: document.getElementById('phone').value || null,
    notify_email: document.getElementById('notify-email').checked,
    notify_sms: document.getElementById('notify-sms').checked,
  });
  setLoading(btn, false);
  if (!res || !res.ok) {
    showAlert(alert, 'Erreur lors de l\'enregistrement');
    return;
  }
  renderSummary();
  goToStep(5);
}

async function skipStep(step) {
  await API.request('POST', `/onboarding/${step === 3 ? 'groupes' : 'notifications'}`,
    step === 3 ? { groups: [] } : { notify_email: false, notify_sms: false }
  );
  if (step === 3) goToStep(4);
  else { renderSummary(); goToStep(5); }
}

function fr(n, singular, plural) { return `${n} ${n === 1 ? singular : plural}`; }

function renderSummary() {
  const total = discoveredCourses.length;
  const existing = discoveredCourses.filter(c => !c.is_new).length;
  const created = newGroups.length;
  const notifEmail = document.getElementById('notify-email')?.checked;
  const notifSms = document.getElementById('notify-sms')?.checked;

  const items = [
    { icon: '📚', text: fr(total, 'cours importé', 'cours importés') },
    { icon: '👥', text: fr(existing, 'groupe rejoint', 'groupes rejoints') },
    { icon: '✨', text: fr(created, 'nouveau groupe créé', 'nouveaux groupes créés') },
    { icon: '📧', text: notifEmail ? 'Notifications courriel activées' : 'Notifications courriel désactivées' },
    { icon: '💬', text: notifSms ? 'Notifications SMS activées' : 'Notifications SMS désactivées' },
  ];

  document.getElementById('summary-list').innerHTML = items.map(i =>
    `<div style="display:flex;align-items:center;gap:.6rem;padding:.5rem 0;border-bottom:1px solid var(--border)">
      <span style="font-size:1.2rem">${i.icon}</span>
      <span>${i.text}</span>
    </div>`
  ).join('');
}

async function handleStep5() {
  const res = await API.request('POST', '/onboarding/terminer');
  if (res && res.ok) window.location.href = '/dashboard';
}

function goToStep(step) {
  currentStep = step;
  showStep(step);
  updateStepsBar(step);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showStep(step) {
  for (let i = 1; i <= 5; i++) {
    document.getElementById(`step-${i}`)?.classList.toggle('hidden', i !== step);
  }
}

function updateStepsBar(activeStep) {
  document.querySelectorAll('.step-item').forEach(el => {
    const n = parseInt(el.dataset.step);
    el.classList.toggle('done', n < activeStep);
    el.classList.toggle('active', n === activeStep);
  });
}
