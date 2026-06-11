let selectedGroupId = null;
let selectedChildId = null;
let currentYear = null;
let gradeChart = null;
let globalChart = null;
let globalLineChart = null;
let chartMode = 'moyenne';
let currentChartData = null;
let coursesCache = null;
let childrenList = [];

document.addEventListener('DOMContentLoaded', async () => {
  const parent = await PARENT.requireAuth();
  if (!parent) return;

  // Setup nav
  const nav = document.getElementById('main-nav');
  if (nav) {
    const emailEl = nav.querySelector('.nav-email');
    if (emailEl) emailEl.textContent = `${parent.first_name} ${parent.last_name}`;
    nav.querySelectorAll('.nav-logout').forEach(el => el.addEventListener('click', () => PARENT.logout()));
  }

  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('global-expand-btn').addEventListener('click', toggleGlobalExpand);
  document.getElementById('toggle-avg').addEventListener('click', () => setChartMode('moyenne'));
  document.getElementById('toggle-med').addEventListener('click', () => setChartMode('mediane'));

  await loadChildren();
});

function setChartMode(mode) {
  chartMode = mode;
  document.getElementById('toggle-avg').classList.toggle('active', mode === 'moyenne');
  document.getElementById('toggle-med').classList.toggle('active', mode === 'mediane');
  if (currentChartData) renderChart(currentChartData);
}

async function loadChildren() {
  const data = await PARENT.get('/parent/children');
  childrenList = data || [];

  const selector = document.getElementById('child-selector');
  const noChildren = document.getElementById('no-children');
  const mainContent = document.getElementById('main-content');

  if (!childrenList.length) {
    selector.innerHTML = '';
    noChildren.classList.remove('hidden');
    mainContent.classList.add('hidden');
    return;
  }

  noChildren.classList.add('hidden');
  mainContent.classList.remove('hidden');

  selector.innerHTML = childrenList.map(child => {
    const initials = (child.full_name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const photo = child.photo_base64
      ? `<img src="data:image/jpeg;base64,${child.photo_base64}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;" alt="">`
      : `<div class="avatar">${initials}</div>`;
    return `<button class="child-tab" data-child-id="${child.id}" data-child-name="${escapeAttr(child.full_name || child.permanent_code)}">
      ${photo}
      <span>${escapeHtml(child.full_name || child.permanent_code || '?')}</span>
    </button>`;
  }).join('');

  selector.querySelectorAll('.child-tab').forEach(btn => {
    btn.addEventListener('click', () => selectChild(parseInt(btn.dataset.childId), btn.dataset.childName));
  });

  // Sélectionner le premier enfant par défaut
  const firstBtn = selector.querySelector('.child-tab');
  if (firstBtn) firstBtn.click();
}

async function selectChild(childId, childName) {
  if (selectedChildId === childId) return;
  selectedChildId = childId;

  document.querySelectorAll('.child-tab').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.childId) === childId);
  });

  document.getElementById('active-child-name').textContent = childName || '';
  closeDetail();

  await loadYears();
}

async function loadYears() {
  if (!selectedChildId) return;
  const years = await PARENT.get(`/parent/children/${selectedChildId}/annees`);
  const container = document.getElementById('year-filter');

  if (!years || years.length === 0) {
    container.innerHTML = '';
    currentYear = null;
    await Promise.all([loadGlobalStats(), loadCourses()]);
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
      Promise.all([loadGlobalStats(), loadCourses()]);
    });
  });

  await Promise.all([loadGlobalStats(), loadCourses()]);
}

