/* Sélecteurs de rôles et de salons (amélioration progressive).
 * Le <select> natif reste la source de vérité (soumis tel quel) : ce script le masque et construit une interface
 * avec recherche, pastilles de couleur (rôles), icônes de type et groupes par catégorie (salons).
 *   <select multiple data-role-picker>                 rôles (multi) — options avec data-color
 *   <select data-channel-picker data-kind="text">      salons (simple) — options avec data-type / data-name, <optgroup> = catégorie
 *   <select multiple data-multi>                       ancien multi-select des pages modules (amélioré automatiquement)
 * Événements émis sur le <select> : `change` et `picker:change` (bulles). data-max="N" limite le nombre de choix. */
(function () {
  'use strict';
  if (!window.UI) return;
  var UI = window.UI;
  var $ = UI.$, $$ = UI.$$, icon = UI.icon;
  var uid = 0;

  var TYPE_ICON = { text: 'hash', announcement: 'megaphone', voice: 'volume', stage: 'volume', forum: 'forum', category: 'folder' };

  function readOptions(select) {
    var out = [];
    Array.prototype.forEach.call(select.options, function (o) {
      var group = o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '';
      out.push({
        el: o,
        value: o.value,
        label: (o.getAttribute('data-name') || o.textContent || '').replace(/^(#|🔊|📣|💬|🗂)\s*/, '').replace(/ \(géré\)$/, '').trim(),
        color: o.getAttribute('data-color') || '',
        type: o.getAttribute('data-type') || '',
        managed: o.hasAttribute('data-managed'),
        group: group,
        disabled: o.disabled,
      });
    });
    return out;
  }

  function optionVisual(opt, kind) {
    if (kind === 'role') return '<span class="role-dot" data-color="' + escAttr(opt.color || '#a1a1aa') + '"></span>';
    if (kind === 'channel' && opt.value) return icon(TYPE_ICON[opt.type] || 'hash', 16);
    return '';
  }
  function escAttr(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function init(select) {
    if (select.hasAttribute('data-picker-ready')) return;
    var multi = select.multiple;
    var options = readOptions(select);
    var kind = select.hasAttribute('data-role-picker') || options.some(function (o) { return o.color; }) ? 'role' : select.hasAttribute('data-channel-picker') || options.some(function (o) { return o.type; }) ? 'channel' : 'plain';
    var max = parseInt(select.getAttribute('data-max') || '0', 10) || 0;
    var placeholder = select.getAttribute('data-placeholder') || (multi ? (kind === 'role' ? 'Ajouter des rôles…' : 'Ajouter…') : (kind === 'channel' ? 'Choisir un salon…' : 'Choisir…'));
    select.setAttribute('data-picker-ready', '1');
    select.classList.add('picker-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    var id = 'picker-' + (++uid);
    var wrap = document.createElement('div');
    wrap.className = 'picker' + (multi ? ' is-multi' : ' is-single') + ' picker-' + kind;
    wrap.innerHTML = '<div class="picker-control"><span class="picker-chips"></span><input type="text" class="picker-search" id="' + id + '-input" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' + id + '-menu" autocomplete="off" spellcheck="false"><span class="picker-caret">' + icon('chevron-down', 16) + '</span></div><div class="picker-menu" id="' + id + '-menu" role="listbox"' + (multi ? ' aria-multiselectable="true"' : '') + ' hidden></div>';
    // Le <select> natif est déplacé dans le conteneur : celui-ci prend sa place dans la mise en page (grilles, lignes)
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    var control = $('.picker-control', wrap);
    var chips = $('.picker-chips', wrap);
    var search = $('.picker-search', wrap);
    var menu = $('.picker-menu', wrap);
    search.placeholder = placeholder;
    if (select.id) {
      $$('label[for="' + select.id + '"]').forEach(function (l) { l.htmlFor = search.id; });
      var describedBy = select.getAttribute('aria-describedby');
      if (describedBy) search.setAttribute('aria-describedby', describedBy);
    }
    if (select.required) search.setAttribute('aria-required', 'true');
    var activeIndex = -1;
    var visible = [];

    function selected() { return options.filter(function (o) { return o.value && o.el.selected; }); }
    function emit() {
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.dispatchEvent(new CustomEvent('picker:change', { bubbles: true }));
    }
    function renderControl() {
      var sel = selected();
      if (multi) {
        chips.innerHTML = sel.map(function (o) {
          return '<span class="picker-chip" data-value="' + escAttr(o.value) + '">' + optionVisual(o, kind) + '<span class="picker-chip-text">' + escAttr(o.label) + '</span><button type="button" class="picker-chip-remove" aria-label="Retirer ' + escAttr(o.label) + '">' + icon('x', 12) + '</button></span>';
        }).join('');
        search.placeholder = sel.length ? '' : placeholder;
      } else {
        var o = sel[0];
        chips.innerHTML = '<span class="picker-value">' + (o ? optionVisual(o, kind) + '<span class="picker-value-text">' + escAttr(o.label) + '</span>' + (o.group ? '<span class="picker-value-parent">' + escAttr(o.group) + '</span>' : '') : '<span class="picker-placeholder">' + escAttr(placeholder) + '</span>') + '</span>';
      }
      UI.paint(wrap);
    }
    function renderMenu() {
      var q = search.value.trim().toLowerCase();
      visible = options.filter(function (o) {
        if (o.disabled) return false;
        if (multi && !o.value) return false;
        return !q || o.label.toLowerCase().indexOf(q) !== -1 || (o.group && o.group.toLowerCase().indexOf(q) !== -1);
      });
      if (!visible.length) { menu.innerHTML = '<div class="picker-empty">Aucun résultat</div>'; activeIndex = -1; return; }
      var html = '';
      var lastGroup = null;
      visible.forEach(function (o, i) {
        if (kind === 'channel' && o.group !== lastGroup && o.value) {
          lastGroup = o.group;
          html += '<div class="picker-group" role="presentation">' + (o.group ? icon('folder', 13) + escAttr(o.group) : 'Sans catégorie') + '</div>';
        }
        var label = o.value ? escAttr(o.label) : '<span class="text-3">' + escAttr(o.label || 'Aucun') + '</span>';
        html += '<div class="picker-option' + (i === activeIndex ? ' is-active' : '') + '" role="option" id="' + id + '-opt-' + i + '" data-index="' + i + '" aria-selected="' + (o.el.selected && o.value ? 'true' : 'false') + '">' + optionVisual(o, kind) + '<span class="picker-option-text">' + label + '</span>' + (o.managed ? '<span class="picker-option-meta">géré</span>' : '') + '</div>';
      });
      menu.innerHTML = html;
      UI.paint(menu);
      var act = $('.picker-option.is-active', menu);
      if (act) { act.scrollIntoView({ block: 'nearest' }); search.setAttribute('aria-activedescendant', act.id); }
    }
    function open() {
      if (wrap.classList.contains('is-open')) return;
      closeOthers(wrap);
      wrap.classList.add('is-open');
      menu.hidden = false;
      search.setAttribute('aria-expanded', 'true');
      var rect = control.getBoundingClientRect();
      wrap.classList.toggle('drop-up', window.innerHeight - rect.bottom < 280 && rect.top > 320);
      activeIndex = -1;
      renderMenu();
    }
    function close() {
      if (!wrap.classList.contains('is-open')) return;
      wrap.classList.remove('is-open');
      menu.hidden = true;
      search.setAttribute('aria-expanded', 'false');
      search.removeAttribute('aria-activedescendant');
      search.value = '';
    }
    function choose(o) {
      if (!o) return;
      if (multi) {
        if (!o.el.selected && max && selected().length >= max) { UI.toast('Maximum ' + max + ' éléments.', 'warning', 2500); return; }
        o.el.selected = !o.el.selected;
        search.value = '';
        renderControl(); renderMenu(); emit();
        search.focus();
      } else {
        options.forEach(function (x) { x.el.selected = x === o; });
        select.value = o.value;
        renderControl(); emit(); close();
        search.focus();
      }
    }
    on(control, 'mousedown', function (e) {
      if (e.target.closest('.picker-chip-remove')) return;
      e.preventDefault();
      if (wrap.classList.contains('is-open') && !multi) close(); else { open(); search.focus(); }
    });
    on(chips, 'click', function (e) {
      var rm = e.target.closest('.picker-chip-remove');
      if (!rm) return;
      var v = rm.closest('.picker-chip').getAttribute('data-value');
      options.forEach(function (o) { if (o.value === v) o.el.selected = false; });
      renderControl(); if (wrap.classList.contains('is-open')) renderMenu(); emit();
    });
    on(menu, 'mousedown', function (e) { e.preventDefault(); });
    on(menu, 'click', function (e) {
      var opt = e.target.closest('.picker-option');
      if (opt) choose(visible[Number(opt.getAttribute('data-index'))]);
    });
    on(search, 'focus', function () { if (multi) open(); });
    on(search, 'input', function () { if (!wrap.classList.contains('is-open')) open(); activeIndex = 0; renderMenu(); });
    on(search, 'blur', function () { setTimeout(function () { if (!wrap.contains(document.activeElement)) close(); }, 120); });
    on(search, 'keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!wrap.classList.contains('is-open')) { open(); return; }
        if (!visible.length) return;
        activeIndex = e.key === 'ArrowDown' ? (activeIndex + 1) % visible.length : (activeIndex - 1 + visible.length) % visible.length;
        renderMenu();
      } else if (e.key === 'Enter') {
        if (wrap.classList.contains('is-open')) { e.preventDefault(); if (activeIndex >= 0) choose(visible[activeIndex]); }
      } else if (e.key === 'Escape') {
        if (wrap.classList.contains('is-open')) { e.stopPropagation(); close(); }
      } else if (e.key === 'Backspace' && multi && !search.value) {
        var sel = selected();
        if (sel.length) { sel[sel.length - 1].el.selected = false; renderControl(); renderMenu(); emit(); }
      } else if (e.key === ' ' && !multi && !wrap.classList.contains('is-open')) {
        e.preventDefault(); open();
      }
    });
    // Synchronisation si le <select> change ailleurs (reset, script)
    on(select, 'change', function () { renderControl(); });
    var form = select.form;
    if (form) on(form, 'reset', function () { setTimeout(function () { renderControl(); }, 0); });
    wrap.__picker = { open: open, close: close, refresh: function () { options = readOptions(select); renderControl(); } };
    select.__picker = wrap.__picker;
    renderControl();
  }

  function on(el, ev, fn) { el.addEventListener(ev, fn); }
  function closeOthers(except) { $$('.picker.is-open').forEach(function (p) { if (p !== except && p.__picker) p.__picker.close(); }); }
  document.addEventListener('mousedown', function (e) { if (!e.target.closest('.picker')) closeOthers(null); });

  UI.onEnhance(function (root) {
    $$('select[data-role-picker], select[data-channel-picker], select[multiple][data-multi]', root).forEach(function (s) {
      if (s.closest('template')) return;
      init(s);
    });
  });
  window.Pickers = { init: init };
})();
