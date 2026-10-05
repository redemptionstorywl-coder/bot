import { Events, GuildMember, MessageFlags, PermissionFlagsBits, type BaseInteraction, type RepliableInteraction } from 'discord.js';
import { defineEvent } from '../structures';
import type { Command, CommandPermissions, ComponentHandler, InteractionContext } from '../structures/types';
import type { RedemptionClient } from '../core/Client';
import { resolveContext } from '../core/context';
import { env } from '../config/env';
import { embedService } from '../services/EmbedService';
import { LOCKED_COMMANDS, commandPermissionService, decideCommandAccess, type AccessDecision } from '../services/CommandPermissionService';
import { hasInternalPermission, missingDiscordPermissions, resolveInternalLevel } from '../utils/permissions';
import { parseCustomId } from '../utils/customId';
import { liveRoles } from '../utils/liveIds';
import { childLogger } from '../utils/logger';
import { COOLDOWN_DEFAULT_SECONDS, DEFAULT_LANGUAGE, MODULE_LABELS, fromDiscordLocale, type ModuleKey } from '../config/constants';
import { translationService } from '../services/TranslationService';
import { formatDuration } from '../utils/time';

const log = childLogger('Interactions');

async function reply(interaction: RepliableInteraction, content: { embeds: ReturnType<typeof embedService.error>[] }): Promise<void> {
  const payload = { ...content, flags: MessageFlags.Ephemeral } as const;
  // Interaction différée sans contenu : on remplace le « réfléchit… » (un followUp le laisserait bloqué).
  if (interaction.deferred && !interaction.replied) await interaction.editReply({ embeds: content.embeds }).catch(() => null);
  else if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
  else await interaction.reply(payload).catch(() => null);
}

/** Rôles du membre, qu'il s'agisse d'un GuildMember (cache) ou d'un membre brut de l'API. */
function memberRoleIds(member: BaseInteraction['member']): string[] {
  if (!member) return [];
  if (member instanceof GuildMember) return [...member.roles.cache.keys()];
  return Array.isArray(member.roles) ? [...member.roles] : [];
}

/**
 * Décision de la règle de permissions par rôle (`/config module:permissions`, dashboard) pour une commande :
 * propriétaire du serveur / OWNER_IDS → 'allow' ; sans serveur ni commande → 'default'.
 */
export async function resolveCommandAccess(interaction: BaseInteraction, commandName: string | null | undefined): Promise<AccessDecision> {
  if (!commandName || !interaction.inGuild()) return 'default';
  const isOwner = env().OWNER_IDS.includes(interaction.user.id) || interaction.guild?.ownerId === interaction.user.id;
  if (isOwner) return 'allow';
  const rule = await commandPermissionService.get(interaction.guildId, commandName).catch((err) => {
    log.warn({ err, guild: interaction.guildId, command: commandName }, 'Règle de permission illisible : vérifications par défaut');
    return null;
  });
  return decideCommandAccess({
    rule,
    memberRoleIds: memberRoleIds(interaction.member),
    isOwner,
    isDiscordAdmin: interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
    locked: LOCKED_COMMANDS.includes(commandName),
  });
}

/** Message de refus d'une commande désactivée / réservée à des rôles (cite les rôles autorisés encore présents). */
async function denialText(interaction: BaseInteraction, ctx: InteractionContext, decision: 'deny_disabled' | 'deny_role', commandName: string): Promise<string> {
  const command = `/${commandName}`;
  if (decision === 'deny_disabled') return ctx.t('permissions.denied.disabled', { command });
  const rule = interaction.guildId ? await commandPermissionService.get(interaction.guildId, commandName).catch(() => null) : null;
  const roles = liveRoles(interaction.guild, rule?.roleIds ?? []);
  return roles.length ? ctx.t('permissions.denied.role', { command, roles: roles.map((r) => `<@&${r}>`).join(', ') }) : ctx.t('permissions.denied.role_gone', { command });
}

