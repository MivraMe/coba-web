document.addEventListener('DOMContentLoaded', async () => {
  await API.requireAnonymous();

  const params = new URLSearchParams(window.location.search);
  const inviteEmail = params.get('email');
  const inviteToken = params.get('token');

  if (inviteEmail) {
    document.getElementById('email').value = inviteEmail;
    document.getElementById('email').readOnly = true;
    document.getElementById('invite-banner').style.display = '';
  }
  if (inviteToken) {
    document.getElementById('invitation-token').value = inviteToken;
  }

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

    const body = {
      email: form.email.value,
      password: form.password.value,
    };
    if (form.invitation_token.value) body.invitation_token = form.invitation_token.value;

    setLoading(btn, true, 'Création…');
    const res = await API.request('POST', '/auth/register', body);
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
