import { Router } from 'express';
import { z } from 'zod';
import { PanelStyle, Prisma } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { welcomeService, isLocalizedMap, resolveLocalized, type Localized } from '../../../src/services/WelcomeService';
import { languageService, enabledLanguageDefinitions } from '../../../src/services/LanguageService';
import { embedSpecSchema, type EmbedSpec } from '../../../src/services/EmbedService';
import { LANGUAGES, LANGUAGE_CODES } from '../../../src/config/constants';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, optionalText, optionalDiscordId, checkbox, discordIdSchema } from '../../lib/validate';
import { embedFormOptional, buttonsJsonSchema, toEmbedSpec, safeButtons, safeEmbedSpec } from '../../lib/embedForm';
import { formAction } from '../../lib/serviceErrors';
import { requireBotGuild } from '../../lib/names';
import { broadcastToGuild } from '../../sockets';

const TABS = ['welcome', 'leave', 'languages'] as const;
const tabQuery = z.object({ tab: z.preprocess((v) => (typeof v === 'string' && (TABS as readonly string[]).includes(v) ? v : 'welcome'), z.enum(TABS)) });

/** Dictionnaire `{ lang: texte }` saisi dans le formulaire (textareas par langue). */
const localizedText = z.preprocess((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}), z.record(z.string(), z.string().max(2000)));

/** JSON d'embed : EmbedSpec simple ou dictionnaire `{ lang: EmbedSpec }`. Vide → null. */
const localizedEmbedJson = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v ?? null;
    if (v.trim() === '') return null;
    try {
      return JSON.parse(v);
    } catch {
      return 'invalid-json';
    }
  },
  z.union([z.null(), embedSpecSchema, z.record(z.enum(LANGUAGE_CODES as [string, ...string[]]), embedSpecSchema)]),
);

const welcomeBody = z.object({
  enabled: checkbox,
  channelId: optionalDiscordId,
  sameMessage: checkbox,
  message: optionalText(2000),
  messages: localizedText,
  embedMode: z.enum(['none', 'form', 'json']).default('form'),
  embed: embedFormOptional,
  embedJson: localizedEmbedJson,
  imageEnabled: checkbox,
  imageBackgroundUrl: z.preprocess((v) => (typeof v !== 'string' || v.trim() === '' ? null : v.trim()), z.string().url('URL invalide').max(500).nullable()),
  imageTitle: z.string().trim().min(1).max(60).default('BIENVENUE'),
  imageSubtitle: z.string().trim().min(1).max(80).default('{username} · membre #{memberCount}'),
  dmEnabled: checkbox,
  dmSameMessage: checkbox,
  dmMessage: optionalText(2000),
  dmMessages: localizedText,
  dmEmbedJson: localizedEmbedJson,
  buttonsJson: buttonsJsonSchema,
  languagePromptEnabled: checkbox,
});

const leaveBody = z.object({
  enabled: checkbox,
  channelId: optionalDiscordId,
  sameMessage: checkbox,
  message: optionalText(2000),
  messages: localizedText,
  embedJson: localizedEmbedJson,
  imageEnabled: checkbox,
  imageBackgroundUrl: z.preprocess((v) => (typeof v !== 'string' || v.trim() === '' ? null : v.trim()), z.string().url('URL invalide').max(500).nullable()),
  logEnabled: checkbox,
});

const testBody = z.object({ kind: z.enum(['welcome', 'leave']) });

const languagesBody = z.object({
  roles: z.preprocess((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}), z.record(z.string(), z.string().regex(/^(\d{15,22})?$/, 'rôle invalide'))),
});
const publishBody = z.object({ channelId: discordIdSchema, style: z.nativeEnum(PanelStyle).default(PanelStyle.BUTTONS) });

/** Construit la valeur multilingue d'un message depuis le formulaire (chaîne unique ou dictionnaire). */
function buildLocalizedMessage(same: boolean, single: string | null | undefined, perLang: Record<string, string>, enabled: string[]): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (same) return single ? single : Prisma.DbNull;
  const map: Record<string, string> = {};
  for (const [lang, text] of Object.entries(perLang)) if (enabled.includes(lang) && text.trim()) map[lang] = text.trim();
  return Object.keys(map).length ? map : Prisma.DbNull;
}

function jsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/** Décompose une valeur multilingue stockée pour pré-remplir le formulaire. */
function splitLocalized(value: unknown): { same: boolean; single: string; perLang: Record<string, string> } {
  if (typeof value === 'string') return { same: true, single: value, perLang: {} };
  if (isLocalizedMap(value)) {
    const perLang: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) if (typeof v === 'string') perLang[k] = v;
    return { same: false, single: '', perLang };
  }
  return { same: true, single: '', perLang: {} };
}

