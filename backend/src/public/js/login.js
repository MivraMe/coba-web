document.addEventListener('DOMContentLoaded', async () => {
  await API.requireAnonymous();

  const form = document.getElementById('login-form');
  const alert = document.getElementById('alert');
  const btn = document.getElementById('submit-btn');

  ['email', 'password'].forEach(id => {
    form[id].addEventListener('input', () => hideAlert(alert));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(alert);
    setLoading(btn, true, 'Connexion…');

    const res = await API.request('POST', '/auth/login', {
      email: form.email.value,
      password: form.password.value,
    });

    setLoading(btn, false);
    if (!res) return;

    const data = await res.json();
    if (!res.ok) {
      showAlert(alert, res.status === 401 ? 'Courriel ou mot de passe invalide.' : (data.error || 'Erreur de connexion'));
      return;
    }

    API.setToken(data.token);
    API.setUser(data.user);

    if (data.user.role === 'superadmin') {
      window.location.href = '/admin';
    } else if (data.user.onboarding_completed) {
      window.location.href = '/dashboard';
    } else {
      window.location.href = '/onboarding';
    }
  });
});
