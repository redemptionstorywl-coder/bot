import { ActionRowBuilder, GuildMember, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { SchoolRole } from '@prisma/client';
import { defineModal } from '../structures';
import { schoolService, SchoolError, type SchoolAnswer } from '../services/SchoolService';
import { embedService } from '../services/EmbedService';
import { env } from '../config/env';
import { hasInternalPermission } from '../utils/permissions';
import { buildCustomId } from '../utils/customId';

/** Modals `school:register`, `school:apply:<ROLE>`, `school:reject:<id>`. */
export default defineModal({
  id: 'school',
  module: 'school',
  async execute(interaction, args, { t, lang, config }) {
    if (!interaction.guildId || !config) return;
    const guildId = interaction.guildId;
    const [action, arg] = args;
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    const field = (id: string) => (interaction.fields.fields.has(id) ? interaction.fields.getTextInputValue(id).trim() : '');

    try {
      if (action === 'register') {
        await interaction.deferReply(ephemeral);
        await schoolService.register({ guildId, userId: interaction.user.id, firstName: field('firstName'), lastName: field('lastName'), bio: field('bio') || null });
        const [classes, houses] = await Promise.all([schoolService.listClasses(guildId), schoolService.listHouses(guildId)]);
        const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
        if (classes.length) rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(buildCustomId('school', 'class')).setPlaceholder(t('school.register.pick_class').slice(0, 150)).addOptions(classes.slice(0, 25).map((c) => ({ label: c.name.slice(0, 100), value: String(c.id), description: c.capacity ? `${c._count.students}/${c.capacity}` : undefined })))));
        if (houses.length) rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(buildCustomId('school', 'house')).setPlaceholder(t('school.register.pick_house').slice(0, 150)).addOptions(houses.slice(0, 25).map((h) => ({ label: h.name.slice(0, 100), value: String(h.id), emoji: h.emoji ?? undefined })))));
        await interaction.editReply({ embeds: [embedService.success(rows.length ? t('school.register.done_pick') : t('school.register.done'))], components: rows });
        return;
      }

      if (action === 'apply') {
        const role = (Object.values(SchoolRole) as string[]).includes(arg ?? '') ? (arg as SchoolRole) : SchoolRole.STUDENT;
        await interaction.deferReply(ephemeral);
        const answers: SchoolAnswer[] = [
          { question: t('school.apply.q_identity'), answer: field('identity') },
          { question: t('school.apply.q_motivation'), answer: field('motivation') },
          { question: t('school.apply.q_experience'), answer: field('experience') },
          { question: t('school.apply.q_availability'), answer: field('availability') },
        ].filter((a) => a.answer);
        const app = await schoolService.apply({ guildId, userId: interaction.user.id, role, answers });
        await interaction.editReply({ embeds: [embedService.success(t('school.apply.done', { id: app.id }))] });
        return;
      }

      if (action === 'reject') {
        const member = interaction.member instanceof GuildMember ? interaction.member : null;
        if (!hasInternalPermission({ member, config, ownerIds: env().OWNER_IDS, required: 'staff' })) return interaction.reply({ embeds: [embedService.error(t('core.insufficient_level', { level: 'staff' }))], ...ephemeral });
        const id = Number(arg);
        if (!Number.isInteger(id)) return;
        await interaction.deferReply(ephemeral);
        const app = await schoolService.reviewApplication({ guildId, id, reviewerId: interaction.user.id, decision: 'REJECTED', note: field('note') });
        if (interaction.message) await interaction.message.edit({ embeds: [schoolService.buildApplicationEmbed(app, lang)], components: schoolService.buildApplicationButtons(app, lang, true) }).catch(() => null);
        await interaction.editReply({ embeds: [embedService.success(t('school.application.rejected', { id: app.id, user: `<@${app.userId}>` }))] });
      }
    } catch (err) {
      if (err instanceof SchoolError) {
        const embeds = [embedService.error(t(`school.errors.${err.code}`))];
        if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds });
        else await interaction.reply({ embeds, ...ephemeral });
        return;
      }
      throw err;
    }
  },
});
