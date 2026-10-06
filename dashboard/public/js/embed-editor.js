/* Éditeur d'embed : aperçu Discord en direct + import/export JSON.
 * Le rendu est délégué à window.DiscordPreview (public/js/discord-preview.js), moteur partagé avec le serveur.
 * renderEmbedPreview(embed, buttons, content, opts) reste exposé pour les pages modules. */
(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var D = window.DiscordPreview;
  var UI = window.UI;

  function ctx(opts) {
    var c = UI ? UI.previewContext() : {};
    if (opts && opts.defaultColor) c.defaultColor = opts.defaultColor;
    if (opts && opts.botName) c.botName = opts.botName;
    return c;
  }
  function paint(root) { if (UI) UI.paint(root); }

  /** Rend un message Discord (embed + boutons + contenu) — compatibilité pages modules. */
  function renderEmbedPreview(embed, buttons, content, opts) {
    if (!D) return '';
    return D.render({ embed: embed || {}, buttons: Array.isArray(buttons) ? buttons : [], content: content || '', compact: Boolean(opts && opts.compact) }, ctx(opts));
  }
  window.renderEmbedPreview = renderEmbedPreview;
  window.applyEmbedColors = paint;

  function setup(editor) {
    // Aperçu intégré, ou hôte externe ([data-preview-target="#id"]) pour les mises en page « split ».
    var previewHost = $('[data-embed-preview]', editor) || (editor.getAttribute('data-preview-target') ? $(editor.getAttribute('data-preview-target')) : null);
    var defaultColor = editor.getAttribute('data-default-color') || '#2F8BFF';
    var contentSource = editor.getAttribute('data-content-source');
    var contentEl = contentSource ? $(contentSource) : null;
    var fieldsRep = $('[data-embed-fields] [data-repeater]', editor);
    var buttonsRep = $('[data-embed-buttons] [data-repeater]', editor);
    var fieldsCount = $('[data-fields-count]', editor);

    function input(key) { return $('[data-embed-key="' + key + '"]', editor); }
    function val(key) { var el = input(key); if (!el) return ''; return el.type === 'checkbox' ? el.checked : (el.value || '').trim(); }

    function readSpec() {
      var spec = {};
      var title = val('title'), url = val('url'), desc = val('description'), color = val('color'), image = val('image'), thumb = val('thumbnail');
      var footerText = val('footerText'), footerIcon = val('footerIconUrl'), authorName = val('authorName'), authorIcon = val('authorIconUrl'), authorUrl = val('authorUrl');
      if (title) spec.title = title;
      if (url) spec.url = url;
      if (desc) spec.description = desc;
      if (color && /^#?[0-9a-fA-F]{6}$/.test(color)) spec.color = color[0] === '#' ? color.toUpperCase() : '#' + color.toUpperCase();
      if (image) spec.image = image;
      if (thumb) spec.thumbnail = thumb;
      if (footerText) { spec.footer = { text: footerText }; if (footerIcon) spec.footer.iconUrl = footerIcon; }
      if (authorName) { spec.author = { name: authorName }; if (authorIcon) spec.author.iconUrl = authorIcon; if (authorUrl) spec.author.url = authorUrl; }
      if (val('timestamp')) spec.timestamp = true;
      var fields = fieldsRep && fieldsRep.repeater ? fieldsRep.repeater.read().filter(function (f) { return f.name && f.value; }) : [];
      if (fields.length) spec.fields = fields.map(function (f) { return { name: f.name, value: f.value, inline: Boolean(f.inline) }; });
      return spec;
    }
    function readButtons() {
      if (!buttonsRep || !buttonsRep.repeater) return [];
      return buttonsRep.repeater.read().filter(function (b) { return b.label; }).map(function (b) {
        var out = { label: b.label, style: b.style || 'secondary' };
        if (b.emoji) out.emoji = b.emoji;
        if (out.style === 'link') { if (b.url) out.url = b.url; } else if (b.customId) out.customId = b.customId;
        return out;
      });
    }
    var raf = 0;
    function render() {
      if (fieldsCount && fieldsRep && fieldsRep.repeater) fieldsCount.textContent = String(fieldsRep.repeater.read().length);
      editor.dispatchEvent(new CustomEvent('embed:change', { bubbles: true, detail: { spec: readSpec(), buttons: readButtons() } }));
      if (!previewHost || !D) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        previewHost.innerHTML = D.render({ embed: readSpec(), buttons: readButtons(), content: contentEl ? contentEl.value : '' }, ctx({ defaultColor: defaultColor }));
        paint(previewHost);
      });
    }
    function setVal(key, v) {
      var el = input(key);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = v === undefined || v === null ? '' : String(v);
      if (key === 'color') el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /** Remplit le formulaire depuis un EmbedSpec (+ boutons optionnels). */
    function load(spec, buttons) {
      spec = spec || {};
      setVal('title', spec.title); setVal('url', spec.url); setVal('description', spec.description); setVal('color', spec.color);
      setVal('image', spec.image); setVal('thumbnail', spec.thumbnail); setVal('timestamp', spec.timestamp);
      setVal('footerText', spec.footer ? spec.footer.text : ''); setVal('footerIconUrl', spec.footer ? spec.footer.iconUrl : '');
      setVal('authorName', spec.author ? spec.author.name : ''); setVal('authorIconUrl', spec.author ? spec.author.iconUrl : ''); setVal('authorUrl', spec.author ? spec.author.url : '');
      if (fieldsRep && fieldsRep.repeater) fieldsRep.repeater.setRows(spec.fields || []);
      if (buttons !== undefined && buttonsRep && buttonsRep.repeater) buttonsRep.repeater.setRows(buttons || []);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      render();
    }

    editor.addEventListener('input', render);
    editor.addEventListener('change', render);
    editor.addEventListener('repeater:change', render);
    if (contentEl) contentEl.addEventListener('input', render);

    var jsonArea = $('[data-embed-json]', editor);
    var status = $('[data-embed-json-status]', editor);
    var importBtn = $('[data-embed-import]', editor);
    var exportBtn = $('[data-embed-export]', editor);
    if (importBtn && jsonArea) importBtn.addEventListener('click', function () {
      var raw = jsonArea.value.trim();
      if (!raw) { if (status) status.textContent = 'Collez un JSON d’embed (ou un message { content, embeds, buttons }).'; return; }
      try {
        var json = JSON.parse(raw);
        var spec = json, buttons;
        if (json && Array.isArray(json.embeds)) { spec = json.embeds[0] || {}; buttons = Array.isArray(json.buttons) ? json.buttons : undefined; if (typeof json.content === 'string' && contentEl) contentEl.value = json.content; }
        else if (json && Array.isArray(json.buttons) && !json.title && !json.description) { spec = {}; buttons = json.buttons; }
        load(spec, buttons);
        if (status) status.textContent = 'JSON appliqué au formulaire. Pensez à enregistrer.';
        if (window.toast) window.toast('JSON appliqué au formulaire.', 'success');
      } catch (err) {
        if (status) status.textContent = 'JSON invalide : ' + (err && err.message ? err.message : err);
      }
    });
    if (exportBtn && jsonArea) exportBtn.addEventListener('click', function () {
      var out = { embeds: [readSpec()] };
      var buttons = readButtons();
      if (buttons.length) out.buttons = buttons;
      if (contentEl && contentEl.value.trim()) out.content = contentEl.value.trim();
      jsonArea.value = JSON.stringify(out, null, 2);
      if (status) status.textContent = 'JSON exporté (copiez-le).';
    });

    editor.embedEditor = { load: load, read: readSpec, readButtons: readButtons, render: render };
    render();
  }

  $$('[data-embed-editor]').forEach(setup);
  paint(document);

  /* Aperçus statiques rendus depuis des données JSON : <div data-preview-json="#id"> + <script type="application/json" id="id">{ content, embeds|embed, buttons }</script> */
  $$('[data-preview-json]').forEach(function (host) {
    var script = $(host.getAttribute('data-preview-json'));
    if (!script || !D) return;
    try {
      var data = JSON.parse(script.textContent || '{}');
      host.innerHTML = D.render({ embed: (data.embeds && data.embeds[0]) || data.embed || {}, buttons: data.buttons || [], components: data.components || [], content: data.content || '' }, ctx());
      paint(host);
    } catch (e) { /* ignoré */ }
  });
})();
