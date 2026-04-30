// Shared API client — used by all pages

const API = (() => {
  function getToken() { return localStorage.getItem('coba_token'); }
  function setToken(t) { localStorage.setItem('coba_token', t); }
  function clearToken() { localStorage.removeItem('coba_token'); }
  function getUser() {
    try { return JSON.parse(localStorage.getItem('coba_user') || 'null'); } catch { return null; }
  }
  function setUser(u) { localStorage.setItem('coba_user', JSON.stringify(u)); }
  function clearUser() { localStorage.removeItem('coba_user'); }

  function logout() {
    clearToken(); clearUser();
    window.location.href = '/';
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`/api${path}`, opts);
    // Only redirect on 401 if we had an active session (token present).
    // Without a token we're on the login page — let the caller show the error.
    if (res.status === 401 && getToken()) { logout(); return null; }
    return res;
  }

  async function json(method, path, body) {
    const res = await request(method, path, body);
    if (!res) return null;
    return res.json();
  }

  async function requireAuth() {
    const token = getToken();
    if (!token) { window.location.href = '/'; return null; }
    try {
      const res = await request('GET', '/auth/me');
      if (!res || !res.ok) { logout(); return null; }
      const user = await res.json();
      setUser(user);
      return user;
    } catch {
      logout(); return null;
    }
  }

  async function requireOnboarded() {
    const user = await requireAuth();
    if (!user) return null;
    if (!user.onboarding_completed) {
      window.location.href = '/onboarding';
      return null;
    }
    return user;
  }

  async function requireAnonymous() {
    const token = getToken();
    if (token) {
      try {
        const res = await request('GET', '/auth/me');
        if (res && res.ok) {
          const user = await res.json();
          if (user.onboarding_completed) window.location.href = '/dashboard';
          else window.location.href = '/onboarding';
          return;
        }
      } catch {}
    }
  }

  return {
    get: (path) => json('GET', path),
    post: (path, body) => json('POST', path, body),
    put: (path, body) => json('PUT', path, body),
    delete: (path, body) => json('DELETE', path, body),
    request,
    getToken, setToken, clearToken,
    getUser, setUser, clearUser,
    logout,
    requireAuth, requireOnboarded, requireAnonymous,
  };
})();

// Shared UI helpers
function showAlert(el, msg, type = 'error') {
  el.textContent = msg;
  el.className = `alert alert-${type}`;
  el.classList.remove('hidden');
}
function hideAlert(el) { el.classList.add('hidden'); }

function setLoading(btn, loading, label) {
  if (loading) {
    btn.disabled = true;
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span>${label || ''}`;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.origText || label || '';
  }
}

function formatPct(val) {
  if (val === null || val === undefined) return '—';
  return `${parseFloat(val).toFixed(1)} %`;
}

function pctClass(val) {
  if (val === null) return '';
  const n = parseFloat(val);
  if (n >= 75) return 'pct-good';
  if (n >= 60) return 'pct-ok';
  return 'pct-low';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function setupNav(user) {
  const nav = document.getElementById('main-nav');
  if (!nav || !user) return;

  const emailEl = nav.querySelector('.nav-email');
  if (emailEl) emailEl.textContent = user.email;

  const emailMobileEl = document.querySelector('.nav-email-mobile');
  if (emailMobileEl) emailMobileEl.textContent = user.email;

  nav.querySelectorAll('.nav-logout').forEach(el => el.addEventListener('click', () => API.logout()));

  if (user.is_admin) {
    const menu = document.getElementById('navMenu');
    const a = document.createElement('a');
    a.href = '/admin'; a.className = 'nav-link';
    a.innerHTML = '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg> Admin';
    const emailSpan = menu.querySelector('.nav-email');
    menu.insertBefore(a, emailSpan);
  }

  const path = window.location.pathname;
  nav.querySelectorAll('.nav-link').forEach(a => {
    a.classList.remove('active');
    if (a.getAttribute('href') === path) a.classList.add('active');
  });
}
