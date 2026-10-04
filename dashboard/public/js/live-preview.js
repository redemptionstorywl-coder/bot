/* Aperçu Discord calculé par le serveur avec les constructeurs du bot.
 * <form data-live-preview="/url/preview" data-live-preview-target="#hote"> : à chaque modification (debounce),
 * les champs du formulaire sont envoyés en JSON (CSRF en en-tête) et la réponse { html } remplace le contenu de l'hôte.
 * Aucun enregistrement : la route d'aperçu construit une entité fictive. */
(function () {
  'use strict';
  var UI = window.UI;
  if (!UI) return;

  function serialize(form) {
    var out = {};
    new FormData(form).forEach(function (value, key) {
      if (key === '_csrf' || typeof value !== 'string') return;
      if (Object.prototype.hasOwnProperty.call(out, key)) out[key] = [].concat(out[key], value);
      else out[key] = value;
    });
    return out;
  }

  UI.$$('form[data-live-preview]').forEach(function (form) {
    var url = form.getAttribute('data-live-preview');
    var host = UI.$(form.getAttribute('data-live-preview-target') || '');
    if (!url || !host) return;
    var timer = 0, seq = 0, last = '';
    var extra = {};
    try { extra = JSON.parse(form.getAttribute('data-live-preview-extra') || '{}'); } catch (e) { extra = {}; }

    function refresh() {
      var body = serialize(form);
      Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
      var key = JSON.stringify(body);
      if (key === last) return;
      last = key;
      var mine = ++seq;
      host.setAttribute('aria-busy', 'true');
      UI.api('POST', url, body).then(function (res) {
        if (mine !== seq || !res || typeof res.html !== 'string') return;
        host.innerHTML = res.html;
        UI.paint(host);
      }).catch(function () { /* aperçu indicatif : on garde le dernier rendu */ }).then(function () {
        if (mine === seq) host.removeAttribute('aria-busy');
      });
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 350); }
    ['input', 'change', 'repeater:change', 'picker:change'].forEach(function (ev) { form.addEventListener(ev, schedule); });
    last = JSON.stringify(Object.assign(serialize(form), extra));
  });
})();
