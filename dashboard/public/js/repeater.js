/* Listes dynamiques (champs d'embed, boutons, questions, seuils, options…).
   Un conteneur [data-repeater] contient des lignes [data-repeater-row] dont les inputs portent `data-field`.
   À chaque changement, la liste est sérialisée en JSON dans l'input désigné par `data-repeater-json`.
   Événement émis sur le conteneur : `repeater:change` (detail = tableau sérialisé). */
(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function readRow(row) {
    var out = {};
    $$('[data-field]', row).forEach(function (input) {
      var key = input.getAttribute('data-field');
      if (input.type === 'checkbox') { out[key] = input.checked; return; }
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
      if (key === 'durationMinutes' && v === undefined && typeof data.duration === 'number') v = Math.round(data.duration / 60);
      input.value = v === undefined || v === null ? '' : String(v);
    });
  }

  function isEmptyRow(data) {
    return Object.keys(data).every(function (k) { return data[k] === false || data[k] === '' || data[k] === undefined; });
  }

  function setup(container) {
    var rowsHost = $('[data-repeater-rows]', container);
    var template = $('template[data-repeater-template]', container);
    var target = $(container.getAttribute('data-repeater-json') || '');
    var max = parseInt(container.getAttribute('data-repeater-max') || '25', 10) || 25;
    var addBtn = $('[data-repeater-add]', container);
    var counter = $('[data-repeater-count]', container);
    if (!rowsHost || !template) return;

    function rows() { return $$('[data-repeater-row]', rowsHost); }
    function serialize() {
      var list = rows().map(readRow).filter(function (d) { return !isEmptyRow(d); });
      if (target) target.value = JSON.stringify(list);
      if (counter) counter.textContent = rows().length + ' / ' + max;
      if (addBtn) addBtn.disabled = rows().length >= max;
      container.dispatchEvent(new CustomEvent('repeater:change', { bubbles: true, detail: list }));
      return list;
    }
    function addRow(data) {
      if (rows().length >= max) return null;
      var frag = template.content.cloneNode(true);
      var row = $('[data-repeater-row]', frag);
      fillRow(row, data);
      rowsHost.appendChild(frag);
      serialize();
      return row;
    }
    function setRows(list) {
      rowsHost.innerHTML = '';
      (list || []).slice(0, max).forEach(function (d) { addRow(d); });
      serialize();
    }

    container.addEventListener('input', serialize);
    container.addEventListener('change', serialize);
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn || !container.contains(btn)) return;
      if (btn.hasAttribute('data-repeater-add')) { e.preventDefault(); var r = addRow(null); var first = r && $('[data-field]', r); if (first) first.focus(); return; }
      var row = btn.closest('[data-repeater-row]');
      if (!row) return;
      if (btn.hasAttribute('data-repeater-remove')) { e.preventDefault(); row.remove(); serialize(); }
      else if (btn.hasAttribute('data-repeater-up')) { e.preventDefault(); if (row.previousElementSibling) rowsHost.insertBefore(row, row.previousElementSibling); serialize(); }
      else if (btn.hasAttribute('data-repeater-down')) { e.preventDefault(); if (row.nextElementSibling) rowsHost.insertBefore(row.nextElementSibling, row); serialize(); }
    });

    container.repeater = { serialize: serialize, addRow: addRow, setRows: setRows, read: function () { return rows().map(readRow).filter(function (d) { return !isEmptyRow(d); }); } };
    serialize();
  }

  $$('[data-repeater]').forEach(setup);
  window.setupRepeater = setup;
})();
