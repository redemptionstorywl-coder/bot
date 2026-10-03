import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import { antiRaidService, type AntiRaidConfig, type AntiRaidConfigInput } from '../../services/AntiRaidService';
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
