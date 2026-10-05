/* Salons vocaux temporaires : langues proposées (remplissage du drapeau et du modèle) et aperçu live des noms de salons.
 * Les règles de nommage reprennent celles de src/services/TempVoiceService.ts (pseudo nettoyé, 32 caractères, nom ≤ 100).
 * Données serveur : <script type="application/json" id="vocal-data"> ({ presets, sampleName }). */
(function () {
  'use strict';
  var UI = window.UI;
  if (!UI) return;
  var $ = UI.$, $$ = UI.$$;
  var form = $('#vocal-form');
  if (!form) return;

  var data = {};
  try { data = JSON.parse(($('#vocal-data') || {}).textContent || '{}'); } catch (e) { data = {}; }
  var presets = data.presets || [];
  var g = UI.guildData() || {};
  var roles = {};
  (g.roles || []).forEach(function (r) { roles[r.id] = r; });

  var NAME_TOKEN = '{name}';
  var CHANNEL_NAME_MAX = 100;
  var MEMBER_NAME_MAX = 32;

  function presetFor(key) {
    for (var i = 0; i < presets.length; i++) if (presets[i].key === key) return presets[i];
    return null;
  }

  function truncateUnits(s, max) {
    if (s.length <= max) return s;
    var out = '';
    var chars = Array.from(s);
    for (var i = 0; i < chars.length; i++) {
      if (out.length + chars[i].length > max - 1) break;
      out += chars[i];
    }
    return out.replace(/\s+$/, '') + '…';
  }

  function sanitize(raw) {
    var s = String(raw || '').normalize('NFC')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .replace(/[­​-‏‪-‮⁠-⁯﻿]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return truncateUnits(s, MEMBER_NAME_MAX);
  }

  function buildName(emoji, template, name) {
    var tpl = String(template || '').trim();
    if (!tpl) return '';
    if (tpl.indexOf(NAME_TOKEN) === -1) tpl = tpl + ' ' + NAME_TOKEN;
    var e = String(emoji || '').trim();
    var base = ((e ? e + ' ' : '') + tpl).replace(/\s+/g, ' ').trim();
    var parts = base.split(NAME_TOKEN);
    var occurrences = parts.length - 1;
    var fixed = base.length - occurrences * NAME_TOKEN.length;
    var perName = Math.max(1, Math.floor((CHANNEL_NAME_MAX - fixed) / Math.max(1, occurrences)));
    var safe = truncateUnits(name || '?', Math.min(perName, MEMBER_NAME_MAX));
    return truncateUnits(parts.join(safe).replace(/\s+/g, ' ').trim(), CHANNEL_NAME_MAX);
  }

  function parts(row) {
    return {
      preset: $('[data-voice-preset]', row),
      emoji: $('[data-field="emoji"], [data-voice-emoji]', row),
      template: $('[data-field="template"], [data-voice-template]', row),
      role: $('[data-field="roleId"]', row),
      preview: $('[data-voice-preview]', row),
    };
  }

  function sampleName() {
    var el = $('[data-voice-sample]');
    return sanitize(el && el.value) || data.sampleName || 'Alex';
  }

  function fire(el) { el.dispatchEvent(new Event('input', { bubbles: true })); }

  /** Langue choisie : drapeau et modèle de la langue (puis l'utilisateur peut les modifier). */
  function applyPreset(select) {
    var p = presetFor(select.value);
    var row = select.closest('[data-voice-rule], [data-voice-fallback]');
    if (!p || !row) return;
    var f = parts(row);
    if (f.emoji) { f.emoji.value = p.emoji; fire(f.emoji); }
    if (f.template) { f.template.value = p.template; fire(f.template); }
  }

  /** Drapeau ou modèle modifié à la main : la règle devient « Personnalisé ». */
  function markCustom(input) {
    var row = input.closest('[data-voice-rule], [data-voice-fallback]');
    if (!row) return;
    var f = parts(row);
    if (!f.preset) return;
    var p = presetFor(f.preset.value);
    if (p && (f.emoji.value.trim() !== p.emoji || f.template.value.trim() !== p.template)) {
      f.preset.value = 'custom';
      f.preset.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function row(name, meta) {
    var el = document.createElement('div');
    el.className = 'dchannel-row';
    el.innerHTML = UI.icon('volume', 18);
    var label = document.createElement('span');
    label.textContent = name;
    el.appendChild(label);
    if (meta) {
      var m = document.createElement('span');
      m.className = 'dchannel-meta';
      m.textContent = meta;
      el.appendChild(m);
    }
    return el;
  }

  function refresh() {
    var name = sampleName();
    var items = [];
    $$('[data-voice-rule]', form).forEach(function (r) {
      var f = parts(r);
      var valid = f.template && f.template.value.indexOf(NAME_TOKEN) !== -1;
      var n = buildName(f.emoji && f.emoji.value, f.template && f.template.value, name);
      if (f.preview) f.preview.textContent = !f.template.value.trim() ? '—' : valid ? n : 'Le modèle doit contenir {name}';
      if (f.role && f.role.value && n) items.push({ name: n, meta: roles[f.role.value] ? '@' + roles[f.role.value].name : '' });
    });
    var fb = $('[data-voice-fallback]', form);
    if (fb) {
      var f = parts(fb);
      var n = buildName(f.emoji && f.emoji.value, f.template && f.template.value, name);
      if (f.preview) f.preview.textContent = n || '—';
      if (n) items.push({ name: n, meta: 'Autres membres' });
    }
    var host = $('[data-voice-list-items]');
    if (!host) return;
    host.textContent = '';
    items.forEach(function (it) { host.appendChild(row(it.name, it.meta)); });
  }

  form.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-voice-preset')) applyPreset(t);
    refresh();
  });
  form.addEventListener('input', function (e) {
    var t = e.target;
    if (e.isTrusted && t && t.matches && t.matches('[data-field="emoji"], [data-field="template"], [data-voice-emoji], [data-voice-template]')) markCustom(t);
    refresh();
  });
  form.addEventListener('repeater:change', refresh);
  refresh();
})();
