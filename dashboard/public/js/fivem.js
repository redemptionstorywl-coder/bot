/* FiveM › Synchronisation : aperçu live du format de surnom (même règles que src/services/fivem/sync.ts formatNickname). */
(function () {
  'use strict';
  var input = document.querySelector('[data-nickname-format]');
  var host = document.querySelector('[data-nickname-preview]');
  var note = document.querySelector('[data-nickname-note]');
  if (!input || !host) return;
  var MAX = 32;
  var SAMPLES = [
    { name: 'Jean Dupont', id: 12, level: 7, color: '#5865f2' },
    { name: '^1Rouge^7Joueur', id: 3, level: 42, color: '#ed4245' },
    { name: 'Alexandre-Maximilien de la Tour', id: 128, level: 15, color: '#3ba55c' },
  ];
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function chars(s) { return Array.from(s); }
  function sanitize(name) {
    var s = String(name || '').replace(/\^\d/g, '').replace(/~[a-zA-Z_]{1,2}~/g, '').replace(/\s+/g, ' ').trim().replace(/[`*_|]/g, '').trim();
    return s || null;
  }
  function format(fmt, v) {
    var name = sanitize(v.name);
    if (!name) return null;
    var f = (fmt && fmt.trim()) || '{name}';
    function render(n) { return f.replace(/\{name\}/g, n).replace(/\{id\}/g, String(v.id)).replace(/\{level\}/g, String(v.level)).replace(/\s+/g, ' ').trim(); }
    var out = render(name);
    if (chars(out).length > MAX && f.indexOf('{name}') !== -1) {
      var overflow = chars(out).length - MAX;
      out = render(chars(name).slice(0, Math.max(1, chars(name).length - overflow)).join('').replace(/\s+$/, ''));
    }
    out = chars(out).slice(0, MAX).join('').replace(/\s+$/, '');
    return out || null;
  }
  function render() {
    var fmt = input.value;
    var valid = /\{name\}|\{id\}|\{level\}/.test(fmt);
    host.innerHTML = SAMPLES.map(function (s) {
      var nick = valid ? format(fmt, s) : null;
      var initial = (sanitize(s.name) || '?').charAt(0).toUpperCase();
      return '<div class="dmember"><span class="dmember-avatar" data-color="' + s.color + '" data-color-bg>' + esc(initial) + '</span><span class="dmember-text">' +
        '<span class="dmember-name' + (nick ? '' : ' is-unchanged') + '">' + esc(nick || 'surnom inchangé') + '</span>' +
        '<span class="dmember-sub">En jeu : ' + esc(s.name) + ' · ID ' + s.id + ' · niv. ' + s.level + '</span></span></div>';
    }).join('');
    if (window.UI) window.UI.paint(host);
    if (note) note.textContent = valid ? 'Exemples rendus avec ce format (codes couleur FiveM retirés, 32 caractères max).' : 'Le format doit contenir {name}, {id} ou {level}.';
    input.setAttribute('aria-invalid', valid ? 'false' : 'true');
  }
  input.addEventListener('input', render);
  var chips = document.querySelector('[data-insert-target="#f-format"]');
  if (chips) chips.addEventListener('click', function () { setTimeout(render, 0); });
  render();
})();