async function loadGlobalStats() {
  if (!selectedChildId) return;
  const url = currentYear
    ? `/parent/children/${selectedChildId}/resume?annee=${encodeURIComponent(currentYear)}`
    : `/parent/children/${selectedChildId}/resume`;
  const stats = await PARENT.get(url);
  if (!stats) return;

  const row = document.getElementById('global-stats-row');
  const pAvg = stats.personal_avg ? `${parseFloat(stats.personal_avg).toFixed(1)}%` : '—';
  const pMed = stats.personal_median ? `${parseFloat(stats.personal_median).toFixed(1)}%` : '—';
  const gAvg = stats.group_avg ? `${parseFloat(stats.group_avg).toFixed(1)}%` : '—';
  const showGroupMed = stats.group_member_count >= 3 && stats.group_median != null;
  const gMed = showGroupMed ? `${parseFloat(stats.group_median).toFixed(1)}%` : null;
  const gw = parseInt(stats.graded_weight) || 0;
  const tw = parseInt(stats.total_weight) || 0;

  row.innerHTML = `
    <div class="global-stat">
      <div class="global-stat-label">Moyenne</div>
      <div class="global-stat-value">${pAvg}</div>
      <div class="global-stat-sub">Méd. ${pMed}</div>
    </div>
    <div class="divider-v"></div>
    <div class="global-stat">
      <div class="global-stat-label">Moy. groupe</div>
      <div class="global-stat-value" style="font-size:1.5rem">${gAvg}</div>
      ${gMed !== null ? `<div class="global-stat-sub">Méd. groupe ${gMed}</div>` : ''}
    </div>
    <div class="divider-v"></div>
    <div class="global-stat">
      <div class="global-stat-label">Pondération saisie</div>
      <div class="global-stat-value" style="font-size:1.5rem">${gw} / ${tw}</div>
      <div class="global-stat-sub">${tw > 0 ? Math.round((gw/tw)*100) : 0}% des évaluations notées</div>
    </div>`;
}

async function toggleGlobalExpand() {
  const panel = document.getElementById('global-expanded');
  const btn = document.getElementById('global-expand-btn');
  const isHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !isHidden);
  btn.textContent = isHidden ? '▲ Afficher moins' : '▼ Afficher plus';
  if (isHidden) await loadGlobalChart();
}

async function loadGlobalChart() {
  if (!selectedChildId) return;
  const url = currentYear
    ? `/parent/children/${selectedChildId}/cours?annee=${encodeURIComponent(currentYear)}`
    : `/parent/children/${selectedChildId}/cours`;
  const courses = await PARENT.get(url);
  if (!courses || courses.length === 0) return;

  const canvas = document.getElementById('global-chart');
  if (globalChart) { globalChart.destroy(); globalChart = null; }

  globalChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: courses.map(c => c.course_code),
      datasets: [
        { label: 'Moyenne', data: courses.map(c => c.personal_avg !== null ? parseFloat(c.personal_avg) : null), backgroundColor: 'rgba(147,197,253,0.9)', borderRadius: 4 },
        { label: 'Moy. groupe', data: courses.map(c => c.group_avg !== null ? parseFloat(c.group_avg) : null), backgroundColor: 'rgba(110,231,183,0.9)', borderRadius: 4 },
        { label: 'Méd. groupe', data: courses.map(c => c.group_median !== null ? parseFloat(c.group_median) : null), backgroundColor: 'rgba(253,224,71,0.9)', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { color: 'rgba(255,255,255,.85)' } } },
      scales: {
        y: { min: 0, max: 100, ticks: { callback: v => v + '%', color: 'rgba(255,255,255,.7)' }, grid: { color: 'rgba(255,255,255,.15)' } },
        x: { ticks: { color: 'rgba(255,255,255,.7)' }, grid: { display: false } },
      },
    },
  });

  await loadGlobalLineChart(courses);
}

