let currentStep = 1;
let discoveredCourses = [];
let newGroups = [];

document.addEventListener('DOMContentLoaded', async () => {
  const user = await API.requireAuth();
  if (!user) return;
  if (user.onboarding_completed) { window.location.href = '/dashboard'; return; }

  // Restore step from DB
  currentStep = Math.max(1, user.onboarding_step || 1);
  showStep(currentStep);
  updateStepsBar(currentStep);

  // Step 1
  document.getElementById('form-1').addEventListener('submit', handleStep1);

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
  renderDiscovery(discoveredCourses, data.total_assignments);
  goToStep(2);
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
        : `<span class="badge badge-neutral">${c.member_count} membre(s)</span>`;
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

function renderSummary() {
  const total = discoveredCourses.length;
  const existing = discoveredCourses.filter(c => !c.is_new).length;
  const created = newGroups.length;
  const notifEmail = document.getElementById('notify-email')?.checked;
  const notifSms = document.getElementById('notify-sms')?.checked;

  const items = [
    { icon: '📚', text: `${total} cours importé(s)` },
    { icon: '👥', text: `${existing} groupe(s) rejoint(s)` },
    { icon: '✨', text: `${created} nouveau(x) groupe(s) créé(s)` },
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