function describeEmbed(value: unknown, defaultLanguage: string): { mode: 'none' | 'form' | 'json'; spec: EmbedSpec; json: string } {
  if (value === null || value === undefined) return { mode: 'none', spec: {}, json: '' };
  if (isLocalizedMap(value)) return { mode: 'json', spec: safeEmbedSpec(resolveLocalized(value as Localized<unknown>, defaultLanguage)), json: JSON.stringify(value, null, 2) };
  const spec = safeEmbedSpec(value);
  return { mode: Object.keys(spec).length ? 'form' : 'none', spec, json: JSON.stringify(spec, null, 2) };
}

/** Pages Bienvenue / Départ / Langues (rôles de langue + panneau). */
export function createWelcomeRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/welcome`;

  router.get(
    '/welcome',
    validate({ query: tabQuery }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { query } = valid<unknown, z.infer<typeof tabQuery>>(req);
      const [welcome, leave, languageRoles] = await Promise.all([welcomeService.getConfig(guild.id), welcomeService.getLeaveConfig(guild.id), languageService.listLanguageRoles(guild.id)]);
      const enabledLanguages = enabledLanguageDefinitions(config);
      const welcomeMessage = splitLocalized(welcome?.message);
      const dmMessage = splitLocalized(welcome?.dmMessage);
      const leaveMessage = splitLocalized(leave?.message);
      const settings = config.raw.settings;
      render(res, 'welcome', {
        title: 'Bienvenue',
        page: 'welcome',
        tab: query.tab,
        welcome,
        leave,
        enabledLanguages,
        welcomeMessage,
        dmMessage,
        leaveMessage,
        welcomeEmbed: describeEmbed(welcome?.embed, config.defaultLanguage),
        dmEmbedJson: welcome?.dmEmbed ? JSON.stringify(welcome.dmEmbed, null, 2) : '',
        leaveEmbedJson: leave?.embed ? JSON.stringify(leave.embed, null, 2) : '',
        buttons: safeButtons(welcome?.buttons),
        languageRoles: LANGUAGES.map((l) => ({ ...l, enabled: config.enabledLanguages.includes(l.code), roleId: languageRoles.find((r) => r.language === l.code)?.roleId ?? '', defaultPresent: Boolean(l.defaultRoleId && guild.roles.some((r) => r.id === l.defaultRoleId)) })),
        panel: settings?.languagePanelChannelId ? { channelId: settings.languagePanelChannelId, messageId: settings.languagePanelMessageId } : null,
        modules: { welcome: config.modules.welcome, leave: config.modules.leave, language: config.modules.language },
      });
    }),
  );

  router.post(
    '/welcome',
    validate({ body: welcomeBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=welcome`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const config = res.locals.config!;
        const { body } = valid<z.infer<typeof welcomeBody>>(req);
        let embed: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
        if (body.embedMode === 'form') embed = jsonOrNull(toEmbedSpec(body.embed));
        else if (body.embedMode === 'json') embed = jsonOrNull(body.embedJson);
        await welcomeService.updateConfig(guild.id, {
          enabled: body.enabled,
          channelId: body.channelId,
          message: buildLocalizedMessage(body.sameMessage, body.message, body.messages, config.enabledLanguages),
          embed,
          imageEnabled: body.imageEnabled,
          imageBackgroundUrl: body.imageBackgroundUrl,
          imageTitle: body.imageTitle,
          imageSubtitle: body.imageSubtitle,
          dmEnabled: body.dmEnabled,
          dmMessage: buildLocalizedMessage(body.dmSameMessage, body.dmMessage, body.dmMessages, config.enabledLanguages),
          dmEmbed: jsonOrNull(body.dmEmbedJson),
          buttons: body.buttonsJson as unknown as Prisma.InputJsonValue,
          languagePromptEnabled: body.languagePromptEnabled,
        });
        broadcastToGuild(guild.id, 'welcome:update', { guildId: guild.id, kind: 'welcome' });
        flash(req, 'success', 'Configuration de bienvenue enregistrée.');
      },
    ),
  );

  router.post(
    '/welcome/leave',
    validate({ body: leaveBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=leave`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const config = res.locals.config!;
        const { body } = valid<z.infer<typeof leaveBody>>(req);
        await welcomeService.updateLeaveConfig(guild.id, {
          enabled: body.enabled,
          channelId: body.channelId,
          message: buildLocalizedMessage(body.sameMessage, body.message, body.messages, config.enabledLanguages),
          embed: jsonOrNull(body.embedJson),
          imageEnabled: body.imageEnabled,
          imageBackgroundUrl: body.imageBackgroundUrl,
          logEnabled: body.logEnabled,
        });
        broadcastToGuild(guild.id, 'welcome:update', { guildId: guild.id, kind: 'leave' });
        flash(req, 'success', 'Configuration de départ enregistrée.');
      },
    ),
  );

  router.post(
    '/welcome/test',
    validate({ body: testBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}?tab=${req.body?.kind === 'leave' ? 'leave' : 'welcome'}`,
      async (req, res) => {
        const guildView = res.locals.guild!;
        const { body } = valid<z.infer<typeof testBody>>(req);
        const guild = requireBotGuild(client, guildView.id);
        const member = await guild.members.fetch(req.session.user!.id).catch(() => null);
        if (!member) throw new HttpError(400, 'Impossible de vous retrouver sur le serveur : le test utilise votre propre profil.');
        const config = body.kind === 'welcome' ? await welcomeService.getConfig(guildView.id) : await welcomeService.getLeaveConfig(guildView.id);
        if (!config) throw new HttpError(400, 'Enregistrez d’abord la configuration.');
        if (!config.channelId) throw new HttpError(400, 'Aucun salon configuré : choisissez un salon puis enregistrez.');
        const channel = guild.channels.cache.get(config.channelId);
        if (!channel || !channel.isTextBased() || !('send' in channel)) throw new HttpError(400, 'Le salon configuré est introuvable ou n’est pas un salon texte.');
        const payload = body.kind === 'welcome' ? await welcomeService.preview(guild, member) : await welcomeService.previewLeave(guild, member);
        if (!payload) throw new HttpError(400, 'Aucune configuration à tester.');
        await channel.send({ content: payload.content, embeds: payload.embeds, files: payload.files, components: payload.components });
        flash(req, 'success', `Message de ${body.kind === 'welcome' ? 'bienvenue' : 'départ'} de test envoyé dans #${channel.name}.`);
      },
    ),
  );

  // ───── Langues ─────

  router.post(
    '/welcome/languages',
    validate({ body: languagesBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=languages`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof languagesBody>>(req);
        const validRoles = new Set(guild.roles.map((r) => r.id));
        let set = 0;
        let removed = 0;
        for (const lang of LANGUAGE_CODES) {
          const roleId = body.roles[lang];
          if (roleId === undefined) continue;
          if (!roleId) {
            removed += await languageService.removeLanguageRole(guild.id, lang);
            continue;
          }
          if (!validRoles.has(roleId)) throw new HttpError(400, `Rôle inconnu pour la langue ${lang}.`);
          const def = LANGUAGES.find((l) => l.code === lang)!;
          await languageService.setLanguageRole(guild.id, lang, roleId, { emoji: def.flag, label: def.nativeLabel });
          set++;
        }
        languageService.invalidate(guild.id);
        flash(req, 'success', `Rôles de langue enregistrés (${set} défini(s), ${removed} retiré(s)).`);
      },
    ),
  );

  router.post(
    '/welcome/languages/reset',
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=languages`,
      async (req, res) => {
        const guildView = res.locals.guild!;
        const guild = requireBotGuild(client, guildView.id);
        const result = await languageService.resetDefaults(guild);
        const count = Object.keys(result.configured).length;
        flash(req, count ? 'success' : 'warning', count ? `${count} rôle(s) par défaut configuré(s)${result.missing.length ? ` ; absents sur ce serveur : ${result.missing.join(', ')}` : ''}.` : 'Aucun des rôles par défaut n’existe sur ce serveur.');
      },
    ),
  );

  router.post(
    '/welcome/languages/publish',
    validate({ body: publishBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=languages`,
      async (req, res) => {
        const guildView = res.locals.guild!;
        const { body } = valid<z.infer<typeof publishBody>>(req);
        const guild = requireBotGuild(client, guildView.id);
        if (!guildView.textChannels.some((c) => c.id === body.channelId)) throw new HttpError(400, 'Salon inconnu.');
        await languageService.publishPanel(guild, body.channelId, body.style);
        flash(req, 'success', `Panneau de langue publié dans #${guildView.textChannels.find((c) => c.id === body.channelId)?.name}.`);
      },
    ),
  );

  router.post(
    '/welcome/languages/refresh',
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}?tab=languages`,
      async (req, res) => {
        const guildView = res.locals.guild!;
        const guild = requireBotGuild(client, guildView.id);
        const ok = await languageService.refreshPanel(guild);
        flash(req, ok ? 'success' : 'warning', ok ? 'Panneau de langue rafraîchi.' : 'Aucun panneau publié (ou message introuvable) : publiez-en un.');
      },
    ),
  );

  return router;
}
