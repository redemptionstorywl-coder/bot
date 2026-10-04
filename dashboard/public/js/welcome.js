/* Bienvenue / départ : aperçu Discord live (message, image, embed, boutons, DM) + aperçu réel de l'image générée. */
(function () {
  'use strict';
  var UI = window.UI, D = window.DiscordPreview;
  var form = document.getElementById('welcome-form');
  if (!UI || !D || !form) return;
  var $ = UI.$, $$ = UI.$$;
  var data = {};
  try { data = JSON.parse(($('#welcome-data') || {}).textContent || '{}'); } catch (e) { data = {}; }
  var texts = data.texts || {};
  var kind = form.getAttribute('data-welcome-kind') || 'welcome';
  var g = UI.guildData() || {};
  var me = g.user || { id: '0', name: 'Membre', username: 'membre' };
  var host = $('[data-welcome-preview]');
  var dmHost = $('[data-dm-preview]');
  var dmPanel = $('[data-dm-panel]');
  var editor = $('[data-embed-editor]', form);
  var generated = null;

  function val(name) { var el = form.elements.namedItem(name); if (!el) return ''; if (el instanceof RadioNodeList) return el.value || ''; return typeof el.value === 'string' ? el.value.trim() : ''; }
  function on(name) { var el = form.elements.namedItem(name); return Boolean(el && el.checked); }
  function vars() {
    var now = new Date();
    return {
      user: '<@' + me.id + '>', username: me.username || me.name, displayName: me.name, tag: '@' + (me.username || me.name), userId: me.id,
      server: g.name || '', memberCount: g.memberCount || '', avatar: me.avatarUrl || '', language: '',
      createdAt: '<t:' + Math.floor(now.getTime() / 1000 - 400 * 86400) + ':D>', joinedAt: '<t:' + Math.floor(now.getTime() / 1000) + ':D>',
      date: now.toLocaleDateString('fr-FR'), time: now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    };
  }
  function parseJson(name) { try { var v = val(name); return v ? JSON.parse(v) : null; } catch (e) { return null; } }

  function render() {
    var v = vars();
    var mode = val('embedMode') || 'none';
    var spec = null;
    if (mode === 'form' && editor && editor.embedEditor) spec = editor.embedEditor.read();
    else if (mode === 'json') spec = parseJson('embedJson');
    if (spec && !D.hasEmbedContent(spec)) spec = null;
    if (spec) spec = D.applyVarsDeep(spec, v);
    var content = val('message') ? D.applyVars(val('message'), v) : '';
    if (!content && !spec) content = D.applyVars(kind === 'leave' ? texts.defaultLeave : texts.defaultWelcome, v);
    var imageOn = on('imageEnabled');
    var mock = kind === 'leave'
      ? { title: texts.leaveImageTitle || 'AU REVOIR', subtitle: D.applyVars(texts.leaveImageSubtitle || '', v) }
      : { title: D.applyVars(val('imageTitle') || 'BIENVENUE', v), subtitle: D.applyVars(val('imageSubtitle'), v) };
    var attachments = [];
    if (imageOn) {
      if (spec && !spec.image) { if (generated) spec.image = generated; else spec.imageMock = mock; }
      else if (!spec) attachments.push(generated ? { url: generated, name: 'welcome.png' } : { mock: mock });
    }
    var buttons = kind === 'welcome' && editor && editor.embedEditor ? editor.embedEditor.readButtons() : [];
    if (host) { host.innerHTML = D.render({ content: content, embed: spec, attachments: attachments, buttons: buttons }, UI.previewContext()); UI.paint(host); }
    var sel = form.elements.namedItem('channelId');
    var opt = sel && sel.selectedOptions && sel.selectedOptions[0];
    $$('[data-preview-channel]').forEach(function (el) { el.textContent = opt && opt.value ? (opt.getAttribute('data-name') || opt.textContent) : 'salon'; });
    if (dmPanel) {
      var dmOn = on('dmEnabled');
      dmPanel.hidden = !dmOn;
      if (dmOn && dmHost) {
        var dmSpec = parseJson('dmEmbedJson');
        dmHost.innerHTML = D.render({ content: D.applyVars(val('dmMessage'), v), embed: dmSpec ? D.applyVarsDeep(dmSpec, v) : null, emptyText: 'Message privé vide.' }, UI.previewContext());
        UI.paint(dmHost);
      }
    }
  }

  // Aperçu réel de l'image (PNG généré côté serveur, renvoyé en data URL)
  $$('[data-image-preview]', form).forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.classList.add('is-loading');
      UI.api('POST', data.imageUrl, { kind: btn.getAttribute('data-image-preview'), title: val('imageTitle'), subtitle: val('imageSubtitle'), backgroundUrl: val('imageBackgroundUrl') })
        .then(function (res) { generated = res && res.dataUrl ? res.dataUrl : null; render(); UI.toast('Aperçu de l’image généré.', 'success', 2000); })
        .catch(function (err) { UI.toast(err.message || 'Génération impossible.', 'error'); })
        .then(function () { btn.classList.remove('is-loading'); });
    });
  });
  ['imageTitle', 'imageSubtitle', 'imageBackgroundUrl'].forEach(function (n) {
    var el = form.elements.namedItem(n);
    if (el) el.addEventListener('input', function () { generated = null; });
  });

  var raf = 0;
  function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }
  ['input', 'change', 'repeater:change', 'picker:change', 'embed:change'].forEach(function (ev) { form.addEventListener(ev, schedule); });
  render();
})();
