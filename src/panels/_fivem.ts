import {
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type Guild,
  type ModalBuilder,
} from 'discord.js';
import { FiveMFramework, type FiveMServer } from '@prisma/client';
import { env } from '../config/env';
import { buildCustomId } from '../utils/customId';
import { discordTimestamp } from '../utils/time';
import { embedService } from '../services/EmbedService';
import { fivemService, type ResolvedStatus } from '../services/FiveMService';
import { fivemSyncService } from '../services/FiveMSyncService';
import type { SyncSettingsPatch } from '../services/fivem/sync';
import type { ResolvedGuildConfig } from '../services/GuildConfigService';
import type { Translator } from '../services/TranslationService';
import { PanelError, btn, channelMention, fieldLines, labelled, modal, moduleButton, moduleLine, option, roleMention, row, textInput, truncate, withNotice, type PanelNotice, type PanelPayload, type Row } from './_modulesKit';

/**
 * Panneau `/config module:fivem` — namespace `cfg-fivem` (admin) :
 *  - vue principale : `main`, `module`, `add` (modal), `link` (modal liaison manuelle), `pick` (StringSelect → serveur)
 *  - vue serveur    : `server:<key>`, `maint:<key>`, `players:<key>` (liste éphémère), `test:<key>`, `delete:<key>` → `delete-ok:<key>`,
 *                     `status:<key>` / `counter:<key>` (ChannelSelect), `sync:<key>` (StringSelect multi), `nick:<key>` / `edit:<key>` (modals),
 *                     `roles:<key>` → `role:<linked|online|require>:<key>` (RoleSelect)
 */

export const FIVEM_NS = 'cfg-fivem';
export const fcid = (action: string, ...args: (string | number)[]): string => buildCustomId(FIVEM_NS, action, ...args);

/** Options de synchronisation (booléennes) pilotées par le menu « options actives ». */
export const SYNC_OPTIONS = ['syncBansToDiscord', 'syncBansToGame', 'syncKicks', 'syncNicknames', 'requireDiscord', 'requireWhitelist'] as const;
export type SyncOption = (typeof SYNC_OPTIONS)[number];

export const ROLE_FIELDS = { linked: 'linkedRoleId', online: 'onlineRoleId', require: 'requireRoleId' } as const;
export type RoleFieldKey = keyof typeof ROLE_FIELDS;
export const isRoleField = (v: string | undefined): v is RoleFieldKey => v === 'linked' || v === 'online' || v === 'require';

const LICENSE = /^license2?:[a-z0-9]{8,64}$/i;

// ───── Fonctions pures ─────

/** Sélection du menu « options actives » → patch complet des 6 booléens. */
export function syncPatchFromSelection(values: readonly string[]): Pick<SyncSettingsPatch, SyncOption> {
  const selected = new Set(values);
  return Object.fromEntries(SYNC_OPTIONS.map((k) => [k, selected.has(k)])) as Pick<SyncSettingsPatch, SyncOption>;
}

/** Hôte du serveur : vide = aucun, sinon URL http(s) sans slash final. */
export function normalizeHost(raw: string | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (!/^https?:\/\/[^\s/]+(?:\/\S*)?$/i.test(v)) throw new PanelError('panels_modules.fivem.invalid_host', { value: v });
  return v.replace(/\/+$/, '');
}

export function parseFramework(raw: string | undefined): FiveMFramework {
  return (Object.values(FiveMFramework) as string[]).includes(raw ?? '') ? (raw as FiveMFramework) : FiveMFramework.CUSTOM;
}

export function isValidLicense(raw: string | undefined): boolean {
  return !!raw && LICENSE.test(raw.trim());
}

export const statusIcon = (st: Pick<ResolvedStatus, 'online' | 'maintenance'>): string => (st.maintenance ? '🟠' : st.online ? '🟢' : '🔴');

export function apiBaseUrl(): string {
  return `${env().DASHBOARD_URL.replace(/\/+$/, '')}/api/fivem`;
}

// ───── Rendu ─────

export interface FiveMRenderOptions {
  guild: Guild;
  config: ResolvedGuildConfig;
  t: Translator;
  notice?: PanelNotice;
}

