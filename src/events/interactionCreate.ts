import { Events, GuildMember, MessageFlags, type BaseInteraction, type RepliableInteraction } from 'discord.js';
import { defineEvent } from '../structures';
import type { Command, CommandPermissions, ComponentHandler, InteractionContext } from '../structures/types';
import { resolveContext } from '../core/context';
import { env } from '../config/env';
import { embedService } from '../services/EmbedService';
import { hasInternalPermission, missingDiscordPermissions } from '../utils/permissions';
import { parseCustomId } from '../utils/customId';
import { childLogger } from '../utils/logger';
import { COOLDOWN_DEFAULT_SECONDS, DEFAULT_LANGUAGE, MODULE_LABELS, fromDiscordLocale, type ModuleKey } from '../config/constants';
import { translationService } from '../services/TranslationService';
import { formatDuration } from '../utils/time';
import { prisma } from '../database/client';
import { TTLCache } from '../utils/cache';

const log = childLogger('Interactions');
const commandPermCache = new TTLCache<{ roleIds: string[]; enabled: boolean } | null>(5 * 60_000);

async function reply(interaction: RepliableInteraction, content: { embeds: ReturnType<typeof embedService.error>[] }): Promise<void> {
  const payload = { ...content, flags: MessageFlags.Ephemeral } as const;
  // Interaction différée sans contenu : on remplace le « réfléchit… » (un followUp le laisserait bloqué).
  if (interaction.deferred && !interaction.replied) await interaction.editReply({ embeds: content.embeds }).catch(() => null);
  else if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
  else await interaction.reply(payload).catch(() => null);
}

/** Vérifie module, permissions Discord + internes, permissions de commande configurées. */
async function checkAccess(
  interaction: BaseInteraction & RepliableInteraction,
  ctx: InteractionContext,
  opts: { module?: ModuleKey; permissions?: CommandPermissions; commandName?: string; guildKinds?: Command['guildKinds'] },
): Promise<boolean> {
  const { t, config } = ctx;
  if (opts.module && config && !config.modules[opts.module]) {
    await reply(interaction, { embeds: [embedService.error(t('core.module_disabled', { module: MODULE_LABELS[opts.module] }))] });
    return false;
  }
  if (opts.guildKinds?.length && config && !opts.guildKinds.includes(config.kind)) {
    await reply(interaction, { embeds: [embedService.error(t('core.wrong_guild_kind'))] });
    return false;
  }
  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  if (opts.permissions?.discord?.length && interaction.inGuild()) {
    const missing = missingDiscordPermissions(member?.permissions ?? null, opts.permissions.discord);
    if (missing.length && !env().OWNER_IDS.includes(interaction.user.id)) {
      await reply(interaction, { embeds: [embedService.error(t('core.missing_permissions', { permissions: missing.join(', ') }))] });
      return false;
    }
  }
  if (opts.permissions?.bot?.length && interaction.guild) {
    const me = interaction.guild.members.me;
    const missing = missingDiscordPermissions(me?.permissions ?? null, opts.permissions.bot);
    if (missing.length) {
      await reply(interaction, { embeds: [embedService.error(t('core.bot_missing_permissions', { permissions: missing.join(', ') }))] });
      return false;
    }
  }
  if (opts.permissions?.internal && opts.permissions.internal !== 'everyone') {
    if (!hasInternalPermission({ member, config, ownerIds: env().OWNER_IDS, required: opts.permissions.internal })) {
      await reply(interaction, { embeds: [embedService.error(t('core.insufficient_level', { level: opts.permissions.internal }))] });
      return false;
    }
  }
  // Permissions par commande configurées depuis le dashboard
  if (opts.commandName && interaction.guildId && member) {
    const key = `${interaction.guildId}:${opts.commandName}`;
    const perm = await commandPermCache.getOrSet(key, async () => {
      const row = await prisma.commandPermission.findUnique({ where: { guildId_commandName: { guildId: interaction.guildId!, commandName: opts.commandName! } } });
      return row ? { roleIds: Array.isArray(row.roleIds) ? (row.roleIds as string[]) : [], enabled: row.enabled } : null;
    });
    if (perm && !env().OWNER_IDS.includes(interaction.user.id)) {
      if (!perm.enabled) {
        await reply(interaction, { embeds: [embedService.error(t('core.command_disabled'))] });
        return false;
      }
      if (perm.roleIds.length && !perm.roleIds.some((r) => member.roles.cache.has(r)) && !member.permissions.has('Administrator')) {
        await reply(interaction, { embeds: [embedService.error(t('core.command_role_required'))] });
        return false;
      }
    }
  }
  return true;
}

