/* Paramètres : aperçu live de la couleur de marque et du pied de page des embeds. */
(function () {
  'use strict';
  var UI = window.UI, D = window.DiscordPreview;
  var host = document.querySelector('[data-settings-preview]');
  var form = document.getElementById('settings-form');
  if (!UI || !D || !host || !form) return;
  var g = UI.guildData() || {};
  function val(name) { var el = form.elements.namedItem(name); return el && typeof el.value === 'string' ? el.value.trim() : ''; }
  function render() {
    var color = val('brandColor');
    var footer = val('footerText') || 'Redemption Story Studio';
    var icon = val('footerIconUrl');
    var name = val('displayName') || g.name || 'votre serveur';
    var embed = { title: 'Exemple d’annonce', description: 'Voici à quoi ressemblent les **embeds** envoyés par le bot sur *' + name + '*.', color: /^#?[0-9a-fA-F]{6}$/.test(color) ? color : undefined, footer: { text: footer, iconUrl: icon || undefined }, timestamp: true };
    host.innerHTML = D.render({ embed: embed }, UI.previewContext());
    UI.paint(host);
  }
  form.addEventListener('input', render);
  form.addEventListener('change', render);
})();
