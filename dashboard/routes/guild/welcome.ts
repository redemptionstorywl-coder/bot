import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { welcomeService, resolveLocalized, type Localized } from '../../../src/services/WelcomeService';
import { welcomeImageService } from '../../../src/services/WelcomeImageService';
import { translationService } from '../../../src/services/TranslationService';
import { renderTemplate } from '../../../src/utils/variables';
import { BRAND } from '../../../src/config/constants';
import { embedSpecSchema, type EmbedSpec } from '../../../src/services/EmbedService';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, optionalText, optionalDiscordId, checkbox } from '../../lib/validate';
import { embedFormOptional, buttonsJsonSchema, toEmbedSpec, safeButtons, safeEmbedSpec } from '../../lib/embedForm';
import { formAction } from '../../lib/serviceErrors';
import { requireBotGuild } from '../../lib/names';
import { broadcastToGuild } from '../../sockets';

const TABS = ['welcome', 'leave'] as const;
const tabQuery = z.object({ tab: z.preprocess((v) => (typeof v === 'string' && (TABS as readonly string[]).includes(v) ? v : 'welcome'), z.enum(TABS)) });

/** JSON d'embed (EmbedSpec). Vide → null. */
const embedJson = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v ?? null;
    if (v.trim() === '') return null;
    try {
      return JSON.parse(v);
    } catch {
      return 'invalid-json';
    }
  },
  z.union([z.null(), embedSpecSchema]),
);

const welcomeBody = z.object({
  enabled: checkbox,
  channelId: optionalDiscordId,
  message: optionalText(2000),
  embedMode: z.enum(['none', 'form', 'json']).default('form'),
  embed: embedFormOptional,
  embedJson,
  imageEnabled: checkbox,
  imageBackgroundUrl: z.preprocess((v) => (typeof v !== 'string' || v.trim() === '' ? null : v.trim()), z.string().url('URL invalide').max(500).nullable()),
  imageTitle: z.string().trim().min(1).max(60).default('BIENVENUE'),
  imageSubtitle: z.string().trim().min(1).max(80).default('{username} · membre #{memberCount}'),
  dmEnabled: checkbox,
  dmMessage: optionalText(2000),
  dmEmbedJson: embedJson,
  buttonsJson: buttonsJsonSchema,
});

const leaveBody = z.object({
  enabled: checkbox,
  channelId: optionalDiscordId,
  message: optionalText(2000),
  embedMode: z.enum(['none', 'form', 'json']).default('json'),
  embed: embedFormOptional,
  embedJson,
  imageEnabled: checkbox,
  imageBackgroundUrl: z.preprocess((v) => (typeof v !== 'string' || v.trim() === '' ? null : v.trim()), z.string().url('URL invalide').max(500).nullable()),
  logEnabled: checkbox,
});

const testBody = z.object({ kind: z.enum(['welcome', 'leave']) });