interface AccessOptions {
  module?: ModuleKey;
  permissions?: CommandPermissions;
  guildKinds?: Command['guildKinds'];
  /** Commande dont la règle de permissions par rôle s'applique (slash, ou commande rattachée à un composant). */
  commandName?: string | null;
  /**
   * true : un refus de la règle (commande désactivée, rôle absent) bloque l'interaction.
   * false (composant rattaché implicitement) : seule l'autorisation par rôle est appliquée ; un refus retombe sur les vérifications par défaut.
   */
  enforce?: boolean;
}

/**
 * Vérifie module, type de serveur, règle de permissions par rôle, puis permissions Discord + niveau interne.
 * Règle 'allow' (rôle autorisé, administrateur Discord ou propriétaire) : niveau interne et permissions Discord de
 * l'utilisateur ignorés — les permissions du BOT restent vérifiées.
 */
async function checkAccess(interaction: BaseInteraction & RepliableInteraction, ctx: InteractionContext, opts: AccessOptions): Promise<boolean> {
  const { t, config } = ctx;
  if (opts.module && config && !config.modules[opts.module]) {
    await reply(interaction, { embeds: [embedService.error(t('core.module_disabled', { module: MODULE_LABELS[opts.module] }))] });
    return false;
  }
  if (opts.guildKinds?.length && config && !opts.guildKinds.includes(config.kind)) {
    await reply(interaction, { embeds: [embedService.error(t('core.wrong_guild_kind'))] });
    return false;
  }
  const decision = await resolveCommandAccess(interaction, opts.commandName);
  if ((decision === 'deny_disabled' || decision === 'deny_role') && opts.enforce) {
    await reply(interaction, { embeds: [embedService.error(await denialText(interaction, ctx, decision, opts.commandName!))] });
    return false;
  }
  const allowed = decision === 'allow';
  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  const level = resolveInternalLevel(member, config, env().OWNER_IDS);
  // Les administrateurs du bot (rôles admin configurés, 🛡️ RS Team, owners) ne sont pas limités par les permissions Discord.
  const bypassDiscordPerms = allowed || level === 'admin' || level === 'owner';
  if (opts.permissions?.discord?.length && interaction.inGuild() && !bypassDiscordPerms) {
    const missing = missingDiscordPermissions(member?.permissions ?? null, opts.permissions.discord);
    if (missing.length) {
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
  if (!allowed && opts.permissions?.internal && opts.permissions.internal !== 'everyone') {
    if (!hasInternalPermission({ member, config, ownerIds: env().OWNER_IDS, required: opts.permissions.internal })) {
      await reply(interaction, { embeds: [embedService.error(t('core.insufficient_level', { level: opts.permissions.internal }))] });
      return false;
    }
  }
  return true;
}

/**
 * Commande à laquelle un composant est rattaché : `handler.command` (explicite, refus appliqués), sinon la commande
 * slash dont le message porteur est la réponse (implicite : autorisation par rôle seulement).
 */
export function componentCommand(client: RedemptionClient, interaction: BaseInteraction, handler: Pick<ComponentHandler<never>, 'command'>): { name: string | null; explicit: boolean } {
  if (handler.command) return { name: handler.command, explicit: true };
  const message = interaction.isMessageComponent() || interaction.isModalSubmit() ? interaction.message : null;
  // `message.interaction` (déprécié) est le seul champ qui donne le nom de la commande d'origine.
  const name = message?.interaction?.commandName?.split(' ')[0] ?? null;
  return { name: name && client.commands.has(name) ? name : null, explicit: false };
}

/** Invalide le cache des règles de permissions d'un serveur (appelé par le dashboard après modification). */
export function invalidateCommandPermissions(guildId: string): void {
  commandPermissionService.invalidate(guildId);
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
      if (!(await checkAccess(interaction, ctx, { module: cmd.module, permissions: cmd.permissions, commandName: cmd.data.name, guildKinds: cmd.guildKinds, enforce: true }))) return;
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
      if (!(await checkAccess(interaction, ctx, { module: cmd.module, permissions: cmd.permissions, commandName: cmd.data.name, enforce: true }))) return;
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
    const attached = componentCommand(client, interaction, handler);
    if (!(await checkAccess(interaction, ctx, { module: handler.module, permissions: handler.permissions, commandName: attached.name, enforce: attached.explicit }))) return;
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
