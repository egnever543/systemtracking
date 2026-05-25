(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var SITE_ID = script && script.getAttribute('data-site');
  var BASE_URL = (script && script.src) ? script.src.replace('/tracker.js', '') : '';

  if (!SITE_ID) return;

  function getFbclid() {
    try {
      var params = new URLSearchParams(window.location.search);
      return params.get('fbclid') || '';
    } catch (e) {
      return '';
    }
  }

  function isWhatsAppLink(href) {
    return href && (
      href.indexOf('https://wa.me/') === 0 ||
      href.indexOf('https://api.whatsapp.com/') === 0 ||
      href.indexOf('http://wa.me/') === 0 ||
      href.indexOf('http://api.whatsapp.com/') === 0
    );
  }

  function handleClick(event, anchor) {
    var href = anchor.getAttribute('href') || '';
    if (!isWhatsAppLink(href)) return;

    event.preventDefault();

    var payload = JSON.stringify({
      fbclid: getFbclid(),
      page_url: window.location.href,
      user_agent: navigator.userAgent
    });

    var xhr = new XMLHttpRequest();
    xhr.open('POST', BASE_URL + '/t/' + SITE_ID, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var finalUrl;
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          var phone = data.phone || '';
          var msg = (data.message || '') + ' [' + (data.tracking_id || '') + ']';
          finalUrl = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg);
        } catch (e) {
          finalUrl = href;
        }
      } else {
        finalUrl = href;
      }
      window.open(finalUrl, '_blank', 'noopener');
    };
    xhr.onerror = function () {
      window.open(href, '_blank', 'noopener');
    };
    xhr.send(payload);
  }

  function attachToLink(anchor) {
    if (anchor._wacapi) return;
    anchor._wacapi = true;
    anchor.addEventListener('click', function (e) {
      handleClick(e, anchor);
    });
  }

  function scanLinks() {
    var anchors = document.getElementsByTagName('a');
    for (var i = 0; i < anchors.length; i++) {
      if (isWhatsAppLink(anchors[i].getAttribute('href'))) {
        attachToLink(anchors[i]);
      }
    }
  }

  // Scan inicial
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanLinks);
  } else {
    scanLinks();
  }

  // MutationObserver para SPAs e conteúdo dinâmico
  if (window.MutationObserver) {
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var node = nodes[j];
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'A' && isWhatsAppLink(node.getAttribute('href'))) {
            attachToLink(node);
          }
          var children = node.getElementsByTagName('a');
          for (var k = 0; k < children.length; k++) {
            if (isWhatsAppLink(children[k].getAttribute('href'))) {
              attachToLink(children[k]);
            }
          }
        }
      }
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})();