async function loadGlobalLineChart(courses) {
  const canvas = document.getElementById('global-line-chart');
  if (globalLineChart) { globalLineChart.destroy(); globalLineChart = null; }

  const palette = ['rgba(147,197,253,0.9)','rgba(110,231,183,0.9)','rgba(253,224,71,0.9)','rgba(249,168,212,0.9)','rgba(196,181,253,0.9)','rgba(253,186,116,0.9)'];
  const graphiques = await Promise.all(
    courses.map(c => PARENT.get(`/parent/children/${selectedChildId}/cours/${c.group_id}/graphique`))
  );

  const datasets = [];
  for (let i = 0; i < courses.length; i++) {
    const g = graphiques[i];
    if (!g || !g.points || g.points.length === 0) continue;
    datasets.push({
      label: courses[i].course_code,
      data: g.points.map(p => ({ x: p.cumulative_weight_pct, y: p.personal_running_avg })),
      borderColor: palette[i % palette.length], backgroundColor: 'transparent',
      tension: .35, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2, spanGaps: true,
    });
  }
  if (datasets.length === 0) return;

  globalLineChart = new Chart(canvas, {
    type: 'line', data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { color: 'rgba(255,255,255,.85)', boxWidth: 12 } } },
      scales: {
        x: { type: 'linear', min: 0, max: 100, title: { display: true, text: '% de la note finale', color: 'rgba(255,255,255,.6)' }, ticks: { callback: v => v + '%', color: 'rgba(255,255,255,.7)' }, grid: { color: 'rgba(255,255,255,.1)' } },
        y: { min: 0, max: 100, ticks: { callback: v => v + '%', color: 'rgba(255,255,255,.7)' }, grid: { color: 'rgba(255,255,255,.1)' } },
      },
    },
  });
}

async function loadCourses() {
  if (!selectedChildId) return;
  const grid = document.getElementById('courses-grid');
  grid.innerHTML = '<div class="loading-overlay"><span class="spinner spinner-dark"></span></div>';

  const url = currentYear
    ? `/parent/children/${selectedChildId}/cours?annee=${encodeURIComponent(currentYear)}`
    : `/parent/children/${selectedChildId}/cours`;
  const courses = await PARENT.get(url);
  coursesCache = courses;

  if (!courses || courses.length === 0) {
    grid.innerHTML = '<div class="empty-state"><p>Aucun cours trouvé pour cette période.</p></div>';
    return;
  }

  grid.innerHTML = courses.map(c => {
    const pAvg = c.personal_avg ? `${parseFloat(c.personal_avg).toFixed(1)}%` : '—';
    const gAvg = c.group_avg ? `${parseFloat(c.group_avg).toFixed(1)}%` : '—';
    const showGMed = c.member_count >= 3 && c.group_median != null;
    const gMed = showGMed ? `${parseFloat(c.group_median).toFixed(1)}%` : null;
    const progress = c.total_weight > 0 ? (c.graded_weight / c.total_weight) * 100 : 0;

    return `<div class="course-card" data-group-id="${c.group_id}" onclick="openDetail(${c.group_id}, this)">
      <div class="course-card-header">
        <div>
          <div class="course-code">${escapeHtml(c.course_code)}</div>
          <div class="course-name">${escapeHtml(c.course_name)}</div>
          <div style="font-size:.8rem;color:var(--text-3);margin-top:.15rem">${c.school_year}</div>
        </div>
      </div>
      <div class="course-averages">
        <div class="avg-item"><div class="avg-label">Moyenne</div><div class="avg-value personal">${pAvg}</div></div>
        <div class="avg-item"><div class="avg-label">Moy. groupe</div><div class="avg-value group">${gAvg}</div></div>
        ${gMed !== null ? `<div class="avg-item"><div class="avg-label">Méd. groupe</div><div class="avg-value" style="color:var(--warning)">${gMed}</div></div>` : ''}
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-label">${c.graded_weight} / ${c.total_weight} pts pondérés saisis</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, progress).toFixed(1)}%"></div></div>
      </div>
    </div>`;
  }).join('');
}

