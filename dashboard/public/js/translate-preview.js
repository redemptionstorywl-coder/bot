/* Aperçu de la version anglaise (traduction automatique FR → EN).
 * <div data-translate-panel="clé" data-translate-url="…/translate/preview" data-translate-toggle="#case" data-translate-default="true|false">
 *   … [data-translate-host] (aperçu Discord) · [data-translate-status] (état) …
 * Le panneau est visible quand la case « Version anglaise » est cochée (ou, sans case, selon data-translate-default).
 * Les pages appellent TranslatePreview.get('clé').update({ content, embed, buttons, attachments, options }, { transform })
 * à chaque rendu de leur aperçu français ; mode déclaratif : data-translate-editor="#formulaire" (+ data-translate-content="#champ")
 * écoute les événements `embed:change` de l'éditeur d'embed.
 * Requêtes POST JSON (jeton CSRF via UI.api), regroupées (debounce) et dédoublonnées ; aucun script inline (CSP). */
(function () {
  'use strict';
  var UI = window.UI, D = window.DiscordPreview;
  if (!UI || !D) return;

  var registry = {};

  function bind(panel) {
    var url = panel.getAttribute('data-translate-url');
    var host = UI.$('[data-translate-host]', panel);
    var status = UI.$('[data-translate-status]', panel);
    var toggleSel = panel.getAttribute('data-translate-toggle');
    var toggle = toggleSel ? UI.$(toggleSel) : null;
    var timer = 0, seq = 0, lastKey = '', lastResult = null, current = null, transform = null;

    function enabled() { return toggle ? Boolean(toggle.checked) : panel.getAttribute('data-translate-default') === 'true'; }
    function setStatus(text) { if (status) status.textContent = text; }

    function draw(res) {
      if (!current || !host) return;
      var msg = res && res.message ? res.message : { content: current.content || '', embeds: current.embed ? [current.embed] : [] };
      var out = {
        content: msg.content || '',
        embeds: Array.isArray(msg.embeds) ? msg.embeds : [],
        buttons: current.buttons || [],
        attachments: current.attachments || [],
        components: current.components || [],
        emptyText: 'Le message est vide : ajoutez un texte ou un embed.',
      };
      if (typeof transform === 'function') out = transform(out, res || {}) || out;
      host.innerHTML = D.render(out, UI.previewContext());
      UI.paint(host);
      if (!res) return;
      if (res.failed) setStatus('Traduction indisponible : le message partira en français seul');
      else if (res.translated || (res.options && res.options.length)) setStatus('Traduit par ' + (res.provider || 'le service de traduction'));
      else setStatus('Rien à traduire (texte vide ou déjà en anglais)');
    }

    function run() {
      panel.hidden = !enabled();
      if (panel.hidden || !current || !url) return;
      var body = { content: current.content || '', embed: current.embed || null };
      if (current.layout) body.layout = current.layout;
      if (Array.isArray(current.options)) body.options = current.options;
      var key = JSON.stringify(body);
      if (key === lastKey && lastResult) { draw(lastResult); return; }
      var mine = ++seq;
      panel.setAttribute('aria-busy', 'true');
      setStatus('Traduction…');
      UI.api('POST', url, body).then(function (res) {
        if (mine !== seq) return;
        lastKey = key;
        lastResult = res;
        draw(res);
      }).catch(function (err) {
        if (mine !== seq) return;
        setStatus(err && err.status === 429 ? 'Trop de demandes : aperçu mis à jour dans un instant' : 'Aperçu de la traduction indisponible');
        if (err && err.status === 429) { clearTimeout(timer); timer = setTimeout(run, 5000); }
      }).then(function () {
        if (mine === seq) panel.removeAttribute('aria-busy');
      });
    }

    function schedule(delay) { clearTimeout(timer); timer = setTimeout(run, delay === undefined ? 900 : delay); }

    if (toggle) toggle.addEventListener('change', function () { panel.hidden = !enabled(); if (enabled()) schedule(0); });
    panel.hidden = !enabled();

    return {
      /** Message français courant (variables `{user}`… non remplacées : le bot traduit le modèle). */
      update: function (message, opts) {
        current = message || null;
        transform = opts && typeof opts.transform === 'function' ? opts.transform : null;
        schedule();
      },
      refresh: function () { schedule(0); },
    };
  }

  UI.$$('[data-translate-panel]').forEach(function (panel) {
    var api = bind(panel);
    registry[panel.getAttribute('data-translate-panel') || 'default'] = api;

    // Mode déclaratif : éditeur d'embed (+ champ de texte optionnel).
    var editorSel = panel.getAttribute('data-translate-editor');
    var root = editorSel ? UI.$(editorSel) : null;
    if (!root) return;
    var contentSel = panel.getAttribute('data-translate-content');
    var contentEl = contentSel ? UI.$(contentSel) : null;
    var editor = UI.$('[data-embed-editor]', root);
    var last = { spec: editor && editor.embedEditor ? editor.embedEditor.read() : {}, buttons: editor && editor.embedEditor ? editor.embedEditor.readButtons() : [] };
    function push() { api.update({ content: contentEl ? contentEl.value : '', embed: last.spec, buttons: last.buttons }); }
    root.addEventListener('embed:change', function (ev) { if (ev.detail) { last = ev.detail; push(); } });
    if (contentEl) contentEl.addEventListener('input', push);
    push();
  });

  window.TranslatePreview = { get: function (key) { return registry[key || 'default'] || null; } };
})();
