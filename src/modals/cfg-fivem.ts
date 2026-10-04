import type { ModalSubmitInteraction } from 'discord.js';
import { defineModal } from '../structures';
import type { InteractionContext } from '../structures/types';
import { fivemService } from '../services/FiveMService';
import { fivemSyncService } from '../services/FiveMSyncService';
import { PanelError, attempt, deferModal, ko, modalText, modalValues, respond, unknownAction } from '../panels/_modulesKit';
import { isValidLicense, normalizeHost, parseFramework, renderMain, renderServer } from '../panels/_fivem';

/**
 * Modals du panneau `/config module:fivem` (namespace `cfg-fivem`, admin) :
 *  - `add`          : clé, nom, framework, hôte, clé API
 *  - `edit:<key>`   : nom, framework, hôte, clé API (vide = inchangée, `-` = retirée)
 *  - `nick:<key>`   : format du surnom ({name} {id} {level})
 *  - `link`         : liaison manuelle membre ⇄ licence
 */
export default defineModal({
  id: 'cfg-fivem',
  permissions: { internal: 'admin' },
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    const [action = '', key = ''] = args;
    await handle(interaction, action, key, ctx);
  },
});

async function handle(interaction: ModalSubmitInteraction<'cached'>, action: string, key: string, ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  const config = ctx.config!;
  const guild = interaction.guild;
  const opts = { guild, config, t };
  const field = (id: string) => modalText(interaction, id);

  switch (action) {
    case 'add': {
      let created: Awaited<ReturnType<typeof fivemService.addServer>> | null = null;
      const notice = await attempt(t, async () => {
        created = await fivemService.addServer({
          guildId: guild.id,
          key: field('key') ?? '',
          name: field('name') ?? field('key') ?? '',
          framework: parseFramework(modalValues(interaction, 'framework')[0]),
          host: normalizeHost(field('host')),
          apiKey: field('apiKey') ?? null,
        });
        return t('fivem.add.done', { name: created.name, key: created.key, framework: created.framework });
      });
      return respond(interaction, created ? renderServer(created, { ...opts, notice }) : await renderMain({ ...opts, notice }));
    }
    case 'link': {
      const notice = await attempt(t, async () => {
        const userId = modalValues(interaction, 'member')[0];
        const license = field('license') ?? '';
        if (!userId) throw new PanelError('core.member_not_found');
        if (interaction.fields.resolved?.users?.get(userId)?.bot) throw new PanelError('fivem.link.bot');
        if (!isValidLicense(license)) throw new PanelError('fivem.link.invalid');
        await fivemSyncService.linkManually(guild.id, userId, license.trim(), interaction.user.id);
        return t('fivem.link.done', { user: `<@${userId}>`, license: license.trim() });
      });
      return respond(interaction, await renderMain({ ...opts, notice }));
    }
    case 'edit':
    case 'nick': {
      const server = await fivemService.getServer(guild.id, key);
      if (!server) return respond(interaction, await renderMain({ ...opts, notice: ko(t('fivem.errors.not_found')) }));
      if (action === 'nick') await deferModal(interaction);
      let updated = server;
      const notice = await attempt(t, async () => {
        if (action === 'nick') {
          updated = await fivemSyncService.updateSyncSettings(guild.id, server.key, { nicknameFormat: field('format') ?? '' });
          return t('fivem.sync.updated', { name: server.name });
        }
        const apiKey = field('apiKey');
        updated = await fivemService.updateServer(guild.id, server.key, {
          name: (field('name') ?? server.name).slice(0, 100),
          framework: parseFramework(modalValues(interaction, 'framework')[0] ?? server.framework),
          host: normalizeHost(field('host')),
          ...(apiKey === undefined ? {} : { apiKey: apiKey === '-' ? null : apiKey }),
        });
        return t('panels_modules.fivem.updated', { name: updated.name });
      });
      return respond(interaction, renderServer(updated, { ...opts, notice }));
    }
    default:
      return unknownAction(interaction, t, action);
  }
}
