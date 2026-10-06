/* Tickets : aperçus Discord live (éditeur de raison, créateur de panneau, relances) et petits outils d'édition.
 * Données serveur : <script type="application/json" id="ticket-preview-data"> (textes Discord dans la langue du bot). */
(function () {
  'use strict';
  var UI = window.UI, D = window.DiscordPreview;
  if (!UI || !D) return;
  var $ = UI.$, $$ = UI.$$;

  var data = {};
  try { data = JSON.parse(($('#ticket-preview-data') || {}).textContent || '{}'); } catch (e) { data = {}; }
  var texts = data.texts || {};
  var g = UI.guildData() || {};
  var me = g.user || { id: '0', name: 'Membre', username: 'membre', avatarUrl: null };
  var NUMBER = data.number || 42;

  function fieldValue(form, name) { var el = form.elements.namedItem(name); if (!el) return ''; if (el instanceof RadioNodeList) return el.value || ''; return typeof el.value === 'string' ? el.value.trim() : ''; }
  function checked(form, name) { var el = form.elements.namedItem(name); return Boolean(el && el.checked); }
  function paint(host, html) { host.innerHTML = html; UI.paint(host); }
  function ctx() { return UI.previewContext(); }

  /** Même nettoyage que TicketService (nom de salon Discord). */
  function sanitizeChannelName(name) {
    var cleaned = String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-_]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
    return (cleaned || 'ticket').slice(0, 100);
  }
  function slugKey(label) {
    var s = String(label || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 32);
    return s.length >= 2 ? s : 'type-' + s;
  }

  // ───── Éditeur de raison ─────
  var reasonForm = $('#reason-form');
  if (reasonForm) (function () {
    var labelEl = $('[data-reason-label]', reasonForm);
    var emojiEl = $('[data-reason-emoji]', reasonForm);
    var welcomeEl = $('[data-welcome-text]', reasonForm);
    var nameFormatEl = $('[data-name-format]', reasonForm);
    var questions = $('[data-questions]', reasonForm);
    var modalHost = $('[data-modal-preview]');
    var openingHost = $('[data-opening-preview]');
    var embedEditor = $('#embed-custom [data-embed-editor]');
    var staffSelect = $('#r-staff');
    var fixedKey = reasonForm.getAttribute('data-reason-key');

    function label() { return (labelEl && labelEl.value.trim()) || 'Nouvelle raison'; }
    function emoji() { return (emojiEl && emojiEl.value.trim()) || '🎫'; }
    function readQuestions() { return questions && questions.repeater ? questions.repeater.read() : []; }
    function staffRoles() {
      var own = staffSelect ? Array.prototype.filter.call(staffSelect.options, function (o) { return o.selected && o.value; }).map(function (o) { return o.value; }) : [];
      var known = {};
      (g.roles || []).forEach(function (r) { known[r.id] = true; });
      var out = [];
      own.concat(data.globalStaffRoleIds || []).forEach(function (id) { if (known[id] && out.indexOf(id) === -1) out.push(id); });
      return out;
    }
    function vars() {
      var now = new Date();
      return {
        user: '<@' + me.id + '>', username: me.username || me.name, displayName: me.name, tag: '@' + (me.username || me.name), userId: me.id,
        server: g.name || '', memberCount: g.memberCount || '', avatar: me.avatarUrl || '', language: '',
        date: now.toLocaleDateString('fr-FR'), time: now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        number: NUMBER, type: label(), emoji: emoji(),
      };
    }

    function renderHeader() {
      var t = $('[data-live-title]'); if (t) t.textContent = label();
      var e = $('[data-live-emoji]'); if (e) e.textContent = emoji();
    }
    function renderChannelName() {
      var fmtStr = (nameFormatEl && nameFormatEl.value.trim()) || 'ticket-{number}';
      var name = sanitizeChannelName(D.applyVars(fmtStr, { number: NUMBER, username: me.username || me.name, type: fixedKey || slugKey(label()) }));
      $$('[data-name-preview]').forEach(function (el) { el.textContent = name; });
    }
    /** Même composition que le bot : titre, questions (4 max), message facultatif s'il reste une place (5 champs max). */
    function modalFields() {
      var o = texts.open || {};
      var qs = readQuestions().slice(0, 4);
      var fields = [{ label: o.titleLabel, placeholder: o.titlePlaceholder, style: 'short', required: true, maxLength: 50 }].concat(qs);
      if (fields.length < 5) fields.push({ label: o.messageLabel, placeholder: o.messagePlaceholder, style: 'paragraph', required: false, maxLength: 2000 });
      return fields;
    }
    function renderModal() {
      if (!modalHost) return;
      var title = D.applyVars(texts.open && texts.open.modalTitle ? texts.open.modalTitle : '{emoji} {type}', { emoji: emoji(), type: label() }).slice(0, 45);
      paint(modalHost, D.renderModal({ title: title, fields: modalFields() }, ctx()));
    }
    function renderOpening() {
      if (!openingHost) return;
      var v = vars();
      var roles = staffRoles();
      var mention = '<@' + me.id + '>';
      var ping = roles.length ? D.applyVars(texts.open.staffPing, { roles: roles.map(function (r) { return '<@&' + r + '>'; }).join(' '), user: mention }) : mention;
      var welcome = welcomeEl ? D.applyVars(welcomeEl.value.trim(), v) : '';
      var content = [ping, welcome].filter(Boolean).join('\n\n').slice(0, 2000);
      var custom = fieldValue(reasonForm, 'embedMode') === 'custom';
      var spec;
      if (custom && embedEditor && embedEditor.embedEditor) spec = D.applyVarsDeep(embedEditor.embedEditor.read(), v);
      else spec = { title: D.applyVars(texts.open.title, v), description: D.applyVars(texts.open.description, v), footer: { text: (texts.footer || 'Redemption Story Studio') + ' • Ticket #' + NUMBER } };
      spec.thumbnail = me.avatarUrl || undefined;
      spec.timestamp = true;
      var fields = (spec.fields || []).slice();
      fields.push({ name: texts.open.fieldTitle, value: '**' + (texts.open.titlePlaceholder || '…') + '**' });
      fields.push({ name: texts.open.fieldUser, value: mention, inline: true });
      fields.push({ name: texts.open.fieldType, value: (emoji() + ' ' + label()).trim(), inline: true });
      fields.push({ name: texts.open.fieldStatus, value: texts.open.statusOpen, inline: true });
      readQuestions().forEach(function (q) { if (fields.length < 25) fields.push({ name: q.label, value: '*Réponse du membre…*' }); });
      spec.fields = fields;
      var b = texts.buttons || {};
      paint(openingHost, D.render({
        content: content,
        embed: spec,
        components: [
          { type: 'buttons', buttons: [{ label: b.close, emoji: '🔒', style: 'danger' }, { label: b.transcript, emoji: '📋', style: 'secondary' }, { label: b.add, emoji: '👥', style: 'secondary' }, { label: b.remove, emoji: '🚫', style: 'secondary' }] },
          { type: 'buttons', buttons: [{ label: b.transfer, emoji: '🔄', style: 'secondary' }, { label: b.permanent, emoji: '📌', style: 'secondary' }, { label: b.delete, emoji: '🗑️', style: 'danger' }] },
        ],
      }, ctx()));
    }
    var raf = 0;
    function renderAll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { renderHeader(); renderChannelName(); renderModal(); renderOpening(); });
    }
    ['input', 'change', 'repeater:change', 'picker:change', 'embed:change'].forEach(function (ev) { reasonForm.addEventListener(ev, renderAll); });
    renderAll();

    // Navigation de l'éditeur : section visible surlignée
    var nav = $('[data-editor-nav]');
    if (nav && 'IntersectionObserver' in window) {
      var links = $$('a[href^="#"]', nav);
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          links.forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('href') === '#' + en.target.id); });
        });
      }, { rootMargin: '-30% 0px -60% 0px' });
      links.forEach(function (a) { var s = $(a.getAttribute('href')); if (s) io.observe(s); });
    }
  })();

  // ───── Créateur de panneau ─────
  var panelForm = $('#panel-form');
  if (panelForm) (function () {
    var host = $('[data-panel-preview]');
    var after = $('[data-panel-after]');
    var picker = $('[data-panel-picker]');
    var note = $('[data-panel-note]');
    var chanLabel = $('[data-panel-channel]');
    var allReasons = data.reasons || [];
    function selectedReasons() {
      var boxes = $$('[data-panel-reason]', panelForm).filter(function (b) { return b.checked; });
      if (!boxes.length) return allReasons;
      return boxes.map(function (b) { return { label: b.getAttribute('data-label'), emoji: b.getAttribute('data-emoji') || null, description: b.getAttribute('data-description') || null }; });
    }
    function options(list) { return list.map(function (r) { return { label: r.label, emoji: r.emoji || undefined, description: r.description || undefined }; }); }
    function render() {
      var style = fieldValue(panelForm, 'style') || 'BUTTONS';
      var reasons = selectedReasons();
      var color = fieldValue(panelForm, 'embed[color]');
      var raw = {
        title: fieldValue(panelForm, 'embed[title]') || undefined,
        description: fieldValue(panelForm, 'embed[description]') || undefined,
        color: /^#?[0-9a-fA-F]{6}$/.test(color) ? color : undefined,
        image: fieldValue(panelForm, 'embed[image]') || undefined,
        footer: fieldValue(panelForm, 'embed[footerText]') ? { text: fieldValue(panelForm, 'embed[footerText]') } : undefined,
      };
      if (!D.hasEmbedContent(raw)) raw = data.defaultEmbed || {};
      var spec = D.applyVarsDeep(raw, { server: g.name || '' });
      var p = texts.panel || {};
      var comps = style === 'SELECT'
        ? [{ type: 'select', placeholder: p.placeholder, open: true, options: options(reasons) }]
        : [{ type: 'buttons', buttons: [{ label: p.open, emoji: '🎫', style: 'primary' }] }];
      if (host) paint(host, D.render({ embed: spec, components: comps }, ctx()));
      var showPicker = style !== 'SELECT' && reasons.length > 1;
      if (after) after.hidden = !showPicker;
      if (picker && showPicker) paint(picker, D.render({ content: p.pick, components: [{ type: 'select', placeholder: p.placeholder, open: true, options: options(reasons) }], ephemeral: true }, ctx()));
      if (note) note.textContent = style === 'SELECT'
        ? 'Le membre choisit directement la raison dans le menu (25 raisons maximum).'
        : reasons.length > 1 ? 'Après le clic, le membre choisit la raison dans un menu visible de lui seul.' : 'Une seule raison : le clic ouvre directement le ticket (ou son formulaire).';
      var sel = panelForm.elements.namedItem('channelId');
      var opt = sel && sel.selectedOptions && sel.selectedOptions[0];
      if (chanLabel) chanLabel.textContent = opt && opt.value ? (opt.getAttribute('data-name') || opt.textContent.replace(/^#\s*/, '')) : 'salon';
      renderEnglish(style, raw, reasons);
    }
    /** Version anglaise du panneau : embed traduit + raisons « FR / EN » calculés côté serveur (mêmes règles que le bot). */
    function renderEnglish(style, raw, reasons) {
      var english = window.TranslatePreview ? window.TranslatePreview.get('panel') : null;
      if (!english) return;
      var list = reasons.slice(0, 25);
      english.update({ embed: raw, options: list.map(function (r) { return { label: r.label, description: r.description || null }; }) }, {
        transform: function (m, res) {
          m.embeds = (m.embeds || []).map(function (e) { return D.applyVarsDeep(e, { server: g.name || '' }); });
          var p = res.panel || texts.panel || {};
          var opts = (res.options || []).map(function (o, i) { return { label: o.label, description: o.description || undefined, emoji: list[i] && list[i].emoji ? list[i].emoji : undefined }; });
          m.components = style === 'SELECT'
            ? [{ type: 'select', placeholder: p.placeholder, open: true, options: opts.length ? opts : options(list) }]
            : [{ type: 'buttons', buttons: [{ label: p.open, emoji: '🎫', style: 'primary' }] }];
          return m;
        },
      });
    }
    ['input', 'change', 'picker:change'].forEach(function (ev) { panelForm.addEventListener(ev, render); });
    render();
  })();

  // ───── Relances ─────
  var remForm = $('#reminders-form');
  if (remForm) (function () {
    var host = $('[data-reminder-preview]');
    var hours = remForm.elements.namedItem('reminderHours');
    $$('[data-set-hours]', remForm).forEach(function (b) {
      b.addEventListener('click', function () { hours.value = b.getAttribute('data-set-hours'); hours.dispatchEvent(new Event('input', { bubbles: true })); });
    });
    function duration(h) { var d = Math.floor(h / 24), r = h % 24; return d ? d + ' j' + (r ? ' ' + r + ' h' : '') : h + ' h'; }
    function render() {
      if (!host) return;
      var h = Math.max(1, Math.min(168, parseInt(hours.value, 10) || 24));
      var mode = fieldValue(remForm, 'reminderPing') || 'staff';
      var enabled = checked(remForm, 'remindersEnabled');
      var roles = (data.globalStaffRoleIds || []).filter(function (id) { return (g.roles || []).some(function (r) { return r.id === id; }); });
      var content = mode === 'none' ? '' : roles.map(function (r) { return '<@&' + r + '>'; }).join(' ');
      var since = Math.floor(Date.now() / 1000) - h * 3600;
      var r = texts.reminders || {};
      var embed = { color: '#F59E0B', title: r.title, description: D.applyVars(r.description || '', { duration: duration(h), since: '<t:' + since + ':R>', hours: h }), footer: { text: D.applyVars(r.footer || '', { hours: h }) } };
      paint(host, D.render({ content: content, embed: embed, buttons: [{ label: r.mute, emoji: '🔕', style: 'secondary' }], emptyText: '' }, ctx()));
      host.classList.toggle('is-muted-preview', !enabled);
    }
    ['input', 'change'].forEach(function (ev) { remForm.addEventListener(ev, render); });
    render();
  })();
})();
