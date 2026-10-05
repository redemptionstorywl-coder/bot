import { Router } from 'express';
import { z } from 'zod';
import { GuildKind, type Prisma } from '@prisma/client';
import type { RedemptionClient } from '../../../src/core/Client';
import { guildConfigService } from '../../../src/services/GuildConfigService';
import { loggingService } from '../../../src/services/LoggingService';
import { autoTranslateService } from '../../../src/services/AutoTranslateService';
import { TRANSLATE_LAYOUTS } from '../../../src/services/autotranslate/bilingual';
import { LANGUAGE_CODES, LANGUAGES } from '../../../src/config/constants';
import { groupedModules, GUILD_KIND_INFO, MODULE_INFO, timezoneList } from '../../lib/modules';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { validate, valid, checkbox, discordIdArray, hexColorSchema, optionalText } from '../../lib/validate';
import { toggleModuleHandler } from './modules';

const languageCode = z.enum(LANGUAGE_CODES as [string, ...string[]]);

const settingsBody = z.object({
  kind: z.nativeEnum(GuildKind),
  displayName: optionalText(100),
  defaultLanguage: languageCode,
  brandColor: hexColorSchema,
  adminRoleIds: discordIdArray,
  staffRoleIds: discordIdArray,
  footerText: optionalText(200),
  footerIconUrl: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().url('URL invalide').max(500).nullable().optional()),
  timezone: z.string().trim().min(1).max(64).default('Europe/Paris'),
  autoTranslate: checkbox,
  translateLayout: z.enum(TRANSLATE_LAYOUTS).default('embed'),
});

/** GET/POST /guilds/:guildId/settings (page unique : type, langue, traduction automatique, apparence, équipe, modules). Les permissions de commandes sont sur /permissions. */
export function createSettingsRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/settings',
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const tab = typeof req.query.tab === 'string' ? req.query.tab : '';
      // Ancien onglet « Permissions » : la page dédiée le remplace.
      if (tab === 'commands') return res.redirect(302, `/guilds/${guild.id}/permissions`);
      const scrollTo = tab === 'modules' ? 'modules' : null;
      render(res, 'settings', {
        title: 'Paramètres',
        page: 'settings',
        scrollTo,
        kinds: Object.entries(GUILD_KIND_INFO).map(([value, info]) => ({ value, ...info })),
        languages: LANGUAGES,
        moduleGroups: groupedModules(config.modules),
        modulesActive: Object.values(config.modules).filter(Boolean).length,
        modulesTotal: Object.keys(MODULE_INFO).length,
        timezones: timezoneList(),
        settings: config.raw.settings,
        autoTranslate: config.autoTranslate,
        translateProvider: autoTranslateService.describeProvider(),
        scripts: ['settings'],
      });
    }),
  );

  router.post(
    '/settings',
    validate({ body: settingsBody }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const config = res.locals.config!;
      const { body } = valid<z.infer<typeof settingsBody>>(req);
      const data: Prisma.GuildSettingsUpdateInput = {
        displayName: body.displayName ?? null,
        defaultLanguage: body.defaultLanguage,
        brandColor: body.brandColor,
        adminRoleIds: body.adminRoleIds,
        staffRoleIds: body.staffRoleIds,
        footerText: body.footerText ?? null,
        footerIconUrl: body.footerIconUrl ?? null,
        timezone: body.timezone,
      };
      if (body.kind !== config.kind) await guildConfigService.setKind(guild.id, body.kind);
      await guildConfigService.updateSettings(guild.id, data);
      await autoTranslateService.updateSettings(guild.id, { enabled: body.autoTranslate, layout: body.translateLayout });
      void loggingService.log({ guildId: guild.id, category: 'SYSTEM', action: 'settings.update', title: 'Paramètres mis à jour depuis le dashboard', actorId: req.session.user?.id ?? null, data: { kind: body.kind, defaultLanguage: body.defaultLanguage, autoTranslate: body.autoTranslate, translateLayout: body.translateLayout } });
      flash(req, 'success', 'Paramètres enregistrés.');
      res.redirect(`/guilds/${guild.id}/settings`);
    }),
  );

  router.post('/modules/:key', toggleModuleHandler(client));

  return router;
}
