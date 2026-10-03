import { GuildMember, MessageFlags } from 'discord.js';
import { defineModal } from '../structures';
import { whitelistService, WhitelistError, MAX_QUESTIONS, type WhitelistAnswer, type WhitelistQuestion } from '../services/WhitelistService';
import { embedService } from '../services/EmbedService';
import { env } from '../config/env';
import { hasInternalPermission } from '../utils/permissions';

/**
 * Modals `whitelist:apply:<identifier?>` (candidature), `whitelist:reject:<id>` (note de refus, staff),
 * `whitelist:questions` (configuration des questions, admin).
 */
export default defineModal({
  id: 'whitelist',
  module: 'whitelist',
  async execute(interaction, args, { t, lang, config }) {
    if (!interaction.guildId || !config) return;
    const guildId = interaction.guildId;
    const [action, arg] = args;
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    const can = (required: 'staff' | 'admin') => hasInternalPermission({ member, config, ownerIds: env().OWNER_IDS, required });

    if (action === 'apply') {
      await interaction.deferReply(ephemeral);
      const settings = await whitelistService.getConfig(guildId);
      const questions = whitelistService.resolveQuestions(settings, lang);
      const answers: WhitelistAnswer[] = [];
      for (const q of questions.slice(0, MAX_QUESTIONS)) {
        const value = interaction.fields.fields.has(q.id) ? interaction.fields.getTextInputValue(q.id) : '';
        answers.push({ question: q.label, answer: value.trim().slice(0, 1024) });
      }
      try {
        const row = await whitelistService.apply({ guildId, userId: interaction.user.id, answers, identifier: arg || null });
        await interaction.editReply({ embeds: [embedService.success(t('whitelist.apply.done', { id: row.id }))] });
      } catch (err) {
        if (err instanceof WhitelistError) return interaction.editReply({ embeds: [embedService.error(t(`whitelist.errors.${err.code}`))] });
        throw err;
      }
      return;
    }

    if (action === 'reject') {
      if (!can('staff')) return interaction.reply({ embeds: [embedService.error(t('core.insufficient_level', { level: 'staff' }))], ...ephemeral });
      const id = Number(arg);
      if (!Number.isInteger(id)) return;
      const note = interaction.fields.getTextInputValue('note');
      await interaction.deferReply(ephemeral);
      try {
        const row = await whitelistService.review({ guildId, id, reviewerId: interaction.user.id, decision: 'REJECTED', note });
        if (interaction.message) await interaction.message.edit({ embeds: [whitelistService.buildReviewEmbed(row, lang)], components: whitelistService.buildReviewButtons(row, lang, true) }).catch(() => null);
        await interaction.editReply({ embeds: [embedService.success(t('whitelist.review.rejected', { id: row.id, user: `<@${row.userId}>` }))] });
      } catch (err) {
        if (err instanceof WhitelistError) return interaction.editReply({ embeds: [embedService.error(t(`whitelist.errors.${err.code}`))] });
        throw err;
      }
      return;
    }

    if (action === 'questions') {
      if (!can('admin')) return interaction.reply({ embeds: [embedService.error(t('core.insufficient_level', { level: 'admin' }))], ...ephemeral });
      const questions: WhitelistQuestion[] = [];
      for (let i = 1; i <= MAX_QUESTIONS; i++) {
        const label = interaction.fields.fields.has(`q${i}`) ? interaction.fields.getTextInputValue(`q${i}`).trim() : '';
        if (label) questions.push({ id: `q${i}`, label: label.slice(0, 45), required: true, style: 'paragraph' });
      }
      await whitelistService.updateConfig(guildId, { questions });
      await interaction.reply({ embeds: [embedService.success(t('whitelist.config.questions_saved', { count: questions.length }))], ...ephemeral });
    }
  },
});
