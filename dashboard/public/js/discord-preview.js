/*
 * Rendu d'aperçus façon Discord (thème sombre) — UNE seule implémentation partagée :
 *  - navigateur : window.DiscordPreview (aperçus live : éditeur d'embed, tickets, panneaux…)
 *  - serveur    : require('dashboard/public/js/discord-preview.js') via dashboard/lib/discordPreview.ts
 *    (partials/embed-preview.ejs), ce qui garantit un balisage identique côté serveur et client.
 * Aucune API DOM ici : uniquement des chaînes. Les couleurs dynamiques (bordure d'embed, couleur de rôle)
 * sont posées en JS via data-embed-color / data-role-color (CSP : aucun style inline).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiscordPreview = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CDN_IMAGE = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//;
  var DATA_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  /** Horodatage de pied d'embed : `true` = maintenant ; date ISO / ms = « Aujourd'hui à », « Hier à », « Demain à » ou JJ/MM/AAAA. */
  function footerDate(ts, now) {
    var d = ts === true ? now : new Date(ts);
    if (isNaN(d.getTime())) d = now;
    var day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((day(d) - day(now)) / 86400000);
    if (diff === 0) return "Aujourd'hui à " + hhmm(d);
    if (diff === -1) return 'Hier à ' + hhmm(d);
    if (diff === 1) return 'Demain à ' + hhmm(d);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + hhmm(d);
  }
  /** Images affichables sous la CSP du dashboard : CDN Discord ou data:image (aperçus générés). */
  function isImageAllowed(u) { return typeof u === 'string' && (CDN_IMAGE.test(u) || DATA_IMAGE.test(u)); }
  function imageMock(m) {
    return '<div class="dimg-mock"><span class="dimg-mock-avatar"></span><span class="dimg-mock-title">' + esc(m.title || '') + '</span>' + (m.subtitle ? '<span class="dimg-mock-sub">' + esc(m.subtitle) + '</span>' : '') + '</div>';
  }
  function hostOf(u) { var m = /^https?:\/\/([^/?#]+)/i.exec(String(u || '')); return m ? m[1] : String(u || ''); }

  var ICONS = {
    check: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    chevron: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    external: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
    image: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
    eye: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>',
    close: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    logo: '<svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M10 23V9h6.2c3.1 0 5 1.7 5 4.3 0 1.9-1 3.2-2.7 3.8L22 23h-3.4l-3-5.3h-2.5V23H10Zm3.1-7.8h2.8c1.5 0 2.3-.7 2.3-1.9s-.8-1.9-2.3-1.9h-2.8v3.8Z" fill="#F5F5F7"/></svg>',
  };

  // ───── Contexte (mentions, bot, couleur) ─────

  /** Contexte depuis une vue de serveur (GuildView côté serveur ou #guild-data côté client). */
  function contextFromGuild(guild, bot, extra) {
    var ctx = { roles: {}, channels: {}, users: {}, botName: 'Redemption Story', botAvatarUrl: null, defaultColor: '#7C3AED' };
    if (guild) {
      (guild.roles || []).forEach(function (r) { ctx.roles[r.id] = { name: r.name, color: r.color }; });
      [].concat(guild.channels || [], guild.textChannels || [], guild.voiceChannels || [], guild.categories || []).forEach(function (c) { if (c && c.id) ctx.channels[c.id] = c.name; });
      if (guild.brandColor) ctx.defaultColor = guild.brandColor;
    }
    if (bot) { ctx.botName = bot.username || bot.name || ctx.botName; ctx.botAvatarUrl = bot.avatarUrl || null; }
    if (extra) Object.keys(extra).forEach(function (k) { if (extra[k] !== undefined && extra[k] !== null) ctx[k] = extra[k]; });
    return ctx;
  }

  // ───── Markdown Discord ─────

  function formatTimestamp(seconds, style) {
    var d = new Date(Number(seconds) * 1000);
    if (isNaN(d.getTime())) return null;
    var date = d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    switch (style) {
      case 't': return hhmm(d);
      case 'T': return hhmm(d) + ':' + pad(d.getSeconds());
      case 'd': return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
      case 'D': return date;
      case 'F': return DAYS[d.getDay()] + ' ' + date + ' ' + hhmm(d);
      case 'R': {
        var diff = Math.round((d.getTime() - Date.now()) / 1000);
        var abs = Math.abs(diff);
        var units = [[60, 'seconde', 1], [3600, 'minute', 60], [86400, 'heure', 3600], [2592000, 'jour', 86400], [31536000, 'mois', 2592000], [Infinity, 'an', 31536000]];
        for (var i = 0; i < units.length; i++) {
          if (abs < units[i][0]) {
            var v = Math.max(1, Math.round(abs / units[i][2]));
            var label = units[i][1] + (v > 1 && units[i][1] !== 'mois' ? 's' : '');
            return diff < 0 ? 'il y a ' + v + ' ' + label : 'dans ' + v + ' ' + label;
          }
        }
        return date;
      }
      default: return date + ' ' + hhmm(d);
    }
  }

  function customEmoji(animated, name, id) {
    return '<img class="demoji" src="https://cdn.discordapp.com/emojis/' + id + '.' + (animated ? 'gif' : 'webp') + '?size=48" alt=":' + name + ':" title=":' + name + ':">';
  }

  /** Mise en forme « inline » d'un texte DÉJÀ échappé (pas de blocs). */
  function inline(s, ctx) {
    var tokens = [];
    function keep(html) { tokens.push(html); return '\u0000' + (tokens.length - 1) + '\u0000'; }
    // Code inline (protégé)
    s = s.replace(/``([^`]+?)``|`([^`\n]+?)`/g, function (_m, a, b) { return keep('<code class="dcode">' + (a || b) + '</code>'); });
    // Emojis personnalisés <:nom:id> / <a:nom:id>
    s = s.replace(/&lt;(a?):(\w{2,32}):(\d{15,22})&gt;/g, function (_m, a, n, id) { return keep(customEmoji(a === 'a', n, id)); });
    // Horodatages <t:123:R>
    s = s.replace(/&lt;t:(-?\d{1,13})(?::([tTdDfFR]))?&gt;/g, function (m, sec, style) { var f = formatTimestamp(sec, style); return f ? keep('<span class="dtimestamp">' + esc(f) + '</span>') : m; });
    // Mentions
    s = s.replace(/&lt;@&amp;(\d{15,22})&gt;/g, function (_m, id) {
      var r = ctx.roles && ctx.roles[id];
      return keep('<span class="dmention dmention-role"' + (r && r.color ? ' data-role-color="' + esc(r.color) + '"' : '') + '>@' + esc(r ? r.name : 'rôle-inconnu') + '</span>');
    });
    s = s.replace(/&lt;@!?(\d{15,22})&gt;/g, function (_m, id) { var u = ctx.users && ctx.users[id]; return keep('<span class="dmention">@' + esc(u || 'membre') + '</span>'); });
    s = s.replace(/&lt;#(\d{15,22})&gt;/g, function (_m, id) { var c = ctx.channels && ctx.channels[id]; return keep('<span class="dmention dmention-channel">#' + esc(c || 'salon-inconnu') + '</span>'); });
    s = s.replace(/(^|[^\w])@(everyone|here)\b/g, function (_m, p, w) { return p + keep('<span class="dmention">@' + w + '</span>'); });
    // Liens masqués [texte](https://…)
    s = s.replace(/\[([^\]\n]{1,256})\]\((https?:\/\/[^\s)]+)\)/g, function (_m, label, url) { return keep('<a class="dlink" href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'); });
    // URLs brutes
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g, function (_m, p, url) { return p + keep('<a class="dlink" href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>'); });
    // Styles
    s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="dspoiler">$1</span>');
    s = s.replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([\s\S]+?)__/g, '<u>$1</u>');
    s = s.replace(/~~([\s\S]+?)~~/g, '<s>$1</s>');
    s = s.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, function (_m, i) { return tokens[Number(i)]; });
  }

  /**
   * Markdown Discord → HTML sûr : titres (# ## ###), sous-texte (-#), citations (>), listes (- *),
   * blocs de code (```), gras, italique, souligné, barré, spoiler, code, liens, mentions, emojis, horodatages.
   * opts.inline : pas de blocs (titres d'embed, noms de champs).
   */
  function markdown(text, ctx, opts) {
    ctx = ctx || {};
    var src = String(text === undefined || text === null ? '' : text);
    if (!src) return '';
    if (opts && opts.inline) return inline(esc(src), ctx).replace(/\n/g, '<br>');
    var blocks = [];
    src = src.replace(/```(?:[\w+-]{1,15}\n)?([\s\S]*?)```/g, function (_m, code) {
      blocks.push('<pre class="dcodeblock"><code>' + esc(code.replace(/^\n+|\n+$/g, '')) + '</code></pre>');
      return '\u0001' + (blocks.length - 1) + '\u0001';
    });
    var lines = esc(src).split('\n');
    var out = [];
    var quote = null;
    function flushQuote() { if (quote) { out.push({ block: true, html: '<blockquote class="dquote">' + quote.join('<br>') + '</blockquote>' }); quote = null; } }
    lines.forEach(function (line) {
      var m;
      if ((m = /^&gt; (.*)$/.exec(line)) || line === '&gt;') { (quote = quote || []).push(m ? inline(m[1], ctx) : ''); return; }
      flushQuote();
      if (/^\u0001\d+\u0001$/.test(line.trim())) { out.push({ block: true, html: blocks[Number(line.trim().slice(1, -1))] }); return; }
      if ((m = /^(#{1,3})\s+(.+)$/.exec(line))) { out.push({ block: true, html: '<div class="dh dh' + m[1].length + '">' + inline(m[2], ctx) + '</div>' }); return; }
      if ((m = /^-#\s+(.+)$/.exec(line))) { out.push({ block: true, html: '<div class="dsubtext">' + inline(m[1], ctx) + '</div>' }); return; }
      if ((m = /^(\s*)[-*]\s+(.+)$/.exec(line))) { out.push({ block: true, html: '<div class="dli' + (m[1].length >= 2 ? ' dli-2' : '') + '">' + inline(m[2], ctx) + '</div>' }); return; }
      out.push({ block: false, html: inline(line, ctx) });
    });
    flushQuote();
    var html = '';
    out.forEach(function (part, i) {
      html += part.html;
      var next = out[i + 1];
      if (next && !part.block && !next.block) html += '<br>';
    });
    return html.replace(/\u0001(\d+)\u0001/g, function (_m, i) { return blocks[Number(i)]; });
  }

  // ───── Embeds ─────

  /** Disposition Discord des champs : lignes de 3 champs « inline » max (2 avec miniature), grille de 12 colonnes. */
  function layoutFields(fields, hasThumb) {
    var max = hasThumb ? 2 : 3;
    var out = [];
    var row = [];
    function flush() { row.forEach(function (f) { out.push({ field: f, span: row.length === 1 ? 12 : 12 / row.length }); }); row = []; }
    (fields || []).forEach(function (f) {
      if (!f || (!f.name && !f.value)) return;
      if (f.inline) { row.push(f); if (row.length === max) flush(); }
      else { flush(); out.push({ field: f, span: 12 }); }
    });
    flush();
    return out;
  }

  function emojiHtml(emoji) {
    if (!emoji) return '';
    var m = /^<?(a)?:?(\w{2,32}):(\d{15,22})>?$/.exec(String(emoji).trim());
    if (m) return customEmoji(Boolean(m[1]), m[2], m[3]);
    return '<span class="demoji-text">' + esc(emoji) + '</span>';
  }

  function imageHtml(url, cls, ph) {
    if (isImageAllowed(url)) return '<img class="' + cls + '" src="' + esc(url) + '" alt="" loading="lazy">';
    return '<div class="dimg-ph ' + (ph || '') + '" title="' + esc(url) + '">' + ICONS.image + '<span>' + esc(hostOf(url)) + '</span></div>';
  }

  function hasEmbedContent(e) {
    return Boolean(e && (e.title || e.description || (e.fields && e.fields.length) || e.image || e.imageMock || e.thumbnail || (e.author && e.author.name) || (e.footer && e.footer.text) || e.timestamp));
  }

  function renderEmbed(e, ctx) {
    var color = e.color ? (String(e.color).charAt(0) === '#' ? e.color : '#' + e.color) : ctx.defaultColor || '#7C3AED';
    var hasThumb = Boolean(e.thumbnail);
    var h = '<div class="dembed" data-embed-color="' + esc(String(color).toUpperCase()) + '"><div class="dembed-grid"><div class="dembed-main">';
    if (e.author && e.author.name) {
      h += '<div class="dembed-author">' + (e.author.iconUrl && isImageAllowed(e.author.iconUrl) ? '<img src="' + esc(e.author.iconUrl) + '" alt="">' : '') +
        (e.author.url ? '<a href="' + esc(e.author.url) + '" target="_blank" rel="noopener noreferrer">' + esc(e.author.name) + '</a>' : '<span>' + esc(e.author.name) + '</span>') + '</div>';
    }
    if (e.title) {
      var title = markdown(e.title, ctx, { inline: true });
      h += '<div class="dembed-title">' + (e.url ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' + title + '</a>' : title) + '</div>';
    }
    if (e.description) h += '<div class="dembed-desc">' + markdown(e.description, ctx) + '</div>';
    var fields = layoutFields(e.fields, hasThumb);
    if (fields.length) {
      h += '<div class="dembed-fields">';
      fields.forEach(function (x) {
        h += '<div class="dembed-field dfield-' + x.span + '"><div class="dembed-field-name">' + markdown(x.field.name, ctx, { inline: true }) + '</div><div class="dembed-field-value">' + markdown(x.field.value, ctx) + '</div></div>';
      });
      h += '</div>';
    }
    h += '</div>';
    if (hasThumb) h += '<div class="dembed-thumb">' + imageHtml(e.thumbnail, '', 'dimg-ph-thumb') + '</div>';
    h += '</div>';
    if (e.image) h += '<div class="dembed-image">' + imageHtml(e.image, '', 'dimg-ph-wide') + '</div>';
    else if (e.imageMock) h += '<div class="dembed-image">' + imageMock(e.imageMock) + '</div>';
    if ((e.footer && e.footer.text) || e.timestamp) {
      var now = ctx.now ? new Date(ctx.now) : new Date();
      var parts = [];
      if (e.footer && e.footer.text) parts.push(esc(e.footer.text));
      if (e.timestamp) parts.push(footerDate(e.timestamp, now));
      h += '<div class="dembed-footer">' + (e.footer && e.footer.iconUrl && isImageAllowed(e.footer.iconUrl) ? '<img src="' + esc(e.footer.iconUrl) + '" alt="">' : '') + '<span>' + parts.join(' • ') + '</span></div>';
    }
    return h + '</div>';
  }

  // ───── Composants (boutons, menus) ─────

  function renderButton(b) {
    var style = ['primary', 'secondary', 'success', 'danger', 'link'].indexOf(b.style) === -1 ? 'secondary' : b.style;
    return '<span class="dbtn dbtn-' + style + (b.disabled ? ' is-disabled' : '') + (b.highlight ? ' is-highlight' : '') + '">' + emojiHtml(b.emoji) + (b.label ? '<span class="dbtn-label">' + esc(b.label) + '</span>' : '') + (style === 'link' ? ICONS.external : '') + '</span>';
  }

  function renderSelect(c) {
    var h = '<div class="dselect' + (c.open ? ' is-open' : '') + (c.disabled ? ' is-disabled' : '') + '"><div class="dselect-control"><span class="dselect-placeholder">' + esc(c.placeholder || 'Faites un choix') + '</span>' + ICONS.chevron + '</div>';
    if (c.open) {
      h += '<div class="dselect-menu">';
      var options = c.options || [];
      if (!options.length) h += '<div class="dselect-empty">Aucune option</div>';
      options.slice(0, 25).forEach(function (o) {
        h += '<div class="dselect-option">' + (o.emoji ? '<span class="dselect-emoji">' + emojiHtml(o.emoji) + '</span>' : '') + '<div class="dselect-text"><div class="dselect-label">' + esc(o.label) + '</div>' + (o.description ? '<div class="dselect-desc">' + esc(o.description) + '</div>' : '') + '</div></div>';
      });
      h += '</div>';
    }
    return h + '</div>';
  }

  function normalizeComponents(message) {
    var comps = [];
    (message.components || []).forEach(function (c) { if (c) comps.push(c); });
    var btns = Array.isArray(message.buttons) ? message.buttons.filter(function (b) { return b && (b.label || b.emoji); }) : [];
    for (var i = 0; i < btns.length; i += 5) comps.push({ type: 'buttons', buttons: btns.slice(i, i + 5) });
    return comps;
  }

  // ───── Message ─────

  /**
   * message : { content, embeds | embed, buttons, attachments: [{ url | mock: { title, subtitle } }], components: [{ type: 'buttons', buttons } | { type: 'select', placeholder, options, open }],
   *             author: { name, avatarUrl, bot }, ephemeral, compact, emptyText }
   * ctx     : { roles, channels, users, botName, botAvatarUrl, defaultColor, now }
   */
  function render(message, ctx) {
    message = message || {};
    ctx = ctx || {};
    var embeds = Array.isArray(message.embeds) ? message.embeds : message.embed ? [message.embed] : [];
    embeds = embeds.filter(hasEmbedContent);
    var content = message.content ? String(message.content) : '';
    var comps = normalizeComponents(message);
    var author = message.author || { name: ctx.botName || 'Redemption Story', avatarUrl: ctx.botAvatarUrl, bot: true };
    var now = ctx.now ? new Date(ctx.now) : new Date();
    var h = '<div class="dpreview' + (message.compact ? ' dpreview-compact' : '') + '"><div class="dmsg' + (message.ephemeral ? ' dmsg-ephemeral' : '') + '">';
    h += author.avatarUrl && isImageAllowed(author.avatarUrl) ? '<img class="davatar" src="' + esc(author.avatarUrl) + '" alt="">' : '<div class="davatar davatar-logo" aria-hidden="true">' + ICONS.logo + '</div>';
    h += '<div class="dbody"><div class="dmeta"><span class="dname">' + esc(author.name) + '</span>' + (author.bot === false ? '' : '<span class="dbot">' + ICONS.check + 'APP</span>') + '<span class="dtime">Aujourd\'hui à ' + hhmm(now) + '</span></div>';
    if (content) h += '<div class="dcontent">' + markdown(content, ctx) + '</div>';
    var attachments = Array.isArray(message.attachments) ? message.attachments : [];
    attachments.forEach(function (a) {
      h += '<div class="dattachment">' + (a.url && isImageAllowed(a.url) ? '<img src="' + esc(a.url) + '" alt="' + esc(a.name || '') + '">' : a.mock ? imageMock(a.mock) : '') + '</div>';
    });
    embeds.forEach(function (e) { h += renderEmbed(e, ctx); });
    if (!content && !embeds.length && !comps.length && !attachments.length) h += '<div class="dcontent dempty">' + esc(message.emptyText || 'Message vide — ajoutez un titre, une description ou du texte.') + '</div>';
    if (comps.length) {
      h += '<div class="dcomponents">';
      comps.forEach(function (c) {
        if (c.type === 'select') h += renderSelect(c);
        else h += '<div class="drow">' + (c.buttons || []).map(renderButton).join('') + '</div>';
      });
      h += '</div>';
    }
    if (message.ephemeral) h += '<div class="dephemeral">' + ICONS.eye + '<span>Seul·e vous pouvez voir ceci · <span class="dlink">Ignorer ce message</span></span></div>';
    return h + '</div></div></div>';
  }

  /** Modal (formulaire) Discord : { title, fields: [{ label, placeholder, style: 'short'|'paragraph', required, maxLength }] } */
  function renderModal(modal, ctx) {
    modal = modal || {};
    var fields = (modal.fields || []).filter(function (f) { return f && f.label; });
    var h = '<div class="dmodal" role="presentation"><div class="dmodal-head"><div class="dmodal-title">' + esc(modal.title || 'Formulaire') + '</div><span class="dmodal-close">' + ICONS.close + '</span></div><div class="dmodal-body">';
    if (!fields.length) h += '<div class="dmodal-empty">Aucune question : le ticket s’ouvre directement, sans formulaire.</div>';
    fields.forEach(function (f) {
      var paragraph = f.style === 'paragraph';
      h += '<div class="dmodal-field"><div class="dmodal-label">' + esc(f.label) + (f.required === false ? '' : '<span class="dmodal-req">*</span>') + '</div>';
      h += '<div class="dmodal-input' + (paragraph ? ' is-paragraph' : '') + '">' + (f.placeholder ? '<span class="dmodal-ph">' + esc(f.placeholder) + '</span>' : '') + '</div>';
      if (f.maxLength) h += '<div class="dmodal-count">0 / ' + esc(f.maxLength) + '</div>';
      h += '</div>';
    });
    h += '</div><div class="dmodal-foot"><span class="dmodal-cancel">Annuler</span><span class="dbtn dbtn-primary">Envoyer</span></div></div>';
    void ctx;
    return h;
  }

  /** Remplace les variables {clé} d'un texte (variables inconnues laissées telles quelles). */
  function applyVars(text, vars) {
    if (typeof text !== 'string' || !vars) return text;
    return text.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m; });
  }
  /** applyVars récursif sur un objet (EmbedSpec…). */
  function applyVarsDeep(value, vars) {
    if (typeof value === 'string') return applyVars(value, vars);
    if (Array.isArray(value)) return value.map(function (v) { return applyVarsDeep(v, vars); });
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (k) { out[k] = applyVarsDeep(value[k], vars); });
      return out;
    }
    return value;
  }

  return {
    escape: esc,
    markdown: markdown,
    layoutFields: layoutFields,
    renderEmbed: renderEmbed,
    render: render,
    renderModal: renderModal,
    contextFromGuild: contextFromGuild,
    applyVars: applyVars,
    applyVarsDeep: applyVarsDeep,
    isImageAllowed: isImageAllowed,
    hasEmbedContent: hasEmbedContent,
  };
});
