/* Listes dynamiques (champs d'embed, boutons, questions, seuils, options…).
   Un conteneur [data-repeater] contient des lignes [data-repeater-row] dont les champs portent `data-field`
   (texte, nombre, select, case à cocher, radio). À chaque changement, la liste est sérialisée en JSON dans l'input
   désigné par `data-repeater-json`. Boutons : [data-repeater-add], [data-repeater-remove], [data-repeater-up], [data-repeater-down] ;
   poignée de glisser-déposer : [data-repeater-handle] ; data-repeater-require="champ" ignore les lignes sans ce champ. Événement émis sur le conteneur : `repeater:change` (detail = tableau). */
(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var uid = 0;

  function readRow(row) {
    var out = {};
    $$('[data-field]', row).forEach(function (input) {
      var key = input.getAttribute('data-field');
      if (input.type === 'checkbox') { out[key] = input.checked; return; }
      if (input.type === 'radio') { if (input.checked) out[key] = input.value; return; }
      var v = (input.value || '').trim();
      if (v === '') return;
      if (input.type === 'number') { var num = Number(v); if (!isNaN(num)) out[key] = num; return; }
      out[key] = v;
    });
    return out;
  }

  function fillRow(row, data) {
    if (!data) return;
    $$('[data-field]', row).forEach(function (input) {
      var key = input.getAttribute('data-field');
      var v = data[key];
      if (input.type === 'checkbox') { input.checked = Boolean(v); return; }
      if (input.type === 'radio') { if (v !== undefined) input.checked = String(v) === input.value; return; }
      if (key === 'durationMinutes' && v === undefined && typeof data.duration === 'number') v = Math.round(data.duration / 60);
      input.value = v === undefined || v === null ? '' : String(v);
    });
  }

  /** Les radios d'une ligne forment un groupe propre à la ligne (nom unique). */
  function isolateRadios(row) {
    var names = {};
    $$('input[type="radio"][data-field]', row).forEach(function (r) {
      var f = r.getAttribute('data-field');
      if (!names[f]) names[f] = 'rep-' + (++uid) + '-' + f;
      r.name = names[f];
    });
  }

  /** Ligne « bouton » : l'URL n'a de sens que pour le style Lien, l'identifiant interne pour les autres. */
  function syncButtonRow(row) {
    var style = $('[data-button-style]', row);
    if (!style) return;
    var isLink = style.value === 'link';
    var url = $('[data-field="url"]', row), cid = $('[data-field="customId"]', row);
    if (url) url.hidden = !isLink;
    if (cid) cid.hidden = isLink;
  }

  function isEmptyRow(data) {
    return Object.keys(data).every(function (k) { return data[k] === false || data[k] === '' || data[k] === undefined; });
  }

  function setup(container) {
    if (container.repeater) return;
    var rowsHost = $('[data-repeater-rows]', container);
    var template = $('template[data-repeater-template]', container);
    var target = $(container.getAttribute('data-repeater-json') || '');
    var max = parseInt(container.getAttribute('data-repeater-max') || '25', 10) || 25;
    var keepEmpty = container.hasAttribute('data-repeater-keep-empty');
    var requiredField = container.getAttribute('data-repeater-require');
    var addBtn = $('[data-repeater-add]', container);
    var counter = $('[data-repeater-count]', container);
    if (!rowsHost || !template) return;

    function rows() { return $$('[data-repeater-row]', rowsHost); }
    function read() {
      return rows().map(readRow).filter(function (d) {
        if (requiredField && !d[requiredField]) return false;
        return keepEmpty || !isEmptyRow(d);
      });
    }
    function serialize() {
      var list = read();
      if (target) target.value = JSON.stringify(list);
      if (counter) counter.textContent = rows().length + ' / ' + max;
      if (addBtn) addBtn.disabled = rows().length >= max;
      $$('[data-repeater-index]', rowsHost).forEach(function (el, i) { el.textContent = String(i + 1); });
      container.dispatchEvent(new CustomEvent('repeater:change', { bubbles: true, detail: list }));
      return list;
    }
    function addRow(data) {
      if (rows().length >= max) return null;
      var frag = template.content.cloneNode(true);
      var row = $('[data-repeater-row]', frag);
      isolateRadios(row);
      fillRow(row, data);
      syncButtonRow(row);
      rowsHost.appendChild(frag);
      if (window.UI) window.UI.enhance(row);
      serialize();
      return row;
    }
    function setRows(list) {
      rowsHost.innerHTML = '';
      (list || []).slice(0, max).forEach(function (d) { addRow(d); });
      serialize();
    }

    rows().forEach(function (r) { isolateRadios(r); syncButtonRow(r); });
    container.addEventListener('input', serialize);
    container.addEventListener('change', function (e) {
      if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-button-style')) syncButtonRow(e.target.closest('[data-repeater-row]'));
      serialize();
    });
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn || !container.contains(btn)) return;
      if (btn.hasAttribute('data-repeater-add')) { e.preventDefault(); var r = addRow(null); var first = r && $('[data-field]', r); if (first) first.focus(); return; }
      var row = btn.closest('[data-repeater-row]');
      if (!row) return;
      if (btn.hasAttribute('data-repeater-remove')) { e.preventDefault(); row.remove(); serialize(); }
      else if (btn.hasAttribute('data-repeater-up')) { e.preventDefault(); if (row.previousElementSibling) rowsHost.insertBefore(row, row.previousElementSibling); serialize(); btn.focus(); }
      else if (btn.hasAttribute('data-repeater-down')) { e.preventDefault(); if (row.nextElementSibling) rowsHost.insertBefore(row.nextElementSibling, row); serialize(); btn.focus(); }
    });
    if (window.UI && $('[data-repeater-handle]', container.querySelector('template') ? template.content : container)) {
      window.UI.sortable(rowsHost, { item: '[data-repeater-row]', handle: '[data-repeater-handle]', onChange: serialize });
    }

    container.repeater = { serialize: serialize, addRow: addRow, setRows: setRows, read: read };
    serialize();
  }

  $$('[data-repeater]').forEach(setup);
  window.setupRepeater = setup;
})();
