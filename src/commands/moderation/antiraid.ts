import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { antiRaidService, type AntiRaidConfig, type AntiRaidConfigInput } from '../../services/AntiRaidService';
import { antiNukeService, ANTI_NUKE_ACTIONS, ANTI_NUKE_PUNISHMENTS, type AntiNukeAction, type AntiNukeConfig, type AntiNukePunishment } from '../../services/AntiNukeService';
import { embedService } from '../../services/EmbedService';
import { formatDuration, parseDuration } from '../../utils/time';
import { EPHEMERAL, MOD_PERMS, replyError } from './_shared';
import type { InteractionContext } from '../../structures/types';

function state(t: InteractionContext['t'], enabled: boolean): string {
  return enabled ? `🟢 ${t('core.enabled')}` : `🔴 ${t('core.disabled')}`;
}

function statusEmbed(ctx: InteractionContext, server: string, cfg: AntiRaidConfig) {
  const { t, lang } = ctx;
  return embedService.brand(t('moderation.antiraid.status_title', { server })).addFields(
    { name: `${state(t, cfg.antiSpam.enabled)} • ${t('moderation.antiraid.names.spam')}`, value: t('moderation.antiraid.desc.spam', { max: cfg.antiSpam.maxMessages, seconds: cfg.antiSpam.intervalSeconds, timeout: formatDuration(cfg.antiSpam.timeoutSeconds, lang) }), inline: false },
    { name: `${state(t, cfg.antiMassMention.enabled)} • ${t('moderation.antiraid.names.mentions')}`, value: t('moderation.antiraid.desc.mentions', { max: cfg.antiMassMention.maxMentions, timeout: formatDuration(cfg.antiMassMention.timeoutSeconds, lang) }), inline: false },
    {
      name: `${state(t, cfg.antiLink.enabled)} • ${t('moderation.antiraid.names.links')}`,
      value: t('moderation.antiraid.desc.links', { invites: cfg.antiLink.blockInvites ? t('core.yes') : t('core.no'), links: cfg.antiLink.blockLinks ? t('core.yes') : t('core.no'), action: t(`moderation.antiraid.link_actions.${cfg.antiLink.action}`), whitelist: cfg.antiLink.whitelistDomains.join(', ') || t('core.none') }),
      inline: false,
    },
    {
      name: `${state(t, cfg.antiNewAccount.enabled)} • ${t('moderation.antiraid.names.new_account')}`,
      value: t('moderation.antiraid.desc.new_account', { days: cfg.antiNewAccount.minAgeDays, action: t(`moderation.antiraid.account_actions.${cfg.antiNewAccount.action}`), role: cfg.antiNewAccount.quarantineRoleId ? `<@&${cfg.antiNewAccount.quarantineRoleId}>` : t('core.none') }),
      inline: false,
    },
    { name: `${state(t, cfg.antiBot.enabled)} • ${t('moderation.antiraid.names.bots')}`, value: t('moderation.antiraid.desc.bots', { allowed: cfg.antiBot.allowedBotIds.map((id) => `<@${id}>`).join(' ') || t('core.none') }), inline: false },
    { name: `${state(t, cfg.antiMassJoin.enabled)} • ${t('moderation.antiraid.names.mass_join')}`, value: t('moderation.antiraid.desc.mass_join', { max: cfg.antiMassJoin.maxJoins, seconds: cfg.antiMassJoin.intervalSeconds, lockdown: cfg.antiMassJoin.lockdown ? t('core.yes') : t('core.no') }), inline: false },
    { name: t('moderation.antiraid.names.exempt'), value: t('moderation.antiraid.desc.exempt', { roles: cfg.exemptRoleIds.map((r) => `<@&${r}>`).join(' ') || t('core.none'), channels: cfg.exemptChannelIds.map((c) => `<#${c}>`).join(' ') || t('core.none') }), inline: false },
  );
}

