import type { AnySelectMenuInteraction } from 'discord.js';
import { defineSelectMenu } from '../structures';
import type { InteractionContext } from '../structures/types';
import { SchoolError, schoolService } from '../services/SchoolService';
import { attempt, describeError, ok, show, unknownAction, warn } from '../panels/_modulesKit';
import { KIND_TAB, SCHOOL_ROLE_FIELDS, isEntityKind, isSchoolRoleKey, renderEntityOrList, renderSchool, type EntityKind } from '../panels/_school';

/**
 * Menus du panneau `/config module:school` (namespace `cfg-school`, admin) :
 *  - `apps` / `announce` (ChannelSelect)       → salons candidatures / annonces
 *  - `role:<STUDENT|TEACHER|STAFF>` (RoleSelect) → rôle Discord du rôle scolaire
 *  - `<kind>` / `<kind>-del` (StringSelect)     → fiche / suppression (kind = class | house | club)
 *  - `set:<kind>:<role|channel|teacher|leader>:<id>` → champ d'une fiche
 *  - `assign:<kind>:<id>` (UserSelect)          → assigne des membres à la classe / maison
 */
export default defineSelectMenu({
  id: 'cfg-school',
  permissions: { internal: 'admin' },
  cooldown: 1,
  async execute(interaction, args, ctx) {
    if (!interaction.inCachedGuild() || !ctx.config) return;
    await handle(interaction, args, ctx);
  },
});

async function handle(interaction: AnySelectMenuInteraction<'cached'>, args: string[], ctx: InteractionContext): Promise<unknown> {
  const { t } = ctx;
  const guild = interaction.guild;
  const opts = { guild, config: ctx.config!, t };
  const [action = '', a = '', b = '', c = ''] = args;
  const value = interaction.values[0] ?? null;

  if (action === 'apps' || action === 'announce') {
    await schoolService.updateConfig(guild.id, action === 'apps' ? { applicationChannelId: value } : { announceChannelId: value });
    return show(interaction, await renderSchool('config', { ...opts, notice: ok(t('school.config.updated')) }));
  }
  if (action === 'role' && isSchoolRoleKey(a)) {
    await schoolService.updateConfig(guild.id, { [SCHOOL_ROLE_FIELDS[a]]: value });
    return show(interaction, await renderSchool('roles', { ...opts, notice: ok(t('school.config.updated')) }));
  }
  if (isEntityKind(action)) return show(interaction, await renderEntityOrList(action, Number(value), opts));

  const del = action.match(/^(class|house|club)-del$/);
  if (del && isEntityKind(del[1])) {
    const kind: EntityKind = del[1];
    const notice = await attempt(t, async () => {
      const id = Number(value);
      const removed = kind === 'class' ? await schoolService.deleteClass(guild.id, id, interaction.user.id) : kind === 'house' ? await schoolService.deleteHouse(guild.id, id, interaction.user.id) : await schoolService.deleteClub(guild.id, id, interaction.user.id);
      return t(`school.${kind}.deleted`, { name: removed.name });
    });
    return show(interaction, await renderSchool(KIND_TAB[kind], { ...opts, notice }));
  }

  if (action === 'set' && isEntityKind(a)) {
    const kind = a;
    const id = Number(c);
    const notice = await attempt(t, async () => {
      if (b === 'role') {
        if (kind === 'class') await schoolService.updateClass(guild.id, id, { roleId: value }, interaction.user.id);
        else if (kind === 'house') await schoolService.updateHouse(guild.id, id, { roleId: value }, interaction.user.id);
        else await schoolService.updateClub(guild.id, id, { roleId: value }, interaction.user.id);
      } else if (b === 'channel' && kind === 'class') await schoolService.updateClass(guild.id, id, { channelId: value }, interaction.user.id);
      else if (b === 'teacher' && kind === 'class') await schoolService.updateClass(guild.id, id, { teacherId: value }, interaction.user.id);
      else if (b === 'leader' && kind === 'club') await schoolService.updateClub(guild.id, id, { leaderId: value }, interaction.user.id);
      else throw new SchoolError(kind === 'class' ? 'class_not_found' : kind === 'house' ? 'house_not_found' : 'club_not_found');
      return t('panels_modules.school.saved');
    });
    return show(interaction, await renderEntityOrList(kind, id, { ...opts, notice }));
  }

  if (action === 'assign' && (a === 'class' || a === 'house') && interaction.isUserSelectMenu()) {
    const kind = a;
    const id = Number(b);
    await interaction.deferUpdate();
    const done: string[] = [];
    const failed: string[] = [];
    for (const userId of interaction.values) {
      try {
        if (kind === 'class') await schoolService.assignClass(guild.id, userId, id, interaction.user.id);
        else await schoolService.assignHouse(guild.id, userId, id, interaction.user.id);
        done.push(`<@${userId}>`);
      } catch (err) {
        const text = describeError(err, t);
        if (text === null) throw err;
        failed.push(`<@${userId}> (${text})`);
      }
    }
    const text = [done.length ? t('panels_modules.school.assigned', { users: done.join(' ') }) : '', failed.length ? t('panels_modules.school.assign_failed', { users: failed.join(', ') }) : ''].filter(Boolean).join('\n');
    return show(interaction, await renderEntityOrList(kind, id, { ...opts, notice: failed.length ? warn(text) : ok(text) }));
  }

  return unknownAction(interaction, t, action);
}
