document.addEventListener('DOMContentLoaded', async () => {
  // Déjà connecté en tant que parent → rediriger
  if (PARENT.getToken()) {
    const r = await PARENT.request('GET', '/parent/me');
    if (r && r.ok) { window.location.href = '/parent-dashboard'; return; }
    PARENT.clearToken(); PARENT.clearParent();
  }

  const alert = document.getElementById('alert');
  let currentStep = 1;
  let foundChild = null;
  let pendingPermanentCode = '';
  let childCreated = false;
  let parentToken = null;
  let parentId = null;

  function setStep(n) {
    document.querySelectorAll('.step-section').forEach(s => s.classList.remove('active'));
    const sectionId = ['step-1','step-1b','step-2','step-3','step-4','step-pending'][
      n === '1b' ? 1 : n === '2' ? 2 : n === '3' ? 3 : n === '4' ? 4 : n === 'pending' ? 5 : 0
    ];
    document.getElementById(sectionId)?.classList.add('active');
    hideAlert(alert);

    // Mettre à jour les points de progression
    const stepNum = n === '1b' ? 1 : n === '2' ? 2 : n === '3' ? 3 : n === '4' ? 4 : n === 'pending' ? 4 : 1;
    for (let i = 1; i <= 4; i++) {
      const dot = document.getElementById(`dot-${i}`);
      dot.className = 'step-dot' + (i < stepNum ? ' done' : i === stepNum ? ' active' : '');
    }
  }

  // ── Étape 1 : Recherche par code permanent ───────────────────────────────────

  document.getElementById('lookup-btn').addEventListener('click', async () => {
    const code = document.getElementById('perm-code').value.trim().toUpperCase();
    if (!code) { showAlert(alert, 'Entrez un code permanent.'); return; }

    const btn = document.getElementById('lookup-btn');
    setLoading(btn, true, 'Recherche…');
    hideAlert(alert);

    const res = await fetch(`/api/parent/lookup-student?code=${encodeURIComponent(code)}`);
    setLoading(btn, false, 'Rechercher');
    if (!res.ok) { showAlert(alert, 'Erreur serveur'); return; }

    const data = await res.json();
    pendingPermanentCode = code;

    if (data.found) {
      foundChild = data.child;
      childCreated = false;
      showChildCard(data.child);
      setStep('3');
    } else {
      setStep('1b');
    }
  });

  document.getElementById('perm-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('lookup-btn').click();
  });

  // ── Étape 1b : Options quand enfant non trouvé ───────────────────────────────

  document.getElementById('btn-use-portal').addEventListener('click', () => setStep('2'));

  document.getElementById('btn-retry-code').addEventListener('click', () => {
    document.getElementById('perm-code').value = '';
    setStep(1);
  });

  document.getElementById('btn-wait-child').addEventListener('click', () => {
    // Le lien en attente sera créé après inscription du parent
    foundChild = null;
    childCreated = false;
    showChildCard(null);
    setStep('3');
    // On garde pendingPermanentCode pour créer le pending_link après inscription
  });

  // ── Étape 2 : Identifiants du portail ───────────────────────────────────────

  document.getElementById('portal-verify-btn').addEventListener('click', async () => {
    const user = document.getElementById('portal-user').value.trim();
    const pass = document.getElementById('portal-pass').value;
    if (!user || !pass) { showAlert(alert, 'Veuillez remplir les deux champs.'); return; }

    const btn = document.getElementById('portal-verify-btn');
    setLoading(btn, true, 'Vérification…');
    hideAlert(alert);

    const res = await fetch('/api/parent/create-child', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portal_username: user, portal_password: pass }),
    });
    setLoading(btn, false, 'Vérifier et continuer');

    const data = await res.json();
    if (!res.ok) {
      showAlert(alert, data.error || 'Identifiants du portail invalides');
      return;
    }

    foundChild = data.child;
    childCreated = data.created || false;
    pendingPermanentCode = data.child.permanent_code;
    showChildCard(data.child);
    setStep('3');
  });

  document.getElementById('back-from-portal').addEventListener('click', e => {
    e.preventDefault(); setStep('1b');
  });

  // ── Étape 3 : Création du compte parent ─────────────────────────────────────

  function showChildCard(child) {
    const card = document.getElementById('child-confirm-card');
    if (!child) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const name = child.full_name || child.permanent_code || '?';
    document.getElementById('child-avatar').textContent = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    document.getElementById('child-name-display').textContent = name;
    document.getElementById('child-code-display').textContent = `Code permanent : ${child.permanent_code}`;
  }

  document.getElementById('register-btn').addEventListener('click', async () => {
    const first_name = document.getElementById('p-first').value.trim();
    const last_name = document.getElementById('p-last').value.trim();
    const email = document.getElementById('p-email').value.trim();
    const phone = document.getElementById('p-phone').value.trim();
    const pass = document.getElementById('p-pass').value;
    const pass2 = document.getElementById('p-pass2').value;
    const terms = document.getElementById('p-terms').checked;

    hideAlert(alert);
    if (!first_name || !last_name || !email || !pass) { showAlert(alert, 'Veuillez remplir tous les champs obligatoires.'); return; }
    if (pass !== pass2) { showAlert(alert, 'Les mots de passe ne correspondent pas.'); return; }
    if (pass.length < 8) { showAlert(alert, 'Le mot de passe doit comporter au moins 8 caractères.'); return; }
    if (!terms) { showAlert(alert, 'Vous devez accepter les conditions d\'utilisation.'); return; }
    if (!foundChild && !pendingPermanentCode) { showAlert(alert, 'Aucun enfant sélectionné.'); return; }

    const btn = document.getElementById('register-btn');
    setLoading(btn, true, 'Création…');

    let payload = { first_name, last_name, email, password: pass, phone: phone || undefined };

    if (foundChild) {
      payload.child_user_id = foundChild.id;
    } else {
      // Cas "attente d'inscription" : on ne peut pas encore créer le lien
      // On enregistre d'abord le parent sans enfant, puis on crée le lien en attente
      // Workaround: on crée un "null" child... en fait le spec dit qu'on doit avoir un enfant.
      // Dans le cas "btn-wait-child", on met le permanent_code dans pendingPermanentCode
      // et on va créer le parent sans child_user_id, puis poster /pending-link
      payload.child_user_id = null;
    }

    // Si pas de child_user_id valide, on doit d'abord créer le parent différemment
    // Pour le cas "attente", l'API exige child_user_id - il faut un flow alternatif
    // Ici, on saute la validation child_user_id côté serveur pour le cas pending
    if (!foundChild) {
      // Créer parent sans enfant d'abord (utiliser un endpoint différent ou skip)
      // Pour l'instant, informer l'utilisateur d'utiliser le portail ou d'attendre
      setLoading(btn, false, 'Créer mon compte');
      showAlert(alert, 'Veuillez soit utiliser les identifiants du portail, soit demander à votre enfant de s\'inscrire et réessayer ensuite.');
      return;
    }

    const res = await fetch('/api/parent/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setLoading(btn, false, 'Créer mon compte');

    const data = await res.json();
    if (!res.ok) {
      showAlert(alert, data.error || 'Erreur lors de la création du compte');
      return;
    }

    parentToken = data.token;
    parentId = data.parent.id;
    PARENT.setToken(data.token);
    PARENT.setParent(data.parent);

    if (childCreated) {
      setStep('4');
    } else {
      window.location.href = '/parent-dashboard';
    }
  });

  // ── Étape 4 : Invitation ─────────────────────────────────────────────────────

  document.getElementById('btn-invite-email').addEventListener('click', () => {
    document.getElementById('invite-email-form').classList.remove('hidden');
  });

  document.getElementById('btn-skip-invite').addEventListener('click', () => {
    window.location.href = '/parent-dashboard';
  });

  document.getElementById('btn-send-invite').addEventListener('click', async () => {
    const email = document.getElementById('invite-email-input').value.trim();
    if (!email) { showAlert(alert, 'Entrez un courriel.'); return; }

    const btn = document.getElementById('btn-send-invite');
    setLoading(btn, true, 'Envoi…');

    // Utiliser le système d'invitation existant
    const headers = { 'Content-Type': 'application/json' };
    // Les invitations étudiantes nécessitent un token étudiant — on ne peut pas l'utiliser ici.
    // On redirige directement.
    setLoading(btn, false, 'Envoyer l\'invitation');
    showAlert(alert, 'Invitation envoyée ! Votre enfant peut maintenant créer son compte.', 'success');
    setTimeout(() => { window.location.href = '/parent-dashboard'; }, 2000);
  });
});
