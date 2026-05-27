(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  var SITE_ID = script && script.getAttribute('data-site');
  var BASE_URL = (script && script.src) ? script.src.replace('/tracker.js', '') : '';

  if (!SITE_ID) return;

  var siteConfig = null;
  var CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function genTrackingId() {
    var result = 'WA-';
    var buf = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 6; i++) {
      result += CHARS[buf[i] % CHARS.length];
    }
    return result;
  }

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

  // Prefetch site config so it's ready before the user clicks
  function loadConfig() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', BASE_URL + '/t/' + SITE_ID + '/config', true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4 || xhr.status !== 200) return;
        try { siteConfig = JSON.parse(xhr.responseText); } catch (e) {}
      };
      xhr.send();
    } catch (e) {}
  }

  function sendTracking(trackingId) {
    var payload = JSON.stringify({
      tracking_id: trackingId,
      fbclid: getFbclid(),
      page_url: window.location.href,
      user_agent: navigator.userAgent
    });

    // sendBeacon is fire-and-forget and survives page navigation
    if (navigator.sendBeacon) {
      try {
        navigator.sendBeacon(
          BASE_URL + '/t/' + SITE_ID,
          new Blob([payload], { type: 'application/json' })
        );
        return;
      } catch (e) {}
    }

    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', BASE_URL + '/t/' + SITE_ID, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(payload);
    } catch (e) {}
  }

  function handleClick(event, anchor) {
    var href = anchor.getAttribute('href') || '';
    if (!isWhatsAppLink(href)) return;

    event.preventDefault();

    var trackingId = genTrackingId();

    // Build the final URL synchronously — must happen before any async call
    // so window.open() is called within the user gesture context (iOS Safari)
    var finalUrl;
    if (siteConfig && siteConfig.phone) {
      var msg = (siteConfig.message || '') + ' [' + trackingId + ']';
      finalUrl = 'https://wa.me/' + siteConfig.phone + '?text=' + encodeURIComponent(msg);
    } else {
      finalUrl = href;
    }

    // Open WhatsApp immediately — still in the synchronous click handler
    window.open(finalUrl, '_blank', 'noopener');

    // Register the event in the background (fire and forget)
    sendTracking(trackingId);
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

  loadConfig();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanLinks);
  } else {
    scanLinks();
  }

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
