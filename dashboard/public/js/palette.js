/* Palette de commandes : Ctrl+K / ⌘K (ou bouton [data-palette-open]) pour aller à n'importe quelle page, réglage ou serveur.
 * Données : <script id="palette-data" type="application/json"> (partial palette.ejs). Rendu en textContent uniquement. */
(function () {
  'use strict';
  var root = document.getElementById('palette');
  var dataEl = document.getElementById('palette-data');
  if (!root || !dataEl) return;
  var input = document.getElementById('palette-input');
  var list = document.getElementById('palette-list');
  var data = {};
  try { data = JSON.parse(dataEl.textContent || '{}'); } catch (e) { data = {}; }
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  Array.prototype.forEach.call(document.querySelectorAll('[data-palette-shortcut]'), function (k) { k.textContent = isMac ? '⌘ K' : 'Ctrl K'; });

  var ACTIONS = [
    { label: 'Thème sombre', hint: 'Affichage', icon: 'moon', action: 'theme:dark', keywords: 'dark nuit noir' },
    { label: 'Thème clair', hint: 'Affichage', icon: 'sun', action: 'theme:light', keywords: 'light jour blanc' },
    { label: 'Thème automatique (système)', hint: 'Affichage', icon: 'monitor', action: 'theme:system', keywords: 'auto système' },
    { label: 'Se déconnecter', hint: 'Compte', icon: 'log-out', action: 'logout', keywords: 'quitter déconnexion' },
  ];
  var GROUPS = [
    { key: 'entries', title: 'Pages et réglages' },
    { key: 'servers', title: 'Changer de serveur' },
    { key: 'general', title: 'Compte' },
    { key: 'actions', title: 'Actions' },
  ];
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  var ICONS = data.icons || {};
  /** Icône du jeu interne (SVG statique fourni par le serveur, jamais de donnée utilisateur). */
  function iconEl(name) {
    var span = document.createElement('span');
    span.className = 'palette-icon';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = ICONS[name] || ICONS['arrow-right'] || '';
    return span.firstElementChild || span;
  }

  var all = [];
  GROUPS.forEach(function (g) {
    var items = g.key === 'actions' ? ACTIONS : (data[g.key] || []);
    items.forEach(function (it) { all.push({ group: g.key, label: it.label, hint: it.hint || '', icon: it.icon || 'arrow', href: it.href || null, action: it.action || null, hay: norm(it.label + ' ' + (it.hint || '') + ' ' + (it.keywords || '')), labelN: norm(it.label) }); });
  });

  var results = [];
  var active = 0;
  var lastFocus = null;

  function score(item, words, q) {
    if (!q) return 1;
    for (var i = 0; i < words.length; i++) if (item.hay.indexOf(words[i]) === -1) return 0;
    if (item.labelN.indexOf(q) === 0) return 4;
    if (item.labelN.indexOf(q) !== -1) return 3;
    if (words.every(function (w) { return item.labelN.indexOf(w) !== -1; })) return 2;
    return 1;
  }

  function appendHighlighted(el, text, q) {
    var n = norm(text);
    var i = q ? n.indexOf(q) : -1;
    if (i === -1) { el.textContent = text; return; }
    el.appendChild(document.createTextNode(text.slice(0, i)));
    var m = document.createElement('mark'); m.textContent = text.slice(i, i + q.length); el.appendChild(m);
    el.appendChild(document.createTextNode(text.slice(i + q.length)));
  }

  function render() {
    var q = norm(input.value.trim());
    var words = q.split(/\s+/).filter(Boolean);
    results = all.map(function (it) { return { it: it, s: score(it, words, q) }; }).filter(function (r) { return r.s > 0; });
    if (q) results.sort(function (a, b) { return b.s - a.s; });
    results = results.map(function (r) { return r.it; }).slice(0, q ? 40 : 60);
    list.textContent = '';
    if (!results.length) {
      var empty = document.createElement('div'); empty.className = 'palette-empty'; empty.textContent = 'Aucun résultat pour « ' + input.value.trim() + ' ».';
      list.appendChild(empty); return;
    }
    if (active >= results.length) active = 0;
    var lastGroup = null;
    results.forEach(function (it, i) {
      if (!q && it.group !== lastGroup) {
        var title = GROUPS.filter(function (g) { return g.key === it.group; })[0];
        var h = document.createElement('div'); h.className = 'palette-group'; h.textContent = title ? title.title : ''; list.appendChild(h);
        lastGroup = it.group;
      }
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'palette-item' + (i === active ? ' is-active' : '');
      b.id = 'palette-opt-' + i; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', i === active ? 'true' : 'false'); b.tabIndex = -1;
      b.appendChild(iconEl(it.icon));
      var l = document.createElement('span'); l.className = 'palette-item-label'; appendHighlighted(l, it.label, q); b.appendChild(l);
      if (it.hint) { var hnt = document.createElement('span'); hnt.className = 'palette-item-hint'; hnt.textContent = it.hint; b.appendChild(hnt); }
      b.addEventListener('mousemove', function () { if (active !== i) { active = i; mark(); } });
      b.addEventListener('click', function () { run(it); });
      list.appendChild(b);
    });
    input.setAttribute('aria-activedescendant', 'palette-opt-' + active);
  }
  function mark() {
    Array.prototype.forEach.call(list.querySelectorAll('.palette-item'), function (el, i) {
      el.classList.toggle('is-active', i === active);
      el.setAttribute('aria-selected', i === active ? 'true' : 'false');
      if (i === active) el.scrollIntoView({ block: 'nearest' });
    });
    input.setAttribute('aria-activedescendant', 'palette-opt-' + active);
  }
  function run(it) {
    if (!it) return;
    if (it.action && it.action.indexOf('theme:') === 0) { if (window.UI && window.UI.setTheme) window.UI.setTheme(it.action.slice(6)); close(); return; }
    if (it.action === 'logout') { var f = document.querySelector('form[data-logout-form]'); close(); if (f) { if (f.requestSubmit) f.requestSubmit(); else f.submit(); } return; }
    if (it.href) { close(); window.location.href = it.href; }
  }
  function open() {
    if (!root.hidden) return;
    lastFocus = document.activeElement;
    root.hidden = false;
    document.body.classList.add('palette-open');
    input.value = '';
    active = 0;
    render();
    input.focus();
  }
  function close() {
    if (root.hidden) return;
    root.hidden = true;
    document.body.classList.remove('palette-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  input.addEventListener('input', function () { active = 0; render(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) { active = (active + 1) % results.length; mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (results.length) { active = (active - 1 + results.length) % results.length; mark(); } }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); }
  });
  Array.prototype.forEach.call(root.querySelectorAll('[data-palette-close]'), function (el) { el.addEventListener('click', close); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-palette-open]');
    if (t) { e.preventDefault(); if (document.body.classList.contains('sidebar-open')) { var bd = document.querySelector('[data-sidebar-close]'); if (bd) bd.click(); } open(); }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (root.hidden) open(); else close(); }
  });
})();
