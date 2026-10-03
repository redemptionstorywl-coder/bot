import { GuildMember, MessageFlags, type ButtonInteraction, type AnySelectMenuInteraction, type ModalSubmitInteraction } from 'discord.js';
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
