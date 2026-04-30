(function () {
  var KEY = 'coba_theme';

  var MOON_SVG = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"/></svg>';
  var SUN_SVG  = '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"/></svg>';

  function getTheme() {
    return localStorage.getItem(KEY) || 'light';
  }

  function applyTheme(theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.querySelectorAll('[data-theme-icon]').forEach(function (el) {
      el.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
    });
    var checkbox = document.getElementById('theme-toggle-checkbox');
    if (checkbox) checkbox.checked = theme === 'dark';
  }

  function toggle() {
    var next = getTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    applyTheme(next);
  }

  // Apply immediately — script is at end of <body>, DOM is already parsed.
  applyTheme(getTheme());

  document.addEventListener('DOMContentLoaded', function () {
    // Re-apply in case an async page script rebuilt the nav after this point.
    applyTheme(getTheme());
    document.querySelectorAll('.theme-btn').forEach(function (btn) {
      btn.addEventListener('click', toggle);
    });
    var checkbox = document.getElementById('theme-toggle-checkbox');
    if (checkbox) {
      checkbox.addEventListener('change', function () {
        var next = this.checked ? 'dark' : 'light';
        localStorage.setItem(KEY, next);
        applyTheme(next);
      });
    }
  });

  window.Theme = { toggle: toggle, getTheme: getTheme, applyTheme: applyTheme };
})();