async function openDetail(groupId, cardEl) {
  if (!selectedChildId) return;
  document.querySelectorAll('.course-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');
  selectedGroupId = groupId;

  const panel = document.getElementById('detail-panel');
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('detail-code').textContent = cardEl.querySelector('.course-code').textContent;
  document.getElementById('detail-name').textContent = cardEl.querySelector('.course-name').textContent;

  const [travaux, graphique] = await Promise.all([
    PARENT.get(`/parent/children/${selectedChildId}/cours/${groupId}/travaux`),
    PARENT.get(`/parent/children/${selectedChildId}/cours/${groupId}/graphique`),
  ]);

  currentChartData = graphique;
  renderDetailStats(travaux, graphique);
  renderChart(graphique);
  renderAssignmentsTable(travaux);
}

function renderDetailStats(travaux, graphique) {
  if (!travaux) return;
  const graded = travaux.filter(t => t.personal_pct !== null);

  const personalAvg = graphique?.points?.length
    ? graphique.points[graphique.points.length - 1]?.personal_running_avg : null;
  const groupAvg = graphique?.points?.length
    ? graphique.points[graphique.points.length - 1]?.group_running_avg : null;

  const sortedPct = graded.map(t => parseFloat(t.personal_pct)).sort((a, b) => a - b);
  const personalMed = sortedPct.length > 0
    ? sortedPct.length % 2 === 0
      ? (sortedPct[sortedPct.length / 2 - 1] + sortedPct[sortedPct.length / 2]) / 2
      : sortedPct[Math.floor(sortedPct.length / 2)]
    : null;

  const cachedCourse = coursesCache?.find(c => c.group_id === selectedGroupId);
  const showGroupMed = cachedCourse?.member_count >= 3 && cachedCourse?.group_median != null;
  const groupMed = showGroupMed ? parseFloat(cachedCourse.group_median) : null;

  const gw = graphique?.graded_weight || 0;
  const tw = graphique?.total_weight || 0;

  document.getElementById('detail-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Moyenne pondérée</div>
      <div class="stat-value">${personalAvg !== null ? parseFloat(personalAvg).toFixed(1) + '%' : '—'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Médiane</div>
      <div class="stat-value" style="font-size:1.4rem">${personalMed !== null ? personalMed.toFixed(1) + '%' : '—'}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Moy. groupe pondérée</div>
      <div class="stat-value" style="color:var(--success)">${groupAvg !== null ? parseFloat(groupAvg).toFixed(1) + '%' : '—'}</div>
    </div>
    ${groupMed !== null ? `<div class="stat-card"><div class="stat-label">Méd. groupe</div><div class="stat-value" style="color:var(--warning);font-size:1.4rem">${groupMed.toFixed(1)}%</div></div>` : ''}
    <div class="stat-card">
      <div class="stat-label">Évaluations notées</div>
      <div class="stat-value" style="font-size:1.4rem">${graded.length} / ${travaux.length}</div>
      <div class="stat-sub">${gw} / ${tw} pts pondérés</div>
    </div>`;
}

function renderChart(data) {
  if (!data || !data.points) return;
  const canvas = document.getElementById('grade-chart');
  if (gradeChart) { gradeChart.destroy(); gradeChart = null; }

  const pts = data.points;
  let noDataMsg = canvas.parentElement.querySelector('.chart-no-data');
  if (pts.length === 0) {
    canvas.style.display = 'none';
    if (!noDataMsg) {
      noDataMsg = document.createElement('p');
      noDataMsg.className = 'chart-no-data text-muted text-sm text-center';
      noDataMsg.style.padding = '2rem';
      noDataMsg.textContent = 'Aucune donnée à afficher.';
      canvas.parentElement.appendChild(noDataMsg);
    }
    return;
  }
  if (noDataMsg) noDataMsg.remove();
  canvas.style.display = '';

  const isMoyenne = chartMode === 'moyenne';
  const yPersonal0 = isMoyenne ? pts[0].personal_running_avg : pts[0].personal_pct;
  const yGroup0    = isMoyenne ? pts[0].group_running_avg    : pts[0].group_median_pct;

  const personalData = [
    { x: 0, y: yPersonal0 ?? null },
    ...pts.map(p => ({ x: p.cumulative_weight_pct, y: isMoyenne ? p.personal_running_avg : p.personal_pct })),
  ];
  const groupData = [
    { x: 0, y: yGroup0 ?? null },
    ...pts.map(p => ({ x: p.cumulative_weight_pct, y: isMoyenne ? p.group_running_avg : p.group_median_pct })),
  ];

  gradeChart = new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        { label: isMoyenne ? 'Moyenne (cumul.)' : 'Note', data: personalData, borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,.08)', tension: isMoyenne ? .35 : 0, pointRadius: ctx => ctx.dataIndex === 0 ? 0 : 4, pointHoverRadius: ctx => ctx.dataIndex === 0 ? 0 : 6, fill: false, spanGaps: true },
        { label: isMoyenne ? 'Moy. groupe (cumul.)' : 'Méd. groupe', data: groupData, borderColor: isMoyenne ? '#059669' : '#d97706', backgroundColor: 'transparent', tension: isMoyenne ? .35 : 0, pointRadius: ctx => ctx.dataIndex === 0 ? 0 : 4, pointHoverRadius: ctx => ctx.dataIndex === 0 ? 0 : 6, fill: false, borderDash: [5, 3], spanGaps: true },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          filter: item => item.dataIndex > 0,
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y !== null ? ctx.parsed.y.toFixed(1) + '%' : '—'}`,
            title: ctx => { const p = pts[ctx[0].dataIndex - 1]; return p ? `${p.title} (${p.cumulative_weight_pct}% de la note finale)` : ''; },
          },
        },
      },
      scales: {
        x: { type: 'linear', min: 0, max: 100, title: { display: true, text: '% de la note finale' }, ticks: { callback: v => v + '%' }, grid: { color: '#f1f5f9' } },
        y: { title: { display: true, text: isMoyenne ? 'Moyenne pondérée cumulée (%)' : 'Note par évaluation (%)' }, min: 0, max: 100, grid: { color: '#f1f5f9' }, ticks: { callback: v => v + '%' } },
      },
    },
  });
}

