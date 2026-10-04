/* Éditeur de menu de rôles : aperçu Discord live (embed + boutons ou menu déroulant). */
(function () {
  'use strict';
  var UI = window.UI, D = window.DiscordPreview;
  var form = document.getElementById('rolemenu-form');
  var host = document.querySelector('[data-rolemenu-preview]');
  if (!UI || !D || !form || !host) return;
  var data = {};
  try { data = JSON.parse((document.getElementById('rolemenu-data') || {}).textContent || '{}'); } catch (e) { data = {}; }
  var g = UI.guildData() || {};
  var roles = {};
  (g.roles || []).forEach(function (r) { roles[r.id] = r; });
  var editor = form.querySelector('[data-embed-editor]');
  var rep = form.querySelector('[data-repeater]');

  function val(name) { var el = form.elements.namedItem(name); if (!el) return ''; if (el instanceof RadioNodeList) return el.value || ''; return typeof el.value === 'string' ? el.value.trim() : ''; }
  function render() {
    var options = (rep && rep.repeater ? rep.repeater.read() : []).filter(function (o) { return o.roleId; });
    var label = function (o) { return o.label || (roles[o.roleId] ? roles[o.roleId].name : 'rôle'); };
    var spec = editor && editor.embedEditor ? editor.embedEditor.read() : {};
    if (!D.hasEmbedContent(spec)) spec = { title: val('name') || 'Menu de rôles' };
    var msg = { embed: spec };
    if (val('style') === 'SELECT') {
      msg.components = options.length ? [{ type: 'select', placeholder: val('placeholder') || data.placeholderDefault || 'Choisissez vos rôles…', open: true, options: options.map(function (o) { return { label: label(o), emoji: o.emoji, description: o.description }; }) }] : [];
    } else {
      msg.buttons = options.map(function (o) { return { label: label(o), emoji: o.emoji, style: o.style || 'secondary' }; });
    }
    host.innerHTML = D.render(msg, UI.previewContext());
    UI.paint(host);
  }
  var raf = 0;
  function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }
  ['input', 'change', 'repeater:change', 'picker:change', 'embed:change'].forEach(function (ev) { form.addEventListener(ev, schedule); });
  render();
})();