function nukeStatusEmbed(ctx: InteractionContext, server: string, cfg: AntiNukeConfig) {
  const { t } = ctx;
  const thresholds = ANTI_NUKE_ACTIONS.map((a) => `• ${t(`moderation.antinuke.actions.${a}`)} : **${cfg.thresholds[a].max}** / ${cfg.thresholds[a].intervalSeconds}s`).join('\n');
  return embedService
    .brand(t('moderation.antinuke.status_title', { server }))
    .setDescription(`${state(t, cfg.enabled)} • ${t('moderation.antinuke.summary')}`)
    .addFields(
      { name: t('moderation.antinuke.names.thresholds'), value: thresholds, inline: false },
      { name: t('moderation.antinuke.names.punishment'), value: t(`moderation.antinuke.punishments.${cfg.punishment}`), inline: true },
      { name: t('moderation.antinuke.names.bot_add'), value: cfg.botAddProtection ? t('core.yes') : t('core.no'), inline: true },
      { name: t('moderation.antinuke.names.lockdown'), value: cfg.lockdownOnTrigger ? t('core.yes') : t('core.no'), inline: true },
      { name: t('moderation.antinuke.names.restore_bans'), value: cfg.restoreBans ? t('core.yes') : t('core.no'), inline: true },
      { name: t('moderation.antinuke.names.dm'), value: cfg.dmExecutor ? t('core.yes') : t('core.no'), inline: true },
      { name: t('moderation.antinuke.names.exempt_team'), value: cfg.exemptTeamRoles ? t('core.yes') : t('core.no'), inline: true },
      { name: t('moderation.antinuke.names.whitelist'), value: t('moderation.antinuke.desc.whitelist', { users: cfg.whitelistUserIds.map((id) => `<@${id}>`).join(' ') || t('core.none') }), inline: false },
    );
}

const NUKE_ACTION_CHOICES = ANTI_NUKE_ACTIONS.map((a) => ({ name: a, value: a }));