function renderAssignmentsTable(travaux) {
  const tbody = document.getElementById('assignments-table');
  if (!travaux || travaux.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Aucune évaluation</td></tr>';
    return;
  }
  tbody.innerHTML = travaux.map(t => {
    const pct = t.personal_pct;
    const cls = pctClass(pct);
    return `<tr>
      <td>${escapeHtml(t.title)}</td>
      <td>${escapeHtml(t.category || '—')}</td>
      <td>${t.weight}&nbsp;%</td>
      <td>${formatDate(t.date_assigned)}</td>
      <td class="td-pct ${cls}">
        ${pct !== null ? `${t.score_obtained} / ${t.score_max} (${parseFloat(pct).toFixed(1)}%)` : '—'}
      </td>
      <td class="td-pct ${pctClass(t.group_avg_pct)}">
        ${t.group_avg_pct !== null ? parseFloat(t.group_avg_pct).toFixed(1) + '%' : '—'}
        ${t.graded_count > 0 ? `<span class="text-muted" style="font-size:.75rem">&nbsp;(${t.graded_count})</span>` : ''}
      </td>
      <td class="td-pct ${pctClass(t.group_median_pct)}">
        ${t.group_median_pct !== null ? parseFloat(t.group_median_pct).toFixed(1) + '%' : '—'}
      </td>
    </tr>`;
  }).join('');
}

function closeDetail() {
  document.getElementById('detail-panel').classList.add('hidden');
  document.querySelectorAll('.course-card').forEach(c => c.classList.remove('selected'));
  if (gradeChart) { gradeChart.destroy(); gradeChart = null; }
  currentChartData = null;
  selectedGroupId = null;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '&quot;');
}
