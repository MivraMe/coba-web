(() => {
  const KEY = 'coba_cookies_accepted';
  if (localStorage.getItem(KEY)) return;

  const banner = document.createElement('div');
  banner.id = 'cookie-banner';
  banner.innerHTML = `
    <p>Ce site utilise des cookies strictement nécessaires à son fonctionnement (session de connexion). Aucun cookie de tracking ou publicitaire n'est utilisé.</p>
    <button id="cookie-accept-btn">Accepter</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('cookie-accept-btn').addEventListener('click', () => {
    localStorage.setItem(KEY, '1');
    banner.remove();
  });
})();