export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('antiraid')
    .setDescription('Configurer les protections anti-raid')
    .addSubcommand((s) => s.setName('status').setDescription('Voir la configuration anti-raid'))
    .addSubcommand((s) =>
      s
        .setName('spam')
        .setDescription('Anti-spam : N messages en X secondes → timeout + suppression')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?'))
        .addIntegerOption((o) => o.setName('max_messages').setDescription('Messages max dans la fenêtre (2-50)').setMinValue(2).setMaxValue(50))
        .addIntegerOption((o) => o.setName('interval').setDescription('Fenêtre en secondes (1-120)').setMinValue(1).setMaxValue(120))
        .addStringOption((o) => o.setName('timeout').setDescription('Durée du timeout (ex: 10m)')),
    )
    .addSubcommand((s) =>
      s
        .setName('mentions')
        .setDescription('Anti-mass-mention : N mentions dans un message')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?'))
        .addIntegerOption((o) => o.setName('max_mentions').setDescription('Mentions max par message (2-100)').setMinValue(2).setMaxValue(100))
        .addStringOption((o) => o.setName('timeout').setDescription('Durée du timeout (ex: 10m)')),
    )
    .addSubcommand((s) =>
      s
        .setName('links')
        .setDescription('Anti-lien / anti-invitation / anti-pub')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?'))
        .addBooleanOption((o) => o.setName('block_invites').setDescription('Bloquer les invitations Discord'))
        .addBooleanOption((o) => o.setName('block_links').setDescription('Bloquer tous les liens hors liste blanche'))
        .addStringOption((o) => o.setName('action').setDescription('Action').addChoices({ name: 'Supprimer', value: 'DELETE' }, { name: 'Supprimer + timeout', value: 'TIMEOUT' }))
        .addStringOption((o) => o.setName('timeout').setDescription('Durée du timeout (ex: 5m)')),
    )
    .addSubcommand((s) =>
      s
        .setName('whitelist')
        .setDescription('Liste blanche de domaines (anti-lien)')
        .addStringOption((o) => o.setName('mode').setDescription('Ajouter ou retirer').setRequired(true).addChoices({ name: 'Ajouter', value: 'add' }, { name: 'Retirer', value: 'remove' }))
        .addStringOption((o) => o.setName('domain').setDescription('Domaine (ex: youtube.com)').setRequired(true).setMaxLength(253)),
    )
    .addSubcommand((s) =>
      s
        .setName('new-account')
        .setDescription('Anti-compte récent : âge minimum du compte')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?'))
        .addIntegerOption((o) => o.setName('min_age_days').setDescription('Âge minimum en jours (1-365)').setMinValue(1).setMaxValue(365))
        .addStringOption((o) => o.setName('action').setDescription('Action').addChoices({ name: 'Expulser', value: 'KICK' }, { name: 'Rôle quarantaine', value: 'QUARANTINE' }))
        .addRoleOption((o) => o.setName('quarantine_role').setDescription('Rôle quarantaine')),
    )
    .addSubcommand((s) =>
      s
        .setName('bots')
        .setDescription('Anti-bot : expulse les bots non autorisés (sauf ajoutés par un admin)')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?'))
        .addUserOption((o) => o.setName('allow').setDescription('Autoriser ce bot'))
        .addUserOption((o) => o.setName('disallow').setDescription('Retirer ce bot de la liste')),
    )
    .addSubcommand((s) =>
      s
        .setName('mass-join')
        .setDescription('Anti-mass-join : N arrivées en X secondes → lockdown')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?'))
        .addIntegerOption((o) => o.setName('max_joins').setDescription('Arrivées max dans la fenêtre (2-500)').setMinValue(2).setMaxValue(500))
        .addIntegerOption((o) => o.setName('interval').setDescription('Fenêtre en secondes (1-600)').setMinValue(1).setMaxValue(600))
        .addBooleanOption((o) => o.setName('lockdown').setDescription('Déclencher le lockdown automatiquement')),
    )
    .addSubcommand((s) =>
      s
        .setName('exempt')
        .setDescription('Rôles / salons exemptés des protections')
        .addStringOption((o) => o.setName('mode').setDescription('Ajouter ou retirer').setRequired(true).addChoices({ name: 'Ajouter', value: 'add' }, { name: 'Retirer', value: 'remove' }))
        .addRoleOption((o) => o.setName('role').setDescription('Rôle'))
        .addChannelOption((o) => o.setName('channel').setDescription('Salon').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice)),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('nuke')
        .setDescription('Anti-nuke : protection contre les comptes compromis / applications malveillantes')
        .addSubcommand((s) => s.setName('status').setDescription('Voir la configuration anti-nuke'))
        .addSubcommand((s) => s.setName('enable').setDescription('Activer l’anti-nuke'))
        .addSubcommand((s) => s.setName('disable').setDescription('Désactiver l’anti-nuke'))
        .addSubcommand((s) =>
          s
            .setName('threshold')
            .setDescription('Seuil d’une action : N actions en X secondes')
            .addStringOption((o) => o.setName('action').setDescription('Action surveillée').setRequired(true).addChoices(...NUKE_ACTION_CHOICES))
            .addIntegerOption((o) => o.setName('max').setDescription('Actions max dans la fenêtre (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
            .addIntegerOption((o) => o.setName('seconds').setDescription('Fenêtre en secondes (1-600)').setRequired(true).setMinValue(1).setMaxValue(600)),
        )
        .addSubcommand((s) =>
          s
            .setName('punishment')
            .setDescription('Punition appliquée à l’exécuteur (un bot est toujours banni)')
            .addStringOption((o) => o.setName('mode').setDescription('Mode').setRequired(true).addChoices({ name: 'Retirer les rôles dangereux', value: 'STRIP_ROLES' }, { name: 'Expulser', value: 'KICK' }, { name: 'Bannir', value: 'BAN' })),
        )
        .addSubcommand((s) =>
          s
            .setName('whitelist')
            .setDescription('Utilisateurs de confiance jamais sanctionnés par l’anti-nuke')
            .addStringOption((o) => o.setName('mode').setDescription('Ajouter ou retirer').setRequired(true).addChoices({ name: 'Ajouter', value: 'add' }, { name: 'Retirer', value: 'remove' }))
            .addUserOption((o) => o.setName('user').setDescription('Utilisateur').setRequired(true)),
        )
        .addSubcommand((s) => s.setName('lockdown').setDescription('Lockdown automatique au déclenchement').addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?').setRequired(true)))
        .addSubcommand((s) => s.setName('bot-add').setDescription('Expulser tout bot ajouté par un non-exempté et sanctionner l’ajouteur').addBooleanOption((o) => o.setName('enabled').setDescription('Activer ?').setRequired(true)))
        .addSubcommand((s) =>
          s
            .setName('options')
            .setDescription('Options : rétablir les bans, DM à l’exécuteur, exempter les rôles équipe')
            .addBooleanOption((o) => o.setName('restore_bans').setDescription('Dé-bannir les membres bannis par l’exécuteur'))
            .addBooleanOption((o) => o.setName('dm').setDescription('Envoyer un DM à l’exécuteur humain'))
            .addBooleanOption((o) => o.setName('exempt_team').setDescription('Exempter les rôles équipe / admin configurés (déconseillé)')),
        ),
    ),
  module: 'antiraid',
  permissions: MOD_PERMS.admin,
  cooldown: 2,
  async execute(interaction, ctx) {
    if (!interaction.guild) return;
    const { t } = ctx;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    const cfg = await antiRaidService.getConfig(guildId);
    const opt = interaction.options;

    if (interaction.options.getSubcommandGroup(false) === 'nuke') {
      const nuke = cfg.antiNuke;
      let next: AntiNukeConfig | null = null;
      switch (sub) {
        case 'status':
          await interaction.reply({ embeds: [nukeStatusEmbed(ctx, interaction.guild.name, nuke)], ...EPHEMERAL });
          return;
        case 'enable':
          next = { ...nuke, enabled: true };
          break;
        case 'disable':
          next = { ...nuke, enabled: false };
          break;
        case 'threshold': {
          const action = opt.getString('action', true) as AntiNukeAction;
          if (!ANTI_NUKE_ACTIONS.includes(action)) return replyError(interaction, ctx, 'core.invalid_input', { details: action });
          next = { ...nuke, thresholds: { ...nuke.thresholds, [action]: { max: opt.getInteger('max', true), intervalSeconds: opt.getInteger('seconds', true) } } };
          break;
        }
        case 'punishment': {
          const mode = opt.getString('mode', true) as AntiNukePunishment;
          if (!ANTI_NUKE_PUNISHMENTS.includes(mode)) return replyError(interaction, ctx, 'core.invalid_input', { details: mode });
          next = { ...nuke, punishment: mode };
          break;
        }
        case 'whitelist': {
          const mode = opt.getString('mode', true);
          const user = opt.getUser('user', true);
          const list = mode === 'add' ? [...new Set([...nuke.whitelistUserIds, user.id])] : nuke.whitelistUserIds.filter((id) => id !== user.id);
          next = { ...nuke, whitelistUserIds: list };
          break;
        }
        case 'lockdown':
          next = { ...nuke, lockdownOnTrigger: opt.getBoolean('enabled', true) };
          break;
        case 'bot-add':
          next = { ...nuke, botAddProtection: opt.getBoolean('enabled', true) };
          break;
        case 'options':
          next = { ...nuke, restoreBans: opt.getBoolean('restore_bans') ?? nuke.restoreBans, dmExecutor: opt.getBoolean('dm') ?? nuke.dmExecutor, exemptTeamRoles: opt.getBoolean('exempt_team') ?? nuke.exemptTeamRoles };
          break;
      }
      if (!next) return;
      try {
        const updated = await antiNukeService.updateConfig(guildId, next);
        await interaction.reply({ embeds: [nukeStatusEmbed(ctx, interaction.guild.name, updated).setDescription(`${state(t, updated.enabled)} • ${t('moderation.antinuke.updated')}`)], ...EPHEMERAL });
      } catch (err) {
        await replyError(interaction, ctx, 'core.invalid_input', { details: err instanceof Error ? err.message.slice(0, 200) : '?' });
      }
      return;
    }

    const readTimeout = (): number | undefined | 'invalid' => {
      const raw = opt.getString('timeout');
      if (!raw) return undefined;
      const sec = parseDuration(raw);
      return sec && sec >= 60 && sec <= 28 * 86400 ? sec : 'invalid';
    };

    let patch: Partial<AntiRaidConfigInput> | null = null;
    switch (sub) {
      case 'status': {
        await interaction.reply({ embeds: [statusEmbed(ctx, interaction.guild.name, cfg)], ...EPHEMERAL });
        return;
      }
      case 'spam': {
        const timeout = readTimeout();
        if (timeout === 'invalid') return replyError(interaction, ctx, 'moderation.errors.invalid_timeout_duration');
        patch = { antiSpam: { ...cfg.antiSpam, enabled: opt.getBoolean('enabled') ?? cfg.antiSpam.enabled, maxMessages: opt.getInteger('max_messages') ?? cfg.antiSpam.maxMessages, intervalSeconds: opt.getInteger('interval') ?? cfg.antiSpam.intervalSeconds, timeoutSeconds: timeout ?? cfg.antiSpam.timeoutSeconds } };
        break;
      }
      case 'mentions': {
        const timeout = readTimeout();
        if (timeout === 'invalid') return replyError(interaction, ctx, 'moderation.errors.invalid_timeout_duration');
        patch = { antiMassMention: { ...cfg.antiMassMention, enabled: opt.getBoolean('enabled') ?? cfg.antiMassMention.enabled, maxMentions: opt.getInteger('max_mentions') ?? cfg.antiMassMention.maxMentions, timeoutSeconds: timeout ?? cfg.antiMassMention.timeoutSeconds } };
        break;
      }
      case 'links': {
        const timeout = readTimeout();
        if (timeout === 'invalid') return replyError(interaction, ctx, 'moderation.errors.invalid_timeout_duration');
        patch = {
          antiLink: {
            ...cfg.antiLink,
            enabled: opt.getBoolean('enabled') ?? cfg.antiLink.enabled,
            blockInvites: opt.getBoolean('block_invites') ?? cfg.antiLink.blockInvites,
            blockLinks: opt.getBoolean('block_links') ?? cfg.antiLink.blockLinks,
            action: (opt.getString('action') as AntiRaidConfig['antiLink']['action'] | null) ?? cfg.antiLink.action,
            timeoutSeconds: timeout ?? cfg.antiLink.timeoutSeconds,
          },
        };
        break;
      }
      case 'whitelist': {
        const mode = opt.getString('mode', true);
        const domain = opt.getString('domain', true).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return replyError(interaction, ctx, 'core.invalid_input', { details: domain });
        const list = mode === 'add' ? [...new Set([...cfg.antiLink.whitelistDomains, domain])] : cfg.antiLink.whitelistDomains.filter((d) => d !== domain);
        patch = { antiLink: { ...cfg.antiLink, whitelistDomains: list } };
        break;
      }
      case 'new-account': {
        const role = opt.getRole('quarantine_role');
        patch = {
          antiNewAccount: {
            ...cfg.antiNewAccount,
            enabled: opt.getBoolean('enabled') ?? cfg.antiNewAccount.enabled,
            minAgeDays: opt.getInteger('min_age_days') ?? cfg.antiNewAccount.minAgeDays,
            action: (opt.getString('action') as AntiRaidConfig['antiNewAccount']['action'] | null) ?? cfg.antiNewAccount.action,
            quarantineRoleId: role?.id ?? cfg.antiNewAccount.quarantineRoleId,
          },
        };
        if (patch.antiNewAccount!.action === 'QUARANTINE' && !patch.antiNewAccount!.quarantineRoleId) return replyError(interaction, ctx, 'moderation.antiraid.errors.quarantine_role_required');
        break;
      }
      case 'bots': {
        const allow = opt.getUser('allow');
        const disallow = opt.getUser('disallow');
        if (allow && !allow.bot) return replyError(interaction, ctx, 'moderation.antiraid.errors.not_a_bot');
        let allowed = [...cfg.antiBot.allowedBotIds];
        if (allow) allowed = [...new Set([...allowed, allow.id])];
        if (disallow) allowed = allowed.filter((id) => id !== disallow.id);
        patch = { antiBot: { enabled: opt.getBoolean('enabled') ?? cfg.antiBot.enabled, allowedBotIds: allowed } };
        break;
      }
      case 'mass-join': {
        patch = { antiMassJoin: { enabled: opt.getBoolean('enabled') ?? cfg.antiMassJoin.enabled, maxJoins: opt.getInteger('max_joins') ?? cfg.antiMassJoin.maxJoins, intervalSeconds: opt.getInteger('interval') ?? cfg.antiMassJoin.intervalSeconds, lockdown: opt.getBoolean('lockdown') ?? cfg.antiMassJoin.lockdown } };
        break;
      }
      case 'exempt': {
        const mode = opt.getString('mode', true);
        const role = opt.getRole('role');
        const channel = opt.getChannel('channel');
        if (!role && !channel) return replyError(interaction, ctx, 'moderation.antiraid.errors.role_or_channel');
        const roles = role ? (mode === 'add' ? [...new Set([...cfg.exemptRoleIds, role.id])] : cfg.exemptRoleIds.filter((r) => r !== role.id)) : cfg.exemptRoleIds;
        const channels = channel ? (mode === 'add' ? [...new Set([...cfg.exemptChannelIds, channel.id])] : cfg.exemptChannelIds.filter((c) => c !== channel.id)) : cfg.exemptChannelIds;
        patch = { exemptRoleIds: roles, exemptChannelIds: channels };
        break;
      }
    }
    if (!patch) return;
    try {
      const updated = await antiRaidService.updateConfig(guildId, patch);
      antiRaidService.invalidate(guildId);
      await interaction.reply({ embeds: [statusEmbed(ctx, interaction.guild.name, updated).setDescription(t('moderation.antiraid.updated'))], ...EPHEMERAL });
    } catch (err) {
      await replyError(interaction, ctx, 'core.invalid_input', { details: err instanceof Error ? err.message.slice(0, 200) : '?' });
    }
  },
});
