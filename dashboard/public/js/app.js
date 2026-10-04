/* Redemption Story Studio — client du dashboard (vanilla, sans dépendance, CSP self-only).
 * Expose window.UI : { $, $$, api, toast, paint, enhance, onEnhance, guildData, previewContext, sortable, confirm, markClean, icon }.
 * Composants déclaratifs (attributs data-*) : voir dashboard/README.md. */
(function () {
  'use strict';

  var body = document.body;
  var csrfToken = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  var guildId = body.getAttribute('data-guild-id') || '';

  // ───── Helpers ─────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts); }

  var ICONS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    'x-circle': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    hash: '<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/>',
    volume: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    forum: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    grip: '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  };
  /** SVG d'une icône du jeu client (sous-ensemble de lib/icons.ts). */
  function icon(name, size) {
    var s = size || 16;
    return '<svg class="icon icon-' + name + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.info) + '</svg>';
  }

  /** Appel API JSON avec jeton CSRF. Rejette une Error(message lisible). */
  function api(method, url, data) {
    var init = { method: method, credentials: 'same-origin', headers: { Accept: 'application/json', 'x-csrf-token': csrfToken, 'X-Requested-With': 'fetch' } };
    if (data !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(data); }
    return fetch(url, init).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        if (!res.ok) {
          var err = new Error((json && (json.error || json.message)) || ('Erreur ' + res.status));
          err.status = res.status; err.details = json && json.details;
          throw err;
        }
        return json;
      });
    });
  }

  // ───── Toasts ─────
  function dismissToast(el) {
    if (!el || el.classList.contains('toast-leaving')) return;
    el.classList.add('toast-leaving');
    setTimeout(function () { el.remove(); }, 200);
  }
  function armToast(el, timeout) {
    var timer = setTimeout(function () { dismissToast(el); }, timeout);
    on(el, 'mouseenter', function () { clearTimeout(timer); });
    on(el, 'mouseleave', function () { timer = setTimeout(function () { dismissToast(el); }, 2500); });
  }
  /** Toast (success | error | warning | info). */
  function toast(message, type, timeout) {
    var host = $('#toasts');
    if (!host) return null;
    type = type || 'info';
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    var ic = { success: 'check-circle', error: 'x-circle', warning: 'alert-triangle', info: 'info' }[type] || 'info';
    el.innerHTML = icon(ic, 18) + '<div class="toast-text"></div><button type="button" class="toast-close" data-toast-close aria-label="Fermer">' + icon('x', 16) + '</button>';
    $('.toast-text', el).textContent = message;
    host.appendChild(el);
    while (host.children.length > 5) host.removeChild(host.firstElementChild);
    armToast(el, timeout || (type === 'error' ? 8000 : 4000));
    return el;
  }
  $$('#toasts .toast[data-autohide]').forEach(function (el) { armToast(el, parseInt(el.getAttribute('data-autohide'), 10) || 5000); });
  on(document, 'click', function (e) { var b = e.target.closest('[data-toast-close]'); if (b) dismissToast(b.closest('.toast')); });

  // ───── Données du serveur courant (#guild-data) ─────
  var guildDataCache;
  function guildData() {
    if (guildDataCache !== undefined) return guildDataCache;
    var el = document.getElementById('guild-data');
    try { guildDataCache = el ? JSON.parse(el.textContent || 'null') : null; } catch (e) { guildDataCache = null; }
    return guildDataCache;
  }
  /** Contexte des aperçus Discord (rôles, salons, bot, utilisateur, couleur de marque). */
  function previewContext(extra) {
    var g = guildData();
    var users = {};
    if (g && g.user) users[g.user.id] = g.user.name;
    var ctx = window.DiscordPreview ? window.DiscordPreview.contextFromGuild(g, g && g.bot ? { name: g.bot.name, avatarUrl: g.bot.avatarUrl } : null, { defaultColor: (g && g.brandColor) || body.getAttribute('data-brand-color') || '#7C3AED', users: users }) : {};
    if (extra) Object.keys(extra).forEach(function (k) { ctx[k] = extra[k]; });
    return ctx;
  }

  // ───── Styles dynamiques (CSP : pas de style inline dans le HTML) ─────
  function hexToRgba(hex, alpha) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return null;
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + alpha + ')';
  }
  function paint(root) {
    root = root || document;
    $$('[data-embed-color]', root).forEach(function (el) { el.style.borderLeftColor = el.getAttribute('data-embed-color'); });
    $$('[data-role-color]', root).forEach(function (el) {
      var c = el.getAttribute('data-role-color');
      if (el.classList.contains('dmention')) {
        if (c && c.toLowerCase() !== '#a1a1aa' && c !== '#000000') { el.style.color = c; el.style.backgroundColor = hexToRgba(c, 0.1); }
        return;
      }
      var dot = el.classList.contains('role-dot') ? el : $('.role-dot', el);
      if (dot) dot.style.backgroundColor = c;
    });
    $$('[data-color]', root).forEach(function (el) { if (el.classList.contains('swatch') || el.classList.contains('role-dot') || el.classList.contains('house-dot') || el.hasAttribute('data-color-bg')) el.style.backgroundColor = el.getAttribute('data-color'); });
    $$('[data-pct]', root).forEach(function (el) {
      var pct = Math.max(0, Math.min(100, parseFloat(el.getAttribute('data-pct')) || 0));
      requestAnimationFrame(function () { el.style.width = pct + '%'; });
    });
    $$('[data-h]', root).forEach(function (el) {
      var h = Math.max(0, Math.min(100, parseFloat(el.getAttribute('data-h')) || 0));
      requestAnimationFrame(function () { el.style.height = h + '%'; });
    });
  }

  // ───── Amélioration progressive (pickers, etc.) ─────
  var enhancers = [];
  function onEnhance(fn) { enhancers.push(fn); fn(document); }
  function enhance(root) { enhancers.forEach(function (fn) { fn(root || document); }); paint(root || document); }

  // ───── Sidebar (tiroir mobile) ─────
  var backdrop = $('.sidebar-backdrop');
  function setSidebar(open) {
    body.classList.toggle('sidebar-open', open);
    if (backdrop) backdrop.hidden = !open;
    $$('[data-sidebar-toggle]').forEach(function (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
  }
  $$('[data-sidebar-toggle]').forEach(function (b) { on(b, 'click', function () { setSidebar(!body.classList.contains('sidebar-open')); }); });
  $$('[data-sidebar-close]').forEach(function (b) { on(b, 'click', function () { setSidebar(false); }); });

  // ───── Menus déroulants ─────
  function closeDropdowns(except) {
    $$('[data-dropdown].is-open').forEach(function (d) {
      if (d === except) return;
      d.classList.remove('is-open');
      var t = $('[data-dropdown-toggle]', d); if (t) t.setAttribute('aria-expanded', 'false');
    });
  }
  on(document, 'click', function (e) {
    var toggle = e.target.closest('[data-dropdown-toggle]');
    if (toggle) {
      var dd = toggle.closest('[data-dropdown]');
      var open = !dd.classList.contains('is-open');
      closeDropdowns(dd);
      dd.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var first = $('.dropdown-menu .dropdown-item', dd); if (first && e.detail === 0) first.focus(); }
      return;
    }
    if (!e.target.closest('[data-dropdown]')) closeDropdowns(null);
  });
  on(document, 'keydown', function (e) {
    var dd = e.target.closest && e.target.closest('[data-dropdown].is-open');
    if (!dd || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    var items = $$('.dropdown-item', dd);
    var i = items.indexOf(document.activeElement);
    e.preventDefault();
    var next = e.key === 'ArrowDown' ? items[(i + 1) % items.length] : items[(i - 1 + items.length) % items.length];
    if (next) next.focus();
  });

  // Onglet actif visible dans les barres d'onglets défilantes (mobile)
  $$('.tabs-nav [aria-current], .tab-list .tab.active').forEach(function (a) {
    var bar = a.parentElement;
    if (bar && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = Math.max(0, a.offsetLeft - bar.clientWidth / 2 + a.clientWidth / 2);
  });

  // ───── Onglets côté client ([data-tabs], pages modules) ─────
  $$('[data-tabs]').forEach(function (container) {
    var tabs = $$('[data-tab]', container).filter(function (t) { return t.closest('[data-tabs]') === container; });
    var panels = $$('[data-tab-panel]', container).filter(function (p) { return p.parentElement.closest('[data-tabs]') === container; });
    var param = container.getAttribute('data-tab-param') || 'tab';
    function activate(name, push) {
      tabs.forEach(function (t) { var a = t.getAttribute('data-tab') === name; t.classList.toggle('active', a); t.setAttribute('aria-selected', a ? 'true' : 'false'); t.setAttribute('tabindex', a ? '0' : '-1'); });
      panels.forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-tab-panel') === name); });
      if (push && window.history.replaceState) { var url = new URL(window.location.href); url.searchParams.set(param, name); window.history.replaceState(null, '', url.toString()); }
    }
    tabs.forEach(function (t, i) {
      on(t, 'click', function () { activate(t.getAttribute('data-tab'), true); });
      on(t, 'keydown', function (e) {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        n.focus(); activate(n.getAttribute('data-tab'), true);
      });
    });
    var initial = container.getAttribute('data-active');
    if (!initial || !tabs.some(function (t) { return t.getAttribute('data-tab') === initial; })) initial = tabs[0] && tabs[0].getAttribute('data-tab');
    if (initial) activate(initial, false);
  });

  // ───── Filtre local ([data-filter="#cible"] + [data-filter-item]) ─────
  $$('[data-filter]').forEach(function (input) {
    var target = $(input.getAttribute('data-filter'));
    if (!target) return;
    var empty = input.getAttribute('data-filter-empty') ? $(input.getAttribute('data-filter-empty')) : null;
    on(input, 'input', function () {
      var q = input.value.trim().toLowerCase();
      var shown = 0;
      $$('[data-filter-item]', target).forEach(function (row) {
        var text = row.getAttribute('data-filter-text') || row.textContent.toLowerCase();
        var hit = !q || text.indexOf(q) !== -1;
        row.hidden = !hit;
        if (hit) shown++;
      });
      $$('[data-filter-skip]', target).forEach(function (g) { g.hidden = Boolean(q); });
      if (empty) empty.hidden = shown > 0;
    });
  });

  // ───── Lignes de tableau cliquables (tr[data-href]) ─────
  on(document, 'click', function (e) {
    var row = e.target.closest('tr[data-href]');
    if (!row || e.target.closest('a, button, input, select, textarea, label, form')) return;
    if (e.metaKey || e.ctrlKey) window.open(row.getAttribute('data-href'), '_blank');
    else window.location.href = row.getAttribute('data-href');
  });
  on(document, 'keydown', function (e) {
    if (e.key !== 'Enter') return;
    var row = e.target.closest && e.target.closest('tr[data-href]');
    if (row && e.target === row) window.location.href = row.getAttribute('data-href');
  });
  $$('tr[data-href]').forEach(function (r) { if (!r.hasAttribute('tabindex')) r.setAttribute('tabindex', '0'); });

  // ───── Copier ([data-copy="texte"]) ─────
  on(document, 'click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (!b) return;
    e.preventDefault();
    var text = b.getAttribute('data-copy');
    var done = function () { toast('Copié dans le presse-papiers.', 'success', 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast('Copie impossible.', 'error'); });
    else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (err) { /* ignoré */ } ta.remove(); }
  });

  // ───── Insertion de variables ([data-insert-target] > [data-insert]) ─────
  $$('[data-insert-target]').forEach(function (group) {
    var target = $(group.getAttribute('data-insert-target'));
    if (!target) return;
    group.addEventListener('click', function (e) {
      var b = e.target.closest('[data-insert]');
      if (!b) return;
      var v = b.getAttribute('data-insert');
      var start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
      var end = typeof target.selectionEnd === 'number' ? target.selectionEnd : target.value.length;
      target.value = target.value.slice(0, start) + v + target.value.slice(end);
      target.focus();
      try { target.setSelectionRange(start + v.length, start + v.length); } catch (err) { /* ignoré */ }
      target.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // ───── Lien retour ─────
  $$('[data-back]').forEach(function (a) { on(a, 'click', function (e) { if (window.history.length > 1 && document.referrer.indexOf(window.location.origin) === 0) { e.preventDefault(); window.history.back(); } }); });

  // ───── Champs couleur ([data-color-picker] ou ancien [data-color-input] + [data-color-text]) ─────
  function setupColor(scope) {
    var picker = $('[data-color-input]', scope);
    var text = $('[data-color-text]', scope);
    if (!picker || !text || picker.hasAttribute('data-color-ready')) return;
    picker.setAttribute('data-color-ready', '1');
    var swatches = $$('[data-swatch]', scope);
    function mark(v) { swatches.forEach(function (s) { s.classList.toggle('is-active', (s.getAttribute('data-swatch') || '').toUpperCase() === (v || '').toUpperCase()); }); }
    function emit(el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    on(picker, 'input', function () { text.value = picker.value.toUpperCase(); mark(text.value); emit(text); });
    on(text, 'input', function () {
      var v = text.value.trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(v)) { picker.value = (v[0] === '#' ? v : '#' + v).toLowerCase(); mark(v[0] === '#' ? v : '#' + v); }
      else if (!v) mark('');
    });
    swatches.forEach(function (sw) {
      on(sw, 'click', function () {
        var v = sw.getAttribute('data-swatch') || '';
        text.value = v;
        if (v) picker.value = v.toLowerCase();
        mark(v);
        emit(text);
      });
    });
  }
  $$('[data-color-picker]').forEach(setupColor);
  $$('[data-color-input]').forEach(function (input) { if (input.parentElement) setupColor(input.closest('[data-color-picker]') || input.parentElement.parentElement || input.parentElement); });

  // ───── Afficher / masquer (compatibilité pages modules) ─────
  $$('[data-toggle-target]').forEach(function (select) {
    var target = $(select.getAttribute('data-toggle-target'));
    var expected = select.getAttribute('data-toggle-value');
    if (!target) return;
    function sync() { target.hidden = select.value !== expected; }
    on(select, 'change', sync); sync();
  });
  $$('[data-check-toggle], [data-check-hide]').forEach(function (box) {
    var show = box.hasAttribute('data-check-toggle') ? $$(box.getAttribute('data-check-toggle')) : [];
    var hide = box.hasAttribute('data-check-hide') ? $$(box.getAttribute('data-check-hide')) : [];
    var invert = box.hasAttribute('data-check-toggle-invert');
    if (!show.length && !hide.length) return;
    function sync() { show.forEach(function (t) { t.hidden = invert ? box.checked : !box.checked; }); hide.forEach(function (t) { t.hidden = box.checked; }); }
    on(box, 'change', sync); sync();
  });
  $$('[data-radio-toggle]').forEach(function (radio) {
    var group = radio.name ? $$('input[type="radio"][name="' + radio.name + '"][data-radio-toggle]') : [radio];
    function sync() { group.forEach(function (r) { $$(r.getAttribute('data-radio-toggle')).forEach(function (t) { t.hidden = !r.checked; }); }); }
    on(radio, 'change', sync); sync();
  });
  $$('[data-fill-form]').forEach(function (btn) {
    on(btn, 'click', function () {
      var form = $(btn.getAttribute('data-fill-form'));
      if (!form) return;
      Array.prototype.forEach.call(btn.attributes, function (attr) {
        if (attr.name.indexOf('data-set-') !== 0) return;
        var key = attr.name.slice(9).toLowerCase();
        var field = Array.prototype.find.call(form.elements, function (el) { return (el.name || '').toLowerCase() === key; });
        if (!field) return;
        if (field.type === 'checkbox') field.checked = Boolean(attr.value); else field.value = attr.value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      });
      var title = form.querySelector('[data-form-title]');
      if (title && btn.hasAttribute('data-form-title-text')) title.textContent = btn.getAttribute('data-form-title-text');
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var first = form.querySelector('input:not([type="hidden"]), select, textarea');
      if (first) first.focus();
    });
  });
  $$('[data-submit-on-change]').forEach(function (el) { on(el, 'change', function () { if (el.form) { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); } }); });
  $$('form[data-id-action]').forEach(function (form) {
    var baseAction = form.getAttribute('data-id-action');
    var title = form.querySelector('[data-form-title]');
    var originalTitle = title ? title.textContent : '';
    on(form, 'submit', function () {
      var idField = form.elements.namedItem('id');
      var id = idField && typeof idField.value === 'string' ? idField.value.trim() : '';
      form.action = id ? baseAction + '/' + encodeURIComponent(id) : baseAction;
    });
    on(form, 'reset', function () { if (title) title.textContent = originalTitle; form.action = baseAction; });
  });

  // ───── Modale de confirmation ─────
  var modal = $('#confirm-modal');
  var pendingConfirm = null;
  var lastFocus = null;
  function openModal(opts, onConfirm) {
    if (!modal) { if (window.confirm(opts.text)) onConfirm(); return; }
    lastFocus = document.activeElement;
    $('[data-modal-text]', modal).textContent = opts.text || 'Confirmer cette action ?';
    $('[data-modal-title]', modal).textContent = opts.title || 'Confirmer l’action';
    var btn = $('[data-modal-confirm]', modal);
    btn.textContent = opts.label || 'Confirmer';
    var primary = opts.variant === 'primary';
    btn.className = 'btn ' + (primary ? 'btn-primary' : 'btn-danger');
    $('[data-modal-icon]', modal).classList.toggle('is-accent', primary);
    pendingConfirm = onConfirm;
    modal.hidden = false;
    btn.focus();
  }
  function closeModal(confirmed) {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    var fn = pendingConfirm; pendingConfirm = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    if (confirmed && fn) fn();
  }
  if (modal) {
    $$('[data-modal-cancel]', modal).forEach(function (b) { on(b, 'click', function () { closeModal(false); }); });
    on($('[data-modal-confirm]', modal), 'click', function () { closeModal(true); });
    on(modal, 'keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = $$('button', modal).filter(function (b) { return !b.hidden; });
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
  function confirmOpts(el) {
    return { text: el.getAttribute('data-confirm') || 'Confirmer cette action ?', title: el.getAttribute('data-confirm-title'), label: el.getAttribute('data-confirm-label'), variant: el.getAttribute('data-confirm-variant') };
  }
  on(document, 'click', function (e) {
    var el = e.target.closest('[data-confirm]');
    if (!el || el.tagName === 'FORM' || el.hasAttribute('data-confirmed')) return;
    e.preventDefault();
    openModal(confirmOpts(el), function () {
      el.setAttribute('data-confirmed', '1');
      if (el.tagName === 'A') { window.location.href = el.href; return; }
      if (el.form && el.type === 'submit') { if (el.form.requestSubmit) el.form.requestSubmit(el); else el.form.submit(); }
      else el.click();
      setTimeout(function () { el.removeAttribute('data-confirmed'); }, 0);
    });
  });
  on(document, 'submit', function (e) {
    var form = e.target;
    if (form.matches && form.matches('form[data-confirm]') && !form.hasAttribute('data-confirmed')) {
      e.preventDefault();
      var submitter = e.submitter;
      openModal(confirmOpts(form), function () { form.setAttribute('data-confirmed', '1'); if (form.requestSubmit) form.requestSubmit(submitter || undefined); else form.submit(); });
    }
  }, true);
  on(document, 'keydown', function (e) { if (e.key === 'Escape') { closeModal(false); closeDropdowns(null); setSidebar(false); } });

  // ───── État de chargement des boutons de formulaire ─────
  on(document, 'submit', function (e) {
    if (e.defaultPrevented) return;
    var form = e.target;
    var btn = e.submitter || $('button[type="submit"], button:not([type])', form);
    if (btn && btn.classList.contains('btn') && !form.hasAttribute('data-no-loading')) {
      btn.classList.add('is-loading');
      setTimeout(function () { btn.classList.remove('is-loading'); }, 8000);
    }
  });

  // ───── Tri par glisser-déposer ─────
  /**
   * sortable(container, { item: '.selecteur', handle: '[data-sortable-handle]', onChange(items) })
   * Glisser-déposer natif (poignée) + clavier (Alt+↑ / Alt+↓ sur la poignée).
   */
  function sortable(container, opts) {
    opts = opts || {};
    var itemSel = opts.item || '[data-sortable-item]';
    var handleSel = opts.handle || '[data-sortable-handle]';
    var dragging = null;
    function items() { return $$(itemSel, container).filter(function (i) { return i.parentElement === container; }); }
    function changed() { if (opts.onChange) opts.onChange(items()); }
    on(container, 'mousedown', function (e) { var h = e.target.closest(handleSel); if (h && container.contains(h)) { var it = h.closest(itemSel); if (it) it.setAttribute('draggable', 'true'); } });
    on(container, 'touchstart', function (e) { var h = e.target.closest(handleSel); if (h) { var it = h.closest(itemSel); if (it) it.setAttribute('draggable', 'true'); } }, { passive: true });
    on(container, 'dragstart', function (e) {
      var it = e.target.closest && e.target.closest(itemSel);
      if (!it || it.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
      dragging = it;
      it.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', it.getAttribute('data-id') || ''); } catch (err) { /* ignoré */ }
    });
    on(container, 'dragover', function (e) {
      if (!dragging) return;
      e.preventDefault();
      var over = e.target.closest && e.target.closest(itemSel);
      $$(itemSel, container).forEach(function (i) { i.classList.remove('is-drop-target'); });
      if (!over || over === dragging || over.parentElement !== container) return;
      var rect = over.getBoundingClientRect();
      var after = e.clientY > rect.top + rect.height / 2;
      container.insertBefore(dragging, after ? over.nextElementSibling : over);
    });
    on(container, 'drop', function (e) { if (dragging) e.preventDefault(); });
    on(container, 'dragend', function () {
      if (!dragging) return;
      dragging.classList.remove('is-dragging');
      dragging.removeAttribute('draggable');
      $$(itemSel, container).forEach(function (i) { i.classList.remove('is-drop-target'); });
      dragging = null;
      changed();
    });
    on(container, 'keydown', function (e) {
      var h = e.target.closest && e.target.closest(handleSel);
      if (!h || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      var it = h.closest(itemSel);
      e.preventDefault();
      if (e.key === 'ArrowUp' && it.previousElementSibling) container.insertBefore(it, it.previousElementSibling);
      else if (e.key === 'ArrowDown' && it.nextElementSibling) container.insertBefore(it.nextElementSibling, it);
      h.focus();
      changed();
    });
    return { items: items };
  }
  // Déclaratif : [data-sortable][data-sortable-url] → POST JSON { order: [ids] }
  $$('[data-sortable]').forEach(function (list) {
    var url = list.getAttribute('data-sortable-url');
    sortable(list, {
      onChange: function (items) {
        $$('[data-sortable-index]', list).forEach(function (el, i) { el.textContent = String(i + 1); });
        if (!url) return;
        api('POST', url, { order: items.map(function (i) { return Number(i.getAttribute('data-id')); }) })
          .then(function () { toast('Ordre enregistré.', 'success', 2000); })
          .catch(function (err) { toast(err.message || 'Impossible d’enregistrer l’ordre.', 'error'); });
      },
    });
  });

  // ───── Modules (toggles instantanés) ─────
  function setModuleUi(key, enabled) {
    $$('[data-module-toggle="' + key + '"]').forEach(function (i) { i.checked = enabled; });
    $$('[data-module-card="' + key + '"]').forEach(function (c) { c.classList.toggle('is-on', enabled); var l = $('[data-module-state]', c); if (l) l.textContent = enabled ? 'Activé' : 'Désactivé'; });
    $$('[data-module-row="' + key + '"] [data-module-state]').forEach(function (s) { s.textContent = enabled ? 'Activé' : 'Désactivé'; });
    $$('[data-module-chip="' + key + '"]').forEach(function (c) { c.classList.toggle('chip-on', enabled); c.classList.toggle('chip-off', !enabled); });
  }
  function setActiveCount(n) { if (n === null || n === undefined) return; $$('[data-stat="modules-active"]').forEach(function (el) { el.textContent = String(n); }); }
  $$('[data-module-toggle]').forEach(function (input) {
    on(input, 'change', function () {
      var key = input.getAttribute('data-module-toggle');
      var enabled = input.checked;
      var url = input.getAttribute('data-url') || ('/guilds/' + guildId + '/modules/' + key);
      input.disabled = true;
      api('POST', url, { enabled: enabled })
        .then(function (res) { setModuleUi(key, res.enabled); setActiveCount(res.active); toast((input.getAttribute('data-label') || 'Module') + (res.enabled ? ' activé.' : ' désactivé.'), 'success', 2500); })
        .catch(function (err) { input.checked = !enabled; setModuleUi(key, !enabled); toast(err.message || 'Impossible de modifier le module.', 'error'); })
        .then(function () { input.disabled = false; });
    });
  });

  // ───── Interrupteurs instantanés ([data-toggle-url] : POST JSON { enabled }) ─────
  $$('input[type="checkbox"][data-toggle-url]').forEach(function (input) {
    on(input, 'change', function () {
      var enabled = input.checked;
      var scope = input.closest('[data-toggle-scope]');
      input.disabled = true;
      api('POST', input.getAttribute('data-toggle-url'), { enabled: enabled })
        .then(function () {
          if (scope) { scope.classList.toggle('is-disabled', !enabled); $$('[data-toggle-off]', scope).forEach(function (el) { el.hidden = enabled; }); }
          var tip = input.closest('[data-tooltip]'); if (tip) tip.setAttribute('data-tooltip', enabled ? 'Activée' : 'Désactivée');
          toast((input.getAttribute('data-toggle-label') || 'Élément') + (enabled ? ' activé(e).' : ' désactivé(e).'), 'success', 2500);
        })
        .catch(function (err) { input.checked = !enabled; toast(err.message || 'Modification impossible.', 'error'); })
        .then(function () { input.disabled = false; });
    });
  });

  // ───── Formulaires « modifications non enregistrées » ([data-dirty-form]) ─────
  var dirtyBar = $('#dirty-bar');
  var dirtyForms = [];
  var activeDirty = null;
  var submitting = false;
  var leaveArmedUntil = 0;
  function serialize(form) {
    var out = [];
    try { new FormData(form).forEach(function (v, k) { if (k !== '_csrf') out.push([k, typeof v === 'string' ? v : '[fichier]']); }); } catch (e) { /* ignoré */ }
    return JSON.stringify(out);
  }
  function isDirty(form) { return form.__dirtySnapshot !== undefined && serialize(form) !== form.__dirtySnapshot; }
  function refreshDirty() {
    var dirty = dirtyForms.filter(isDirty);
    if (!dirty.length) activeDirty = null;
    else if (dirty.indexOf(activeDirty) === -1) activeDirty = dirty[dirty.length - 1];
    if (!dirtyBar) return;
    var visible = Boolean(activeDirty);
    dirtyBar.classList.toggle('is-visible', visible);
    dirtyBar.setAttribute('aria-hidden', visible ? 'false' : 'true');
    $$('button', dirtyBar).forEach(function (b) { b.tabIndex = visible ? 0 : -1; });
  }
  function markClean(form) { form.__dirtySnapshot = serialize(form); refreshDirty(); }
  function initDirtyForms() {
    $$('form[data-dirty-form]').forEach(function (form) {
      if (dirtyForms.indexOf(form) !== -1) return;
      dirtyForms.push(form);
      form.classList.add('js-dirty');
      markClean(form);
      var check = function () { if (isDirty(form)) activeDirty = form; refreshDirty(); };
      ['input', 'change', 'repeater:change', 'picker:change', 'questions:change'].forEach(function (ev) { on(form, ev, function () { setTimeout(check, 0); }); });
      on(form, 'submit', function (e) { if (!e.defaultPrevented) { submitting = true; var s = dirtyBar && $('[data-dirty-save]', dirtyBar); if (s) s.classList.add('is-loading'); } });
    });
  }
  if (dirtyBar) {
    on($('[data-dirty-save]', dirtyBar), 'click', function () {
      if (!activeDirty) return;
      if (!activeDirty.checkValidity()) { activeDirty.reportValidity(); return; }
      if (activeDirty.requestSubmit) activeDirty.requestSubmit(); else activeDirty.submit();
    });
    on($('[data-dirty-reset]', dirtyBar), 'click', function () { submitting = true; window.location.reload(); });
  }
  window.addEventListener('beforeunload', function (e) {
    if (submitting || !dirtyForms.some(isDirty)) return;
    e.preventDefault();
    e.returnValue = '';
  });
  on(document, 'click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a || !activeDirty || submitting || a.target === '_blank' || e.defaultPrevented) return;
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#' || href.indexOf('javascript:') === 0) return;
    if (Date.now() < leaveArmedUntil) return;
    e.preventDefault();
    leaveArmedUntil = Date.now() + 4000;
    if (dirtyBar) { dirtyBar.classList.remove('is-shaking'); void dirtyBar.offsetWidth; dirtyBar.classList.add('is-shaking'); }
    toast('Enregistrez ou annulez vos modifications avant de quitter (cliquez à nouveau pour quitter sans enregistrer).', 'warning', 4000);
  });

  // ───── Temps réel (Socket.IO) ─────
  var live = $('[data-live]');
  function setLive(state) {
    if (!live) return;
    live.classList.toggle('is-live', state === 'live');
    live.classList.toggle('is-offline', state === 'offline');
    var label = $('[data-live-label]', live);
    if (label) label.textContent = state === 'live' ? 'Temps réel' : state === 'offline' ? 'Hors ligne' : 'Connexion…';
    live.setAttribute('data-tooltip', state === 'live' ? 'Mises à jour en direct actives' : state === 'offline' ? 'Temps réel indisponible : rechargez la page' : 'Connexion au temps réel…');
  }
  var overviewTimer = null;
  function refreshOverview() {
    if (!guildId || !$('[data-stat]')) return;
    clearTimeout(overviewTimer);
    overviewTimer = setTimeout(function () {
      api('GET', '/api/guilds/' + guildId + '/overview').then(function (o) {
        var map = { members: o.members, online: o.online, channels: o.channels, roles: o.roles, ping: o.pingMs >= 0 ? o.pingMs + ' ms' : '—', openTickets: o.counts.openTickets, activeWarnings: o.counts.activeWarnings, sanctions7d: o.counts.sanctions7d, 'modules-active': o.modules.active };
        Object.keys(map).forEach(function (k) {
          if (map[k] === undefined || map[k] === null) return;
          $$('[data-stat="' + k + '"]').forEach(function (el) { el.textContent = typeof map[k] === 'number' ? map[k].toLocaleString('fr-FR') : String(map[k]); });
        });
        if (o.modules && o.modules.list) o.modules.list.forEach(function (m) { setModuleUi(m.key, m.enabled); });
      }).catch(function () { /* silencieux */ });
    }, 400);
  }
  if (window.io && guildId) {
    setLive('connecting');
    var socket = window.io({ withCredentials: true, transports: ['websocket', 'polling'] });
    socket.on('connect', function () {
      socket.emit('guild:join', guildId, function (res) { if (res && !res.ok) { setLive('offline'); toast(res.error || 'Temps réel indisponible', 'warning'); } else setLive('live'); });
    });
    socket.on('disconnect', function () { setLive('offline'); });
    socket.on('connect_error', function () { setLive('offline'); });
    socket.on('config:update', function (payload) {
      if (!payload || payload.guildId !== guildId) return;
      if (payload.modules) Object.keys(payload.modules).forEach(function (k) { setModuleUi(k, Boolean(payload.modules[k])); });
      setActiveCount(payload.active);
      refreshOverview();
    });
    socket.on('log:new', function (payload) { if (payload && payload.guildId === guildId) refreshOverview(); });
    var MODULE_EVENTS = {
      'ticket:open': ['tickets', 'Nouveau ticket ouvert'], 'ticket:close': ['tickets', 'Ticket fermé'], 'ticket:update': ['tickets', 'Tickets mis à jour'], 'ticket:type': ['tickets', 'Raisons de tickets mises à jour'],
      'embed:update': ['embeds', 'Templates d’embeds mis à jour'], 'announcement:update': ['announcements', 'Annonces mises à jour'], 'announcement:published': ['announcements', 'Annonce publiée'], 'announcement:scheduled': ['announcements', 'Annonce programmée'],
      'welcome:update': ['welcome', 'Configuration de bienvenue mise à jour'], 'roles:update': ['roles', 'Configuration des rôles mise à jour'],
      'moderation:update': ['moderation', 'Modération mise à jour'], 'moderation:sanction': ['moderation', 'Nouvelle sanction'], 'moderation:warning': ['moderation', 'Avertissements mis à jour'],
      'giveaway:start': ['events', 'Giveaway lancé'], 'giveaway:end': ['events', 'Giveaway mis à jour'], 'event:update': ['events', 'Événements mis à jour'],
      'fivem:status': ['fivem', 'Statut FiveM mis à jour'], 'shop:order': ['shop', 'Commandes mises à jour'], 'whitelist:update': ['whitelist', 'Whitelist mise à jour'],
      'school:update': ['school', 'School RP mis à jour'], 'br:update': ['battleRoyale', 'Battle Royale mis à jour'],
    };
    var reloadTimer = null;
    socket.onAny(function (event, payload) {
      var def = MODULE_EVENTS[event];
      if (!def || !payload || payload.guildId !== guildId) return;
      if (event.indexOf('ticket:') === 0) refreshOverview();
      var currentPage = body.getAttribute('data-page');
      var pageKey = def[0];
      if (currentPage !== pageKey) return;
      var active = document.activeElement;
      var editing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
      var main = $('#main');
      var liveReload = main && main.querySelector('[data-live-reload]');
      var hasForms = Boolean($('form.form')) && !liveReload;
      if (editing || hasForms || dirtyForms.some(isDirty) || (main && main.querySelector('[data-no-live-reload]'))) { toast(def[1] + ' — rechargez pour voir les changements.', 'info'); return; }
      toast(def[1] + ' — actualisation…', 'info', 1500);
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(function () { window.location.reload(); }, 1200);
    });
  } else if (live) {
    live.hidden = true;
  }

  // ───── API publique ─────
  window.api = api;
  window.toast = toast;
  window.UI = { $: $, $$: $$, api: api, toast: toast, paint: paint, enhance: enhance, onEnhance: onEnhance, guildData: guildData, previewContext: previewContext, sortable: sortable, confirm: openModal, markClean: markClean, icon: icon };

  paint(document);
  // Après exécution de tous les scripts différés (pickers, listes, éditeurs) : instantané des formulaires
  document.addEventListener('DOMContentLoaded', function () { initDirtyForms(); paint(document); });
})();