function statusLine(server: FiveMServer, t: Translator): string {
  const st = fivemService.getResolvedStatus(server);
  const players = st.online ? `${st.players}/${st.maxPlayers || '—'}` : t('fivem.status.offline');
  return `${statusIcon(st)} **${server.name}** \`${server.key}\` · ${server.framework} · 👥 ${players}${st.version ? ` · \`${truncate(st.version, 40)}\`` : ''}`;
}

export async function renderMain(opts: FiveMRenderOptions): Promise<PanelPayload> {
  const { guild, config, t, notice } = opts;
  const servers = await fivemService.listServers(guild.id);
  const embed = embedService
    .brand(t('panels_modules.fivem.title', { server: guild.name }))
    .setDescription(withNotice(notice, `${t(servers.length ? 'panels_modules.fivem.hint' : 'panels_modules.fivem.empty')}\n\n${moduleLine(config, 'fivem', t)}`));
  embed.addFields(
    { name: t('panels_modules.fivem.field_servers', { count: servers.length }), value: fieldLines(servers.map((s) => statusLine(s, t)), t('core.none')) },
    { name: t('panels_modules.fivem.field_install'), value: t('panels_modules.fivem.install_short', { url: apiBaseUrl(), guildId: guild.id }) },
  );
  const components: Row[] = [];
  if (servers.length) {
    components.push(
      row(
        new StringSelectMenuBuilder()
          .setCustomId(fcid('pick'))
          .setPlaceholder(truncate(t('panels_modules.fivem.pick_placeholder'), 150))
          .addOptions(
            servers.slice(0, 25).map((s) => {
              const st = fivemService.getResolvedStatus(s);
              return option(s.name, s.key, { description: `${s.key} · ${s.framework} · ${st.online ? `${st.players}/${st.maxPlayers || '—'}` : t('fivem.status.offline')}`, emoji: statusIcon(st) });
            }),
          ),
      ),
    );
  }
  components.push(
    row(
      btn(fcid('add'), t('panels_modules.fivem.btn_add'), ButtonStyle.Success, '➕'),
      btn(fcid('link'), t('panels_modules.fivem.btn_link'), ButtonStyle.Secondary, '🔗'),
      btn(fcid('main'), t('panels_modules.common.refresh'), ButtonStyle.Secondary, '🔄'),
      moduleButton(fcid('module'), 'fivem', config.modules.fivem, t),
    ),
  );
  return { embeds: [embed], components };
}

export function renderServer(server: FiveMServer, opts: FiveMRenderOptions): PanelPayload {
  const { guild, t, notice } = opts;
  const st = fivemService.getResolvedStatus(server);
  const state = st.maintenance ? 'maintenance' : st.online ? 'online' : 'offline';
  const yes = (v: boolean) => (v ? '✅' : '➖');
  const none = t('core.none');
  const embed = embedService
    .brand(`${statusIcon(st)} ${server.name}`)
    .setDescription(withNotice(notice, t('panels_modules.fivem.server_hint')))
    .addFields(
      { name: t('fivem.status.state'), value: t(`fivem.status.${state}`), inline: true },
      { name: t('fivem.status.players'), value: st.online ? `${st.players}/${st.maxPlayers || '—'}` : '—', inline: true },
      { name: t('fivem.status.version'), value: st.version ? `\`${truncate(st.version, 60)}\`` : '—', inline: true },
      { name: t('panels_modules.fivem.field_framework'), value: server.framework, inline: true },
      { name: t('fivem.status.host'), value: server.host ? `\`${truncate(server.host, 80)}\`` : none, inline: true },
      { name: t('fivem.status.last_update'), value: st.lastSeenAt ? discordTimestamp(st.lastSeenAt, 'R') : '—', inline: true },
      { name: t('panels_modules.fivem.field_status_channel'), value: channelMention(server.statusChannelId, none), inline: true },
      { name: t('fivem.sync.counter_channel'), value: channelMention(server.playerCountChannelId, none), inline: true },
      { name: t('panels_modules.fivem.field_nickname'), value: `\`${server.nicknameFormat}\``, inline: true },
      {
        name: t('panels_modules.fivem.field_sync'),
        value: SYNC_OPTIONS.map((k) => `${yes(server[k])} ${t(`panels_modules.fivem.sync_${k}`)}`).join('\n'),
        inline: true,
      },
      {
        name: t('panels_modules.fivem.field_roles'),
        value: [`${t('fivem.sync.linked_role')} : ${roleMention(server.linkedRoleId, none)}`, `${t('fivem.sync.online_role')} : ${roleMention(server.onlineRoleId, none)}`, `${t('fivem.sync.require_role')} : ${roleMention(server.requireRoleId, none)}`].join('\n'),
        inline: true,
      },
      {
        name: t('panels_modules.fivem.field_install'),
        value: t('panels_modules.fivem.install_value', { url: apiBaseUrl(), guildId: guild.id, key: server.key, apiKey: server.apiKey ? t('panels_modules.fivem.api_key_own') : t('panels_modules.fivem.api_key_global') }),
      },
    )
    .setFooter({ text: t('fivem.sync.footer') });

  const key = server.key;
  const status = new ChannelSelectMenuBuilder().setCustomId(fcid('status', key)).setPlaceholder(truncate(t('panels_modules.fivem.status_placeholder'), 150)).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1);
  if (server.statusChannelId) status.setDefaultChannels(server.statusChannelId);
  const counter = new ChannelSelectMenuBuilder().setCustomId(fcid('counter', key)).setPlaceholder(truncate(t('panels_modules.fivem.counter_placeholder'), 150)).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildCategory).setMinValues(0).setMaxValues(1);
  if (server.playerCountChannelId) counter.setDefaultChannels(server.playerCountChannelId);
  const sync = new StringSelectMenuBuilder()
    .setCustomId(fcid('sync', key))
    .setPlaceholder(truncate(t('panels_modules.fivem.sync_placeholder'), 150))
    .setMinValues(0)
    .setMaxValues(SYNC_OPTIONS.length)
    .addOptions(SYNC_OPTIONS.map((k) => option(t(`panels_modules.fivem.sync_${k}`), k, { description: t(`panels_modules.fivem.sync_${k}_desc`), default: server[k] })));

  return {
    embeds: [embed],
    components: [
      row(
        btn(fcid('maint', key), server.maintenance ? t('panels_modules.fivem.btn_maintenance_off') : t('panels_modules.fivem.btn_maintenance_on'), server.maintenance ? ButtonStyle.Primary : ButtonStyle.Secondary, '🛠️'),
        btn(fcid('players', key), t('panels_modules.fivem.btn_players'), ButtonStyle.Secondary, '👥'),
        btn(fcid('test', key), t('panels_modules.fivem.btn_test'), ButtonStyle.Secondary, '📡', !server.host),
        btn(fcid('delete', key), t('core.delete'), ButtonStyle.Danger, '🗑️'),
        btn(fcid('main'), t('core.back'), ButtonStyle.Secondary, '↩️'),
      ),
      row(status),
      row(counter),
      row(sync),
      row(
        btn(fcid('nick', key), t('panels_modules.fivem.btn_nickname'), ButtonStyle.Secondary, '🏷️'),
        btn(fcid('edit', key), t('panels_modules.fivem.btn_edit'), ButtonStyle.Secondary, '⚙️'),
        btn(fcid('roles', key), t('panels_modules.fivem.btn_roles'), ButtonStyle.Primary, '🎭'),
      ),
    ],
  };
}

