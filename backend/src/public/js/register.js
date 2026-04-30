document.addEventListener('DOMContentLoaded', async () => {
  await API.requireAnonymous();

  const form = document.getElementById('register-form');
  const alert = document.getElementById('alert');
  const btn = document.getElementById('submit-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(alert);

    if (form.password.value !== form.confirm.value) {
      showAlert(alert, 'Les mots de passe ne correspondent pas.');
      return;
    }

    setLoading(btn, true, 'Création…');
    const res = await API.request('POST', '/auth/register', {
      email: form.email.value,
      password: form.password.value,
    });
    setLoading(btn, false);
    if (!res) return;

    const data = await res.json();
    if (!res.ok) {
      showAlert(alert, data.error || 'Erreur lors de la création du compte');
      return;
    }

    API.setToken(data.token);
    API.setUser(data.user);
    window.location.href = '/onboarding';
  });
});
