/* Redemption Story Studio — dashboard client (vanilla, sans dépendance). */
(function () {
  'use strict';

  var csrfToken = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  var body = document.body;
  var guildId = body.getAttribute('data-guild-id') || '';

  // ───── Helpers ─────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** Appel API JSON avec jeton CSRF. Lève une Error(message) en cas d'échec. */
  function api(method, url, data) {
    var init = {
      method: method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'x-csrf-token': csrfToken, 'X-Requested-With': 'fetch' },
    };
    if (data !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(data);
    }
    return fetch(url, init).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        if (!res.ok) {
          var msg = (json && (json.error || json.message)) || ('Erreur ' + res.status);
          var err = new Error(msg);
          err.status = res.status;
          err.details = json && json.details;
          throw err;
        }
        return json;
      });
    });
  }
  window.api = api;

  /** Toast discret (success | error | warning | info). */
  function toast(message, type, timeout) {
    var host = $('#toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add('toast-leaving');
      setTimeout(function () { el.remove(); }, 300);
    }, timeout || 3500);
  }
  window.toast = toast;

  // ───── Flash & alerts ─────
  $$('[data-dismiss]').forEach(function (btn) {
    btn.addEventListener('click', function () { var a = btn.closest('.alert'); if (a) a.remove(); });
  });
  setTimeout(function () { $$('[data-flash] .alert-success').forEach(function (a) { a.remove(); }); }, 6000);

  // ───── Sidebar (mobile) ─────
  function closeSidebar() { body.classList.remove('sidebar-open'); var bd = $('.sidebar-backdrop'); if (bd) bd.hidden = true; }
  $$('[data-sidebar-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var open = body.classList.toggle('sidebar-open');
      var bd = $('.sidebar-backdrop'); if (bd) bd.hidden = !open;
    });
  });
  $$('[data-sidebar-close]').forEach(function (b) { b.addEventListener('click', closeSidebar); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeSidebar(); closeModal(false); } });

  // ───── Sélecteur de serveur ─────
  var switcher = $('[data-guild-switcher]');
  if (switcher) {
    switcher.addEventListener('change', function () {
      if (!switcher.value) return;
      var template = switcher.getAttribute('data-template') || '/guilds/{id}';
      window.location.href = template.replace('{id}', switcher.value);
    });
  }

  // ───── Lien retour ─────
  $$('[data-back]').forEach(function (a) {
    a.addEventListener('click', function (e) { if (window.history.length > 1) { e.preventDefault(); window.history.back(); } });
  });

  // ───── Onglets ─────
  $$('[data-tabs]').forEach(function (container) {
    var tabs = $$('[data-tab]', container).filter(function (t) { return t.closest('[data-tabs]') === container; });
    var panels = $$('[data-tab-panel]', container).filter(function (p) { return p.parentElement.closest('[data-tabs]') === container; });
    var param = container.getAttribute('data-tab-param') || 'tab';
    function activate(name, push) {
      tabs.forEach(function (t) { var on = t.getAttribute('data-tab') === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
      panels.forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-tab-panel') === name); });
      if (push && window.history.replaceState) {
        var url = new URL(window.location.href); url.searchParams.set(param, name); window.history.replaceState(null, '', url.toString());
      }
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { activate(t.getAttribute('data-tab'), true); }); });
    var initial = container.getAttribute('data-active');
    if (!initial || !tabs.some(function (t) { return t.getAttribute('data-tab') === initial; })) initial = tabs[0] && tabs[0].getAttribute('data-tab');
    if (initial) activate(initial, false);
  });

  // ───── Filtre de tableau / liste ─────
  $$('[data-filter]').forEach(function (input) {
    var target = $(input.getAttribute('data-filter'));
    if (!target) return;
    var items = $$('[data-filter-item]', target);
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      items.forEach(function (row) {
        var text = row.getAttribute('data-filter-text') || row.textContent.toLowerCase();
        row.hidden = Boolean(q) && text.indexOf(q) === -1;
      });
      $$('[data-filter-skip]', target).forEach(function (g) { g.hidden = Boolean(q); });
    });
  });

  // ───── Barres (largeur fixée en JS : CSP sans style inline) ─────
  $$('[data-pct]').forEach(function (el) {
    var pct = Math.max(0, Math.min(100, parseFloat(el.getAttribute('data-pct')) || 0));
    requestAnimationFrame(function () { el.style.width = pct + '%'; });
  });
  $$('[data-role-color]').forEach(function (el) {
    var dot = $('.role-dot', el);
    if (dot) dot.style.background = el.getAttribute('data-role-color');
  });

  // ───── Champs couleur (color input ↔ texte) ─────
  $$('[data-color-input]').forEach(function (input) {
    var text = input.parentElement && $('[data-color-text]', input.parentElement);
    if (!text) return;
    input.addEventListener('input', function () { text.value = input.value.toUpperCase(); });
    text.addEventListener('input', function () {
      var v = text.value.trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(v)) input.value = (v[0] === '#' ? v : '#' + v).toLowerCase();
    });
  });

  // ───── Afficher/masquer selon la valeur d'un select ─────
  $$('[data-toggle-target]').forEach(function (select) {
    var target = $(select.getAttribute('data-toggle-target'));
    var expected = select.getAttribute('data-toggle-value');
    if (!target) return;
    function sync() { target.hidden = select.value !== expected; }
    select.addEventListener('change', sync);
    sync();
  });
  // Case à cocher qui affiche / masque une cible ([data-check-toggle="#cible"], data-check-toggle-invert pour inverser)
  $$('[data-check-toggle], [data-check-hide]').forEach(function (box) {
    var show = box.hasAttribute('data-check-toggle') ? $$(box.getAttribute('data-check-toggle')) : [];
    var hide = box.hasAttribute('data-check-hide') ? $$(box.getAttribute('data-check-hide')) : [];
    var invert = box.hasAttribute('data-check-toggle-invert');
    if (!show.length && !hide.length) return;
    function sync() {
      show.forEach(function (t) { t.hidden = invert ? box.checked : !box.checked; });
      hide.forEach(function (t) { t.hidden = box.checked; });
    }
    box.addEventListener('change', sync);
    sync();
  });
  // Boutons radio qui affichent une cible ([data-radio-toggle="#cible"]) : les cibles des autres radios du groupe sont masquées
  $$('[data-radio-toggle]').forEach(function (radio) {
    var group = radio.name ? $$('input[type="radio"][name="' + radio.name + '"][data-radio-toggle]') : [radio];
    function sync() { group.forEach(function (r) { $$(r.getAttribute('data-radio-toggle')).forEach(function (t) { t.hidden = !r.checked; }); }); }
    radio.addEventListener('change', sync);
    sync();
  });
  // Pré-remplissage d'un formulaire ([data-fill-form="#form"] + data-set-<champ>="valeur")
  $$('[data-fill-form]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var form = $(btn.getAttribute('data-fill-form'));
      if (!form) return;
      Array.prototype.forEach.call(btn.attributes, function (attr) {
        if (attr.name.indexOf('data-set-') !== 0) return;
        var key = attr.name.slice(9).toLowerCase(); // les attributs HTML sont insensibles à la casse
        var field = Array.prototype.find.call(form.elements, function (el) { return (el.name || '').toLowerCase() === key; });
        if (!field) return;
        if (field.type === 'checkbox') field.checked = Boolean(attr.value);
        else field.value = attr.value;
      });
      var title = form.querySelector('[data-form-title]');
      if (title && btn.hasAttribute('data-form-title-text')) title.textContent = btn.getAttribute('data-form-title-text');
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var first = form.querySelector('input:not([type="hidden"]), select, textarea');
      if (first) first.focus();
    });
  });
  $$('[data-submit-on-change]').forEach(function (el) {
    el.addEventListener('change', function () { if (el.form) el.form.submit(); });
  });

  // ───── Modale de confirmation ─────
  var modal = $('#confirm-modal');
  var pendingConfirm = null;
  function openModal(text, onConfirm) {
    if (!modal) { if (window.confirm(text)) onConfirm(); return; }
    $('[data-modal-text]', modal).textContent = text;
    pendingConfirm = onConfirm;
    modal.hidden = false;
    var btn = $('[data-modal-confirm]', modal); if (btn) btn.focus();
  }
  function closeModal(confirmed) {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    var fn = pendingConfirm; pendingConfirm = null;
    if (confirmed && fn) fn();
  }
  if (modal) {
    $$('[data-modal-cancel]', modal).forEach(function (b) { b.addEventListener('click', function () { closeModal(false); }); });
    $('[data-modal-confirm]', modal).addEventListener('click', function () { closeModal(true); });
  }
  // Boutons / liens / formulaires avec data-confirm
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-confirm]');
    if (!el || el.hasAttribute('data-confirmed')) return;
    e.preventDefault();
    openModal(el.getAttribute('data-confirm') || 'Confirmer cette action ?', function () {
      el.setAttribute('data-confirmed', '1');
      if (el.tagName === 'A') { window.location.href = el.href; return; }
      if (el.tagName === 'FORM') { el.requestSubmit ? el.requestSubmit() : el.submit(); return; }
      if (el.form && el.type === 'submit') { el.form.requestSubmit ? el.form.requestSubmit(el) : el.click(); }
      else el.click();
      setTimeout(function () { el.removeAttribute('data-confirmed'); }, 0);
    });
  });
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.matches && form.matches('form[data-confirm]') && !form.hasAttribute('data-confirmed')) {
      e.preventDefault();
      openModal(form.getAttribute('data-confirm'), function () { form.setAttribute('data-confirmed', '1'); form.submit(); });
    }
  });

  // ───── Toggles de modules ─────
  function setModuleUi(key, enabled) {
    $$('[data-module-row="' + key + '"] [data-module-state]').forEach(function (s) { s.textContent = enabled ? '🟢' : '🔴'; });
    $$('[data-module-toggle="' + key + '"]').forEach(function (i) { i.checked = enabled; });
    $$('[data-module-chip="' + key + '"]').forEach(function (c) { c.classList.toggle('chip-on', enabled); c.classList.toggle('chip-off', !enabled); });
  }
  function setActiveCount(n) { if (n === null || n === undefined) return; $$('[data-stat="modules-active"]').forEach(function (el) { el.textContent = String(n); }); }
  $$('[data-module-toggle]').forEach(function (input) {
    input.addEventListener('change', function () {
      var key = input.getAttribute('data-module-toggle');
      var enabled = input.checked;
      var url = input.getAttribute('data-url') || ('/guilds/' + guildId + '/modules/' + key);
      input.disabled = true;
      api('POST', url, { enabled: enabled })
        .then(function (res) {
          setModuleUi(key, res.enabled);
          setActiveCount(res.active);
          toast('Module ' + (res.enabled ? 'activé' : 'désactivé') + '.', 'success');
        })
        .catch(function (err) {
          input.checked = !enabled;
          setModuleUi(key, !enabled);
          toast(err.message || 'Impossible de modifier le module.', 'error');
        })
        .then(function () { input.disabled = false; });
    });
  });

  // ───── Formulaires de traduction (amélioration progressive) ─────
  $$('[data-translation-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var submitter = e.submitter;
      var action = submitter && submitter.value === 'delete' ? 'delete' : 'save';
      if (action === 'delete') return; // passe par la modale + soumission classique
      e.preventDefault();
      var fd = new FormData(form);
      var payload = { _csrf: fd.get('_csrf'), lang: fd.get('lang'), key: fd.get('key'), value: fd.get('value'), _action: 'save' };
      api('POST', form.action, payload)
        .then(function (res) {
          var row = form.closest('[data-translation-row]');
          if (row) {
            row.classList.add('row-overridden');
            var state = $('.cell-state', row);
            if (state) state.innerHTML = '<span class="badge badge-primary">personnalisé</span>';
          }
          toast('Traduction enregistrée (' + res.key + ').', 'success');
        })
        .catch(function (err) { toast(err.message || 'Enregistrement impossible.', 'error'); });
    });
  });

  // ───── Socket.IO ─────
  if (window.io && body.classList.contains('has-sidebar')) {
    var socket = window.io({ withCredentials: true, transports: ['websocket', 'polling'] });
    socket.on('connect', function () {
      if (guildId) socket.emit('guild:join', guildId, function (res) { if (res && !res.ok) toast(res.error || 'Temps réel indisponible', 'warning'); });
    });
    socket.on('config:update', function (payload) {
      if (!payload || payload.guildId !== guildId) return;
      toast('Configuration mise à jour', 'info');
      if (payload.modules) Object.keys(payload.modules).forEach(function (k) { setModuleUi(k, Boolean(payload.modules[k])); });
      setActiveCount(payload.active);
      refreshOverview();
    });
    socket.on('log:new', function (payload) {
      if (!payload || payload.guildId !== guildId) return;
      refreshOverview();
    });
    // Événements des modules : toast + rechargement de la page concernée (sauf si un champ est en cours d'édition)
    var MODULE_EVENTS = {
      'ticket:open': ['tickets', 'Nouveau ticket ouvert'], 'ticket:close': ['tickets', 'Ticket fermé'], 'ticket:update': ['tickets', 'Tickets mis à jour'], 'ticket:type': ['tickets', 'Types de tickets mis à jour'],
      'embed:update': ['embeds', 'Templates d’embeds mis à jour'], 'announcement:update': ['announcements', 'Annonces mises à jour'], 'announcement:published': ['announcements', 'Annonce publiée'], 'announcement:scheduled': ['announcements', 'Annonce programmée'],
      'welcome:update': ['welcome', 'Configuration de bienvenue mise à jour'], 'roles:update': ['roles', 'Configuration des rôles mise à jour'],
      'moderation:update': ['moderation', 'Modération mise à jour'], 'moderation:sanction': ['moderation', 'Nouvelle sanction'], 'moderation:warning': ['moderation', 'Avertissements mis à jour'],
      'giveaway:start': ['giveaways', 'Giveaway lancé'], 'giveaway:end': ['giveaways', 'Giveaway mis à jour'], 'event:update': ['events', 'Événements mis à jour'],
    };
    var reloadTimer = null;
    socket.onAny(function (event, payload) {
      var def = MODULE_EVENTS[event];
      if (!def || !payload || payload.guildId !== guildId) return;
      var currentPage = body.getAttribute('data-page');
      var pageKey = def[0] === 'roles' && currentPage === 'reactionroles' ? 'reactionroles' : def[0];
      if (currentPage !== pageKey) { toast(def[1], 'info'); return; }
      var active = document.activeElement;
      var editing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
      var hasForm = Boolean($('form.form'));
      if (editing || hasForm) { toast(def[1] + ' — rechargez pour voir les changements.', 'info'); return; }
      toast(def[1] + ' — actualisation…', 'info', 1500);
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(function () { window.location.reload(); }, 1200);
    });
    socket.on('connect_error', function () { /* session absente : pas de temps réel */ });
  }

  var overviewTimer = null;
  function refreshOverview() {
    if (!guildId || !$('[data-stat]')) return;
    clearTimeout(overviewTimer);
    overviewTimer = setTimeout(function () {
      api('GET', '/api/guilds/' + guildId + '/overview')
        .then(function (o) {
          var map = { members: o.members, channels: o.channels, roles: o.roles, ping: o.pingMs >= 0 ? o.pingMs + ' ms' : '—', openTickets: o.counts.openTickets, activeWarnings: o.counts.activeWarnings, 'modules-active': o.modules.active };
          Object.keys(map).forEach(function (k) {
            $$('[data-stat="' + k + '"]').forEach(function (el) { el.textContent = typeof map[k] === 'number' ? map[k].toLocaleString('fr-FR') : String(map[k]); });
          });
          if (o.modules && o.modules.list) o.modules.list.forEach(function (m) { setModuleUi(m.key, m.enabled); });
        })
        .catch(function () { /* silencieux */ });
    }, 400);
  }
})();