const imageBody = z.object({
  kind: z.enum(['welcome', 'leave']).default('welcome'),
  title: z.string().trim().max(60).optional().default(''),
  subtitle: z.string().trim().max(80).optional().default(''),
  backgroundUrl: z.preprocess((v) => (typeof v !== 'string' || v.trim() === '' ? null : v.trim()), z.string().url('URL invalide').max(500).regex(/^https?:\/\//, 'URL http(s) attendue').nullable()),
});

function textOrNull(value: string | null | undefined): string | typeof Prisma.DbNull {
  return value ? value : Prisma.DbNull;
}

function jsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

/** Texte stocké (les anciennes valeurs `{ [lang]: texte }` sont lues dans la langue du serveur). */
function storedText(value: unknown, lang: string): string {
  const v = resolveLocalized<unknown>(value as Localized<unknown> | null, lang);
  return typeof v === 'string' ? v : '';
}

function describeEmbed(value: unknown, lang: string): { mode: 'none' | 'form' | 'json'; spec: EmbedSpec; json: string } {
  if (value === null || value === undefined) return { mode: 'none', spec: {}, json: '' };
  const spec = safeEmbedSpec(resolveLocalized(value as Localized<unknown>, lang));
  return { mode: Object.keys(spec).length ? 'form' : 'none', spec, json: JSON.stringify(spec, null, 2) };
}

function embedJsonText(value: unknown, lang: string): string {
  if (value === null || value === undefined) return '';
  return JSON.stringify(resolveLocalized(value as Localized<unknown>, lang), null, 2);
}

/** Pages Bienvenue / Départ. */
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
      const [welcome, leave] = await Promise.all([welcomeService.getConfig(guild.id), welcomeService.getLeaveConfig(guild.id)]);
      const lang = config.defaultLanguage;
      const t = translationService.bind(lang, guild.id);
      render(res, 'welcome', {
        title: 'Bienvenue et départs',
        page: 'welcome',
        tab: query.tab,
        welcome,
        leave,
        welcomeMessage: storedText(welcome?.message, lang),
        dmMessage: storedText(welcome?.dmMessage, lang),
        leaveMessage: storedText(leave?.message, lang),
        welcomeEmbed: describeEmbed(welcome?.embed, lang),
        dmEmbedJson: embedJsonText(welcome?.dmEmbed, lang),
        leaveEmbedJson: embedJsonText(leave?.embed, lang),
        leaveEmbed: describeEmbed(leave?.embed, lang),
        buttons: safeButtons(welcome?.buttons),
        modules: { welcome: config.modules.welcome, leave: config.modules.leave },
        crumbs: query.tab === 'leave' ? [{ label: 'Départ' }] : [],
        texts: {
          defaultWelcome: t('welcome.default_message', { user: '{user}', server: '{server}' }),
          defaultLeave: t('welcome.leave.default_message', { username: '{username}', memberCount: '{memberCount}' }),
          leaveImageTitle: t('welcome.leave.image_title'),
          leaveImageSubtitle: t('welcome.leave.image_subtitle'),
        },
        scripts: ['welcome'],
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
        const { body } = valid<z.infer<typeof welcomeBody>>(req);
        let embed: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
        if (body.embedMode === 'form') embed = jsonOrNull(toEmbedSpec(body.embed));
        else if (body.embedMode === 'json') embed = jsonOrNull(body.embedJson);
        await welcomeService.updateConfig(guild.id, {
          enabled: body.enabled,
          channelId: body.channelId,
          message: textOrNull(body.message),
          embed,
          imageEnabled: body.imageEnabled,
          imageBackgroundUrl: body.imageBackgroundUrl,
          imageTitle: body.imageTitle,
          imageSubtitle: body.imageSubtitle,
          dmEnabled: body.dmEnabled,
          dmMessage: textOrNull(body.dmMessage),
          dmEmbed: jsonOrNull(body.dmEmbedJson),
          buttons: body.buttonsJson as unknown as Prisma.InputJsonValue,
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
        const { body } = valid<z.infer<typeof leaveBody>>(req);
        await welcomeService.updateLeaveConfig(guild.id, {
          enabled: body.enabled,
          channelId: body.channelId,
          message: textOrNull(body.message),
          embed: body.embedMode === 'none' ? Prisma.DbNull : body.embedMode === 'form' ? jsonOrNull(toEmbedSpec(body.embed)) : jsonOrNull(body.embedJson),
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

  /** Aperçu de l'image générée (PNG en data URL, POST JSON + CSRF : aucune URL externe récupérée sans jeton). */
  router.post(
    '/welcome/image',
    validate({ body: imageBody }),
    wrap(async (req, res) => {
      const guildView = res.locals.guild!;
      const config = res.locals.config!;
      const { body } = valid<z.infer<typeof imageBody>>(req);
      const guild = requireBotGuild(client, guildView.id);
      const member = await guild.members.fetch(req.session.user!.id).catch(() => null);
      const ctx = { member, guild, user: member?.user ?? null, language: config.defaultLanguage };
      const t = translationService.bind(config.defaultLanguage, guildView.id);
      const title = body.kind === 'leave' ? t('welcome.leave.image_title') : body.title || 'BIENVENUE';
      const subtitle = body.kind === 'leave' ? t('welcome.leave.image_subtitle') : body.subtitle;
      const png = await welcomeImageService.generate({
        title: renderTemplate(title, ctx).slice(0, 60),
        subtitle: renderTemplate(subtitle, ctx).slice(0, 80),
        avatarUrl: member?.user.displayAvatarURL({ extension: 'png', size: 256 }) ?? null,
        backgroundUrl: body.backgroundUrl,
        accentColor: body.kind === 'leave' ? BRAND.colors.neutral : config.brandColor,
      });
      res.json({ ok: true, dataUrl: `data:image/png;base64,${png.toString('base64')}` });
    }),
  );

  return router;
}
