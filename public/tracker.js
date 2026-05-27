(function () {
  var myScript = document.querySelector('script[data-site]');
  if (!myScript) return;

  var SITE_ID = myScript.getAttribute('data-site');
  if (!SITE_ID) return;

  var search = window.location.search;
  if (!search || search === '?') return;

  var params = search.charAt(0) === '?' ? search.slice(1) : search;
  if (!params) return;

  function updateLinks() {
    var links = document.querySelectorAll('a[href*="/r/' + SITE_ID + '"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].href;
      links[i].href = href + (href.indexOf('?') === -1 ? '?' : '&') + params;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateLinks);
  } else {
    updateLinks();
  }
})();