export function renderRolesView(server: FiveMServer, opts: FiveMRenderOptions): PanelPayload {
  const { t, notice } = opts;
  const none = t('core.none');
  const embed = embedService
    .brand(t('panels_modules.fivem.roles_title', { name: server.name }))
    .setDescription(withNotice(notice, t('panels_modules.fivem.roles_hint')))
    .addFields(
      { name: t('fivem.sync.linked_role'), value: roleMention(server.linkedRoleId, none), inline: true },
      { name: t('fivem.sync.online_role'), value: roleMention(server.onlineRoleId, none), inline: true },
      { name: t('fivem.sync.require_role'), value: roleMention(server.requireRoleId, none), inline: true },
    )
    .setFooter({ text: t('fivem.sync.footer') });
  const select = (field: RoleFieldKey) => {
    const s = new RoleSelectMenuBuilder().setCustomId(fcid('role', field, server.key)).setPlaceholder(truncate(t(`panels_modules.fivem.role_${field}_placeholder`), 150)).setMinValues(0).setMaxValues(1);
    const current = server[ROLE_FIELDS[field]];
    if (current) s.setDefaultRoles(current);
    return row(s);
  };
  return { embeds: [embed], components: [select('linked'), select('online'), select('require'), row(btn(fcid('server', server.key), t('core.back'), ButtonStyle.Secondary, '↩️'))] };
}

export function renderDeleteConfirm(server: FiveMServer, t: Translator): PanelPayload {
  return {
    embeds: [embedService.warning(t('panels_modules.fivem.delete_confirm', { name: server.name, key: server.key }))],
    components: [row(btn(fcid('delete-ok', server.key), t('core.confirm'), ButtonStyle.Danger, '🗑️'), btn(fcid('server', server.key), t('core.cancel'), ButtonStyle.Secondary))],
  };
}

// ───── Modals ─────

