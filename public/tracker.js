(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var SITE_ID = script && script.getAttribute('data-site');

  if (!SITE_ID) return;

  var pageParams = new URLSearchParams(window.location.search);
  if (!pageParams.toString()) return;

  var selector = 'a[href*="/r/' + SITE_ID + '"]';

  function updateLinks() {
    var anchors = document.querySelectorAll(selector);
    for (var i = 0; i < anchors.length; i++) {
      try {
        var url = new URL(anchors[i].href);
        pageParams.forEach(function (v, k) {
          url.searchParams.set(k, v);
        });
        anchors[i].href = url.toString();
      } catch (e) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateLinks);
  } else {
    updateLinks();
  }

  if (window.MutationObserver) {
    var observer = new MutationObserver(updateLinks);
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
})();
