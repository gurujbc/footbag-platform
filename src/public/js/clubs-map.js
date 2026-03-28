(function () {
  var container = document.getElementById('clubs-map');
  var data = window.__CLUBS_MAP_DATA__;
  if (!container || !data || !data.length) return;

  var tooltip = document.createElement('div');
  tooltip.className = 'clubs-map-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  fetch('/img/world-map.svg')
    .then(function (r) { return r.text(); })
    .then(function (svgText) {
      container.innerHTML = svgText;
      var svg = container.querySelector('svg');
      if (!svg) return;
      svg.setAttribute('class', 'clubs-map-svg');

      var byCode = {};
      data.forEach(function (d) { if (d.code) byCode[d.code.toUpperCase()] = d; });

      svg.querySelectorAll('path[id]').forEach(function (path) {
        var id = path.getAttribute('id').toUpperCase();
        var entry = byCode[id];
        if (!entry) return;

        path.classList.add('has-clubs');

        path.addEventListener('mouseenter', function (e) {
          tooltip.textContent = entry.name + ' — ' + entry.total + (entry.total === 1 ? ' club' : ' clubs');
          tooltip.style.display = 'block';
          positionTooltip(e);
        });
        path.addEventListener('mousemove', positionTooltip);
        path.addEventListener('mouseleave', function () {
          tooltip.style.display = 'none';
        });
        path.addEventListener('click', function () {
          window.location.href = '/clubs/' + entry.slug;
        });
      });

      container.removeAttribute('hidden');
      container.removeAttribute('aria-hidden');
    })
    .catch(function () { /* silently degrade — list below still works */ });

  function positionTooltip(e) {
    var x = e.clientX + 14;
    var y = e.clientY - 28;
    if (x + 200 > window.innerWidth) x = e.clientX - 214;
    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
  }
})();
