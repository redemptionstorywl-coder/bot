import { GuildMember, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type AnySelectMenuInteraction, type ModalSubmitInteraction } from 'discord.js';
import { buildCustomId } from '../utils/customId';
import type { InteractionContext } from '../structures/types';
import { env } from '../config/env';
import { hasInternalPermission } from '../utils/permissions';
import { embedService } from '../services/EmbedService';

type EditorInteraction = ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction;

/** Actions publiques du namespace `rolemenu` (tout le monde) ; le reste est réservé à l'éditeur (admin). */
export const PUBLIC_ROLEMENU_ACTIONS = new Set(['toggle', 'menu', 'select']);

/** Vérifie que l'utilisateur peut éditer les role menus (admin interne ou ManageRoles). Répond en cas de refus. */
export async function assertRoleMenuEditor(interaction: EditorInteraction, ctx: InteractionContext): Promise<boolean> {
  const member = interaction.member instanceof GuildMember ? interaction.member : null;
  const allowed = hasInternalPermission({ member, config: ctx.config, ownerIds: env().OWNER_IDS, required: 'admin' }) || member?.permissions.has('ManageRoles') === true;
  if (!allowed) {
    await interaction.reply({ embeds: [embedService.error(ctx.t('core.insufficient_level', { level: 'admin' }))], flags: MessageFlags.Ephemeral }).catch(() => null);
    return false;
  }
  return true;
}

/** Parse un identifiant numérique de menu depuis les args du customId. */
export function parseMenuId(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Modal de création d'un role menu (`rolemenu:create`) ouvert depuis le panneau `/config module:roles`. */
export function buildRoleMenuCreateModal(t: (key: string) => string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(buildCustomId('rolemenu', 'create'))
    .setTitle(t('roles.rolemenu.modal.create_title').slice(0, 45))
    .addLabelComponents(
      new LabelBuilder().setLabel(t('roles.rolemenu.modal.name').slice(0, 45)).setTextInputComponent(new TextInputBuilder().setCustomId('name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
      new LabelBuilder().setLabel(t('roles.rolemenu.modal.title').slice(0, 45)).setTextInputComponent(new TextInputBuilder().setCustomId('title').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256)),
      new LabelBuilder().setLabel(t('roles.rolemenu.modal.description').slice(0, 45)).setTextInputComponent(new TextInputBuilder().setCustomId('description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000)),
    );
}