function frameworkSelect(current?: FiveMFramework): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId('framework')
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(true)
    .addOptions(Object.values(FiveMFramework).map((f) => option(f, f, { default: f === (current ?? FiveMFramework.CUSTOM) })));
}

export function buildAddModal(t: Translator): ModalBuilder {
  return modal(
    fcid('add'),
    t('panels_modules.fivem.modal_add_title'),
    labelled(t('panels_modules.fivem.modal_key'), textInput('key', TextInputStyle.Short, { required: true, max: 64, placeholder: 'main' }), t('panels_modules.fivem.modal_key_help')),
    labelled(t('panels_modules.fivem.modal_name'), textInput('name', TextInputStyle.Short, { required: true, max: 100 })),
    labelled(t('panels_modules.fivem.modal_framework'), frameworkSelect()),
    labelled(t('panels_modules.fivem.modal_host'), textInput('host', TextInputStyle.Short, { max: 200, placeholder: 'http://1.2.3.4:30120' }), t('panels_modules.fivem.modal_host_help')),
    labelled(t('panels_modules.fivem.modal_api_key'), textInput('apiKey', TextInputStyle.Short, { max: 128 }), t('panels_modules.fivem.modal_api_key_help')),
  );
}

export function buildEditModal(server: FiveMServer, t: Translator): ModalBuilder {
  return modal(
    fcid('edit', server.key),
    t('panels_modules.fivem.modal_edit_title', { name: server.name }),
    labelled(t('panels_modules.fivem.modal_name'), textInput('name', TextInputStyle.Short, { required: true, max: 100, value: server.name })),
    labelled(t('panels_modules.fivem.modal_framework'), frameworkSelect(server.framework)),
    labelled(t('panels_modules.fivem.modal_host'), textInput('host', TextInputStyle.Short, { max: 200, value: server.host, placeholder: 'http://1.2.3.4:30120' }), t('panels_modules.fivem.modal_host_help')),
    labelled(t('panels_modules.fivem.modal_api_key'), textInput('apiKey', TextInputStyle.Short, { max: 128 }), t('panels_modules.fivem.modal_api_key_edit_help')),
  );
}

export function buildNicknameModal(server: FiveMServer, t: Translator): ModalBuilder {
  return modal(
    fcid('nick', server.key),
    t('panels_modules.fivem.modal_nick_title'),
    labelled(t('panels_modules.fivem.modal_nick_format'), textInput('format', TextInputStyle.Short, { required: true, max: 64, value: server.nicknameFormat, placeholder: '{name}' }), t('panels_modules.fivem.modal_nick_help')),
  );
}

export function buildLinkModal(t: Translator): ModalBuilder {
  return modal(
    fcid('link'),
    t('panels_modules.fivem.modal_link_title'),
    labelled(t('panels_modules.fivem.modal_member'), new UserSelectMenuBuilder().setCustomId('member').setMinValues(1).setMaxValues(1).setRequired(true)),
    labelled(t('panels_modules.fivem.modal_license'), textInput('license', TextInputStyle.Short, { required: true, max: 128, placeholder: 'license:0123abcd…' }), t('panels_modules.fivem.modal_license_help')),
  );
}

// ───── Liste des joueurs ─────

export async function buildPlayerPages(server: FiveMServer, t: Translator): Promise<ReturnType<typeof embedService.brand>[]> {
  const players = await fivemService.getPlayers(server);
  if (!players.length) return [embedService.info(t('fivem.players.empty', { name: server.name }))];
  const status = fivemService.getResolvedStatus(server);
  const links = await fivemSyncService.discordIdsFor(server.guildId, players);
  const pages: ReturnType<typeof embedService.brand>[] = [];
  for (let i = 0; i < players.length; i += 20) {
    const group = players.slice(i, i + 20);
    pages.push(
      embedService
        .brand(
          t('fivem.players.title', { name: server.name, count: players.length }),
          group
            .map((p) => {
              const discordId = links.get(p.id);
              return `\`${String(p.id).padStart(3, ' ')}\` **${truncate(p.name, 40)}**${p.ping !== undefined ? ` · ${p.ping} ms` : ''} · ${discordId ? `<@${discordId}>` : t('fivem.players.not_linked')}`;
            })
            .join('\n'),
        )
        .setFooter({ text: `${t('core.page', { current: pages.length + 1, total: Math.ceil(players.length / 20) })}${status.lastSeenAt ? ` • ${t('fivem.status.last_update')} ${status.lastSeenAt.toISOString().slice(11, 16)} UTC` : ''}` }),
    );
  }
  return pages;
}
