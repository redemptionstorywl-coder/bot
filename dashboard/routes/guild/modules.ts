import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { RedemptionClient } from '../../../src/core/Client';
import { MODULE_KEYS, MODULE_LABELS, type ModuleKey } from '../../../src/config/constants';
import { guildConfigService } from '../../../src/services/GuildConfigService';
import { loggingService } from '../../../src/services/LoggingService';
import { wrap } from '../../lib/async';
import { parseOrThrow } from '../../lib/validate';

const moduleParams = z.object({ key: z.enum(MODULE_KEYS) });
const moduleBody = z.object({ enabled: z.union([z.boolean(), z.enum(['true', 'false', 'on', 'off', '1', '0'])]).transform((v) => v === true || v === 'true' || v === 'on' || v === '1') });

/**
 * POST …/modules/:key { enabled } — active/désactive un module.
 * Partagé par /guilds/:guildId/modules/:key et /api/guilds/:guildId/modules/:key.
 */
export function toggleModuleHandler(_client: RedemptionClient): RequestHandler {
  return wrap(async (req, res) => {
    const { key } = parseOrThrow(moduleParams, req.params);
    const { enabled } = parseOrThrow(moduleBody, req.body);
    const guildId = res.locals.guild!.id;
    await guildConfigService.setModule(guildId, key as ModuleKey, enabled);
    void loggingService.log({
      guildId,
      category: 'SYSTEM',
      action: enabled ? 'module.enable' : 'module.disable',
      title: `Module ${enabled ? 'activé' : 'désactivé'} : ${MODULE_LABELS[key as ModuleKey]}`,
      actorId: req.session.user?.id ?? null,
      data: { module: key, enabled, source: 'dashboard' },
    });
    const config = await guildConfigService.get(guildId);
    res.json({ ok: true, module: key, enabled, active: config ? Object.values(config.modules).filter(Boolean).length : null, total: MODULE_KEYS.length });
  });
}
