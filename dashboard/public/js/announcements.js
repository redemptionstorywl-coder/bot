/* Éditeur d'annonce : aperçu Discord live (mentions + texte + embed + boutons). */
(function () {
  'use strict';
  var UI = window.UI, D = window.DiscordPreview;
  var form = document.getElementById('announcement-form');
  var host = document.querySelector('[data-announcement-preview]');
  if (!UI || !D || !form || !host) return;
  var editor = form.querySelector('[data-embed-editor]');

  function mentionLine() {
    var parts = [];
    var everyone = form.elements.namedItem('mentionEveryone');
    if (everyone && everyone.checked) parts.push('@everyone');
    var roles = form.querySelector('select[name="mentionRoleIds"]');
    if (roles) Array.prototype.forEach.call(roles.selectedOptions, function (o) { if (o.value) parts.push('<@&' + o.value + '>'); });
    return parts.join(' ');
  }
  function render() {
    var contentEl = form.elements.namedItem('content');
    var content = [mentionLine(), contentEl ? contentEl.value : ''].filter(Boolean).join('\n');
    var api = editor && editor.embedEditor;
    var msg = { content: content, embed: api ? api.read() : {}, buttons: api ? api.readButtons() : [], emptyText: 'Le message est vide : ajoutez un texte ou un embed.' };
    host.innerHTML = D.render(msg, UI.previewContext());
    UI.paint(host);
  }
  var raf = 0;
  function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }
  ['input', 'change', 'repeater:change', 'picker:change', 'embed:change'].forEach(function (ev) { form.addEventListener(ev, schedule); });
  render();
})();
