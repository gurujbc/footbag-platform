(function () {
  'use strict';

  function init() {
    var selects = document.querySelectorAll('select[data-auto-submit]');
    for (var i = 0; i < selects.length; i++) {
      (function (sel) {
        sel.addEventListener('change', function () {
          if (sel.form) sel.form.submit();
        });
      })(selects[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
