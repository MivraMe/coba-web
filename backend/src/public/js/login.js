document.addEventListener('DOMContentLoaded', async () => {
  await API.requireAnonymous();

  const form = document.getElementById('login-form');
  const alert = document.getElementById('alert');
  const btn = document.getElementById('submit-btn');
  const totpSection = document.getElementById('totp-section');
  const loginFooter = document.getElementById('login-footer');

  let pendingEmail = '';
  let pendingPassword = '';

  ['email', 'password'].forEach(id => {
    form[id].addEventListener('input', () => hideAlert(alert));
  });

  function showTotpChallenge() {
    form.classList.add('hidden');
    loginFooter.classList.add('hidden');
    totpSection.classList.remove('hidden');
    hideAlert(alert);
    document.getElementById('totp-code').value = '';
    document.getElementById('totp-code').focus();
  }

  function showLoginForm() {
    totpSection.classList.add('hidden');
    form.classList.remove('hidden');
    loginFooter.classList.remove('hidden');
    hideAlert(alert);
  }

  document.getElementById('totp-back-link').addEventListener('click', (e) => {
    e.preventDefault();
    pendingEmail = '';
    pendingPassword = '';
    showLoginForm();
  });

  async function finishLogin(data) {
    API.setToken(data.token);
    API.setUser(data.user);
    if (data.user.role === 'superadmin') {
      window.location.href = '/admin';
    } else if (data.user.onboarding_completed) {
      window.location.href = '/dashboard';
    } else {
      window.location.href = '/onboarding';
    }
  }

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

    if (data.totp_required) {
      pendingEmail = form.email.value;
      pendingPassword = form.password.value;
      showTotpChallenge();
      return;
    }

    await finishLogin(data);
  });

  const totpSubmitBtn = document.getElementById('totp-submit-btn');
  document.getElementById('totp-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') totpSubmitBtn.click();
  });

  totpSubmitBtn.addEventListener('click', async () => {
    const code = document.getElementById('totp-code').value.trim();
    hideAlert(alert);
    if (!code) { showAlert(alert, 'Entrez le code TOTP.'); return; }

    setLoading(totpSubmitBtn, true, 'Vérification…');
    const res = await API.request('POST', '/auth/login', {
      email: pendingEmail,
      password: pendingPassword,
      totp_code: code,
    });
    setLoading(totpSubmitBtn, false, 'Vérifier');
    if (!res) return;

    const data = await res.json();
    if (!res.ok) {
      showAlert(alert, data.error || 'Code invalide');
      return;
    }

    await finishLogin(data);
  });

  // ── Réinitialisation de mot de passe ────────────────────────────────────────

  const loginArea = form;
  const loginFooter = document.getElementById('login-footer');
  const resetSection = document.getElementById('reset-section');

  let resetEmail = '';
  let resetChannel = '';

  function showResetSection() {
    loginArea.classList.add('hidden');
    loginFooter.classList.add('hidden');
    resetSection.classList.remove('hidden');
    hideAlert(alert);
    showResetStep('email');
    document.getElementById('reset-email').value = '';
    document.getElementById('reset-code').value = '';
    document.getElementById('reset-new-password').value = '';
  }

  function showLoginSection() {
    resetSection.classList.add('hidden');
    loginArea.classList.remove('hidden');
    loginFooter.classList.remove('hidden');
    hideAlert(alert);
  }

  function showResetStep(step) {
    ['email', 'channel', 'code', 'success'].forEach(s => {
      document.getElementById(`reset-step-${s}`).classList.add('hidden');
    });
    document.getElementById(`reset-step-${step}`).classList.remove('hidden');
  }

  document.getElementById('forgot-link').addEventListener('click', (e) => {
    e.preventDefault();
    showResetSection();
  });

  document.getElementById('back-to-login-link').addEventListener('click', (e) => {
    e.preventDefault();
    showLoginSection();
  });

  // Étape 1 : récupérer les canaux disponibles
  document.getElementById('reset-email-btn').addEventListener('click', async () => {
    const emailVal = document.getElementById('reset-email').value.trim();
    if (!emailVal) return;

    const emailBtn = document.getElementById('reset-email-btn');
    hideAlert(alert);
    setLoading(emailBtn, true, 'Vérification…');

    const res = await API.request('POST', '/auth/forgot-password', { email: emailVal });
    setLoading(emailBtn, false, 'Continuer');
    if (!res) return;

    const data = await res.json();
    if (!res.ok) {
      showAlert(alert, data.error || 'Erreur serveur');
      return;
    }

    resetEmail = emailVal;

    if (data.channels.length === 1) {
      // Un seul canal : envoyer directement
      resetChannel = data.channels[0];
      await sendResetCode();
    } else {
      // Plusieurs canaux : afficher le sélecteur
      const container = document.getElementById('reset-channel-options');
      container.innerHTML = '';

      const options = [
        { value: 'email', label: `Courriel (${data.email_masked})` },
        { value: 'sms',   label: `SMS (${data.sms_masked})` },
      ];

      options.filter(o => data.channels.includes(o.value)).forEach((o, i) => {
        const id = `chan-${o.value}`;
        const wrap = document.createElement('div');
        wrap.className = 'form-check';
        wrap.innerHTML = `
          <input type="radio" name="reset-channel" id="${id}" value="${o.value}" ${i === 0 ? 'checked' : ''}>
          <label for="${id}">${o.label}</label>
        `;
        container.appendChild(wrap);
        if (i === 0) resetChannel = o.value;
      });

      container.querySelectorAll('input[name="reset-channel"]').forEach(radio => {
        radio.addEventListener('change', () => { resetChannel = radio.value; });
      });

      showResetStep('channel');
    }
  });

  // Étape 2 : envoyer le code au canal choisi
  document.getElementById('reset-send-btn').addEventListener('click', sendResetCode);

  async function sendResetCode() {
    const sendBtn = document.getElementById('reset-send-btn');
    hideAlert(alert);
    setLoading(sendBtn, true, 'Envoi…');

    const res = await API.request('POST', '/auth/forgot-password', {
      email: resetEmail,
      channel: resetChannel,
    });
    setLoading(sendBtn, false, 'Envoyer le code');
    if (!res) return;

    const data = await res.json();
    if (!res.ok) {
      showAlert(alert, data.error || 'Erreur envoi du code');
      return;
    }

    const channelLabel = resetChannel === 'sms' ? 'SMS' : 'courriel';
    document.getElementById('reset-sent-msg').textContent =
      `Code envoyé par ${channelLabel} à ${data.masked_to}. Valide 15 minutes.`;

    showResetStep('code');
  }

  // Lien "Renvoyer le code"
  document.getElementById('reset-resend-link').addEventListener('click', async (e) => {
    e.preventDefault();
    hideAlert(alert);
    const res = await API.request('POST', '/auth/forgot-password', {
      email: resetEmail,
      channel: resetChannel,
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) {
      showAlert(alert, data.error || 'Erreur renvoi du code');
    } else {
      showAlert(alert, 'Nouveau code envoyé.', 'success');
    }
  });

  // Étape 3 : vérifier le code et réinitialiser le mot de passe
  document.getElementById('reset-confirm-btn').addEventListener('click', async () => {
    const code = document.getElementById('reset-code').value.trim();
    const newPassword = document.getElementById('reset-new-password').value;
    const confirmBtn = document.getElementById('reset-confirm-btn');

    hideAlert(alert);

    if (!code || !newPassword) {
      showAlert(alert, 'Veuillez remplir tous les champs.');
      return;
    }

    setLoading(confirmBtn, true, 'Réinitialisation…');

    const res = await API.request('POST', '/auth/reset-password', {
      email: resetEmail,
      code,
      new_password: newPassword,
    });
    setLoading(confirmBtn, false, 'Réinitialiser le mot de passe');
    if (!res) return;

    const data = await res.json();
    if (!res.ok) {
      showAlert(alert, data.error || 'Erreur lors de la réinitialisation');
      return;
    }

    showResetStep('success');
  });
});
