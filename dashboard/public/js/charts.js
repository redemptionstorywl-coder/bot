/* Graphiques rendus côté serveur (partials/chart-*.ejs) : infobulle au survol et au clavier.
 * Courbes : réticule vertical qui s'accroche au jour le plus proche ; colonnes : la colonne survolée est mise en avant.
 * L'infobulle n'est jamais le seul accès aux valeurs (tableau « Voir les données »). Texte inséré en textContent. */
(function () {
  'use strict';
  var VIEW_W = 600;

  function setup(fig) {
    var plot = fig.querySelector('[data-chart-plot]');
    var tip = fig.querySelector('[data-chart-tip]');
    var dataEl = fig.querySelector('[data-chart-data]');
    if (!plot || !tip || !dataEl) return;
    var data;
    try { data = JSON.parse(dataEl.textContent || '{}'); } catch (e) { return; }
    var n = parseInt(plot.getAttribute('data-n'), 10) || (data.labels ? data.labels.length : 0);
    if (!n) return;
    var mode = plot.getAttribute('data-mode') || 'line';
    var cross = plot.querySelector('[data-chart-cross]');
    var bars = Array.prototype.slice.call(plot.querySelectorAll('.chart-bar[data-i]'));
    var current = -1;

    function render(i, clientY) {
      if (i < 0 || i >= n) return hide();
      current = i;
      plot.classList.add('is-hovering');
      var x = ((i + 0.5) / n) * VIEW_W;
      if (cross) { cross.setAttribute('x1', String(x)); cross.setAttribute('x2', String(x)); }
      bars.forEach(function (b) { b.classList.toggle('is-hot', b.getAttribute('data-i') === String(i)); });
      tip.textContent = '';
      var title = document.createElement('div');
      title.className = 'chart-tip-title';
      title.textContent = (data.labels && data.labels[i]) || '';
      tip.appendChild(title);
      (data.series || []).forEach(function (s) {
        var row = document.createElement('div');
        row.className = 'chart-tip-row';
        var key = document.createElement('span');
        key.className = 'chart-key k' + s.slot + (mode === 'line' ? ' is-line' : '');
        var val = document.createElement('strong');
        var v = s.values && typeof s.values[i] === 'number' ? s.values[i] : 0;
        var shown = v.toLocaleString('fr-FR');
        if (data.currency) { try { shown = v.toLocaleString('fr-FR', { style: 'currency', currency: data.currency }); } catch (e) { shown = v.toLocaleString('fr-FR') + ' ' + data.currency; } }
        val.textContent = (s.sign && v ? s.sign : '') + shown;
        var label = document.createElement('span');
        label.textContent = s.label;
        row.appendChild(key); row.appendChild(val); row.appendChild(label);
        tip.appendChild(row);
      });
      tip.hidden = false;
      var rect = plot.getBoundingClientRect();
      var px = ((i + 0.5) / n) * rect.width;
      var w = tip.offsetWidth;
      var left = Math.max(w / 2, Math.min(rect.width - w / 2, px));
      var top = typeof clientY === 'number' ? Math.max(tip.offsetHeight + 12, clientY - rect.top) : rect.height * 0.35 + tip.offsetHeight;
      tip.style.left = left + 'px';
      tip.style.top = Math.min(top, rect.height) + 'px';
    }
    function hide() {
      current = -1;
      plot.classList.remove('is-hovering');
      bars.forEach(function (b) { b.classList.remove('is-hot'); });
      tip.hidden = true;
    }
    function indexAt(clientX) {
      var rect = plot.getBoundingClientRect();
      var f = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(n - 1, Math.floor(f * n)));
    }
    plot.addEventListener('pointermove', function (e) { render(indexAt(e.clientX), e.clientY); });
    plot.addEventListener('pointerleave', function () { if (document.activeElement !== plot) hide(); });
    plot.addEventListener('focus', function () { render(current >= 0 ? current : n - 1); });
    plot.addEventListener('blur', hide);
    plot.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        var i = current < 0 ? n - 1 : current + (e.key === 'ArrowRight' ? 1 : -1);
        render(Math.max(0, Math.min(n - 1, i)));
      } else if (e.key === 'Home') { e.preventDefault(); render(0); }
      else if (e.key === 'End') { e.preventDefault(); render(n - 1); }
      else if (e.key === 'Escape') { hide(); }
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-chart]'), setup);
})();
