/* Aperçu live d'une fenêtre Discord (modale) construite depuis une liste de questions.
 * <div data-modal-live="#conteneur-repeater" data-modal-title="Titre" data-modal-fallback="#json-questions-par-defaut"></div>
 * Sans question saisie, les questions par défaut (JSON) sont affichées. */
(function () {
  'use strict';
  var UI = window.UI, D = window.DiscordPreview;
  if (!UI || !D) return;
  UI.$$('[data-modal-live]').forEach(function (host) {
    var source = UI.$(host.getAttribute('data-modal-live'));
    var title = host.getAttribute('data-modal-title') || 'Formulaire';
    var fallback = [];
    try { fallback = JSON.parse((UI.$(host.getAttribute('data-modal-fallback') || '') || {}).textContent || '[]'); } catch (e) { fallback = []; }
    if (!source) return;
    function render() {
      var rows = source.repeater ? source.repeater.read() : [];
      host.innerHTML = D.renderModal({ title: title, fields: rows.length ? rows : fallback }, UI.previewContext());
      UI.paint(host);
    }
    source.addEventListener('repeater:change', render);
    source.addEventListener('input', render);
    source.addEventListener('change', render);
    render();
  });
})();
