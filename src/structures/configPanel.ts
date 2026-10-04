import type { ChatInputCommandInteraction } from 'discord.js';
import type { GuildKind } from '@prisma/client';
import type { ModuleKey } from '../config/constants';
import type { InteractionContext } from './types';

/**
 * Un panneau de configuration ouvert par `/config module:<key>`.
 * Chaque fichier de `src/panels/` exporte `default defineConfigPanel({...})` ; il est découvert automatiquement.
 * Le panneau répond lui-même (réponse éphémère) et gère ses composants via son propre namespace de customId.
 */
export interface ConfigPanel {
  /** Valeur de l'option `module` (minuscules, sans espace) */
  key: string;
  /** Libellé affiché dans la liste des choix (français) */
  label: string;
  emoji: string;
  /** Ordre d'affichage dans la liste */
  order: number;
  /** Module lié : si désactivé, le panneau l'indique mais reste ouvrable pour le réactiver */
  module?: ModuleKey;
  /** Types de serveur où le panneau a du sens (vide = tous) */
  guildKinds?: GuildKind[];
  open(interaction: ChatInputCommandInteraction, ctx: InteractionContext): Promise<unknown>;
}

export const defineConfigPanel = (panel: ConfigPanel): ConfigPanel => panel;
