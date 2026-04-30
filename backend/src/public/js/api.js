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
  nav.querySelector('.nav-email').textContent = user.email;
  nav.querySelector('.nav-logout').addEventListener('click', () => API.logout());

  if (user.is_admin) {
    const links = nav.querySelector('.nav-links');
    const a = document.createElement('a');
    a.href = '/admin';
    a.className = 'nav-link';
    a.textContent = 'Admin';
    links.appendChild(a);
  }

  const path = window.location.pathname;
  nav.querySelectorAll('.nav-link').forEach(a => {
    if (a.getAttribute('href') === path) a.classList.add('active');
  });
}