export function invalidateCommandPermissions(guildId: string): void {
  commandPermCache.invalidatePrefix(`${guildId}:`);
}

export default defineEvent({
  name: Events.InteractionCreate,
  async execute(client, interaction) {
    // Autocomplete
    if (interaction.isAutocomplete()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd?.autocomplete) return;
      try {
        const ctx = await resolveContext(client, interaction);
        await cmd.autocomplete(interaction, ctx);
      } catch (err) {
        log.error({ err, command: interaction.commandName }, 'Autocomplete error');
        await interaction.respond([]).catch(() => null);
      }
      return;
    }

    let ctx: InteractionContext;
    try {
      ctx = await resolveContext(client, interaction);
    } catch (err) {
      log.error({ err }, 'Impossible de résoudre le contexte');
      if (interaction.isRepliable()) await reply(interaction, { embeds: [embedService.error(translationService.translate(fromDiscordLocale(interaction.locale) ?? DEFAULT_LANGUAGE, 'core.error'))] });
      return;
    }
    const { t } = ctx;

    // Slash commands
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) {
        await reply(interaction, { embeds: [embedService.error(t('core.unknown_command'))] });
        return;
      }
      if (!interaction.inGuild() && !cmd.dmPermission) {
        await reply(interaction, { embeds: [embedService.error(t('core.guild_only'))] });
        return;
      }
      if (!(await checkAccess(interaction, ctx, { module: cmd.module, permissions: cmd.permissions, commandName: cmd.data.name, guildKinds: cmd.guildKinds }))) return;
      const remaining = client.cooldowns.consume(`cmd:${cmd.data.name}`, interaction.user.id, cmd.cooldown ?? COOLDOWN_DEFAULT_SECONDS);
      if (remaining > 0) {
        await reply(interaction, { embeds: [embedService.warning(t('core.cooldown', { time: formatDuration(Math.ceil(remaining / 1000), ctx.lang) }))] });
        return;
      }
      try {
        await cmd.execute(interaction, ctx);
      } catch (err) {
        log.error({ err, command: interaction.commandName, user: interaction.user.id, guild: interaction.guildId }, 'Erreur commande');
        await reply(interaction, { embeds: [embedService.error(t('core.error'))] });
      }
      return;
    }

    // Context menus
    if (interaction.isContextMenuCommand()) {
      const cmd = client.contextMenus.get(interaction.commandName);
      if (!cmd) return;
      if (!(await checkAccess(interaction, ctx, { module: cmd.module, permissions: cmd.permissions, commandName: cmd.data.name }))) return;
      try {
        await cmd.execute(interaction, ctx);
      } catch (err) {
        log.error({ err, command: interaction.commandName }, 'Erreur context menu');
        await reply(interaction, { embeds: [embedService.error(t('core.error'))] });
      }
      return;
    }

    // Composants (boutons, menus, modals)
    const { namespace, args } = parseCustomId(interaction.isMessageComponent() || interaction.isModalSubmit() ? interaction.customId : '');
    if (namespace === 'noop' || namespace === 'pg') return; // gérés par collectors locaux

    let handler: ComponentHandler<never> | undefined;
    if (interaction.isButton()) handler = client.buttons.get(namespace) as ComponentHandler<never> | undefined;
    else if (interaction.isAnySelectMenu()) handler = client.selectMenus.get(namespace) as ComponentHandler<never> | undefined;
    else if (interaction.isModalSubmit()) handler = client.modals.get(namespace) as ComponentHandler<never> | undefined;
    else return;

    if (!handler) {
      log.debug({ namespace }, 'Aucun handler pour ce composant');
      return;
    }
    if (!(await checkAccess(interaction, ctx, { module: handler.module, permissions: handler.permissions }))) return;
    if (handler.cooldown) {
      const remaining = client.cooldowns.consume(`cmp:${namespace}`, interaction.user.id, handler.cooldown);
      if (remaining > 0) {
        await reply(interaction, { embeds: [embedService.warning(t('core.cooldown', { time: formatDuration(Math.ceil(remaining / 1000), ctx.lang) }))] });
        return;
      }
    }
    try {
      await (handler.execute as (i: unknown, a: string[], c: InteractionContext) => Promise<unknown>)(interaction, args, ctx);
    } catch (err) {
      log.error({ err, namespace, args }, 'Erreur composant');
      await reply(interaction, { embeds: [embedService.error(t('core.error'))] });
    }
  },
});
