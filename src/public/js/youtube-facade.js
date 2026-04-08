// YouTube facade: replace a placeholder thumbnail with the real iframe on click.
// Privacy- and performance-friendly: no third-party requests until the user opts in.
(function () {
  'use strict';

  function activate(facade) {
    var id = facade.getAttribute('data-youtube-id');
    if (!id) return;
    var iframe = document.createElement('iframe');
    iframe.setAttribute('src', 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0');
    iframe.setAttribute('title', facade.getAttribute('aria-label') || 'YouTube video player');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allow', 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen');
    iframe.setAttribute('allowfullscreen', '');
    iframe.className = 'yt-facade-iframe';
    facade.replaceWith(iframe);
  }

  function init() {
    var facades = document.querySelectorAll('.yt-facade');
    for (var i = 0; i < facades.length; i++) {
      facades[i].addEventListener('click', function (e) {
        e.preventDefault();
        activate(this);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
