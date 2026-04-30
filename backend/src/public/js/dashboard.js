let selectedGroupId = null;
let currentYear = null;
let gradeChart = null;

document.addEventListener('DOMContentLoaded', async () => {
  const user = await API.requireOnboarded();
  if (!user) return;
  setupNav(user);

  document.getElementById('sync-btn').addEventListener('click', handleSync);
  document.getElementById('detail-close').addEventListener('click', closeDetail);

  await loadYears();
});

async function loadYears() {
  const years = await API.get('/dashboard/annees');
  const container = document.getElementById('year-filter');

  if (!years || years.length === 0) {
    container.innerHTML = '';
    currentYear = null;
    await loadCourses();
    return;
  }

  container.innerHTML = years.map((y, i) =>
    `<button class="year-btn${i === 0 ? ' active' : ''}" data-year="${y}">${y}</button>`
  ).join('');

  currentYear = years[0];

  container.querySelectorAll('.year-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.year-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentYear = btn.dataset.year;
      closeDetail();
      loadCourses();
    });
  });

  await loadCourses();
}

async function loadCourses() {
  const grid = document.getElementById('courses-grid');
  grid.innerHTML = '<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>';

  const url = currentYear ? `/dashboard/cours?annee=${encodeURIComponent(currentYear)}` : '/dashboard/cours';
  const courses = await API.get(url);

  if (!courses || courses.length === 0) {
    grid.innerHTML = '<div class="empty-state"><p>Aucun cours trouvé pour cette période.</p></div>';
    return;
  }

  grid.innerHTML = courses.map(c => {
    const pAvg = c.personal_avg ? `${parseFloat(c.personal_avg).toFixed(1)}%` : '—';
    const gAvg = c.group_avg ? `${parseFloat(c.group_avg).toFixed(1)}%` : '—';
    const progress = c.total_weight > 0 ? (c.graded_weight / c.total_weight) * 100 : 0;

    return `<div class="course-card" data-group-id="${c.group_id}" onclick="openDetail(${c.group_id}, this)">
      <div class="course-card-header">
        <div>
          <div class="course-code">${escapeHtml(c.course_code)}</div>
          <div class="course-name">${escapeHtml(c.course_name)}</div>
          <div style="font-size:.8rem;color:var(--text-3);margin-top:.15rem">${c.school_year}</div>
        </div>
        ${c.is_admin ? '<span class="badge badge-primary">Admin</span>' : ''}
      </div>
      <div class="course-averages">
        <div class="avg-item">
          <div class="avg-label">Ma moyenne</div>
          <div class="avg-value personal">${pAvg}</div>
        </div>
        <div class="avg-item">
          <div class="avg-label">Moy. groupe</div>
          <div class="avg-value group">${gAvg}</div>
        </div>
        <div class="avg-item">
          <div class="avg-label">Membres</div>
          <div class="avg-value" style="color:var(--text-2);font-size:1rem">${c.member_count}</div>
        </div>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-label">Notes saisies : ${c.graded_weight} / ${c.total_weight} pts</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${Math.min(100, progress).toFixed(1)}%"></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function openDetail(groupId, cardEl) {
  document.querySelectorAll('.course-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');

  selectedGroupId = groupId;
  const panel = document.getElementById('detail-panel');
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Load data
  const [travaux, graphique] = await Promise.all([
    API.get(`/dashboard/cours/${groupId}/travaux`),
    API.get(`/dashboard/cours/${groupId}/graphique`),
  ]);

  // Update header
  const card = cardEl;
  document.getElementById('detail-code').textContent = card.querySelector('.course-code').textContent;
  document.getElementById('detail-name').textContent = card.querySelector('.course-name').textContent;

  renderDetailStats(travaux);
  renderChart(graphique);
  renderAssignmentsTable(travaux);
}

function renderDetailStats(travaux) {
  if (!travaux) return;
  const graded = travaux.filter(t => t.personal_pct !== null);

  const personalAvg = graded.length > 0
    ? graded.reduce((s, t) => s + t.weight * parseFloat(t.personal_pct), 0) /
      graded.reduce((s, t) => s + t.weight, 0)
    : null;

  const groupAvg = graded.length > 0 && graded.some(t => t.group_avg_pct !== null)
    ? graded.filter(t => t.group_avg_pct !== null)
        .reduce((s, t) => s + t.weight * parseFloat(t.group_avg_pct), 0) /
      graded.filter(t => t.group_avg_pct !== null).reduce((s, t) => s + t.weight, 0)
    : null;

  const sortedPct = graded.map(t => parseFloat(t.personal_pct)).sort((a, b) => a - b);
  const median = sortedPct.length > 0
    ? sortedPct.length % 2 === 0
      ? (sortedPct[sortedPct.length / 2 - 1] + sortedPct[sortedPct.length / 2]) / 2
      : sortedPct[Math.floor(sortedPct.length / 2)]
    : null;

  document.getElementById('detail-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Ma moyenne pondérée</div>
      <div class="stat-value">${personalAvg !== null ? personalAvg.toFixed(1) + '%' : '—'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Médiane personnelle</div>
      <div class="stat-value">${median !== null ? median.toFixed(1) + '%' : '—'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Moy. groupe pondérée</div>
      <div class="stat-value" style="color:var(--success)">${groupAvg !== null ? groupAvg.toFixed(1) + '%' : '—'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Évaluations notées</div>
      <div class="stat-value" style="font-size:1.4rem">${graded.length} / ${travaux.length}</div>
    </div>`;
}

function renderChart(data) {
  if (!data || !data.points) return;
  const canvas = document.getElementById('grade-chart');
  if (gradeChart) { gradeChart.destroy(); gradeChart = null; }

  const pts = data.points.filter(p => p.personal_avg !== null || p.group_avg !== null);
  if (pts.length === 0) {
    canvas.parentElement.innerHTML = '<p class="text-muted text-sm text-center" style="padding:2rem">Aucune donnée à afficher pour le graphique.</p>';
    return;
  }

  gradeChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: pts.map(p => `${p.cumulative_weight_pct}%`),
      datasets: [
        {
          label: 'Ma moyenne',
          data: pts.map(p => p.personal_avg),
          borderColor: '#1e40af',
          backgroundColor: 'rgba(30,64,175,.08)',
          tension: .35,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: false,
        },
        {
          label: 'Moyenne du groupe',
          data: pts.map(p => p.group_avg),
          borderColor: '#059669',
          backgroundColor: 'rgba(5,150,105,.08)',
          tension: .35,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: false,
          borderDash: [5, 3],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}%`,
            title: ctx => {
              const p = pts[ctx[0].dataIndex];
              return `${p.title} (${p.cumulative_weight_pct}% cumulé)`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: '% de la note finale (cumulé)' },
          grid: { color: '#f1f5f9' },
        },
        y: {
          title: { display: true, text: 'Moyenne pondérée (%)' },
          min: 0, max: 100,
          grid: { color: '#f1f5f9' },
          ticks: { callback: v => v + '%' },
        },
      },
    },
  });
}

function renderAssignmentsTable(travaux) {
  const tbody = document.getElementById('assignments-table');
  if (!travaux || travaux.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Aucune évaluation</td></tr>';
    return;
  }
  tbody.innerHTML = travaux.map(t => {
    const pct = t.personal_pct;
    const cls = pctClass(pct);
    return `<tr>
      <td>${escapeHtml(t.title)}</td>
      <td>${escapeHtml(t.category || '—')}</td>
      <td>${t.weight} %</td>
      <td>${formatDate(t.date_assigned)}</td>
      <td class="td-pct ${cls}">
        ${pct !== null ? `${t.score_obtained} / ${t.score_max} (${parseFloat(pct).toFixed(1)}%)` : '—'}
      </td>
      <td class="td-pct ${pctClass(t.group_avg_pct)}">
        ${t.group_avg_pct !== null ? parseFloat(t.group_avg_pct).toFixed(1) + '%' : '—'}
        ${t.graded_count > 0 ? `<span class="text-muted" style="font-size:.75rem"> (${t.graded_count})</span>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function closeDetail() {
  document.getElementById('detail-panel').classList.add('hidden');
  document.querySelectorAll('.course-card').forEach(c => c.classList.remove('selected'));
  if (gradeChart) { gradeChart.destroy(); gradeChart = null; }
  selectedGroupId = null;
}

async function handleSync() {
  const btn = document.getElementById('sync-btn');
  const alert = document.getElementById('sync-alert');
  hideAlert(alert);
  setLoading(btn, true, 'Synchronisation…');

  const res = await API.request('POST', '/dashboard/synchroniser');
  setLoading(btn, false);
  if (!res) return;

  if (res.ok) {
    showAlert(alert, 'Synchronisation terminée avec succès.', 'success');
    closeDetail();
    await loadCourses();
  } else {
    const data = await res.json();
    showAlert(alert, data.error || 'Erreur lors de la synchronisation');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
