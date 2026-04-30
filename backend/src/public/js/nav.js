(function() {
  var burger = document.getElementById('burgerBtn');
  var navLinks = document.getElementById('navLinks');
  if (burger && navLinks) {
    burger.addEventListener('click', function() {
      navLinks.classList.toggle('open');
    });
    document.addEventListener('click', function(e) {
      if (!e.target.closest('#main-nav')) navLinks.classList.remove('open');
    });
  }
})();
