/* Éditeur d'embed : aperçu en direct + import/export JSON (reproduit partials/embed-preview.ejs côté client). */
(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function md(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<u>$1</u>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/&lt;@&amp;(\d+)&gt;/g, '<span class="dmention">@rôle</span>')
      .replace(/&lt;@!?(\d+)&gt;/g, '<span class="dmention">@membre</span>')
      .replace(/&lt;#(\d+)&gt;/g, '<span class="dmention">#salon</span>')
      .replace(/\n/g, '<br>');
  }
  function imgOk(u) { return typeof u === 'string' && /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(u); }

  /** Rend un message Discord (embed + boutons + contenu). Exposé pour les autres pages (aperçus). */
  function renderEmbedPreview(embed, buttons, content, opts) {
    opts = opts || {};
    var e = embed || {};
    var btns = Array.isArray(buttons) ? buttons : [];
    var color = e.color ? (e.color[0] === '#' ? e.color : '#' + e.color) : (opts.defaultColor || '#7C3AED');
    var hasEmbed = Boolean(e.title || e.description || (e.fields && e.fields.length) || e.image || e.thumbnail || (e.author && e.author.name) || (e.footer && e.footer.text));
    var html = '<div class="dpreview' + (opts.compact ? ' dpreview-compact' : '') + '"><div class="dmsg"><div class="davatar" aria-hidden="true">' + (opts.avatarHtml || '') + '</div><div class="dbody">';
    html += '<div class="dmeta"><span class="dname">' + esc(opts.botName || 'Redemption Story') + '</span><span class="dbot">BOT</span><span class="dtime">Aujourd\'hui</span></div>';
    if (content) html += '<div class="dcontent">' + md(content) + '</div>';
    if (hasEmbed) {
      html += '<div class="dembed" data-embed-color="' + esc(color) + '">';
      if (e.thumbnail) html += '<div class="dembed-thumb">' + (imgOk(e.thumbnail) ? '<img src="' + esc(e.thumbnail) + '" alt="">' : '<span class="dimg-ph" title="' + esc(e.thumbnail) + '">🖼</span>') + '</div>';
      if (e.author && e.author.name) html += '<div class="dembed-author">' + (e.author.iconUrl && imgOk(e.author.iconUrl) ? '<img src="' + esc(e.author.iconUrl) + '" alt="">' : '') + '<span>' + esc(e.author.name) + '</span></div>';
      if (e.title) html += '<div class="dembed-title">' + (e.url ? '<a href="' + esc(e.url) + '" rel="noopener noreferrer" target="_blank">' + md(e.title) + '</a>' : md(e.title)) + '</div>';
      if (e.description) html += '<div class="dembed-desc">' + md(e.description) + '</div>';
      if (e.fields && e.fields.length) {
        html += '<div class="dembed-fields">';
        e.fields.forEach(function (f) { html += '<div class="dembed-field' + (f.inline ? ' inline' : '') + '"><div class="dembed-field-name">' + md(f.name) + '</div><div class="dembed-field-value">' + md(f.value) + '</div></div>'; });
        html += '</div>';
      }
      if (e.image) html += '<div class="dembed-image">' + (imgOk(e.image) ? '<img src="' + esc(e.image) + '" alt="">' : '<div class="dimg-ph dimg-ph-wide" title="' + esc(e.image) + '">🖼 <span class="truncate">' + esc(e.image) + '</span></div>') + '</div>';
      if ((e.footer && e.footer.text) || e.timestamp) {
        var time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        html += '<div class="dembed-footer">' + (e.footer && e.footer.iconUrl && imgOk(e.footer.iconUrl) ? '<img src="' + esc(e.footer.iconUrl) + '" alt="">' : '') + '<span>' + esc(e.footer && e.footer.text ? e.footer.text : '') + (e.footer && e.footer.text && e.timestamp ? ' • ' : '') + (e.timestamp ? 'Aujourd\'hui à ' + time : '') + '</span></div>';
      }
      html += '</div>';
    } else if (!content) {
      html += '<div class="dcontent muted">Message vide — ajoutez un titre, une description ou du texte.</div>';
    }
    if (btns.length) {
      html += '<div class="dbuttons">';
      btns.forEach(function (b) {
        html += '<span class="dbtn dbtn-' + esc(b.style || 'secondary') + (b.disabled ? ' disabled' : '') + '">' + (b.emoji ? '<span class="dbtn-emoji">' + (String(b.emoji).indexOf(':') !== -1 ? '◆' : esc(b.emoji)) + '</span>' : '') + esc(b.label || '') + (b.style === 'link' ? ' ↗' : '') + '</span>';
      });
      html += '</div>';
    }
    html += '</div></div></div>';
    return html;
  }
  window.renderEmbedPreview = renderEmbedPreview;

  function applyColors(root) {
    $$('[data-embed-color]', root || document).forEach(function (el) { el.style.borderLeftColor = el.getAttribute('data-embed-color'); });
  }
  window.applyEmbedColors = applyColors;

  function setup(editor) {
    var previewHost = $('[data-embed-preview]', editor);
    var initial = previewHost && $('.dpreview', previewHost);
    var botName = initial && $('.dname', initial) ? $('.dname', initial).textContent : 'Redemption Story';
    var avatarHtml = initial && $('.davatar', initial) ? $('.davatar', initial).innerHTML : '';
    var defaultColor = editor.getAttribute('data-default-color') || '#7C3AED';
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
    function render() {
      if (fieldsCount && fieldsRep && fieldsRep.repeater) fieldsCount.textContent = String(fieldsRep.repeater.read().length);
      if (!previewHost) return;
      previewHost.innerHTML = renderEmbedPreview(readSpec(), readButtons(), contentEl ? contentEl.value : '', { botName: botName, avatarHtml: avatarHtml, defaultColor: defaultColor });
      applyColors(previewHost);
    }
    // Pastilles de la palette : clic → couleur appliquée au champ texte + au sélecteur + aperçu
    $$('[data-swatch]', editor).forEach(function (sw) {
      var hex = sw.getAttribute('data-color');
      if (hex) sw.style.backgroundColor = hex;
      sw.addEventListener('click', function () {
        var txt = $('[data-color-text]', editor), picker = $('[data-color-input]', editor);
        var value = sw.getAttribute('data-swatch') || '';
        if (txt) { txt.value = value; txt.dispatchEvent(new Event('input', { bubbles: true })); }
        if (picker && value) picker.value = value.toLowerCase();
        $$('[data-swatch]', editor).forEach(function (o) { o.classList.toggle('is-active', o === sw); });
      });
    });
    function setVal(key, v) { var el = input(key); if (!el) return; if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = v === undefined || v === null ? '' : String(v); if (key === 'color') { var picker = el.parentElement && $('[data-color-input]', el.parentElement); if (picker && /^#?[0-9a-fA-F]{6}$/.test(String(v || ''))) picker.value = (String(v)[0] === '#' ? String(v) : '#' + v).toLowerCase(); } }

    /** Remplit le formulaire depuis un EmbedSpec (+ boutons optionnels). Exposé via editor.embedEditor.load(). */
    function load(spec, buttons) {
      spec = spec || {};
      setVal('title', spec.title); setVal('url', spec.url); setVal('description', spec.description); setVal('color', spec.color);
      setVal('image', spec.image); setVal('thumbnail', spec.thumbnail); setVal('timestamp', spec.timestamp);
      setVal('footerText', spec.footer ? spec.footer.text : ''); setVal('footerIconUrl', spec.footer ? spec.footer.iconUrl : '');
      setVal('authorName', spec.author ? spec.author.name : ''); setVal('authorIconUrl', spec.author ? spec.author.iconUrl : ''); setVal('authorUrl', spec.author ? spec.author.url : '');
      if (fieldsRep && fieldsRep.repeater) fieldsRep.repeater.setRows(spec.fields || []);
      if (buttons !== undefined && buttonsRep && buttonsRep.repeater) buttonsRep.repeater.setRows(buttons || []);
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
      if (!raw) { if (status) status.textContent = 'Collez un JSON d\'embed (ou un message { content, embeds, buttons }).'; return; }
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
  applyColors(document);

  /* ───── Aperçus statiques rendus depuis des données JSON (<script type="application/json" data-preview-data>) ───── */
  $$('[data-preview-json]').forEach(function (host) {
    var script = $(host.getAttribute('data-preview-json'));
    if (!script) return;
    try {
      var data = JSON.parse(script.textContent || '{}');
      var nameEl = $('.dname');
      host.innerHTML = renderEmbedPreview((data.embeds && data.embeds[0]) || data.embed || {}, data.buttons || [], data.content || '', { botName: nameEl ? nameEl.textContent : undefined, avatarHtml: $('.davatar') ? $('.davatar').innerHTML : '', defaultColor: document.body.getAttribute('data-brand-color') || '#7C3AED' });
      applyColors(host);
    } catch (e) { /* ignoré */ }
  });
})();
